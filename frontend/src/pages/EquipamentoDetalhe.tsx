// src/pages/EquipamentoDetalhe.tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, RefreshCw, Plus, Wifi } from 'lucide-react';
import ModalConfigurarDispositivo from '../components/ModalConfigurarDispositivo';
import { equipamentosApi, leiturasApi } from '../api';
import type { Equipamento, PontoGrafico } from '../api';

const HORAS_OPCOES = [6, 12, 24, 48, 72];

export default function EquipamentoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [equip, setEquip] = useState<Equipamento | null>(null);
  const [dados, setDados] = useState<PontoGrafico[]>([]);
  const [limites, setLimites] = useState({ min: 0, max: 10 });
  const [horas, setHoras] = useState(24);
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const [tempManual, setTempManual] = useState('');
  const [obsManual, setObsManual] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [showConfigurar, setShowConfigurar] = useState(false);

  const carregar = useCallback(async () => {
    if (!id) return;
    const [eRes, gRes] = await Promise.all([
      equipamentosApi.buscar(id),
      leiturasApi.grafico(id, horas),
    ]);
    setEquip(eRes.data);
    setDados(gRes.data.dados);
    setLimites(gRes.data.limites);
    setLoading(false);
  }, [id, horas]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const interval = setInterval(carregar, 60000);
    return () => clearInterval(interval);
  }, [carregar]);

  async function registrarManual() {
    if (!id || !tempManual) return;
    setSalvando(true);
    try {
      await leiturasApi.registrarManual({
        equipamento_id: id,
        temperatura: parseFloat(tempManual),
        observacao: obsManual,
      });
      setShowManual(false);
      setTempManual('');
      setObsManual('');
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  const formatarX = (minuto: string) => {
    try { return format(parseISO(minuto), 'HH:mm'); } catch { return ''; }
  };

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 14px', fontSize: 12,
      }}>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
          {label ? formatarX(label) : ''}
        </div>
        {payload.map((p) => (
          <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
            {p.name}: {Number(p.value).toFixed(1)}°C
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ color: 'var(--text-secondary)' }}>Carregando...</div>
    </div>
  );

  if (!equip) return <div>Equipamento não encontrado.</div>;

  const ultimaTemp = equip.ultima_temperatura;
  const statusCor = equip.status === 'ok' ? 'var(--ok)'
    : equip.status === 'alerta' ? 'var(--danger)'
    : 'var(--offline)';

  const totalLeituras = dados.length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{equip.nome}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {equip.localizacao || 'Sem localização'} · {equip.device_id}
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowConfigurar(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 10, padding: '8px 14px', fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <Wifi size={13} /> Configurar dispositivo
          </button>
          <button
            onClick={() => setShowManual(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 10, padding: '8px 14px', fontSize: 13,
            }}
          >
            <Plus size={13} /> Registro manual
          </button>
          <button
            onClick={carregar}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--rizom-blue)', color: 'white',
              borderRadius: 10, padding: '8px 14px', fontSize: 13,
            }}
          >
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '20px 24px',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Temperatura atual</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 40, fontWeight: 400, color: statusCor }}>
            {ultimaTemp != null ? `${Number(ultimaTemp).toFixed(1)}°C` : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            Faixa: {equip.temp_min}°C a {equip.temp_max}°C
          </div>
        </div>

        {([
          { label: 'Mínima no período', val: dados.length ? Math.min(...dados.map((d: PontoGrafico) => Number(d.minima))).toFixed(1) + '°C' : '—' },
          { label: 'Máxima no período', val: dados.length ? Math.max(...dados.map((d: PontoGrafico) => Number(d.maxima))).toFixed(1) + '°C' : '—' },
          { label: 'Períodos registrados', val: totalLeituras },
        ] as { label: string; val: string | number }[]).map(({ label, val }) => (
          <div key={label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
            <div style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 700 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Gráfico */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 24, marginBottom: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Histórico de temperatura</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {HORAS_OPCOES.map(h => (
              <button
                key={h}
                onClick={() => setHoras(h)}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12,
                  background: horas === h ? 'var(--rizom-blue)' : 'var(--surface-2)',
                  color: horas === h ? 'white' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  transition: 'all .15s',
                }}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dados} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="minuto"
              tickFormatter={formatarX}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              stroke="var(--border)"
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[limites.min - 3, limites.max + 3]}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              stroke="var(--border)"
              tickFormatter={(v: number) => `${v}°`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
            <ReferenceLine y={limites.max} stroke="var(--danger)" strokeDasharray="6 3" strokeWidth={1}
              label={{ value: `Máx ${limites.max}°C`, fill: 'var(--danger)', fontSize: 10, position: 'insideTopRight' }} />
            <ReferenceLine y={limites.min} stroke="var(--alerta)" strokeDasharray="6 3" strokeWidth={1}
              label={{ value: `Mín ${limites.min}°C`, fill: 'var(--alerta)', fontSize: 10, position: 'insideBottomRight' }} />
            <Line type="monotone" dataKey="media" name="Média" dot={false}
              stroke="var(--rizom-blue)" strokeWidth={2} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="maxima" name="Máx" dot={false}
              stroke="var(--danger)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <Line type="monotone" dataKey="minima" name="Mín" dot={false}
              stroke="var(--alerta)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Modal registro manual */}
      {showManual && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setShowManual(false)}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 20, padding: 28, width: 360,
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'Syne', marginBottom: 20 }}>Registro manual</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Temperatura (°C)
              </label>
              <input type="number" step="0.1" value={tempManual}
                onChange={e => setTempManual(e.target.value)} autoFocus
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 15,
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Observação (opcional)
              </label>
              <input type="text" value={obsManual}
                onChange={e => setObsManual(e.target.value)}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 14,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowManual(false)} style={{
                flex: 1, padding: '11px', borderRadius: 10,
                background: 'var(--surface-2)', color: 'var(--text-secondary)', fontSize: 14,
              }}>Cancelar</button>
              <button onClick={registrarManual} disabled={!tempManual || salvando} style={{
                flex: 1, padding: '11px', borderRadius: 10,
                background: 'var(--rizom-blue)', color: 'white', fontSize: 14,
                opacity: (!tempManual || salvando) ? 0.6 : 1,
              }}>
                {salvando ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigurar && equip && (
        <ModalConfigurarDispositivo
          equipamentoId={equip.id}
          onFechar={() => setShowConfigurar(false)}
        />
      )}
    </div>
  );
}
