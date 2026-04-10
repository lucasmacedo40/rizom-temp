import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      await login(email, senha);
      navigate('/');
    } catch {
      setErro('Email ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--night)',
    }}>
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(var(--rizom-blue) 1px, transparent 1px), linear-gradient(90deg, var(--rizom-blue) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />
      <div style={{ width: '100%', maxWidth: 400, padding: '0 24px', position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--rizom-blue)', marginBottom: 16,
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="6" r="3" fill="white"/>
              <circle cx="6" cy="20" r="3" fill="white" opacity=".7"/>
              <circle cx="22" cy="20" r="3" fill="white" opacity=".7"/>
              <line x1="14" y1="9" x2="6" y2="17" stroke="white" strokeWidth="1.5" opacity=".5"/>
              <line x1="14" y1="9" x2="22" y2="17" stroke="white" strokeWidth="1.5" opacity=".5"/>
              <line x1="6" y1="20" x2="22" y2="20" stroke="white" strokeWidth="1.5" opacity=".3"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px' }}>
            Rizom Temp
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
            Monitoramento de temperatura ANVISA
          </p>
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, padding: 32,
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Email
              </label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 15, transition: 'border-color .2s',
                }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--rizom-blue)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Senha
              </label>
              <input
                type="password" value={senha} onChange={e => setSenha(e.target.value)}
                required
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 15, transition: 'border-color .2s',
                }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--rizom-blue)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
              />
            </div>
            {erro && (
              <div style={{
                background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16,
                color: 'var(--danger)', fontSize: 13,
              }}>
                {erro}
              </div>
            )}
            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: '13px',
                background: loading ? 'var(--surface-2)' : 'var(--rizom-blue)',
                color: 'white', borderRadius: 12, fontFamily: 'Syne',
                fontWeight: 600, fontSize: 15, transition: 'all .2s',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
