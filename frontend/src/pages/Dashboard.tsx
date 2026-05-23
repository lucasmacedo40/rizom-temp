// src/pages/Dashboard.tsx
import { useEffect, useState, useCallback } from 'react';
import { equipamentosApi, relatoriosApi, alertasApi } from '../api';
import type { Equipamento, Resumo, Alerta } from '../api';
import { useAuth } from '../contexts/useAuth';
import EquipamentoCard from '../components/EquipamentoCard';
import { AlertTriangle, Thermometer, Activity, Bell, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function MetricCard({
  label, value, sub, cor = 'var(--rizom-blue)', icon: Icon,
}: {
  label: string; value: string | number; sub?: string;
  cor?: string; icon: React.FC<{ size?: number; color?: string }>;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
        <Icon size={18} color={cor} />
      </div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: cor }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { usuario } = useAuth();
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date());

  const carregar = useCallback(async () => {
    try {
      const [eRes, rRes, aRes] = await Promise.all([
        equipamentosApi.listar(),
        relatoriosApi.resumo(),
        alertasApi.listar(false),
      ]);
      setEquipamentos(eRes.data);
      setResumo(rRes.data);
      setAlertas(aRes.data.slice(0, 5));
      setUltimaAtualizacao(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const interval = setInterval(carregar, 60000); // atualiza a cada 1min
    return () => clearInterval(interval);
  }, [carregar]);

  const totalOk = equipamentos.filter(e => e.status === 'ok').length;
  const totalAlerta = equipamentos.filter(e => e.status === 'alerta').length;
  const totalOffline = equipamentos.filter(e => e.status === 'offline').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Carregando...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Bom dia, {usuario?.nome.split(' ')[0]}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {usuario?.cliente_nome} · Monitoramento em tempo real
          </p>
        </div>
        <button
          onClick={carregar}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 14px', fontSize: 13,
          }}
        >
          <RefreshCw size={13} />
          Atualizar
        </button>
      </div>

      {/* Métricas */}
      {resumo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
          <MetricCard
            label="Equipamentos"
            value={resumo.total_equipamentos}
            sub={`${totalOk} normais · ${totalOffline} offline`}
            icon={Thermometer}
          />
          <MetricCard
            label="Em conformidade"
            value={resumo.total_equipamentos > 0
              ? `${Math.round((totalOk / resumo.total_equipamentos) * 100)}%`
              : '—'}
            sub="últimas 24 horas"
            cor="var(--ok)"
            icon={Activity}
          />
          <MetricCard
            label="Leituras hoje"
            value={resumo.leituras_24h}
            sub={`${resumo.alertas_24h} fora do limite`}
            cor="var(--rizom-iris)"
            icon={Activity}
          />
          <MetricCard
            label="Alertas abertos"
            value={resumo.alertas_nao_reconhecidos}
            sub={totalAlerta > 0 ? `${totalAlerta} equipamento(s) em alerta` : 'Tudo normal'}
            cor={resumo.alertas_nao_reconhecidos > 0 ? 'var(--danger)' : 'var(--ok)'}
            icon={Bell}
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        {/* Grid de equipamentos */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Equipamentos</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Atualizado {formatDistanceToNow(ultimaAtualizacao, { locale: ptBR, addSuffix: true })}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {equipamentos.map(e => <EquipamentoCard key={e.id} equip={e} />)}
            {equipamentos.length === 0 && (
              <div style={{
                gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px',
                color: 'var(--text-muted)', fontSize: 14,
              }}>
                Nenhum equipamento cadastrado ainda.
              </div>
            )}
          </div>
        </div>

        {/* Painel de alertas recentes */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Alertas recentes</h2>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            {alertas.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                Nenhum alerta aberto ✓
              </div>
            ) : (
              alertas.map((a, i) => (
                <div key={a.id} style={{
                  padding: '14px 16px',
                  borderBottom: i < alertas.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <AlertTriangle size={14} color="var(--alerta)" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{a.equipamento_nome}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.mensagem}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {formatDistanceToNow(new Date(a.criado_em), { locale: ptBR, addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
