import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { orderTotals, orderStatus, adaptationCost } from '../engine/engine.js';
import { pnl, stockValue, wipValue } from '../engine/finance.js';
import { ORDER_STATUS, PERMISSIONS, PERMISSION_LABELS, ROLES, roleName } from '../engine/model.js';
import { rub, dt, HOUR } from '../engine/util.js';
import { runScenarios } from '../engine/scenarios.js';
import { Logo, Denied } from '../ui/kit.jsx';

const NAV = [
  ['Обзор', [['/admin', 'Сводка', null, true]]],
  ['Товары', [['/admin/catalog', 'Каталог', 'catalog.view'], ['/admin/import', 'Импорт прайсов', 'pricelist.import'], ['/admin/supplies', 'Поставки и предзаказы', 'supply.view']]],
  ['Склад', [['/admin/stock', 'Остатки и движения', 'stock.view'], ['/admin/adaptation', 'Адаптация', 'adaptation.manage']]],
  ['Продажи', [['/admin/orders', 'Заказы', 'order.view'], ['/admin/claims', 'Претензии', 'claim.decide']]],
  ['Деньги', [['/admin/finance', 'Финансы', 'finance.view']]],
  ['Система', [['/admin/sync', 'Google Диск и резервы', 'sync.view'], ['/admin/api', 'API для RetailCRM', 'api.manage'], ['/admin/audit', 'Журнал аудита', 'audit.view'], ['/admin/users', 'Роли и права', null]]],
];

export function AdminLayout() {
  const { S, actor, setActorId, can, reset } = useStore();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const counts = useMemo(() => ({
    '/admin/orders': S.orders.filter((o) => orderStatus(S, o) === 'needs_decision').length,
    '/admin/claims': S.claims.filter((c) => c.state === 'open').length,
    '/admin/sync': S.exportJobs.filter((j) => j.state === 'error').length,
  }), [S]);
  return (
    <div className="admin">
      <div className="admin-top"><button aria-label="Меню" onClick={() => setOpen(true)}>☰</button><b>VIRIDEA · админ</b></div>
      <aside className={`side ${open ? 'open' : ''}`} onClick={(e) => e.target.tagName === 'A' && setOpen(false)}>
        <Link to="/admin" style={{ textDecoration: 'none' }}><Logo light /></Link>
        <nav>
          {NAV.map(([g, items]) => (
            <div key={g}>
              <div className="group">{g}</div>
              {items.filter(([, , perm]) => !perm || can(perm)).map(([to, label, , end]) => (
                <NavLink key={to} to={to} end={end}>{label}{counts[to] > 0 && <span className="cnt">{counts[to]}</span>}</NavLink>
              ))}
            </div>
          ))}
          <div className="group">Витрина</div>
          <Link to="/">← Открыть сайт</Link>
        </nav>
      </aside>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 45 }} onClick={() => setOpen(false)} />}
      <div className="main" key={loc.pathname}>
        <div className="row-flex" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
          <div className="rolebar" title="Текущий сотрудник">
            <span className="muted">Сотрудник</span>
            <select aria-label="Сотрудник" value={actor.id} onChange={(e) => setActorId(e.target.value)}>
              {S.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

export function Head({ title, children, sub }) {
  return <div className="main-head"><div><h1>{title}</h1>{sub && <div className="muted small">{sub}</div>}</div><div className="row-flex">{children}</div></div>;
}

export function Dashboard() {
  const { S, can } = useStore();
  const nav = useNavigate();
  const now = Date.now();
  const p = can('finance.view') ? pnl(S) : null;
  const needs = S.orders.filter((o) => orderStatus(S, o) === 'needs_decision');
  const unpaid = S.orders.filter((o) => ['awaiting_payment', 'partially_paid'].includes(orderStatus(S, o)));
  const expiring = S.reservations.filter((r) => r.state === 'active' && r.expiresAt - now < 24 * HOUR && orderTotals(S, S.orders.find((o) => o.id === r.orderId)).balance > 0);
  const toShip = S.orders.filter((o) => o.lines.some((l) => l.status === 'reserved') && orderTotals(S, o).balance <= 0);
  const waitingLab = S.batches.filter((b) => b.lines.some((l) => l.confirmState === 'waiting'));
  const jobsErr = S.exportJobs.filter((j) => j.state === 'error').length;
  const jobsQ = S.exportJobs.filter((j) => j.state !== 'done').length;
  return (
    <>
      <Head title="Сводка" sub="Состояние магазина и задачи, требующие решения" />
      <div className="kpis">
        <div className={`kpi ${needs.length ? 'bad' : ''}`}><div className="l">Нужно решение</div><div className="v">{needs.length}</div><div className="s">дефицит / истёкший резерв</div></div>
        <div className="kpi warn"><div className="l">Ждут оплаты</div><div className="v">{unpaid.length}</div><div className="s">резервов истекает за 24 ч: {expiring.length}</div></div>
        <div className="kpi"><div className="l">Готовы к отгрузке</div><div className="v">{toShip.length}</div><div className="s">оплачены, товар в резерве</div></div>
        <div className="kpi"><div className="l">Ответ лаборатории</div><div className="v">{waitingLab.length}</div><div className="s">поставок ждут подтверждения</div></div>
        <div className={`kpi ${jobsErr ? 'bad' : ''}`}><div className="l">Google Диск</div><div className="v" style={{ fontSize: 22 }}>{S.google.online ? (jobsQ ? `в очереди ${jobsQ}` : 'синхронно') : 'сбой API'}</div><div className="s">последняя выгрузка: {dt(S.google.lastSuccessAt)}</div></div>
        {p && <div className="kpi"><div className="l">Маржинальный доход</div><div className="v">{rub(p.contribution)}</div><div className="s">выручка {rub(p.revenue)} · {p.marginPct ?? '—'}%</div></div>}
        {p && <div className="kpi"><div className="l">Склад + адаптация</div><div className="v">{rub(stockValue(S) + wipValue(S))}</div><div className="s">по себестоимости</div></div>}
      </div>
      <div className="cols2">
        <div className="panel">
          <h3>Требует внимания</h3>
          <div className="table-wrap"><table className="t"><tbody>
            {needs.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/admin/orders/${o.id}`)}><td className="mono">{o.id}</td><td>{o.customerSnapshot.name}</td><td><span className="pill bad">{ORDER_STATUS.needs_decision}</span></td></tr>)}
            {expiring.map((r) => <tr key={r.id} className="click" onClick={() => nav(`/admin/orders/${r.orderId}`)}><td className="mono">{r.orderId}</td><td>Резерв {r.sku} истекает {dt(r.expiresAt)}</td><td><span className="pill warn">резерв</span></td></tr>)}
            {S.claims.filter((c) => c.state === 'open').map((c) => <tr key={c.id} className="click" onClick={() => nav('/admin/claims')}><td className="mono">{c.id}</td><td>{c.reason}</td><td><span className="pill warn">претензия</span></td></tr>)}
            {S.inventories.filter((i) => i.state === 'pending').map((i) => <tr key={i.id} className="click" onClick={() => nav('/admin/stock')}><td className="mono">{i.id}</td><td>Расхождение инвентаризации {i.diff > 0 ? '+' : ''}{i.diff}</td><td><span className="pill warn">склад</span></td></tr>)}
            {!needs.length && !expiring.length && <tr><td className="muted">Срочных задач нет</td></tr>}
          </tbody></table></div>
        </div>
        <div className="panel">
          <h3>Последние заказы</h3>
          <div className="table-wrap"><table className="t"><tbody>
            {[...S.orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 7).map((o) => { const t = orderTotals(S, o); return <tr key={o.id} className="click" onClick={() => nav(`/admin/orders/${o.id}`)}><td className="mono">{o.id}</td><td>{o.customerSnapshot.name}<div className="muted small">{dt(o.createdAt)} · {o.channel}</div></td><td className="num">{rub(t.total)}</td><td><span className="pill">{ORDER_STATUS[orderStatus(S, o)]}</span></td></tr>; })}
          </tbody></table></div>
        </div>
      </div>
      <div className="panel">
        <h3>Адаптация в работе</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Сорт</th><th className="num">Вход</th><th className="num">Потери</th><th className="num">Живых</th><th className="num">Себестоимость</th></tr></thead><tbody>
          {S.adaptations.filter((a) => a.status === 'in_progress').map((a) => { const c = adaptationCost(S, a); return <tr key={a.id}><td className="mono">{a.id}</td><td>{S.variants.find((v) => v.sku === a.sku)?.title}</td><td className="num">{a.inputPlants}</td><td className="num">{c.lost}</td><td className="num">{c.alive}</td><td className="num">{can('finance.view') ? rub(c.total) : '•••'}</td></tr>; })}
        </tbody></table></div>
      </div>
    </>
  );
}

export function Users() {
  const { S, op, can } = useStore();
  const perms = Object.keys(PERMISSIONS);
  return (
    <>
      <Head title="Роли и права" sub="Матрица разрешений по модулям; индивидуальные запреты для сотрудника" />
      <div className="panel">
        <h3>Матрица ролей</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>Право</th>{ROLES.map((r) => <th key={r.id} style={{ textAlign: 'center' }}>{r.name}</th>)}</tr></thead><tbody>
          {perms.map((p) => <tr key={p}><td>{PERMISSION_LABELS[p]}<div className="mono muted">{p}</div></td>{ROLES.map((r) => <td key={r.id} style={{ textAlign: 'center' }}>{PERMISSIONS[p].includes(r.id) ? <span className="check-ok">✓</span> : <span className="muted">—</span>}</td>)}</tr>)}
        </tbody></table></div>
      </div>
      <div className="panel">
        <h3>Сотрудники</h3>
        {!can('users.manage') && <div className="notice info">Изменять права может только владелец. Попытка от другой роли будет отклонена и записана в аудит.</div>}
        <div className="table-wrap"><table className="t"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Индивидуальные запреты</th><th></th></tr></thead><tbody>
          {S.users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{roleName(u.role)}</td>
              <td>{(u.deny || []).length ? u.deny.map((d) => <span key={d} className="pill bad" style={{ marginRight: 4 }}>{PERMISSION_LABELS[d]}</span>) : <span className="muted">нет</span>}</td>
              <td>{u.role !== 'owner' && PERMISSIONS['finance.view'].includes(u.role) && (
                <button className="btn light sm" onClick={() => op('users.setDeny', { userId: u.id, perm: 'finance.view', denied: !(u.deny || []).includes('finance.view') }, { success: 'Права обновлены' })}>
                  {(u.deny || []).includes('finance.view') ? 'Вернуть доступ к финансам' : 'Запретить финансы'}
                </button>)}
              </td>
            </tr>
          ))}
        </tbody></table></div>
        <p className="hint" style={{ marginTop: 10 }}>Запрет finance.view скрывает финансы в интерфейсе, в XLSX-выгрузке и в API.</p>
      </div>
    </>
  );
}

export function Audit() {
  const { S, can } = useStore();
  const [q, setQ] = useState('');
  const [onlyDenied, setOnlyDenied] = useState(false);
  if (!can('audit.view')) return <Denied perm="audit.view" />;
  const rows = [...S.audit].reverse().filter((a) => (!onlyDenied || a.denied) && (!q || JSON.stringify(a).toLowerCase().includes(q.toLowerCase()))).slice(0, 300);
  return (
    <>
      <Head title="Журнал аудита" sub="Неизменяемая история: автор, время, объект, до/после, причина">
        <input className="input" placeholder="Поиск: ID, действие, автор…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <label className="row-flex small"><input type="checkbox" checked={onlyDenied} onChange={(e) => setOnlyDenied(e.target.checked)} /> только отказы</label>
      </Head>
      <div className="table-wrap"><table className="t"><thead><tr><th>ID</th><th>Время</th><th>Автор</th><th>Объект</th><th>Действие</th><th>До → после</th><th>Причина</th></tr></thead><tbody>
        {rows.map((a) => (
          <tr key={a.id} style={a.denied ? { background: 'var(--danger-soft)' } : undefined}>
            <td className="mono">{a.id}</td><td className="small">{dt(a.at)}</td><td className="small">{a.actorName}<div className="muted">{roleName(a.role)}</div></td>
            <td className="mono small">{a.objectType}<br />{a.objectId}</td><td>{a.action}</td>
            <td className="diff mono" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{a.before != null && <span className="b">{JSON.stringify(a.before)}</span>} {a.after != null && <span className="a">{JSON.stringify(a.after)}</span>}</td>
            <td className="small">{a.reason}</td>
          </tr>
        ))}
      </tbody></table></div>
    </>
  );
}

export function Tests() {
  const [res, setRes] = useState(() => runScenarios());
  const passed = res.filter((r) => r.pass).length;
  return (
    <>
      <Head title="Самопроверка системы" sub="Контрольные сценарии учёта, исполняемые на изолированной копии базы">
        <button className="btn" onClick={() => setRes(runScenarios())}>Запустить заново</button>
      </Head>
      <div className="kpis"><div className="kpi"><div className="l">Пройдено</div><div className="v">{passed} / {res.length}</div><div className="s">каждый сценарий — на изолированной копии</div></div></div>
      {res.map((r) => (
        <div className="panel" key={r.id}>
          <div className="panel-head"><h3><span className={r.pass ? 'check-ok' : 'check-bad'}>{r.pass ? '✓' : '✗'}</span> {r.id} — {r.title}</h3><span className="muted small">{r.ms} мс</span></div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{r.checks.map((c, i) => <li key={i} className="small" style={{ color: c.ok ? 'var(--ink-2)' : 'var(--danger)' }}>{c.ok ? '✓' : '✗'} {c.text}</li>)}</ul>
        </div>
      ))}
    </>
  );
}
