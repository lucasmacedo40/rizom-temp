import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Thermometer, Bell, FileText, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';

const navItems = [
  { to: '/',              label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/equipamentos',  label: 'Equipamentos', icon: Thermometer },
  { to: '/alertas',       label: 'Alertas',      icon: Bell },
  { to: '/relatorios',    label: 'Relatórios',   icon: FileText },
  { to: '/configuracoes', label: 'Config.',      icon: Settings },
];

const Logo = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={{
      width: 32, height: 32, borderRadius: 8,
      background: 'var(--rizom-blue)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="6" r="3" fill="white"/>
        <circle cx="6" cy="20" r="3" fill="white" opacity=".7"/>
        <circle cx="22" cy="20" r="3" fill="white" opacity=".7"/>
        <line x1="14" y1="9" x2="6" y2="17" stroke="white" strokeWidth="1.5" opacity=".6"/>
        <line x1="14" y1="9" x2="22" y2="17" stroke="white" strokeWidth="1.5" opacity=".6"/>
        <line x1="6" y1="20" x2="22" y2="20" stroke="white" strokeWidth="1.5" opacity=".3"/>
      </svg>
    </div>
    <span style={{ fontWeight: 700, fontSize: 15 }}>Rizom Temp</span>
  </div>
);

export default function Layout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const sidebarNavStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', borderRadius: 8, marginBottom: 2,
    fontSize: 14, fontWeight: isActive ? 500 : 400,
    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: isActive ? 'rgba(37,99,235,0.1)' : 'transparent',
    transition: 'all .15s',
    textDecoration: 'none',
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Sidebar (desktop) ──────────────────────────────── */}
      <aside className="sidebar">
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
          <Logo />
        </div>

        <nav style={{ flex: 1, padding: '16px 12px' }}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} style={sidebarNavStyle}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '16px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 12px', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{usuario?.nome}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{usuario?.perfil}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: 'transparent', color: 'var(--text-secondary)', fontSize: 14,
              transition: 'all .15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--danger-bg)';
              (e.currentTarget as HTMLElement).style.color = 'var(--danger)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
            }}
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>

      {/* ── Header mobile ──────────────────────────────────── */}
      <header className="mobile-header">
        <Logo />
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 8,
            background: 'transparent', color: 'var(--text-secondary)',
            transition: 'all .15s',
          }}
          title="Sair"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* ── Conteúdo ───────────────────────────────────────── */}
      <main className="main-content">
        {children}
      </main>

      {/* ── Bottom nav (mobile) ────────────────────────────── */}
      <nav className="bottom-nav">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => isActive ? 'active' : ''}
          >
            <Icon size={22} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </nav>

    </div>
  );
}
