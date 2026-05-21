// src/pages/Relatorios.tsx
import { useState } from 'react';
import { relatoriosApi } from '../api';
import { FileText, Download } from 'lucide-react';
import { format } from 'date-fns';

export default function Relatorios() {
  const [mes, setMes] = useState(format(new Date(), 'yyyy-MM'));
  const [gerando, setGerando] = useState(false);

  async function gerarPDF() {
    setGerando(true);
    try {
      const { data } = await relatoriosApi.mensal(mes);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `rizom-temp-${mes}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGerando(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Relatórios</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Exporte o registro de temperaturas para a Vigilância Sanitária (ANVISA RDC 216/2004)
        </p>
      </div>

      {/* Card de geração */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 28, maxWidth: 480,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8,
            background: 'rgba(26,110,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={20} color="var(--rizom-blue)" />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15 }}>Relatório mensal</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>PDF com histórico completo de temperaturas</div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Selecionar mês
          </label>
          <input
            type="month" value={mes}
            onChange={e => setMes(e.target.value)}
            max={format(new Date(), 'yyyy-MM')}
            style={{
              padding: '11px 14px', borderRadius: 8, fontSize: 14,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div style={{
          background: 'rgba(26,110,255,0.06)', borderRadius: 8,
          padding: '12px 16px', marginBottom: 20, fontSize: 12,
          color: 'var(--text-secondary)',
        }}>
          O relatório inclui: histórico de temperaturas, médias, máximas e mínimas por equipamento,
          índice de conformidade, alertas gerados e registro para auditoria da Vigilância Sanitária.
        </div>

        <button
          onClick={gerarPDF} disabled={gerando}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '12px',
            background: gerando ? 'var(--surface-2)' : 'var(--rizom-blue)',
            color: 'white', borderRadius: 8, fontWeight: 500, fontSize: 15,
            opacity: gerando ? 0.7 : 1, transition: 'all .2s',
          }}
        >
          <Download size={16} />
          {gerando ? 'Gerando PDF...' : 'Baixar relatório PDF'}
        </button>
      </div>

      {/* Info ANVISA */}
      <div style={{
        marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 24, maxWidth: 480,
      }}>
        <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: 14, marginBottom: 16 }}>
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
            padding: '8px 0',
            borderBottom: '1px solid var(--border)',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{tipo}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--rizom-iris)' }}>{faixa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
