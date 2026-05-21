// src/pages/Alertas.tsx
import { useCallback, useEffect, useState } from 'react';
import { alertasApi } from '../api';
import type { Alerta } from '../api';
import { AlertTriangle, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TIPO_PT: Record<string, string> = {
  temp_acima: 'Temperatura alta',
  temp_abaixo: 'Temperatura baixa',
  sem_sinal: 'Sem sinal',
  dispositivo_offline: 'Dispositivo offline',
};

export default function Alertas() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'abertos' | 'todos'>('abertos');
  const [reconhecendo, setReconhecendo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await alertasApi.listar(filtro === 'abertos' ? false : undefined);
    setAlertas(data);
    setLoading(false);
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function reconhecer(id: string) {
    setReconhecendo(id);
    try {
      await alertasApi.reconhecer(id);
      carregar();
    } finally {
      setReconhecendo(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Alertas</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {alertas.length} alerta(s) {filtro === 'abertos' ? 'não reconhecidos' : 'no total'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['abertos', 'todos'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13,
                background: filtro === f ? 'var(--rizom-blue)' : 'var(--surface)',
                color: filtro === f ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {f === 'abertos' ? 'Abertos' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', padding: '40px 0' }}>Carregando...</div>
      ) : alertas.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 20px',
          color: 'var(--text-muted)', fontSize: 15,
        }}>
          <Check size={40} color="var(--ok)" style={{ margin: '0 auto 16px' }} />
          <div>Nenhum alerta {filtro === 'abertos' ? 'aberto' : 'registrado'}</div>
        </div>
      ) : (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden',
        }}>
          {alertas.map((a, i) => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '16px 20px',
              borderBottom: i < alertas.length - 1 ? '1px solid var(--border)' : 'none',
              opacity: a.reconhecido ? 0.5 : 1,
            }}>
              <AlertTriangle size={18} color={a.reconhecido ? 'var(--text-muted)' : 'var(--alerta)'} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{a.equipamento_nome}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 6,
                    background: 'var(--alerta-bg)', color: 'var(--alerta)',
                  }}>
                    {TIPO_PT[a.tipo] || a.tipo}
                  </span>
                  {a.temperatura && (
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>
                      {Number(a.temperatura).toFixed(1)}°C
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{a.mensagem}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {format(new Date(a.criado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  {a.reconhecido && ' · Reconhecido'}
                </div>
              </div>
              {!a.reconhecido && (
                <button
                  onClick={() => reconhecer(a.id)}
                  disabled={reconhecendo === a.id}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12,
                    background: 'var(--ok-bg)', color: 'var(--ok)',
                    border: '1px solid rgba(16,185,129,0.3)',
                    opacity: reconhecendo === a.id ? 0.6 : 1,
                  }}
                >
                  <Check size={13} /> Reconhecer
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
