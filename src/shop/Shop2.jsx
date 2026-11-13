import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { availabilityStatus, variantBySku, orderTotals, orderStatus, compensationBalance, replacementContext } from '../engine/engine.js';
import { CARRIERS, CATEGORIES, LINE_STATUS, ORDER_STATUS, SHIPMENT_STATUS, catName } from '../engine/model.js';
import { rub, dt, randomToken } from '../engine/util.js';
import { photoOf } from '../ui/art.js';
import { Qty, Field, Crumbs } from '../ui/kit.jsx';

function useCartLines() {
  const { S, cart } = useStore();
  return useMemo(() => cart.map((c) => {
    const v = variantBySku(S, c.sku);
    const a = v ? availabilityStatus(S, v) : { max: 0, code: 'out' };
    const st = a.stock?.available || 0;
    return { ...c, v, a, fromStock: Math.min(st, c.qty), preorder: Math.max(0, c.qty - st), over: c.qty > a.max };
  }).filter((x) => x.v), [S, cart]);
}

export function Cart() {
  const { S, cartSet } = useStore();
  const lines = useCartLines();
  const subtotal = lines.reduce((s, l) => s + l.qty * l.v.price, 0);
  const mixed = lines.some((l) => l.preorder > 0) && lines.some((l) => l.fromStock > 0);
  if (!lines.length) return <div className="container section"><div className="empty"><h3>Корзина пуста</h3><p>Загляните в каталог — там микроклоны и адаптированные растения.</p><Link className="btn" to="/catalog">В каталог</Link></div></div>;
  return (
    <div className="container">
      <Crumbs items={[['/', 'Главная'], [null, 'Корзина']]} />
      <div className="two-col">
        <div className="card">
          <h1 style={{ fontSize: 56 }}>Корзина</h1>
          {lines.map((l) => (
            <div key={l.sku} className="cart-line">
              <img src={photoOf(S, l.v)} alt="" />
              <div>
                <Link to={`/p/${l.sku}`} style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>{l.v.title}</Link>
                <div className="muted small">{l.v.sku} · {l.v.category === 'microclone' ? `упаковка ×${l.v.packSize}` : 'шт.'} · {rub(l.v.price)}</div>
                <div className="row-flex" style={{ marginTop: 6 }}>
                  <Qty value={l.qty} max={Math.max(l.qty, l.a.max)} onChange={(n) => cartSet(l.sku, n)} />
                  <button className="linkbtn small" onClick={() => cartSet(l.sku, 0)}>Удалить</button>
                </div>
                {l.preorder > 0 && l.fromStock > 0 && <div className="hint">{l.fromStock} — со склада, {l.preorder} — предзаказ</div>}
                {l.preorder > 0 && l.fromStock === 0 && <div className="hint">Предзаказ: {l.a.label.toLowerCase()}</div>}
                {l.over && <div className="err">Доступно только {l.a.max}. Уменьшите количество.</div>}
              </div>
              <b style={{ whiteSpace: 'nowrap' }}>{rub(l.qty * l.v.price)}</b>
            </div>
          ))}
          {mixed && <div className="notice info">В корзине товары в наличии и предзаказ. На оформлении можно выбрать: отправить раздельно (две доставки) или дождаться поступления и отправить вместе.</div>}
        </div>
        <aside className="card summary">
          <div className="row"><span>Товары</span><b>{rub(subtotal)}</b></div>
          <div className="row muted"><span>Доставка</span><span>на следующем шаге</span></div>
          <div className="row total"><span>Итого</span><span>{rub(subtotal)}</span></div>
          <Link className={`btn block ${lines.some((l) => l.over) ? 'disabled' : ''}`} to={lines.some((l) => l.over) ? '#' : '/checkout'} style={{ marginTop: 12 }}>Перейти к оформлению</Link>
          <p className="hint" style={{ marginTop: 10 }}>Наличие проверяется ещё раз в момент подтверждения заказа.</p>
        </aside>
      </div>
    </div>
  );
}

export function Checkout() {
  const { S, op, cartClear, setCustomerId, customerId } = useStore();
  const lines = useCartLines();
  const nav = useNavigate();
  const cust = S.customers.find((c) => c.id === customerId);
  const [f, setF] = useState({ name: cust?.name || '', phone: cust?.phone || '', email: cust?.email || '', address: '', carrier: 'cdek', split: false, riskAccepted: false, pd: false, offer: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const token = useRef(randomToken(16));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const hasLive = lines.some((l) => CATEGORIES.find((c) => c.id === l.v.category)?.live);
  const mixed = lines.some((l) => l.preorder > 0) && lines.some((l) => l.fromStock > 0);
  const carrier = CARRIERS.find((c) => c.id === f.carrier);
  const delivery = carrier.price * (mixed && f.split ? 2 : 1);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.v.price, 0);
  if (!lines.length) return <div className="container section"><div className="empty"><h3>Корзина пуста</h3><Link className="btn" to="/catalog">В каталог</Link></div></div>;

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = op('checkout', { clientToken: token.current, customer: { name: f.name, phone: f.phone, email: f.email }, items: lines.map((l) => ({ sku: l.sku, qty: l.qty })), delivery: { carrier: f.carrier, address: f.address, split: mixed && f.split, riskAccepted: f.riskAccepted }, consents: { pd: f.pd, offer: f.offer, marketing: f.marketing } }, { public: true });
    setBusy(false);
    if (r?.order) { cartClear(); setCustomerId(r.order.customerId); nav(`/account?created=${r.order.id}`); }
    else token.current = randomToken(16);
  };

  return (
    <div className="container">
      <Crumbs items={[['/', 'Главная'], ['/cart', 'Корзина'], [null, 'Оформление']]} />
      <form className="two-col" onSubmit={submit}>
        <div>
          <div className="card">
            <h2>Контакты</h2>
            <div className="form-grid">
              <Field label="Имя и фамилия *"><input required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
              <Field label="Телефон *" hint="Для подтверждения заказа и уведомлений"><input required type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="+7 900 000-00-00" /></Field>
              <Field label="Email"><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
            </div>
          </div>
          <div className="card">
            <h2>Доставка</h2>
            {CARRIERS.map((c) => {
              const risky = hasLive && !c.live;
              return (
                <label key={c.id} className={`carrier ${f.carrier === c.id ? 'on' : ''} ${risky ? 'disabled' : ''}`}>
                  <input type="radio" name="carrier" checked={f.carrier === c.id} onChange={() => setF((x) => ({ ...x, carrier: c.id, riskAccepted: false }))} />
                  <div style={{ flex: 1 }}><b>{c.name}</b> {c.recommended && <span className="pill ok">рекомендуем для живых растений</span>}<div className="muted small">{c.days} · {rub(c.price)}{risky ? ' · не рекомендуется для живых растений' : ''}</div></div>
                </label>
              );
            })}
            {hasLive && !carrier.live && (
              <div className="notice">
                <b>{carrier.name}</b> не входит в рекомендованные перевозчики для живых растений (риск переохлаждения и долгой доставки). Отправка возможна после подтверждения риска вами и согласования с менеджером. Ваши права покупателя это не ограничивает.
                <label className="row-flex" style={{ marginTop: 8 }}><input type="checkbox" checked={f.riskAccepted} onChange={set('riskAccepted')} /> Понимаю риск и прошу отправить этим способом</label>
              </div>
            )}
            <Field label="Адрес или пункт выдачи"><input value={f.address} onChange={set('address')} placeholder="Город, адрес ПВЗ" /></Field>
            {mixed && (
              <div className="notice info">
                Часть товаров есть на складе, часть — в предзаказе.
                <label className="row-flex" style={{ marginTop: 8 }}><input type="radio" name="split" checked={!f.split} onChange={() => setF((x) => ({ ...x, split: false }))} /> Отправить всё вместе после поступления (одна доставка)</label>
                <label className="row-flex"><input type="radio" name="split" checked={f.split} onChange={() => setF((x) => ({ ...x, split: true }))} /> Отправить наличие сразу, предзаказ — отдельно (две доставки, +{rub(carrier.price)})</label>
              </div>
            )}
          </div>
          <div className="card">
            <h2>Согласия</h2>
            <label className="row-flex" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={f.pd} onChange={set('pd')} /> <span>Согласен(на) на обработку персональных данных по <Link to="/info/privacy">политике</Link> *</span></label>
            <label className="row-flex" style={{ alignItems: 'flex-start', marginTop: 6 }}><input type="checkbox" checked={f.offer} onChange={set('offer')} /> <span>Принимаю условия <Link to="/info/offer">публичной оферты</Link> *</span></label>
            <label className="row-flex" style={{ alignItems: 'flex-start', marginTop: 6 }}><input type="checkbox" checked={f.marketing} onChange={set('marketing')} /> <span>Хочу получать новости о поставках (необязательно)</span></label>
          </div>
        </div>
        <aside className="card summary" style={{ position: 'sticky', top: 84 }}>
          <h3>Ваш заказ</h3>
          {lines.map((l) => <div className="row small" key={l.sku}><span>{l.v.title} × {l.qty}{l.preorder > 0 ? ' (предзаказ)' : ''}</span><span>{rub(l.qty * l.v.price)}</span></div>)}
          <div className="row"><span>Доставка</span><span>{rub(delivery)}</span></div>
          <div className="row total"><span>К оплате</span><span>{rub(subtotal + delivery)}</span></div>
          {hasLive && <div className="notice small">Живые растения: отправляем при температуре от +5 °C, в холодный сезон — с утеплением.</div>}
          <button className="btn block gold" type="submit" disabled={busy || !f.pd || !f.offer || (hasLive && !carrier.live && !f.riskAccepted)}>Подтвердить заказ</button>
          <p className="hint" style={{ marginTop: 10 }}>После подтверждения товары в наличии резервируются на 72 часа. Ссылку на оплату пришлёт менеджер.</p>
        </aside>
      </form>
    </div>
  );
}

export function Account() {
  const { S, op, customerId, setCustomerId, toast } = useStore();
  const [sp] = useSearchParams();
  const [phone, setPhone] = useState('');
  const [claimFor, setClaimFor] = useState(null);
  const [claim, setClaim] = useState({ reason: 'Повреждение при доставке', message: '' });
  const created = sp.get('created');
  const cust = S.customers.find((c) => c.id === customerId);
  if (!cust) {
    return (
      <div className="container section" style={{ maxWidth: 520 }}>
        <div className="card">
          <h1 style={{ fontSize: 56 }}>Личный кабинет</h1>
          <p className="muted">Вход по номеру телефона, указанному при заказе.</p>
          <form onSubmit={(e) => { e.preventDefault(); const c = S.customers.find((x) => x.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')); if (c) setCustomerId(c.id); else toast('Покупатель с таким номером не найден', 'error'); }}>
            <Field label="Телефон"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 111-22-33" /></Field>
            <button className="btn block">Войти</button>
          </form>
        </div>
      </div>
    );
  }
  const orders = S.orders.filter((o) => o.customerId === cust.id).sort((a, b) => b.createdAt - a.createdAt);
  const notes = S.notifications.filter((n) => n.customerId === cust.id).slice(-6).reverse();
  const tokens = S.replacementTokens.filter((t) => !t.used && !t.revoked && t.expiresAt > Date.now() && orders.some((o) => o.id === t.orderId));
  const bal = compensationBalance(S, cust.id);
  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <Crumbs items={[['/', 'Главная'], [null, 'Личный кабинет']]} />
      <div className="row-flex" style={{ margin: '18px 0' }}><h1 style={{ margin: 0, fontSize: 'clamp(40px,5vw,64px)' }}>Здравствуйте, {cust.name.split(' ')[0]}</h1><span className="spacer" /><button className="btn light sm" onClick={() => setCustomerId(null)}>Выйти</button></div>
      {created && <div className="notice ok"><b>Заказ {created} оформлен.</b> Товары в наличии зарезервированы на 72 часа. Менеджер свяжется с вами и пришлёт ссылку на оплату.</div>}
      {tokens.map((t) => <div key={t.token} className="notice"><b>Нужно ваше решение по заказу {t.orderId}.</b> Лаборатория не подтвердила часть товаров. <Link to={`/replace/${t.token}`}>Выбрать замену →</Link></div>)}
      <div className="cols2" style={{ alignItems: 'start' }}>
        <div>
          {orders.map((o) => {
            const t = orderTotals(S, o);
            const ships = S.shipments.filter((s) => s.orderId === o.id);
            return (
              <div className="card" key={o.id}>
                <div className="row-flex"><h3 style={{ margin: 0, fontSize: 30 }}>Заказ <span className="mono" style={{ fontSize: 16 }}>{o.id}</span></h3><span className="pill info">{ORDER_STATUS[orderStatus(S, o)]}</span><span className="spacer" /><span className="muted small">{dt(o.createdAt)}</span></div>
                <table className="t" style={{ marginTop: 10 }}><tbody>
                  {o.lines.map((l) => <tr key={l.id}><td>{l.title}<div className="muted small">{l.qty} × {rub(l.unitPrice)}</div></td><td><span className={`pill ${['shortage', 'expired'].includes(l.status) ? 'bad' : l.status === 'shipped' ? 'ok' : ''}`}>{LINE_STATUS[l.status]}</span></td></tr>)}
                </tbody></table>
                <div className="summary" style={{ marginTop: 10 }}>
                  <div className="row"><span>Сумма</span><b>{rub(t.total)}</b></div>
                  <div className="row"><span>Оплачено</span><span>{rub(t.paid)}</span></div>
                  {t.balance > 0 && <div className="row" style={{ color: 'var(--danger)' }}><span>Остаток к оплате</span><b>{rub(t.balance)}</b></div>}
                </div>
                {ships.map((s) => <div key={s.id} className="small" style={{ marginTop: 6 }}>📦 {CARRIERS.find((c) => c.id === s.carrier)?.name}: {s.tracking ? <b className="mono">{s.tracking}</b> : 'собирается'} — {SHIPMENT_STATUS[s.status]}</div>)}
                <div className="row-flex" style={{ marginTop: 12 }}>
                  {t.balance > 0 && <span className="mono small">Ссылку на оплату пришлёт менеджер</span>}
                  {ships.length > 0 && <button className="btn light sm" onClick={() => setClaimFor(o.id)}>Обращение / претензия</button>}
                </div>
                {claimFor === o.id && (
                  <form className="card" style={{ marginTop: 10, background: 'var(--cream)' }} onSubmit={(e) => { e.preventDefault(); if (op('claim.open', { orderId: o.id, customerId: cust.id, reason: claim.reason, message: claim.message, photos: 0 }, { public: true, success: 'Обращение отправлено' })) setClaimFor(null); }}>
                    <Field label="Причина"><select value={claim.reason} onChange={(e) => setClaim({ ...claim, reason: e.target.value })}><option>Повреждение при доставке</option><option>Растение погибло в пути</option><option>Не тот сорт</option><option>Другое</option></select></Field>
                    <Field label="Сообщение" hint="Фото можно приложить — доступны только сотрудникам"><textarea value={claim.message} onChange={(e) => setClaim({ ...claim, message: e.target.value })} /></Field>
                    <button className="btn sm">Отправить</button>
                  </form>
                )}
                {S.claims.filter((c) => c.orderId === o.id).map((c) => <div key={c.id} className="small muted" style={{ marginTop: 6 }}>Обращение {c.id}: {c.reason} — {c.state === 'open' ? 'на рассмотрении' : `решение: ${c.decision}`}</div>)}
              </div>
            );
          })}
          {!orders.length && <div className="empty">Заказов пока нет.</div>}
        </div>
        <div>
          <div className="card"><h3>Профиль</h3><dl className="kv"><dt>Телефон</dt><dd>{cust.phone}</dd><dt>Email</dt><dd>{cust.email || '—'}</dd><dt>Компенсации</dt><dd>{rub(bal)}</dd></dl><p className="hint">Изменение профиля не меняет данные в уже оформленных заказах.</p></div>
          <div className="card"><h3>Уведомления</h3>{notes.length ? <div className="tl">{notes.map((n) => <div key={n.id}>{n.text}<div className="muted small">{dt(n.at)}</div></div>)}</div> : <p className="muted">Пока нет.</p>}</div>
        </div>
      </div>
    </div>
  );
}

export function Replace() {
  const { token } = useParams();
  const { S, op } = useStore();
  const [done, setDone] = useState(null);
  const rc = replacementContext(S, token, Date.now());
  if (done) return <div className="container section" style={{ maxWidth: 640 }}><div className="card"><h1 style={{ fontSize: 32 }}>Замена принята</h1><p>{done.difference > 0 ? `Доплата: ${rub(done.difference)}. Менеджер пришлёт ссылку.` : done.difference < 0 ? `Разница ${rub(-done.difference)} будет возвращена или зачислена на баланс компенсаций — по вашему выбору.` : 'Сумма заказа не изменилась.'}</p><Link className="btn" to="/account">В личный кабинет</Link></div></div>;
  if (rc.error) return <div className="container section" style={{ maxWidth: 640 }}><div className="empty"><h3>{rc.error}</h3><p>Ссылка персональная и одноразовая.</p></div></div>;
  return (
    <div className="container section">
      <h1>Выбор замены</h1>
      <p>Позиция «<b>{rc.line.title}</b>» × {rc.line.qty} ({rub(rc.line.unitPrice)} за ед.) не подтверждена лабораторией. Выберите замену из того, что есть на складе. Ссылка действует до {dt(rc.t.expiresAt)}.</p>
      {rc.options.length ? (
        <div className="grid">
          {rc.options.map((v) => (
            <article key={v.sku} className="pcard">
              <div className="img"><img src={photoOf(S, v)} alt="" /></div>
              <div className="body">
                <b>{v.title}</b>
                <div className="price">{rub(v.price)}</div>
                <div className="muted small">Разница: {rub((v.price - rc.line.unitPrice) * rc.line.qty)}</div>
                <button className="btn sm" onClick={() => { const r = op('replacement.accept', { token, sku: v.sku }, { public: true }); if (r) setDone(r); }}>Выбрать</button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty">Подходящих замен сейчас нет — менеджер предложит возврат.</div>}
    </div>
  );
}

const INFO = {
  delivery: ['Доставка', <>
    <p>Живые растения рекомендуем отправлять <b>СДЭК</b>: 2–4 дня до большинства городов. В холодный сезон добавляем утеплитель и тепловой пакет на 72 часа. При температуре ниже −15 °C отправку живых растений переносим.</p>
    <p>Также доступны Яндекс Доставка, 5Post, Ozon Доставка и Почта России. Для живых растений эти способы не рекомендуются из-за сроков и условий хранения, поэтому перед отправкой мы попросим подтвердить риск.</p>
    <p>Перед отправкой мы фотографируем упаковку. Трек-номер приходит после передачи посылки перевозчику.</p>
    <p>Если в заказе есть товары в наличии и предзаказ, можно отправить их раздельно (две доставки) или вместе после поступления.</p></>],
  payment: ['Оплата', <><p>После оформления менеджер проверяет наличие и присылает ссылку на оплату картой или через СБП. Для предзаказа возможна частичная предоплата; отправка — после полной оплаты.</p><p>Возврат проводится тем же способом, которым была сделана оплата. Срок зачисления зависит от банка, обычно до 10 рабочих дней.</p></>],
  returns: ['Возвраты и претензии', <><p>Если растение пострадало в пути, откройте обращение в личном кабинете и приложите фото в течение 24 часов после получения. Мы предложим замену, компенсацию на баланс или возврат денег.</p><p>Живые растения надлежащего качества обмену и возврату не подлежат. Товары для ухода можно вернуть в течение 7 дней, если сохранены упаковка и товарный вид.</p></>],
  faq: ['Вопросы и ответы', <><h3>Что такое микроклон?</h3><p>Растение, выращенное в лаборатории из ткани материнского растения. Приходит в стерильной таре и требует адаптации 3–6 недель.</p><h3>Чем «Ближайшее поступление» отличается от «Предзаказа»?</h3><p>«Ближайшее поступление» — лаборатория уже подтвердила количество. «Предзаказ» — ждём подтверждения; если подтвердят меньше, распределяем по очереди оформления.</p><h3>Цена указана за штуку или за упаковку?</h3><p>Для микроклонов — за упаковку (×1, ×5, ×10), рядом показываем цену за одно растение. Остальные товары — поштучно.</p><h3>Сколько держится резерв?</h3><p>72 часа с момента оформления. Если нужно больше времени на оплату — напишите менеджеру.</p></>],
  offer: ['Публичная оферта', <><p>Настоящая оферта определяет условия продажи товаров в интернет-магазине VIRIDEA. Оформление заказа на сайте означает согласие покупателя с её условиями.</p><h3>1. Предмет</h3><p>Продавец передаёт покупателю товары, представленные в каталоге, а покупатель оплачивает и принимает их на условиях оферты.</p><h3>2. Цена и оплата</h3><p>Цена фиксируется в момент оформления заказа и не меняется при последующем изменении цен в каталоге. Оплата производится по ссылке, направленной менеджером.</p><h3>3. Предзаказ</h3><p>Товары со статусом «Предзаказ» и «Ближайшее поступление» поставляются после поступления от лаборатории. При неполном подтверждении покупателю предлагаются замена или возврат денег.</p><h3>4. Доставка</h3><p>Сроки и условия доставки указаны в разделе «Доставка».</p></>],
  privacy: ['Политика обработки персональных данных', <><p>Мы обрабатываем имя, телефон, email и адрес доставки, чтобы выполнить заказ, уведомлять о его статусе и отвечать на обращения.</p><p>Данные хранятся на серверах в Российской Федерации и передаются только службам доставки и платёжному провайдеру в объёме, необходимом для исполнения заказа.</p><p>Согласие на рассылку о новых поставках необязательно и может быть отозвано в любой момент в личном кабинете.</p></>],
  contacts: ['Контакты', <><p>Москва · ежедневно с 10:00 до 20:00</p><p>По вопросам заказов пишите менеджеру — ответим в течение рабочего дня. Обращения по уже полученным заказам удобнее открывать в личном кабинете: там сразу видна история заказа.</p></>],
};

export function Info() {
  const { page } = useParams();
  const [title, body] = INFO[page] || ['Страница не найдена', <p>Такой страницы нет. <Link to="/">На главную</Link></p>];
  return <div className="container section"><div className="prose"><Crumbs items={[['/', 'Главная'], [null, title]]} /><h1>{title}</h1>{body}</div></div>;
}

export function NotFound() {
  return <div className="container section"><div className="empty"><h1>404</h1><p>Страница не найдена.</p><Link className="btn" to="/">На главную</Link></div></div>;
}
