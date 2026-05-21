// src/components/EquipamentoCard.tsx
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import type { Equipamento, StatusEquip } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TIPOS_PT: Record<string, string> = {
  camara_fria: 'Câmara Fria',
  freezer: 'Freezer',
  refrigerador: 'Refrigerador',
  expositor: 'Expositor',
  outro: 'Outro',
};

const STATUS_CONFIG: Record<StatusEquip, { cor: string; bg: string; label: string; Icon: React.FC<{ size?: number }> }> = {
  ok:       { cor: 'var(--ok)',     bg: 'var(--ok-bg)',     label: 'Normal',   Icon: CheckCircle },
  alerta:   { cor: 'var(--alerta)', bg: 'var(--alerta-bg)', label: 'Alerta',   Icon: AlertTriangle },
  offline:  { cor: 'var(--offline)',bg: 'var(--offline-bg)',label: 'Offline',  Icon: WifiOff },
  sem_dados:{ cor: 'var(--text-muted)', bg: 'var(--offline-bg)', label: 'Sem dados', Icon: Clock },
};

interface Props { equip: Equipamento; }

export default function EquipamentoCard({ equip }: Props) {
  const navigate = useNavigate();
  const { cor, bg, label, Icon } = STATUS_CONFIG[equip.status];

  const tempoStr = equip.ultima_leitura_em
    ? formatDistanceToNow(new Date(equip.ultima_leitura_em), { locale: ptBR, addSuffix: true })
    : '—';

  // Posição da temperatura na barra de gauge
  const gaugePercent = equip.ultima_temperatura !== undefined
    ? Math.max(0, Math.min(100, ((equip.ultima_temperatura - (equip.temp_min - 5)) /
        (equip.temp_max - equip.temp_min + 10)) * 100))
    : null;

  return (
    <div
      onClick={() => navigate(`/equipamentos/${equip.id}`)}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 20, cursor: 'pointer',
        transition: 'all .2s',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Faixa de status no topo */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: cor, opacity: 0.8, borderRadius: '16px 16px 0 0',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
            {equip.nome}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {TIPOS_PT[equip.tipo]} {equip.localizacao ? `· ${equip.localizacao}` : ''}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: bg, padding: '4px 10px', borderRadius: 8,
          fontSize: 12, color: cor, fontWeight: 500,
        }}>
          <Icon size={12} />
          {label}
        </div>
      </div>

      {/* Temperatura */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 400, color: cor }}>
          {equip.ultima_temperatura != null ? Number(equip.ultima_temperatura).toFixed(1) : '—'}
        </span>
        <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>°C</span>
      </div>

      {/* Barra gauge */}
      {gaugePercent !== null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            height: 4, borderRadius: 2,
            background: 'var(--surface-2)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${gaugePercent}%`, borderRadius: 2,
              background: cor, transition: 'width .5s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{equip.temp_min}°C</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{equip.temp_max}°C</span>
          </div>
        </div>
      )}

      {/* Rodapé */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tempoStr}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          {equip.status === 'offline' ? <WifiOff size={11} /> : <Wifi size={11} />}
          {equip.device_id}
        </div>
      </div>
    </div>
  );
}
