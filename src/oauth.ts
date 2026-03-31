const SUPABASE_URL = "https://vbpzzixgzlynexpogyzl.supabase.co";
const SUPABASE_KEY = "sb_publishable_jqBOvvFWjc8jtIy1gflUmA__jh_PavN";
let sb: any;
let authorizationId: string | null;

function show(v: string) {
  ['loading-view', 'login-view', 'consent-view', 'error-view'].forEach((id) => {
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
      showError(error?.message || 'Error al cargar detalles.');
      return;
    }
    const clientNameEl = document.getElementById('client-name');
    if (clientNameEl) clientNameEl.textContent = data.client?.name || 'Aplicación';
    
    const sl = document.getElementById('scopes-list');
    if (sl) {
      sl.innerHTML = '';
      (data.scopes || []).forEach((s: string) => {
        const c = document.createElement('span');
        c.className = 'scope-tag';
        c.textContent = s;
        sl.appendChild(c);
      });
    }
    show('consent-view');
  } catch (e: any) {
    showError(e.message || 'Error inesperado.');
  }
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
  
  if (!authorizationId) {
    showError('Parámetro authorization_id faltante en la URL.');
    return;
  }
  
  const { data } = await sb.auth.getUser();
  if (!data?.user) {
    show('login-view');
    return;
  }
  await loadConsent();
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
        btn.textContent = 'Entrando...';
      }
      
      const { error } = await sb.auth.signInWithPassword({ email, password });
      
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Continuar →';
      }
      
      if (error) {
        if (errEl) {
          errEl.textContent = error.message === 'Invalid login credentials' ? 'Credenciales incorrectas.' : error.message;
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
      const btn = this as HTMLButtonElement;
      const errEl = document.getElementById('consent-error');
      btn.disabled = true;
      btn.textContent = 'Autorizando...';
      if (errEl) errEl.style.display = 'none';
      
      try {
        const { data, error } = await sb.auth.oauth.approveAuthorization(authorizationId);
        if (error) {
          if (errEl) {
            errEl.textContent = error.message;
            errEl.style.display = 'block';
          }
          btn.disabled = false;
          btn.textContent = 'Autorizar';
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
        btn.textContent = 'Autorizar';
      }
    });
  }

  const btnDeny = document.getElementById('btn-deny');
  if (btnDeny) {
    btnDeny.addEventListener('click', async () => {
      try {
        const { data, error } = await sb.auth.oauth.denyAuthorization(authorizationId);
        if (error || !data) {
          showError(error?.message || 'Error');
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

init();
