import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Logo from './Logo.jsx';

const links = [
  ['/', 'Dashboard', '📊'], ['/advisor', 'AI Advisor', '✨'], ['/campaigns', 'Marketing Studio', '📣'],
  ['/simulator', 'Growth Simulator', '🧪'], ['/products', 'Products', '🧁'], ['/sales', 'Sales & Data', '🧾'],
];

export default function Layout({ children }) {
  const { business, user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo"><Logo size={32} /> BizPilot AI</div>
        <nav className="nav">
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span>{icon}</span>{label}</NavLink>
          ))}
          <a href={`/shop/${business.slug}`} target="_blank" rel="noreferrer"><span>🛒</span>My storefront ↗</a>
        </nav>
        <div className="foot">
          <div style={{ color: '#fff', fontWeight: 600 }}>{business.name}</div>
          <div>{user.email}</div>
          <button className="sm ghost" style={{ color: '#cbd5e1', padding: '6px 0' }} onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
