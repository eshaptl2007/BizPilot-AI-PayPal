import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, token } from './api.js';
import { setCurrency } from './format.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: !!token.get(), user: null, business: null });

  const refresh = useCallback(async () => {
    if (!token.get()) return setState({ loading: false, user: null, business: null });
    try {
      const me = await api('/auth/me');
      setCurrency(me.business.currency); // before state update, so first render already uses it
      setState({ loading: false, ...me });
    } catch {
      token.set(null);
      setState({ loading: false, user: null, business: null });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); token.set(r.token); await refresh(); };
  const register = async (body) => { const r = await api('/auth/register', { method: 'POST', body }); token.set(r.token); await refresh(); };
  const logout = () => { token.set(null); setState({ loading: false, user: null, business: null }); };

  return <AuthContext.Provider value={{ ...state, login, register, logout, refresh }}>{children}</AuthContext.Provider>;
}
