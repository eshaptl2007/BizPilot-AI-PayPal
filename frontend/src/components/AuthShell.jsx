import Logo from './Logo.jsx';

/** Shared two-column layout for sign in / sign up / forgot / reset. Left side is intentionally minimal. */
export default function AuthShell({ children }) {
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="brand"><Logo size={52} /><span>BizPilot AI</span></div>
        <h1>Don't just manage your business. Know exactly what to do next.</h1>
        <p>Your AI growth partner for small businesses.</p>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}
