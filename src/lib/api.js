import { supabase, supabaseEnabled } from './supabase';

const API = import.meta.env.VITE_SENTINEL_API_URL || 'http://localhost:8000';
const DEMO_AUTH = String(import.meta.env.VITE_DEMO_AUTH ?? 'true').toLowerCase() === 'true';
const SESSION_KEY = 'sentinel_session_v5';
let session = localStorage.getItem(SESSION_KEY) || '';

export function getSession() { return session; }
export function setSession(value) {
  session = value || '';
  if (session) localStorage.setItem(SESSION_KEY, session);
  else localStorage.removeItem(SESSION_KEY);
}

function toBackendRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'officer' || value === 'welfare_officer' || value === 'welfare-officer' || value === 'welfare officer') return 'officer';
  if (value === 'commander') return 'commander';
  if (value === 'personnel') return 'personnel';
  return value;
}

function toFrontendRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'officer' || value === 'welfare_officer' || value === 'welfare-officer' || value === 'welfare officer') return 'officer';
  if (value === 'commander') return 'commander';
  if (value === 'personnel') return 'personnel';
  return value;
}

async function accessToken() {
  if (!supabaseEnabled || !supabase) return '';
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  } catch {
    return '';
  }
}

async function request(path, payload, method = 'POST') {
  const token = await accessToken();
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (session) headers['X-Sentinel-Session'] = session;

  const options = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload ?? {});
  }

  let response;
  try {
    response = await fetch(`${API}${path}`, options);
  } catch {
    throw new Error(`Unable to connect to Sentinel Pulse backend at ${API}. Start FastAPI on port 8000.`);
  }

  let body = null;
  try { body = await response.json(); } catch { body = null; }

  if (!response.ok) {
    throw new Error(body?.detail || body?.message || `Request failed (${response.status})`);
  }
  return body;
}

export async function login(role, username, password) {
  if (DEMO_AUTH || !supabaseEnabled) {
    const backendRole = toBackendRole(role);
    const data = await request('/auth/demo', { role: backendRole, username: String(username || '').trim(), password: String(password || '') });
    if (!data?.session) throw new Error('Login succeeded but no session was returned.');
    setSession(data.session);
    return { ...data, role: toFrontendRole(data?.role || backendRole), username: username || '', display_name: data?.display_name || data?.name || 'Sentinel Pulse User' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: String(username || '').trim(), password: String(password || '') });
  if (error) throw error;
  const profile = await me();
  return { ...profile, session: data.session };
}

export async function logout() {
  if (supabaseEnabled && supabase) {
    try { await supabase.auth.signOut(); } catch { /* local session still clears */ }
  }
  setSession('');
}

export async function me() {
  const data = await request('/auth/me', undefined, 'GET');
  if (!data) return null;
  return { ...data, role: toFrontendRole(data.role), username: data.username || data.email || '', display_name: data.display_name || data.name || 'Sentinel Pulse User' };
}

export async function health() {
  try {
    const response = await fetch(`${API}/health`);
    return response.ok ? await response.json() : { status: 'offline' };
  } catch {
    return { status: 'offline' };
  }
}

export const predict = (payload) => request('/predict', payload);
export const trajectory = (payload) => request('/trajectory', payload);
export const whatIf = (payload) => request('/what-if', payload);
export const welfareSummary = () => request('/welfare/summary', undefined, 'GET');
export const welfareCases = () => request('/welfare/cases', undefined, 'GET');
export const evaluateCase = (payload) => request('/welfare/cases/evaluate', payload);
export const getCase = (caseId) => request(`/welfare/cases/${encodeURIComponent(caseId)}`, undefined, 'GET');
export const reviewCase = (caseId, payload) => request(`/welfare/cases/${encodeURIComponent(caseId)}/review`, payload);
export const createIntervention = (caseId, payload) => request(`/welfare/cases/${encodeURIComponent(caseId)}/intervention`, payload);
export const completeFollowUp = (caseId) => request(`/welfare/cases/${encodeURIComponent(caseId)}/follow-up`, {}, 'POST');
export const welfareAlerts = () => request('/welfare/alerts', undefined, 'GET');
export const reviewAlert = (alertId, status = 'ACKNOWLEDGED') => request(`/welfare/alerts/${encodeURIComponent(alertId)}/review`, { status });
export const hrms = (token) => request(`/hrms/personnel/${encodeURIComponent(token)}`, undefined, 'GET');
export const secureSync = (payload) => request('/records/sync', payload);
export const audit = () => request('/audit/summary', undefined, 'GET');
export const getConsent = () => request('/privacy/consent', undefined, 'GET');
export const setConsent = (payload) => request('/privacy/consent', payload);
export const eraseRequest = () => request('/privacy/erase-request', {});
export const modelInfo = () => request('/model/info', undefined, 'GET');

export function getApiBaseUrl() { return API; }
export function isDemoAuthEnabled() { return DEMO_AUTH; }
export function isSupabaseEnabled() { return supabaseEnabled; }
