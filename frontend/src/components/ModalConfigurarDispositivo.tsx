// src/components/ModalConfigurarDispositivo.tsx
import { useCallback, useEffect, useState } from 'react';
import { Wifi, Copy, RefreshCw, CheckCircle } from 'lucide-react';
import { equipamentosApi } from '../api';
import type { CodigoPareamento } from '../api';

interface Props {
  equipamentoId: string;
  onFechar: () => void;
}

export default function ModalConfigurarDispositivo({ equipamentoId, onFechar }: Props) {
  const [par, setPar] = useState<CodigoPareamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [segundosRestantes, setSegundosRestantes] = useState(600);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gerarCodigo = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data } = await equipamentosApi.gerarCodigo(equipamentoId);
      setPar(data);
      const expiresAt = new Date(data.expira_em).getTime();
      setSegundosRestantes(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    } catch {
      setErro('Não foi possível gerar o código. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [equipamentoId]);

  useEffect(() => { gerarCodigo(); }, [gerarCodigo]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSegundosRestantes(s => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function copiar() {
    if (!par) return;
    try {
      await navigator.clipboard.writeText(par.codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  const minutos = String(Math.floor(segundosRestantes / 60)).padStart(2, '0');
  const segundos = String(segundosRestantes % 60).padStart(2, '0');
  const expirado = segundosRestantes === 0;

  const passos = [
    'Ligue o ESP32-C3 — LED piscará rápido',
    'Conecte seu celular no Wi-Fi "RizomTemp-XXXXXX"',
    'Acesse 192.168.4.1 no navegador',
    'Digite sua senha Wi-Fi e o código abaixo',
  ];

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

        {/* Steps */}
        <div style={{ marginBottom: 20 }}>
          {passos.map((passo, i) => (
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

        {/* Code block */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
            Gerando código...
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
                onClick={gerarCodigo}
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
              background: 'var(--surface-2)',
              border: `2px solid ${expirado ? '#ef4444' : 'var(--rizom-blue)'}`,
              borderRadius: 8, padding: '20px', textAlign: 'center', marginBottom: 12,
            }}>
              <div style={{
                fontSize: 48, fontWeight: 800, letterSpacing: 0,
                fontFamily: 'var(--font-mono)',
                color: expirado ? '#ef4444' : 'var(--text-primary)',
                marginBottom: 8,
              }}>
                {par?.codigo.split('').join(' ')}
              </div>
              <div style={{ fontSize: 12, color: expirado ? '#ef4444' : 'var(--text-muted)' }}>
                {expirado ? 'Código expirado' : `expira em ${minutos}:${segundos}`}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copiar}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: copiado ? 'rgba(5,150,105,0.1)' : 'var(--surface-2)',
                  border: `1px solid ${copiado ? '#059669' : 'var(--border)'}`,
                  color: copiado ? '#059669' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  cursor: 'pointer',
                }}
              >
                {copiado
                  ? <><CheckCircle size={14} /> Copiado!</>
                  : <><Copy size={14} /> Copiar código</>
                }
              </button>
              <button
                onClick={gerarCodigo}
                disabled={loading}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <RefreshCw size={14} /> Gerar novo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
