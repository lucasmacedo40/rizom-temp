// src/components/Layout.tsx
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Thermometer, Bell, FileText, LogOut, Settings } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';

const navItems = [
  { to: '/',            label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/equipamentos', label: 'Equipamentos', icon: Thermometer },
  { to: '/alertas',     label: 'Alertas',      icon: Bell },
  { to: '/relatorios',  label: 'Relatórios',   icon: FileText },
  { to: '/configuracoes', label: 'Config.',    icon: Settings },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        padding: '24px 0',
        position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 100,
      }}>
        {/* Logo */}
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--rizom-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="6" r="3" fill="white"/>
                <circle cx="6" cy="20" r="3" fill="white" opacity=".7"/>
                <circle cx="22" cy="20" r="3" fill="white" opacity=".7"/>
                <line x1="14" y1="9" x2="6" y2="17" stroke="white" strokeWidth="1.5" opacity=".6"/>
                <line x1="14" y1="9" x2="22" y2="17" stroke="white" strokeWidth="1.5" opacity=".6"/>
                <line x1="6" y1="20" x2="22" y2="20" stroke="white" strokeWidth="1.5" opacity=".3"/>
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15 }}>Rizom Temp</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Monitoramento</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px' }}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to} end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, marginBottom: 2,
                fontSize: 14, fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: isActive ? 'rgba(26,110,255,0.12)' : 'transparent',
                transition: 'all .15s',
                textDecoration: 'none',
              })}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Usuário + logout */}
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
              background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 14, transition: 'all .15s',
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

      {/* Conteúdo */}
      <main style={{ marginLeft: 220, flex: 1, padding: '32px', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
