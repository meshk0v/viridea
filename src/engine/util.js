export class DomainError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export const need = (cond, code, message, extra) => {
  if (!cond) throw new DomainError(code, message, extra);
};

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export function nextId(S, prefix, pad = 5) {
  S.seq[prefix] = (S.seq[prefix] || 0) + 1;
  return `${prefix}-${String(S.seq[prefix]).padStart(pad, '0')}`;
}

export const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

export const rub = (n, digits = 0) =>
  n == null || Number.isNaN(n)
    ? '—'
    : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(n) + ' ₽';

export const num = (n) => (n == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n));

export const pct = (n) => (n == null || !Number.isFinite(n) ? 'не рассчитывается' : num(round2(n)) + '%');

export const dt = (ts) =>
  ts ? new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const d = (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) : '—');

export function randomToken(len = 24) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) out += abc[b % abc.length];
  return out;
}

export async function sha256Hex(buf) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
