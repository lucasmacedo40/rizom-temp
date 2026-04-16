// src/api.ts
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StatusEquip = 'ok' | 'alerta' | 'offline' | 'sem_dados';
export type TipoEquip = 'camara_fria' | 'freezer' | 'refrigerador' | 'expositor' | 'outro';

export interface Equipamento {
  id: string;
  nome: string;
  tipo: TipoEquip;
  localizacao?: string;
  temp_min: number;
  temp_max: number;
  device_id: string;
  status: StatusEquip;
  ultima_temperatura?: number;
  ultima_leitura_em?: string;
  ultimo_heartbeat?: string;
}

export interface PontoGrafico {
  minuto: string;
  media: number;
  minima: number;
  maxima: number;
  tudo_ok: boolean;
  leituras: number;
}

export interface DadosGrafico {
  dados: PontoGrafico[];
  limites: { min: number; max: number };
}

export interface Alerta {
  id: string;
  tipo: string;
  temperatura?: number;
  mensagem: string;
  notificado: boolean;
  reconhecido: boolean;
  criado_em: string;
  equipamento_nome: string;
}

export interface CodigoPareamento {
  codigo: string;
  expira_em: string;
}

export interface Resumo {
  total_equipamentos: number;
  leituras_24h: number;
  alertas_24h: number;
  alertas_nao_reconhecidos: number;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  cliente_nome: string;
  plano: string;
}

// ─── Chamadas de API ─────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, senha: string) =>
    api.post<{ token: string; usuario: Usuario }>('/auth/login', { email, senha }),
  me: () => api.get<Usuario>('/auth/me'),
};

export const equipamentosApi = {
  listar: () => api.get<Equipamento[]>('/equipamentos'),
  buscar: (id: string) => api.get<Equipamento>(`/equipamentos/${id}`),
  criar: (dados: Partial<Equipamento>) => api.post<Equipamento>('/equipamentos', dados),
  atualizar: (id: string, dados: Partial<Equipamento>) =>
    api.patch<Equipamento>(`/equipamentos/${id}`, dados),
  configDispositivo: (id: string) => api.get(`/equipamentos/${id}/config-dispositivo`),
  gerarCodigo: (id: string) =>
    api.post<CodigoPareamento>(`/equipamentos/${id}/pareamento`),
};

export const leiturasApi = {
  grafico: (equipamento_id: string, horas = 24) =>
    api.get<DadosGrafico>('/leituras/grafico', { params: { equipamento_id, horas } }),
  historico: (params: Record<string, unknown>) =>
    api.get('/leituras', { params }),
  registrarManual: (dados: { equipamento_id: string; temperatura: number; observacao?: string }) =>
    api.post('/leituras/manual', dados),
};

export const alertasApi = {
  listar: (reconhecido?: boolean) =>
    api.get<Alerta[]>('/alertas', { params: reconhecido !== undefined ? { reconhecido } : {} }),
  reconhecer: (id: string) => api.patch(`/alertas/${id}/reconhecer`),
};

export const relatoriosApi = {
  resumo: () => api.get<Resumo>('/relatorios/resumo'),
  mensal: (mes: string, equipamento_id?: string) =>
    api.get('/relatorios/mensal', {
      params: { mes, equipamento_id },
      responseType: 'blob',
    }),
};
