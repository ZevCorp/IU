const SUPABASE_URL = "https://vbpzzixgzlynexpogyzl.supabase.co";
const SUPABASE_KEY = "sb_publishable_jqBOvvFWjc8jtIy1gflUmA__jh_PavN";
let sb: any;
let authorizationId: string | null;

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

async function loadConsent() {
  try {
    const { data, error } = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) {
      showError(error?.message || 'No se pudieron cargar los parámetros del enlace neuronal.');
      return;
    }
    // Omitimos cargar data.client?.name porque la UI ahora está hardcodeada
    // asumiendo que es el Custom GPT para una estética inmersiva IÜ OS.
    show('consent-view');
  } catch (e: any) {
    showError(e.message || 'Error inesperado al intentar establecer el enlace.');
  }
}

async function checkState() {
  const { data } = await sb.auth.getUser();
  
  if (!authorizationId) {
    // Si no hay authorizationId, la página se abrió por error o manualmente.
    // Explicamos que debe ir al GPT. (Quitamos el flujo de "login genérico").
    show('direct-view');
    return;
  }

  // Flujo OAuth: si no está logueado en la web, pedimos identidad.
  if (!data?.user) {
    show('login-view');
    return;
  }
  
  // Si ya tiene sesión activa en el navegador, directo al consent
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
  authorizationId = p.get('authorization_id');
  
  await checkState();
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
          errEl.textContent = error.message === 'Invalid login credentials' ? 'Credenciales incorrectas o identidad no reconocida.' : error.message;
          errEl.style.display = 'block';
        }
        return;
      }
      
      // Si el login fue exitoso, ir al consent (authorizationId está garantizado a este punto por el flow)
      await loadConsent();
    });
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove) {
    btnApprove.addEventListener('click', async function() {
      if (!authorizationId) return;
      const btn = this as HTMLButtonElement;
      const errEl = document.getElementById('consent-error');
      btn.disabled = true;
      btn.textContent = 'Estableciendo enlace seguro...';
      if (errEl) errEl.style.display = 'none';
      
      try {
        const { data, error } = await sb.auth.oauth.approveAuthorization(authorizationId);
        if (error) {
          if (errEl) {
            errEl.textContent = error.message;
            errEl.style.display = 'block';
          }
          btn.disabled = false;
          btn.textContent = 'Aprobar Vinculación Temporal';
          return;
        }
        if (data.redirect_to) {
             window.location.href = data.redirect_to;
        }
      } catch (e: any) {
        if (errEl) {
          errEl.textContent = e.message;
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
      if (!authorizationId) return;
      try {
        const { data, error } = await sb.auth.oauth.denyAuthorization(authorizationId);
        if (error || !data) {
          showError(error?.message || 'Error al rechazar el enlace.');
          return;
        }
        if (data.redirect_to) {
             window.location.href = data.redirect_to;
        }
      } catch (e: any) {
        showError(e.message);
      }
    });
  }
});

// Iniciamos
init();
