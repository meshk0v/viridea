// Транзакционный доменный сервис VIRIDEA.
// Каждая операция выполняется над копией состояния: при ошибке копия отбрасывается целиком
// (аналог транзакции БД).

import { DomainError, need, nextId, clone, round2, sum, HOUR, DAY, randomToken } from './util.js';
import { PERMISSIONS, CATEGORIES, CARRIERS, RESERVE_HOURS, EXTEND_HOURS, EXPENSE_CATEGORIES } from './model.js';

// ───────────────────────── состояние ─────────────────────────

export function emptyState() {
  return {
    schemaVersion: 3,
    seq: {},
    settings: {
      partialFifo: true, // открытое решение: частичная выдача упаковок одному клиенту
      logisticsMethod: 'cost', // 'cost' | 'qty' — распределение входящей логистики
      retailMarkup: 1.7,
      reserveHours: RESERVE_HOURS,
      timezone: 'Europe/Moscow',
      currency: 'RUB',
    },
    users: [],
    customers: [],
    cultivars: [],
    variants: [],
    suppliers: [],
    warehouses: [],
    batches: [],
    lots: [],
    movements: [],
    reservations: [],
    orders: [],
    payments: [],
    shipments: [],
    sales: [],
    adaptations: [],
    expenses: [],
    compensations: [],
    claims: [],
    inventories: [],
    priceLists: [],
    replacementTokens: [],
    notifications: [],
    events: [],
    webhookSubscriptions: [],
    apiKeys: [],
    idempotency: {},
    exportJobs: [],
    exportLog: [],
    google: { online: true, lastSuccessAt: null, revision: 0 },
    audit: [],
    _dirty: [],
  };
}

// ───────────────────────── права и аудит ─────────────────────────

export function can(S, actor, perm) {
  if (!actor) return false;
  if (actor.role === 'system' || actor.role === 'customer_self') return perm === 'system' || perm === '*customer';
  const u = S.users.find((x) => x.id === actor.id);
  const deny = u?.deny || [];
  if (deny.includes(perm)) return false;
  return (PERMISSIONS[perm] || []).includes(actor.role);
}

export function audit(S, ctx, e) {
  S.audit.push({
    id: nextId(S, 'AUD', 6),
    at: ctx.now,
    actorId: ctx.actor?.id || 'system',
    actorName: ctx.actor?.name || 'Система',
    role: ctx.actor?.role || 'system',
    objectType: e.objectType,
    objectId: e.objectId,
    action: e.action,
    reason: e.reason || '',
    before: e.before === undefined ? null : e.before,
    after: e.after === undefined ? null : e.after,
    denied: !!e.denied,
  });
}

function touch(S, ...datasets) {
  for (const d of datasets) if (!S._dirty.includes(d)) S._dirty.push(d);
}

export function emit(S, ctx, type, objectId, data = {}) {
  S.events.push({
    event_id: nextId(S, 'EVT', 7),
    type,
    occurred_at: new Date(ctx.now).toISOString(),
    object_id: objectId,
    version: data.version ?? 1,
    data,
    delivered: false,
    attempts: 0,
  });
}

function notify(S, ctx, customerId, orderId, kind, text, dedupeKey) {
  if (dedupeKey && S.notifications.some((n) => n.dedupeKey === dedupeKey)) return false; // защита от повторов
  S.notifications.push({ id: nextId(S, 'NTF', 6), at: ctx.now, customerId, orderId, kind, text, dedupeKey: dedupeKey || null });
  return true;
}

// ───────────────────────── выборки ─────────────────────────

export const variantBySku = (S, sku) => S.variants.find((v) => v.sku === sku);
export const cultivarOf = (S, v) => S.cultivars.find((c) => c.id === v?.cultivarId);
export const lotById = (S, id) => S.lots.find((l) => l.id === id);
export const orderById = (S, id) => S.orders.find((o) => o.id === id);
export const whById = (S, id) => S.warehouses.find((w) => w.id === id);

export function reservedOnLot(S, lotId) {
  return sum(S.reservations.filter((r) => r.lotId === lotId && r.state === 'active'), (r) => r.qty);
}
export function lotAvailable(S, lot) {
  return lot.qty - lot.quarantineQty - reservedOnLot(S, lot.id);
}
function sellableLots(S, sku) {
  return S.lots
    .filter((l) => l.sku === sku && whById(S, l.warehouseId)?.sellable !== false && whById(S, l.warehouseId)?.active !== false)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export function stockOf(S, sku) {
  const lots = S.lots.filter((l) => l.sku === sku);
  const sl = sellableLots(S, sku);
  return {
    physical: sum(lots, (l) => l.qty),
    quarantine: sum(lots, (l) => l.quarantineQty),
    reserved: sum(lots, (l) => reservedOnLot(S, l.id)),
    available: sum(sl, (l) => Math.max(0, lotAvailable(S, l))),
  };
}

// Ожидаемое от лабораторий (не путать с физическим остатком!)
export function incomingOf(S, sku) {
  let confirmedOpen = 0, unconfirmedOpen = 0, nearestDate = null;
  for (const b of S.batches) {
    if (['received', 'cancelled'].includes(b.status)) continue;
    for (const ln of b.lines) {
      if (ln.sku !== sku) continue;
      if (ln.confirmState === 'refused') continue;
      if (ln.confirmState === 'full' || ln.confirmState === 'partial') {
        confirmedOpen += ln.confirmedQty;
        if (b.plannedAt && (!nearestDate || b.plannedAt < nearestDate)) nearestDate = b.plannedAt;
      } else unconfirmedOpen += ln.orderedQty;
    }
  }
  // обещано покупателям по предзаказу, ещё не превращено в резерв
  const promised = sum(
    S.orders.flatMap((o) => o.lines).filter((l) => l.sku === sku && l.mode === 'preorder' && !['cancelled', 'replaced', 'shipped', 'reserved', 'shortage'].includes(l.status)),
    (l) => l.qty,
  );
  const allocated = sum(
    S.orders.flatMap((o) => o.lines).filter((l) => l.sku === sku && l.mode === 'preorder' && !['cancelled', 'replaced', 'shipped', 'reserved'].includes(l.status)),
    (l) => allocatedQty(l),
  );
  const confirmedFree = Math.max(0, confirmedOpen - allocated);
  const queuedUnallocated = promised - allocated;
  const preorderCap = Math.max(0, confirmedFree + unconfirmedOpen - Math.max(0, queuedUnallocated));
  return { confirmedOpen, unconfirmedOpen, promised, confirmedFree, preorderCap, nearestDate };
}

export const allocatedQty = (line) => sum(line.allocations || [], (a) => a.qty);
export const lineReserved = (S, line) =>
  sum(S.reservations.filter((r) => r.lineId === line.id && r.state === 'active'), (r) => r.qty);

export function availabilityStatus(S, v) {
  const st = stockOf(S, v.sku);
  if (st.available > 0) return { code: 'in_stock', label: 'В наличии', max: st.available, stock: st };
  const inc = incomingOf(S, v.sku);
  if (inc.confirmedFree > 0 && inc.preorderCap > 0)
    return { code: 'incoming', label: 'Ближайшее поступление', max: inc.preorderCap, date: inc.nearestDate, stock: st, inc };
  if (inc.unconfirmedOpen > 0 && inc.preorderCap > 0)
    return { code: 'preorder', label: 'Предзаказ', max: inc.preorderCap, stock: st, inc };
  return { code: 'out', label: 'Нет в наличии', max: 0, stock: st, inc };
}

export function orderTotals(S, o) {
  const active = o.lines.filter((l) => !['cancelled', 'replaced'].includes(l.status));
  const subtotal = sum(active, (l) => l.qty * l.unitPrice);
  const delivery = o.delivery?.price || 0;
  const total = round2(subtotal + delivery - (o.discount || 0));
  const pays = S.payments.filter((p) => p.orderId === o.id && p.state === 'confirmed');
  const paid = round2(sum(pays.filter((p) => p.kind === 'payment'), (p) => p.amount) - sum(pays.filter((p) => p.kind === 'refund'), (p) => p.amount));
  return { subtotal, delivery, total, paid, balance: round2(total - paid) };
}

export function orderStatus(S, o) {
  if (o.cancelled) return 'cancelled';
  const t = orderTotals(S, o);
  const lines = o.lines.filter((l) => !['cancelled', 'replaced'].includes(l.status));
  if (!lines.length) return 'cancelled';
  const ships = S.shipments.filter((s) => s.orderId === o.id);
  const allShipped = lines.every((l) => l.status === 'shipped');
  if (allShipped) {
    if (ships.length && ships.every((s) => s.status === 'received')) return 'delivered';
    return 'shipped';
  }
  if (lines.some((l) => l.status === 'shipped')) return 'partially_shipped';
  if (lines.some((l) => ['shortage', 'expired'].includes(l.status))) return 'needs_decision';
  if (t.paid <= 0) return 'awaiting_payment';
  if (t.balance > 0) return 'partially_paid';
  if (lines.some((l) => ['queued', 'confirmed', 'partial'].includes(l.status))) return 'awaiting_supply';
  return 'paid';
}

export function compensationBalance(S, customerId) {
  return round2(
    sum(S.compensations.filter((c) => c.customerId === customerId), (c) => (c.kind === 'grant' ? c.amount : -c.amount)),
  );
}

// ───────────────────────── исполнитель транзакций ─────────────────────────

export const OPS = {};

/**
 * run(state, ctx, opName, args) → { state, result }
 * Неуспех: выбрасывает DomainError; исходное состояние не меняется.
 * Отказ в правах: возвращается { state (с записью в аудит), error }.
 */
export function run(S0, ctx, opName, args = {}) {
  const op = OPS[opName];
  if (!op) throw new DomainError('UNKNOWN_OP', `Неизвестная операция ${opName}`);
  const c = { ...ctx, now: ctx.now ?? Date.now() };
  if (op.perm && op.perm !== 'public' && !can(S0, c.actor, op.perm)) {
    const S = clone(S0);
    audit(S, c, { objectType: 'permission', objectId: op.perm, action: `ОТКАЗ: ${op.title || opName}`, reason: 'Недостаточно прав', denied: true });
    touch(S, 'audit');
    const err = new DomainError('FORBIDDEN', `Операция «${op.title || opName}» недоступна для роли`, { state: S });
    throw err;
  }
  const S = clone(S0);
  S._dirty = [];
  const result = op.fn(S, c, args);
  return { state: S, result };
}

function def(name, perm, title, fn) {
  OPS[name] = { perm, title, fn };
}

// ───────────────────────── резервирование ─────────────────────────

function reserveFromStock(S, ctx, { sku, qty, orderId, lineId }) {
  const v = variantBySku(S, sku);
  need(v && v.active, 'SKU_INACTIVE', `Товар ${sku} недоступен`);
  let left = qty;
  const made = [];
  for (const lot of sellableLots(S, sku)) {
    if (left <= 0) break;
    const avail = lotAvailable(S, lot);
    if (avail <= 0) continue;
    const take = Math.min(avail, left);
    const r = {
      id: nextId(S, 'RSV', 6),
      orderId, lineId, lotId: lot.id, sku, warehouseId: lot.warehouseId, batchId: lot.batchId,
      qty: take, createdAt: ctx.now, expiresAt: ctx.now + S.settings.reserveHours * HOUR,
      state: 'active', extended: false, history: [{ at: ctx.now, state: 'active' }],
    };
    S.reservations.push(r);
    S.movements.push(mv(S, ctx, 'reserve', { sku, lotId: lot.id, qty: take, fromWh: lot.warehouseId, reason: `Заказ ${orderId}`, docRef: r.id }));
    made.push(r);
    left -= take;
  }
  need(left === 0, 'INSUFFICIENT_STOCK', `Недостаточно доступного остатка ${sku}: не хватает ${left}`, { sku, missing: left });
  for (const r of made) need(lotAvailable(S, lotById(S, r.lotId)) >= 0, 'NEGATIVE_STOCK', 'Отрицательный остаток запрещён');
  touch(S, 'reservations', 'stock', 'movements');
  return made;
}

function releaseReservation(S, ctx, r, state = 'released', reason = '') {
  if (r.state !== 'active') return;
  r.state = state;
  r.history.push({ at: ctx.now, state, reason });
  S.movements.push(mv(S, ctx, 'release', { sku: r.sku, lotId: r.lotId, qty: r.qty, fromWh: r.warehouseId, reason: reason || `Снятие резерва ${r.id}`, docRef: r.id }));
  touch(S, 'reservations', 'stock', 'movements');
}

function mv(S, ctx, type, f) {
  return {
    id: nextId(S, 'MOV', 6), type, at: ctx.now, sku: f.sku, lotId: f.lotId, batchId: f.batchId ?? lotById(S, f.lotId)?.batchId ?? null,
    qty: f.qty, fromWh: f.fromWh || null, toWh: f.toWh || null, reason: f.reason || '', docRef: f.docRef || null,
    actorId: ctx.actor?.id || 'system', actorName: ctx.actor?.name || 'Система',
  };
}

// ───────────────────────── каталог ─────────────────────────

def('catalog.update', 'catalog.edit', 'Изменение SKU', (S, ctx, { sku, patch, reason }) => {
  const v = variantBySku(S, sku);
  need(v, 'NOT_FOUND', 'SKU не найден');
  const allowed = ['title', 'price', 'description', 'active', 'restrictions', 'seoTitle', 'seoDescription', 'packSize', 'isNew', 'photo'];
  const before = {}, after = {};
  for (const k of Object.keys(patch)) {
    need(allowed.includes(k), 'FIELD_NOT_ALLOWED', `Поле ${k} нельзя менять`); // защита от mass assignment
    if (k === 'price') need(Number(patch.price) > 0, 'VALIDATION', 'Цена должна быть больше нуля');
    if (k === 'packSize') need(Number.isInteger(+patch.packSize) && +patch.packSize > 0, 'VALIDATION', 'Упаковка — целое > 0');
    if (v[k] !== patch[k]) { before[k] = v[k]; after[k] = patch[k]; }
  }
  if ('price' in after) {
    v.priceHistory.push({ price: +after.price, at: ctx.now, source: 'manual', actorId: ctx.actor.id });
    after.price = +after.price;
  }
  Object.assign(v, after);
  v.updatedAt = ctx.now;
  audit(S, ctx, { objectType: 'variant', objectId: sku, action: 'Изменение карточки', before, after, reason });
  touch(S, 'catalog', 'audit');
  return v;
});

// ───────────────────────── оформление заказа ─────────────────────────

def('checkout', 'public', 'Оформление заказа', (S, ctx, { clientToken, customer, items, delivery, consents, channel = 'site' }) => {
  // защита от двойного нажатия: тот же clientToken → тот же заказ
  if (clientToken && S.idempotency['checkout:' + clientToken]) {
    return { order: orderById(S, S.idempotency['checkout:' + clientToken]), duplicate: true };
  }
  need(items?.length, 'EMPTY_CART', 'Корзина пуста');
  need(customer?.name?.trim() && customer?.phone?.trim(), 'VALIDATION', 'Укажите имя и телефон');
  need(/^[+\d\s()-]{10,}$/.test(customer.phone), 'VALIDATION', 'Некорректный телефон');
  need(consents?.pd && consents?.offer, 'CONSENT_REQUIRED', 'Нужны согласия на обработку ПД и с офертой');
  const carrier = CARRIERS.find((c) => c.id === delivery?.carrier);
  need(carrier, 'VALIDATION', 'Выберите способ доставки');
  const hasLive = items.some((it) => CATEGORIES.find((c) => c.id === variantBySku(S, it.sku)?.category)?.live);
  if (hasLive && !carrier.live) need(delivery.riskAccepted, 'CARRIER_RISK', `${carrier.name} не рекомендован для живых растений — нужно подтверждение риска`);

  let cust = S.customers.find((c) => c.phone.replace(/\D/g, '') === customer.phone.replace(/\D/g, ''));
  if (!cust) {
    cust = { id: nextId(S, 'CUS'), name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email || '', consents: { ...consents, at: ctx.now }, externalIds: {}, createdAt: ctx.now, addresses: [] };
    S.customers.push(cust);
  }
  const order = {
    id: nextId(S, 'ORD'), channel, customerId: cust.id, createdAt: ctx.now, version: 1, lines: [], discount: 0,
    customerSnapshot: { name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email || '' },
    delivery: { carrier: carrier.id, address: delivery.address || '', price: carrier.price * (delivery.split ? 2 : 1), split: !!delivery.split, riskAccepted: !!delivery.riskAccepted, riskApprovedBy: null },
    shipException: null, cancelled: false, comment: '',
  };
  S.orders.push(order);
  for (const it of items) {
    const v = variantBySku(S, it.sku);
    need(v && v.active, 'SKU_INACTIVE', `Товар ${it.sku} снят с продажи`);
    const qty = Math.floor(+it.qty);
    need(qty > 0, 'VALIDATION', 'Количество должно быть больше нуля');
    const st = stockOf(S, v.sku);
    const fromStock = Math.min(st.available, qty);
    const rest = qty - fromStock;
    const snap = { sku: v.sku, title: v.title, packSize: v.packSize, saleUnit: v.saleUnit, category: v.category, unitPrice: v.price };
    if (fromStock > 0) {
      const line = { id: nextId(S, 'OLN', 6), ...snap, qty: fromStock, mode: 'stock', status: 'reserved', allocations: [] };
      order.lines.push(line);
      reserveFromStock(S, ctx, { sku: v.sku, qty: fromStock, orderId: order.id, lineId: line.id });
    }
    if (rest > 0) {
      const inc = incomingOf(S, v.sku);
      need(inc.preorderCap >= rest, 'INSUFFICIENT_STOCK', `«${v.title}»: доступно ${fromStock + inc.preorderCap}, запрошено ${qty}`, { sku: v.sku });
      order.lines.push({ id: nextId(S, 'OLN', 6), ...snap, qty: rest, mode: 'preorder', status: 'queued', allocations: [], queuedAt: ctx.now });
      // если у лаборатории уже есть подтверждённое свободное количество — распределяем сразу
      for (const b of S.batches.filter((b) => !['received', 'cancelled'].includes(b.status)))
        for (const ln of b.lines.filter((ln) => ln.sku === v.sku && ['full', 'partial'].includes(ln.confirmState))) allocatePreorders(S, ctx, b, ln);
    }
  }
  if (clientToken) S.idempotency['checkout:' + clientToken] = order.id;
  audit(S, ctx, { objectType: 'order', objectId: order.id, action: 'Создан заказ', after: { lines: order.lines.length, total: orderTotals(S, order).total } });
  emit(S, ctx, 'order.created', order.id, { order_id: order.id, version: order.version });
  notify(S, ctx, cust.id, order.id, 'order', `Заказ ${order.id} принят. Менеджер пришлёт ссылку на оплату.`);
  touch(S, 'orders', 'order_lines', 'audit');
  return { order, customer: cust, duplicate: false };
});

// ───────────────────────── платежи ─────────────────────────

def('payment.record', 'payment.record', 'Внесение платежа', (S, ctx, { orderId, providerRef, amount, method = 'card' }) => {
  const o = orderById(S, orderId);
  need(o, 'NOT_FOUND', 'Заказ не найден');
  need(providerRef, 'VALIDATION', 'Нужен идентификатор операции провайдера');
  const dup = S.payments.find((p) => p.providerRef === providerRef && p.kind === 'payment');
  if (dup) {
    audit(S, ctx, { objectType: 'payment', objectId: dup.id, action: 'Повторное уведомление проигнорировано', reason: providerRef });
    touch(S, 'audit');
    return { payment: dup, duplicate: true };
  }
  need(+amount > 0, 'VALIDATION', 'Сумма должна быть больше нуля');
  const before = orderTotals(S, o);
  const p = { id: nextId(S, 'PAY'), orderId, providerRef, amount: round2(+amount), method, kind: 'payment', state: 'confirmed', occurredAt: ctx.now };
  S.payments.push(p);
  // если резерв истёк к моменту оплаты — пробуем зарезервировать заново, иначе фиксируем дефицит
  for (const line of o.lines.filter((l) => l.status === 'expired')) tryReReserve(S, ctx, o, line);
  o.version++;
  audit(S, ctx, { objectType: 'order', objectId: orderId, action: 'Платёж подтверждён', before: { paid: before.paid }, after: { paid: orderTotals(S, o).paid }, reason: providerRef });
  emit(S, ctx, 'payment.confirmed', p.id, { payment_id: p.id, order_id: orderId, amount: p.amount, currency: 'RUB' });
  notify(S, ctx, o.customerId, o.id, 'payment', `Получена оплата ${p.amount} ₽ по заказу ${o.id}`);
  touch(S, 'payments', 'orders', 'audit');
  return { payment: p, duplicate: false };
});

function tryReReserve(S, ctx, o, line) {
  const st = stockOf(S, line.sku);
  if (st.available >= line.qty) {
    reserveFromStock(S, ctx, { sku: line.sku, qty: line.qty, orderId: o.id, lineId: line.id });
    line.status = 'reserved';
    return true;
  }
  line.status = 'shortage';
  emit(S, ctx, 'preorder.shortage', o.id, { order_id: o.id, missing_lines: [line.id], reason: 'reservation_expired' });
  return false;
}

def('refund.request', 'payment.refund', 'Запрос возврата', (S, ctx, { orderId, amount, reason }) => {
  const o = orderById(S, orderId);
  need(o, 'NOT_FOUND', 'Заказ не найден');
  need(reason?.trim(), 'REASON_REQUIRED', 'Укажите причину возврата');
  const t = orderTotals(S, o);
  const pending = sum(S.payments.filter((p) => p.orderId === orderId && p.kind === 'refund' && p.state === 'pending'), (p) => p.amount);
  need(+amount > 0 && +amount <= t.paid - pending, 'VALIDATION', `Возврат не больше оплаченного (${t.paid - pending} ₽)`);
  const r = { id: nextId(S, 'RFD'), orderId, providerRef: null, amount: round2(+amount), method: 'card', kind: 'refund', state: 'pending', occurredAt: ctx.now, reason };
  S.payments.push(r);
  audit(S, ctx, { objectType: 'refund', objectId: r.id, action: 'Возврат инициирован (ожидает провайдера)', after: { amount: r.amount }, reason });
  touch(S, 'payments', 'audit');
  return r;
});

def('refund.confirm', 'payment.refund', 'Подтверждение возврата провайдером', (S, ctx, { refundId, providerRef }) => {
  const r = S.payments.find((p) => p.id === refundId && p.kind === 'refund');
  need(r, 'NOT_FOUND', 'Возврат не найден');
  if (r.state === 'confirmed') return { refund: r, duplicate: true };
  need(providerRef, 'VALIDATION', 'Нужен ID операции возврата у провайдера');
  r.state = 'confirmed'; r.providerRef = providerRef; r.confirmedAt = ctx.now;
  const o = orderById(S, r.orderId); o.version++;
  audit(S, ctx, { objectType: 'refund', objectId: r.id, action: 'Возврат подтверждён провайдером', reason: providerRef });
  emit(S, ctx, 'payment.refunded', r.id, { refund_id: r.id, payment_id: r.id, order_id: r.orderId, amount: r.amount });
  touch(S, 'payments', 'orders', 'audit');
  return { refund: r, duplicate: false };
});

// ───────────────────────── компенсации и претензии ─────────────────────────

def('compensation.grant', 'compensation.grant', 'Начисление компенсации', (S, ctx, { customerId, amount, reason, claimId }) => {
  need(S.customers.find((c) => c.id === customerId), 'NOT_FOUND', 'Клиент не найден');
  need(+amount > 0, 'VALIDATION', 'Сумма > 0');
  need(reason?.trim(), 'REASON_REQUIRED', 'Нужно основание');
  if (claimId) need(!S.compensations.some((c) => c.claimId === claimId && c.kind === 'grant'), 'DUPLICATE', 'По этой претензии компенсация уже начислена');
  const c = { id: nextId(S, 'CMP'), customerId, kind: 'grant', amount: round2(+amount), reason, claimId: claimId || null, at: ctx.now, approvedBy: ctx.actor.id };
  S.compensations.push(c);
  audit(S, ctx, { objectType: 'compensation', objectId: c.id, action: 'Начислена компенсация', after: { amount: c.amount, balance: compensationBalance(S, customerId) }, reason });
  touch(S, 'claims', 'audit');
  return c;
});

def('compensation.use', 'payment.record', 'Списание компенсации в оплату', (S, ctx, { orderId, amount }) => {
  const o = orderById(S, orderId);
  need(o, 'NOT_FOUND', 'Заказ не найден');
  const bal = compensationBalance(S, o.customerId);
  const t = orderTotals(S, o);
  need(+amount > 0 && +amount <= bal, 'INSUFFICIENT_BALANCE', `Баланс компенсаций ${bal} ₽`);
  need(+amount <= t.balance, 'VALIDATION', 'Больше остатка к оплате');
  const c = { id: nextId(S, 'CMP'), customerId: o.customerId, kind: 'use', amount: round2(+amount), orderId, at: ctx.now, reason: `Оплата заказа ${orderId}` };
  S.compensations.push(c);
  S.payments.push({ id: nextId(S, 'PAY'), orderId, providerRef: c.id, amount: c.amount, method: 'compensation', kind: 'payment', state: 'confirmed', occurredAt: ctx.now });
  o.version++;
  audit(S, ctx, { objectType: 'compensation', objectId: c.id, action: 'Компенсация списана в оплату', after: { amount: c.amount } });
  touch(S, 'payments', 'orders', 'claims', 'audit');
  return c;
});

def('claim.open', 'public', 'Претензия покупателя', (S, ctx, { orderId, lineId, reason, message, photos = 0, customerId }) => {
  const o = orderById(S, orderId);
  need(o && o.customerId === customerId, 'NOT_FOUND', 'Заказ не найден'); // не раскрываем чужие заказы
  need(reason, 'VALIDATION', 'Укажите причину');
  const c = { id: nextId(S, 'CLM'), orderId, lineId: lineId || null, customerId, reason, message: message || '', photos, state: 'open', decision: null, amount: 0, approvedBy: null, openedAt: ctx.now };
  S.claims.push(c);
  audit(S, ctx, { objectType: 'claim', objectId: c.id, action: 'Открыта претензия', reason });
  emit(S, ctx, 'claim.opened', c.id, { claim_id: c.id, order_id: orderId });
  touch(S, 'claims', 'audit');
  return c;
});

def('claim.decide', 'claim.decide', 'Решение по претензии', (S, ctx, { claimId, decision, amount = 0, comment }) => {
  const c = S.claims.find((x) => x.id === claimId);
  need(c, 'NOT_FOUND', 'Претензия не найдена');
  need(c.state === 'open', 'STATE', 'Претензия уже закрыта');
  need(['reject', 'compensation', 'refund', 'replacement'].includes(decision), 'VALIDATION', 'Неизвестное решение');
  c.state = 'decided'; c.decision = decision; c.amount = +amount || 0; c.approvedBy = ctx.actor.id; c.decidedAt = ctx.now; c.comment = comment || '';
  if (decision === 'compensation') {
    need(can(S, ctx.actor, 'compensation.grant'), 'FORBIDDEN', 'Компенсацию начисляет руководитель или владелец');
    OPS['compensation.grant'].fn(S, ctx, { customerId: c.customerId, amount, reason: `Претензия ${c.id}`, claimId: c.id });
  }
  audit(S, ctx, { objectType: 'claim', objectId: c.id, action: 'Решение по претензии', after: { decision, amount } , reason: comment });
  touch(S, 'claims', 'audit');
  return c;
});

// ───────────────────────── замены ─────────────────────────

def('replacement.createLink', 'order.edit', 'Ссылка на выбор замены', (S, ctx, { orderId, lineId, hours = 72 }) => {
  const o = orderById(S, orderId);
  const line = o?.lines.find((l) => l.id === lineId);
  need(line, 'NOT_FOUND', 'Позиция не найдена');
  need(['shortage', 'partial', 'expired', 'queued'].includes(line.status), 'STATE', 'Замена доступна для позиций с дефицитом');
  for (const t of S.replacementTokens.filter((t) => t.lineId === lineId && !t.used)) t.revoked = true;
  const t = { token: randomToken(28), orderId, lineId, createdAt: ctx.now, expiresAt: ctx.now + hours * HOUR, used: false, revoked: false };
  S.replacementTokens.push(t);
  audit(S, ctx, { objectType: 'order', objectId: orderId, action: 'Создана ссылка на замену', after: { lineId, expiresAt: t.expiresAt } });
  notify(S, ctx, o.customerId, orderId, 'replacement', `По заказу ${orderId} нужно выбрать замену — персональная ссылка действует ${hours} ч.`);
  touch(S, 'audit');
  return t;
});

export function replacementContext(S, token, now) {
  const t = S.replacementTokens.find((x) => x.token === token);
  if (!t) return { error: 'Ссылка недействительна' };
  if (t.revoked) return { error: 'Ссылка отозвана — запросите новую у менеджера' };
  if (t.used) return { error: 'Ссылка уже использована' };
  if (now > t.expiresAt) return { error: 'Срок действия ссылки истёк' };
  const o = orderById(S, t.orderId);
  const line = o.lines.find((l) => l.id === t.lineId);
  const missing = line.qty;
  const options = S.variants
    .filter((v) => v.active && v.sku !== line.sku && v.category === line.category && stockOf(S, v.sku).available >= missing)
    .slice(0, 12);
  return { t, order: { id: o.id }, line, options };
}

def('replacement.accept', 'public', 'Покупатель выбрал замену', (S, ctx, { token, sku }) => {
  const rc = replacementContext(S, token, ctx.now);
  need(!rc.error, 'TOKEN_INVALID', rc.error || '');
  need(rc.options.some((v) => v.sku === sku), 'NOT_ALLOWED', 'Этот товар недоступен для замены');
  const o = orderById(S, rc.t.orderId);
  const old = o.lines.find((l) => l.id === rc.t.lineId);
  const before = orderTotals(S, o);
  // атомарно: снять старые резервы/распределения → поставить новый резерв
  for (const r of S.reservations.filter((r) => r.lineId === old.id && r.state === 'active')) releaseReservation(S, ctx, r, 'released', 'Замена позиции');
  old.allocations = [];
  old.status = 'replaced';
  const v = variantBySku(S, sku);
  const nl = { id: nextId(S, 'OLN', 6), sku: v.sku, title: v.title, packSize: v.packSize, saleUnit: v.saleUnit, category: v.category, unitPrice: v.price, qty: old.qty, mode: 'stock', status: 'reserved', allocations: [], replacesLineId: old.id };
  o.lines.push(nl);
  reserveFromStock(S, ctx, { sku, qty: nl.qty, orderId: o.id, lineId: nl.id });
  rc.t.used = true; rc.t.usedAt = ctx.now;
  o.version++;
  const after = orderTotals(S, o);
  const difference = round2(after.total - before.total);
  audit(S, ctx, { objectType: 'order', objectId: o.id, action: 'Замена позиции', before: { line: old.id, sku: old.sku, total: before.total }, after: { line: nl.id, sku, total: after.total, difference } });
  emit(S, ctx, 'replacement.confirmed', o.id, { order_id: o.id, old_line: old.id, new_line: nl.id, difference, version: o.version });
  notify(S, ctx, o.customerId, o.id, 'replacement', difference > 0 ? `Замена принята. Доплата ${difference} ₽.` : difference < 0 ? `Замена принята. К возврату/компенсации ${-difference} ₽.` : 'Замена принята, сумма не изменилась.');
  touch(S, 'orders', 'order_lines', 'audit');
  return { order: o, newLine: nl, difference };
});

// ───────────────────────── поставки и предзаказы ─────────────────────────

def('supply.create', 'supply.edit', 'Создание поставки', (S, ctx, { supplierId, plannedAt, logisticsCost = 0, lines, comment }) => {
  need(S.suppliers.find((s) => s.id === supplierId), 'NOT_FOUND', 'Лаборатория не найдена');
  need(lines?.length, 'VALIDATION', 'Добавьте позиции');
  const b = {
    id: nextId(S, 'SUP', 4), supplierId, orderedAt: ctx.now, plannedAt: plannedAt || null, receivedAt: null, status: 'ordered', currency: 'RUB',
    logisticsCost: +logisticsCost || 0, attachments: [], comment: comment || '', version: 1, costClosed: false, createdBy: ctx.actor.id,
    lines: lines.map((l) => {
      need(variantBySku(S, l.sku), 'NOT_FOUND', `SKU ${l.sku} не найден`);
      need(+l.orderedQty > 0, 'VALIDATION', 'Количество > 0');
      return { id: nextId(S, 'BLN', 5), sku: l.sku, orderedQty: +l.orderedQty, confirmedQty: 0, receivedQty: 0, rejectedQty: 0, unitCost: +l.unitCost || 0, confirmState: 'waiting', history: [] };
    }),
  };
  S.batches.push(b);
  for (const l of b.lines) { const v = variantBySku(S, l.sku); if (v && !v.active) v.active = true; }
  audit(S, ctx, { objectType: 'batch', objectId: b.id, action: 'Создана поставка', after: { lines: b.lines.length } });
  touch(S, 'supplies', 'audit');
  return b;
});

def('supply.confirmLine', 'supply.confirm', 'Подтверждение лаборатории', (S, ctx, { batchId, lineId, state, confirmedQty, note }) => {
  const b = S.batches.find((x) => x.id === batchId);
  const ln = b?.lines.find((l) => l.id === lineId);
  need(ln, 'NOT_FOUND', 'Позиция поставки не найдена');
  need(!['received', 'cancelled'].includes(b.status), 'STATE', 'Поставка закрыта');
  need(['full', 'partial', 'refused', 'waiting'].includes(state), 'VALIDATION', 'Неизвестный ответ');
  const qty = state === 'full' ? ln.orderedQty : state === 'refused' || state === 'waiting' ? 0 : Math.floor(+confirmedQty);
  if (state === 'partial') need(qty > 0 && qty < ln.orderedQty, 'VALIDATION', 'Частичное подтверждение: от 1 до заказанного − 1');
  const before = { state: ln.confirmState, qty: ln.confirmedQty };
  ln.confirmState = state; ln.confirmedQty = qty;
  ln.history.push({ at: ctx.now, state, qty, note: note || '', actorId: ctx.actor.id });
  b.status = b.lines.every((l) => l.confirmState !== 'waiting') ? 'confirmed' : 'partially_confirmed';
  b.version++;
  audit(S, ctx, { objectType: 'batch_line', objectId: ln.id, action: 'Ответ лаборатории', before, after: { state, qty }, reason: note });
  const res = allocatePreorders(S, ctx, b, ln);
  touch(S, 'supplies', 'orders', 'order_lines', 'audit');
  return res;
});

// Распределение только реально подтверждённого количества по очереди (FIFO по времени заказа)
function allocatePreorders(S, ctx, b, ln) {
  // пересобираем распределение этой позиции поставки с нуля
  const lines = S.orders.filter((o) => !o.cancelled).flatMap((o) => o.lines.map((l) => ({ o, l })))
    .filter(({ l }) => l.sku === ln.sku && l.mode === 'preorder' && ['queued', 'confirmed', 'partial', 'shortage'].includes(l.status));
  for (const { l } of lines) l.allocations = (l.allocations || []).filter((a) => a.batchLineId !== ln.id);
  let pool = ln.confirmedQty;
  const queue = lines
    .filter(({ l }) => !l.excluded)
    .sort((a, b2) => (a.l.priority || 0) - (b2.l.priority || 0) || a.o.createdAt - b2.o.createdAt || a.l.id.localeCompare(b2.l.id));
  const allocated = [];
  for (const { o, l } of queue) {
    const need_ = l.qty - allocatedQty(l);
    if (need_ <= 0) continue;
    if (pool <= 0) continue;
    const give = Math.min(need_, pool);
    if (give < need_ && !S.settings.partialFifo) continue;
    l.allocations.push({ batchLineId: ln.id, batchId: b.id, qty: give, at: ctx.now });
    pool -= give;
    allocated.push({ orderId: o.id, lineId: l.id, qty: give });
  }
  const finalAnswer = ln.confirmState !== 'waiting';
  const otherOpen = S.batches.some((bb) => !['received', 'cancelled'].includes(bb.status) && bb.lines.some((x) => x.sku === ln.sku && x.id !== ln.id && x.confirmState === 'waiting'));
  for (const { o, l } of lines) {
    const a = allocatedQty(l);
    if (a >= l.qty) l.status = 'confirmed';
    else if (a > 0) l.status = 'partial';
    else l.status = finalAnswer && !otherOpen ? 'shortage' : 'queued';
    if (finalAnswer && !otherOpen && a < l.qty) {
      emit(S, ctx, 'preorder.shortage', o.id, { batch_id: b.id, order_id: o.id, missing_lines: [{ line_id: l.id, missing: l.qty - a }] });
    }
  }
  return { allocated, unallocatedPool: pool, waiting: lines.filter(({ l }) => allocatedQty(l) < l.qty).map(({ o, l }) => ({ orderId: o.id, lineId: l.id, missing: l.qty - allocatedQty(l) })) };
}

def('allocation.exclude', 'allocation.manual', 'Ручное исключение из очереди', (S, ctx, { orderId, lineId, excluded, reason }) => {
  need(reason?.trim(), 'REASON_REQUIRED', 'Ручное изменение очереди требует причины');
  const l = orderById(S, orderId)?.lines.find((x) => x.id === lineId);
  need(l, 'NOT_FOUND', 'Позиция не найдена');
  const before = { excluded: !!l.excluded };
  l.excluded = !!excluded;
  audit(S, ctx, { objectType: 'order_line', objectId: lineId, action: excluded ? 'Исключено из очереди' : 'Возвращено в очередь', before, after: { excluded: l.excluded }, reason });
  for (const b of S.batches) for (const ln of b.lines) if (ln.sku === l.sku && ln.confirmState !== 'waiting' && !['received', 'cancelled'].includes(b.status)) allocatePreorders(S, ctx, b, ln);
  touch(S, 'order_lines', 'audit');
  return l;
});

// Приёмка: только здесь увеличивается физический остаток
def('supply.receive', 'supply.receive', 'Физическая приёмка', (S, ctx, { batchId, warehouseId, lines }) => {
  const b = S.batches.find((x) => x.id === batchId);
  need(b, 'NOT_FOUND', 'Поставка не найдена');
  need(b.status !== 'received', 'STATE', 'Поставка уже принята');
  const wh = whById(S, warehouseId);
  need(wh?.active, 'NOT_FOUND', 'Склад не найден');
  for (const r of lines) {
    const ln = b.lines.find((l) => l.id === r.lineId);
    need(ln, 'NOT_FOUND', 'Позиция не найдена');
    const rec = Math.floor(+r.receivedQty || 0), def_ = Math.floor(+r.defectQty || 0);
    need(rec >= 0 && def_ >= 0 && def_ <= rec, 'VALIDATION', 'Брак не больше принятого');
    ln.receivedQty = rec; ln.rejectedQty = def_;
  }
  b.status = 'received'; b.receivedAt = ctx.now; b.receivedTo = warehouseId; b.version++;
  const costs = batchUnitCosts(S, b);
  const lotsMade = [];
  for (const ln of b.lines) {
    if (ln.receivedQty <= 0) continue;
    const lot = { id: nextId(S, 'LOT', 5), warehouseId, batchId: b.id, sku: ln.sku, qty: ln.receivedQty, quarantineQty: ln.rejectedQty, unitCost: costs[ln.id], costVersion: 1, origin: 'supply', createdAt: ctx.now };
    S.lots.push(lot);
    lotsMade.push(lot);
    S.movements.push(mv(S, ctx, 'receipt', { sku: ln.sku, lotId: lot.id, qty: ln.receivedQty, toWh: warehouseId, reason: `Приёмка ${b.id}`, docRef: b.id }));
    if (ln.rejectedQty) S.movements.push(mv(S, ctx, 'quarantine', { sku: ln.sku, lotId: lot.id, qty: ln.rejectedQty, fromWh: warehouseId, reason: 'Брак при приёмке', docRef: b.id }));
    // превращаем подтверждённые предзаказы в резервы (по очереди), сколько реально пришло годного
    let sellable = ln.receivedQty - ln.rejectedQty;
    const queue = S.orders.filter((o) => !o.cancelled).flatMap((o) => o.lines.map((l) => ({ o, l })))
      .filter(({ l }) => (l.allocations || []).some((a) => a.batchLineId === ln.id) && !['cancelled', 'replaced', 'shipped'].includes(l.status))
      .sort((a, b2) => a.o.createdAt - b2.o.createdAt);
    for (const { o, l } of queue) {
      const a = l.allocations.find((x) => x.batchLineId === ln.id);
      const give = Math.min(a.qty, sellable);
      a.received = give;
      if (give > 0) {
        reserveFromStock(S, ctx, { sku: l.sku, qty: give, orderId: o.id, lineId: l.id });
        sellable -= give;
      }
      const reserved = lineReserved(S, l);
      l.status = reserved >= l.qty ? 'reserved' : 'shortage';
      if (l.status === 'shortage') emit(S, ctx, 'preorder.shortage', o.id, { batch_id: b.id, order_id: o.id, missing_lines: [{ line_id: l.id, missing: l.qty - reserved }] });
      else notify(S, ctx, o.customerId, o.id, 'supply', `Товар «${l.title}» по предзаказу поступил на склад и зарезервирован за вами.`);
    }
  }
  audit(S, ctx, { objectType: 'batch', objectId: b.id, action: 'Физическая приёмка', after: b.lines.map((l) => ({ sku: l.sku, received: l.receivedQty, defect: l.rejectedQty })) });
  touch(S, 'supplies', 'stock', 'movements', 'reservations', 'orders', 'order_lines', 'audit');
  return { batch: b, lots: lotsMade };
});

// Себестоимость единицы: закупка + распределённые входящая логистика и прямые расходы на поставку
export function batchUnitCosts(S, b) {
  const extra = (b.logisticsCost || 0) + sum(S.expenses.filter((e) => e.allocation?.type === 'batch' && e.allocation.id === b.id), (e) => e.amount);
  const base = b.lines.map((l) => ({ l, qty: l.receivedQty || l.confirmedQty || l.orderedQty }));
  const method = S.settings.logisticsMethod;
  const weightTotal = sum(base, (x) => (method === 'qty' ? x.qty : x.qty * x.l.unitCost));
  const out = {};
  for (const { l, qty } of base) {
    const w = method === 'qty' ? qty : qty * l.unitCost;
    const share = weightTotal > 0 ? (extra * w) / weightTotal : 0;
    out[l.id] = qty > 0 ? round2(l.unitCost + share / qty) : l.unitCost;
  }
  return out;
}

function recostBatch(S, ctx, b, reason) {
  const costs = batchUnitCosts(S, b);
  for (const lot of S.lots.filter((l) => l.batchId === b.id && l.origin === 'supply')) {
    const ln = b.lines.find((x) => x.sku === lot.sku);
    if (!ln) continue;
    const before = lot.unitCost;
    lot.unitCost = costs[ln.id];
    lot.costVersion = (lot.costVersion || 1) + 1;
    audit(S, ctx, { objectType: 'lot', objectId: lot.id, action: 'Пересчёт себестоимости партии', before: { unitCost: before }, after: { unitCost: lot.unitCost, version: lot.costVersion }, reason });
  }
}

def('supply.closeCost', 'finance.edit', 'Закрытие себестоимости поставки', (S, ctx, { batchId }) => {
  const b = S.batches.find((x) => x.id === batchId);
  need(b?.status === 'received', 'STATE', 'Закрыть себестоимость можно после приёмки');
  b.costClosed = true;
  audit(S, ctx, { objectType: 'batch', objectId: b.id, action: 'Себестоимость зафиксирована как фактическая' });
  touch(S, 'supplies', 'audit');
  return b;
});

// ───────────────────────── склад ─────────────────────────

def('stock.transfer', 'stock.move', 'Перемещение', (S, ctx, { lotId, qty, toWarehouseId, reason }) => {
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  const to = whById(S, toWarehouseId);
  need(to?.active && to.id !== lot.warehouseId, 'VALIDATION', 'Выберите другой активный склад');
  qty = Math.floor(+qty);
  need(qty > 0 && qty <= lotAvailable(S, lot), 'INSUFFICIENT_STOCK', `Можно переместить не больше доступного (${lotAvailable(S, lot)})`);
  lot.qty -= qty;
  let dst = S.lots.find((l) => l.warehouseId === to.id && l.sku === lot.sku && l.batchId === lot.batchId && l.unitCost === lot.unitCost && l.origin === lot.origin);
  if (!dst) {
    dst = { ...lot, id: nextId(S, 'LOT', 5), warehouseId: to.id, qty: 0, quarantineQty: 0, createdAt: lot.createdAt, parentLotId: lot.id };
    S.lots.push(dst);
  }
  dst.qty += qty;
  S.movements.push(mv(S, ctx, 'transfer_out', { sku: lot.sku, lotId: lot.id, qty, fromWh: lot.warehouseId, toWh: to.id, reason }));
  S.movements.push(mv(S, ctx, 'transfer_in', { sku: lot.sku, lotId: dst.id, qty, fromWh: lot.warehouseId, toWh: to.id, reason }));
  audit(S, ctx, { objectType: 'lot', objectId: lot.id, action: 'Перемещение', after: { qty, to: to.id }, reason });
  touch(S, 'stock', 'movements', 'audit');
  return dst;
});

def('stock.quarantine', 'stock.quarantine', 'Карантин', (S, ctx, { lotId, qty, release = false, reason }) => {
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  need(reason?.trim(), 'REASON_REQUIRED', 'Укажите причину');
  qty = Math.floor(+qty);
  if (release) need(qty > 0 && qty <= lot.quarantineQty, 'VALIDATION', 'Больше, чем в карантине');
  else need(qty > 0 && qty <= lotAvailable(S, lot), 'INSUFFICIENT_STOCK', 'В карантин можно перевести только свободный остаток');
  const before = { quarantine: lot.quarantineQty };
  lot.quarantineQty += release ? -qty : qty;
  S.movements.push(mv(S, ctx, release ? 'quarantine_release' : 'quarantine', { sku: lot.sku, lotId, qty, fromWh: lot.warehouseId, reason }));
  audit(S, ctx, { objectType: 'lot', objectId: lotId, action: release ? 'Снят карантин' : 'Карантин', before, after: { quarantine: lot.quarantineQty }, reason });
  touch(S, 'stock', 'movements', 'audit');
  return lot;
});

def('stock.writeoff', 'stock.writeoff', 'Списание', (S, ctx, { lotId, qty, fromQuarantine = false, reason }) => {
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  need(reason?.trim(), 'REASON_REQUIRED', 'Списание требует причины');
  qty = Math.floor(+qty);
  const max = fromQuarantine ? lot.quarantineQty : lotAvailable(S, lot);
  need(qty > 0 && qty <= max, 'INSUFFICIENT_STOCK', `Можно списать не больше ${max}`);
  const before = { qty: lot.qty, quarantine: lot.quarantineQty };
  lot.qty -= qty;
  if (fromQuarantine) lot.quarantineQty -= qty;
  need(lot.qty >= 0 && lotAvailable(S, lot) >= 0, 'NEGATIVE_STOCK', 'Отрицательный остаток запрещён');
  S.movements.push(mv(S, ctx, 'writeoff', { sku: lot.sku, lotId, qty, fromWh: lot.warehouseId, reason }));
  audit(S, ctx, { objectType: 'lot', objectId: lotId, action: 'Списание', before, after: { qty: lot.qty, quarantine: lot.quarantineQty }, reason });
  touch(S, 'stock', 'movements', 'audit');
  return lot;
});

def('inventory.count', 'stock.inventory', 'Ввод инвентаризации', (S, ctx, { lotId, actualQty, comment }) => {
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  const actual = Math.floor(+actualQty);
  need(actual >= 0, 'VALIDATION', 'Факт ≥ 0');
  const doc = { id: nextId(S, 'INV', 4), lotId, warehouseId: lot.warehouseId, sku: lot.sku, at: ctx.now, expectedQty: lot.qty, actualQty: actual, diff: actual - lot.qty, state: actual === lot.qty ? 'matched' : 'pending', comment: comment || '', countedBy: ctx.actor.id };
  S.inventories.push(doc);
  audit(S, ctx, { objectType: 'inventory', objectId: doc.id, action: 'Пересчёт партии', after: { expected: doc.expectedQty, actual, diff: doc.diff } });
  touch(S, 'audit');
  return doc;
});

def('inventory.approve', 'stock.inventory.approve', 'Утверждение корректировки', (S, ctx, { inventoryId, reason }) => {
  const doc = S.inventories.find((x) => x.id === inventoryId);
  need(doc?.state === 'pending', 'STATE', 'Нет ожидающей корректировки');
  need(reason?.trim(), 'REASON_REQUIRED', 'Корректировка требует причины');
  const lot = lotById(S, doc.lotId);
  const reserved = reservedOnLot(S, lot.id);
  need(doc.actualQty >= reserved + lot.quarantineQty, 'CONFLICT_RESERVED', `Факт меньше резервов и карантина (${reserved + lot.quarantineQty}) — сначала решите судьбу резервов`);
  const before = lot.qty;
  const delta = doc.actualQty - lot.qty;
  lot.qty = doc.actualQty;
  doc.state = 'approved'; doc.approvedBy = ctx.actor.id; doc.approvedAt = ctx.now;
  S.movements.push(mv(S, ctx, 'inventory_adjust', { sku: lot.sku, lotId: lot.id, qty: delta, fromWh: lot.warehouseId, reason, docRef: doc.id }));
  audit(S, ctx, { objectType: 'lot', objectId: lot.id, action: 'Корректировка по инвентаризации', before: { qty: before }, after: { qty: lot.qty }, reason });
  touch(S, 'stock', 'movements', 'audit');
  return doc;
});

def('reservation.extend', 'reservation.extend', 'Продление резерва', (S, ctx, { reservationId }) => {
  const r = S.reservations.find((x) => x.id === reservationId);
  need(r?.state === 'active', 'STATE', 'Резерв не активен');
  need(!r.extended, 'STATE', 'Резерв уже продлевался');
  const before = r.expiresAt;
  r.expiresAt += EXTEND_HOURS * HOUR; r.extended = true;
  r.history.push({ at: ctx.now, state: 'extended' });
  audit(S, ctx, { objectType: 'reservation', objectId: r.id, action: 'Продление резерва на 48 ч', before: { expiresAt: before }, after: { expiresAt: r.expiresAt } });
  touch(S, 'reservations', 'audit');
  return r;
});

// Фоновое задание: истечение резервов, напоминания, (в бою — по расписанию с блокировкой строки)
def('jobs.tick', 'public', 'Фоновые задания', (S, ctx) => {
  let expired = 0, reminders = 0;
  for (const r of S.reservations.filter((r) => r.state === 'active')) {
    const o = orderById(S, r.orderId);
    const t = o ? orderTotals(S, o) : null;
    if (t && t.balance <= 0) continue; // оплаченные резервы не истекают
    if (r.expiresAt <= ctx.now) {
      releaseReservation(S, ctx, r, 'expired', 'Истёк срок резерва');
      const line = o?.lines.find((l) => l.id === r.lineId);
      if (line && line.status === 'reserved') line.status = 'expired';
      expired++;
    } else if (r.expiresAt - ctx.now <= 12 * HOUR && !r.warned) {
      r.warned = true;
      emit(S, ctx, 'reservation.expiring', r.id, { reservation_id: r.id, expires_at: new Date(r.expiresAt).toISOString() });
    }
  }
  for (const sh of S.shipments.filter((s) => s.status === 'arrived')) {
    if (ctx.now - sh.arrivedAt >= 3 * DAY) {
      if (notify(S, ctx, orderById(S, sh.orderId)?.customerId, sh.orderId, 'reminder', `Посылка ${sh.tracking} ждёт вас в пункте выдачи третий день.`, `remind3:${sh.id}`)) reminders++;
    }
  }
  if (expired) { audit(S, { ...ctx, actor: { id: 'system', name: 'Фоновое задание', role: 'system' } }, { objectType: 'reservation', objectId: '*', action: `Истекло резервов: ${expired}` }); touch(S, 'orders', 'audit'); }
  return { expired, reminders };
});

// ───────────────────────── адаптация ─────────────────────────

def('adaptation.start', 'adaptation.manage', 'Передача в адаптацию', (S, ctx, { lotId, packs, location, substrate, responsible, toWarehouseId }) => {
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  const v = variantBySku(S, lot.sku);
  need(v.category === 'microclone', 'VALIDATION', 'В адаптацию передаются микроклоны');
  packs = Math.floor(+packs);
  need(packs > 0 && packs <= lotAvailable(S, lot), 'INSUFFICIENT_STOCK', `Доступно упаковок: ${lotAvailable(S, lot)}`);
  lot.qty -= packs; // исходный товар больше нельзя продать
  const a = {
    id: nextId(S, 'ADP', 4), sourceLotId: lot.id, sourceBatchId: lot.batchId, sku: lot.sku, cultivarId: v.cultivarId,
    inputPacks: packs, packSize: v.packSize, inputPlants: packs * v.packSize, inputCost: round2(packs * lot.unitCost),
    startedAt: ctx.now, location: location || 'Зона адаптации', substrate: substrate || '', responsible: responsible || ctx.actor.name,
    losses: [], status: 'in_progress', warehouseId: toWarehouseId || S.warehouses.find((w) => w.type === 'adaptation')?.id,
    outputSku: null, outputQty: 0, outputLotId: null, unitCost: null,
  };
  S.adaptations.push(a);
  S.movements.push(mv(S, ctx, 'to_adaptation', { sku: lot.sku, lotId: lot.id, qty: packs, fromWh: lot.warehouseId, toWh: a.warehouseId, reason: `Адаптация ${a.id}`, docRef: a.id }));
  audit(S, ctx, { objectType: 'adaptation', objectId: a.id, action: 'Передача в адаптацию', after: { packs, plants: a.inputPlants, cost: a.inputCost } });
  touch(S, 'adaptation', 'stock', 'movements', 'audit');
  return a;
});

export function adaptationCost(S, a) {
  const materials = sum(S.expenses.filter((e) => e.allocation?.type === 'adaptation' && e.allocation.id === a.id), (e) => e.amount);
  const lost = sum(a.losses, (l) => l.qty);
  const alive = a.inputPlants - lost;
  const total = round2(a.inputCost + materials);
  return { materials, lost, alive, total, perPlant: alive > 0 ? round2(total / alive) : null };
}

def('adaptation.loss', 'adaptation.manage', 'Потери в адаптации', (S, ctx, { adaptationId, qty, reason }) => {
  const a = S.adaptations.find((x) => x.id === adaptationId);
  need(a?.status === 'in_progress', 'STATE', 'Адаптация не активна');
  qty = Math.floor(+qty);
  const { alive } = adaptationCost(S, a);
  need(qty > 0 && qty <= alive, 'VALIDATION', `Потери от 1 до ${alive}`);
  need(reason?.trim(), 'REASON_REQUIRED', 'Укажите причину потерь');
  a.losses.push({ qty, reason, at: ctx.now, actorId: ctx.actor.id });
  audit(S, ctx, { objectType: 'adaptation', objectId: a.id, action: 'Потери', after: { qty }, reason });
  touch(S, 'adaptation', 'audit');
  return a;
});

def('adaptation.material', 'adaptation.manage', 'Материалы адаптации', (S, ctx, { adaptationId, name, amount }) => {
  const a = S.adaptations.find((x) => x.id === adaptationId);
  need(a?.status === 'in_progress', 'STATE', 'Адаптация не активна');
  need(+amount > 0 && name?.trim(), 'VALIDATION', 'Название и сумма');
  const e = { id: nextId(S, 'EXP'), occurredAt: ctx.now, amount: round2(+amount), category: 'materials', type: 'direct', allocation: { type: 'adaptation', id: a.id }, comment: name, documentRef: null, authorId: ctx.actor.id, status: 'fact' };
  S.expenses.push(e);
  audit(S, ctx, { objectType: 'adaptation', objectId: a.id, action: 'Материалы', after: { name, amount: e.amount } });
  touch(S, 'adaptation', 'expenses', 'audit');
  return e;
});

def('adaptation.complete', 'adaptation.manage', 'Завершение адаптации', (S, ctx, { adaptationId, title, price, warehouseId, photo }) => {
  const a = S.adaptations.find((x) => x.id === adaptationId);
  need(a?.status === 'in_progress', 'STATE', 'Адаптация не активна');
  const c = adaptationCost(S, a);
  need(c.alive > 0, 'VALIDATION', 'Нет выживших растений');
  need(+price > 0, 'VALIDATION', 'Укажите розничную цену');
  const wh = warehouseId || S.warehouses.find((w) => w.type === 'main')?.id;
  let v = S.variants.find((x) => x.cultivarId === a.cultivarId && x.category === 'adapted' && !x.isIndividual);
  if (!v) {
    const cv = S.cultivars.find((x) => x.id === a.cultivarId);
    v = makeVariant(S, ctx, { cultivarId: a.cultivarId, category: 'adapted', packSize: 1, saleUnit: 'шт', price: +price, title: title || `${cv.genus} ${cv.name} — адаптированное растение` });
  }
  const lot = { id: nextId(S, 'LOT', 5), warehouseId: wh, batchId: a.sourceBatchId, adaptationId: a.id, sku: v.sku, qty: c.alive, quarantineQty: 0, unitCost: c.perPlant, costVersion: 1, origin: 'adaptation', createdAt: ctx.now };
  S.lots.push(lot);
  Object.assign(a, { status: 'completed', completedAt: ctx.now, outputSku: v.sku, outputQty: c.alive, outputLotId: lot.id, unitCost: c.perPlant, totalCost: c.total });
  S.movements.push(mv(S, ctx, 'from_adaptation', { sku: v.sku, lotId: lot.id, qty: c.alive, toWh: wh, reason: `Адаптация ${a.id}`, docRef: a.id }));
  audit(S, ctx, { objectType: 'adaptation', objectId: a.id, action: 'Адаптация завершена', after: { sku: v.sku, qty: c.alive, unitCost: c.perPlant, total: c.total } });
  touch(S, 'adaptation', 'stock', 'movements', 'catalog', 'audit');
  return { adaptation: a, lot, variant: v };
});

def('individual.split', 'adaptation.manage', 'Индивидуальные карточки', (S, ctx, { lotId, items, title, price }) => {
  if (!items && price) items = [{ title, price }];
  const lot = lotById(S, lotId);
  need(lot, 'NOT_FOUND', 'Партия не найдена');
  const base = variantBySku(S, lot.sku);
  need(['adapted', 'seedling'].includes(base.category), 'VALIDATION', 'Индивидуальные карточки — для выращенных растений');
  need(items?.length > 0 && items.length <= lotAvailable(S, lot), 'INSUFFICIENT_STOCK', `Доступно ${lotAvailable(S, lot)}`);
  lot.qty -= items.length;
  S.movements.push(mv(S, ctx, 'individual_split', { sku: lot.sku, lotId, qty: items.length, fromWh: lot.warehouseId, reason: 'Выделение редких экземпляров' }));
  const made = [];
  for (const it of items) {
    need(+it.price > 0, 'VALIDATION', 'Цена экземпляра > 0');
    const v = makeVariant(S, ctx, { cultivarId: base.cultivarId, category: base.category, packSize: 1, saleUnit: 'шт', price: +it.price, title: it.title || `${base.title} — экземпляр`, isIndividual: true, photo: it.photo || base.photo, parentSku: base.sku, description: it.description || 'Индивидуальный экземпляр: на фото — именно это растение.' });
    const nl = { id: nextId(S, 'LOT', 5), warehouseId: lot.warehouseId, batchId: lot.batchId, adaptationId: lot.adaptationId, sku: v.sku, qty: 1, quarantineQty: 0, unitCost: lot.unitCost, costVersion: 1, origin: 'individual', parentLotId: lot.id, createdAt: ctx.now };
    S.lots.push(nl);
    S.movements.push(mv(S, ctx, 'individual_in', { sku: v.sku, lotId: nl.id, qty: 1, toWh: lot.warehouseId, reason: `Из ${lot.id}` }));
    made.push(v);
  }
  audit(S, ctx, { objectType: 'lot', objectId: lotId, action: 'Выделены индивидуальные экземпляры', after: made.map((v) => v.sku) });
  touch(S, 'catalog', 'stock', 'movements', 'audit');
  return made;
});

export function makeVariant(S, ctx, f) {
  const prefix = { microclone: 'MC', adapted: 'AD', seedling: 'SD', care: 'CR' }[f.category] + (f.isIndividual ? 'I' : '');
  const v = {
    sku: nextId(S, prefix, 4), cultivarId: f.cultivarId || null, category: f.category, title: f.title, packSize: f.packSize || 1,
    saleUnit: f.saleUnit || (f.category === 'microclone' ? 'упаковка' : 'шт'), price: f.price, purchasePrice: f.purchasePrice || null,
    description: f.description || '', photo: f.photo || null, active: f.active ?? true, isIndividual: !!f.isIndividual, parentSku: f.parentSku || null,
    restrictions: f.restrictions || (CATEGORIES.find((c) => c.id === f.category)?.live ? 'Живое растение: отправка при температуре от +5 °C, утепление и тепловой пакет в холодный сезон.' : ''),
    seoTitle: '', seoDescription: '', isNew: !!f.isNew, createdAt: ctx.now, updatedAt: ctx.now,
    priceHistory: [{ price: f.price, at: ctx.now, source: f.source || 'create' }], purchaseHistory: f.purchasePrice ? [{ price: f.purchasePrice, at: ctx.now, source: f.source || 'create' }] : [],
  };
  S.variants.push(v);
  return v;
}

// ───────────────────────── посылки ─────────────────────────

def('shipment.create', 'shipment.manage', 'Создание посылки', (S, ctx, { orderId, lineIds, carrier, weight, dims }) => {
  const o = orderById(S, orderId);
  need(o, 'NOT_FOUND', 'Заказ не найден');
  need(lineIds?.length, 'VALIDATION', 'Выберите позиции');
  for (const id of lineIds) {
    const l = o.lines.find((x) => x.id === id);
    need(l && l.status === 'reserved', 'STATE', 'В посылку можно положить только зарезервированные позиции');
    need(!S.shipments.some((s) => s.lineIds.includes(id) && s.status !== 'cancelled'), 'DUPLICATE', 'Позиция уже в другой посылке');
  }
  const live = lineIds.some((id) => CATEGORIES.find((c) => c.id === o.lines.find((l) => l.id === id).category)?.live);
  const sh = { id: nextId(S, 'SHP'), orderId, lineIds, carrier: carrier || o.delivery.carrier, tariff: 'стандарт', cost: CARRIERS.find((c) => c.id === (carrier || o.delivery.carrier))?.price || 0, weight: weight || null, dims: dims || '', tracking: '', status: 'created', createdAt: ctx.now, handoverAt: null, arrivedAt: null, receivedAt: null, packagePhotos: 0, requiresPhotos: live, manualEntry: false };
  S.shipments.push(sh);
  audit(S, ctx, { objectType: 'shipment', objectId: sh.id, action: 'Создана посылка', after: { lines: lineIds.length } });
  touch(S, 'shipments', 'audit');
  return sh;
});

def('shipment.photos', 'shipment.manage', 'Фото упаковки', (S, ctx, { shipmentId, count }) => {
  const sh = S.shipments.find((s) => s.id === shipmentId);
  need(sh, 'NOT_FOUND', 'Посылка не найдена');
  sh.packagePhotos += Math.max(1, +count || 1);
  audit(S, ctx, { objectType: 'shipment', objectId: sh.id, action: 'Добавлены фото упаковки', after: { photos: sh.packagePhotos } });
  touch(S, 'shipments');
  return sh;
});

def('order.shipException', 'ship.exception', 'Разрешение отгрузки без полной оплаты', (S, ctx, { orderId, reason }) => {
  const o = orderById(S, orderId);
  need(o, 'NOT_FOUND', 'Заказ не найден');
  need(reason?.trim(), 'REASON_REQUIRED', 'Нужна причина');
  const t = orderTotals(S, o);
  o.shipException = { by: ctx.actor.id, byName: ctx.actor.name, at: ctx.now, reason, debt: t.balance };
  o.version++;
  audit(S, ctx, { objectType: 'order', objectId: o.id, action: 'Разрешена отгрузка с задолженностью', after: { debt: t.balance }, reason });
  touch(S, 'orders', 'audit');
  return o;
});

def('shipment.handover', 'shipment.manage', 'Передача перевозчику', (S, ctx, { shipmentId, tracking, manual = false }) => {
  const sh = S.shipments.find((s) => s.id === shipmentId);
  need(sh?.status === 'created', 'STATE', 'Посылка уже передана');
  need(tracking?.trim(), 'VALIDATION', 'Нужен трек-номер');
  const o = orderById(S, sh.orderId);
  const t = orderTotals(S, o);
  need(t.balance <= 0 || o.shipException, 'NOT_PAID', `Отгрузка запрещена: не оплачено ${t.balance} ₽. Нужна полная оплата или разрешение владельца/руководителя.`);
  need(!sh.requiresPhotos || sh.packagePhotos > 0, 'PHOTOS_REQUIRED', 'Для живых растений обязательны фото упаковки');
  for (const id of sh.lineIds) {
    const l = o.lines.find((x) => x.id === id);
    const rs = S.reservations.filter((r) => r.lineId === id && r.state === 'active');
    need(sum(rs, (r) => r.qty) === l.qty, 'STATE', `Позиция ${l.title}: резерв не покрывает количество`);
    for (const r of rs) {
      const lot = lotById(S, r.lotId);
      lot.qty -= r.qty;
      need(lot.qty >= 0, 'NEGATIVE_STOCK', 'Отрицательный остаток запрещён');
      r.state = 'consumed'; r.history.push({ at: ctx.now, state: 'consumed' });
      S.movements.push(mv(S, ctx, 'sale', { sku: r.sku, lotId: lot.id, qty: r.qty, fromWh: lot.warehouseId, reason: `Отгрузка ${sh.id}`, docRef: sh.id }));
      S.sales.push({ id: nextId(S, 'SAL', 6), orderId: o.id, lineId: l.id, shipmentId: sh.id, sku: l.sku, category: l.category, channel: o.channel, lotId: lot.id, batchId: lot.batchId, qty: r.qty, unitPrice: l.unitPrice, at: ctx.now });
    }
    l.status = 'shipped';
  }
  sh.status = 'handed_over'; sh.tracking = tracking.trim(); sh.handoverAt = ctx.now; sh.manualEntry = !!manual;
  o.version++;
  audit(S, ctx, { objectType: 'shipment', objectId: sh.id, action: 'Передано перевозчику', after: { tracking: sh.tracking, manual } });
  emit(S, ctx, 'shipment.handed_over', sh.id, { shipment_id: sh.id, order_id: o.id, tracking: sh.tracking });
  notify(S, ctx, o.customerId, o.id, 'track', `Посылка передана в ${CARRIERS.find((c) => c.id === sh.carrier)?.name}. Трек: ${sh.tracking}`, `track:${sh.id}`);
  touch(S, 'shipments', 'stock', 'movements', 'reservations', 'orders', 'order_lines', 'audit');
  return sh;
});

def('shipment.status', 'shipment.manage', 'Статус посылки', (S, ctx, { shipmentId, status }) => {
  const sh = S.shipments.find((s) => s.id === shipmentId);
  need(sh, 'NOT_FOUND', 'Посылка не найдена');
  const order = ['created', 'handed_over', 'arrived', 'received'];
  need(order.indexOf(status) > order.indexOf(sh.status), 'STATE', 'Статус можно только продвинуть вперёд');
  need(sh.status !== 'created', 'STATE', 'Сначала передайте посылку перевозчику');
  const o = orderById(S, sh.orderId);
  if (status === 'arrived') { sh.arrivedAt = ctx.now; notify(S, ctx, o.customerId, o.id, 'arrived', `Посылка ${sh.tracking} прибыла в пункт выдачи.`, `arrived:${sh.id}`); }
  if (status === 'received') { sh.receivedAt = ctx.now; sh.arrivedAt ||= ctx.now; emit(S, ctx, 'shipment.received', sh.id, { shipment_id: sh.id, received_at: new Date(ctx.now).toISOString() }); }
  sh.status = status;
  audit(S, ctx, { objectType: 'shipment', objectId: sh.id, action: `Статус: ${status}` });
  touch(S, 'shipments', 'orders', 'audit');
  return sh;
});

def('order.cancelLine', 'order.edit', 'Отмена позиции', (S, ctx, { orderId, lineId, reason }) => {
  const o = orderById(S, orderId);
  const l = o?.lines.find((x) => x.id === lineId);
  need(l, 'NOT_FOUND', 'Позиция не найдена');
  need(!['shipped', 'cancelled', 'replaced'].includes(l.status), 'STATE', 'Позицию нельзя отменить');
  need(reason?.trim(), 'REASON_REQUIRED', 'Нужна причина');
  for (const r of S.reservations.filter((r) => r.lineId === l.id && r.state === 'active')) releaseReservation(S, ctx, r, 'released', reason);
  const before = orderTotals(S, o).total;
  l.status = 'cancelled'; l.allocations = [];
  o.version++;
  audit(S, ctx, { objectType: 'order', objectId: o.id, action: 'Отменена позиция', before: { total: before }, after: { total: orderTotals(S, o).total, line: l.id }, reason });
  emit(S, ctx, 'order.updated', o.id, { order_id: o.id, changed_fields: ['lines'], version: o.version });
  touch(S, 'orders', 'order_lines', 'audit');
  return o;
});

def('order.rereserve', 'order.edit', 'Повторный резерв', (S, ctx, { orderId, lineId }) => {
  const o = orderById(S, orderId);
  const l = o?.lines.find((x) => x.id === lineId);
  need(l?.status === 'expired', 'STATE', 'Позиция не в статусе «резерв истёк»');
  const ok = tryReReserve(S, ctx, o, l);
  need(ok, 'INSUFFICIENT_STOCK', 'Товар уже продан — предложите замену');
  audit(S, ctx, { objectType: 'order', objectId: o.id, action: 'Повторный резерв' });
  touch(S, 'orders', 'audit');
  return l;
});

// ───────────────────────── финансы ─────────────────────────

def('expense.add', 'finance.edit', 'Внесение расхода', (S, ctx, { occurredAt, amount, category, allocation, comment, documentRef }) => {
  need(+amount > 0, 'VALIDATION', 'Сумма > 0');
  const cat = EXPENSE_CATEGORIES.find((c) => c.id === category);
  need(cat, 'VALIDATION', 'Выберите статью');
  const alloc = allocation?.type && allocation.type !== 'none' ? allocation : { type: 'none', id: null };
  if (alloc.type === 'batch') need(S.batches.find((b) => b.id === alloc.id), 'NOT_FOUND', 'Поставка не найдена');
  if (alloc.type === 'order') need(orderById(S, alloc.id), 'NOT_FOUND', 'Заказ не найден');
  if (cat.type === 'direct') need(['batch', 'adaptation'].includes(alloc.type), 'VALIDATION', 'Прямой расход нужно привязать к поставке или адаптации');
  const e = { id: nextId(S, 'EXP'), occurredAt: occurredAt || ctx.now, amount: round2(+amount), category, type: cat.type, allocation: alloc, comment: comment || '', documentRef: documentRef || null, authorId: ctx.actor.id, status: 'fact' };
  S.expenses.push(e);
  if (alloc.type === 'batch') {
    const b = S.batches.find((x) => x.id === alloc.id);
    need(!b.costClosed, 'STATE', 'Себестоимость поставки закрыта');
    recostBatch(S, ctx, b, `Расход ${e.id}`);
  }
  audit(S, ctx, { objectType: 'expense', objectId: e.id, action: 'Внесён расход', after: { amount: e.amount, category, allocation: alloc } });
  touch(S, 'expenses', 'unit_economics', 'audit');
  return e;
});

// ───────────────────────── импорт прайса ─────────────────────────

def('pricelist.apply', 'pricelist.import', 'Применение прайса', (S, ctx, { fileName, checksum, supplierId, rows }) => {
  need(S.suppliers.find((s) => s.id === supplierId), 'NOT_FOUND', 'Выберите лабораторию');
  const same = S.priceLists.find((p) => p.checksum === checksum && p.supplierId === supplierId);
  if (same) return { priceList: same, duplicate: true, created: 0, updated: 0 };
  const version = S.priceLists.filter((p) => p.supplierId === supplierId).length + 1;
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    if (r.action === 'new') {
      let cv = S.cultivars.find((c) => c.key === r.cultivarKey);
      if (!cv) {
        cv = { id: nextId(S, 'CV', 4), key: r.cultivarKey, genus: r.genus, name: r.cultivar, synonyms: [], variegation: r.variegated, notes: '', art: null };
        S.cultivars.push(cv);
      }
      const retail = Math.round((r.price * S.settings.retailMarkup) / 10) * 10;
      makeVariant(S, ctx, { cultivarId: cv.id, category: 'microclone', packSize: r.packSize, price: retail, purchasePrice: r.price, title: `${r.genus} ${r.cultivar} — микроклоны ×${r.packSize}`.trim(), photo: r.photo, active: false, source: `прайс v${version}`, supplierId, isNew: true });
      created++;
    } else if (r.action === 'update') {
      const v = variantBySku(S, r.sku);
      need(v, 'NOT_FOUND', `SKU ${r.sku} не найден`);
      if (r.price !== v.purchasePrice) { v.purchaseHistory.push({ price: r.price, at: ctx.now, source: `прайс v${version}` }); v.purchasePrice = r.price; }
      if (r.photo && !v.photo) v.photo = r.photo;
      v.updatedAt = ctx.now;
      updated++;
    } else skipped++;
  }
  const pl = { id: nextId(S, 'PRL', 4), fileName, checksum, supplierId, version, authorId: ctx.actor.id, at: ctx.now, created, updated, skipped, rows: rows.length };
  S.priceLists.push(pl);
  audit(S, ctx, { objectType: 'price_list', objectId: pl.id, action: 'Импорт прайса применён', after: { fileName, version, created, updated, skipped, checksum: checksum.slice(0, 12) } });
  touch(S, 'catalog', 'audit');
  return { priceList: pl, duplicate: false, created, updated, skipped };
});

// ───────────────────────── сотрудники ─────────────────────────

def('users.setDeny', 'users.manage', 'Изменение прав сотрудника', (S, ctx, { userId, perm, denied }) => {
  const u = S.users.find((x) => x.id === userId);
  need(u, 'NOT_FOUND', 'Сотрудник не найден');
  const before = [...(u.deny || [])];
  u.deny = denied ? [...new Set([...(u.deny || []), perm])] : (u.deny || []).filter((p) => p !== perm);
  audit(S, ctx, { objectType: 'user', objectId: u.id, action: 'Изменены права', before, after: u.deny });
  touch(S, 'audit');
  return u;
});

def('google.setOnline', 'sync.view', 'Доступ к Google API (симуляция)', (S, ctx, { online }) => {
  S.google.online = !!online;
  audit(S, ctx, { objectType: 'integration', objectId: 'google', action: online ? 'Выгрузка в Google возобновлена' : 'Выгрузка в Google приостановлена' });
  return S.google;
});

// Уведомление платёжного провайдера (вебхук). 
def('payment.webhook', 'public', 'Вебхук платёжного провайдера', (S, ctx, args) =>
  OPS['payment.record'].fn(S, { ...ctx, actor: { id: 'provider', name: 'Платёжный провайдер', role: 'system' } }, { ...args, method: args.method || 'card' }),
);

export const GENUS_RU = { Monstera: 'Монстера', Philodendron: 'Филодендрон', Anthurium: 'Антуриум', Alocasia: 'Алоказия', Syngonium: 'Сингониум', Rhaphidophora: 'Рафидофора', Scindapsus: 'Сциндапсус', Begonia: 'Бегония', Hoya: 'Хойя' };

def('settings.update', 'users.manage', 'Изменение методик', (S, ctx, { key, value }) => {
  need(['partialFifo', 'logisticsMethod', 'retailMarkup'].includes(key), 'FIELD_NOT_ALLOWED', 'Настройка недоступна');
  const before = S.settings[key];
  S.settings[key] = value;
  if (key === 'logisticsMethod') for (const b of S.batches.filter((b) => b.status === 'received' && !b.costClosed)) recostBatch(S, ctx, b, `Смена методики: ${value}`);
  audit(S, ctx, { objectType: 'settings', objectId: key, action: 'Изменена методика', before, after: value });
  touch(S, 'unit_economics', 'audit');
  return S.settings;
});
