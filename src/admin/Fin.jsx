import { useState } from 'react';
import { useStore } from '../store.jsx';
import { pnl, unitEconomics, byDimension, stockValue, wipValue } from '../engine/finance.js';
import { DATASETS, datasetRows, downloadSnapshot } from '../engine/exportx.js';
import { apiRequest, signWebhook, API_SCOPES } from '../engine/api.js';
import { EXPENSE_CATEGORIES, expCat } from '../engine/model.js';
import { rub, dt, pct, DAY } from '../engine/util.js';
import { variantBySku, can as canFor } from '../engine/engine.js';
import { Tabs, Denied, Field } from '../ui/kit.jsx';
import { Head } from './Admin.jsx';
import { useAction } from './ActionModal.jsx';

const BASE = import.meta.env.BASE_URL;

export function FinanceAdmin() {
  const { S, can } = useStore();
  const [tab, setTab] = useState('pnl');
  const [period, setPeriod] = useState('all');
  const [act, modal] = useAction();
  if (!can('finance.view')) return <Denied perm="finance.view" />;
  const now = Date.now();
  const per = period === '30' ? { from: now - 30 * DAY } : period === '7' ? { from: now - 7 * DAY } : null;
  const p = pnl(S, per);
  const addExpense = () => act({
    title: 'Финансы → Добавить расход', op: 'expense.add', success: 'Расход внесён',
    text: 'Прямые расходы привязываются к поставке/адаптации и попадают в себестоимость один раз. Переменные — к заказу. Общие — в операционную прибыль. Изъятия — отдельно.',
    fields: [
      { k: 'amount', label: 'Сумма, ₽', type: 'number', autoFocus: true },
      { k: 'category', label: 'Статья', type: 'select', default: 'packaging', options: EXPENSE_CATEGORIES.map((c) => [c.id, `${c.name} (${{ direct: 'прямой', variable: 'переменный', overhead: 'общий', withdrawal: 'изъятие' }[c.type]})`]) },
      { k: 'allocType', label: 'Объект распределения', type: 'select', default: 'none', options: [['none', 'Без привязки'], ['order', 'Заказ'], ['batch', 'Поставка'], ['adaptation', 'Адаптация']] },
      { k: 'allocId', label: 'ID объекта', hint: 'например ORD-00001 или SUP-0001' },
      { k: 'comment', label: 'Комментарий' },
      { k: 'documentRef', label: 'Чек / документ', hint: 'Номер чека или ссылка на документ' },
    ],
    map: ({ allocType, allocId, ...r }) => ({ ...r, allocation: { type: allocType, id: String(allocId || '').trim() } }),
  });
  return (
    <>
      <Head title="Финансы" sub="Выручка признаётся по отгрузке. Предоплата — обязательство, а не выручка.">
        <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">Весь период</option><option value="30">30 дней</option><option value="7">7 дней</option></select>
        {can('finance.edit') && <button className="btn" onClick={addExpense}>+ Добавить расход</button>}
      </Head>
      <Tabs value={tab} onChange={setTab} tabs={[['pnl', 'Прибыль и деньги'], ['ue', 'Юнит-экономика'], ['cut', 'Категории и каналы'], ['exp', 'Расходы'], ['method', 'Методика и формулы']]} />
      {tab === 'pnl' && <>
        <div className="kpis">
          <div className="kpi"><div className="l">Выручка (отгружено)</div><div className="v">{rub(p.revenue)}</div></div>
          <div className="kpi"><div className="l">Себестоимость продаж</div><div className="v">{rub(p.cogs)}</div></div>
          <div className="kpi"><div className="l">Переменные расходы</div><div className="v">{rub(p.variable)}</div></div>
          <div className="kpi"><div className="l">Маржинальный доход</div><div className="v">{rub(p.contribution)}</div><div className="s">маржинальность {pct(p.marginPct)} · наценка {pct(p.markupPct)}</div></div>
          <div className="kpi"><div className="l">Общие расходы</div><div className="v">{rub(p.overhead)}</div></div>
          <div className={`kpi ${p.operatingProfit < 0 ? 'bad' : ''}`}><div className="l">Операционная прибыль</div><div className="v">{rub(p.operatingProfit)}</div><div className="s">личные изъятия её не уменьшают</div></div>
        </div>
        <div className="cols2">
          <div className="panel"><h3>Денежный поток</h3><table className="t"><tbody>
            <tr><td>Поступления от покупателей</td><td className="num">{rub(p.cashIn)}</td></tr>
            <tr><td>Возвраты покупателям</td><td className="num">−{rub(p.refunds)}</td></tr>
            <tr><td>Закупка у лабораторий + входящая логистика</td><td className="num">−{rub(p.purchases)}</td></tr>
            <tr><td>Расходы (кроме изъятий)</td><td className="num">−{rub(p.expensesCash)}</td></tr>
            <tr><td>Личные изъятия владельца</td><td className="num">−{rub(p.withdrawals)}</td></tr>
            <tr><td><b>Чистый денежный поток</b></td><td className="num"><b>{rub(p.netCash)}</b></td></tr>
          </tbody></table></div>
          <div className="panel"><h3>Баланс и обязательства</h3><table className="t"><tbody>
            <tr><td>Предоплаты по неотгруженным заказам (обязательство)</td><td className="num">{rub(p.prepaymentLiability)}</td></tr>
            <tr><td>Товар на складах по себестоимости</td><td className="num">{rub(stockValue(S))}</td></tr>
            <tr><td>Незавершённая адаптация</td><td className="num">{rub(wipValue(S))}</td></tr>
          </tbody></table><p className="hint" style={{ marginTop: 10 }}>Банковская интеграция (Точка) не входит в объём; архитектура позволяет подключить выписку позже.</p></div>
        </div>
      </>}
      {tab === 'ue' && <UE S={S} per={per} />}
      {tab === 'cut' && <div className="cols2">{[['category', 'По товарным категориям'], ['channel', 'По каналам продаж']].map(([dim, title]) => (
        <div className="panel" key={dim}><h3>{title}</h3><div className="table-wrap"><table className="t"><thead><tr><th>{dim === 'category' ? 'Категория' : 'Канал'}</th><th className="num">Выручка</th><th className="num">Себест.</th><th className="num">Перем.</th><th className="num">Маржин. доход</th><th className="num">%</th></tr></thead><tbody>
          {byDimension(S, per, dim).map((r) => <tr key={r.key}><td>{r.name}</td><td className="num">{rub(r.revenue)}</td><td className="num">{rub(r.cogs)}</td><td className="num">{rub(r.variable)}</td><td className="num">{rub(r.contribution)}</td><td className="num">{r.marginPct == null ? '—' : r.marginPct + '%'}</td></tr>)}
        </tbody></table></div><p className="hint" style={{ marginTop: 8 }}>{dim === 'category' ? 'Магазин не добавляется отдельной категорией поверх товарных.' : 'Категории и каналы — два разреза одних операций; их нельзя складывать.'}</p></div>
      ))}</div>}
      {tab === 'exp' && <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Дата</th><th>Статья</th><th>Тип</th><th>Привязка</th><th>Комментарий</th><th className="num">Сумма</th><th>Автор</th></tr></thead><tbody>
        {[...S.expenses].reverse().map((e) => <tr key={e.id}><td className="mono">{e.id}</td><td className="small">{dt(e.occurredAt)}</td><td>{expCat(e.category).name}</td><td><span className="pill">{{ direct: 'прямой', variable: 'переменный', overhead: 'общий', withdrawal: 'изъятие' }[e.type]}</span></td><td className="mono small">{e.allocation?.type !== 'none' ? `${e.allocation.type}: ${e.allocation.id}` : '—'}</td><td className="small">{e.comment}</td><td className="num">{rub(e.amount)}</td><td className="small">{S.users.find((u) => u.id === e.authorId)?.name}</td></tr>)}
      </tbody></table></div>}
      {tab === 'method' && <Method />}
      {modal}
    </>
  );
}

function UE({ S, per }) {
  const [by, setBy] = useState('sku');
  const rows = unitEconomics(S, per, by);
  const name = (k) => (by === 'sku' ? variantBySku(S, k)?.title : k);
  return (
    <div className="panel">
      <div className="panel-head"><h3>Юнит-экономика</h3><select className="input" style={{ width: 'auto' }} value={by} onChange={(e) => setBy(e.target.value)}><option value="sku">по SKU</option><option value="batch">по партии</option><option value="order">по заказу</option></select></div>
      <div className="table-wrap"><table className="t"><thead><tr><th>{by === 'sku' ? 'SKU' : by === 'batch' ? 'Партия' : 'Заказ'}</th><th className="num">Кол-во</th><th className="num">Выручка</th><th className="num">Себестоимость</th><th className="num">Перем. расходы</th><th className="num">Маржин. доход</th><th className="num">Маржинальность</th><th className="num">Наценка</th><th>Версия расчёта</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.key}><td>{name(r.key)}<div className="mono muted small">{r.key}</div></td><td className="num">{r.qty}</td><td className="num">{rub(r.revenue)}</td><td className="num">{rub(r.cogs)}</td><td className="num">{rub(r.variable)}</td><td className="num">{rub(r.contribution)}</td><td className="num">{pct(r.marginPct)}</td><td className="num">{pct(r.markupPct)}</td><td className="mono small">{r.methodVersion}</td></tr>)}
        {!rows.length && <tr><td colSpan={9} className="muted">Отгрузок за период нет</td></tr>}
      </tbody></table></div>
    </div>
  );
}

function Method() {
  const { S, op, can } = useStore();
  return (
    <div className="cols2">
      <div className="panel">
        <h3>Формулы расчёта</h3>
        <div className="formula">{`Себестоимость = закупка + распределённая входящая логистика + упаковка + адаптация/потери
  пример: (60 000 + 6 000) / 30 = 2 200 ₽

Маржинальный доход = выручка − себестоимость реализации − переменные расходы
  пример: 3 000 − 1 800 − 120 − 30 − 100 = 950 ₽

Маржинальность = маржинальный доход / выручка × 100%   (при выручке 0 — не рассчитывается)
  пример: 950 / 3 000 = 31,67%

Наценка = (цена − себестоимость) / себестоимость × 100%   (при себестоимости 0 — не рассчитывается)

Операционная прибыль = маржинальный доход − общие операционные расходы
Личные изъятия — движение денег, не расход: прибыль 40 000, изъято 15 000 → прибыль 40 000, деньги −15 000

Адаптация: (5 000 + 1 000) / 8 выживших = 750 ₽ за растение`}</div>
      </div>
      <div className="panel">
        <h3>Методики учёта</h3>
        <Field label="Распределение входящей логистики" hint="Смена методики пересчитывает незакрытые поставки; версия расчёта видна в отчётах">
          <select disabled={!can('users.manage')} value={S.settings.logisticsMethod} onChange={(e) => op('settings.update', { key: 'logisticsMethod', value: e.target.value }, { success: 'Методика изменена, себестоимость пересчитана' })}><option value="cost">Пропорционально стоимости закупки</option><option value="qty">Пропорционально количеству</option></select>
        </Field>
        <Field label="Частичная выдача по FIFO" hint="Разрешать ли выдать клиенту часть упаковок, если подтверждено меньше">
          <select disabled={!can('users.manage')} value={S.settings.partialFifo ? '1' : '0'} onChange={(e) => op('settings.update', { key: 'partialFifo', value: e.target.value === '1' }, { success: 'Правило очереди изменено' })}><option value="1">Разрешать частичную выдачу</option><option value="0">Только целиком, по очереди</option></select>
        </Field>
        {!can('users.manage') && <p className="hint">Менять методики может владелец.</p>}
      </div>
    </div>
  );
}

// ───────── Google Диск, Excel, резервы ─────────
export function SyncAdmin() {
  const { S, op, can, actor } = useStore();
  if (!can('sync.view')) return <Denied perm="sync.view" />;
  const queue = S.exportJobs.filter((j) => j.state !== 'done');
  const lag = queue.length ? Math.round((Date.now() - Math.min(...queue.map((j) => j.queuedAt))) / 1000) : 0;
  const nightly = Array.from({ length: 7 }, (_, i) => { const t = new Date(); t.setHours(3, 0, 0, 0); t.setDate(t.getDate() - i - (new Date().getHours() < 3 ? 1 : 0)); return t.getTime(); });
  const fin = canFor(S, actor, 'finance.view');
  return (
    <>
      <Head title="Google Диск, Excel и резервные копии" sub="Источник истины — транзакционная база сайта. Google Таблицы и XLSX — копии для владельца.">
        <button className="btn light" onClick={() => downloadSnapshot(S, { includeFinance: fin })}>Скачать полный XLSX-снимок</button>
        <button className={`btn ${S.google.online ? 'danger' : ''}`} onClick={() => op('google.setOnline', { online: !S.google.online }, { success: S.google.online ? 'Выгрузка приостановлена — изменения копятся в очереди' : 'Выгрузка возобновлена' })}>{S.google.online ? 'Приостановить выгрузку' : 'Возобновить выгрузку'}</button>
      </Head>
      <div className="kpis">
        <div className={`kpi ${S.google.online ? '' : 'bad'}`}><div className="l">Состояние</div><div className="v" style={{ fontSize: 22 }}>{S.google.online ? 'Работает' : 'Google API недоступен'}</div><div className="s">сайт продолжает принимать заказы</div></div>
        <div className={`kpi ${queue.length ? 'warn' : ''}`}><div className="l">Очередь выгрузки</div><div className="v">{queue.length}</div><div className="s">{queue.length ? `задержка ${lag} с; цель — не более 5 мин` : 'всё выгружено'}</div></div>
        <div className="kpi"><div className="l">Последняя успешная</div><div className="v" style={{ fontSize: 20 }}>{dt(S.google.lastSuccessAt)}</div><div className="s">ревизия {S.google.revision}</div></div>
      </div>
      <div className="cols2">
        <div className="panel">
          <h3>Наборы данных (Приложение Г)</h3>
          <div className="table-wrap"><table className="t"><thead><tr><th>Файл</th><th className="num">Строк</th><th>Статус</th></tr></thead><tbody>
            {DATASETS.map((ds) => { const pend = queue.find((j) => j.dataset === ds.id); const hidden = ds.finance && !fin; return (
              <tr key={ds.id}><td className="mono small">{ds.file}<div className="muted" style={{ maxWidth: 380, whiteSpace: 'normal' }}>{ds.cols}</div></td><td className="num">{hidden ? '•••' : datasetRows(S, ds.id).length}</td>
                <td>{pend ? <span className={`pill ${pend.state === 'error' ? 'bad' : 'warn'}`}>{pend.state === 'error' ? `ошибка, попытка ${pend.retries}` : 'в очереди'}</span> : <span className="pill ok">синхронно</span>}</td></tr>); })}
          </tbody></table></div>
          <p className="hint" style={{ marginTop: 8 }}>В каждой выгрузке — системные ID, дата изменения, версия схемы, часовой пояс и валюта (лист _meta). Фото — ссылками, файлы резервируются отдельно. При превышении лимитов — разбиение по месяцам.</p>
        </div>
        <div>
          <div className="panel">
            <h3>Журнал выгрузок</h3>
            <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}><table className="t"><tbody>
              {[...S.exportLog].reverse().slice(0, 60).map((l, i) => <tr key={i}><td className="mono small">{l.id}</td><td className="small">{l.dataset}</td><td className="small">{dt(l.at)}</td><td>{l.ok ? <span className="pill ok">ok</span> : <span className="pill bad">{l.error}</span>}</td><td className="small muted">попытка {l.attempt}</td></tr>)}
              {!S.exportLog.length && <tr><td className="muted">Измените что-нибудь (заказ, резерв, расход) — изменения уйдут в очередь</td></tr>}
            </tbody></table></div>
          </div>
          <div className="panel">
            <h3>Ночные снимки и резервные копии</h3>
            <div className="table-wrap"><table className="t"><tbody>
              {nightly.map((t) => <tr key={t}><td className="mono small">viridea_snapshot_{new Date(t).toISOString().slice(0, 10)}.xlsx</td><td className="small">{dt(t)}</td><td><span className="pill ok">проверен</span></td></tr>)}
            </tbody></table></div>
            <p className="hint" style={{ marginTop: 8 }}>Датированные снимки не перезаписываются. Отдельно — шифрованный бэкап БД и файлов в независимое хранилище, тестовое восстановление по регламенту. Точка восстановления — не старше 1 часа, восстановление — до 4 часов, хранение — 90 дней.</p>
          </div>
        </div>
      </div>
    </>
  );
}

// ───────── API ─────────
const EXAMPLES = [
  ['GET', '/api/v1/health', null],
  ['GET', '/api/v1/products?limit=3', null],
  ['GET', '/api/v1/stock?limit=5', null],
  ['GET', '/api/v1/orders?limit=2', null],
  ['GET', '/api/v1/orders/ORD-00003', null],
  ['POST', '/api/v1/orders/ORD-00003/actions', { action: 'set_external_id', system: 'retailcrm', value: 'CRM-1001', expected_version: 2, actor: 'crm-sync' }],
  ['POST', '/api/v1/orders/ORD-00003/actions', { action: 'adjust_stock', expected_version: 2 }],
  ['POST', '/api/v1/customers/link', { site_id: 'CUS-00001', crm_id: '501' }],
  ['GET', '/api/v1/payments', null],
  ['GET', '/api/v1/shipments', null],
  ['GET', '/api/v1/events?limit=5', null],
  ['POST', '/api/v1/webhooks/subscriptions', { url: 'https://crm.example/webhooks/viridea', events: ['order.created', 'payment.confirmed'] }],
];

export function ApiAdmin() {
  const { S, replaceState, can } = useStore();
  const [key, setKey] = useState(S.apiKeys[0]?.token);
  const [req, setReq] = useState({ method: 'GET', path: '/api/v1/health', body: '', idem: 'idem-' + Math.random().toString(36).slice(2, 8) });
  const [res, setRes] = useState(null);
  const [sig, setSig] = useState(null);
  if (!can('api.manage')) return <Denied perm="api.manage" />;
  const send = () => {
    let body = null;
    if (req.method === 'POST') { try { body = req.body ? JSON.parse(req.body) : {}; } catch { setRes({ status: 0, body: { error: 'Невалидный JSON' } }); return; } }
    const [path, qs] = req.path.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const r = apiRequest(S, { method: req.method, path, query, body, headers: { authorization: key ? `Bearer ${key}` : '', ...(req.method === 'POST' ? { 'idempotency-key': req.idem } : {}) } });
    if (r.state !== S) replaceState(r.state);
    setRes(r);
  };
  const ev = [...S.events].reverse().slice(0, 12);
  return (
    <>
      <Head title="API для RetailCRM" sub="Сайт — самостоятельный продукт; команда RetailCRM подключается к этому API после приёмки">
        <a className="btn light" href={`${BASE}openapi.yaml`} target="_blank" rel="noreferrer">OpenAPI 3.1 (YAML)</a>
      </Head>
      <div className="cols2">
        <div className="panel">
          <h3>Ключи доступа</h3>
          <div className="table-wrap"><table className="t"><tbody>
            {S.apiKeys.map((k) => <tr key={k.id}><td>{k.name}<div className="mono muted small">{k.token.slice(0, 8)}••••••</div></td><td className="small">{k.scopes.join(', ')}</td></tr>)}
          </tbody></table></div>
          <p className="hint" style={{ marginTop: 8 }}>Права ключей: {API_SCOPES.join(', ')}. Ротация, лимит 120 запросов в минуту, только TLS, журнал запросов. Ключи передаются только по защищённому каналу.</p>
        </div>
        <div className="panel">
          <h3>Исходящие события (webhooks)</h3>
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t"><tbody>
            {ev.map((e) => <tr key={e.event_id}><td className="mono small">{e.event_id}</td><td className="small"><b>{e.type}</b><div className="muted">{e.object_id}</div></td><td>{e.delivered ? <span className="pill ok">доставлено</span> : <span className="pill warn">в очереди</span>}</td><td><button className="linkbtn small" onClick={async () => { const payload = JSON.stringify({ event_id: e.event_id, type: e.type, occurred_at: e.occurred_at, object_id: e.object_id, version: e.version, data: e.data }); setSig({ payload, signature: await signWebhook('whsec_7Kp2Lq9VxR', payload) }); }}>подпись</button></td></tr>)}
          </tbody></table></div>
          <p className="hint" style={{ marginTop: 8 }}>Доставка с повторами (экспоненциальная задержка) и dead-letter очередью; при недоступности CRM события копятся и уходят после восстановления. Получатель проверяет подпись и event_id.</p>
          {sig && <pre className="code" style={{ marginTop: 8 }}>{`POST https://crm.example/webhooks/viridea\nX-Viridea-Signature: ${sig.signature}\n\n${JSON.stringify(JSON.parse(sig.payload), null, 2)}`}</pre>}
        </div>
      </div>
      <div className="panel">
        <h3>Консоль API</h3>
        <div className="row-flex" style={{ marginBottom: 10, flexWrap: 'wrap' }}>{EXAMPLES.map(([m, p, b], i) => <button key={i} className="btn light sm" onClick={() => setReq({ ...req, method: m, path: p, body: b ? JSON.stringify(b, null, 2) : '', idem: 'idem-' + Math.random().toString(36).slice(2, 8) })}><span className={`method ${m}`}>{m}</span> {p.replace('/api/v1', '')}</button>)}</div>
        <div className="api-console">
          <div>
            <div className="inline-form">
              <Field label="Метод"><select value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value })}><option>GET</option><option>POST</option></select></Field>
              <Field label="Путь"><input style={{ minWidth: 320 }} value={req.path} onChange={(e) => setReq({ ...req, path: e.target.value })} /></Field>
            </div>
            <div className="inline-form" style={{ marginTop: 8 }}>
              <Field label="Ключ"><select value={key} onChange={(e) => setKey(e.target.value)}>{S.apiKeys.map((k) => <option key={k.id} value={k.token}>{k.name}</option>)}<option value="">— без ключа —</option></select></Field>
              {req.method === 'POST' && <Field label="Idempotency-Key"><input value={req.idem} onChange={(e) => setReq({ ...req, idem: e.target.value })} /></Field>}
            </div>
            {req.method === 'POST' && <Field label="Тело запроса (JSON)"><textarea className="mono" style={{ minHeight: 150 }} value={req.body} onChange={(e) => setReq({ ...req, body: e.target.value })} /></Field>}
            <button className="btn" onClick={send} style={{ marginTop: 8 }}>Отправить</button>
            <p className="hint" style={{ marginTop: 8 }}>Повторите POST с тем же Idempotency-Key — получите тот же ответ без повторного изменения. Старый expected_version → 409.</p>
          </div>
          <pre className="code">{res ? `HTTP ${res.status}${res.replayed ? '  (повтор по idempotency key)' : ''}\n\n${JSON.stringify(res.body, null, 2)}` : 'Ответ появится здесь'}</pre>
        </div>
      </div>
    </>
  );
}
