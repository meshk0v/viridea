// Начальные данные каталога и операций.
import { emptyState, run, makeVariant } from './engine.js';
import { DAY, HOUR } from './util.js';

export const STAFF = [
  { id: 'U1', name: 'Анна (владелец)', role: 'owner' },
  { id: 'U2', name: 'Борис (руководитель)', role: 'head' },
  { id: 'U3', name: 'Вера (менеджер)', role: 'manager' },
  { id: 'U4', name: 'Глеб (склад)', role: 'warehouse' },
];

const CULTIVARS = [
  ['Monstera', "Thai Constellation", 'monstera', 140, 'constellation'],
  ['Monstera', "Albo Borsigiana", 'monstera', 140, 'sectoral'],
  ['Monstera', "Aurea", 'monstera', 140, 'yellow'],
  ['Philodendron', "Pink Princess", 'heart', 150, 'pink'],
  ['Philodendron', "White Princess", 'heart', 150, 'splash'],
  ['Philodendron', "Florida Beauty", 'lobed', 145, 'yellow'],
  ['Philodendron', "Paraiso Verde", 'heart', 115, 'marble'],
  ['Philodendron', "Caramel Marble", 'heart', 95, 'marble'],
  ['Anthurium', "Crystallinum", 'heart', 160, 'veins'],
  ['Anthurium', "Warocqueanum", 'lance', 155, 'veins'],
  ['Alocasia', "Frydek Variegata", 'arrow', 150, 'sectoral'],
  ['Alocasia', "Dragon Scale", 'arrow', 165, 'veins'],
  ['Syngonium', "Albo Variegatum", 'arrow', 140, 'splash'],
  ['Syngonium', "Mottled Mojito", 'arrow', 120, 'mint'],
  ['Rhaphidophora', "Tetrasperma Variegata", 'lobed', 140, 'splash'],
  ['Scindapsus', "Jade Satin", 'heart', 175, 'none'],
  ['Begonia', "Maculata", 'lance', 160, 'dots'],
  ['Hoya', "Krimson Queen", 'oval', 140, 'pinkedge'],
];

const CARE = [
  ['Субстрат для адаптации микроклонов, 2 л', 390, 'bag'],
  ['Мини-парник с вентиляцией', 890, 'dome'],
  ['Тепловой пакет 72 ч для отправки', 120, 'heat'],
  ['Удобрение для ароидных, 250 мл', 540, 'bottle'],
  ['Горшок прозрачный с дренажом, 9 см', 70, 'pot'],
  ['Фитолампа клипса 10 Вт', 1490, 'lamp'],
];

export function buildSeed(now = Date.now()) {
  let S = emptyState();
  S.users = STAFF.map((u) => ({ ...u, deny: [] }));
  const owner = STAFF[0], head = STAFF[1], mgr = STAFF[2], wh = STAFF[3];
  const t0 = now - 40 * DAY;
  const ctx = (actor, offset) => ({ actor, now: t0 + offset });
  const doOp = (actor, offset, op, args) => { const r = run(S, ctx(actor, offset), op, args); S = r.state; return r.result; };

  S.warehouses = [
    { id: 'WH-MSK', name: 'Основной склад (Москва)', type: 'main', address: 'Москва', manager: 'Глеб', active: true, sellable: true },
    { id: 'WH-ADP', name: 'Зона адаптации (теплица)', type: 'adaptation', address: 'Москва', manager: 'Глеб', active: true, sellable: false },
    { id: 'WH-RES', name: 'Резервный склад', type: 'reserve', address: 'Москва', manager: 'Борис', active: true, sellable: true },
  ];
  S.suppliers = [
    { id: 'LAB-1', name: 'Лаборатория «Альфа»', contacts: 'менеджер лаборатории', terms: 'предоплата 50%' },
    { id: 'LAB-2', name: 'Лаборатория «Вега»', contacts: 'менеджер лаборатории', terms: 'по факту подтверждения' },
  ];
  S.apiKeys = [
    { id: 'KEY-1', name: 'RetailCRM', token: 'vrd_crm_7Hq2mX9pLr4tVw', scopes: ['catalog:read', 'stock:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'payments:read', 'shipments:read', 'approvals:write', 'webhooks:manage'], createdAt: t0, revoked: false },
    { id: 'KEY-2', name: 'Только чтение каталога', token: 'vrd_ro_3Kd8sQ1zNc', scopes: ['catalog:read', 'stock:read'], createdAt: t0, revoked: false },
  ];

  const sctx = { actor: owner, now: t0 };
  S.cultivars = CULTIVARS.map(([genus, name, shape, hue, varieg], i) => ({ id: `CV-${String(i + 1).padStart(4, '0')}`, key: `${genus} ${name}`.toLowerCase(), genus, name, synonyms: [], variegation: varieg !== 'none' && varieg !== 'veins', notes: '', art: { shape, hue, varieg, seed: i * 7 + 3 } }));
  S.seq['CV'] = S.cultivars.length;

  const mc = {}, ad = {};
  const basePrices = [5200, 3400, 3900, 1900, 2600, 2900, 2100, 2400, 1800, 3600, 2800, 2600, 1500, 1700, 2200, 900, 1300, 1100];
  S.cultivars.forEach((cv, i) => {
    const p = basePrices[i];
    mc[cv.id] = {
      1: makeVariant(S, sctx, { cultivarId: cv.id, category: 'microclone', packSize: 1, price: Math.round(p * 0.55 / 10) * 10, purchasePrice: Math.round(p * 0.3 / 10) * 10, title: `${cv.genus} ${cv.name} — микроклон ×1`, description: `Лабораторный микроклон ${cv.genus} '${cv.name}' в стерильной таре. Требует адаптации к комнатным условиям 3–6 недель.` }),
      5: makeVariant(S, sctx, { cultivarId: cv.id, category: 'microclone', packSize: 5, price: Math.round(p * 2.2 / 10) * 10, purchasePrice: Math.round(p * 1.2 / 10) * 10, title: `${cv.genus} ${cv.name} — микроклоны ×5`, description: `Упаковка из 5 лабораторных микроклонов ${cv.genus} '${cv.name}'. Цена указана за упаковку.`, isNew: i % 4 === 0 }),
    };
    if (i % 2 === 0) mc[cv.id][10] = makeVariant(S, sctx, { cultivarId: cv.id, category: 'microclone', packSize: 10, price: Math.round(p * 3.9 / 10) * 10, purchasePrice: Math.round(p * 2.2 / 10) * 10, title: `${cv.genus} ${cv.name} — микроклоны ×10`, description: `Упаковка из 10 микроклонов. Цена за упаковку, в пересчёте выгоднее, чем ×5.` });
    if (i < 12) ad[cv.id] = makeVariant(S, sctx, { cultivarId: cv.id, category: 'adapted', packSize: 1, price: Math.round(p * 0.95 / 10) * 10, title: `${cv.genus} ${cv.name} — адаптированное растение`, description: `Растение прошло адаптацию в теплице VIRIDEA, 3–4 листа, горшок 9 см.`, isNew: i % 3 === 0 });
    if (i % 3 === 1) makeVariant(S, sctx, { cultivarId: cv.id, category: 'seedling', packSize: 1, price: Math.round(p * 1.6 / 10) * 10, title: `${cv.genus} ${cv.name} — подрощенный саженец`, description: `Подрощенный саженец, 5–7 листьев, горшок 12 см.` });
  });
  const care = CARE.map(([title, price, icon]) => { const v = makeVariant(S, sctx, { category: 'care', packSize: 1, price, purchasePrice: Math.round(price * 0.5), title, description: 'Товар для ухода, отправляется вместе с растениями или отдельно.' }); v.icon = icon; return v; });

  const cv = (i) => S.cultivars[i].id;

  // Поставка 1: принята на склад
  const b1 = doOp(head, 1 * DAY, 'supply.create', {
    supplierId: 'LAB-1', plannedAt: t0 + 6 * DAY, logisticsCost: 6000,
    lines: [
      { sku: mc[cv(0)][5].sku, orderedQty: 6, unitCost: mc[cv(0)][5].purchasePrice },
      { sku: mc[cv(3)][5].sku, orderedQty: 10, unitCost: mc[cv(3)][5].purchasePrice },
      { sku: mc[cv(3)][1].sku, orderedQty: 12, unitCost: mc[cv(3)][1].purchasePrice },
      { sku: mc[cv(6)][5].sku, orderedQty: 8, unitCost: mc[cv(6)][5].purchasePrice },
      { sku: mc[cv(8)][10].sku, orderedQty: 5, unitCost: mc[cv(8)][10].purchasePrice },
      { sku: mc[cv(13)][5].sku, orderedQty: 10, unitCost: mc[cv(13)][5].purchasePrice },
      { sku: mc[cv(15)][1].sku, orderedQty: 20, unitCost: mc[cv(15)][1].purchasePrice },
    ],
  });
  for (const ln of b1.lines) doOp(mgr, 2 * DAY, 'supply.confirmLine', { batchId: b1.id, lineId: ln.id, state: 'full', note: 'Подтверждено письмом' });
  const b1r = S.batches.find((b) => b.id === b1.id);
  doOp(wh, 6 * DAY, 'supply.receive', { batchId: b1.id, warehouseId: 'WH-MSK', lines: b1r.lines.map((l, i) => ({ lineId: l.id, receivedQty: l.orderedQty, defectQty: i === 1 ? 1 : 0 })) });

  // Поставка 2: адаптированные растения и саженцы от второй лаборатории (принята)
  const b2 = doOp(head, 3 * DAY, 'supply.create', {
    supplierId: 'LAB-2', plannedAt: t0 + 8 * DAY, logisticsCost: 3500,
    lines: [
      ...Object.values(ad).slice(0, 10).map((v, i) => ({ sku: v.sku, orderedQty: 3 + (i % 4), unitCost: Math.round(v.price * 0.45) })),
      ...S.variants.filter((v) => v.category === 'seedling').map((v) => ({ sku: v.sku, orderedQty: 3, unitCost: Math.round(v.price * 0.45) })),
      ...care.map((v) => ({ sku: v.sku, orderedQty: 30, unitCost: v.purchasePrice })),
    ],
  });
  for (const ln of b2.lines) doOp(mgr, 4 * DAY, 'supply.confirmLine', { batchId: b2.id, lineId: ln.id, state: 'full' });
  doOp(wh, 8 * DAY, 'supply.receive', { batchId: b2.id, warehouseId: 'WH-MSK', lines: S.batches.find((b) => b.id === b2.id).lines.map((l) => ({ lineId: l.id, receivedQty: l.orderedQty, defectQty: 0 })) });

  // Поставка 3: подтверждена лабораторией частично, ещё не получена (ближайшее поступление)
  const b3 = doOp(head, 30 * DAY, 'supply.create', {
    supplierId: 'LAB-1', plannedAt: now + 9 * DAY, logisticsCost: 5000,
    lines: [
      { sku: mc[cv(1)][5].sku, orderedQty: 10, unitCost: mc[cv(1)][5].purchasePrice },
      { sku: mc[cv(10)][1].sku, orderedQty: 15, unitCost: mc[cv(10)][1].purchasePrice },
      { sku: mc[cv(4)][5].sku, orderedQty: 8, unitCost: mc[cv(4)][5].purchasePrice },
    ],
  });
  // Поставка 4: заказана, ждём ответа лаборатории (предзаказ)
  const b4 = doOp(head, 34 * DAY, 'supply.create', {
    supplierId: 'LAB-2', plannedAt: now + 21 * DAY, logisticsCost: 4000,
    lines: [
      { sku: mc[cv(11)][5].sku, orderedQty: 6, unitCost: mc[cv(11)][5].purchasePrice },
      { sku: mc[cv(9)][1].sku, orderedQty: 10, unitCost: mc[cv(9)][1].purchasePrice },
      { sku: mc[cv(2)][5].sku, orderedQty: 6, unitCost: mc[cv(2)][5].purchasePrice },
    ],
  });

  // Заказы
  const cust = [
    { name: 'Ольга К.', phone: '+7 900 111-22-33' },
    { name: 'Дмитрий С.', phone: '+7 900 222-33-44' },
    { name: 'Мария Л.', phone: '+7 900 333-44-55' },
    { name: 'Игорь П.', phone: '+7 900 444-55-66' },
    { name: 'Светлана Н.', phone: '+7 900 555-66-77' },
  ];
  const consents = { pd: true, offer: true };
  const order = (offset, c, items, carrier = 'cdek', channel = 'site') => doOp(null, offset, 'checkout', { customer: c, items, delivery: { carrier, address: 'ПВЗ СДЭК' }, consents, channel }).order;

  // 1. Оплачен и доставлен
  const o1 = order(10 * DAY, cust[0], [{ sku: ad[cv(0)].sku, qty: 1 }, { sku: care[0].sku, qty: 2 }]);
  doOp(mgr, 10 * DAY + 2 * HOUR, 'payment.record', { orderId: o1.id, providerRef: 'sbp_8f31001a2c', amount: orderTotalsLite(S, o1.id), method: 'card' });
  const sh1 = doOp(wh, 11 * DAY, 'shipment.create', { orderId: o1.id, lineIds: S.orders.find((o) => o.id === o1.id).lines.map((l) => l.id) });
  doOp(wh, 11 * DAY, 'shipment.photos', { shipmentId: sh1.id, count: 2 });
  doOp(wh, 11 * DAY + HOUR, 'shipment.handover', { shipmentId: sh1.id, tracking: '1012345678' });
  doOp(mgr, 13 * DAY, 'shipment.status', { shipmentId: sh1.id, status: 'arrived' });
  doOp(mgr, 14 * DAY, 'shipment.status', { shipmentId: sh1.id, status: 'received' });
  doOp(owner, 14 * DAY, 'expense.add', { amount: 120, category: 'packaging', allocation: { type: 'order', id: o1.id }, comment: 'Коробка, утеплитель' });
  doOp(owner, 14 * DAY, 'expense.add', { amount: 85, category: 'commission', allocation: { type: 'order', id: o1.id }, comment: 'Эквайринг' });

  // 2. VK: микроклоны, оплачен, отправлен
  const o2 = order(15 * DAY, cust[1], [{ sku: mc[cv(3)][5].sku, qty: 2 }, { sku: mc[cv(15)][1].sku, qty: 3 }], 'cdek', 'vk');
  doOp(mgr, 15 * DAY + 3 * HOUR, 'payment.record', { orderId: o2.id, providerRef: 'sbp_8f31002a2c', amount: orderTotalsLite(S, o2.id), method: 'sbp' });
  const sh2 = doOp(wh, 16 * DAY, 'shipment.create', { orderId: o2.id, lineIds: S.orders.find((o) => o.id === o2.id).lines.map((l) => l.id) });
  doOp(wh, 16 * DAY, 'shipment.photos', { shipmentId: sh2.id, count: 3 });
  doOp(wh, 16 * DAY + 2 * HOUR, 'shipment.handover', { shipmentId: sh2.id, tracking: '1012349911' });
  doOp(owner, 16 * DAY, 'expense.add', { amount: 150, category: 'packaging', allocation: { type: 'order', id: o2.id }, comment: 'Термобокс' });

  // 3. Частично оплачен
  const o3 = order(now - t0 - 20 * HOUR, cust[2], [{ sku: mc[cv(0)][5].sku, qty: 1 }, { sku: ad[cv(3)].sku, qty: 1 }]);
  doOp(mgr, now - t0 - 18 * HOUR, 'payment.record', { orderId: o3.id, providerRef: 'sbp_8f31003a2c', amount: Math.round(orderTotalsLite(S, o3.id) / 2), method: 'card' });

  // 4. Предзаказ: ждёт подтверждения лаборатории (b4)
  const o4 = order(35 * DAY, cust[3], [{ sku: mc[cv(11)][5].sku, qty: 3 }], 'cdek', 'telegram');
  doOp(mgr, 35 * DAY + HOUR, 'payment.record', { orderId: o4.id, providerRef: 'sbp_8f31004a2c', amount: orderTotalsLite(S, o4.id), method: 'sbp' });
  const o5 = order(36 * DAY, cust[4], [{ sku: mc[cv(11)][5].sku, qty: 2 }]);
  const o6 = order(37 * DAY, cust[0], [{ sku: mc[cv(11)][5].sku, qty: 1 }, { sku: care[2].sku, qty: 1 }]);

  // 5. Предзаказы на b3, затем частичное подтверждение лаборатории
  const o7 = order(31 * DAY, cust[1], [{ sku: mc[cv(1)][5].sku, qty: 4 }]);
  const o8 = order(32 * DAY, cust[2], [{ sku: mc[cv(1)][5].sku, qty: 3 }]);
  const o9 = order(33 * DAY, cust[3], [{ sku: mc[cv(1)][5].sku, qty: 3 }]);
  const b3r = S.batches.find((b) => b.id === b3.id);
  doOp(mgr, 36 * DAY, 'supply.confirmLine', { batchId: b3.id, lineId: b3r.lines[0].id, state: 'partial', confirmedQty: 6, note: 'Лаборатория: 6 из 10, остальные не прошли контроль' });
  doOp(mgr, 36 * DAY, 'supply.confirmLine', { batchId: b3.id, lineId: b3r.lines[1].id, state: 'full' });

  // Адаптация: завершённая и текущая
  const lotPP = S.lots.find((l) => l.sku === mc[cv(3)][1].sku);
  const a1 = doOp(wh, 12 * DAY, 'adaptation.start', { lotId: lotPP.id, packs: 6, substrate: 'сфагнум + перлит', location: 'Стеллаж А' });
  doOp(wh, 12 * DAY, 'adaptation.material', { adaptationId: a1.id, name: 'Субстрат, горшки, мини-парник', amount: 640 });
  doOp(wh, 20 * DAY, 'adaptation.loss', { adaptationId: a1.id, qty: 1, reason: 'Загнивание корней' });
  doOp(wh, 33 * DAY, 'adaptation.complete', { adaptationId: a1.id, price: 2400 });
  const lotMoj = S.lots.find((l) => l.sku === mc[cv(13)][5].sku);
  const a2 = doOp(wh, 30 * DAY, 'adaptation.start', { lotId: lotMoj.id, packs: 2, substrate: 'кокос + перлит', location: 'Стеллаж Б' });
  doOp(wh, 30 * DAY, 'adaptation.material', { adaptationId: a2.id, name: 'Субстрат и горшки', amount: 420 });
  doOp(wh, 37 * DAY, 'adaptation.loss', { adaptationId: a2.id, qty: 2, reason: 'Не укоренились' });

  // Общие расходы
  doOp(owner, 5 * DAY, 'expense.add', { amount: 25000, category: 'rent', comment: 'Аренда теплицы' });
  doOp(owner, 9 * DAY, 'expense.add', { amount: 12000, category: 'marketing', comment: 'Таргет VK' });
  doOp(owner, 9 * DAY, 'expense.add', { amount: 2900, category: 'services', comment: 'Хостинг и сервисы' });
  doOp(owner, 25 * DAY, 'expense.add', { amount: 15000, category: 'withdrawal', comment: 'Личное изъятие (не операционный расход)' });

  // Претензия
  doOp(null, 15 * DAY, 'claim.open', { orderId: o1.id, customerId: S.orders.find((o) => o.id === o1.id).customerId, reason: 'Повреждение при доставке', message: 'Сломан один лист', photos: 2 });

  // фоновые события как будто доставлены
  S.events.forEach((e, i) => { if (i < S.events.length - 6) { e.delivered = true; e.attempts = 1; } });
  S.exportJobs = [];
  S.google = { online: true, lastSuccessAt: now - 2 * 60 * 1000, revision: 41 };
  S._dirty = [];
  S.seededAt = now;
  void o5; void o6; void o7; void o8; void o9; void b4;
  return S;
}

function orderTotalsLite(S, id) {
  const o = S.orders.find((x) => x.id === id);
  return o.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) + o.delivery.price;
}
