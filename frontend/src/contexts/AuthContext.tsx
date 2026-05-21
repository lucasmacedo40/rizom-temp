import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../api';
import type { Usuario } from '../api';
import { AuthContext } from './authContextCore';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('token')));

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    authApi.me()
      .then(r => setUsuario(r.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, senha: string) {
    const { data } = await authApi.login(email, senha);
    localStorage.setItem('token', data.token);
    setUsuario(data.usuario);
  }

  function logout() {
    localStorage.removeItem('token');
    setUsuario(null);
  }

  return (
    <AuthContext.Provider value={{ usuario, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
