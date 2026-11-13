import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Modal, Field } from '../ui/kit.jsx';

// Универсальная форма операции: fields = [{ k, label, type, options, hint, required }]
export function useAction() {
  const { op } = useStore();
  const [cfg, setCfg] = useState(null);
  const [vals, setVals] = useState({});
  const open = (c) => { setCfg(c); setVals(Object.fromEntries((c.fields || []).map((f) => [f.k, f.default ?? '']))); };
  const close = () => setCfg(null);
  const submit = (e) => {
    e?.preventDefault();
    const conv = Object.fromEntries((cfg.fields || []).map((f) => [f.k, f.type === 'number' ? (vals[f.k] === '' ? '' : +vals[f.k]) : f.type === 'checkbox' ? !!vals[f.k] : vals[f.k]]));
    const payload = { ...(cfg.args || {}), ...conv };
    const r = op(cfg.op, cfg.map ? cfg.map(payload) : payload, { success: cfg.success || 'Готово' });
    if (r) { cfg.onDone?.(r); close(); }
  };
  const modal = cfg && (
    <Modal title={cfg.title} onClose={close} actions={<><button className="btn light" onClick={close}>Отмена</button><button className={`btn ${cfg.danger ? 'danger' : ''}`} onClick={submit}>{cfg.cta || 'Подтвердить'}</button></>}>
      {cfg.text && <p className="muted small">{cfg.text}</p>}
      <form onSubmit={submit}>
        {(cfg.fields || []).map((f) => (
          <Field key={f.k} label={f.label} hint={f.hint}>
            {f.type === 'select' ? (
              <select value={vals[f.k]} onChange={(e) => setVals({ ...vals, [f.k]: e.target.value })}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            ) : f.type === 'checkbox' ? (
              <label className="row-flex"><input type="checkbox" checked={!!vals[f.k]} onChange={(e) => setVals({ ...vals, [f.k]: e.target.checked })} /> {f.checkLabel}</label>
            ) : f.type === 'textarea' ? (
              <textarea value={vals[f.k]} onChange={(e) => setVals({ ...vals, [f.k]: e.target.value })} />
            ) : (
              <input type={f.type || 'text'} value={vals[f.k]} onChange={(e) => setVals({ ...vals, [f.k]: e.target.value })} autoFocus={f.autoFocus} />
            )}
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
  return [open, modal];
}
