const SUPABASE_URL = "https://vbpzzixgzlynexpogyzl.supabase.co";
const SUPABASE_KEY = "sb_publishable_jqBOvvFWjc8jtIy1gflUmA__jh_PavN";
let sb: any;
let authorizationId: string | null;

function show(v: string) {
  ['loading-view', 'login-view', 'consent-view', 'success-view', 'error-view'].forEach((id) => {
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
      showError(error?.message || 'No se pudieron cargar los detalles de autorización.');
      return;
    }
    const clientNameEl = document.getElementById('client-name');
    if (clientNameEl) clientNameEl.textContent = data.client?.name || 'Aplicación Externa';
    
    const sl = document.getElementById('scopes-list');
    if (sl) {
      sl.innerHTML = '';
      (data.scopes || []).forEach((s: string) => {
        const c = document.createElement('span');
        c.className = 'scope-pill';
        c.textContent = s;
        sl.appendChild(c);
      });
    }
    show('consent-view');
  } catch (e: any) {
    showError(e.message || 'Error inesperado al cargar la autorización.');
  }
}

async function checkState() {
  const { data } = await sb.auth.getUser();
  
  if (!authorizationId) {
    // Si no hay authorizationId, es un login genérico (ej. entraron directo a oauth.html)
    if (data?.user) {
        show('success-view');
    } else {
        const titleEl = document.getElementById('login-title');
        const subEl = document.getElementById('login-subtitle');
        if (titleEl) titleEl.textContent = "Bienvenido a I&Ü";
        if (subEl) subEl.textContent = "Inicia sesión para acceder a tu plataforma";
        show('login-view');
    }
    return;
  }

  // Flujo OAuth: si no está logueado, pedimos login. Si sí, vamos al consent.
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
        btn.textContent = 'Autenticando...';
      }
      
      const { error } = await sb.auth.signInWithPassword({ email, password });
      
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
      
      if (error) {
        if (errEl) {
          errEl.textContent = error.message === 'Invalid login credentials' ? 'Credenciales incorrectas.' : error.message;
          errEl.style.display = 'block';
        }
        return;
      }
      
      // Post-login check
      if (authorizationId) {
        await loadConsent();
      } else {
        show('success-view');
      }
    });
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove) {
    btnApprove.addEventListener('click', async function() {
      if (!authorizationId) return;
      const btn = this as HTMLButtonElement;
      const errEl = document.getElementById('consent-error');
      btn.disabled = true;
      btn.textContent = 'Preparando entorno...';
      if (errEl) errEl.style.display = 'none';
      
      try {
        const { data, error } = await sb.auth.oauth.approveAuthorization(authorizationId);
        if (error) {
          if (errEl) {
            errEl.textContent = error.message;
            errEl.style.display = 'block';
          }
          btn.disabled = false;
          btn.textContent = 'Autorizar App';
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
        btn.textContent = 'Autorizar App';
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
          showError(error?.message || 'Error al denegar acceso.');
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

  const btnDashboard = document.getElementById('btn-dashboard');
  if (btnDashboard) {
    btnDashboard.addEventListener('click', () => {
       window.location.href = '/dashboard.html';
    });
  }
});

init();
