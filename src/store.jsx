import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { run, can as canPerm } from './engine/engine.js';
import { buildSeed, STAFF } from './engine/seed.js';
import { clone, nextId } from './engine/util.js';

const KEY = 'viridea-state-v1';
const CART = 'viridea-cart';
const SESSION = 'viridea-session';

const Ctx = createContext(null);

function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим / квота */ }
}

// Постановка изменённых наборов в очередь выгрузки на Google Диск
function enqueueDirty(S, now) {
  if (!S._dirty?.length) return S;
  for (const ds of S._dirty) {
    const pending = S.exportJobs.find((j) => j.dataset === ds && j.state !== 'done');
    if (pending) { pending.coalesced = (pending.coalesced || 0) + 1; continue; }
    S.exportJobs.push({ id: nextId(S, 'EXJ', 6), dataset: ds, revision: null, queuedAt: now, completedAt: null, state: 'queued', retries: 0, nextAt: now + 1500, error: null });
  }
  S._dirty = [];
  if (S.exportJobs.length > 300) S.exportJobs = S.exportJobs.slice(-300);
  return S;
}

export function StoreProvider({ children }) {
  const [S, setS] = useState(() => {
    const st = load(KEY, null);
    return st && st.schemaVersion === 3 ? st : buildSeed();
  });
  const [actorId, setActorId] = useState(() => load(SESSION, {}).actorId || 'U1');
  const [customerId, setCustomerId] = useState(() => load(SESSION, {}).customerId || null);
  const [cart, setCart] = useState(() => load(CART, []));
  const [toasts, setToasts] = useState([]);
  const sRef = useRef(S);
  sRef.current = S;

  useEffect(() => { save(KEY, S); }, [S]);
  useEffect(() => { save(CART, cart); }, [cart]);
  useEffect(() => { save(SESSION, { actorId, customerId }); }, [actorId, customerId]);

  const actor = useMemo(() => {
    const u = S.users.find((x) => x.id === actorId) || STAFF[0];
    return { id: u.id, name: u.name, role: u.role };
  }, [S.users, actorId]);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800);
  }, []);

  const op = useCallback((name, args = {}, { public: pub = false, silent = false, success } = {}) => {
    const now = Date.now();
    try {
      const { state, result } = run(sRef.current, { actor: pub ? null : actor, now }, name, args);
      const next = enqueueDirty(state, now);
      sRef.current = next;
      setS(next);
      if (success && !silent) toast(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (e) {
      if (e.state) { const next = enqueueDirty(e.state, now); sRef.current = next; setS(next); }
      if (!silent) toast(e.message || String(e), 'error');
      if (!e.code) console.error(e);
      return null;
    }
  }, [actor, toast]);

  const replaceState = useCallback((next) => { sRef.current = next; setS(next); }, []);

  // Фоновые задания: очередь Google, истечение резервов
  useEffect(() => {
    const t = setInterval(() => {
      const cur = sRef.current;
      const now = Date.now();
      const due = cur.exportJobs.filter((j) => j.state !== 'done' && j.nextAt <= now);
      if (!due.length) return;
      const S2 = clone(cur);
      for (const j of S2.exportJobs.filter((j) => j.state !== 'done' && j.nextAt <= now)) {
        if (S2.google.online) {
          S2.google.revision++;
          Object.assign(j, { state: 'done', completedAt: now, revision: S2.google.revision, error: null });
          S2.google.lastSuccessAt = now;
          S2.exportLog.push({ id: j.id, dataset: j.dataset, at: now, ok: true, attempt: j.retries + 1 });
        } else {
          j.retries++;
          Object.assign(j, { state: 'error', error: 'GOOGLE_API_UNAVAILABLE', nextAt: now + Math.min(60000, 2000 * 2 ** Math.min(j.retries, 5)) });
          S2.exportLog.push({ id: j.id, dataset: j.dataset, at: now, ok: false, attempt: j.retries, error: j.error });
        }
      }
      if (S2.exportLog.length > 400) S2.exportLog = S2.exportLog.slice(-400);
      sRef.current = S2;
      setS(S2);
    }, 2500);
    const t2 = setInterval(() => {
      try {
        const { state, result } = run(sRef.current, { actor: null, now: Date.now() }, 'jobs.tick', {});
        if (result.expired || result.reminders) { const n = enqueueDirty(state, Date.now()); sRef.current = n; setS(n); }
      } catch { /* noop */ }
    }, 30000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  const value = {
    S, op, actor, setActorId, toast, replaceState,
    can: (perm) => canPerm(S, actor, perm),
    customerId, setCustomerId,
    cart,
    cartAdd: (sku, qty = 1) => setCart((c) => { const ex = c.find((x) => x.sku === sku); return ex ? c.map((x) => (x.sku === sku ? { ...x, qty: x.qty + qty } : x)) : [...c, { sku, qty }]; }),
    cartSet: (sku, qty) => setCart((c) => (qty <= 0 ? c.filter((x) => x.sku !== sku) : c.map((x) => (x.sku === sku ? { ...x, qty } : x)))),
    cartClear: () => setCart([]),
    reset: () => { const s = buildSeed(); sRef.current = s; setS(s); setCart([]); setCustomerId(null); toast('Исходные данные восстановлены'); },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export const useStore = () => useContext(Ctx);
