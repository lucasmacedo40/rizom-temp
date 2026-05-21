import { createContext } from 'react';
import type { Usuario } from '../api';

export interface AuthCtx {
  usuario: Usuario | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthCtx | null>(null);
