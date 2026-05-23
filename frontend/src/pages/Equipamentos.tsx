// src/pages/Equipamentos.tsx
import { useEffect, useState } from 'react';
import { equipamentosApi } from '../api';
import type { Equipamento } from '../api';
import EquipamentoCard from '../components/EquipamentoCard';
import { Plus, X } from 'lucide-react';
import ModalConfigurarDispositivo from '../components/ModalConfigurarDispositivo';

const TIPOS = [
  { value: 'camara_fria', label: 'Câmara Fria', limites: '-18°C a -15°C' },
  { value: 'freezer', label: 'Freezer', limites: '-18°C a -10°C' },
  { value: 'refrigerador', label: 'Refrigerador', limites: '0°C a 5°C' },
  { value: 'expositor', label: 'Expositor', limites: '0°C a 10°C' },
  { value: 'outro', label: 'Outro', limites: '—' },
];

type FormEquipamento = {
  nome: string;
  tipo: string;
  localizacao: string;
};

const CAMPOS_TEXTO: Array<{
  label: string;
  key: keyof Pick<FormEquipamento, 'nome' | 'localizacao'>;
  placeholder: string;
}> = [
  { label: 'Nome do equipamento *', key: 'nome', placeholder: 'Ex: Câmara Fria 1' },
  { label: 'Localização', key: 'localizacao', placeholder: 'Ex: Cozinha - fundo esquerdo' },
];

export default function Equipamentos() {
  const [lista, setLista] = useState<Equipamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormEquipamento>({ nome: '', tipo: 'refrigerador', localizacao: '' });
  const [salvando, setSalvando] = useState(false);
  const [equipCriado, setEquipCriado] = useState<string | null>(null);

  async function carregar() {
    const { data } = await equipamentosApi.listar();
    setLista(data);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!form.nome) return;
    setSalvando(true);
    try {
      const { data } = await equipamentosApi.criar(form as Partial<Equipamento>);
      setShowModal(false);
      setForm({ nome: '', tipo: 'refrigerador', localizacao: '' });
      setEquipCriado(data.id);
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  const tipoSel = TIPOS.find(t => t.value === form.tipo);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Equipamentos</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {lista.length} equipamento(s) monitorado(s)
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--rizom-blue)', color: 'white',
            borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 500,
          }}
        >
          <Plus size={16} /> Adicionar equipamento
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', padding: '40px 0' }}>Carregando...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {lista.map(e => <EquipamentoCard key={e.id} equip={e} />)}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setShowModal(false)}>
          <div
            className="modal-inner"
            style={{ width: 420 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
              <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: 17 }}>Novo equipamento</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {CAMPOS_TEXTO.map(({ label, key, placeholder }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  {label}
                </label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 14,
                  }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Tipo de equipamento
              </label>
              <select
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 14,
                }}
              >
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {tipoSel && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(26,110,255,0.08)', fontSize: 12, color: 'var(--rizom-iris)',
                }}>
                  Limites ANVISA padrão: {tipoSel.limites}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1, padding: '11px', borderRadius: 8,
                  background: 'var(--surface-2)', color: 'var(--text-secondary)', fontSize: 14,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={criar} disabled={!form.nome || salvando}
                style={{
                  flex: 1, padding: '11px', borderRadius: 8, fontWeight: 500,
                  background: 'var(--rizom-blue)', color: 'white', fontSize: 14,
                  opacity: (!form.nome || salvando) ? 0.6 : 1,
                }}
              >
                {salvando ? 'Criando...' : 'Criar equipamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {equipCriado && (
        <ModalConfigurarDispositivo
          equipamentoId={equipCriado}
          onFechar={() => setEquipCriado(null)}
        />
      )}
    </div>
  );
}
