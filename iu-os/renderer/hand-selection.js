/**
 * HandSelection — Detección de selección de elementos UI por gestos de mano.
 *
 * Expone window.HandSelection con:
 *   init(opts)           — registra callbacks y proveedor de AX elements
 *   process(hands)       — llamar cada frame con el array de landmarks
 *   getState()           — estado actual para el render
 *
 * Coordenadas de landmarks MediaPipe: x,y ∈ [0,1], x espejado (x=0 es derecha del usuario)
 * Coordenadas de pantalla normalizadas: x=0 izquierda, y=0 arriba (CSS-like)
 * Bbox AX: normalizado al tamaño lógico de la pantalla, y=0 arriba (Quartz coords)
 *
 * Gestos soportados:
 *   1. Dwell  — índice extendido sobre un elemento > CFG.dwell_ms  → onSelect(el, 'dwell')
 *   2. Pinch-rect — ambas manos con pinch cerrado → rectángulo → onSelect(el, 'pinch-rect')
 */
(function () {
  'use strict';

  // ── MediaPipe landmark indices ──────────────────────────────────────────
  const THUMB_TIP  = 4;
  const INDEX_TIP  = 8;
  const INDEX_PIP  = 6; // proximal interphalangeal — para saber si está extendido

  // ── Parámetros ajustables ───────────────────────────────────────────────
  const CFG = {
    dwell_ms:       700,   // ms sobre el elemento antes de seleccionar
    dwell_radius:   0.04,  // radio máximo de movimiento durante dwell (coords norm.)
    pinch_dist:     0.06,  // distancia pulgar-índice para considerar pinch cerrado
    ax_ttl_ms:      2500,  // vida del caché de AX snapshot (ms)
    min_rect_w:     0.03,  // ancho mínimo del pinch-rect para ser válido
    min_rect_h:     0.03,
  };

  // ── Estado interno ──────────────────────────────────────────────────────
  let callbacks = {};      // { onHover, onSelect, onPinchRect, getAxElements }
  let axElements  = null;  // caché de elementos AX
  let axFetchedAt = 0;
  let axFetching  = false;

  let hoveredEl = null;    // elemento actualmente bajo el índice
  let dwell = null;        // { el, startAt, sx, sy }
  let pinch = {            // estado del gesto pinch-rect
    active: false,
    rect:   null,          // { x, y, w, h } en coords screen [0-1]
    p0:     null,          // centro pinch mano 0 { x, y }
    p1:     null,          // centro pinch mano 1 { x, y }
  };

  // ── Conversión de coordenadas ───────────────────────────────────────────

  /** Landmark (cámara, x espejado) → coordenadas de pantalla normalizadas */
  function lmToScreen(lm) {
    return { x: 1 - lm.x, y: lm.y };
  }

  /** Hit test: punto en coords screen vs bbox AX */
  function hitTest(sx, sy, bbox) {
    return (
      sx >= bbox.x &&
      sx <= bbox.x + bbox.w &&
      sy >= bbox.y &&
      sy <= bbox.y + bbox.h
    );
  }

  /** Elemento AX más pequeño que contiene el punto (mayor precisión) */
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

  /** Elemento AX con mayor solapamiento con un rectángulo screen */
  function findBestOverlap(rect) {
    if (!axElements) return null;
    let best = null, bestOv = 0;
    for (const el of axElements) {
      if (!el.bbox) continue;
      const b = el.bbox;
      const ox = Math.max(0, Math.min(rect.x + rect.w, b.x + b.w) - Math.max(rect.x, b.x));
      const oy = Math.max(0, Math.min(rect.y + rect.h, b.y + b.h) - Math.max(rect.y, b.y));
      const ov = ox * oy;
      if (ov > bestOv) { best = el; bestOv = ov; }
    }
    return best;
  }

  // ── Detección de gestos ─────────────────────────────────────────────────

  function isPinchClosed(hand) {
    const t = hand[THUMB_TIP], i = hand[INDEX_TIP];
    if (!t || !i) return false;
    return Math.hypot(t.x - i.x, t.y - i.y) < CFG.pinch_dist;
  }

  function isIndexExtended(hand) {
    const tip = hand[INDEX_TIP], pip = hand[INDEX_PIP];
    // tip.y < pip.y  →  la punta está MÁS ARRIBA que la articulación = extendido
    return tip && pip && tip.y < pip.y;
  }

  function pinchCenter(hand) {
    const t = hand[THUMB_TIP], i = hand[INDEX_TIP];
    return lmToScreen({ x: (t.x + i.x) / 2, y: (t.y + i.y) / 2 });
  }

  // ── Caché AX (refresh asíncrono, no bloquea el frame) ──────────────────

  function maybeRefreshAx() {
    if (!callbacks.getAxElements) return;
    if (axFetching) return;
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

  // ── Procesamiento principal (síncrono, llamar cada frame) ───────────────

  function process(hands) {
    const now = performance.now();
    maybeRefreshAx(); // fire-and-forget en background

    const h0 = hands?.[0] ?? null;
    const h1 = hands?.[1] ?? null;

    // ── Gesto pinch-rect: ambas manos con pinch cerrado ─────────────────
    if (h0 && h1 && isPinchClosed(h0) && isPinchClosed(h1)) {
      const pc0 = pinchCenter(h0);
      const pc1 = pinchCenter(h1);
      const rect = {
        x: Math.min(pc0.x, pc1.x),
        y: Math.min(pc0.y, pc1.y),
        w: Math.abs(pc0.x - pc1.x),
        h: Math.abs(pc0.y - pc1.y),
      };

      const wasActive = pinch.active;
      pinch = { active: true, rect, p0: pc0, p1: pc1 };
      callbacks.onPinchRect?.(pinch);

      // Resetear dwell mientras hacemos pinch-rect
      dwell = null;
      if (hoveredEl) { hoveredEl = null; callbacks.onHover?.(null); }
      return;
    }

    // Pinch-rect terminó → disparar selección si el rect era válido
    if (pinch.active) {
      const prevRect = pinch.rect;
      pinch = { active: false, rect: null, p0: null, p1: null };
      callbacks.onPinchRect?.(null);

      if (prevRect && prevRect.w > CFG.min_rect_w && prevRect.h > CFG.min_rect_h) {
        const el = findBestOverlap(prevRect);
        if (el) callbacks.onSelect?.(el, 'pinch-rect');
      }
    }

    // ── Gesto hover/dwell: índice extendido ─────────────────────────────
    const activeHand = h0 ?? h1;

    if (!activeHand || !isIndexExtended(activeHand)) {
      if (hoveredEl) { hoveredEl = null; callbacks.onHover?.(null); }
      dwell = null;
      return;
    }

    const tip = lmToScreen(activeHand[INDEX_TIP]);
    const el  = findAt(tip.x, tip.y);

    // Notificar cambio de hover
    if (el?.id !== hoveredEl?.id) {
      hoveredEl = el ?? null;
      callbacks.onHover?.(hoveredEl);
      dwell = el ? { el, startAt: now, sx: tip.x, sy: tip.y } : null;
      return;
    }

    // Mismo elemento — acumular dwell
    if (el && dwell) {
      const moved = Math.hypot(tip.x - dwell.sx, tip.y - dwell.sy);
      if (moved > CFG.dwell_radius) {
        // Se movió demasiado: reiniciar timer pero mantener el hover
        dwell = { el, startAt: now, sx: tip.x, sy: tip.y };
      } else if (now - dwell.startAt >= CFG.dwell_ms) {
        callbacks.onSelect?.(el, 'dwell');
        // Reiniciar para que no dispare repetidamente
        dwell = { el, startAt: now + CFG.dwell_ms * 2, sx: tip.x, sy: tip.y };
      }
    } else if (el && !dwell) {
      dwell = { el, startAt: now, sx: tip.x, sy: tip.y };
    }
  }

  // ── Estado para el renderer ─────────────────────────────────────────────

  function getState() {
    const now = performance.now();
    return {
      hovered: hoveredEl,
      dwell: dwell && dwell.el ? {
        el:       dwell.el,
        progress: Math.min(1, (now - dwell.startAt) / CFG.dwell_ms),
        sx:       dwell.sx,
        sy:       dwell.sy,
      } : null,
      pinch: pinch.active ? {
        rect: pinch.rect,
        p0:   pinch.p0,
        p1:   pinch.p1,
      } : null,
    };
  }

  // ── API pública ─────────────────────────────────────────────────────────

  function init(opts) {
    callbacks = {};
    Object.assign(callbacks, opts);
  }

  window.HandSelection = { init, process, getState };
})();
