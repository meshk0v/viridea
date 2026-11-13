import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export const I = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  cart: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" /><circle cx="10" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>,
  user: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  menu: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  leaf: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15" /><path d="M5 19 14 10" /></svg>,
  admin: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>,
};

export function Logo({ light = false }) {
  return (
    <span className="logo" style={light ? { color: 'var(--paper-2)' } : undefined}>
      <span className="word">VIRIDEA</span>
      <span className="sub">растения<br />из лаборатории</span>
    </span>
  );
}

export function AvailPill({ a }) {
  return <span className={`pill ${a.code}`}>{a.label}</span>;
}

export function Qty({ value, onChange, max = 999, min = 1 }) {
  return (
    <span className="qty">
      <button type="button" aria-label="Меньше" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input aria-label="Количество" inputMode="numeric" value={value} onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n))); }} />
      <button type="button" aria-label="Больше" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </span>
  );
}

export function Modal({ title, onClose, children, actions }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

export function Denied({ perm }) {
  return <div className="denied"><b>Нет доступа.</b><br />Для раздела нужно право <span className="mono">{perm}</span>. Смените роль в правом верхнем углу.</div>;
}

export function useForm(init) {
  const [f, setF] = useState(init);
  const bind = (k) => ({ value: f[k] ?? '', onChange: (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) });
  return [f, setF, bind];
}

export function Crumbs({ items }) {
  return (
    <div className="breadcrumbs">
      {items.map(([to, label], i) => (
        <span key={i}>{i > 0 && ' / '}{to ? <Link to={to}>{label}</Link> : label}</span>
      ))}
    </div>
  );
}
