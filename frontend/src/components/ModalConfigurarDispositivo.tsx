import { useCallback, useEffect, useState } from 'react';
import { Wifi, Copy, CheckCircle } from 'lucide-react';
import { equipamentosApi } from '../api';

interface Props {
  equipamentoId: string;
  onFechar: () => void;
}

const PASSOS = [
  'Ligue o dispositivo e aguarde a rede Wi-Fi "RizomTemp-..." aparecer.',
  'Conecte seu celular nessa rede Wi-Fi.',
  'Abra o navegador e acesse 192.168.4.1.',
  'Selecione sua rede, digite a senha e cole o Device ID abaixo.',
];

export default function ModalConfigurarDispositivo({ equipamentoId, onFechar }: Props) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data } = await equipamentosApi.configDispositivo(equipamentoId);
      setDeviceId(data.device_id);
    } catch {
      setErro('Não foi possível carregar o Device ID. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [equipamentoId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function copiar() {
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard indisponível
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
      onClick={onFechar}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 28, width: 440,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wifi size={18} /> Configurar dispositivo
          </h3>
          <button
            onClick={onFechar}
            style={{ background: 'none', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        {/* Passos */}
        <div style={{ marginBottom: 20 }}>
          {PASSOS.map((passo, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: 'var(--rizom-blue)',
                color: 'white', fontSize: 11, fontWeight: 700, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {i + 1}
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{passo}</span>
            </div>
          ))}
        </div>

        {/* Device ID */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
            Carregando...
          </div>
        ) : erro ? (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: 16, textAlign: 'center',
            color: '#ef4444', fontSize: 14, marginBottom: 12,
          }}>
            {erro}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={carregar}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 13,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{
              background: 'var(--surface-2)', border: '2px solid var(--rizom-blue)',
              borderRadius: 8, padding: '16px 20px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Device ID
              </div>
              <div style={{
                fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)', wordBreak: 'break-all',
              }}>
                {deviceId}
              </div>
            </div>

            <button
              onClick={copiar}
              style={{
                width: '100%', padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: copiado ? 'rgba(5,150,105,0.1)' : 'var(--surface-2)',
                border: `1px solid ${copiado ? '#059669' : 'var(--border)'}`,
                color: copiado ? '#059669' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer',
              }}
            >
              {copiado
                ? <><CheckCircle size={14} /> Copiado!</>
                : <><Copy size={14} /> Copiar Device ID</>
              }
            </button>
          </>
        )}
      </div>
    </div>
  );
}
