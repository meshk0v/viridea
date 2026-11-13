// Воспроизводимые приёмочные сценарии ТЗ (раздел 15 и Приложение Е), исполняемые против доменного движка.
import { emptyState, run, makeVariant, stockOf, orderTotals, orderById, lotAvailable, adaptationCost, lineReserved, allocatedQty, orderStatus, replacementContext } from './engine.js';
import { pnl, unitEconomics } from './finance.js';
import { apiRequest } from './api.js';
import { datasetRows } from './exportx.js';
import { HOUR, DAY } from './util.js';

const OWNER = { id: 'U1', name: 'Владелец', role: 'owner' };
const HEAD = { id: 'U2', name: 'Руководитель', role: 'head' };
const MGR = { id: 'U3', name: 'Менеджер', role: 'manager' };
const WH = { id: 'U4', name: 'Склад', role: 'warehouse' };
const T0 = Date.UTC(2026, 10, 1, 9, 0);

function fixture() {
  const S = emptyState();
  S.users = [OWNER, HEAD, MGR, WH].map((u) => ({ ...u, deny: [] }));
  S.warehouses = [
    { id: 'W1', name: 'Основной', type: 'main', active: true, sellable: true },
    { id: 'W2', name: 'Адаптация', type: 'adaptation', active: true, sellable: false },
  ];
  S.suppliers = [{ id: 'L1', name: 'Лаборатория тест' }];
  S.cultivars = [{ id: 'CV1', key: 'monstera thai constellation', genus: 'Monstera', name: 'Thai Constellation', synonyms: [] }, { id: 'CV2', key: 'philodendron pink princess', genus: 'Philodendron', name: 'Pink Princess', synonyms: [] }];
  const c = { actor: OWNER, now: T0 };
  const a = makeVariant(S, c, { cultivarId: 'CV1', category: 'microclone', packSize: 5, price: 3000, purchasePrice: 2000, title: 'Thai ×5' });
  const b = makeVariant(S, c, { cultivarId: 'CV2', category: 'microclone', packSize: 1, price: 1200, purchasePrice: 500, title: 'PP ×1' });
  const ad = makeVariant(S, c, { cultivarId: 'CV2', category: 'adapted', packSize: 1, price: 2500, title: 'PP адапт.' });
  S.apiKeys = [{ id: 'K1', name: 'test', token: 'tok', scopes: ['catalog:read', 'stock:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'payments:read', 'shipments:read', 'approvals:write', 'webhooks:manage'], revoked: false }];
  return { S, skuA: a.sku, skuB: b.sku, skuAd: ad.sku };
}

class Ctx {
  constructor(S) { this.S = S; this.t = T0; this.log = []; }
  op(actor, name, args, dt = 60 * 1000) { this.t += dt; const r = run(this.S, { actor, now: this.t }, name, args); this.S = r.state; return r.result; }
  tryOp(actor, name, args) { try { return { ok: true, result: this.op(actor, name, args) }; } catch (e) { if (e.state) this.S = e.state; return { ok: false, error: e }; } }
  check(cond, text) { this.log.push({ ok: !!cond, text }); return !!cond; }
  receiveStock(sku, qty, unitCost = 1000, logistics = 0) {
    const b = this.op(HEAD, 'supply.create', { supplierId: 'L1', logisticsCost: logistics, lines: [{ sku, orderedQty: qty, unitCost }] });
    this.op(MGR, 'supply.confirmLine', { batchId: b.id, lineId: b.lines[0].id, state: 'full' });
    this.op(WH, 'supply.receive', { batchId: b.id, warehouseId: 'W1', lines: [{ lineId: b.lines[0].id, receivedQty: qty, defectQty: 0 }] });
    return b;
  }
  checkout(name, items, extra = {}) {
    return this.op(null, 'checkout', { customer: { name, phone: '+7 900 000-00-' + String(10 + this.S.orders.length).padStart(2, '0') }, items, delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true }, ...extra });
  }
}

export const SCENARIOS = [
  {
    id: 'AT-S02', title: 'Частичное подтверждение: 10 упаковок в предзаказе, лаборатория подтвердила 6',
    run({ S, skuA }) {
      const c = new Ctx(S);
      const b = c.op(HEAD, 'supply.create', { supplierId: 'L1', lines: [{ sku: skuA, orderedQty: 10, unitCost: 2000 }] });
      const A = c.checkout('А', [{ sku: skuA, qty: 4 }]).order;
      const B = c.checkout('Б', [{ sku: skuA, qty: 3 }]).order;
      const V = c.checkout('В', [{ sku: skuA, qty: 3 }]).order;
      c.check(stockOf(c.S, skuA).physical === 0, 'Предзаказ не уменьшает и не создаёт физический остаток (0)');
      const r = c.op(MGR, 'supply.confirmLine', { batchId: b.id, lineId: b.lines[0].id, state: 'partial', confirmedQty: 6 });
      const al = (o) => allocatedQty(orderById(c.S, o.id).lines[0]);
      c.check(al(A) === 4 && al(B) === 2 && al(V) === 0, `FIFO: А=4, Б=2, В=0 (факт: ${al(A)}/${al(B)}/${al(V)})`);
      c.check(r.allocated.reduce((s, x) => s + x.qty, 0) === 6, 'Распределено ровно 6 подтверждённых');
      c.check(r.waiting.reduce((s, x) => s + x.missing, 0) === 4, '4 упаковки ожидают решения');
      c.check(c.S.events.some((e) => e.type === 'preorder.shortage'), 'Событие preorder.shortage сформировано');
      c.check(stockOf(c.S, skuA).physical === 0, 'Подтверждение лаборатории ≠ физический остаток');
      return c;
    },
  },
  {
    id: 'AT-S03', title: 'Двойной резерв: одна упаковка, два параллельных оформления',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 1);
      const r1 = c.tryOp(null, 'checkout', { customer: { name: 'Первый', phone: '+7 900 100-00-01' }, items: [{ sku: skuA, qty: 1 }], delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true } });
      const r2 = c.tryOp(null, 'checkout', { customer: { name: 'Второй', phone: '+7 900 100-00-02' }, items: [{ sku: skuA, qty: 1 }], delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true } });
      c.check(r1.ok && !r2.ok, 'Успешен только один резерв');
      c.check(r2.error?.code === 'INSUFFICIENT_STOCK', 'Второй получил понятную ошибку INSUFFICIENT_STOCK');
      const st = stockOf(c.S, skuA);
      c.check(st.available === 0 && st.reserved === 1, `Остаток не отрицательный (доступно ${st.available}, резерв ${st.reserved})`);
      c.check(c.S.orders.length === 1, 'Неуспешное оформление не оставило «висящий» заказ (атомарность)');
      return c;
    },
  },
  {
    id: 'AT-S04', title: 'Поступление: лаборатория подтвердила, груз не принят',
    run({ S, skuA }) {
      const c = new Ctx(S);
      const b = c.op(HEAD, 'supply.create', { supplierId: 'L1', lines: [{ sku: skuA, orderedQty: 5, unitCost: 2000 }] });
      c.op(MGR, 'supply.confirmLine', { batchId: b.id, lineId: b.lines[0].id, state: 'full' });
      c.check(stockOf(c.S, skuA).physical === 0, 'После подтверждения физический остаток = 0');
      c.op(WH, 'supply.receive', { batchId: b.id, warehouseId: 'W1', lines: [{ lineId: b.lines[0].id, receivedQty: 5, defectQty: 1 }] });
      const st = stockOf(c.S, skuA);
      c.check(st.physical === 5 && st.quarantine === 1 && st.available === 4, `После приёмки: физически 5, брак 1, доступно 4 (факт ${st.physical}/${st.quarantine}/${st.available})`);
      return c;
    },
  },
  {
    id: 'AT-S05', title: 'Замена: исходная позиция недоступна, покупатель выбирает другую',
    run({ S, skuA, skuB }) {
      const c = new Ctx(S);
      c.receiveStock(skuB, 5, 500);
      const b = c.op(HEAD, 'supply.create', { supplierId: 'L1', lines: [{ sku: skuA, orderedQty: 2, unitCost: 2000 }] });
      const o = c.checkout('Покупатель', [{ sku: skuA, qty: 1 }]).order;
      c.op(MGR, 'supply.confirmLine', { batchId: b.id, lineId: b.lines[0].id, state: 'refused' });
      const line = orderById(c.S, o.id).lines[0];
      c.check(line.status === 'shortage', 'Позиция в дефиците после отказа лаборатории');
      const tok = c.op(MGR, 'replacement.createLink', { orderId: o.id, lineId: line.id });
      const before = orderTotals(c.S, orderById(c.S, o.id)).total;
      const res = c.op(null, 'replacement.accept', { token: tok.token, sku: skuB });
      const after = orderTotals(c.S, orderById(c.S, o.id)).total;
      c.check(orderById(c.S, o.id).lines[0].status === 'replaced', 'Старая позиция помечена «заменено»');
      c.check(lineReserved(c.S, res.newLine) === 1, 'Новый резерв создан');
      c.check(after - before === 1200 - 3000 && res.difference === -1800, `Цена пересчитана: разница ${res.difference} ₽`);
      c.check(c.S.audit.some((a) => a.action === 'Замена позиции'), 'Аудит замены сохранён');
      const again = c.tryOp(null, 'replacement.accept', { token: tok.token, sku: skuB });
      c.check(!again.ok, 'Повторное использование ссылки запрещено');
      c.check(replacementContext(c.S, 'чужой-токен', c.t).error, 'Чужая/несуществующая ссылка не раскрывает заказ');
      return c;
    },
  },
  {
    id: 'AT-S06', title: 'Адаптация: 10 клонов (5 000 ₽) + материалы 1 000 ₽, выжило 8',
    run({ S, skuB, skuAd }) {
      const c = new Ctx(S);
      c.receiveStock(skuB, 12, 500);
      const lot = c.S.lots.find((l) => l.sku === skuB);
      const a = c.op(WH, 'adaptation.start', { lotId: lot.id, packs: 10 });
      c.check(stockOf(c.S, skuB).physical === 2, 'Исходный остаток уменьшен на 10');
      c.op(WH, 'adaptation.material', { adaptationId: a.id, name: 'Субстрат', amount: 1000 });
      c.op(WH, 'adaptation.loss', { adaptationId: a.id, qty: 2, reason: 'Гниль' });
      const r = c.op(WH, 'adaptation.complete', { adaptationId: a.id, price: 2500 });
      c.check(r.variant.sku === skuAd && r.lot.qty === 8, 'Сформировано 8 готовых растений');
      c.check(r.lot.unitCost === 750, `Себестоимость выжившего растения 750 ₽ (факт ${r.lot.unitCost})`);
      const p = pnl(c.S);
      c.check(p.cogs === 0, 'Передача в адаптацию не признаётся себестоимостью продаж (нет двойного учёта)');
      return c;
    },
  },
  {
    id: 'AT-S07', title: 'Смешанный заказ: две партии с разными датами',
    run({ S, skuA, skuB }) {
      const c = new Ctx(S);
      c.receiveStock(skuB, 3, 500);
      const b = c.op(HEAD, 'supply.create', { supplierId: 'L1', plannedAt: T0 + 10 * DAY, lines: [{ sku: skuA, orderedQty: 2, unitCost: 2000 }] });
      const o = c.checkout('Смешанный', [{ sku: skuB, qty: 1 }, { sku: skuA, qty: 1 }], { delivery: { carrier: 'cdek', split: true } }).order;
      c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'mix-1', amount: orderTotals(c.S, orderById(c.S, o.id)).total });
      const l1 = orderById(c.S, o.id).lines.find((l) => l.sku === skuB);
      const sh1 = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: [l1.id] });
      c.op(WH, 'shipment.photos', { shipmentId: sh1.id, count: 1 });
      c.op(WH, 'shipment.handover', { shipmentId: sh1.id, tracking: 'T1' });
      c.check(orderStatus(c.S, orderById(c.S, o.id)) === 'partially_shipped', 'Заказ «частично отправлен»');
      c.op(MGR, 'supply.confirmLine', { batchId: b.id, lineId: b.lines[0].id, state: 'full' });
      c.op(WH, 'supply.receive', { batchId: b.id, warehouseId: 'W1', lines: [{ lineId: b.lines[0].id, receivedQty: 2 }] });
      const l2 = orderById(c.S, o.id).lines.find((l) => l.sku === skuA);
      c.check(l2.status === 'reserved', 'Предзаказная часть автоматически зарезервирована при приёмке');
      const sh2 = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: [l2.id] });
      c.op(WH, 'shipment.photos', { shipmentId: sh2.id, count: 1 });
      c.op(WH, 'shipment.handover', { shipmentId: sh2.id, tracking: 'T2' });
      const t = orderTotals(c.S, orderById(c.S, o.id));
      c.check(c.S.shipments.filter((s) => s.orderId === o.id).length === 2, 'Две раздельные посылки со своими треками');
      c.check(t.balance === 0 && t.delivery === 900, `Общая сумма и оплаты согласованы (остаток ${t.balance}, доставка ×2 = ${t.delivery})`);
      return c;
    },
  },
  {
    id: 'AT-S08', title: 'Частичная оплата: оплачена половина',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 2);
      const o = c.checkout('Половина', [{ sku: skuA, qty: 2 }]).order;
      const total = orderTotals(c.S, orderById(c.S, o.id)).total;
      c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'half-1', amount: total / 2 });
      const t = orderTotals(c.S, orderById(c.S, o.id));
      c.check(t.balance === total / 2, `Остаток к оплате ${t.balance} ₽ показан`);
      const sh = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: orderById(c.S, o.id).lines.map((l) => l.id) });
      c.op(WH, 'shipment.photos', { shipmentId: sh.id });
      const r = c.tryOp(WH, 'shipment.handover', { shipmentId: sh.id, tracking: 'X1' });
      c.check(!r.ok && r.error.code === 'NOT_PAID', 'Отгрузка без полной оплаты запрещена');
      const m = c.tryOp(MGR, 'order.shipException', { orderId: o.id, reason: 'постоянный клиент' });
      c.check(!m.ok, 'Менеджер не может разрешить исключение');
      c.op(OWNER, 'order.shipException', { orderId: o.id, reason: 'Постоянный клиент, доплата при получении' });
      c.check(c.tryOp(WH, 'shipment.handover', { shipmentId: sh.id, tracking: 'X1' }).ok, 'После разрешения владельца отгрузка проходит, задолженность зафиксирована');
      return c;
    },
  },
  {
    id: 'AT-S09', title: 'Финансовый расчёт: эталон 3 000 / 1 800 / 120 / 30 / 100 → 950 ₽, 31,67%',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 30, 2000, 6000);
      const lot = c.S.lots.find((l) => l.sku === skuA);
      c.check(lot.unitCost === 2200, `Себестоимость единицы (60 000 + 6 000) / 30 = 2 200 ₽ (факт ${lot.unitCost})`);
      c.S.lots.find((l) => l.sku === skuA).unitCost = 1800; // эталон Приложения В
      const o = c.checkout('Эталон', [{ sku: skuA, qty: 1 }]).order;
      c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'ref-1', amount: orderTotals(c.S, orderById(c.S, o.id)).total });
      const sh = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: orderById(c.S, o.id).lines.map((l) => l.id) });
      c.op(WH, 'shipment.photos', { shipmentId: sh.id });
      c.op(WH, 'shipment.handover', { shipmentId: sh.id, tracking: 'E1' });
      for (const [cat, amt] of [['packaging', 120], ['commission', 30], ['delivery_subsidy', 100]]) c.op(OWNER, 'expense.add', { amount: amt, category: cat, allocation: { type: 'order', id: o.id } });
      c.op(OWNER, 'expense.add', { amount: 5000, category: 'rent' });
      const ue = unitEconomics(c.S, null, 'order')[0];
      c.check(ue.contribution === 950, `Маржинальный доход 950 ₽ (факт ${ue.contribution})`);
      c.check(ue.marginPct === 31.67, `Маржинальность 31,67% (факт ${ue.marginPct})`);
      const p = pnl(c.S);
      c.check(p.operatingProfit === 950 - 5000, 'Общие расходы вычитаются один раз — в операционной прибыли, не в вкладе');
      return c;
    },
  },
  {
    id: 'AT-S10', title: 'Excel-синхронизация: изменения попадают в наборы с теми же ID',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 3);
      const o = c.checkout('Синк', [{ sku: skuA, qty: 1 }]).order;
      const dirty = new Set(c.S._dirty);
      c.check(['orders', 'reservations'].every((d) => dirty.has(d)), 'Оформление пометило наборы orders и reservations к выгрузке');
      c.op(OWNER, 'expense.add', { amount: 500, category: 'marketing' });
      c.check(c.S._dirty.includes('expenses'), 'Расход пометил набор expenses');
      c.check(datasetRows(c.S, 'orders').some((r) => r.order_id === o.id), 'Строка заказа выгружается с системным ID');
      c.check(datasetRows(c.S, 'reservations').some((r) => r.order_id === o.id), 'Строка резерва ссылается на тот же ID заказа');
      return c;
    },
  },
  {
    id: 'AT-S12', title: 'API без CRM: независимый тестовый клиент, идемпотентность',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 3);
      const o = c.checkout('API', [{ sku: skuA, qty: 1 }]).order;
      const h = { authorization: 'Bearer tok' };
      const g = apiRequest(c.S, { method: 'GET', path: `/api/v1/orders/${o.id}`, headers: h });
      c.check(g.status === 200 && g.body.id === o.id, 'GET /orders/{id} — 200');
      const body = { action: 'set_external_id', value: 'CRM-77', expected_version: g.body.version, idempotency_key: 'k-1' };
      const p1 = apiRequest(c.S, { method: 'POST', path: `/api/v1/orders/${o.id}/actions`, headers: h, body }); c.S = p1.state;
      const p2 = apiRequest(c.S, { method: 'POST', path: `/api/v1/orders/${o.id}/actions`, headers: h, body }); c.S = p2.state;
      c.check(p1.status === 200 && p2.status === 200 && p2.replayed, 'Повтор с тем же idempotency_key возвращает тот же результат');
      c.check(orderById(c.S, o.id).version === g.body.version + 1, 'Версия заказа увеличена ровно один раз');
      const stale = apiRequest(c.S, { method: 'POST', path: `/api/v1/orders/${o.id}/actions`, headers: h, body: { ...body, idempotency_key: 'k-2' } });
      c.check(stale.status === 409 && stale.body.error.code === 'VERSION_CONFLICT' && stale.body.error.correlation_id, 'Устаревшая версия → 409 с машинным кодом и correlation_id');
      const stock = apiRequest(c.S, { method: 'POST', path: `/api/v1/orders/${o.id}/actions`, headers: h, body: { action: 'adjust_stock', expected_version: orderById(c.S, o.id).version, idempotency_key: 'k-3' } });
      c.check(stock.status === 403, 'Изменение остатков из CRM в обход склада запрещено');
      const anon = apiRequest(c.S, { method: 'GET', path: '/api/v1/products', headers: {} });
      c.check(anon.status === 401, 'Без ключа — 401');
      return c;
    },
  },
  {
    id: 'AT-S13', title: 'Права: менеджер пытается выполнить операцию владельца',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 3);
      const lot = c.S.lots[0];
      const r = c.tryOp(MGR, 'stock.writeoff', { lotId: lot.id, qty: 1, reason: 'тест' });
      c.check(!r.ok && r.error.code === 'FORBIDDEN', 'Операция запрещена');
      c.check(c.S.audit.some((a) => a.denied && a.actorId === MGR.id), 'Попытка записана в журнал аудита');
      c.check(stockOf(c.S, skuA).physical === 3, 'Остаток не изменился');
      return c;
    },
  },
  {
    id: 'AT-S15', title: 'Импорт: одинаковые названия с разной упаковкой, повторный импорт',
    run({ S }) {
      const c = new Ctx(S);
      const rows = [
        { action: 'new', cultivarKey: 'alocasia frydek', genus: 'Alocasia', cultivar: 'Frydek', packSize: 1, price: 900 },
        { action: 'new', cultivarKey: 'alocasia frydek', genus: 'Alocasia', cultivar: 'Frydek', packSize: 5, price: 4000 },
      ];
      const r1 = c.op(MGR, 'pricelist.apply', { fileName: 'p.xlsx', checksum: 'abc', supplierId: 'L1', rows });
      c.check(r1.created === 2, 'Создано 2 варианта одного сорта (×1 и ×5)');
      c.check(c.S.cultivars.filter((x) => x.key === 'alocasia frydek').length === 1, 'Сорт создан один раз');
      const r2 = c.op(MGR, 'pricelist.apply', { fileName: 'p.xlsx', checksum: 'abc', supplierId: 'L1', rows });
      c.check(r2.duplicate && c.S.variants.length === 5, 'Повторная загрузка того же файла не создала дублей');
      return c;
    },
  },
  {
    id: 'AT-S16', title: 'Приёмка и списание одной партии подряд',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 4);
      const lot = c.S.lots[0];
      c.op(HEAD, 'stock.writeoff', { lotId: lot.id, qty: 1, reason: 'Брак' });
      const r = c.tryOp(HEAD, 'stock.writeoff', { lotId: lot.id, qty: 4, reason: 'Ошибка' });
      c.check(!r.ok, 'Списание больше остатка отклонено');
      const mv = c.S.movements.filter((m) => m.lotId === lot.id).map((m) => m.type);
      c.check(mv.join(',') === 'receipt,writeoff', `Журнал показывает обе операции и порядок: ${mv.join(' → ')}`);
      return c;
    },
  },
  {
    id: 'AT-S17', title: 'Попытка продать карантинный товар',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 2);
      c.op(WH, 'stock.quarantine', { lotId: c.S.lots[0].id, qty: 2, reason: 'Подозрение на трипса' });
      c.check(stockOf(c.S, skuA).available === 0, 'Карантин не участвует в доступном остатке');
      const r = c.tryOp(null, 'checkout', { customer: { name: 'К', phone: '+7 900 000-11-22' }, items: [{ sku: skuA, qty: 1 }], delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true } });
      c.check(!r.ok, 'Резерв карантинного количества невозможен');
      return c;
    },
  },
  {
    id: 'AT-S18', title: 'Резерв истёк в момент подтверждения оплаты',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 1);
      const o1 = c.checkout('Медленный', [{ sku: skuA, qty: 1 }]).order;
      c.op(null, 'jobs.tick', {}, 73 * HOUR);
      c.check(orderById(c.S, o1.id).lines[0].status === 'expired', 'Резерв истёк фоновым заданием');
      const o2 = c.checkout('Быстрый', [{ sku: skuA, qty: 1 }]).order;
      c.op(MGR, 'payment.record', { orderId: o1.id, providerRef: 'late-1', amount: 1000 });
      c.check(orderById(c.S, o1.id).lines[0].status === 'shortage', 'Поздняя оплата не создаёт второго покупателя на тот же остаток — дефицит, нужно решение');
      c.check(lineReserved(c.S, orderById(c.S, o2.id).lines[0]) === 1 && stockOf(c.S, skuA).available === 0, 'Единица закреплена за одним покупателем');
      return c;
    },
  },
  {
    id: 'AT-S19', title: 'Изменение цены после оформления',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 2);
      const o = c.checkout('Цена', [{ sku: skuA, qty: 1 }]).order;
      c.op(MGR, 'catalog.update', { sku: skuA, patch: { price: 9999 } });
      c.check(orderById(c.S, o.id).lines[0].unitPrice === 3000, 'Заказ сохраняет исходную цену 3 000 ₽');
      c.check(c.S.variants.find((v) => v.sku === skuA).priceHistory.length === 2, 'История цены сохранена');
      return c;
    },
  },
  {
    id: 'AT-S20', title: 'Одно событие оплаты пять раз',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 2);
      const o = c.checkout('Пять', [{ sku: skuA, qty: 1 }]).order;
      for (let i = 0; i < 5; i++) c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'same-ref', amount: 2000 });
      c.check(orderTotals(c.S, orderById(c.S, o.id)).paid === 2000, 'Оплаченная сумма учтена один раз (2 000 ₽)');
      c.check(c.S.payments.length === 1, 'В базе один платёж');
      return c;
    },
  },
  {
    id: 'AT-S21', title: 'Две посылки из одного заказа, получена одна',
    run({ S, skuA, skuB }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 1); c.receiveStock(skuB, 1);
      const o = c.checkout('Две', [{ sku: skuA, qty: 1 }, { sku: skuB, qty: 1 }]).order;
      c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'two', amount: orderTotals(c.S, orderById(c.S, o.id)).total });
      const ls = orderById(c.S, o.id).lines;
      const shs = ls.map((l, i) => { const sh = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: [l.id] }); c.op(WH, 'shipment.photos', { shipmentId: sh.id }); c.op(WH, 'shipment.handover', { shipmentId: sh.id, tracking: 'TR' + i }); return sh; });
      c.op(MGR, 'shipment.status', { shipmentId: shs[0].id, status: 'received' });
      c.check(orderStatus(c.S, orderById(c.S, o.id)) === 'shipped', 'Заказ не считается полностью полученным');
      const n1 = c.S.notifications.length;
      c.op(MGR, 'shipment.status', { shipmentId: shs[1].id, status: 'arrived' });
      c.op(null, 'jobs.tick', {}, 3 * DAY + HOUR);
      c.op(null, 'jobs.tick', {}, HOUR);
      c.check(c.S.notifications.filter((n) => n.kind === 'reminder').length === 1, 'Напоминание на 3-й день отправлено один раз');
      c.check(c.S.notifications.length === n1 + 2, 'Уведомления не дублируются');
      return c;
    },
  },
  {
    id: 'AT-S22', title: 'Адаптация → индивидуальные карточки',
    run({ S, skuB }) {
      const c = new Ctx(S);
      c.receiveStock(skuB, 4, 500);
      const a = c.op(WH, 'adaptation.start', { lotId: c.S.lots[0].id, packs: 4 });
      const r = c.op(WH, 'adaptation.complete', { adaptationId: a.id, price: 2500 });
      const before = adaptationCost(c.S, c.S.adaptations[0]).total;
      const ind = c.op(WH, 'individual.split', { lotId: r.lot.id, items: [{ price: 7000 }, { price: 6500 }] });
      const lots = c.S.lots.filter((l) => l.origin !== 'supply');
      const qty = lots.reduce((s, l) => s + l.qty, 0), cost = lots.reduce((s, l) => s + l.qty * l.unitCost, 0);
      c.check(ind.length === 2 && ind.every((v) => v.isIndividual), 'Созданы 2 карточки с уникальными SKU');
      c.check(qty === 4 && cost === before, `Количество (${qty}) и себестоимость (${cost} ₽) сохранены`);
      return c;
    },
  },
  {
    id: 'AT-S23', title: 'Расход на партию после частичной продажи',
    run({ S, skuA }) {
      const c = new Ctx(S);
      const b = c.receiveStock(skuA, 10, 1000, 0);
      const o = c.checkout('Часть', [{ sku: skuA, qty: 4 }]).order;
      c.op(MGR, 'payment.record', { orderId: o.id, providerRef: 'p23', amount: orderTotals(c.S, orderById(c.S, o.id)).total });
      const sh = c.op(WH, 'shipment.create', { orderId: o.id, lineIds: orderById(c.S, o.id).lines.map((l) => l.id) });
      c.op(WH, 'shipment.photos', { shipmentId: sh.id });
      c.op(WH, 'shipment.handover', { shipmentId: sh.id, tracking: 'P23' });
      const before = unitEconomics(c.S, null, 'sku')[0];
      c.op(OWNER, 'expense.add', { amount: 2000, category: 'logistics_in', allocation: { type: 'batch', id: b.id } });
      const after = unitEconomics(c.S, null, 'sku')[0];
      c.check(before.cogs === 4000 && after.cogs === 4800, `Себестоимость продаж пересчитана: ${before.cogs} → ${after.cogs} ₽`);
      c.check(before.methodVersion !== after.methodVersion, `Отчёт показывает версию расчёта (${before.methodVersion} → ${after.methodVersion})`);
      return c;
    },
  },
  {
    id: 'AT-S24', title: 'Сотруднику убрали право видеть финансы',
    run({ S }) {
      const c = new Ctx(S);
      c.op(OWNER, 'users.setDeny', { userId: MGR.id, perm: 'finance.view', denied: true });
      const r = c.tryOp(MGR, 'expense.add', { amount: 1, category: 'rent' });
      c.check(!r.ok, 'Финансовые операции недоступны');
      c.check(c.S.users.find((u) => u.id === MGR.id).deny.includes('finance.view'), 'Запрет применён (UI и выгрузка скрывают финансы по этому праву)');
      return c;
    },
  },
  {
    id: 'AT-S29', title: 'Чужой заказ по URL / чужая претензия',
    run({ S, skuA }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 2);
      const r = c.checkout('Владелец заказа', [{ sku: skuA, qty: 1 }]);
      const x = c.tryOp(null, 'claim.open', { orderId: r.order.id, customerId: 'CUS-99999', reason: 'чужой' });
      c.check(!x.ok && x.error.code === 'NOT_FOUND', 'Доступ запрещён без раскрытия данных (ответ «не найдено»)');
      return c;
    },
  },
  {
    id: 'AT-S28', title: 'Нагрузка: 300 оформлений, конкуренция за остаток',
    run({ S, skuA, skuB }) {
      const c = new Ctx(S);
      c.receiveStock(skuA, 50); c.receiveStock(skuB, 200, 500);
      let ok = 0, fail = 0;
      for (let i = 0; i < 300; i++) {
        const r = c.tryOp(null, 'checkout', { clientToken: 'ct' + i, customer: { name: 'Н' + i, phone: '+7 901 ' + String(1000000 + i) }, items: [{ sku: i % 2 ? skuA : skuB, qty: 1 }], delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true } });
        r.ok ? ok++ : fail++;
      }
      const a = stockOf(c.S, skuA), b = stockOf(c.S, skuB);
      c.check(ok === 200 && fail === 100, `Успешно ${ok}, отказано ${fail} (остатка хватало на 200)`);
      c.check(a.available === 0 && b.available === 50 && c.S.lots.every((l) => lotAvailable(c.S, l) >= 0), 'Ни одного отрицательного остатка');
      const dup = c.op(null, 'checkout', { clientToken: 'ct1', customer: { name: 'x', phone: '+7 901 0000000' }, items: [{ sku: skuB, qty: 1 }], delivery: { carrier: 'cdek' }, consents: { pd: true, offer: true } });
      c.check(dup.duplicate, 'Повторное нажатие «Оформить» не создаёт второй заказ');
      return c;
    },
  },
];

export function runScenarios() {
  return SCENARIOS.map((sc) => {
    const t = (typeof performance !== 'undefined' ? performance : Date).now();
    try {
      const c = sc.run(fixture());
      return { id: sc.id, title: sc.title, pass: c.log.length > 0 && c.log.every((l) => l.ok), checks: c.log, ms: Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t) };
    } catch (e) {
      return { id: sc.id, title: sc.title, pass: false, checks: [{ ok: false, text: `Исключение: ${e.code || ''} ${e.message}` }], ms: 0 };
    }
  });
}
