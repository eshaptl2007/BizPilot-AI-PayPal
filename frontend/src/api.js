const BASE = import.meta.env.VITE_API_URL || '';

const store = {
  get() { try { return localStorage.getItem('bizpilot_token'); } catch { return null; } },
  set(t) { try { t ? localStorage.setItem('bizpilot_token', t) : localStorage.removeItem('bizpilot_token'); } catch { /* private mode */ } },
};
export const token = store;

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = store.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  const down = 'Cannot reach the server. Make sure the backend is running (npm run dev inside the backend folder) and the database is connected.';
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(down);
  }
  const data = await res.json().catch(() => null);
  // no JSON body on a 5xx almost always means the proxy could not reach the API
  if (!res.ok && data === null && res.status >= 500) throw new Error(down);
  if (!res.ok) {
    if (res.status === 401 && t) { store.set(null); window.location.assign('/login'); }
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    if (data && Array.isArray(data.details)) {
      err.fields = Object.fromEntries(data.details.filter((d) => d.path).map((d) => [d.path, d.message]));
      if (!Object.keys(err.fields).length) err.fields = null;
    }
    throw err;
  }
  return data || {};
}
