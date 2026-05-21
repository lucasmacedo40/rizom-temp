import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Equipamentos from './pages/Equipamentos';
import EquipamentoDetalhe from './pages/EquipamentoDetalhe';
import Alertas from './pages/Alertas';
import Relatorios from './pages/Relatorios';
import Configuracoes from './pages/Configuracoes';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { usuario, loading } = useAuth();
  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--night)', color: 'var(--text-secondary)',
    }}>
      Carregando...
    </div>
  );
  if (!usuario) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/equipamentos" element={<PrivateRoute><Equipamentos /></PrivateRoute>} />
          <Route path="/equipamentos/:id" element={<PrivateRoute><EquipamentoDetalhe /></PrivateRoute>} />
          <Route path="/alertas" element={<PrivateRoute><Alertas /></PrivateRoute>} />
          <Route path="/relatorios" element={<PrivateRoute><Relatorios /></PrivateRoute>} />
          <Route path="/configuracoes" element={<PrivateRoute><Configuracoes /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
