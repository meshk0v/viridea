// Наборы выгрузки на Google Диск (Приложение Г) и сборка XLSX-снимка
import * as XLSX from 'xlsx';
import { orderTotals, orderStatus, lotAvailable, reservedOnLot, adaptationCost, availabilityStatus } from './engine.js';
import { unitEconomics } from './finance.js';

const iso = (t) => (t ? new Date(t).toISOString() : '');

export const DATASETS = [
  { id: 'catalog', file: 'catalog.xlsx', finance: false, cols: 'sku,cultivar_id,name,category,pack_size,price,availability,photo_url,updated_at' },
  { id: 'supplies', file: 'supplies.xlsx', finance: true, cols: 'batch_id,supplier_id,planned_at,received_at,status,sku,ordered_qty,confirmed_qty,received_qty,unit_cost' },
  { id: 'stock', file: 'warehouses.xlsx', finance: false, cols: 'warehouse_id,warehouse_name,sku,batch_id,physical_qty,quarantine_qty,reserved_qty,available_qty,revision' },
  { id: 'movements', file: 'movements.xlsx', finance: false, cols: 'movement_id,occurred_at,type,sku,batch_id,qty,from_warehouse,to_warehouse,reason,actor_id' },
  { id: 'reservations', file: 'reservations.xlsx', finance: false, cols: 'reservation_id,order_id,order_line_id,sku,batch_id,warehouse_id,qty,expires_at,state' },
  { id: 'orders', file: 'orders.xlsx', finance: false, cols: 'order_id,created_at,customer_ref,channel,status,subtotal,delivery,total,paid,balance' },
  { id: 'order_lines', file: 'order_lines.xlsx', finance: false, cols: 'order_line_id,order_id,sku,pack_size,qty,price_snapshot,allocated_batch_id,status' },
  { id: 'payments', file: 'payments.xlsx', finance: true, cols: 'payment_id,order_id,provider_ref,amount,method,state,occurred_at,refund_ref' },
  { id: 'expenses', file: 'expenses.xlsx', finance: true, cols: 'expense_id,occurred_at,category,amount,allocation_type,allocation_id,document_ref,actor_id' },
  { id: 'adaptation', file: 'adaptation.xlsx', finance: true, cols: 'adaptation_id,source_batch_id,sku,input_qty,loss_qty,output_qty,materials_cost,total_cost,status' },
  { id: 'shipments', file: 'shipments.xlsx', finance: false, cols: 'shipment_id,order_id,carrier,tracking,handover_at,received_at,state,parcel_line_ids' },
  { id: 'unit_economics', file: 'unit_economics.xlsx', finance: true, cols: 'sku,batch_id,period,revenue,cogs,variable_cost,contribution,margin_pct,method_version' },
  { id: 'claims', file: 'claims.xlsx', finance: false, cols: 'claim_id,order_id,order_line_id,reason,decision,approved_by,state,amount' },
  { id: 'audit', file: 'audit.xlsx', finance: false, cols: 'audit_id,occurred_at,actor_id,object_type,object_id,action,reason,old_value,new_value' },
  { id: 'export_status', file: 'export_status.xlsx', finance: false, cols: 'job_id,dataset,revision,queued_at,completed_at,state,retry_count,error_code' },
];

export function datasetRows(S, id) {
  switch (id) {
    case 'catalog':
      return S.variants.map((v) => ({ sku: v.sku, cultivar_id: v.cultivarId, name: v.title, category: v.category, pack_size: v.packSize, price: v.price, availability: availabilityStatus(S, v).code, photo_url: v.photo?.startsWith('http') ? v.photo : `files/catalog/${v.sku}.png`, updated_at: iso(v.updatedAt) }));
    case 'supplies':
      return S.batches.flatMap((b) => b.lines.map((l) => ({ batch_id: b.id, supplier_id: b.supplierId, planned_at: iso(b.plannedAt), received_at: iso(b.receivedAt), status: b.status, sku: l.sku, ordered_qty: l.orderedQty, confirmed_qty: l.confirmedQty, received_qty: l.receivedQty, unit_cost: l.unitCost })));
    case 'stock':
      return S.lots.map((l) => ({ warehouse_id: l.warehouseId, warehouse_name: S.warehouses.find((w) => w.id === l.warehouseId)?.name, sku: l.sku, batch_id: l.batchId, physical_qty: l.qty, quarantine_qty: l.quarantineQty, reserved_qty: reservedOnLot(S, l.id), available_qty: lotAvailable(S, l), revision: l.costVersion || 1 }));
    case 'movements':
      return S.movements.map((m) => ({ movement_id: m.id, occurred_at: iso(m.at), type: m.type, sku: m.sku, batch_id: m.batchId, qty: m.qty, from_warehouse: m.fromWh, to_warehouse: m.toWh, reason: m.reason, actor_id: m.actorId }));
    case 'reservations':
      return S.reservations.map((r) => ({ reservation_id: r.id, order_id: r.orderId, order_line_id: r.lineId, sku: r.sku, batch_id: r.batchId, warehouse_id: r.warehouseId, qty: r.qty, expires_at: iso(r.expiresAt), state: r.state }));
    case 'orders':
      return S.orders.map((o) => { const t = orderTotals(S, o); return { order_id: o.id, created_at: iso(o.createdAt), customer_ref: o.customerId, channel: o.channel, status: orderStatus(S, o), subtotal: t.subtotal, delivery: t.delivery, total: t.total, paid: t.paid, balance: t.balance }; });
    case 'order_lines':
      return S.orders.flatMap((o) => o.lines.map((l) => ({ order_line_id: l.id, order_id: o.id, sku: l.sku, pack_size: l.packSize, qty: l.qty, price_snapshot: l.unitPrice, allocated_batch_id: (l.allocations || []).map((a) => a.batchId).join(';') || S.reservations.find((r) => r.lineId === l.id)?.batchId || '', status: l.status })));
    case 'payments':
      return S.payments.map((p) => ({ payment_id: p.id, order_id: p.orderId, provider_ref: p.providerRef, amount: p.kind === 'refund' ? -p.amount : p.amount, method: p.method, state: p.state, occurred_at: iso(p.occurredAt), refund_ref: p.kind === 'refund' ? p.id : '' }));
    case 'expenses':
      return S.expenses.map((e) => ({ expense_id: e.id, occurred_at: iso(e.occurredAt), category: e.category, amount: e.amount, allocation_type: e.allocation?.type, allocation_id: e.allocation?.id, document_ref: e.documentRef, actor_id: e.authorId }));
    case 'adaptation':
      return S.adaptations.map((a) => { const c = adaptationCost(S, a); return { adaptation_id: a.id, source_batch_id: a.sourceBatchId, sku: a.sku, input_qty: a.inputPlants, loss_qty: c.lost, output_qty: a.outputQty || c.alive, materials_cost: c.materials, total_cost: c.total, status: a.status }; });
    case 'shipments':
      return S.shipments.map((s) => ({ shipment_id: s.id, order_id: s.orderId, carrier: s.carrier, tracking: s.tracking, handover_at: iso(s.handoverAt), received_at: iso(s.receivedAt), state: s.status, parcel_line_ids: s.lineIds.join(';') }));
    case 'unit_economics': {
      return unitEconomics(S, null, 'sku').map((r) => ({ sku: r.key, batch_id: [...new Set(S.sales.filter((s) => s.sku === r.key).map((s) => s.batchId))].join(';'), period: 'all', revenue: r.revenue, cogs: r.cogs, variable_cost: r.variable, contribution: r.contribution, margin_pct: r.marginPct ?? '', method_version: r.methodVersion }));
    }
    case 'claims':
      return S.claims.map((c) => ({ claim_id: c.id, order_id: c.orderId, order_line_id: c.lineId, reason: c.reason, decision: c.decision, approved_by: c.approvedBy, state: c.state, amount: c.amount }));
    case 'audit':
      return S.audit.map((a) => ({ audit_id: a.id, occurred_at: iso(a.at), actor_id: a.actorId, object_type: a.objectType, object_id: a.objectId, action: a.action, reason: a.reason, old_value: a.before == null ? '' : JSON.stringify(a.before), new_value: a.after == null ? '' : JSON.stringify(a.after) }));
    case 'export_status':
      return S.exportJobs.map((j) => ({ job_id: j.id, dataset: j.dataset, revision: j.revision, queued_at: iso(j.queuedAt), completed_at: iso(j.completedAt), state: j.state, retry_count: j.retries, error_code: j.error || '' }));
    default:
      return [];
  }
}

/** Полный датированный снимок: один XLSX с листами по наборам + служебный лист _meta */
export function buildSnapshot(S, { includeFinance = true } = {}) {
  const wb = XLSX.utils.book_new();
  const meta = [
    ['schema_version', S.schemaVersion],
    ['generated_at', new Date().toISOString()],
    ['timezone', S.settings.timezone],
    ['currency', S.settings.currency],
    ['source', 'VIRIDEA — транзакционная база сайта (источник истины)'],
    ['finance_included', includeFinance ? 'yes' : 'no (нет права finance.view)'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '_meta');
  DATASETS.forEach((ds, i) => {
    if (ds.finance && !includeFinance) return;
    const cols = ds.cols.split(',');
    const rows = datasetRows(S, ds.id);
    const aoa = [cols, ...rows.map((r) => cols.map((c) => r[c] ?? ''))];
    const name = `${String(i + 1).padStart(2, '0')}_${ds.id}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return wb;
}

export function downloadSnapshot(S, opts) {
  const wb = buildSnapshot(S, opts);
  const n = new Date(), z = (x) => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${z(n.getMonth() + 1)}-${z(n.getDate())}_${z(n.getHours())}-${z(n.getMinutes())}`;
  XLSX.writeFile(wb, `viridea_snapshot_${stamp}.xlsx`);
}

export const datasetSize = (S, id) => datasetRows(S, id).length;
