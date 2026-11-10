import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://zmqfjrstuhthtrshcfwa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Izh4bHRXLj5f4aW4P-z0gA_1pUv7L4H';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function mountAuth() {
  const host = document.querySelector('.cf-top-actions') || document.querySelector('header');
  if (!host || document.getElementById('cfAuth')) return false;
  const root = document.createElement('div');
  root.id = 'cfAuth';
  root.className = 'cf-auth';
  root.innerHTML = '<span class="cf-auth-status" role="status">Comprobando sesión…</span><button type="button" class="cf-auth-button" id="cfGoogleLogin">Continuar con Google</button><button type="button" class="cf-auth-button cf-auth-logout" id="cfLogout" hidden>Cerrar sesión</button>';
  host.appendChild(root);
  root.querySelector('#cfGoogleLogin').addEventListener('click', async () => {
    const button = root.querySelector('#cfGoogleLogin');
    button.disabled = true;
    root.querySelector('.cf-auth-status').textContent = 'Redirigiendo a Google…';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { access_type: 'offline', prompt: 'consent' } }
    });
    if (error) {
      root.querySelector('.cf-auth-status').textContent = 'No se pudo iniciar sesión: ' + error.message;
      button.disabled = false;
    }
  });
  root.querySelector('#cfLogout').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) root.querySelector('.cf-auth-status').textContent = 'Error al cerrar sesión: ' + error.message;
  });
  return true;
}

function renderSession(session) {
  const root = document.getElementById('cfAuth');
  if (!root) return;
  const status = root.querySelector('.cf-auth-status');
  const login = root.querySelector('#cfGoogleLogin');
  const logout = root.querySelector('#cfLogout');
  if (session?.user) {
    const user = session.user;
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Usuario conectado';
    status.textContent = 'Conectado: ' + label;
    login.hidden = true;
    logout.hidden = false;
  } else {
    status.textContent = 'No has iniciado sesión';
    login.hidden = false;
    login.disabled = false;
    logout.hidden = true;
  }
}
const waitForHost = () => {
  if (!mountAuth()) requestAnimationFrame(waitForHost);
};
waitForHost();
supabase.auth.getSession().then(({ data, error }) => {
  if (error) console.error('ClipForge auth session:', error.message);
  renderSession(data?.session || null);
});
supabase.auth.onAuthStateChange((_event, session) => renderSession(session));
window.clipforgeSupabase = supabase;
