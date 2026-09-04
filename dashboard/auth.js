// ============================================================================
// AUTH.JS — Client-side API Auth Client untuk Backend Node.js Express
// ============================================================================

const AUTH_CONFIG = {
  TOKEN_KEY: 'bekaert_jwt_token',
  USER_KEY: 'bekaert_user_info',
  API_BASE: '/api/auth'
};

function getToken() {
  return sessionStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
}

function setToken(token) {
  sessionStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
}

function getSession() {
  try {
    const userStr = sessionStorage.getItem(AUTH_CONFIG.USER_KEY);
    const token = getToken();
    if (!token || !userStr) return null;
    return JSON.parse(userStr);
  } catch { return null; }
}

function saveSession(user, token) {
  setToken(token);
  sessionStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
}

function destroySession() {
  sessionStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
  sessionStorage.removeItem(AUTH_CONFIG.USER_KEY);
}

// --- Login API Call ---
async function attemptLogin(identifier, password) {
  try {
    const response = await fetch(`${AUTH_CONFIG.API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Login gagal. Periksa kembali username/email dan password Anda.'
      };
    }

    saveSession(data.user, data.token);
    return { success: true, session: data.user };
  } catch (err) {
    console.error('Login error:', err);
    return {
      success: false,
      error: 'Tidak dapat terhubung ke Backend Server (http://localhost:3000).'
    };
  }
}

// --- Self Registration API Call ---
async function attemptRegister(username, email, password, displayName) {
  try {
    const response = await fetch(`${AUTH_CONFIG.API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, displayName })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Registrasi gagal. Periksa kembali data Anda.'
      };
    }

    saveSession(data.user, data.token);
    return { success: true, session: data.user };
  } catch (err) {
    console.error('Register error:', err);
    return {
      success: false,
      error: 'Tidak dapat terhubung ke Backend Server (http://localhost:3000).'
    };
  }
}

// --- Logout ---
function logout() {
  const session = getSession();
  destroySession();
  return session;
}

// --- API Helper dengan Authorization Header ---
async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401 || response.status === 403) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      destroySession();
      // Show session timeout toast
      const toast = document.getElementById('sessionToast');
      if (toast) { toast.classList.add('visible'); }
      setTimeout(() => { location.reload(); }, 2000);
    }
    throw new Error(errorData.error || 'Akses ditolak.');
  }

  return response.json();
}

// --- Role Check Helpers ---
function canExportPDF() {
  const session = getSession();
  return !!session;
}

function canManageUsers() {
  const session = getSession();
  return session && (session.role === 'Admin' || session.role === 'Supervisor');
}

function canViewAuditLog() {
  const session = getSession();
  return session && session.role === 'Admin';
}
