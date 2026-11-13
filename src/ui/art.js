// Процедурные иллюстрации в стиле ботанической таблицы: контур тушью, приглушённые заливки, корни, крепёжные ленты.
// Реальные фото загружаются из прайсов/админки и заменяют иллюстрацию.

const cache = new Map();
const INK = '#13261f';
const PAPER = '#f4efe4';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
const f1 = (n) => n.toFixed(1);

function leafPath(shape, L, w) {
  switch (shape) {
    case 'arrow':
      return `M0,-${L * 0.08} L${-w * 0.95},${L * 0.1} C${-w * 1.05},${-L * 0.35} ${-w * 0.35},${-L * 0.8} 0,${-L} C${w * 0.35},${-L * 0.8} ${w * 1.05},${-L * 0.35} ${w * 0.95},${L * 0.1} Z`;
    case 'lance':
      return `M0,0 C${-w * 0.75},${-L * 0.2} ${-w * 0.6},${-L * 0.75} 0,${-L} C${w * 0.6},${-L * 0.75} ${w * 0.75},${-L * 0.2} 0,0 Z`;
    case 'oval':
      return `M0,0 C${-w * 1.1},${-L * 0.1} ${-w * 1.1},${-L * 0.9} 0,${-L} C${w * 1.1},${-L * 0.9} ${w * 1.1},${-L * 0.1} 0,0 Z`;
    default:
      return `M0,${-L * 0.1} C${-w * 0.5},${L * 0.08} ${-w * 1.15},${-L * 0.1} ${-w * 0.95},${-L * 0.5} C${-w * 0.8},${-L * 0.8} ${-w * 0.3},${-L * 0.92} 0,${-L} C${w * 0.3},${-L * 0.92} ${w * 0.8},${-L * 0.8} ${w * 0.95},${-L * 0.5} C${w * 1.15},${-L * 0.1} ${w * 0.5},${L * 0.08} 0,${-L * 0.1} Z`;
  }
}

function variegation(kind, r, L, w, id) {
  const out = [];
  const blob = (fill, n, rmin, rmax, op = 1) => {
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * w * 2, y = -r() * L, rr = rmin + r() * (rmax - rmin);
      out.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rr)}" ry="${f1(rr * (0.6 + r() * 0.8))}" fill="${fill}" opacity="${op}"/>`);
    }
  };
  switch (kind) {
    case 'sectoral': out.push(`<path d="M0,0 L${w * 1.3},${-L * (0.2 + r() * 0.3)} L${w * 1.3},${-L * 1.1} L${w * 0.1},${-L * 1.1} Z" fill="${PAPER}"/>`); blob(PAPER, 3, 3, 7); break;
    case 'constellation': blob('#e8dcae', 30, 1, 3, 0.95); break;
    case 'splash': blob(PAPER, 6, 5, 12); break;
    case 'pink': blob('#d99aa9', 5, 5, 13); break;
    case 'yellow': blob('#d6c779', 8, 3, 9, 0.95); break;
    case 'marble': blob('#a9c39c', 24, 1.4, 4, 0.85); break;
    case 'mint': blob('#c3dcc3', 9, 4, 10, 0.9); break;
    case 'dots': blob('#e6ebe6', 20, 1.2, 2.4); break;
    case 'veins':
      for (let i = 1; i <= 4; i++) out.push(`<path d="M0,${-L * 0.1} Q${-w * 0.7},${-L * (0.15 + i * 0.16)} ${-w * 0.2},${-L * (0.25 + i * 0.17)} M0,${-L * 0.1} Q${w * 0.7},${-L * (0.15 + i * 0.16)} ${w * 0.2},${-L * (0.25 + i * 0.17)}" stroke="#dfe7d6" stroke-width="1.1" fill="none"/>`);
      break;
    case 'pinkedge': out.push(`<path d="${leafPath('oval', L, w)}" fill="none" stroke="#e6bcc6" stroke-width="${w * 0.4}"/>`); break;
    default: break;
  }
  // лёгкая штриховка тени по левой половине — как на гравюре
  for (let k = 0; k < 7; k++) out.push(`<path d="M${f1(-w * 1.1)},${f1(-L * (0.15 + k * 0.11))} l${f1(w * 0.55)},${f1(-L * 0.08)}" stroke="${INK}" stroke-width="0.5" opacity="0.28"/>`);
  return `<g clip-path="url(#${id})">${out.join('')}</g>`;
}

function roots(r, cx, cy, scale) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    let x = cx + (r() - 0.5) * 8, y = cy;
    let d = `M${f1(x)},${f1(y)}`;
    const dir = (r() - 0.5) * 1.6;
    for (let k = 0; k < 5; k++) { x += (dir + (r() - 0.5) * 0.9) * 6 * scale; y += (4 + r() * 4) * scale; d += ` L${f1(x)},${f1(y)}`; }
    out.push(`<path d="${d}" stroke="${INK}" stroke-width="${f1(0.5 + r() * 0.5)}" fill="none" stroke-linecap="round" opacity="0.75"/>`);
  }
  return out.join('');
}

function plant(art, { leaves = 3, scale = 1, cx = 100, cy = 150, rootsOn = true } = {}) {
  const r = rng((art.seed || 1) * 977 + leaves);
  const hue = art.hue ?? 140;
  const parts = [];
  if (rootsOn) parts.push(roots(r, cx, cy, scale));
  for (let i = 0; i < leaves; i++) {
    const t = leaves === 1 ? 0 : i / (leaves - 1);
    const ang = (-58 + t * 116 + (r() - 0.5) * 14) * (Math.PI / 180);
    const stem = (38 + r() * 26) * scale;
    const L = (50 + r() * 16) * scale * (art.shape === 'lance' ? 1.15 : 1);
    const w = L * (art.shape === 'lance' ? 0.28 : art.shape === 'oval' ? 0.42 : 0.5);
    const tipx = cx + Math.sin(ang) * stem, tipy = cy - Math.cos(ang) * stem;
    const deg = (ang * 180) / Math.PI;
    const dark = art.varieg === 'veins' || art.varieg === 'dots';
    const fill = dark ? hsl(hue, 26, 24 + r() * 6) : hsl(hue, 28, 34 + r() * 10);
    const id = `c${art.seed}_${leaves}_${i}_${Math.round(scale * 10)}`;
    const p = leafPath(art.shape, L, w);
    let extra = '';
    if (art.shape === 'monstera' && L > 30) {
      for (let k = 0; k < 3; k++) extra += `<path d="M${-w * 0.97},${-L * (0.3 + k * 0.16)} L${-w * 0.35},${-L * (0.36 + k * 0.15)} M${w * 0.97},${-L * (0.3 + k * 0.16)} L${w * 0.35},${-L * (0.36 + k * 0.15)}" stroke="${PAPER}" stroke-width="${2.4 * scale}" stroke-linecap="round"/>`;
    }
    if (art.shape === 'lobed') extra = `<path d="M${-w * 1.05},${-L * 0.45} L${-w * 0.45},${-L * 0.5} L${-w * 1.05},${-L * 0.62} Z M${w * 1.05},${-L * 0.45} L${w * 0.45},${-L * 0.5} L${w * 1.05},${-L * 0.62} Z" fill="${PAPER}"/>`;
    const side = [0.3, 0.45, 0.6, 0.75].map((k) => `M0,${-L * k} Q${-w * 0.4},${-L * (k + 0.04)} ${-w * 0.75},${-L * (k + 0.12)} M0,${-L * k} Q${w * 0.4},${-L * (k + 0.04)} ${w * 0.75},${-L * (k + 0.12)}`).join(' ');
    parts.push(`<path d="M${cx},${cy} Q${f1(cx + Math.sin(ang) * stem * 0.25)},${f1(cy - stem * 0.6)} ${f1(tipx)},${f1(tipy)}" stroke="${INK}" stroke-width="${f1(1.1 * scale + 0.3)}" fill="none"/>`);
    parts.push(`<g transform="translate(${f1(tipx)} ${f1(tipy)}) rotate(${f1(deg)})"><defs><clipPath id="${id}"><path d="${p}"/></clipPath></defs><path d="${p}" fill="${fill}"/>${variegation(art.varieg, r, L, w, id)}<path d="${side}" stroke="${INK}" stroke-width="0.45" fill="none" opacity="0.45"/>${extra}<path d="${p}" fill="none" stroke="${INK}" stroke-width="0.9"/><path d="M0,${-L * 0.08} L0,${-L * 0.94}" stroke="${INK}" stroke-width="0.7" opacity="0.7"/></g>`);
  }
  // крепёжные ленты гербарного листа
  parts.push(`<rect x="${cx - 16}" y="${cy - 14}" width="32" height="8" fill="#e9dfc4" opacity="0.85" transform="rotate(-8 ${cx} ${cy - 10})"/>`);
  return parts.join('');
}

function wrap(inner, { caption = '', bg = PAPER } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/>${inner}${caption ? `<text x="190" y="191" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="7" letter-spacing="0.8" fill="${INK}" opacity="0.6">${caption}</text>` : ''}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const S = `stroke="${INK}" stroke-width="1.3" fill="none" stroke-linejoin="round"`;
const CARE_ICONS = {
  bag: `<path d="M64 62 L136 62 L146 168 L54 168 Z" ${S}/><path d="M64 62 L136 62 L132 52 L68 52 Z" ${S}/><path d="M60 140 L140 140" ${S} stroke-dasharray="2 3"/>${[...Array(26)].map((_, i) => `<circle cx="${62 + (i * 37) % 78}" cy="${146 + (i * 13) % 18}" r="1.4" fill="${INK}" opacity=".6"/>`).join('')}<path d="M92 110 q8 -22 16 0 q-8 6 -16 0Z" ${S}/>`,
  dome: `<path d="M44 150 Q44 64 100 58 Q156 64 156 150" ${S}/><path d="M34 150 H166 V166 H34 Z" ${S}/><circle cx="100" cy="66" r="6" ${S}/><path d="M60 120 Q70 90 92 76" ${S} opacity=".4"/>`,
  heat: `<rect x="58" y="56" width="84" height="112" ${S}/><path d="M80 132 q10 -20 0 -40 M100 132 q10 -20 0 -40 M120 132 q10 -20 0 -40" ${S}/><path d="M58 70 H142" ${S}/>`,
  bottle: `<rect x="84" y="40" width="32" height="18" ${S}/><path d="M72 70 Q72 58 84 58 L116 58 Q128 58 128 70 L128 170 L72 170 Z" ${S}/><rect x="80" y="100" width="40" height="42" ${S}/><path d="M92 128 q8 -18 16 0" ${S}/>`,
  pot: `<path d="M58 82 L142 82 L130 168 L70 168 Z" ${S}/><path d="M62 112 L138 112" ${S} stroke-dasharray="3 3"/>${[...Array(8)].map((_, i) => `<circle cx="${78 + i * 6}" cy="${162}" r="1.6" fill="${INK}"/>`).join('')}`,
  lamp: `<path d="M100 84 V160" ${S}/><path d="M62 62 L138 62 L126 84 L74 84 Z" ${S}/>${[...Array(6)].map((_, i) => `<path d="M${78 + i * 9} 90 l-4 12" ${S} opacity=".5"/>`).join('')}<path d="M74 160 H126 V172 H74 Z" ${S}/>`,
};

export function artFor(art, category = 'adapted', opts = {}) {
  const key = JSON.stringify([art, category, opts]);
  if (cache.has(key)) return cache.get(key);
  let out;
  if (category === 'care') {
    out = wrap(CARE_ICONS[opts.icon] || CARE_ICONS.bag, { caption: 'FIG. — ПРИНАДЛЕЖНОСТЬ' });
  } else if (category === 'microclone') {
    const a = { ...art, seed: (art?.seed || 1) + (opts.pack || 0) };
    const jars = opts.pack >= 10 ? 3 : opts.pack >= 5 ? 2 : 1;
    let inner = '';
    for (let j = 0; j < jars; j++) {
      const x = jars === 1 ? 100 : jars === 2 ? 70 + j * 60 : 48 + j * 52;
      const sc = jars === 1 ? 0.5 : 0.4;
      inner += `<rect x="${x - 22}" y="62" width="44" height="112" fill="#fbf8f1" stroke="${INK}" stroke-width="1.3"/><path d="M${x - 22} 150 H${x + 22} V174 H${x - 22} Z" fill="#ecdfb4" stroke="${INK}" stroke-width="1.3"/>`;
      for (let k = 0; k < 6; k++) inner += `<path d="M${x - 24} ${54 + k * 2} H${x + 24}" stroke="${INK}" stroke-width="0.8"/>`;
      const cid = `jar${a.seed}_${j}_${jars}`;
      inner += `<defs><clipPath id="${cid}"><rect x="${x - 21}" y="63" width="42" height="110"/></clipPath></defs><g clip-path="url(#${cid})">` + plant({ ...a, seed: a.seed + j }, { leaves: 3, scale: sc * 0.85, cx: x, cy: 152, rootsOn: false }).replace(/<rect[^>]*opacity="0.85"[^>]*\/>$/, '') + '</g>';
      inner += `<path d="M${x + 14} 70 V140" stroke="#fff" stroke-width="2" opacity=".7"/>`;
    }
    out = wrap(inner, { caption: `IN VITRO · ×${opts.pack || 1}` });
  } else {
    const leaves = category === 'seedling' ? 6 : opts.individual ? 5 : 4;
    const sc = opts.hero ? 1.0 : category === 'seedling' ? 0.82 : 0.72;
    const inner = plant(art || { shape: 'heart', hue: 140, varieg: 'none', seed: 1 }, { leaves, scale: sc, cx: 100, cy: opts.hero ? 140 : 128 });
    out = wrap(inner, { caption: opts.hero ? '' : opts.individual ? 'EXEMPLAR UNICUM' : category === 'seedling' ? 'EX VITRO · САЖЕНЕЦ' : 'EX VITRO · АДАПТИРОВАН' });
  }
  cache.set(key, out);
  return out;
}

export function photoOf(S_, v) {
  if (!v) return artFor(null, 'care', { icon: 'bag' });
  if (v.photo) return v.photo;
  const cv = S_.cultivars.find((c) => c.id === v.cultivarId);
  const art = cv?.art || { shape: 'heart', hue: 140 + ((cv?.id || 'x').charCodeAt(3) % 30), varieg: cv?.variegation ? 'splash' : 'none', seed: (cv?.id || 'CV-1').split('-')[1] * 1 || 1 };
  return artFor(art, v.category, { pack: v.packSize, icon: v.icon, individual: v.isIndividual });
}
