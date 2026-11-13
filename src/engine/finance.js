// Финансовые отчёты: выручка признаётся по факту отгрузки, предоплата — обязательство.
import { sum, round2 } from './util.js';
import { lotById, orderTotals, adaptationCost } from './engine.js';
import { CATEGORIES, CHANNELS, expCat } from './model.js';

const inPeriod = (ts, p) => (!p?.from || ts >= p.from) && (!p?.to || ts < p.to);

export function saleCogs(S, sale) {
  const lot = lotById(S, sale.lotId);
  return round2(sale.qty * (lot?.unitCost || 0));
}

// Переменные расходы, привязанные к заказу, распределяются по продажам заказа пропорционально выручке
function variableBySale(S) {
  const map = {};
  const byOrder = {};
  for (const e of S.expenses.filter((e) => e.type === 'variable' && e.allocation?.type === 'order')) byOrder[e.allocation.id] = (byOrder[e.allocation.id] || 0) + e.amount;
  for (const [orderId, amount] of Object.entries(byOrder)) {
    const sales = S.sales.filter((s) => s.orderId === orderId);
    const rev = sum(sales, (s) => s.qty * s.unitPrice);
    for (const s of sales) map[s.id] = rev > 0 ? round2((amount * s.qty * s.unitPrice) / rev) : 0;
  }
  return map;
}

export function contribution(revenue, cogs, variable) {
  const c = round2(revenue - cogs - variable);
  return {
    revenue: round2(revenue), cogs: round2(cogs), variable: round2(variable), contribution: c,
    marginPct: revenue > 0 ? round2((c / revenue) * 100) : null,
    markupPct: cogs > 0 ? round2(((revenue - cogs) / cogs) * 100) : null,
  };
}

export function unitEconomics(S, period, groupBy = 'sku') {
  const vmap = variableBySale(S);
  const groups = {};
  for (const s of S.sales.filter((s) => inPeriod(s.at, period))) {
    const key = groupBy === 'sku' ? s.sku : groupBy === 'batch' ? s.batchId || '—' : groupBy === 'order' ? s.orderId : groupBy === 'category' ? s.category : groupBy === 'channel' ? s.channel : 'all';
    const g = (groups[key] ||= { key, revenue: 0, cogs: 0, variable: 0, qty: 0, costVersions: new Set() });
    g.revenue += s.qty * s.unitPrice;
    g.cogs += saleCogs(S, s);
    g.variable += vmap[s.id] || 0;
    g.qty += s.qty;
    g.costVersions.add(lotById(S, s.lotId)?.costVersion || 1);
  }
  return Object.values(groups).map((g) => ({ key: g.key, qty: g.qty, methodVersion: `${S.settings.logisticsMethod}/v${Math.max(...g.costVersions)}`, ...contribution(g.revenue, g.cogs, g.variable) }));
}

export function pnl(S, period) {
  const sales = S.sales.filter((s) => inPeriod(s.at, period));
  const vmap = variableBySale(S);
  const revenue = sum(sales, (s) => s.qty * s.unitPrice);
  const cogs = sum(sales, (s) => saleCogs(S, s));
  const variableAllocated = sum(sales, (s) => vmap[s.id] || 0);
  const variableUnallocated = sum(S.expenses.filter((e) => e.type === 'variable' && e.allocation?.type !== 'order' && inPeriod(e.occurredAt, period)), (e) => e.amount);
  const c = contribution(revenue, cogs, variableAllocated + variableUnallocated);
  const overhead = sum(S.expenses.filter((e) => e.type === 'overhead' && inPeriod(e.occurredAt, period)), (e) => e.amount);
  const withdrawals = sum(S.expenses.filter((e) => e.type === 'withdrawal' && inPeriod(e.occurredAt, period)), (e) => e.amount);
  const operatingProfit = round2(c.contribution - overhead);

  // Денежный поток (не равен выручке)
  const pays = S.payments.filter((p) => p.state === 'confirmed' && p.method !== 'compensation' && inPeriod(p.confirmedAt || p.occurredAt, period));
  const cashIn = sum(pays.filter((p) => p.kind === 'payment'), (p) => p.amount);
  const refunds = sum(pays.filter((p) => p.kind === 'refund'), (p) => p.amount);
  const purchases = sum(S.batches.filter((b) => b.receivedAt && inPeriod(b.receivedAt, period)), (b) => sum(b.lines, (l) => l.receivedQty * l.unitCost) + (b.logisticsCost || 0));
  const expensesCash = sum(S.expenses.filter((e) => e.type !== 'withdrawal' && inPeriod(e.occurredAt, period)), (e) => e.amount);
  const netCash = round2(cashIn - refunds - purchases - expensesCash - withdrawals);

  // Обязательства: деньги клиентов по ещё не отгруженным позициям
  let prepaymentLiability = 0;
  for (const o of S.orders.filter((o) => !o.cancelled)) {
    const t = orderTotals(S, o);
    const shippedValue = sum(S.sales.filter((s) => s.orderId === o.id), (s) => s.qty * s.unitPrice) + (S.sales.some((s) => s.orderId === o.id) ? t.delivery : 0);
    prepaymentLiability += Math.max(0, t.paid - shippedValue);
  }
  return { ...c, overhead, operatingProfit, withdrawals, cashIn, refunds, purchases, expensesCash, netCash, prepaymentLiability: round2(prepaymentLiability), variableAllocated, variableUnallocated };
}

export function byDimension(S, period, dim) {
  const rows = unitEconomics(S, period, dim);
  const names = dim === 'category' ? CATEGORIES : CHANNELS;
  return names.map((n) => rows.find((r) => r.key === n.id) || { key: n.id, qty: 0, ...contribution(0, 0, 0) }).map((r) => ({ ...r, name: names.find((n) => n.id === r.key)?.name }));
}

export function stockValue(S) {
  return round2(sum(S.lots, (l) => l.qty * (l.unitCost || 0)));
}

export function wipValue(S) {
  return round2(sum(S.adaptations.filter((a) => a.status === 'in_progress'), (a) => adaptationCost(S, a).total));
}

export function expenseRows(S) {
  return S.expenses.map((e) => ({ ...e, categoryName: expCat(e.category).name }));
}
