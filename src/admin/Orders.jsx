import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { orderById, orderTotals, orderStatus, allocatedQty, compensationBalance } from '../engine/engine.js';
import { CARRIERS, LINE_STATUS, ORDER_STATUS, SHIPMENT_STATUS, CHANNELS } from '../engine/model.js';
import { rub, dt, randomToken } from '../engine/util.js';
import { Denied, Modal, Field } from '../ui/kit.jsx';
import { Head } from './Admin.jsx';
import { useAction } from './ActionModal.jsx';

const statusCls = (s) => ({ needs_decision: 'bad', awaiting_payment: 'warn', partially_paid: 'warn', paid: 'ok', delivered: 'ok', shipped: 'info', partially_shipped: 'info', awaiting_supply: 'info', cancelled: '' }[s] || '');

export function OrdersAdmin() {
  const { S, can } = useStore();
  const nav = useNavigate();
  const [f, setF] = useState('');
  const [q, setQ] = useState('');
  if (!can('order.view')) return <Denied perm="order.view" />;
  const rows = [...S.orders].sort((a, b) => b.createdAt - a.createdAt).map((o) => ({ o, st: orderStatus(S, o), t: orderTotals(S, o) })).filter(({ o, st }) => (!f || st === f) && (!q || (o.id + o.customerSnapshot.name + o.customerSnapshot.phone).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <Head title="Заказы" sub="Сайт ведёт заказы автономно — RetailCRM подключается к API позже">
        <input className="input" placeholder="Номер, имя, телефон" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <select className="input" style={{ width: 'auto' }} value={f} onChange={(e) => setF(e.target.value)}><option value="">Все статусы</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Head>
      <div className="table-wrap"><table className="t"><thead><tr><th>Заказ</th><th>Дата</th><th>Канал</th><th>Клиент</th><th className="num">Позиций</th><th className="num">Сумма</th><th className="num">Оплачено</th><th className="num">Остаток</th><th>Статус</th></tr></thead><tbody>
        {rows.map(({ o, st, t }) => (
          <tr key={o.id} className="click" onClick={() => nav(`/admin/orders/${o.id}`)}>
            <td className="mono">{o.id}</td><td className="small">{dt(o.createdAt)}</td><td className="small">{CHANNELS.find((c) => c.id === o.channel)?.name}</td><td>{o.customerSnapshot.name}<div className="muted small">{o.customerSnapshot.phone}</div></td>
            <td className="num">{o.lines.filter((l) => !['cancelled', 'replaced'].includes(l.status)).length}</td><td className="num">{rub(t.total)}</td><td className="num">{rub(t.paid)}</td><td className="num" style={{ color: t.balance > 0 ? 'var(--danger)' : undefined }}>{rub(t.balance)}</td>
            <td><span className={`pill ${statusCls(st)}`}>{ORDER_STATUS[st]}</span></td>
          </tr>
        ))}
      </tbody></table></div>
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const { S, op, can } = useStore();
  const [act, modal] = useAction();
  const [ship, setShip] = useState(null);
  const [link, setLink] = useState(null);
  if (!can('order.view')) return <Denied perm="order.view" />;
  const o = orderById(S, id);
  if (!o) return <div className="denied">Заказ не найден</div>;
  const t = orderTotals(S, o);
  const st = orderStatus(S, o);
  const pays = S.payments.filter((p) => p.orderId === o.id);
  const ships = S.shipments.filter((s) => s.orderId === o.id);
  const reservable = o.lines.filter((l) => l.status === 'reserved' && !ships.some((s) => s.lineIds.includes(l.id)));
  const audit = S.audit.filter((a) => a.objectId === o.id || ships.some((s) => s.id === a.objectId) || o.lines.some((l) => l.id === a.objectId)).slice(-25).reverse();
  const bal = compensationBalance(S, o.customerId);
  const carrier = CARRIERS.find((c) => c.id === o.delivery.carrier);
  return (
    <>
      <Head title={`Заказ ${o.id}`} sub={`${dt(o.createdAt)} · ${CHANNELS.find((c) => c.id === o.channel)?.name} · версия ${o.version}`}>
        <span className={`pill ${statusCls(st)}`} style={{ fontSize: 14, padding: '6px 14px' }}>{ORDER_STATUS[st]}</span>
        <Link to="/admin/orders" className="btn light sm">← Все заказы</Link>
      </Head>
      <div className="kpis">
        <div className="kpi"><div className="l">Сумма</div><div className="v">{rub(t.total)}</div><div className="s">товары {rub(t.subtotal)} + доставка {rub(t.delivery)}</div></div>
        <div className="kpi"><div className="l">Оплачено</div><div className="v">{rub(t.paid)}</div><div className="s">{pays.filter((p) => p.state === 'confirmed').length} подтверждённых операций</div></div>
        <div className={`kpi ${t.balance > 0 ? 'bad' : ''}`}><div className="l">Остаток</div><div className="v">{rub(t.balance)}</div><div className="s">{o.shipException ? `отгрузка разрешена: ${o.shipException.byName}` : t.balance > 0 ? 'отгрузка запрещена до оплаты' : 'оплачен полностью'}</div></div>
        <div className="kpi"><div className="l">Клиент</div><div className="v" style={{ fontSize: 20 }}>{o.customerSnapshot.name}</div><div className="s">{o.customerSnapshot.phone} · компенсации {rub(bal)}</div></div>
      </div>
      <div className="panel">
        <h3>Позиции (цены зафиксированы на момент заказа)</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>Позиция</th><th>Товар</th><th>Тип</th><th className="num">Кол-во</th><th className="num">Цена</th><th className="num">Сумма</th><th>Обеспечение</th><th>Статус</th><th></th></tr></thead><tbody>
          {o.lines.map((l) => {
            const rs = S.reservations.filter((r) => r.lineId === l.id && r.state === 'active');
            return (
              <tr key={l.id} style={['cancelled', 'replaced'].includes(l.status) ? { opacity: 0.5 } : undefined}>
                <td className="mono small">{l.id}</td><td>{l.title}<div className="mono muted small">{l.sku}{l.replacesLineId ? ` · замена ${l.replacesLineId}` : ''}</div></td>
                <td className="small">{l.mode === 'stock' ? 'со склада' : 'предзаказ'}</td><td className="num">{l.qty}</td><td className="num">{rub(l.unitPrice)}</td><td className="num">{rub(l.qty * l.unitPrice)}</td>
                <td className="small">{rs.length ? rs.map((r) => <div key={r.id}>резерв {r.qty} · {r.lotId} · до {dt(r.expiresAt)}</div>) : l.mode === 'preorder' ? `подтв. лаб.: ${allocatedQty(l)} из ${l.qty}` : '—'}</td>
                <td><span className={`pill ${['shortage', 'expired'].includes(l.status) ? 'bad' : l.status === 'shipped' ? 'ok' : ''}`}>{LINE_STATUS[l.status]}</span></td>
                <td><div className="row-flex">
                  {can('order.edit') && ['shortage', 'partial', 'expired', 'queued'].includes(l.status) && <button className="linkbtn small" onClick={() => { const r = op('replacement.createLink', { orderId: o.id, lineId: l.id }, { success: 'Ссылка создана, клиент уведомлён' }); if (r) setLink(r.token); }}>ссылка на замену</button>}
                  {can('order.edit') && l.status === 'expired' && <button className="linkbtn small" onClick={() => op('order.rereserve', { orderId: o.id, lineId: l.id }, { success: 'Резерв восстановлен' })}>зарезервировать снова</button>}
                  {can('order.edit') && !['shipped', 'cancelled', 'replaced'].includes(l.status) && <button className="linkbtn small" style={{ color: 'var(--danger)' }} onClick={() => act({ title: 'Отменить позицию', op: 'order.cancelLine', args: { orderId: o.id, lineId: l.id }, danger: true, text: 'Резерв будет снят. Если позиция оплачена — оформите возврат отдельно.', fields: [{ k: 'reason', label: 'Причина' }] })}>отменить</button>}
                </div></td>
              </tr>
            );
          })}
        </tbody></table></div>
        {link && <div className="notice ok" style={{ marginTop: 10 }}>Персональная ссылка (одноразовая, 72 ч): <a className="mono" href={`#/replace/${link}`} target="_blank" rel="noreferrer">{location.origin + location.pathname}#/replace/{link}</a></div>}
        <div className="small muted" style={{ marginTop: 8 }}>Доставка: {carrier?.name} · {o.delivery.address || 'адрес не указан'} · {o.delivery.split ? 'раздельная отправка (2 доставки)' : 'одна отправка'}{o.delivery.riskAccepted && <span className="pill warn" style={{ marginLeft: 6 }}>клиент подтвердил риск перевозчика</span>}</div>
      </div>
      <div className="cols2">
        <div className="panel">
          <div className="panel-head"><h3>Платежи</h3><div className="row-flex">
            {can('payment.record') && t.balance > 0 && <button className="btn sm" onClick={() => act({ title: 'Внести платёж', op: 'payment.record', args: { orderId: o.id }, success: 'Платёж учтён', text: 'ID операции провайдера обязателен: повтор с тем же ID не удвоит сумму.', fields: [{ k: 'amount', label: 'Сумма, ₽', type: 'number', default: t.balance }, { k: 'providerRef', label: 'ID операции провайдера', default: 'manual-' + randomToken(8) }, { k: 'method', label: 'Способ', type: 'select', default: 'sbp', options: [['sbp', 'СБП'], ['card', 'Карта'], ['transfer', 'Перевод']] }] })}>+ Платёж</button>}
            {can('payment.record') && bal > 0 && t.balance > 0 && <button className="btn light sm" onClick={() => act({ title: 'Оплатить компенсацией', op: 'compensation.use', args: { orderId: o.id }, fields: [{ k: 'amount', label: `Сумма (баланс ${bal} ₽)`, type: 'number', default: Math.min(bal, t.balance) }] })}>Компенсацией</button>}
            {can('payment.refund') && t.paid > 0 && <button className="btn light sm" onClick={() => act({ title: 'Инициировать возврат', op: 'refund.request', args: { orderId: o.id }, text: 'Внутренний статус ≠ фактический возврат. Операция станет «подтверждённой» после ответа провайдера.', fields: [{ k: 'amount', label: 'Сумма', type: 'number' }, { k: 'reason', label: 'Причина' }] })}>Возврат</button>}
          </div></div>
          <div className="table-wrap"><table className="t"><tbody>
            {pays.map((p) => <tr key={p.id}><td className="mono small">{p.id}</td><td>{p.kind === 'refund' ? 'Возврат' : 'Оплата'} · {p.method}<div className="mono muted small">{p.providerRef || 'ждёт ID провайдера'}</div></td><td className="num" style={{ color: p.kind === 'refund' ? 'var(--danger)' : undefined }}>{p.kind === 'refund' ? '−' : ''}{rub(p.amount)}</td><td><span className={`pill ${p.state === 'confirmed' ? 'ok' : 'warn'}`}>{p.state === 'confirmed' ? 'подтверждён' : 'ожидает провайдера'}</span>{p.state === 'pending' && can('payment.refund') && <button className="linkbtn small" style={{ marginLeft: 6 }} onClick={() => op('refund.confirm', { refundId: p.id, providerRef: 'refund-' + randomToken(8) }, { success: 'Возврат подтверждён провайдером' })}>отметить подтверждение</button>}</td><td className="small muted">{dt(p.occurredAt)}</td></tr>)}
            {!pays.length && <tr><td className="muted">Платежей нет. Ссылку на оплату менеджер отправляет вручную .</td></tr>}
          </tbody></table></div>
          {t.balance > 0 && !o.shipException && can('ship.exception') && <button className="btn light sm" style={{ marginTop: 10 }} onClick={() => act({ title: 'Разрешить отгрузку без полной оплаты', op: 'order.shipException', args: { orderId: o.id }, text: `Задолженность ${rub(t.balance)} будет зафиксирована за клиентом.`, fields: [{ k: 'reason', label: 'Основание' }] })}>Разрешить отгрузку с задолженностью</button>}
          {o.shipException && <div className="notice small" style={{ marginTop: 10 }}>Отгрузка разрешена {o.shipException.byName} {dt(o.shipException.at)}: «{o.shipException.reason}». Задолженность на момент разрешения: {rub(o.shipException.debt)}.</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Посылки</h3>{can('shipment.manage') && reservable.length > 0 && <button className="btn sm" onClick={() => setShip(reservable.map((l) => l.id))}>+ Посылка</button>}</div>
          {ships.map((s) => (
            <div key={s.id} className="card" style={{ padding: 14 }}>
              <div className="row-flex"><b className="mono">{s.id}</b><span className="pill info">{SHIPMENT_STATUS[s.status]}</span><span className="spacer" /><span className="small">{CARRIERS.find((c) => c.id === s.carrier)?.name}</span></div>
              <div className="small" style={{ marginTop: 6 }}>Состав: {s.lineIds.map((id) => o.lines.find((l) => l.id === id)?.title).join(', ')}</div>
              <div className="small">Трек: <b className="mono">{s.tracking || '—'}</b>{s.manualEntry && ' (введён вручную)'} · фото упаковки: {s.packagePhotos}{s.requiresPhotos && !s.packagePhotos && <span className="err"> — обязательно для живых растений</span>}</div>
              {can('shipment.manage') && <div className="row-flex" style={{ marginTop: 8 }}>
                {s.status === 'created' && <button className="btn light sm" onClick={() => op('shipment.photos', { shipmentId: s.id, count: 2 }, { success: 'Фото упаковки прикреплены' })}>+ фото упаковки</button>}
                {s.status === 'created' && <button className="btn sm" onClick={() => act({ title: 'Передать перевозчику', op: 'shipment.handover', args: { shipmentId: s.id }, success: 'Передано, клиент получил трек', text: 'Трек отправляется клиенту только после фактической передачи. При недоступном API перевозчика — ручной ввод.', fields: [{ k: 'tracking', label: 'Трек-номер', default: String(10 ** 9 + Math.floor(Math.random() * 9 * 10 ** 8)) }, { k: 'manual', label: 'Ввод', type: 'checkbox', checkLabel: 'API перевозчика недоступен — ввод вручную' }] })}>Передать перевозчику</button>}
                {s.status === 'handed_over' && <button className="btn light sm" onClick={() => op('shipment.status', { shipmentId: s.id, status: 'arrived' })}>Прибыла в ПВЗ</button>}
                {['handed_over', 'arrived'].includes(s.status) && <button className="btn light sm" onClick={() => op('shipment.status', { shipmentId: s.id, status: 'received' })}>Вручена</button>}
              </div>}
            </div>
          ))}
          {!ships.length && <p className="muted small">Посылок нет. Собрать можно только зарезервированные позиции.</p>}
        </div>
      </div>
      <div className="panel">
        <h3>История заказа</h3>
        <div className="tl">{audit.map((a) => <div key={a.id}><b>{a.action}</b> — {a.actorName}{a.reason ? ` · «${a.reason}»` : ''}<div className="muted small">{dt(a.at)} · {a.id}</div></div>)}</div>
      </div>
      {ship && <ShipModal o={o} lines={reservable} onClose={() => setShip(null)} />}
      {modal}
    </>
  );
}

function ShipModal({ o, lines, onClose }) {
  const { op } = useStore();
  const [sel, setSel] = useState(lines.map((l) => l.id));
  const [weight, setWeight] = useState(0.8);
  return (
    <Modal title="Новая посылка" onClose={onClose} actions={<><button className="btn light" onClick={onClose}>Отмена</button><button className="btn" disabled={!sel.length} onClick={() => op('shipment.create', { orderId: o.id, lineIds: sel, weight: +weight }, { success: 'Посылка создана' }) && onClose()}>Создать</button></>}>
      <p className="small muted">Один заказ может быть отправлен несколькими посылками; идентификаторы посылок не смешиваются со складскими партиями.</p>
      {lines.map((l) => <label key={l.id} className="row-flex" style={{ padding: '4px 0' }}><input type="checkbox" checked={sel.includes(l.id)} onChange={() => setSel((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))} />{l.title} × {l.qty}</label>)}
      <Field label="Вес, кг"><input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
    </Modal>
  );
}

export function ClaimsAdmin() {
  const { S, can } = useStore();
  const [act, modal] = useAction();
  if (!can('claim.decide')) return <Denied perm="claim.decide" />;
  return (
    <>
      <Head title="Претензии и компенсации" sub="Компенсационный баланс ведётся отдельно от денег; начисление только с основанием и правом" />
      <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Заказ</th><th>Причина</th><th>Сообщение</th><th>Решение</th><th className="num">Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
        {[...S.claims].reverse().map((c) => (
          <tr key={c.id}><td className="mono">{c.id}</td><td><Link className="mono" to={`/admin/orders/${c.orderId}`}>{c.orderId}</Link></td><td>{c.reason}</td><td className="small">{c.message}{c.photos ? ` · фото: ${c.photos}` : ''}</td><td>{c.decision || '—'}</td><td className="num">{c.amount ? rub(c.amount) : ''}</td>
            <td><span className={`pill ${c.state === 'open' ? 'warn' : 'ok'}`}>{c.state === 'open' ? 'открыта' : 'решена'}</span></td>
            <td>{c.state === 'open' && <button className="btn sm" onClick={() => act({ title: `Решение по ${c.id}`, op: 'claim.decide', args: { claimId: c.id }, text: 'Компенсацию на баланс клиента начисляет руководитель или владелец; повторное начисление по одной претензии запрещено.', fields: [{ k: 'decision', label: 'Решение', type: 'select', default: 'compensation', options: [['compensation', 'Компенсация на баланс'], ['replacement', 'Замена'], ['refund', 'Возврат денег (через провайдера)'], ['reject', 'Отказ']] }, { k: 'amount', label: 'Сумма, ₽', type: 'number', default: 500 }, { k: 'comment', label: 'Комментарий' }] })}>Решить</button>}</td></tr>
        ))}
      </tbody></table></div>
      {modal}
    </>
  );
}
