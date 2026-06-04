import { useEffect, useState } from 'react';
import { equipamentosApi, relatoriosApi } from '../api';
import type { Equipamento } from '../api';
import { AlertCircle, Download, FileText } from 'lucide-react';
import { format, subDays } from 'date-fns';

type Granularidade = 'raw' | '1h' | '3h' | 'diaria';

const GRANULARIDADES: { value: Granularidade; label: string; hint: string; warn?: boolean }[] = [
  { value: 'raw',    label: 'Todas',      hint: '~8.640 pts/mês', warn: true },
  { value: '1h',     label: 'A cada 1h',  hint: '~720 pts/mês' },
  { value: '3h',     label: 'A cada 3h',  hint: '~240 pts/mês' },
  { value: 'diaria', label: 'Diária',     hint: '~30 pts/mês' },
];

export default function Relatorios() {
  const [periodoTipo, setPeriodoTipo]   = useState<'mes' | 'semana'>('mes');
  const [mes, setMes]                   = useState(format(new Date(), 'yyyy-MM'));
  const [granularidade, setGranularidade] = useState<Granularidade>('3h');
  const [equipamentoId, setEquipamentoId] = useState('');
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [gerando, setGerando]           = useState(false);
  const [carregando, setCarregando]     = useState(true);
  const [erro, setErro]                 = useState('');

  useEffect(() => {
    equipamentosApi.listar()
      .then(({ data }) => setEquipamentos(data))
      .catch(() => setErro('Não foi possível carregar os equipamentos. O relatório geral ainda pode ser gerado.'))
      .finally(() => setCarregando(false));
  }, []);

  async function gerarPDF() {
    setGerando(true);
    setErro('');
    try {
      const periodo = periodoTipo === 'semana' ? 'semana' : mes;
      const { data } = await relatoriosApi.mensal(periodo, equipamentoId || undefined, granularidade);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      const equip = equipamentos.find(e => e.id === equipamentoId);
      const sufixo = equip ? `-${equip.nome.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}` : '';
      a.href     = url;
      a.download = `rizom-temp-${periodo}-${granularidade}${sufixo}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErro('Não foi possível gerar o relatório. Tente novamente em alguns instantes.');
    } finally {
      setGerando(false);
    }
  }

  const semanaInicio = format(subDays(new Date(), 7), 'dd/MM');
  const semanaFim    = format(new Date(), 'dd/MM');

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  } as const;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Relatórios</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Exporte o registro de temperaturas em PDF para uso interno ou fiscalização.
        </p>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 28, maxWidth: 520,
      }}>
        {/* Header do card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8,
            background: 'rgba(26,110,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={20} color="var(--rizom-blue)" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Relatório de temperatura</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              PDF com conformidade, gráficos e alertas por equipamento
            </div>
          </div>
        </div>

        {/* Equipamento */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Equipamento
          </label>
          <select
            value={equipamentoId}
            onChange={e => setEquipamentoId(e.target.value)}
            disabled={carregando}
            style={inputStyle}
          >
            <option value="">Todos os equipamentos (consolidado)</option>
            {equipamentos.map(eq => (
              <option key={eq.id} value={eq.id}>
                {eq.nome}{eq.localizacao ? ` — ${eq.localizacao}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Período */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Período
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {(['semana', 'mes'] as const).map(tipo => (
              <button
                key={tipo}
                onClick={() => setPeriodoTipo(tipo)}
                style={{
                  padding: '10px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  border: periodoTipo === tipo ? '2px solid var(--rizom-blue)' : '1px solid var(--border)',
                  background: periodoTipo === tipo ? 'rgba(26,110,255,0.06)' : 'var(--surface-2)',
                  color: periodoTipo === tipo ? 'var(--rizom-blue)' : 'var(--text-primary)',
                  fontWeight: periodoTipo === tipo ? 600 : 400,
                }}
              >
                {tipo === 'semana' ? `Últimos 7 dias` : 'Mês específico'}
                {tipo === 'semana' && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>
                    {semanaInicio} – {semanaFim}
                  </div>
                )}
              </button>
            ))}
          </div>
          {periodoTipo === 'mes' && (
            <input
              type="month" value={mes}
              onChange={e => setMes(e.target.value)}
              max={format(new Date(), 'yyyy-MM')}
              style={inputStyle}
            />
          )}
        </div>

        {/* Granularidade */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Granularidade dos gráficos
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
              — afeta apenas o gráfico de linha, não a conformidade
            </span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {GRANULARIDADES.map(g => (
              <button
                key={g.value}
                onClick={() => setGranularidade(g.value)}
                style={{
                  padding: '8px 6px', borderRadius: 8, fontSize: 11, cursor: 'pointer', textAlign: 'center',
                  border: granularidade === g.value ? '2px solid var(--rizom-blue)' : '1px solid var(--border)',
                  background: granularidade === g.value ? 'rgba(26,110,255,0.06)' : 'var(--surface-2)',
                  color: g.warn ? 'var(--text-muted)' : 'var(--text-primary)',
                  opacity: g.warn && granularidade !== g.value ? 0.6 : 1,
                }}
              >
                <div style={{ fontWeight: granularidade === g.value ? 700 : 500 }}>{g.label}</div>
                <div style={{ fontSize: 9, marginTop: 2, color: 'var(--text-muted)' }}>{g.hint}</div>
                {g.warn && <div style={{ fontSize: 9, color: 'var(--danger)', marginTop: 1 }}>denso</div>}
              </button>
            ))}
          </div>
        </div>

        {erro && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.22)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            fontSize: 12, color: 'var(--danger)',
          }}>
            <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{erro}</span>
          </div>
        )}

        <button
          onClick={gerarPDF}
          disabled={gerando || carregando}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '12px',
            background: gerando || carregando ? 'var(--surface-2)' : 'var(--rizom-blue)',
            color: 'white', borderRadius: 8, fontWeight: 500, fontSize: 15,
            opacity: gerando || carregando ? 0.7 : 1, transition: 'all .2s', cursor: 'pointer',
            border: 'none',
          }}
        >
          <Download size={16} />
          {gerando ? 'Gerando PDF...' : 'Baixar relatório PDF'}
        </button>
      </div>

      {/* Tabela de referência ANVISA */}
      <div style={{
        marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 24, maxWidth: 520,
      }}>
        <h3 style={{ fontSize: 14, marginBottom: 16 }}>
          Faixas de temperatura ANVISA RDC 216/2004
        </h3>
        {[
          ['Câmara fria / Freezer', '-18°C a -15°C'],
          ['Refrigerador', '0°C a 5°C'],
          ['Expositor de frios', '0°C a 10°C'],
          ['Expositor de quentes', 'acima de 60°C'],
        ].map(([tipo, faixa]) => (
          <div key={tipo} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{tipo}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--rizom-iris)' }}>{faixa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
