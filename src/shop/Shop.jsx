import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { availabilityStatus, cultivarOf, variantBySku, GENUS_RU, stockOf } from '../engine/engine.js';
import { CATEGORIES, catName } from '../engine/model.js';
import { rub, d } from '../engine/util.js';
import { photoOf, artFor } from '../ui/art.js';
import { I, Logo, Qty, Crumbs } from '../ui/kit.jsx';

const NAV = [['/catalog', 'Каталог'], ['/catalog?cat=microclone', 'Микроклоны'], ['/catalog?cat=adapted', 'Адаптированные'], ['/catalog?cat=care', 'Уход'], ['/info/delivery', 'Доставка']];

export function ShopLayout() {
  const { cart, customerId } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const count = cart.reduce((s, x) => s + x.qty, 0);
  const isOn = (to) => loc.pathname + loc.search === to || (to === '/catalog' && loc.pathname === '/catalog' && !/cat=(microclone|adapted|care)$/.test(loc.search));
  return (
    <>
      <div className="topline">Отправляем живые растения по всей России · утепление и тепловой пакет в холодный сезон · <Link to="/info/delivery">Условия доставки →</Link></div>
      <header className="header">
        <div className="container">
          <div className="cell nav-cell" style={{ paddingLeft: 0 }}>
            <button className="burger" aria-label="Меню" onClick={() => setOpen(!open)}>{I.menu}</button>
          </div>
          <div className="cell"><Link to="/" style={{ textDecoration: 'none' }}><Logo /></Link></div>
          <div className="cell nav-cell">
            <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
              {NAV.map(([to, l]) => <Link key={to} to={to} className={isOn(to) ? 'on' : ''}>{l}</Link>)}
            </nav>
          </div>
          <div className="cell search-cell" style={{ flex: 1 }}>
            <form className="search" onSubmit={(e) => { e.preventDefault(); nav(`/catalog?q=${encodeURIComponent(q)}`); }}>
              {I.search}
              <input aria-label="Поиск" placeholder="Поиск: монстера, Pink Princess…" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
          </div>
          <div className="cell" style={{ marginLeft: 'auto' }}>
            <div className="hicons">
              <Link className="hlink" to="/account">{customerId ? 'Кабинет' : 'Войти'}</Link>
              <Link className="hlink" to="/cart"><span className="lbl">Корзина</span><b>{count}</b></Link>
            </div>
          </div>
        </div>
      </header>
      <main><Outlet /></main>
      <footer className="footer">
        <div className="container">
          <div className="cols">
            <div><h4>VIRIDEA</h4><p style={{ marginTop: 0, maxWidth: 300 }}>Лабораторные микроклоны редких ароидных, адаптированные в нашей теплице растения и всё для ухода.</p></div>
            <div><h4>Каталог</h4><Link to="/catalog?cat=microclone">Микроклоны</Link><Link to="/catalog?cat=adapted">Адаптированные</Link><Link to="/catalog?cat=seedling">Саженцы</Link><Link to="/catalog?cat=care">Товары для ухода</Link></div>
            <div><h4>Покупателю</h4><Link to="/info/delivery">Доставка</Link><Link to="/info/payment">Оплата</Link><Link to="/info/returns">Возвраты и претензии</Link><Link to="/info/faq">Вопросы и ответы</Link></div>
            <div><h4>Документы</h4><Link to="/info/offer">Публичная оферта</Link><Link to="/info/privacy">Обработка ПД</Link><Link to="/info/contacts">Контакты</Link><Link to="/admin">Вход для сотрудников</Link></div>
          </div>
          <div className="giant" aria-hidden>VIRIDEA</div>
          <div className="legal"><span>© {new Date().getFullYear()} VIRIDEA · Все права защищены</span><span>Обработка персональных данных — по 152-ФЗ</span></div>
        </div>
      </footer>
    </>
  );
}

function specMeta(S, v) {
  const cv = cultivarOf(S, v);
  if (!cv) return { genus: 'Принадлежности', name: v.title };
  return { genus: `${cv.genus} · ${GENUS_RU[cv.genus] || ''}`, name: `‘${cv.name}’` };
}

export function ProductCard({ v }) {
  const { S, cartAdd, toast } = useStore();
  const a = availabilityStatus(S, v);
  const { genus, name } = specMeta(S, v);
  const per = v.category === 'microclone' && v.packSize > 1 ? Math.round(v.price / v.packSize) : null;
  const form = v.category === 'microclone' ? `in vitro, ×${v.packSize}` : v.category === 'care' ? 'принадлежность' : v.isIndividual ? 'экземпляр' : catName(v.category).toLowerCase();
  return (
    <article className="spec">
      <Link className="img" to={`/p/${v.sku}`}>
        <img src={photoOf(S, v)} alt={v.title} loading="lazy" />
        <span className="no">№ {v.sku}</span>
        {v.isNew && <span className="flag">Новинка</span>}
        {v.isIndividual && <span className="flag gold">Unicum</span>}
        <span className="stamp-pos"><span className={`stamp ${a.code}`}>{a.label}</span></span>
      </Link>
      <div className="label">
        <span className="genus">{genus}</span>
        <Link className="name" to={`/p/${v.sku}`}>{name}</Link>
        <dl className="leaders">
          <div><dt>Форма</dt><span className="dots" /><dd>{form}</dd></div>
          <div><dt>Ед.</dt><span className="dots" /><dd>{v.category === 'microclone' ? `упаковка, ${v.packSize} раст.` : 'штука'}</dd></div>
        </dl>
        <div className="foot">
          <div className="price">{rub(v.price)}<small>{per ? `≈ ${rub(per)} / растение` : v.category === 'microclone' ? 'за упаковку' : 'за штуку'}</small></div>
          <button className="add" disabled={a.max <= 0} title={a.code === 'in_stock' ? 'В корзину' : 'Оформить предзаказ'} aria-label={`В корзину: ${v.title}`} onClick={() => { cartAdd(v.sku, 1); toast('Добавлено в корзину'); }}>+</button>
        </div>
      </div>
    </article>
  );
}

export function Home() {
  const { S } = useStore();
  const visible = S.variants.filter((v) => v.active);
  const pick = (f, n = 4) => visible.filter(f).slice(0, n);
  const news = pick((v) => v.isNew && availabilityStatus(S, v).code !== 'out');
  const incoming = pick((v) => ['incoming', 'preorder'].includes(availabilityStatus(S, v).code));
  const instock = pick((v) => v.category === 'adapted' && availabilityStatus(S, v).code === 'in_stock');
  const cv0 = S.cultivars[0];
  const hero = cv0?.art ? artFor(cv0.art, 'adapted', { hero: true }) : null;
  const openBatches = S.batches.filter((b) => !['received', 'cancelled'].includes(b.status));
  const inStockCount = visible.filter((v) => availabilityStatus(S, v).code === 'in_stock').length;
  const tick = openBatches.flatMap((b) => b.lines.map((l) => `${variantBySku(S, l.sku)?.title.replace(/ — .*/, '')} · ${l.confirmState === 'waiting' ? 'ждём ответ лаборатории' : `подтверждено ${l.confirmedQty} из ${l.orderedQty}`}`));
  const tickItems = tick.length ? tick : ['Новые поставки появятся здесь'];
  const month = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-grid">
            <div className="hero-text">
              <div className="hero-meta"><span>Каталог растений · {month}</span><span>Москва → вся Россия</span></div>
              <h1>Редкие<br />растения<em>из пробирки</em><span className="gold">—</span> к вам</h1>
              <p className="lead">Микроклоны коллекционных ароидных напрямую из лабораторий, адаптированные в нашей теплице растения и всё, что нужно для ухода.</p>
              <div className="cta">
                <Link className="btn" to="/catalog">Открыть каталог <span className="arr">→</span></Link>
                <Link className="btn ghost" to="/catalog?avail=incoming,preorder">Предзаказ</Link>
              </div>
            </div>
            <figure className="plate">
              <div style={{ position: 'relative' }}>
                {hero && <img src={hero} alt={`${cv0.genus} ${cv0.name} — ботаническая иллюстрация`} />}
                <span className="anno" style={{ top: '16%', right: 14 }}>A. вариегатность</span>
                <span className="anno r" style={{ top: '80%', left: 14 }}>B. корни ex vitro</span>
              </div>
              <figcaption><span className="mono">TAB. I</span><span>{cv0?.genus} ‘{cv0?.name}’ — растение после адаптации ex vitro, 4 листа, без горшка.</span></figcaption>
            </figure>
          </div>
          <div className="facts">
            <div><b>{inStockCount}</b><span>позиций на складе</span></div>
            <div><b>{openBatches.length}</b><span>поставки в пути</span></div>
            <div><b>72 ч</b><span>резерв после заказа</span></div>
            <div><b>+5 °C</b><span>минимум для отправки</span></div>
          </div>
        </div>
      </section>
      <div className="ticker" aria-label="Статусы поставок"><div className="track">{[...tickItems, ...tickItems].map((t, i) => <span key={i}>{t}</span>)}</div></div>

      <section className="section"><div className="container">
        <div className="sec-head"><span className="no">§ 1 · Указатель</span><h2>Разделы каталога</h2><span className="aside">Один сорт продаётся в разных формах: от микроклона в пробирке до взрослого растения.</span></div>
        <div className="index">
          {CATEGORIES.map((c, i) => {
            const v = visible.find((x) => x.category === c.id);
            const n = visible.filter((x) => x.category === c.id).length;
            return (
              <Link key={c.id} className="index-row" to={`/catalog?cat=${c.id}`}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="t">{c.name}</span>
                <span className="d">{{ microclone: 'In vitro, стерильная тара, упаковки ×1 / ×5 / ×10. Требуют адаптации.', adapted: 'Прошли адаптацию в теплице VIRIDEA, 3–4 листа.', seedling: 'Подрощенные растения, 5–7 листьев.', care: 'Субстраты, мини-парники, тепловые пакеты, удобрения.' }[c.id]}</span>
                <span className="c">{n} поз.</span>
                {v ? <img src={photoOf(S, v)} alt="" /> : <span />}
              </Link>
            );
          })}
        </div>
      </div></section>

      {openBatches.length > 0 && <section className="section" style={{ paddingTop: 0 }}><div className="container">
        <div className="sec-head"><span className="no">§ 2 · Журнал поставок</span><h2>Что едет из лабораторий</h2><span className="aside">Дату обещаем только после подтверждения лаборатории. Ожидаемое ≠ наличие на складе.</span></div>
        <div className="table-wrap" style={{ borderTop: 0 }}><table className="ledger"><thead><tr><th>Партия</th><th>Сорта</th><th>Статус</th><th>Срок</th></tr></thead><tbody>
          {openBatches.map((b) => (
            <tr key={b.id}>
              <td className="mono">{b.id}</td>
              <td>{b.lines.map((l) => variantBySku(S, l.sku)?.title.replace(/ — .*/, '')).join(', ')}</td>
              <td><span className={`stamp ${b.status === 'ordered' ? 'preorder' : 'incoming'}`}>{b.status === 'ordered' ? 'Ждём ответ' : 'Подтверждено'}</span></td>
              <td className="mono">{b.status === 'ordered' ? 'уточняется' : `≈ ${d(b.plannedAt)}`}</td>
            </tr>
          ))}
        </tbody></table></div>
        {incoming.length > 0 && <div className="grid" style={{ marginTop: 28 }}>{incoming.map((v) => <ProductCard key={v.sku} v={v} />)}</div>}
      </div></section>}

      <section className="section" style={{ paddingTop: 0 }}><div className="container">
        <div className="sec-head"><span className="no">§ 3 · Новые образцы</span><h2>Новинки</h2><Link className="btn ghost sm" to="/catalog?sort=new">Все новинки →</Link></div>
        <div className="grid" style={{ borderTop: 0 }}>{news.map((v) => <ProductCard key={v.sku} v={v} />)}</div>
      </div></section>

      <section className="section" style={{ paddingTop: 0 }}><div className="container">
        <div className="sec-head"><span className="no">§ 4 · Ex vitro</span><h2>Готовы к переезду</h2><Link className="btn ghost sm" to="/catalog?cat=adapted&avail=in_stock">Все адаптированные →</Link></div>
        <div className="grid" style={{ borderTop: 0 }}>{instock.map((v) => <ProductCard key={v.sku} v={v} />)}</div>
      </div></section>

      <section className="section" style={{ paddingTop: 0 }}><div className="container">
        <div className="sec-head"><span className="no">§ 5 · Правила</span><h2>Как мы работаем</h2></div>
        <div className="rules">
          <div><span className="rn">I</span><b>Честное наличие</b><p>«В наличии» — только то, что физически лежит на нашем складе. Ожидаемое из лаборатории — отдельный статус.</p></div>
          <div><span className="rn">II</span><b>Резерв 72 часа</b><p>После оформления товар закреплён за вами, пока менеджер согласует оплату.</p></div>
          <div><span className="rn">III</span><b>Фото упаковки</b><p>Каждую посылку с живыми растениями фотографируем перед передачей перевозчику.</p></div>
          <div><span className="rn">IV</span><b>Замены без хаоса</b><p>Если лаборатория не подтвердила сорт — персональная ссылка на выбор замены или возврат.</p></div>
        </div>
      </div></section>
    </>
  );
}

const PER_PAGE = 12;

function matchQuery(S, v, q) {
  if (!q) return true;
  const cv = cultivarOf(S, v);
  const hay = [v.title, v.sku, cv?.genus, cv?.name, GENUS_RU[cv?.genus], ...(cv?.synonyms || [])].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function Catalog() {
  const { S } = useStore();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const get = (k) => sp.get(k) || '';
  const list = (k) => (sp.get(k) ? sp.get(k).split(',') : []);
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v === '' || v == null || (Array.isArray(v) && !v.length)) n.delete(k); else n.set(k, Array.isArray(v) ? v.join(',') : v); n.delete('page'); setSp(n, { replace: true }); };
  const toggle = (k, val) => { const cur = list(k); set(k, cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val]); };

  const cats = list('cat'), genus = list('genus'), avail = list('avail'), packs = list('pack');
  const varieg = get('var'), q = get('q'), sort = get('sort') || 'popular', pmin = +get('pmin') || 0, pmax = +get('pmax') || 0;
  const page = Math.max(1, +get('page') || 1);

  const all = useMemo(() => S.variants.filter((v) => v.active).map((v) => ({ v, a: availabilityStatus(S, v), cv: cultivarOf(S, v) })), [S]);
  const genera = [...new Set(all.map((x) => x.cv?.genus).filter(Boolean))].sort();
  let items = all.filter(({ v, a, cv }) =>
    (!cats.length || cats.includes(v.category)) && (!genus.length || genus.includes(cv?.genus)) && (!avail.length || avail.includes(a.code)) &&
    (!packs.length || packs.includes(String(v.packSize)) || (packs.includes('other') && ![1, 5, 10].includes(v.packSize))) &&
    (!varieg || (varieg === 'yes' ? cv?.variegation : !cv?.variegation)) && (!pmin || v.price >= pmin) && (!pmax || v.price <= pmax) && matchQuery(S, v, q));
  const rank = { in_stock: 0, incoming: 1, preorder: 2, out: 3 };
  items = [...items].sort((x, y) => sort === 'price_asc' ? x.v.price - y.v.price : sort === 'price_desc' ? y.v.price - x.v.price : sort === 'name' ? x.v.title.localeCompare(y.v.title) : sort === 'new' ? (y.v.isNew - x.v.isNew) || y.v.createdAt - x.v.createdAt : rank[x.a.code] - rank[y.a.code] || x.v.title.localeCompare(y.v.title));
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const shown = items.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE);
  const hasFilters = [...sp.keys()].some((k) => k !== 'sort' && k !== 'page');
  const active = [...cats.map((c) => ['cat', c, catName(c)]), ...genus.map((g) => ['genus', g, g]), ...avail.map((a) => ['avail', a, { in_stock: 'В наличии', incoming: 'Поступление', preorder: 'Предзаказ' }[a]]), ...packs.map((p) => ['pack', p, `×${p}`])];

  return (
    <div className="container">
      <Crumbs items={[['/', 'Главная'], [null, 'Каталог']]} />
      <div className="page-title">
        <h1>{q ? `«${q}»` : cats.length === 1 ? catName(cats[0]) : 'Каталог'}</h1>
        <span className="cnt">{items.length} образцов · стр. {Math.min(page, pages)} из {pages}</span>
      </div>
      <div className="catalog">
        <aside className={`filters ${open ? 'open' : ''}`} aria-label="Фильтры">
          <h4>Категория</h4>
          {CATEGORIES.map((c) => <label key={c.id} className="chk"><input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggle('cat', c.id)} />{c.name}</label>)}
          <h4>Наличие</h4>
          {[['in_stock', 'В наличии'], ['incoming', 'Ближайшее поступление'], ['preorder', 'Предзаказ']].map(([id, l]) => <label key={id} className="chk"><input type="checkbox" checked={avail.includes(id)} onChange={() => toggle('avail', id)} />{l}</label>)}
          <h4>Род</h4>
          {genera.map((g) => <label key={g} className="chk"><input type="checkbox" checked={genus.includes(g)} onChange={() => toggle('genus', g)} />{g} <span className="muted small">{GENUS_RU[g]}</span></label>)}
          <h4>Вариегатность</h4>
          {[['', 'Любая'], ['yes', 'Вариегатные'], ['no', 'Зелёные']].map(([id, l]) => <label key={id} className="chk"><input type="radio" name="var" checked={varieg === id} onChange={() => set('var', id)} />{l}</label>)}
          <h4>Упаковка микроклонов</h4>
          {[['1', '×1'], ['5', '×5'], ['10', '×10'], ['other', 'Другая']].map(([id, l]) => <label key={id} className="chk"><input type="checkbox" checked={packs.includes(id)} onChange={() => toggle('pack', id)} />{l}</label>)}
          <h4>Цена, ₽</h4>
          <div className="row"><input className="input" type="number" placeholder="от" value={get('pmin')} onChange={(e) => set('pmin', e.target.value)} /><input className="input" type="number" placeholder="до" value={get('pmax')} onChange={(e) => set('pmax', e.target.value)} /></div>
          {hasFilters && <button className="btn light block" style={{ marginTop: 16 }} onClick={() => setSp({}, { replace: true })}>Сбросить фильтры</button>}
        </aside>
        <section className="catalog-main">
          <div className="toolbar">
            <div className="chips">
              <button className="mfilter" onClick={() => setOpen(!open)}>Фильтры{hasFilters ? ` (${active.length})` : ''}</button>
              {active.map(([k, v, l]) => <button key={k + v} onClick={() => toggle(k, v)}>{l} ×</button>)}
            </div>
            <select className="input" style={{ width: 'auto' }} aria-label="Сортировка" value={sort} onChange={(e) => set('sort', e.target.value === 'popular' ? '' : e.target.value)}>
              <option value="popular">Сначала в наличии</option><option value="price_asc">Цена ↑</option><option value="price_desc">Цена ↓</option><option value="new">Новизна</option><option value="name">По названию</option>
            </select>
          </div>
          {shown.length ? <div className="grid">{shown.map(({ v }) => <ProductCard key={v.sku} v={v} />)}</div> : (
            <div className="empty"><h3>Образцов не найдено</h3><p>Попробуйте изменить запрос или сбросить фильтры.</p><button className="btn" onClick={() => setSp({}, { replace: true })}>Сбросить фильтры</button></div>
          )}
          {pages > 1 && <div className="pager">{Array.from({ length: pages }, (_, i) => <button key={i} className={page === i + 1 ? 'active' : ''} onClick={() => { const n = new URLSearchParams(sp); n.set('page', i + 1); setSp(n); window.scrollTo(0, 0); }}>{String(i + 1).padStart(2, '0')}</button>)}</div>}
        </section>
      </div>
    </div>
  );
}

export function Product() {
  const { sku } = useParams();
  const { S, cart, cartAdd, toast } = useStore();
  const v = variantBySku(S, sku);
  const [qty, setQty] = useState(1);
  const [alt, setAlt] = useState(false);
  if (!v || !v.active) return <div className="container section"><div className="empty"><h3>Товар не найден или снят с продажи</h3><Link className="btn" to="/catalog">В каталог</Link></div></div>;
  const cv = cultivarOf(S, v);
  const a = availabilityStatus(S, v);
  const inCart = cart.find((x) => x.sku === sku)?.qty || 0;
  const max = Math.max(0, a.max - inCart);
  const siblings = S.variants.filter((x) => x.active && x.cultivarId && x.cultivarId === v.cultivarId && x.sku !== v.sku && !x.isIndividual);
  const lot = S.lots.find((l) => l.sku === v.sku && l.qty > 0);
  const st = stockOf(S, v.sku);
  const adultImg = cv ? artFor(cv.art, 'adapted', {}) : null;
  return (
    <div className="container">
      <Crumbs items={[['/', 'Главная'], ['/catalog', 'Каталог'], [`/catalog?cat=${v.category}`, catName(v.category)], [null, v.sku]]} />
      <div className="product">
        <div className="gallery">
          <img src={alt && adultImg ? adultImg : photoOf(S, v)} alt={v.title} />
          {v.category === 'microclone' && cv && <div className="thumbs"><img className={alt ? '' : 'on'} src={photoOf(S, v)} alt="Микроклон" onClick={() => setAlt(false)} /><img className={alt ? 'on' : ''} src={adultImg} alt="Взрослое растение" title="Так выглядит взрослое растение" onClick={() => setAlt(true)} /><span className="mono muted" style={{ alignSelf: 'center', padding: '0 14px' }}>{alt ? 'Взрослое растение' : 'In vitro'}</span></div>}
        </div>
        <div className="info">
          <div className="eyebrow">{catName(v.category)}{cv ? ` · ${cv.genus}` : ''}</div>
          <h1>{cv ? <>{cv.genus}<br /><span style={{ color: 'var(--emerald)' }}>‘{cv.name}’</span></> : v.title}</h1>
          <div className="row-flex" style={{ margin: '6px 0 18px' }}><span className={`stamp ${a.code}`}>{a.label}</span>{v.isNew && <span className="pill new">Новинка</span>}{v.isIndividual && <span className="pill gold">Индивидуальный экземпляр</span>}</div>
          <div className="price">{rub(v.price)}</div>
          <div className="mono muted" style={{ marginTop: 6 }}>{v.category === 'microclone' ? `за упаковку из ${v.packSize} ${v.packSize === 1 ? 'растения' : 'растений'}${v.packSize > 1 ? ` · ≈ ${rub(Math.round(v.price / v.packSize))} за растение` : ''}` : 'за штуку'}</div>
          <div className="herb-label">
            <div className="hl-head"><span>VIRIDEA · этикетка образца</span><span>№ {v.sku}</span></div>
            <dl className="kv">
              {cv && <><dt>Род</dt><dd><i>{cv.genus}</i> · {GENUS_RU[cv.genus]}</dd><dt>Сорт</dt><dd>‘{cv.name}’</dd></>}
              <dt>Форма</dt><dd>{catName(v.category)}</dd>
              <dt>Упаковка</dt><dd>{v.category === 'microclone' ? `${v.packSize} шт.; продаётся упаковками` : 'поштучно'}</dd>
              <dt>Наличие</dt><dd>{a.code === 'in_stock' ? `${st.available} ${v.category === 'microclone' ? 'упак.' : 'шт.'} на складе` : a.code === 'incoming' ? (a.date ? `ориентировочно ${d(a.date)}, точную дату подтвердим` : 'ожидается, дату подтвердим') : a.code === 'preorder' ? 'ждём подтверждения лаборатории' : 'нет'}</dd>
              {lot && <><dt>Партия</dt><dd className="mono">{lot.batchId}</dd></>}
            </dl>
          </div>
          {v.restrictions && <div className="notice"><b>Ограничения доставки.</b> {v.restrictions}</div>}
          {a.code === 'preorder' && <div className="notice info">Предзаказ ставит вас в очередь. Если лаборатория подтвердит меньше, распределение идёт по времени оформления, а для остатка мы предложим замену или возврат.</div>}
          {a.max > 0 ? (
            <div className="row-flex" style={{ marginTop: 18, gap: 0 }}>
              <Qty value={Math.min(qty, Math.max(1, max))} max={Math.max(1, max)} onChange={setQty} />
              <button className="btn" style={{ height: 44, marginLeft: -1 }} disabled={max <= 0} onClick={() => { cartAdd(v.sku, Math.min(qty, max)); toast('Добавлено в корзину'); setQty(1); }}>{a.code === 'in_stock' ? 'В корзину' : 'Оформить предзаказ'} <span className="arr">→</span></button>
              {inCart > 0 && <Link to="/cart" className="mono" style={{ marginLeft: 14 }}>в корзине: {inCart}</Link>}
            </div>
          ) : <div className="notice bad">Сейчас нет в наличии и не ожидается.</div>}
          {max <= 0 && a.max > 0 && <p className="hint">Вы добавили всё доступное количество.</p>}
          <p style={{ marginTop: 22, color: 'var(--ink-2)' }}>{v.description}</p>
          {siblings.length > 0 && <div style={{ marginTop: 22 }}><div className="eyebrow" style={{ marginBottom: 8 }}>Другие формы этого сорта</div><div className="row-flex">{siblings.map((s) => <Link key={s.sku} to={`/p/${s.sku}`} className="btn light sm">{s.category === 'microclone' ? `in vitro ×${s.packSize}` : catName(s.category)} · {rub(s.price)}</Link>)}</div></div>}
        </div>
      </div>
    </div>
  );
}
