import { pct } from '../format.js';

export const Change = ({ value, invert = false }) => {
  if (value === null || value === undefined) return <span className="muted small">no prior data</span>;
  const good = invert ? value < 0 : value > 0;
  return <span className={`small ${value === 0 ? 'muted' : good ? 'up' : 'down'}`}>{value > 0 ? '▲' : value < 0 ? '▼' : '•'} {pct(value)} vs previous</span>;
};

export const Stat = ({ label, value, change }) => (
  <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div>{change !== undefined && <Change value={change} />}</div>
);

export const Alert = ({ kind = 'info', children }) => (children ? <div className={`alert ${kind}`}>{children}</div> : null);

