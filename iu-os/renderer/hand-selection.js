/**
 * HandSelection — "Mirar juntos" mode
 *
 * Expone window.HandSelection con:
 *   init(opts)       — registra callbacks: { getAxElements, onFocus }
 *   process(hands)   — llamar cada frame con el array de landmarks
 *   getState()       — estado actual para el renderer
 *   setMode(on)      — activar / desactivar modo
 *
 * Gesture: dedo índice extendido y estable sobre un elemento > 4 segundos.
 * Si se mueve > 6% (CFG.move_threshold) el timer se reinicia.
 * Al cumplirse el tiempo: onFocus(el) y el contorno permanece 10 s.
 *
 * Coordenadas MediaPipe: x,y ∈ [0,1], x espejado (x=0 es derecha del usuario).
 * Coordenadas de pantalla normalizadas: sx = 1 - lm.x, sy = lm.y (CSS-like, y=0 arriba).
 */
(function () {
  'use strict';

  // ── Landmark indices ────────────────────────────────────────────────────
  const INDEX_TIP = 8;
  const INDEX_PIP = 6;

  // ── Configuración ───────────────────────────────────────────────────────
  const CFG = {
    dwell_ms:       4000,   // ms de estabilidad para seleccionar
    move_threshold: 0.06,   // máx. movimiento en coords norm. sin reiniciar
    ax_ttl_ms:      2500,   // vida del caché de AX snapshot (ms)
    focus_fade_ms:  10000,  // ms que dura el contorno del elemento seleccionado
  };

  // ── Estado ──────────────────────────────────────────────────────────────
  let enabled = false;
  let callbacks = {};

  let axElements  = null;
  let axFetchedAt = 0;
  let axFetching  = false;

  let hoveredEl = null;      // elemento bajo el índice en este frame
  let dwell = null;          // { el, startAt, sx, sy }
  let focusedItems = [];     // [{ el, focusedAt }]  — para el fade de 10 s

  // ── Helpers de coordenadas ──────────────────────────────────────────────

  function lmToScreen(lm) {
    return { x: 1 - lm.x, y: lm.y };
  }

  function isIndexExtended(hand) {
    const tip = hand[INDEX_TIP], pip = hand[INDEX_PIP];
    // tip.y < pip.y → la punta está más arriba que la articulación → extendido
    return tip && pip && tip.y < pip.y;
  }

  function hitTest(sx, sy, bbox) {
    return (
      sx >= bbox.x &&
      sx <= bbox.x + bbox.w &&
      sy >= bbox.y &&
      sy <= bbox.y + bbox.h
    );
  }

  /** Elemento más pequeño que contiene el punto */
  function findAt(sx, sy) {
    if (!axElements) return null;
    let best = null, bestArea = Infinity;
    for (const el of axElements) {
      if (!el.bbox) continue;
      if (hitTest(sx, sy, el.bbox)) {
        const area = el.bbox.w * el.bbox.h;
        if (area < bestArea) { best = el; bestArea = area; }
      }
    }
    return best;
  }

  // ── Caché AX (refresh asíncrono) ────────────────────────────────────────

  function maybeRefreshAx() {
    if (!callbacks.getAxElements || axFetching) return;
    const age = performance.now() - axFetchedAt;
    if (axElements && age < CFG.ax_ttl_ms) return;

    axFetching = true;
    callbacks.getAxElements()
      .then(els => {
        if (Array.isArray(els) && els.length > 0) {
          axElements  = els;
          axFetchedAt = performance.now();
        }
      })
      .catch(() => {})
      .finally(() => { axFetching = false; });
  }

  // ── Procesamiento principal ─────────────────────────────────────────────

  function process(hands) {
    const now = performance.now();

    // Depurar elementos cuyo contorno ya expiró
    focusedItems = focusedItems.filter(f => now - f.focusedAt < CFG.focus_fade_ms);

    if (!enabled) {
      hoveredEl = null;
      dwell     = null;
      return;
    }

    maybeRefreshAx();

    // Usar la primera mano disponible
    const activeHand = hands?.[0] ?? hands?.[1] ?? null;

    if (!activeHand || !isIndexExtended(activeHand)) {
      hoveredEl = null;
      dwell     = null;
      return;
    }

    const tip = lmToScreen(activeHand[INDEX_TIP]);
    const el  = findAt(tip.x, tip.y);

    // Cambio de elemento → reiniciar dwell
    if (el?.id !== hoveredEl?.id) {
      hoveredEl = el ?? null;
      dwell     = el ? { el, startAt: now, sx: tip.x, sy: tip.y } : null;
      return;
    }

    // Mismo elemento → acumular dwell
    if (el && dwell) {
      const moved = Math.hypot(tip.x - dwell.sx, tip.y - dwell.sy);
      if (moved > CFG.move_threshold) {
        // Movimiento excesivo → reiniciar timer pero mantener hover
        dwell = { el, startAt: now, sx: tip.x, sy: tip.y };
      } else if (now - dwell.startAt >= CFG.dwell_ms) {
        // ¡Dwell completado! → foco del elemento
        focusedItems.push({ el, focusedAt: now });
        callbacks.onFocus?.(el);
        // Reiniciar con margen para no disparar repetidamente
        dwell = { el, startAt: now + CFG.dwell_ms * 2, sx: tip.x, sy: tip.y };
      }
    } else if (el && !dwell) {
      dwell = { el, startAt: now, sx: tip.x, sy: tip.y };
    }
  }

  // ── Control de modo ─────────────────────────────────────────────────────

  function setMode(on) {
    enabled = !!on;
    if (!enabled) {
      hoveredEl = null;
      dwell     = null;
      // Los focusedItems se mantienen para que el fade termine naturalmente
    }
  }

  // ── Estado para el renderer ─────────────────────────────────────────────

  function getState() {
    const now = performance.now();
    return {
      enabled,
      hovered: hoveredEl,
      dwell: (dwell && dwell.el && enabled) ? {
        el:       dwell.el,
        progress: Math.min(1, Math.max(0, (now - dwell.startAt) / CFG.dwell_ms)),
        sx:       dwell.sx,
        sy:       dwell.sy,
      } : null,
      // Elementos seleccionados con alpha decreciente (1 → 0 en 10 s)
      focused: focusedItems.map(f => ({
        el:    f.el,
        alpha: 1 - (now - f.focusedAt) / CFG.focus_fade_ms,
      })),
    };
  }

  // ── API pública ─────────────────────────────────────────────────────────

  function init(opts) {
    callbacks = {};
    Object.assign(callbacks, opts);
  }

  window.HandSelection = { init, process, getState, setMode };
})();
