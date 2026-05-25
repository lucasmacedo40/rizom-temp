import { useEffect, useState } from 'react';
import { Building2, Users, Bell, Server, Save, Send, RefreshCw, Plus, CreditCard } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  configuracoesApi,
  billingApi,
  type ClienteConfiguracao,
  type UsuarioConfiguracao,
  type AlertasConfiguracao,
  type SistemaConfiguracao,
  type BillingStatus,
  type PlanoBilling,
  type CicloBilling,
} from '../api';
import { useAuth } from '../contexts/useAuth';

type Aba = 'empresa' | 'usuarios' | 'alertas' | 'pagamento' | 'sistema';

// ─── Componentes utilitários ──────────────────────────────────────────────────

function TabButton({
  label, aba, atual, icon: Icon, onClick,
}: {
  label: string; aba: Aba; atual: Aba;
  icon: React.FC<{ size?: number; color?: string }>;
  onClick: (a: Aba) => void;
}) {
  const active = aba === atual;
  return (
    <button
      onClick={() => onClick(aba)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: active ? 'var(--rizom-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400, fontSize: 14,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: 24, marginBottom: 16,
    }}>
      {title && (
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: 14, width: '100%', boxSizing: 'border-box',
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
      background: ok ? 'var(--ok-bg)' : 'var(--danger-bg)',
      color: ok ? 'var(--ok)' : 'var(--danger)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  );
}

function PrimaryBtn({ onClick, disabled, loading, loadingLabel, icon: Icon, children }: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: React.FC<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: 'var(--rizom-blue)', color: '#fff', fontWeight: 600, fontSize: 14,
        opacity: (disabled || loading) ? 0.6 : 1,
      }}
    >
      {Icon && <Icon size={14} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

function SecondaryBtn({ onClick, disabled, loading, loadingLabel, icon: Icon, children }: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: React.FC<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--surface)', color: 'var(--text-primary)',
        fontWeight: 600, fontSize: 14, cursor: 'pointer',
        opacity: (disabled || loading) ? 0.6 : 1,
      }}
    >
      {Icon && <Icon size={14} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

// ─── Aba Empresa ──────────────────────────────────────────────────────────────

function AbaEmpresa({
  cliente, isAdmin, onUpdate,
}: {
  cliente: ClienteConfiguracao;
  isAdmin: boolean;
  onUpdate: (c: ClienteConfiguracao) => void;
}) {
  const [form, setForm] = useState({
    nome: cliente.nome,
    cnpj: cliente.cnpj ?? '',
    email: cliente.email,
    telefone: cliente.telefone ?? '',
  });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setMsg(null);
    try {
      const { data } = await configuracoesApi.atualizarCliente({
        nome: form.nome,
        cnpj: form.cnpj || null,
        email: form.email,
        telefone: form.telefone || null,
      });
      onUpdate(data);
      setMsg({ tipo: 'ok', texto: 'Salvo com sucesso.' });
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao salvar.';
      setMsg({ tipo: 'erro', texto });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SectionCard title="Dados da empresa">
      <form onSubmit={salvar}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16, marginBottom: 20,
        }}>
          <Field label="Nome da empresa *">
            <input
              style={inputStyle} value={form.nome} required
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            />
          </Field>
          <Field label="CNPJ">
            <input
              style={inputStyle} value={form.cnpj}
              disabled={!isAdmin} placeholder="00.000.000/0001-00"
              onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))}
            />
          </Field>
          <Field label="Email de contato *">
            <input
              style={inputStyle} value={form.email} type="email" required
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Telefone">
            <input
              style={inputStyle} value={form.telefone}
              disabled={!isAdmin} placeholder="(00) 00000-0000"
              onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
            />
          </Field>
          <Field label="Plano">
            <input
              style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'default' }}
              value={cliente.plano} disabled
            />
          </Field>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PrimaryBtn loading={salvando} loadingLabel="Salvando..." icon={Save}>
              Salvar alterações
            </PrimaryBtn>
            {msg && (
              <span style={{ fontSize: 13, color: msg.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
                {msg.texto}
              </span>
            )}
          </div>
        )}
      </form>
    </SectionCard>
  );
}

// ─── Aba Usuários ─────────────────────────────────────────────────────────────

function AbaUsuarios({
  usuarios, isAdmin, onRefresh,
}: {
  usuarios: UsuarioConfiguracao[];
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { usuario: eu } = useAuth();
  const [novo, setNovo] = useState({
    nome: '', email: '', senha: '',
    perfil: 'operador' as UsuarioConfiguracao['perfil'],
  });
  const [criando, setCriando] = useState(false);
  const [msgNovo, setMsgNovo] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [acaoId, setAcaoId] = useState<string | null>(null);

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    setMsgNovo(null);
    try {
      await configuracoesApi.criarUsuario(novo);
      setNovo({ nome: '', email: '', senha: '', perfil: 'operador' });
      setMsgNovo({ tipo: 'ok', texto: 'Usuário criado com sucesso.' });
      await onRefresh();
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao criar usuário.';
      setMsgNovo({ tipo: 'erro', texto });
    } finally {
      setCriando(false);
    }
  }

  async function alterarPerfil(id: string, perfil: UsuarioConfiguracao['perfil']) {
    setAcaoId(id);
    try {
      await configuracoesApi.atualizarUsuario(id, { perfil });
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao alterar perfil.';
      alert(msg);
    } finally {
      setAcaoId(null);
    }
  }

  async function alterarAtivo(id: string, ativo: boolean) {
    setAcaoId(id);
    try {
      await configuracoesApi.atualizarUsuario(id, { ativo });
      await onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao alterar status.';
      alert(msg);
    } finally {
      setAcaoId(null);
    }
  }

  const PERFIL_LABELS: Record<string, string> = {
    admin: 'Admin', operador: 'Operador', visualizador: 'Visualizador',
  };

  return (
    <>
      <SectionCard title="Usuários">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Email', 'Perfil', 'Status', 'Último login'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '8px 12px',
                    fontWeight: 500, color: 'var(--text-secondary)', fontSize: 12,
                  }}>{h}</th>
                ))}
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: u.id === eu?.id ? 600 : 400 }}>
                    {u.nome}
                    {u.id === eu?.id && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>(você)</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {isAdmin ? (
                      <select
                        value={u.perfil}
                        disabled={acaoId === u.id}
                        onChange={e => alterarPerfil(u.id, e.target.value as UsuarioConfiguracao['perfil'])}
                        style={{ ...inputStyle, width: 'auto', padding: '4px 8px' }}
                      >
                        {(['admin', 'operador', 'visualizador'] as const).map(p => (
                          <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{PERFIL_LABELS[u.perfil]}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusPill ok={u.ativo} label={u.ativo ? 'Ativo' : 'Inativo'} />
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                    {u.ultimo_login
                      ? format(new Date(u.ultimo_login), 'dd/MM/yyyy HH:mm', { locale: ptBR })
                      : 'Nunca'}
                  </td>
                  {isAdmin && (
                    <td style={{ padding: '10px 12px' }}>
                      {u.id !== eu?.id && (
                        <button
                          onClick={() => alterarAtivo(u.id, !u.ativo)}
                          disabled={acaoId === u.id}
                          style={{
                            padding: '4px 10px', borderRadius: 4,
                            border: '1px solid var(--border)',
                            background: 'transparent', cursor: 'pointer', fontSize: 12,
                            color: u.ativo ? 'var(--danger)' : 'var(--ok)',
                            opacity: acaoId === u.id ? 0.5 : 1,
                          }}
                        >
                          {u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {isAdmin && (
        <SectionCard title="Novo usuário">
          <form onSubmit={criarUsuario}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16, marginBottom: 16,
            }}>
              <Field label="Nome *">
                <input style={inputStyle} value={novo.nome} required
                  onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))} />
              </Field>
              <Field label="Email *">
                <input style={inputStyle} value={novo.email} type="email" required
                  onChange={e => setNovo(n => ({ ...n, email: e.target.value }))} />
              </Field>
              <Field label="Senha temporária * (mín. 8 chars)">
                <input style={inputStyle} value={novo.senha} type="password" required
                  minLength={8}
                  onChange={e => setNovo(n => ({ ...n, senha: e.target.value }))} />
              </Field>
              <Field label="Perfil">
                <select style={inputStyle} value={novo.perfil}
                  onChange={e => setNovo(n => ({ ...n, perfil: e.target.value as UsuarioConfiguracao['perfil'] }))}>
                  <option value="operador">Operador</option>
                  <option value="visualizador">Visualizador</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PrimaryBtn loading={criando} loadingLabel="Criando..." icon={Plus}>
                Criar usuário
              </PrimaryBtn>
              {msgNovo && (
                <span style={{ fontSize: 13, color: msgNovo.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
                  {msgNovo.texto}
                </span>
              )}
            </div>
          </form>
        </SectionCard>
      )}
    </>
  );
}

// ─── Aba Alertas ──────────────────────────────────────────────────────────────

function AbaAlertas({
  alertas, cliente, isAdmin, onIrParaEmpresa,
}: {
  alertas: AlertasConfiguracao;
  cliente: ClienteConfiguracao;
  isAdmin: boolean;
  onIrParaEmpresa: () => void;
}) {
  const [testando, setTestando] = useState(false);
  const [msgTeste, setMsgTeste] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function testar() {
    setTestando(true);
    setMsgTeste(null);
    try {
      const { data } = await configuracoesApi.testarAlertas();
      setMsgTeste(data.ok
        ? { tipo: 'ok', texto: 'Alerta de teste enviado com sucesso.' }
        : { tipo: 'erro', texto: data.erro ?? 'Webhook retornou erro.' }
      );
    } catch {
      setMsgTeste({ tipo: 'erro', texto: 'Falha ao contatar o webhook.' });
    } finally {
      setTestando(false);
    }
  }

  const temTelefone = Boolean(cliente.telefone);
  const temEmail = Boolean(cliente.email);
  const podeTestar = alertas.webhook_configurado;

  const items: Array<{ label: string; valor: React.ReactNode }> = [
    {
      label: 'Webhook (n8n)',
      valor: <StatusPill ok={alertas.webhook_configurado} label={alertas.webhook_configurado ? 'Configurado' : 'Não configurado'} />,
    },
    ...(alertas.webhook_mascarado ? [{
      label: 'Endpoint',
      valor: <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{alertas.webhook_mascarado}</code>,
    }] : []),
    {
      label: 'WhatsApp',
      valor: temTelefone
        ? <StatusPill ok label={`Ativo — ${cliente.telefone}`} />
        : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusPill ok={false} label="Sem telefone" />
            {isAdmin && (
              <button
                onClick={onIrParaEmpresa}
                style={{
                  fontSize: 12, color: 'var(--rizom-blue)', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
                }}
              >
                Configurar na aba Empresa
              </button>
            )}
          </span>
        ),
    },
    {
      label: 'Email',
      valor: temEmail
        ? <StatusPill ok label={`Ativo — ${cliente.email}`} />
        : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusPill ok={false} label="Sem email" />
            {isAdmin && (
              <button
                onClick={onIrParaEmpresa}
                style={{
                  fontSize: 12, color: 'var(--rizom-blue)', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
                }}
              >
                Configurar na aba Empresa
              </button>
            )}
          </span>
        ),
    },
    { label: 'Timeout', valor: `${alertas.timeout_ms / 1000}s` },
    { label: 'Atraso padrão', valor: `${alertas.atraso_padrao_min} min` },
  ];

  return (
    <SectionCard title="Configuração de alertas">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 20 }}>
        <tbody>
          {items.map(item => (
            <tr key={item.label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: '40%' }}>
                {item.label}
              </td>
              <td style={{ padding: '10px 12px' }}>{item.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        O atraso real de cada equipamento pode ser ajustado na tela de equipamentos.
      </p>

      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PrimaryBtn
            onClick={testar}
            loading={testando}
            loadingLabel="Enviando..."
            disabled={!podeTestar}
            icon={Send}
          >
            Enviar alerta de teste
          </PrimaryBtn>
          {msgTeste && (
            <span style={{ fontSize: 13, color: msgTeste.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
              {msgTeste.texto}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Aba Sistema ──────────────────────────────────────────────────────────────

function AbaSistema({ sistema: inicial }: { sistema: SistemaConfiguracao }) {
  const [sistema, setSistema] = useState(inicial);
  const [atualizando, setAtualizando] = useState(false);

  async function atualizar() {
    setAtualizando(true);
    try {
      const { data } = await configuracoesApi.sistema();
      setSistema(data);
    } finally {
      setAtualizando(false);
    }
  }

  const rows: Array<{ label: string; valor: React.ReactNode }> = [
    { label: 'Backend', valor: <StatusPill ok={sistema.backend.status === 'ok'} label={sistema.backend.status} /> },
    { label: 'Versão', valor: `v${sistema.backend.version}` },
    { label: 'Ambiente', valor: sistema.backend.node_env },
    { label: 'Horário do servidor', valor: new Date(sistema.backend.server_time).toLocaleString('pt-BR') },
    { label: 'Banco de dados', valor: <StatusPill ok={sistema.database.status === 'ok'} label={sistema.database.status} /> },
    { label: 'MQTT', valor: <StatusPill ok={sistema.mqtt.conectado} label={sistema.mqtt.conectado ? 'Conectado' : 'Desconectado'} /> },
    { label: 'Broker MQTT', valor: `${sistema.mqtt.host}:${sistema.mqtt.port}` },
    { label: 'Frontend URL', valor: sistema.api.frontend_url ?? '—' },
    { label: 'Fuso horário', valor: sistema.api.report_timezone ?? '—' },
  ];

  return (
    <SectionCard title="Diagnóstico do sistema">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: '40%' }}>
                {r.label}
              </td>
              <td style={{ padding: '10px 12px' }}>{r.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={atualizar}
        disabled={atualizando}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent', cursor: 'pointer',
          fontSize: 14, color: 'var(--text-primary)',
          opacity: atualizando ? 0.6 : 1,
        }}
      >
        <RefreshCw size={14} /> {atualizando ? 'Atualizando...' : 'Atualizar status'}
      </button>
    </SectionCard>
  );
}

// ─── Aba Pagamento ───────────────────────────────────────────────────────────

const PLANOS: Array<{ id: PlanoBilling; nome: string; mensal: number; anual: number }> = [
  { id: 'starter', nome: 'Starter', mensal: 170, anual: 1700 },
  { id: 'operador', nome: 'Operador', mensal: 290, anual: 2900 },
  { id: 'master', nome: 'Master', mensal: 490, anual: 4900 },
];

const STATUS_BILLING: Record<string, { label: string; ok: boolean }> = {
  active: { label: 'Ativa', ok: true },
  trialing: { label: 'Teste grátis', ok: true },
  past_due: { label: 'Pagamento pendente', ok: false },
  unpaid: { label: 'Inadimplente', ok: false },
  canceled: { label: 'Cancelada', ok: false },
  incomplete: { label: 'Incompleta', ok: false },
  incomplete_expired: { label: 'Expirada', ok: false },
  sem_assinatura: { label: 'Sem assinatura', ok: false },
};

function formatarData(valor?: string | null) {
  return valor ? format(new Date(valor), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—';
}

function formatarMoeda(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function AbaPagamento({
  billing,
  isAdmin,
  onRefresh,
}: {
  billing: BillingStatus;
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [plano, setPlano] = useState<PlanoBilling>(billing.plano || 'starter');
  const [ciclo, setCiclo] = useState<CicloBilling>(billing.ciclo || 'monthly');
  const [acao, setAcao] = useState<'checkout' | 'portal' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const statusCfg = STATUS_BILLING[billing.status] || { label: billing.status, ok: false };
  const planoSelecionado = PLANOS.find(p => p.id === plano) || PLANOS[0];
  const temAssinaturaAberta = Boolean(
    billing.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(billing.status)
  );

  async function iniciarCheckout() {
    setAcao('checkout');
    setMsg(null);
    try {
      const { data } = await billingApi.checkout({ plano, ciclo });
      window.location.href = data.url;
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao iniciar checkout.';
      setMsg({ tipo: 'erro', texto });
      setAcao(null);
    }
  }

  async function abrirPortal() {
    setAcao('portal');
    setMsg(null);
    try {
      const { data } = await billingApi.portal();
      window.location.href = data.url;
    } catch (err: unknown) {
      const texto = (err as { response?: { data?: { erro?: string } } })
        ?.response?.data?.erro ?? 'Erro ao abrir portal de cobrança.';
      setMsg({ tipo: 'erro', texto });
      setAcao(null);
    }
  }

  const rows: Array<{ label: string; valor: React.ReactNode }> = [
    { label: 'Status', valor: <StatusPill ok={statusCfg.ok && !billing.bloqueado} label={billing.bloqueado ? 'Bloqueada' : statusCfg.label} /> },
    { label: 'Plano atual', valor: billing.plano },
    { label: 'Ciclo', valor: billing.ciclo === 'yearly' ? 'Anual' : billing.ciclo === 'monthly' ? 'Mensal' : '—' },
    { label: 'Fim do teste', valor: formatarData(billing.trial_end) },
    { label: 'Próxima renovação', valor: formatarData(billing.current_period_end) },
    { label: 'Cancelamento ao fim do período', valor: billing.cancel_at_period_end ? 'Sim' : 'Não' },
    { label: 'Bloqueio programado', valor: formatarData(billing.bloquear_em) },
  ];

  return (
    <>
      <SectionCard title="Assinatura">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 20 }}>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: '40%' }}>
                  {r.label}
                </td>
                <td style={{ padding: '10px 12px' }}>{r.valor}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {billing.status === 'past_due' && billing.bloquear_em && (
          <div style={{
            padding: 12, borderRadius: 6, background: 'var(--alerta-bg)',
            color: 'var(--alerta)', fontSize: 13, marginBottom: 16,
          }}>
            Há uma pendência de pagamento. O acesso será bloqueado em {formatarData(billing.bloquear_em)} se a cobrança não for regularizada.
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {isAdmin && billing.stripe_customer_id && (
            <SecondaryBtn
              onClick={abrirPortal}
              loading={acao === 'portal'}
              loadingLabel="Abrindo..."
              icon={CreditCard}
            >
              Gerenciar cobrança
            </SecondaryBtn>
          )}
          <SecondaryBtn onClick={onRefresh} disabled={Boolean(acao)} icon={RefreshCw}>
            Atualizar status
          </SecondaryBtn>
        </div>
      </SectionCard>

      {isAdmin && (
        <SectionCard title="Assinar ou alterar plano">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}>
            {PLANOS.map(p => {
              const active = plano === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlano(p.id)}
                  style={{
                    textAlign: 'left', padding: 14, borderRadius: 8,
                    border: `1px solid ${active ? 'var(--rizom-blue)' : 'var(--border)'}`,
                    background: active ? 'var(--rizom-mist)' : 'var(--surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.nome}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {formatarMoeda(p.mensal)}/mês
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {formatarMoeda(p.anual)}/ano
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {(['monthly', 'yearly'] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCiclo(c)}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: `1px solid ${ciclo === c ? 'var(--rizom-blue)' : 'var(--border)'}`,
                  background: ciclo === c ? 'var(--rizom-blue)' : 'var(--surface)',
                  color: ciclo === c ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                {c === 'monthly' ? 'Mensal' : 'Anual'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <PrimaryBtn
              onClick={iniciarCheckout}
              loading={acao === 'checkout'}
              loadingLabel="Redirecionando..."
              disabled={!billing.prices_configured || temAssinaturaAberta}
              icon={CreditCard}
            >
              Ir para pagamento: {formatarMoeda(ciclo === 'monthly' ? planoSelecionado.mensal : planoSelecionado.anual)}
            </PrimaryBtn>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Inclui 7 dias grátis.
            </span>
          </div>

          {!billing.prices_configured && (
            <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 12 }}>
              Preços da Stripe ainda não configurados no servidor.
            </p>
          )}

          {temAssinaturaAberta && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
              Para alterar plano, forma de pagamento ou cancelamento, use o botão Gerenciar cobrança.
            </p>
          )}

          {msg && (
            <p style={{ fontSize: 13, color: msg.tipo === 'ok' ? 'var(--ok)' : 'var(--danger)', marginTop: 12 }}>
              {msg.texto}
            </p>
          )}
        </SectionCard>
      )}
    </>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Configuracoes() {
  const { usuario } = useAuth();
  const isAdmin = usuario?.perfil === 'admin';

  const [aba, setAba] = useState<Aba>('empresa');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [cliente, setCliente] = useState<ClienteConfiguracao | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioConfiguracao[]>([]);
  const [alertasCfg, setAlertasCfg] = useState<AlertasConfiguracao | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [sistema, setSistema] = useState<SistemaConfiguracao | null>(null);

  async function carregarUsuarios() {
    const { data } = await configuracoesApi.usuarios();
    setUsuarios(data);
  }

  async function carregarBilling() {
    const { data } = await billingApi.status();
    setBilling(data);
  }

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const abaParam = params.get('aba') as Aba | null;
        if (abaParam && ['empresa', 'usuarios', 'alertas', 'pagamento', 'sistema'].includes(abaParam)) {
          setAba(abaParam);
        }

        const [cRes, uRes, aRes, bRes, sRes] = await Promise.all([
          configuracoesApi.cliente(),
          configuracoesApi.usuarios(),
          configuracoesApi.alertas(),
          billingApi.status(),
          configuracoesApi.sistema(),
        ]);
        setCliente(cRes.data);
        setUsuarios(uRes.data);
        setAlertasCfg(aRes.data);
        setBilling(bRes.data);
        setSistema(sRes.data);
      } catch {
        setErro('Erro ao carregar configurações. Tente recarregar a página.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Carregando...</span>
    </div>
  );

  if (erro) return (
    <div style={{ padding: 32 }}>
      <span style={{ color: 'var(--danger)', fontSize: 15 }}>{erro}</span>
    </div>
  );

  const abas: Array<{ id: Aba; label: string; icon: React.FC<{ size?: number; color?: string }> }> = [
    { id: 'empresa',  label: 'Empresa',  icon: Building2 },
    { id: 'usuarios', label: 'Usuários', icon: Users },
    { id: 'alertas',  label: 'Alertas',  icon: Bell },
    { id: 'pagamento', label: 'Pagamento', icon: CreditCard },
    { id: 'sistema',  label: 'Sistema',  icon: Server },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Configurações</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Gerencie empresa, usuários, alertas e diagnóstico do sistema.
        </p>
      </div>

      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid var(--border)', paddingBottom: 8,
        flexWrap: 'wrap',
      }}>
        {abas.map(a => (
          <TabButton key={a.id} aba={a.id} atual={aba} label={a.label} icon={a.icon} onClick={setAba} />
        ))}
      </div>

      {aba === 'empresa'  && cliente     && <AbaEmpresa   cliente={cliente} isAdmin={isAdmin} onUpdate={setCliente} />}
      {aba === 'usuarios'                && <AbaUsuarios  usuarios={usuarios} isAdmin={isAdmin} onRefresh={carregarUsuarios} />}
      {aba === 'alertas'  && alertasCfg && cliente && (
        <AbaAlertas
          alertas={alertasCfg}
          cliente={cliente}
          isAdmin={isAdmin}
          onIrParaEmpresa={() => setAba('empresa')}
        />
      )}
      {aba === 'pagamento' && billing && (
        <AbaPagamento
          billing={billing}
          isAdmin={isAdmin}
          onRefresh={carregarBilling}
        />
      )}
      {aba === 'sistema'  && sistema     && <AbaSistema   sistema={sistema} />}
    </div>
  );
}
