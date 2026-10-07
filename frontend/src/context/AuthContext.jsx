import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch('/api/auth/me', { method: 'GET' });
        if (me && me.id) setUser(me);
      } catch (_) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(username, password) {
    const u = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setUser(u);
    return u;
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  function updateUser(usuario) {
    setUser(usuario);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
