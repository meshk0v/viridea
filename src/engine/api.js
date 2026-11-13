// Обработчик REST API v1.
// Контракт ошибок: { error: { code, message, retryable, correlation_id } }
import { run, orderById, orderTotals, orderStatus, stockOf, lotAvailable, reservedOnLot, availabilityStatus } from './engine.js';
import { DomainError, randomToken, nextId, clone } from './util.js';

const iso = (t) => (t ? new Date(t).toISOString() : null);

export const API_SCOPES = ['catalog:read', 'stock:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'payments:read', 'shipments:read', 'approvals:write', 'webhooks:manage', 'finance:read'];

const ROUTES = [
  ['GET', /^\/api\/v1\/health$/, null, health],
  ['GET', /^\/api\/v1\/products$/, 'catalog:read', products],
  ['GET', /^\/api\/v1\/stock$/, 'stock:read', stock],
  ['GET', /^\/api\/v1\/orders$/, 'orders:read', ordersList],
  ['GET', /^\/api\/v1\/orders\/([\w-]+)$/, 'orders:read', orderGet],
  ['POST', /^\/api\/v1\/orders\/([\w-]+)\/actions$/, 'orders:write', orderAction],
  ['GET', /^\/api\/v1\/customers\/([\w-]+)$/, 'customers:read', customerGet],
  ['POST', /^\/api\/v1\/customers\/link$/, 'customers:write', customerLink],
  ['GET', /^\/api\/v1\/payments$/, 'payments:read', paymentsList],
  ['GET', /^\/api\/v1\/shipments$/, 'shipments:read', shipmentsList],
  ['POST', /^\/api\/v1\/approvals$/, 'approvals:write', approvals],
  ['GET', /^\/api\/v1\/events$/, 'webhooks:manage', eventsList],
  ['POST', /^\/api\/v1\/webhooks\/subscriptions$/, 'webhooks:manage', subscribe],
];

export function apiRequest(S0, { method, path, query = {}, body = null, headers = {} }, now = Date.now()) {
  const correlation_id = 'cor_' + randomToken(12);
  let S = S0;
  const fail = (status, code, message, retryable = false) => ({ state: S, status, body: { error: { code, message, retryable, correlation_id } } });
  try {
    const route = ROUTES.find(([m, re]) => m === method && re.test(path));
    if (!route) return fail(404, 'NOT_FOUND', 'Метод не найден');
    const [, re, scope, handler] = route;
    let key = null;
    if (scope) {
      const auth = headers.authorization || '';
      const tok = auth.replace(/^Bearer\s+/i, '');
      key = S.apiKeys.find((k) => k.token === tok && !k.revoked);
      if (!key) return fail(401, 'UNAUTHORIZED', 'Неверный или отозванный ключ');
      if (!key.scopes.includes(scope)) return fail(403, 'FORBIDDEN_SCOPE', `Ключу не выдано право ${scope}`);
    }
    const params = path.match(re).slice(1);
    const idem = headers['idempotency-key'] || body?.idempotency_key;
    if (method === 'POST') {
      if (!idem) return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Для POST обязателен Idempotency-Key');
      const prev = S.idempotency['api:' + idem];
      if (prev) return { state: S, status: prev.status, body: prev.body, replayed: true };
    }
    const res = handler({ S, params, query, body, key, now });
    S = res.state || S;
    if (method === 'POST' && res.status < 500) {
      S = res.state ? S : clone(S);
      S.idempotency['api:' + idem] = { status: res.status, body: res.body };
    }
    return { state: S, status: res.status, body: res.body };
  } catch (e) {
    if (e instanceof DomainError) {
      const map = { NOT_FOUND: 404, FORBIDDEN: 403, VERSION_CONFLICT: 409, STATE: 409, VALIDATION: 422 };
      return fail(map[e.code] || 422, e.code, e.message);
    }
    return fail(500, 'INTERNAL', 'Внутренняя ошибка', true);
  }
}

const ok = (body, status = 200, state) => ({ status, body, state });
const page = (items, query) => {
  const limit = Math.min(100, +query.limit || 20), offset = +query.offset || 0;
  return { data: items.slice(offset, offset + limit), meta: { total: items.length, limit, offset } };
};

function health({ S }) {
  const pendingEvents = S.events.filter((e) => !e.delivered).length;
  return ok({ status: 'ok', version: 'v1', pending_events: pendingEvents, google_sync: S.google.online ? 'ok' : 'degraded' });
}

function products({ S, query }) {
  let items = S.variants;
  if (query.updated_after) items = items.filter((v) => v.updatedAt > Date.parse(query.updated_after));
  if (query.sku) items = items.filter((v) => v.sku === query.sku);
  return ok(page(items.map((v) => { const a = availabilityStatus(S, v); return { sku: v.sku, cultivar_id: v.cultivarId, name: v.title, category: v.category, pack_size: v.packSize, sale_unit: v.saleUnit, price: v.price, currency: 'RUB', availability: a.code, available_qty: a.stock.available, active: v.active, updated_at: iso(v.updatedAt) }; }), query));
}

function stock({ S, query }) {
  let lots = S.lots;
  if (query.sku) lots = lots.filter((l) => l.sku === query.sku);
  if (query.warehouse_id) lots = lots.filter((l) => l.warehouseId === query.warehouse_id);
  return ok(page(lots.map((l) => ({ warehouse_id: l.warehouseId, sku: l.sku, batch_id: l.batchId, physical: l.qty, quarantine: l.quarantineQty, reserved: reservedOnLot(S, l.id), available: lotAvailable(S, l), revision: l.costVersion || 1 })), query));
}

export function orderDto(S, o, withFinance = true) {
  const t = orderTotals(S, o);
  return {
    id: o.id, external_ids: o.externalIds || {}, channel: o.channel, customer_id: o.customerId, status: orderStatus(S, o), version: o.version, created_at: iso(o.createdAt), currency: 'RUB',
    lines: o.lines.map((l) => ({ id: l.id, sku: l.sku, title: l.title, pack_size: l.packSize, qty: l.qty, unit_price: l.unitPrice, mode: l.mode, status: l.status })),
    totals: withFinance ? t : { total: t.total, balance: t.balance },
    payments: S.payments.filter((p) => p.orderId === o.id).map((p) => ({ id: p.id, kind: p.kind, provider_ref: p.providerRef, amount: p.amount, state: p.state, occurred_at: iso(p.occurredAt) })),
    shipments: S.shipments.filter((s) => s.orderId === o.id).map((s) => ({ id: s.id, carrier: s.carrier, tracking: s.tracking, status: s.status, line_ids: s.lineIds })),
  };
}

function ordersList({ S, query, key }) {
  let items = S.orders;
  if (query.updated_after) items = items.filter((o) => o.createdAt > Date.parse(query.updated_after));
  if (query.external_id) items = items.filter((o) => Object.values(o.externalIds || {}).includes(query.external_id));
  return ok(page(items.map((o) => orderDto(S, o, key.scopes.includes('finance:read'))), query));
}

function orderGet({ S, params, key }) {
  const o = orderById(S, params[0]);
  if (!o) throw new DomainError('NOT_FOUND', 'Заказ не найден');
  return ok(orderDto(S, o, key.scopes.includes('finance:read')));
}

// Разрешённые действия CRM: комментарий, внешний ID, отмена позиции. Остатки напрямую менять нельзя.
function orderAction({ S, params, body, now }) {
  const o = orderById(S, params[0]);
  if (!o) throw new DomainError('NOT_FOUND', 'Заказ не найден');
  if (body?.expected_version == null) throw new DomainError('VALIDATION', 'Нужен expected_version');
  if (+body.expected_version !== o.version) throw new DomainError('VERSION_CONFLICT', `Версия заказа ${o.version}, ожидалась ${body.expected_version}`);
  const actor = { id: 'api:' + (body.actor || 'crm'), name: `RetailCRM (${body.actor || 'интеграция'})`, role: 'manager' };
  if (body.action === 'set_external_id') {
    const S2 = clone(S); const o2 = orderById(S2, o.id);
    o2.externalIds = { ...(o2.externalIds || {}), [body.system || 'retailcrm']: String(body.value) };
    o2.version++;
    S2.audit.push({ id: nextId(S2, 'AUD', 6), at: now, actorId: actor.id, actorName: actor.name, role: 'api', objectType: 'order', objectId: o.id, action: 'API: внешний ID', before: null, after: o2.externalIds, reason: body.idempotency_key || '' });
    return ok(orderDto(S2, o2), 200, S2);
  }
  if (body.action === 'cancel_line') {
    const { state } = run(S, { actor, now }, 'order.cancelLine', { orderId: o.id, lineId: body.line_id, reason: body.reason || 'Отмена из CRM' });
    return ok(orderDto(state, orderById(state, o.id)), 200, state);
  }
  if (body.action === 'adjust_stock') throw new DomainError('FORBIDDEN', 'Изменение остатков из CRM запрещено — только через складской документ');
  throw new DomainError('VALIDATION', 'Неизвестное действие. Доступно: set_external_id, cancel_line');
}

function customerGet({ S, params }) {
  const c = S.customers.find((x) => x.id === params[0]);
  if (!c) throw new DomainError('NOT_FOUND', 'Клиент не найден');
  return ok({ id: c.id, name: c.name, phone: c.phone, email: c.email || null, consents: { pd: !!c.consents?.pd, marketing: !!c.consents?.marketing }, external_ids: c.externalIds || {} });
}

function customerLink({ S, body, now }) {
  const c = S.customers.find((x) => x.id === body?.site_id);
  if (!c) throw new DomainError('NOT_FOUND', 'Клиент не найден');
  const other = S.customers.find((x) => x.id !== c.id && x.externalIds?.retailcrm === String(body.crm_id));
  if (other) throw new DomainError('STATE', `CRM ID уже связан с ${other.id} — требуется ручное объединение`);
  const S2 = clone(S);
  const c2 = S2.customers.find((x) => x.id === c.id);
  c2.externalIds = { ...(c2.externalIds || {}), retailcrm: String(body.crm_id) };
  S2.audit.push({ id: nextId(S2, 'AUD', 6), at: now, actorId: 'api:crm', actorName: 'RetailCRM', role: 'api', objectType: 'customer', objectId: c.id, action: 'API: связка с CRM ID', before: c.externalIds || {}, after: c2.externalIds, reason: '' });
  return ok({ site_id: c.id, crm_id: String(body.crm_id) }, 200, S2);
}

function paymentsList({ S, query }) {
  return ok(page(S.payments.filter((p) => p.state === 'confirmed').map((p) => ({ id: p.id, order_id: p.orderId, kind: p.kind, provider_ref: p.providerRef, amount: p.amount, currency: 'RUB', occurred_at: iso(p.occurredAt) })), query));
}
function shipmentsList({ S, query }) {
  return ok(page(S.shipments.map((s) => ({ id: s.id, order_id: s.orderId, carrier: s.carrier, tracking: s.tracking, status: s.status, line_ids: s.lineIds, handover_at: iso(s.handoverAt), received_at: iso(s.receivedAt) })), query));
}
function approvals({ S, body, now }) {
  if (body?.type !== 'claim') throw new DomainError('VALIDATION', 'Поддерживается type=claim');
  const actor = { id: 'api:' + (body.actor || 'crm'), name: 'RetailCRM', role: body.role === 'head' ? 'head' : 'manager' };
  const { state, result } = run(S, { actor, now }, 'claim.decide', { claimId: body.object_id, decision: body.decision, amount: body.amount, comment: body.reason });
  return ok({ claim_id: result.id, state: result.state, decision: result.decision }, 200, state);
}
function eventsList({ S, query }) {
  let ev = S.events;
  if (query.after) ev = ev.filter((e) => e.event_id > query.after);
  return ok(page(ev.map(({ data, delivered, attempts, ...e }) => ({ ...e, data })), query));
}
function subscribe({ S, body }) {
  if (!/^https:\/\//.test(body?.url || '')) throw new DomainError('VALIDATION', 'URL вебхука должен быть https');
  const S2 = clone(S);
  const sub = { id: nextId(S2, 'WHS', 3), url: body.url, events: body.events || ['*'], secret: 'whsec_' + randomToken(24), active: true };
  S2.webhookSubscriptions.push(sub);
  return ok({ id: sub.id, url: sub.url, events: sub.events, secret: sub.secret }, 201, S2);
}

export async function signWebhook(secret, payload) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(payload));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const _stockOf = stockOf;
