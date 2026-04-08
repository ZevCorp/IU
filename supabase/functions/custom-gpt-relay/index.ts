import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_PUBLISHABLE_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "";

const SESSION_TTL_MS = Math.max(
  60000,
  Number(Deno.env.get("CUSTOM_GPT_SESSION_TTL_MS") || 120000),
);
const WAIT_NEXT_TIMEOUT_MS = Math.max(
  5000,
  Math.min(30000, Number(Deno.env.get("CUSTOM_GPT_WAIT_NEXT_TIMEOUT_MS") || 30000)),
);
const WAIT_NEXT_POLL_MS = Math.max(
  250,
  Number(Deno.env.get("CUSTOM_GPT_WAIT_NEXT_POLL_MS") || 1500),
);
const ACTION_TIMEOUT_MS = Math.max(
  5000,
  Math.min(60000, Number(Deno.env.get("CUSTOM_GPT_ACTION_TIMEOUT_MS") || 25000)),
);


const SYSTEM_PROMPT = `
Eres el asistente de voz principal de IU OS operando dentro de un GPT personalizado conectado a herramientas reales.

Tu trabajo es conversar de forma natural, breve y precisa, pero ejecutar acciones reales SOLO mediante herramientas.

Objetivo operativo:
- Ser la capa de voz del sistema principal.
- Usar herramientas para notas, metas, finanzas, recordatorios y acciones en el computador.
- Mantener sincronizado el contexto de voz con el cerebro principal usando \`voice_turn_summary\`.

Reglas críticas:
- Nunca inventes que ejecutaste una accion si no llamaste la herramienta correspondiente.
- Nunca simules resultados de herramientas.
- Si una accion cambia notas, metas, finanzas, recordatorios o el computador, debes usar la herramienta.
- Si solo necesitas responder conversacionalmente, responde sin herramienta.
- Si necesitas datos antes de actuar, consulta primero con herramientas de lectura.
- Para acciones de computador, usa \`execute_screen_action\` con un objetivo claro, la app objetivo y \`steps_hint\` concretos.
- No dependas del texto detectado por polling para ejecutar acciones. El polling solo existe como reflejo visual externo de la conversación.
- Cuando cierres un turno importante o quede una decisión/resultado útil para el sistema principal, llama \`voice_turn_summary\`.
- \`voice_turn_summary\` debe resumir intención, decisión, resultado y próximos pasos si existen.
- Si una herramienta devuelve error, explícalo con honestidad y propone el siguiente paso mínimo.
`.trim();

const OPERATIONS = [
  { name: "list_notes", summary: "List notes", description: "Lista notas disponibles con titulo, preview y metadata basica.", inputSchema: { type: "object", properties: { limit: { type: "integer" } } } },
  { name: "search_notes", summary: "Search notes", description: "Busca notas por titulo o contenido.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "get_note", summary: "Get note", description: "Devuelve una nota completa por id.", inputSchema: { type: "object", properties: { note_id: { type: "string" }, max_chars: { type: "integer" } }, required: ["note_id"] } },
  { name: "create_note", summary: "Create note", description: "Crea una nota nueva.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] } },
  { name: "update_note", summary: "Update note", description: "Actualiza titulo o cuerpo completo de una nota.", inputSchema: { type: "object", properties: { note_id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["note_id"] } },
  { name: "delete_note", summary: "Delete note", description: "Elimina una nota existente.", inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] } },
  { name: "list_metas", summary: "List metas", description: "Lista metas disponibles.", inputSchema: { type: "object", properties: { limit: { type: "integer" } } } },
  { name: "search_metas", summary: "Search metas", description: "Busca metas por titulo o descripcion.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "get_meta", summary: "Get meta", description: "Devuelve una meta por id con sus notas vinculadas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" } }, required: ["meta_id"] } },
  { name: "create_meta", summary: "Create meta", description: "Crea una meta nueva.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title"] } },
  { name: "update_meta", summary: "Update meta", description: "Actualiza una meta existente.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, title: { type: "string" }, description: { type: "string" } }, required: ["meta_id"] } },
  { name: "delete_meta", summary: "Delete meta", description: "Elimina una meta existente.", inputSchema: { type: "object", properties: { meta_id: { type: "string" } }, required: ["meta_id"] } },
  { name: "attach_note_to_meta", summary: "Attach note to meta", description: "Vincula una nota a una meta.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, note_id: { type: "string" } }, required: ["meta_id", "note_id"] } },
  { name: "detach_note_from_meta", summary: "Detach note from meta", description: "Desvincula una nota de una meta.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, note_id: { type: "string" } }, required: ["meta_id", "note_id"] } },
  { name: "update_finance_instructions", summary: "Update finance instructions", description: "Actualiza el texto libre de la meta fija Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, instructions: { type: "string" } }, required: ["meta_id", "instructions"] } },
  { name: "create_finance_pocket", summary: "Create finance pocket", description: "Crea un bolsillo dentro de Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, name: { type: "string" }, bank: { type: "string" }, purpose: { type: "string" }, balance: { type: "number" } }, required: ["meta_id", "name"] } },
  { name: "update_finance_pocket", summary: "Update finance pocket", description: "Edita un bolsillo de Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, pocket_id: { type: "string" }, name: { type: "string" }, bank: { type: "string" }, purpose: { type: "string" }, balance: { type: "number" } }, required: ["meta_id", "pocket_id"] } },
  { name: "delete_finance_pocket", summary: "Delete finance pocket", description: "Elimina un bolsillo de Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, pocket_id: { type: "string" } }, required: ["meta_id", "pocket_id"] } },
  { name: "deposit_finance_pocket", summary: "Deposit finance pocket", description: "Carga dinero en un bolsillo.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, pocket_id: { type: "string" }, amount: { type: "number" } }, required: ["meta_id", "pocket_id", "amount"] } },
  { name: "withdraw_finance_pocket", summary: "Withdraw finance pocket", description: "Descarga dinero de un bolsillo.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, pocket_id: { type: "string" }, amount: { type: "number" } }, required: ["meta_id", "pocket_id", "amount"] } },
  { name: "move_money_between_finance_pockets", summary: "Move money between finance pockets", description: "Mueve dinero entre bolsillos de Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, from_pocket_id: { type: "string" }, to_pocket_id: { type: "string" }, amount: { type: "number" } }, required: ["meta_id", "from_pocket_id", "to_pocket_id", "amount"] } },
  { name: "update_finance_projection", summary: "Update finance projection", description: "Actualiza ingresos, gastos y horizonte de Finanzas.", inputSchema: { type: "object", properties: { meta_id: { type: "string" }, expected_income: { type: "number" }, expected_expenses: { type: "number" }, horizon_weeks: { type: "integer" }, current_label: { type: "string" }, future_label: { type: "string" } }, required: ["meta_id"] } },
  { name: "execute_screen_action", summary: "Prepare computer action", description: "Prepara una accion del computador usando goal, app y steps_hint.", inputSchema: { type: "object", properties: { goal: { type: "string" }, app: { type: "string" }, steps_hint: { type: "string" } }, required: ["goal", "app", "steps_hint"] } },
  { name: "schedule_reminder", summary: "Schedule reminder", description: "Programa un recordatorio futuro.", inputSchema: { type: "object", properties: { task: { type: "string" }, minutes: { type: "integer" } }, required: ["task", "minutes"] } },
  { name: "play_agario", summary: "Prepare Agar.io session", description: "Prepara una sesion de Agar.io.", inputSchema: { type: "object", properties: { nickname: { type: "string" } } } },
  { name: "voice_turn_summary", summary: "Send voice turn summary to main brain", description: "Entrega un resumen de la conversacion de voz al cerebro principal.", inputSchema: { type: "object", properties: { summary: { type: "string" }, user_text: { type: "string" }, assistant_text: { type: "string" } }, required: ["summary"] } },
] as const;

function normalizeHttpsUrl(url: string): string {
  const raw = String(url || "").trim().replace(/\/$/, "");
  if (!raw) return raw;
  return raw.replace(/^http:\/\//i, "https://");
}

function buildConsentHtml(supabaseUrl: string, supabaseKey: string): string {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IU OS — Autorizar</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080810;color:#e2e2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#0f0f1a;border:1px solid #1c1c2e;border-radius:18px;padding:44px 40px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.logo{text-align:center;margin-bottom:28px}
.logo h1{font-size:30px;font-weight:800;letter-spacing:-1px;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.logo p{color:#4b5563;font-size:13px;margin-top:8px}
label{display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
.field{margin-bottom:16px}
input[type=email],input[type=password]{width:100%;padding:12px 14px;background:#090912;border:1px solid #1c1c2e;border-radius:9px;color:#e2e2f0;font-size:14px;outline:none;transition:border-color .2s}
input:focus{border-color:#7c3aed}
.btn{width:100%;padding:13px;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-top:4px}
.btn-primary{background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff}
.btn-secondary{background:#1c1c2e;color:#9ca3af;margin-top:10px}
.btn:hover{opacity:.88}.btn:disabled{opacity:.5;cursor:not-allowed}
.err-box{background:#1a0808;border:1px solid #7f1d1d;border-radius:8px;padding:10px 14px;font-size:13px;color:#fca5a5;margin-bottom:14px}
.client-box{background:#0d0d18;border:1px solid #1c1c2e;border-radius:10px;padding:16px;margin-bottom:18px;font-size:13px;color:#9ca3af}
.client-box strong{color:#c4b5fd;font-size:15px;display:block;margin-bottom:6px}
.scopes{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.scope-tag{background:#1c1c2e;border:1px solid #2d2d3e;border-radius:20px;padding:3px 10px;font-size:11px;color:#a78bfa}
.hint{text-align:center;margin-top:14px;font-size:11px;color:#1f2937}
</style></head><body>
<div class="card">
  <div id="loading-view"><div class="logo"><h1>IU OS</h1><p>Cargando...</p></div></div>
  <div id="login-view" style="display:none">
    <div class="logo"><h1>IU OS</h1><p>Inicia sesión para continuar</p></div>
    <div id="login-error" class="err-box" style="display:none"></div>
    <form id="login-form">
      <div class="field"><label>Email</label><input type="email" id="email" required autocomplete="email" autofocus placeholder="tu@email.com"></div>
      <div class="field"><label>Contraseña</label><input type="password" id="password" required autocomplete="current-password" placeholder="••••••••"></div>
      <button type="submit" class="btn btn-primary">Continuar →</button>
    </form>
  </div>
  <div id="consent-view" style="display:none">
    <div class="logo"><h1>IU OS</h1><p>Solicitud de acceso</p></div>
    <div class="client-box">
      <strong id="client-name"></strong>
      Solicita acceso a tu cuenta de IU OS.
      <div class="scopes" id="scopes-list"></div>
    </div>
    <div id="consent-error" class="err-box" style="display:none"></div>
    <button id="btn-approve" class="btn btn-primary">Autorizar</button>
    <button id="btn-deny" class="btn btn-secondary">Denegar acceso</button>
    <p class="hint">Solo autoriza aplicaciones en las que confíes.</p>
  </div>
  <div id="error-view" style="display:none">
    <div class="logo"><h1>IU OS</h1></div>
    <div class="err-box"><p id="error-msg"></p></div>
  </div>
</div>
<script>
(function(){
  var SUPABASE_URL='${supabaseUrl}',SUPABASE_KEY='${supabaseKey}',sb,authorizationId;
  function show(v){['loading-view','login-view','consent-view','error-view'].forEach(function(id){
    document.getElementById(id).style.display=id===v?'block':'none';
  });}
  function showError(m){document.getElementById('error-msg').textContent=m;show('error-view');}
  async function loadConsent(){
    try{
      var r=await sb.auth.oauth.getAuthorizationDetails(authorizationId);
      if(r.error||!r.data){showError(r.error?.message||'Error al cargar detalles.');return;}
      document.getElementById('client-name').textContent=r.data.client?.name||'Aplicación';
      var sl=document.getElementById('scopes-list');sl.innerHTML='';
      var scopes=String(r.data.scope||'').trim().split(/\s+/).filter(Boolean);
      scopes.forEach(function(s){var c=document.createElement('span');c.className='scope-tag';c.textContent=s;sl.appendChild(c);});
      show('consent-view');
    }catch(e){showError(e.message||'Error inesperado.');}
  }
  async function init(){
    if(!window.supabase){setTimeout(init,50);return;}
    sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
    var p=new URLSearchParams(window.location.search);authorizationId=p.get('authorization_id');
    if(!authorizationId){showError('Parámetro authorization_id faltante.');return;}
    var u=await sb.auth.getUser();
    if(!u.data?.user){show('login-view');return;}
    await loadConsent();
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.getElementById('login-form').addEventListener('submit',async function(e){
      e.preventDefault();
      var email=document.getElementById('email').value,password=document.getElementById('password').value;
      var errEl=document.getElementById('login-error');errEl.style.display='none';
      var btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='Entrando...';
      var r=await sb.auth.signInWithPassword({email:email,password:password});
      btn.disabled=false;btn.textContent='Continuar →';
      if(r.error){errEl.textContent=r.error.message==='Invalid login credentials'?'Credenciales incorrectas.':r.error.message;errEl.style.display='block';return;}
      await loadConsent();
    });
    document.getElementById('btn-approve').addEventListener('click',async function(){
      var btn=this,errEl=document.getElementById('consent-error');
      btn.disabled=true;btn.textContent='Autorizando...';errEl.style.display='none';
      try{
        var r=await sb.auth.oauth.approveAuthorization(authorizationId);
        if(r.error){errEl.textContent=r.error.message;errEl.style.display='block';btn.disabled=false;btn.textContent='Autorizar';return;}
        window.location.href=r.data.redirect_to;
      }catch(e){errEl.textContent=e.message;errEl.style.display='block';btn.disabled=false;btn.textContent='Autorizar';}
    });
    document.getElementById('btn-deny').addEventListener('click',async function(){
      try{
        var r=await sb.auth.oauth.denyAuthorization(authorizationId);
        if(r.error||!r.data){showError(r.error?.message||'Error');return;}
        window.location.href=r.data.redirect_to;
      }catch(e){showError(e.message);}
    });
  });
  init();
})();
<\/script>
</body></html>`;
}

function corsHeaders(extra: HeadersInit = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extra,
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function normalizePath(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = "/custom-gpt-relay";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return pathname;
  const normalized = pathname.slice(markerIndex + marker.length);
  return normalized || "/";
}

function buildFunctionBaseUrl() {
  return `${normalizeHttpsUrl(SUPABASE_URL)}/functions/v1/custom-gpt-relay`;
}

function buildOpenApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const operation of OPERATIONS) {
    paths[`/action/${operation.name}`] = {
      post: {
        operationId: operation.name,
        summary: operation.summary,
        description: operation.description,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: operation.inputSchema,
            },
          },
        },
        responses: {
          200: {
            description: "Successful response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    error: { type: "string" }
                  },
                  additionalProperties: true
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "IU OS Supabase GPT Relay",
      version: "1.0.0",
      description: "Edge Function relay de bajo costo para el GPT personalizado de IU OS.",
    },
    servers: [{ url: baseUrl }],
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    paths,
  };
}

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticateUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { user: null, error: "Missing Authorization header" };

  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await client.auth.getUser();
  return {
    user: data.user,
    error: error?.message || (!data.user ? "Unauthorized" : ""),
  };
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch (_) {
    return {};
  }
}

function operationExists(name: string) {
  return OPERATIONS.some((operation) => operation.name === name);
}

async function handleOpenApi(req: Request) {
  return json(buildOpenApi(buildFunctionBaseUrl()));
}

async function handleSystemPrompt() {
  return json({ ok: true, prompt: SYSTEM_PROMPT });
}

async function handleHealth() {
  return json({
    ok: true,
    transport: "supabase-session-long-poll",
    operations: OPERATIONS.map((operation) => operation.name),
  });
}

async function verifyDesktop(service: ReturnType<typeof getServiceClient>, desktopId: string, desktopSecret: string) {
  const { data: desktop, error } = await service
    .from("custom_gpt_desktops")
    .select("id, user_id, session_id, session_status, session_expires_at")
    .eq("id", desktopId)
    .eq("desktop_secret", desktopSecret)
    .maybeSingle();

  if (error || !desktop) {
    return { desktop: null, error: "Desktop not authorized" };
  }

  return { desktop, error: "" };
}

async function touchDesktopSession(service: ReturnType<typeof getServiceClient>, desktopId: string, sessionId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await service
    .from("custom_gpt_desktops")
    .update({
      session_status: "active",
      session_id: sessionId,
      session_last_seen_at: new Date().toISOString(),
      session_expires_at: expiresAt,
    })
    .eq("id", desktopId)
    .eq("session_id", sessionId);
}

async function handleDesktopSessionOpen(req: Request) {
  const body = await readJson(req) as Json;
  const desktopId = String(body.desktop_id || "").trim();
  const desktopSecret = String(body.desktop_secret || "").trim();
  if (!desktopId || !desktopSecret) {
    return json({ ok: false, error: "desktop_id and desktop_secret are required" }, 400);
  }

  const service = getServiceClient();
  const { desktop, error: desktopError } = await verifyDesktop(service, desktopId, desktopSecret);
  if (!desktop) {
    return json({ ok: false, error: desktopError }, 401);
  }

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const metadata = {
    device_id: String(body.device_id || "").trim(),
    custom_gpt_url: String(body.custom_gpt_url || "").trim(),
    last_session_opened_at: now,
  };

  const { error } = await service
    .from("custom_gpt_desktops")
    .update({
      session_status: "active",
      session_id: sessionId,
      session_opened_at: now,
      session_last_seen_at: now,
      session_expires_at: expiresAt,
      metadata,
    })
    .eq("id", desktop.id);

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({
    ok: true,
    session_id: sessionId,
    wait_timeout_ms: WAIT_NEXT_TIMEOUT_MS,
    session_ttl_ms: SESSION_TTL_MS,
  });
}

async function handleDesktopSessionClose(req: Request) {
  const body = await readJson(req) as Json;
  const desktopId = String(body.desktop_id || "").trim();
  const desktopSecret = String(body.desktop_secret || "").trim();
  const sessionId = String(body.session_id || "").trim();
  if (!desktopId || !desktopSecret || !sessionId) {
    return json({ ok: false, error: "desktop_id, desktop_secret and session_id are required" }, 400);
  }

  const service = getServiceClient();
  const { desktop, error: desktopError } = await verifyDesktop(service, desktopId, desktopSecret);
  if (!desktop) {
    return json({ ok: false, error: desktopError }, 401);
  }

  if (String(desktop.session_id || "") !== sessionId) {
    return json({ ok: false, error: "Session is no longer active" }, 409);
  }

  const { error } = await service
    .from("custom_gpt_desktops")
    .update({
      session_status: "idle",
      session_id: null,
      session_opened_at: null,
      session_last_seen_at: null,
      session_expires_at: null,
    })
    .eq("id", desktop.id)
    .eq("session_id", sessionId);

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, session_id: sessionId, status: "idle" });
}

async function claimNextQueuedRequest(
  service: ReturnType<typeof getServiceClient>,
  desktopId: string,
  sessionId: string,
) {
  const { data: queuedRows, error } = await service
    .from("custom_gpt_action_requests")
    .select("id")
    .eq("desktop_id", desktopId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !queuedRows || queuedRows.length === 0) {
    return null;
  }

  const candidateId = queuedRows[0].id;
  const { data: claimed, error: claimError } = await service
    .from("custom_gpt_action_requests")
    .update({
      status: "processing",
      claimed_by_session_id: sessionId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", candidateId)
    .eq("desktop_id", desktopId)
    .eq("status", "queued")
    .select("id, operation_name, request_payload")
    .maybeSingle();

  if (claimError || !claimed) {
    return null;
  }

  return claimed;
}

async function handleDesktopWaitNext(req: Request) {
  const body = await readJson(req) as Json;
  const desktopId = String(body.desktop_id || "").trim();
  const desktopSecret = String(body.desktop_secret || "").trim();
  const sessionId = String(body.session_id || "").trim();
  const timeoutMs = Math.max(
    3000,
    Math.min(WAIT_NEXT_TIMEOUT_MS, Number(body.timeout_ms || WAIT_NEXT_TIMEOUT_MS)),
  );

  if (!desktopId || !desktopSecret || !sessionId) {
    return json({ ok: false, error: "desktop_id, desktop_secret and session_id are required" }, 400);
  }

  const service = getServiceClient();
  const { desktop, error: desktopError } = await verifyDesktop(service, desktopId, desktopSecret);
  if (!desktop) {
    return json({ ok: false, error: desktopError }, 401);
  }

  if (
    String(desktop.session_id || "") !== sessionId ||
    desktop.session_status !== "active" ||
    !desktop.session_expires_at ||
    new Date(desktop.session_expires_at).getTime() <= Date.now()
  ) {
    return json({ ok: false, error: "Desktop session expired" }, 409);
  }

  await touchDesktopSession(service, desktopId, sessionId);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestRow = await claimNextQueuedRequest(service, desktopId, sessionId);
    if (requestRow) {
      return json({ ok: true, request: requestRow });
    }

    await new Promise((resolve) => setTimeout(resolve, WAIT_NEXT_POLL_MS));
  }

  return json({ ok: true, timeout: true });
}

async function handleDesktopComplete(req: Request) {
  const body = await readJson(req) as Json;
  const desktopId = String(body.desktop_id || "").trim();
  const desktopSecret = String(body.desktop_secret || "").trim();
  const sessionId = String(body.session_id || "").trim();
  const requestId = String(body.request_id || "").trim();
  const result = (body.result && typeof body.result === "object") ? body.result as Json : {};

  if (!desktopId || !desktopSecret || !sessionId || !requestId) {
    return json({ ok: false, error: "desktop_id, desktop_secret, session_id and request_id are required" }, 400);
  }

  const service = getServiceClient();
  const { desktop, error: desktopError } = await verifyDesktop(service, desktopId, desktopSecret);
  if (!desktop) {
    return json({ ok: false, error: desktopError }, 401);
  }

  if (String(desktop.session_id || "") !== sessionId) {
    return json({ ok: false, error: "Desktop session expired" }, 409);
  }

  const status = result.ok === false ? "failed" : "completed";
  const { error } = await service
    .from("custom_gpt_action_requests")
    .update({
      status,
      response_payload: result,
      error_text: status === "failed" ? String(result.error || "Desktop execution failed") : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("desktop_id", desktop.id)
    .eq("claimed_by_session_id", sessionId)
    .in("status", ["processing", "queued"]);

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  await touchDesktopSession(service, desktop.id, sessionId);
  return json({ ok: true, request_id: requestId, status });
}

async function waitForActionResult(service: ReturnType<typeof getServiceClient>, requestId: string) {
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data: row } = await service
      .from("custom_gpt_action_requests")
      .select("status, response_payload, error_text")
      .eq("id", requestId)
      .maybeSingle();

    if (row?.status === "completed") {
      return {
        ok: true,
        payload: row.response_payload ?? { ok: true },
      };
    }

    if (row?.status === "failed") {
      return {
        ok: false,
        payload: row.response_payload ?? { ok: false, error: row.error_text || "Desktop execution failed" },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, WAIT_NEXT_POLL_MS));
  }

  await service
    .from("custom_gpt_action_requests")
    .update({
      status: "timed_out",
      error_text: "Timed out waiting for desktop response",
      completed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .in("status", ["queued", "processing"]);

  return {
    ok: false,
    timeout: true,
  };
}

async function handleAction(req: Request, path: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_PUBLISHABLE_KEY) {
    return json({ ok: false, error: "Supabase environment variables are missing" }, 500);
  }

  const operationName = path.replace(/^\/action\//, "").trim();
  if (!operationExists(operationName)) {
    return json({ ok: false, error: "Unknown operation: " + operationName }, 404);
  }

  const { user, error: authError } = await authenticateUser(req);
  if (!user) {
    return json({ ok: false, error: authError || "Unauthorized" }, 401);
  }

  const requestPayload = await readJson(req);
  const service = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: desktop, error: desktopError } = await service
    .from("custom_gpt_desktops")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .eq("session_status", "active")
    .gt("session_expires_at", nowIso)
    .maybeSingle();

  if (desktopError || !desktop) {
    return json({ ok: false, error: "No active desktop voice session for this user" }, 404);
  }

  const expiresAt = new Date(Date.now() + ACTION_TIMEOUT_MS + 10000).toISOString();
  const { data: inserted, error: insertError } = await service
    .from("custom_gpt_action_requests")
    .insert({
      user_id: user.id,
      desktop_id: desktop.id,
      operation_name: operationName,
      request_payload: requestPayload ?? {},
      status: "queued",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return json({ ok: false, error: insertError?.message || "Could not enqueue action" }, 500);
  }

  const result = await waitForActionResult(service, inserted.id);
  if (result.ok) {
    return json(result.payload, 200);
  }
  if (result.payload) {
    return json(result.payload, 200);
  }
  return json({ ok: false, error: "Timed out waiting for desktop response" }, 504);
}

async function handleOAuthConsent(req: Request) {
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  return new Response(
    buildConsentHtml(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY),
    { headers: corsHeaders({ "Content-Type": "text/html; charset=utf-8" }) },
  );
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const path = normalizePath(req);

  if (req.method === "GET" && path === "/health") {
    return handleHealth();
  }

  if (req.method === "GET" && path === "/openapi.json") {
    return handleOpenApi(req);
  }

  if (req.method === "GET" && path === "/system-prompt") {
    return handleSystemPrompt();
  }

  if (req.method === "POST" && path === "/desktop/session/open") {
    return handleDesktopSessionOpen(req);
  }

  if (req.method === "POST" && path === "/desktop/session/close") {
    return handleDesktopSessionClose(req);
  }

  if (req.method === "POST" && path === "/desktop/wait-next") {
    return handleDesktopWaitNext(req);
  }

  if (req.method === "POST" && path === "/desktop/complete") {
    return handleDesktopComplete(req);
  }

  if (req.method === "POST" && path.startsWith("/action/")) {
    return handleAction(req, path);
  }

  // Supabase native OAuth 2.1 consent page
  if (req.method === "GET" && path === "/oauth/consent") {
    return handleOAuthConsent(req);
  }

  return json({ ok: false, error: "Not found" }, 404);
});
