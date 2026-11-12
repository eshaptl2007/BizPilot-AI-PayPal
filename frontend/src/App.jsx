import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Sales from './pages/Sales.jsx';
import Advisor from './pages/Advisor.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Simulator from './pages/Simulator.jsx';
import Storefront from './pages/Storefront.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Onboarding from './pages/Onboarding.jsx';

function Private({ children }) {
  const { loading, user, business } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!business.onboarded) return <Navigate to="/onboarding" replace />; // finish setup first
  return <Layout>{children}</Layout>;
}

function OnboardingGate() {
  const { loading, user } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  return user ? <Onboarding /> : <Navigate to="/login" replace />;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/shop/:slug" element={<Storefront />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<OnboardingGate />} />
      <Route path="/" element={<Private><Dashboard /></Private>} />
      <Route path="/products" element={<Private><Products /></Private>} />
      <Route path="/sales" element={<Private><Sales /></Private>} />
      <Route path="/advisor" element={<Private><Advisor /></Private>} />
      <Route path="/campaigns" element={<Private><Campaigns /></Private>} />
      <Route path="/simulator" element={<Private><Simulator /></Private>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
