const SUPABASE_URL = "https://vbpzzixgzlynexpogyzl.supabase.co";
const SUPABASE_KEY = "sb_publishable_jqBOvvFWjc8jtIy1gflUmA__jh_PavN";
const GPT_BRIDGE_URL = "https://iu-rw9m.onrender.com";

let sb: any;
let requestId: string | null;
let requestDetails: any = null;

function show(v: string) {
  ['loading-view', 'direct-view', 'login-view', 'consent-view', 'error-view'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === v ? 'block' : 'none';
  });
}

function showError(m: string) {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = m;
  show('error-view');
}

function setConsentScopes(scopes: string[]) {
  const container = document.getElementById('consent-scopes');
  if (!container) return;
  container.innerHTML = '';

  const finalScopes = scopes.length ? scopes : ['Acceso básico a tu cuenta de IU OS'];
  finalScopes.forEach((scope) => {
    const row = document.createElement('div');
    row.className = 'scope-item';
    row.innerHTML = `<span class="scope-icon">●</span><span>${scope}</span>`;
    container.appendChild(row);
  });
}

async function fetchRequestDetails() {
  if (!requestId) {
    show('direct-view');
    return null;
  }

  const response = await fetch(`${GPT_BRIDGE_URL}/gpt/oauth/request?request_id=${encodeURIComponent(requestId)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.request) {
    throw new Error(payload?.error || 'No se pudo recuperar la solicitud de acceso.');
  }

  requestDetails = payload.request;
  const scopes = Array.isArray(requestDetails.scopes)
    ? requestDetails.scopes
    : String(requestDetails.scope || '').split(/\s+/).filter(Boolean);
  setConsentScopes(scopes);
  return requestDetails;
}

async function loadConsent() {
  await fetchRequestDetails();
  show('consent-view');
}

async function checkState() {
  const { data } = await sb.auth.getUser();

  if (!requestId) {
    show('direct-view');
    return;
  }

  if (!data?.user) {
    show('login-view');
    return;
  }

  await loadConsent();
}

async function init() {
  // @ts-ignore
  if (!window.supabase) {
    setTimeout(init, 50);
    return;
  }
  // @ts-ignore
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const p = new URLSearchParams(window.location.search);
  requestId = p.get('request_id');

  await checkState();
}

async function getSupabaseAccessToken() {
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token || '';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('email') as HTMLInputElement).value;
      const password = (document.getElementById('password') as HTMLInputElement).value;
      const errEl = document.getElementById('login-error');
      if (errEl) errEl.style.display = 'none';

      const btn = (e.target as HTMLFormElement).querySelector('button');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verificando...';
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });

      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Acreditar Identidad';
      }

      if (error) {
        if (errEl) {
          errEl.textContent = error.message === 'Invalid login credentials'
            ? 'Credenciales incorrectas o identidad no reconocida.'
            : error.message;
          errEl.style.display = 'block';
        }
        return;
      }

      await loadConsent();
    });
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove) {
    btnApprove.addEventListener('click', async function() {
      if (!requestId) return;
      const btn = this as HTMLButtonElement;
      const errEl = document.getElementById('consent-error');
      btn.disabled = true;
      btn.textContent = 'Estableciendo enlace seguro...';
      if (errEl) errEl.style.display = 'none';

      try {
        const accessToken = await getSupabaseAccessToken();
        if (!accessToken) {
          throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
        }

        const response = await fetch(`${GPT_BRIDGE_URL}/gpt/oauth/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ request_id: requestId })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !payload?.redirect_to) {
          throw new Error(payload?.error || 'No se pudo aprobar la conexión.');
        }

        window.location.href = payload.redirect_to;
      } catch (e: any) {
        if (errEl) {
          errEl.textContent = e.message || 'Error inesperado al aprobar el acceso.';
          errEl.style.display = 'block';
        }
        btn.disabled = false;
        btn.textContent = 'Aprobar Vinculación Temporal';
      }
    });
  }

  const btnDeny = document.getElementById('btn-deny');
  if (btnDeny) {
    btnDeny.addEventListener('click', async () => {
      if (!requestId) return;
      try {
        const response = await fetch(`${GPT_BRIDGE_URL}/gpt/oauth/deny`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ request_id: requestId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !payload?.redirect_to) {
          showError(payload?.error || 'Error al rechazar el enlace.');
          return;
        }
        window.location.href = payload.redirect_to;
      } catch (e: any) {
        showError(e.message || 'Error al rechazar el enlace.');
      }
    });
  }
});

init();
