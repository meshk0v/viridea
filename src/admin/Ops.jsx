import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { stockOf, availabilityStatus, cultivarOf, lotAvailable, reservedOnLot, adaptationCost, variantBySku, batchUnitCosts, allocatedQty, whById } from '../engine/engine.js';
import { CATEGORIES, catName, MOVEMENT_TYPES } from '../engine/model.js';
import { parsePriceList, previewPriceList } from '../engine/pricelist.js';
import { rub, dt, d, num } from '../engine/util.js';
import { photoOf } from '../ui/art.js';
import { Modal, Field, Tabs, Denied } from '../ui/kit.jsx';
import { Head } from './Admin.jsx';
import { useAction } from './ActionModal.jsx';

const BASE = import.meta.env.BASE_URL;

// ───────── Каталог ─────────
export function CatalogAdmin() {
  const { S, op, can } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [sel, setSel] = useState([]);
  const [confirmMass, setConfirmMass] = useState(null);
  const rows = S.variants.filter((v) => (!cat || v.category === cat) && (!q || (v.title + v.sku).toLowerCase().includes(q.toLowerCase())));
  const doMass = (active) => { for (const sku of sel) op('catalog.update', { sku, patch: { active }, reason: 'Массовое действие' }, { silent: true }); setSel([]); setConfirmMass(null); };
  return (
    <>
      <Head title="Каталог" sub={`${S.variants.length} SKU · ${S.cultivars.length} сортов. Сорт ≠ SKU: один сорт продаётся в разных формах`}>
        <input className="input" placeholder="Поиск по названию или SKU" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Все категории</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </Head>
      {sel.length > 0 && can('catalog.edit') && <div className="notice info row-flex">Выбрано: {sel.length} <span className="spacer" /><button className="btn sm" onClick={() => setConfirmMass(true)}>Опубликовать</button><button className="btn light sm" onClick={() => setConfirmMass(false)}>В архив</button><button className="linkbtn small" onClick={() => setSel([])}>снять выбор</button></div>}
      <div className="table-wrap"><table className="t"><thead><tr><th></th><th></th><th>SKU</th><th>Наименование</th><th>Категория</th><th className="num">Упак.</th><th className="num">Цена</th>{can('finance.view') && <th className="num">Закупка</th>}<th className="num">Доступно</th><th>Витрина</th></tr></thead><tbody>
        {rows.map((v) => { const st = stockOf(S, v.sku); const a = availabilityStatus(S, v); return (
          <tr key={v.sku} className="click" onClick={() => setEdit(v.sku)}>
            <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Выбрать" checked={sel.includes(v.sku)} onChange={() => setSel((s) => (s.includes(v.sku) ? s.filter((x) => x !== v.sku) : [...s, v.sku]))} /></td>
            <td><img className="th" src={photoOf(S, v)} alt="" /></td>
            <td className="mono">{v.sku}</td><td>{v.title}{!v.active && <span className="pill" style={{ marginLeft: 6 }}>архив</span>}{v.isIndividual && <span className="pill gold" style={{ marginLeft: 6 }}>экземпляр</span>}</td>
            <td className="small">{catName(v.category)}</td><td className="num">{v.packSize}</td><td className="num">{rub(v.price)}</td>
            {can('finance.view') && <td className="num muted">{v.purchasePrice ? rub(v.purchasePrice) : '—'}</td>}
            <td className="num">{st.available}{st.quarantine > 0 && <span className="muted small"> (+{st.quarantine} кар.)</span>}</td>
            <td><span className={`pill ${a.code}`}>{a.label}</span></td>
          </tr>); })}
      </tbody></table></div>
      {confirmMass != null && <Modal title={confirmMass ? 'Опубликовать выбранные?' : 'Перенести в архив?'} onClose={() => setConfirmMass(null)} actions={<><button className="btn light" onClick={() => setConfirmMass(null)}>Отмена</button><button className="btn" onClick={() => doMass(confirmMass)}>Да, для {sel.length} SKU</button></>}><p>Массовое изменение затронет {sel.length} товаров. Каждое изменение попадёт в журнал аудита. Уже оформленные заказы не меняются.</p></Modal>}
      {edit && <EditVariant sku={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EditVariant({ sku, onClose }) {
  const { S, op, can } = useStore();
  const v = variantBySku(S, sku);
  const [f, setF] = useState({ title: v.title, price: v.price, description: v.description, restrictions: v.restrictions, active: v.active, isNew: v.isNew, seoTitle: v.seoTitle, seoDescription: v.seoDescription });
  const save = () => {
    const patch = {};
    for (const k of Object.keys(f)) if (f[k] !== v[k]) patch[k] = k === 'price' ? +f[k] : f[k];
    if (!Object.keys(patch).length) return onClose();
    if (op('catalog.update', { sku, patch }, { success: 'Карточка сохранена' })) onClose();
  };
  const cv = cultivarOf(S, v);
  return (
    <Modal title={`${v.sku} · ${v.title}`} onClose={onClose} actions={<><button className="btn light" onClick={onClose}>Закрыть</button>{can('catalog.edit') && <button className="btn" onClick={save}>Сохранить</button>}</>}>
      <div className="row-flex" style={{ alignItems: 'flex-start' }}>
        <img src={photoOf(S, v)} alt="" style={{ width: 96, height: 96, borderRadius: 12 }} />
        <div className="small muted">Сорт: {cv ? `${cv.genus} ‘${cv.name}’ (${cv.id})` : '—'}<br />Категория: {catName(v.category)} · упаковка ×{v.packSize} · единица: {v.saleUnit}<br /><Link to={`/p/${v.sku}`} target="_blank">Открыть на витрине ↗</Link></div>
      </div>
      <Field label="Наименование"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Розничная цена, ₽" hint="Старые заказы сохраняют свою цену"><input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Статус"><label className="row-flex"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> на витрине</label><label className="row-flex"><input type="checkbox" checked={f.isNew} onChange={(e) => setF({ ...f, isNew: e.target.checked })} /> новинка</label></Field>
      </div>
      <Field label="Описание"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Ограничения доставки"><input value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="SEO title"><input value={f.seoTitle} onChange={(e) => setF({ ...f, seoTitle: e.target.value })} /></Field>
        <Field label="SEO description"><input value={f.seoDescription} onChange={(e) => setF({ ...f, seoDescription: e.target.value })} /></Field>
      </div>
      <h3 style={{ fontSize: 14, marginTop: 8 }}>История цены</h3>
      <div className="small">{v.priceHistory.map((p, i) => <div key={i}>{dt(p.at)} — {rub(p.price)} <span className="muted">({p.source})</span></div>)}</div>
      {can('finance.view') && v.purchaseHistory?.length > 0 && <><h3 style={{ fontSize: 14, marginTop: 8 }}>История закупочной цены</h3><div className="small">{v.purchaseHistory.map((p, i) => <div key={i}>{dt(p.at)} — {rub(p.price)} <span className="muted">({p.source})</span></div>)}</div></>}
    </Modal>
  );
}

// ───────── Импорт прайса ─────────
const ACT = { new: ['ok', 'Новый товар'], update: ['info', 'Обновление'], skip: ['', 'Пропуск'], conflict: ['bad', 'Конфликт'], duplicate: ['warn', 'Дубликат'] };

export function ImportAdmin() {
  const { S, op, can } = useStore();
  const [supplierId, setSupplierId] = useState(S.suppliers[0]?.id);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!can('pricelist.import')) return <Denied perm="pricelist.import" />;
  const preview = parsed ? previewPriceList(S, parsed, supplierId) : null;

  const load = async (buf, name) => {
    setBusy(true); setResult(null); setOverrides({});
    try { setParsed(await parsePriceList(buf)); setFile(name); } catch (e) { alert('Не удалось прочитать XLSX: ' + e.message); }
    setBusy(false);
  };
  const loadSample = async (n) => { const f = n === 1 ? "alfa_price_okt.xlsx" : "alfa_price_nov.xlsx"; const r = await fetch(`${BASE}samples/${f}`); load(await r.arrayBuffer(), f); };
  const rows = preview?.rows.map((r) => (overrides[r.rowNo] ? { ...r, action: overrides[r.rowNo] } : r)) || [];
  const apply = () => {
    const res = op('pricelist.apply', { fileName: file, checksum: parsed.checksum, supplierId, rows: rows.filter((r) => ['new', 'update'].includes(r.action)).map(({ photo, ...r }) => ({ ...r, photo })) });
    if (res) setResult(res);
  };

  return (
    <>
      <Head title="Импорт прайсов лабораторий" sub="XLSX: A — №, B — сорт, C — встроенное фото, D — кол-во в упаковке, E — цена «2 200руб.»" />
      <div className="panel">
        <div className="inline-form">
          <Field label="Лаборатория"><select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setResult(null); }}>{S.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Файл XLSX"><input type="file" accept=".xlsx" onChange={async (e) => { const f = e.target.files[0]; if (f) load(await f.arrayBuffer(), f.name); }} /></Field>
          <div className="row-flex"><span className="muted small">недавние файлы:</span><button className="btn light sm" onClick={() => loadSample(1)}>alfa_price_okt.xlsx</button><button className="btn light sm" onClick={() => loadSample(2)}>alfa_price_nov.xlsx</button></div>
        </div>
        {busy && <p>Читаю файл…</p>}
      </div>
      {preview && (
        <>
          <div className="panel">
            <div className="panel-head"><h3>Предпросмотр: {file}</h3><span className="mono small muted">SHA-256 {parsed.checksum.slice(0, 16)}…</span></div>
            <div className="row-flex" style={{ marginBottom: 10 }}>{Object.entries(ACT).map(([k, [cls, l]]) => <span key={k} className={`pill ${cls}`}>{l}: {rows.filter((r) => r.action === k).length}</span>)}<span className="pill">Фото найдено: {rows.filter((r) => r.photo).length} из {rows.length}</span></div>
            {preview.alreadyImported && <div className="notice info">Этот файл уже импортирован {dt(preview.alreadyImported.at)} (версия {preview.alreadyImported.version}). Повторное применение не создаст дублей.</div>}
            <div className="table-wrap"><table className="t"><thead><tr><th>Стр.</th><th>Фото (по якорю)</th><th>Сорт</th><th>Упаковка</th><th className="num">Цена</th><th>Действие</th><th>Пояснение</th></tr></thead><tbody>
              {rows.map((r) => (
                <tr key={r.rowNo}>
                  <td className="mono">{r.rowNo}</td>
                  <td>{r.photo ? <img className="th" src={r.photo} alt="" style={{ width: 52, height: 52 }} /> : <span className="pill warn">нет фото</span>}</td>
                  <td>{r.name}<div className="muted small">{r.genus || '—'} · ключ: {r.cultivarKey}</div></td>
                  <td>{r.packSize ?? '—'}<div className="muted small">«{r.packRaw}»</div></td>
                  <td className="num">{r.price ? rub(r.price) : '—'}<div className="muted small">«{r.priceRaw}»</div></td>
                  <td>
                    {r.action === 'conflict' || preview.rows.find((x) => x.rowNo === r.rowNo).action === 'conflict' ? (
                      <select className="input" value={r.action} onChange={(e) => setOverrides({ ...overrides, [r.rowNo]: e.target.value })}><option value="conflict">Решить вручную…</option><option value="new">Создать новый</option><option value="skip">Пропустить</option></select>
                    ) : <span className={`pill ${ACT[r.action][0]}`}>{ACT[r.action][1]}</span>}
                  </td>
                  <td className="small">{r.reason}{r.warnings.length > 0 && <div style={{ color: 'var(--warn)' }}>⚠ {r.warnings.join('; ')}</div>}</td>
                </tr>
              ))}
            </tbody></table></div>
            <div className="row-flex" style={{ marginTop: 12 }}>
              <button className="btn" disabled={rows.some((r) => r.action === 'conflict')} onClick={apply}>Подтвердить и применить</button>
              {rows.some((r) => r.action === 'conflict') && <span className="err">Сначала разрешите конфликты</span>}
              <span className="hint">Применение транзакционное: всё или ничего. Новые SKU создаются скрытыми — публикация после проверки в каталоге.</span>
            </div>
            {result && <div className={`notice ${result.duplicate ? 'info' : 'ok'}`} style={{ marginTop: 12 }}>{result.duplicate ? 'Файл с такой контрольной суммой уже был применён — изменений нет.' : `Готово: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}. Версия прайса ${result.priceList.version}.`}</div>}
          </div>
        </>
      )}
      <div className="panel">
        <h3>История загрузок</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Файл</th><th>Лаборатория</th><th>Версия</th><th>Автор / время</th><th className="num">Новых</th><th className="num">Обновлено</th><th>Контрольная сумма</th></tr></thead><tbody>
          {[...S.priceLists].reverse().map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{p.fileName}</td><td>{S.suppliers.find((s) => s.id === p.supplierId)?.name}</td><td>v{p.version}</td><td className="small">{S.users.find((u) => u.id === p.authorId)?.name}<br />{dt(p.at)}</td><td className="num">{p.created}</td><td className="num">{p.updated}</td><td className="mono small">{p.checksum.slice(0, 12)}…</td></tr>)}
          {!S.priceLists.length && <tr><td colSpan={8} className="muted">Загрузок ещё не было</td></tr>}
        </tbody></table></div>
      </div>
    </>
  );
}

// ───────── Поставки ─────────
const BSTATUS = { ordered: 'Заказана, ждём ответ', partially_confirmed: 'Частично отвечено', confirmed: 'Подтверждена', received: 'Принята на склад', cancelled: 'Отменена' };
const CSTATE = { waiting: ['', 'Ожидание'], full: ['ok', 'Полностью'], partial: ['warn', 'Частично'], refused: ['bad', 'Отказ'] };

export function SuppliesAdmin() {
  const { S, can } = useStore();
  const [sel, setSel] = useState(() => S.batches.find((b) => b.status !== 'received')?.id || S.batches[0]?.id);
  const [creating, setCreating] = useState(false);
  if (!can('supply.view')) return <Denied perm="supply.view" />;
  const b = S.batches.find((x) => x.id === sel);
  return (
    <>
      <Head title="Поставки и предзаказы" sub="Подтверждение лаборатории и физическая приёмка — разные шаги">{can('supply.edit') && <button className="btn" onClick={() => setCreating(true)}>+ Новая поставка</button>}</Head>
      <div className="table-wrap" style={{ marginBottom: 18 }}><table className="t"><thead><tr><th>ID</th><th>Лаборатория</th><th>Заказана</th><th>Ожидается</th><th>Получена</th><th className="num">Позиций</th><th className="num">Заказано / подтв. / получено</th><th>Статус</th></tr></thead><tbody>
        {[...S.batches].reverse().map((x) => (
          <tr key={x.id} className="click" onClick={() => setSel(x.id)} style={x.id === sel ? { background: 'var(--emerald-soft)' } : undefined}>
            <td className="mono">{x.id}</td><td>{S.suppliers.find((s) => s.id === x.supplierId)?.name}</td><td className="small">{d(x.orderedAt)}</td><td className="small">{d(x.plannedAt)}</td><td className="small">{d(x.receivedAt)}</td><td className="num">{x.lines.length}</td>
            <td className="num">{x.lines.reduce((s, l) => s + l.orderedQty, 0)} / {x.lines.reduce((s, l) => s + l.confirmedQty, 0)} / {x.lines.reduce((s, l) => s + l.receivedQty, 0)}</td>
            <td><span className={`pill ${x.status === 'received' ? 'ok' : x.status === 'ordered' ? 'info' : 'warn'}`}>{BSTATUS[x.status]}</span></td>
          </tr>
        ))}
      </tbody></table></div>
      {b && <BatchDetail b={b} key={b.id} />}
      {creating && <CreateBatch onClose={() => setCreating(false)} onDone={(id) => { setSel(id); setCreating(false); }} />}
    </>
  );
}

function BatchDetail({ b }) {
  const { S, op, can } = useStore();
  const [act, modal] = useAction();
  const [recv, setRecv] = useState(false);
  const costs = batchUnitCosts(S, b);
  const preorders = (sku) => S.orders.filter((o) => !o.cancelled).flatMap((o) => o.lines.filter((l) => l.sku === sku && l.mode === 'preorder' && !['cancelled', 'replaced'].includes(l.status)).map((l) => ({ o, l }))).sort((x, y) => x.o.createdAt - y.o.createdAt);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Поставка {b.id} · {S.suppliers.find((s) => s.id === b.supplierId)?.name}</h3>
        <div className="row-flex">
          {b.status !== 'received' && can('supply.receive') && <button className="btn" onClick={() => setRecv(true)}>Принять на склад</button>}
          {b.status === 'received' && !b.costClosed && can('finance.edit') && <button className="btn light sm" onClick={() => op('supply.closeCost', { batchId: b.id }, { success: 'Себестоимость зафиксирована' })}>Закрыть себестоимость</button>}
        </div>
      </div>
      <div className="small muted" style={{ marginBottom: 10 }}>Входящая логистика: {can('finance.view') ? rub(b.logisticsCost) : '•••'} · распределение: {S.settings.logisticsMethod === 'cost' ? 'пропорционально стоимости' : 'пропорционально количеству'} · себестоимость: <b>{b.costClosed ? 'фактическая' : 'расчётная'}</b></div>
      <div className="table-wrap"><table className="t"><thead><tr><th>SKU</th><th>Товар</th><th className="num">Заказано</th><th>Ответ лаборатории</th><th className="num">Подтв.</th><th className="num">Получено</th><th className="num">Брак</th>{can('finance.view') && <th className="num">Закупка → себест.</th>}<th></th></tr></thead><tbody>
        {b.lines.map((l) => { const v = variantBySku(S, l.sku); return (
          <tr key={l.id}>
            <td className="mono">{l.sku}</td><td>{v?.title}{l.history.length > 0 && <div className="muted small">{l.history.map((h) => `${dt(h.at)}: ${CSTATE[h.state][1]}${h.note ? ` — ${h.note}` : ''}`).join(' · ')}</div>}</td>
            <td className="num">{l.orderedQty}</td><td><span className={`pill ${CSTATE[l.confirmState][0]}`}>{CSTATE[l.confirmState][1]}</span></td>
            <td className="num">{l.confirmedQty}</td><td className="num">{l.receivedQty}</td><td className="num">{l.rejectedQty}</td>
            {can('finance.view') && <td className="num">{rub(l.unitCost)} → {rub(costs[l.id])}</td>}
            <td>{b.status !== 'received' && can('supply.confirm') && <button className="btn light sm" onClick={() => act({ title: `Ответ лаборатории: ${v?.title}`, op: 'supply.confirmLine', args: { batchId: b.id, lineId: l.id }, success: 'Ответ сохранён, очередь пересчитана', text: 'Подтверждённое количество распределяется по очереди предзаказов. Физический остаток не меняется до приёмки.', fields: [{ k: 'state', label: 'Ответ', type: 'select', default: 'full', options: [['full', `Полностью (${l.orderedQty})`], ['partial', 'Частично'], ['refused', 'Отказ'], ['waiting', 'Ожидание']] }, { k: 'confirmedQty', label: 'Подтверждено (для «частично»)', type: 'number', default: l.confirmedQty || '' }, { k: 'note', label: 'Комментарий / письмо лаборатории' }] })}>Ответ</button>}</td>
          </tr>); })}
      </tbody></table></div>
      <h3 style={{ marginTop: 18 }}>Очередь предзаказов</h3>
      {b.lines.map((l) => { const q = preorders(l.sku); if (!q.length) return null; return (
        <div key={l.id} style={{ marginBottom: 12 }}>
          <div className="small"><b>{variantBySku(S, l.sku)?.title}</b> — в очереди {q.reduce((s, x) => s + x.l.qty, 0)}, распределено {q.reduce((s, x) => s + allocatedQty(x.l), 0)} из подтверждённых {l.confirmedQty}</div>
          <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Заказ</th><th>Время</th><th>Клиент</th><th className="num">Нужно</th><th className="num">Распределено</th><th>Статус</th><th></th></tr></thead><tbody>
            {q.map(({ o, l: ol }, i) => (
              <tr key={ol.id} style={ol.excluded ? { opacity: 0.55 } : undefined}>
                <td>{i + 1}</td><td><Link className="mono" to={`/admin/orders/${o.id}`}>{o.id}</Link></td><td className="small">{dt(o.createdAt)}</td><td>{o.customerSnapshot.name}</td>
                <td className="num">{ol.qty}</td><td className="num">{allocatedQty(ol)}</td><td><span className={`pill ${ol.status === 'shortage' ? 'bad' : ol.status === 'partial' ? 'warn' : ol.status === 'confirmed' || ol.status === 'reserved' ? 'ok' : ''}`}>{{ queued: 'в очереди', confirmed: 'обеспечено', partial: 'частично', shortage: 'дефицит', reserved: 'в резерве', shipped: 'отправлено', expired: 'резерв истёк' }[ol.status] || ol.status}</span>{ol.excluded && <span className="pill">исключено</span>}</td>
                <td>{can('allocation.manual') && ['queued', 'partial', 'confirmed', 'shortage'].includes(ol.status) && <button className="linkbtn small" onClick={() => act({ title: ol.excluded ? 'Вернуть в очередь' : 'Исключить из очереди', op: 'allocation.exclude', args: { orderId: o.id, lineId: ol.id, excluded: !ol.excluded }, text: 'Ручное изменение распределения требует причины и попадёт в аудит.', fields: [{ k: 'reason', label: 'Причина', autoFocus: true }] })}>{ol.excluded ? 'вернуть' : 'исключить'}</button>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>); })}
      {S.settings.partialFifo && <p className="hint">Правило очереди: FIFO по времени оформления, частичная выдача одному клиенту разрешена (меняется в разделе «Финансы → Методика»).</p>}
      {recv && <ReceiveModal b={b} onClose={() => setRecv(false)} />}
      {modal}
    </div>
  );
}

function ReceiveModal({ b, onClose }) {
  const { S, op } = useStore();
  const [wh, setWh] = useState(S.warehouses.find((w) => w.type === 'main')?.id);
  const [lines, setLines] = useState(b.lines.map((l) => ({ lineId: l.id, receivedQty: l.confirmState === 'refused' ? 0 : l.confirmedQty || l.orderedQty, defectQty: 0 })));
  const submit = () => { if (op('supply.receive', { batchId: b.id, warehouseId: wh, lines }, { success: 'Приёмка проведена: остатки и резервы обновлены' })) onClose(); };
  return (
    <Modal title={`Физическая приёмка ${b.id}`} onClose={onClose} actions={<><button className="btn light" onClick={onClose}>Отмена</button><button className="btn" onClick={submit}>Провести приёмку</button></>}>
      <p className="small muted">Только после приёмки увеличивается физический остаток. Брак уходит в карантин. Подтверждённые предзаказы автоматически резервируются по очереди.</p>
      <Field label="Склад"><select value={wh} onChange={(e) => setWh(e.target.value)}>{S.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      <table className="t"><thead><tr><th>Товар</th><th>Получено</th><th>Брак</th></tr></thead><tbody>
        {b.lines.map((l, i) => <tr key={l.id}><td className="small">{variantBySku(S, l.sku)?.title}<div className="muted">подтв. {l.confirmedQty} из {l.orderedQty}</div></td>
          <td><input className="input" style={{ width: 80 }} type="number" min="0" value={lines[i].receivedQty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, receivedQty: e.target.value } : x)))} /></td>
          <td><input className="input" style={{ width: 70 }} type="number" min="0" value={lines[i].defectQty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, defectQty: e.target.value } : x)))} /></td></tr>)}
      </tbody></table>
    </Modal>
  );
}

function CreateBatch({ onClose, onDone }) {
  const { S, op } = useStore();
  const [f, setF] = useState({ supplierId: S.suppliers[0].id, plannedAt: '', logisticsCost: 0 });
  const [lines, setLines] = useState([{ sku: '', orderedQty: 5, unitCost: '' }]);
  const opts = S.variants;
  const submit = () => {
    const r = op('supply.create', { ...f, plannedAt: f.plannedAt ? Date.parse(f.plannedAt) : null, lines: lines.filter((l) => l.sku).map((l) => ({ ...l, unitCost: l.unitCost === '' ? variantBySku(S, l.sku)?.purchasePrice || 0 : +l.unitCost })) }, { success: 'Поставка создана' });
    if (r) onDone(r.id);
  };
  return (
    <Modal title="Новая поставка" onClose={onClose} actions={<><button className="btn light" onClick={onClose}>Отмена</button><button className="btn" onClick={submit}>Создать</button></>}>
      <div className="form-grid">
        <Field label="Лаборатория"><select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>{S.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Ожидаемая дата"><input type="date" value={f.plannedAt} onChange={(e) => setF({ ...f, plannedAt: e.target.value })} /></Field>
        <Field label="Входящая логистика, ₽"><input type="number" value={f.logisticsCost} onChange={(e) => setF({ ...f, logisticsCost: e.target.value })} /></Field>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="inline-form" style={{ marginBottom: 8 }}>
          <Field label={i ? '' : 'SKU'}><select value={l.sku} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))}><option value="">— выберите —</option>{opts.map((v) => <option key={v.sku} value={v.sku}>{v.sku} · {v.title}</option>)}</select></Field>
          <Field label={i ? '' : 'Кол-во'}><input type="number" style={{ width: 80 }} value={l.orderedQty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, orderedQty: e.target.value } : x)))} /></Field>
          <Field label={i ? '' : 'Закупка/ед.'}><input type="number" style={{ width: 100 }} placeholder="из прайса" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /></Field>
        </div>
      ))}
      <button className="linkbtn" onClick={() => setLines([...lines, { sku: '', orderedQty: 5, unitCost: '' }])}>+ позиция</button>
      <p className="hint">Новые SKU из прайса публикуются на витрине со статусом «Предзаказ» после создания поставки.</p>
    </Modal>
  );
}

// ───────── Склад ─────────
export function StockAdmin() {
  const { S, op, can } = useStore();
  const [tab, setTab] = useState('lots');
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const [act, modal] = useAction();
  if (!can('stock.view')) return <Denied perm="stock.view" />;
  const lots = S.lots.filter((l) => (l.qty > 0 || l.quarantineQty > 0) && (!wh || l.warehouseId === wh) && (!q || (l.sku + variantBySku(S, l.sku)?.title + l.batchId).toLowerCase().includes(q.toLowerCase())));
  const whOpts = S.warehouses.map((w) => [w.id, w.name]);
  return (
    <>
      <Head title="Склад" sub="Доступно = физически − карантин/брак − действующие резервы. Ожидаемое от лабораторий сюда не входит.">
        <select className="input" style={{ width: 'auto' }} value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Все склады</option>{whOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <input className="input" placeholder="SKU, товар, партия" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
      </Head>
      <Tabs value={tab} onChange={setTab} tabs={[['lots', 'Остатки по партиям'], ['moves', 'Движения'], ['res', 'Резервы'], ['inv', 'Инвентаризация'], ['wh', 'Склады']]} />
      {tab === 'lots' && <div className="table-wrap"><table className="t"><thead><tr><th>Партия</th><th>Склад</th><th>Товар</th><th>Поставка</th><th className="num">Физически</th><th className="num">Карантин</th><th className="num">Резерв</th><th className="num">Доступно</th>{can('finance.view') && <th className="num">Себест./ед.</th>}<th>Операции</th></tr></thead><tbody>
        {lots.map((l) => { const v = variantBySku(S, l.sku); const av = lotAvailable(S, l); return (
          <tr key={l.id}>
            <td className="mono">{l.id}<div className="muted small">{l.origin === 'adaptation' ? 'из адаптации' : l.origin === 'individual' ? 'экземпляр' : 'поставка'}</div></td>
            <td className="small">{whById(S, l.warehouseId)?.name}</td><td>{v?.title}<div className="mono muted small">{l.sku}</div></td><td className="mono small">{l.batchId}</td>
            <td className="num">{l.qty}</td><td className="num">{l.quarantineQty || ''}</td><td className="num">{reservedOnLot(S, l.id) || ''}</td><td className="num"><b>{av}</b></td>
            {can('finance.view') && <td className="num small">{rub(l.unitCost)}{l.costVersion > 1 && <div className="muted">v{l.costVersion}</div>}</td>}
            <td><div className="row-flex">
              {can('stock.move') && av > 0 && <button className="linkbtn small" onClick={() => act({ title: `Перемещение ${l.id}`, op: 'stock.transfer', args: { lotId: l.id }, fields: [{ k: 'qty', label: `Количество (доступно ${av})`, type: 'number', default: 1 }, { k: 'toWarehouseId', label: 'Куда', type: 'select', default: whOpts.find(([id]) => id !== l.warehouseId)?.[0], options: whOpts.filter(([id]) => id !== l.warehouseId) }, { k: 'reason', label: 'Основание' }] })}>переместить</button>}
              {can('stock.quarantine') && av > 0 && <button className="linkbtn small" onClick={() => act({ title: `Карантин ${l.id}`, op: 'stock.quarantine', args: { lotId: l.id }, fields: [{ k: 'qty', label: 'Количество', type: 'number', default: 1 }, { k: 'reason', label: 'Причина' }] })}>карантин</button>}
              {can('stock.quarantine') && l.quarantineQty > 0 && <button className="linkbtn small" onClick={() => act({ title: 'Снять карантин', op: 'stock.quarantine', args: { lotId: l.id, release: true }, fields: [{ k: 'qty', label: 'Количество', type: 'number', default: l.quarantineQty }, { k: 'reason', label: 'Основание' }] })}>из карантина</button>}
              {(av > 0 || l.quarantineQty > 0) && <button className="linkbtn small" style={{ color: 'var(--danger)' }} title={can('stock.writeoff') ? '' : 'Нет права — попытка будет отклонена и записана в аудит'} onClick={() => act({ title: `Списание ${l.id}`, op: 'stock.writeoff', danger: true, args: { lotId: l.id }, text: 'Критическая операция: фиксируются автор, причина, до/после. Подтверждённое движение не удаляется — только корректируется обратной операцией.', fields: [{ k: 'qty', label: 'Количество', type: 'number', default: 1 }, { k: 'fromQuarantine', label: 'Источник', type: 'checkbox', checkLabel: 'списать из карантина' }, { k: 'reason', label: 'Причина (обязательно)' }] })}>списать{can('stock.writeoff') ? '' : ' 🔒'}</button>}
              {can('stock.inventory') && <button className="linkbtn small" onClick={() => act({ title: `Пересчёт ${l.id}`, op: 'inventory.count', args: { lotId: l.id }, text: `Расчётное количество: ${l.qty}. Расхождение потребует утверждения руководителя.`, fields: [{ k: 'actualQty', label: 'Фактически', type: 'number', default: l.qty }, { k: 'comment', label: 'Комментарий' }] })}>пересчёт</button>}
            </div></td>
          </tr>); })}
      </tbody></table></div>}
      {tab === 'moves' && <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Время</th><th>Тип</th><th>Товар</th><th>Партия</th><th className="num">Кол-во</th><th>Откуда → куда</th><th>Основание</th><th>Автор</th></tr></thead><tbody>
        {[...S.movements].reverse().filter((m) => (!wh || m.fromWh === wh || m.toWh === wh) && (!q || (m.sku + m.reason + m.lotId).toLowerCase().includes(q.toLowerCase()))).slice(0, 300).map((m) => (
          <tr key={m.id}><td className="mono">{m.id}</td><td className="small">{dt(m.at)}</td><td><span className="pill">{MOVEMENT_TYPES[m.type]}</span></td><td className="mono small">{m.sku}</td><td className="mono small">{m.lotId}</td><td className="num">{num(m.qty)}</td><td className="small">{m.fromWh || '—'} → {m.toWh || '—'}</td><td className="small">{m.reason}</td><td className="small">{m.actorName}</td></tr>
        ))}
      </tbody></table></div>}
      {tab === 'res' && <div className="table-wrap"><table className="t"><thead><tr><th>Резерв</th><th>Заказ / позиция</th><th>Товар</th><th>Партия</th><th className="num">Кол-во</th><th>Истекает</th><th>Состояние</th><th></th></tr></thead><tbody>
        {[...S.reservations].reverse().slice(0, 200).map((r) => (
          <tr key={r.id}><td className="mono">{r.id}</td><td><Link className="mono" to={`/admin/orders/${r.orderId}`}>{r.orderId}</Link><div className="mono muted small">{r.lineId}</div></td><td className="mono small">{r.sku}</td><td className="mono small">{r.lotId}</td><td className="num">{r.qty}</td><td className="small">{dt(r.expiresAt)}{r.extended && <div className="muted">продлён</div>}</td>
            <td><span className={`pill ${r.state === 'active' ? 'ok' : r.state === 'expired' ? 'bad' : ''}`}>{{ active: 'действует', released: 'снят', expired: 'истёк', consumed: 'отгружен' }[r.state]}</span></td>
            <td>{r.state === 'active' && !r.extended && can('reservation.extend') && <button className="linkbtn small" onClick={() => op('reservation.extend', { reservationId: r.id }, { success: 'Резерв продлён на 48 ч' })}>+48 ч</button>}</td></tr>
        ))}
      </tbody></table></div>}
      {tab === 'inv' && <div className="table-wrap"><table className="t"><thead><tr><th>Акт</th><th>Время</th><th>Партия</th><th className="num">Расчёт</th><th className="num">Факт</th><th className="num">Расхождение</th><th>Состояние</th><th></th></tr></thead><tbody>
        {[...S.inventories].reverse().map((i) => (
          <tr key={i.id}><td className="mono">{i.id}</td><td className="small">{dt(i.at)}</td><td className="mono small">{i.lotId}</td><td className="num">{i.expectedQty}</td><td className="num">{i.actualQty}</td><td className="num" style={{ color: i.diff ? 'var(--danger)' : undefined }}>{i.diff > 0 ? '+' : ''}{i.diff}</td>
            <td><span className={`pill ${i.state === 'pending' ? 'warn' : 'ok'}`}>{{ pending: 'ждёт утверждения', approved: 'утверждён', matched: 'совпало' }[i.state]}</span></td>
            <td>{i.state === 'pending' && can('stock.inventory.approve') && <button className="btn sm" onClick={() => act({ title: 'Утвердить корректировку', op: 'inventory.approve', args: { inventoryId: i.id }, fields: [{ k: 'reason', label: 'Причина корректировки' }] })}>Утвердить</button>}</td></tr>
        ))}
        {!S.inventories.length && <tr><td colSpan={8} className="muted">Пересчётов ещё не было. Начните с кнопки «пересчёт» в остатках.</td></tr>}
      </tbody></table></div>}
      {tab === 'wh' && <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Склад</th><th>Тип</th><th>Ответственный</th><th>Продажа</th><th className="num">Физически</th><th className="num">Доступно</th></tr></thead><tbody>
        {S.warehouses.map((w) => { const ls = S.lots.filter((l) => l.warehouseId === w.id); return <tr key={w.id}><td className="mono">{w.id}</td><td>{w.name}</td><td>{w.type}</td><td>{w.manager}</td><td>{w.sellable ? 'да' : 'нет'}</td><td className="num">{ls.reduce((s, l) => s + l.qty, 0)}</td><td className="num">{ls.reduce((s, l) => s + Math.max(0, lotAvailable(S, l)), 0)}</td></tr>; })}
      </tbody></table></div>}
      {modal}
    </>
  );
}

// ───────── Адаптация ─────────
export function AdaptationAdmin() {
  const { S, can } = useStore();
  const [act, modal] = useAction();
  if (!can('adaptation.manage')) return <Denied perm="adaptation.manage" />;
  const fin = can('finance.view');
  const srcLots = S.lots.filter((l) => variantBySku(S, l.sku)?.category === 'microclone' && lotAvailable(S, l) > 0);
  const outLots = S.lots.filter((l) => l.origin === 'adaptation' && lotAvailable(S, l) > 0);
  return (
    <>
      <Head title="Адаптация микроклонов" sub="Стоимость клона переносится в себестоимость растения, а не признаётся повторно">
        <button className="btn" disabled={!srcLots.length} onClick={() => act({ title: 'Передать в адаптацию', op: 'adaptation.start', success: 'Документ передачи создан', text: 'Исходные упаковки списываются со склада продаж — продать исходный и полученный товар одновременно нельзя.', fields: [{ k: 'lotId', label: 'Партия микроклонов', type: 'select', default: srcLots[0]?.id, options: srcLots.map((l) => [l.id, `${l.id} · ${variantBySku(S, l.sku).title} · доступно ${lotAvailable(S, l)}`]) }, { k: 'packs', label: 'Упаковок', type: 'number', default: 1 }, { k: 'location', label: 'Место', default: 'Стеллаж А' }, { k: 'substrate', label: 'Субстрат', default: 'сфагнум + перлит' }] })}>+ Передать в адаптацию</button>
      </Head>
      <div className="cols2">
        {S.adaptations.slice().reverse().map((a) => { const c = adaptationCost(S, a); const v = variantBySku(S, a.sku); return (
          <div className="panel" key={a.id}>
            <div className="panel-head"><h3>{a.id} · {v?.title.replace(/ — .*/, '')}</h3><span className={`pill ${a.status === 'completed' ? 'ok' : 'warn'}`}>{a.status === 'completed' ? 'завершена' : 'в работе'}</span></div>
            <dl className="kv small">
              <dt>Источник</dt><dd className="mono">{a.sourceLotId} ({a.inputPacks} упак. × {a.packSize} = {a.inputPlants} раст.)</dd>
              <dt>Место / субстрат</dt><dd>{a.location} · {a.substrate || '—'} · {a.responsible}</dd>
              <dt>Начата</dt><dd>{dt(a.startedAt)}</dd>
              <dt>Потери</dt><dd>{c.lost} {a.losses.map((l) => `(${l.qty}: ${l.reason})`).join(' ')}</dd>
              <dt>Живых</dt><dd><b>{c.alive}</b></dd>
              {fin && <><dt>Стоимость клонов</dt><dd>{rub(a.inputCost)}</dd><dt>Материалы</dt><dd>{rub(c.materials)}</dd><dt>Итого</dt><dd><b>{rub(c.total)}</b> → {c.perPlant ? rub(c.perPlant) : '—'} за живое растение</dd></>}
              {a.status === 'completed' && <><dt>Результат</dt><dd className="mono">{a.outputSku} · {a.outputQty} шт. · партия {a.outputLotId}</dd></>}
            </dl>
            {fin && <div className="formula">({rub(a.inputCost)} + {rub(c.materials)}) / {c.alive} живых = {c.perPlant ? rub(c.perPlant) : '—'}{'\n'}Потери не создают новую закупку — они перераспределяют понесённые затраты.</div>}
            {a.status === 'in_progress' && <div className="row-flex" style={{ marginTop: 10 }}>
              <button className="btn light sm" onClick={() => act({ title: 'Материалы и расходы', op: 'adaptation.material', args: { adaptationId: a.id }, fields: [{ k: 'name', label: 'Что', default: 'Субстрат, горшки' }, { k: 'amount', label: 'Сумма, ₽', type: 'number' }] })}>+ материалы</button>
              <button className="btn light sm" onClick={() => act({ title: 'Потери / выбраковка', op: 'adaptation.loss', args: { adaptationId: a.id }, fields: [{ k: 'qty', label: `Растений (живых ${c.alive})`, type: 'number', default: 1 }, { k: 'reason', label: 'Причина' }] })}>− потери</button>
              <button className="btn sm" onClick={() => act({ title: 'Завершить адаптацию', op: 'adaptation.complete', args: { adaptationId: a.id }, success: 'Готовые растения поступили на склад', text: `Будет сформирована партия из ${c.alive} адаптированных растений с себестоимостью ${c.perPlant} ₽/шт.`, fields: [{ k: 'price', label: 'Розничная цена, ₽', type: 'number', default: S.variants.find((x) => x.cultivarId === a.cultivarId && x.category === 'adapted' && !x.isIndividual)?.price || '' }, { k: 'warehouseId', label: 'Склад', type: 'select', default: 'WH-MSK', options: S.warehouses.filter((w) => w.sellable).map((w) => [w.id, w.name]) }] })}>Завершить</button>
            </div>}
          </div>); })}
      </div>
      {outLots.length > 0 && <div className="panel">
        <h3>Выделить редкие экземпляры в индивидуальные карточки</h3>
        <div className="table-wrap"><table className="t"><tbody>
          {outLots.map((l) => <tr key={l.id}><td className="mono">{l.id}</td><td>{variantBySku(S, l.sku)?.title}</td><td className="num">доступно {lotAvailable(S, l)}</td><td><button className="btn light sm" onClick={() => act({ title: 'Индивидуальная карточка', op: 'individual.split', args: { lotId: l.id }, success: 'Карточка создана (в каталоге)', text: 'Экземпляр получит уникальный SKU и собственное фото; групповой остаток уменьшится на 1, себестоимость переносится.', fields: [{ k: 'title', label: 'Название', default: `${variantBySku(S, l.sku)?.title.replace(/ — .*/, '')} — экземпляр с выраженной вариегатностью` }, { k: 'price', label: 'Цена, ₽', type: 'number', default: Math.round(variantBySku(S, l.sku).price * 2.5) }] })}>Выделить экземпляр</button></td></tr>)}
        </tbody></table></div>
      </div>}
      {modal}
    </>
  );
}
