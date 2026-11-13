// Разбор лабораторного прайса XLSX: A — №, B — сорт, C — встроенное фото, D — кол-во в упаковке (текст), E — цена «2 200руб.»
// Фото сопоставляется со строкой по якорю объекта рисунка (xdr:from/xdr:row), а не по URL.
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { sha256Hex } from './util.js';

const NUM_WORDS = { один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, двенадцать: 12, пятнадцать: 15, двадцать: 20 };

export function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/ /g, ' ').replace(/руб\.?|р\.|₽|rub/gi, '').replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parsePack(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Math.floor(raw);
  const s = String(raw).toLowerCase();
  const m = s.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(s)) return n;
  if (/штук[аи]?$|^растение|^шт/.test(s.trim())) return 1;
  return null;
}

export function normalizeName(raw) {
  return String(raw || '')
    .replace(/[«»"“”„]/g, "'")
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
export const nameKey = (raw) => normalizeName(raw).toLowerCase().replace(/'/g, '').replace(/\s+/g, ' ').replace(/\bvar\.?\b|\bvariegat(a|ed)\b/g, 'var');

export function splitGenus(name) {
  const n = normalizeName(name);
  const m = n.match(/^([A-Z][a-z]+)\s+(.*)$/);
  return m ? { genus: m[1], cultivar: m[2] } : { genus: '', cultivar: n };
}

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}
function relsMap(xml) {
  const out = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) out[attr(m[0], 'Id')] = { target: attr(m[0], 'Target'), type: attr(m[0], 'Type') };
  return out;
}
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
}
const toB64 = (u8) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Возвращает { rowIndex(0-based) → dataURL } для первого листа */
export async function extractAnchoredImages(buf) {
  const zip = await JSZip.loadAsync(buf);
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  const wbRels = relsMap((await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) || '');
  const firstSheet = wb?.match(/<sheet\b[^>]*>/)?.[0];
  const rid = firstSheet && (attr(firstSheet, 'r:id') || attr(firstSheet, 'ns\\d*:id'));
  const sheetPath = rid && wbRels[rid] ? resolve('xl/workbook.xml', wbRels[rid].target) : 'xl/worksheets/sheet1.xml';
  const sheetRelsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const sheetRels = relsMap((await zip.file(sheetRelsPath)?.async('string')) || '');
  const out = {};
  for (const r of Object.values(sheetRels)) {
    if (!/\/drawing$/.test(r.type || '')) continue;
    const drawingPath = resolve(sheetPath, r.target);
    const dxml = (await zip.file(drawingPath)?.async('string')) || '';
    const dRels = relsMap((await zip.file(drawingPath.replace(/([^/]+)$/, '_rels/$1.rels'))?.async('string')) || '');
    // префикс пространства имён может быть любым (xdr:, без префикса и т.д.)
    const anchors = dxml.match(/<((?:\w+:)?)(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/\1\2>/g) || [];
    for (const a of anchors) {
      const from = a.match(/<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1];
      if (!from) continue;
      const row = parseInt(from.match(/<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/)?.[1], 10);
      const col = parseInt(from.match(/<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>/)?.[1], 10);
      const embed = a.match(/r:embed="([^"]+)"/)?.[1];
      if (!embed || !dRels[embed]) continue;
      const mediaPath = resolve(drawingPath, dRels[embed].target);
      const file = zip.file(mediaPath);
      if (!file) continue;
      const u8 = await file.async('uint8array');
      const ext = mediaPath.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      if (out[row]) out[row].extra = (out[row].extra || 0) + 1;
      else out[row] = { dataUrl: `data:${mime};base64,${toB64(u8)}`, col, media: mediaPath };
    }
  }
  return out;
}

/** Полный разбор файла в строки с предупреждениями */
export async function parsePriceList(buf) {
  const checksum = await sha256Hex(buf);
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const images = await extractAnchoredImages(buf);
  const out = [];
  rows.forEach((r, i) => {
    const [no, name, , packRaw, priceRaw] = r;
    if (!String(name || '').trim()) return;
    if (i === 0 && !parsePrice(priceRaw) && /сорт|наимен|назв/i.test(String(name))) return; // заголовок
    const nm = normalizeName(name);
    const { genus, cultivar } = splitGenus(nm);
    const warnings = [];
    const price = parsePrice(priceRaw);
    const packSize = parsePack(packRaw);
    const img = images[i];
    if (!img) warnings.push('нет фото');
    if (img?.extra) warnings.push(`в строке ${img.extra + 1} фото — взято первое`);
    if (!price) warnings.push('нет цены');
    if (!packSize) warnings.push('не распознано количество в упаковке');
    out.push({ rowNo: i + 1, no, rawName: String(name), name: nm, genus, cultivar, cultivarKey: nameKey(nm), packRaw: String(packRaw), packSize, priceRaw: String(priceRaw), price, photo: img?.dataUrl || null, variegated: /var|вариег|albo|aurea|mint|marble|princess|constellation|mojito/i.test(nm), warnings });
  });
  return { checksum, rows: out, sheet: wb.SheetNames[0] };
}

/** Предпросмотр: новый / обновление / пропуск / конфликт / дубликат */
export function previewPriceList(S, parsed, supplierId) {
  const seen = {};
  const already = S.priceLists.find((p) => p.checksum === parsed.checksum && p.supplierId === supplierId);
  const rows = parsed.rows.map((r) => {
    const key = `${r.cultivarKey}|${r.packSize}`;
    if (!r.price || !r.packSize) return { ...r, action: 'skip', reason: 'нет цены или упаковки — исправьте файл' };
    if (seen[key]) return { ...r, action: 'duplicate', reason: `повтор строки ${seen[key]}` };
    seen[key] = r.rowNo;
    const cvs = S.cultivars.filter((c) => c.key === r.cultivarKey || (c.synonyms || []).some((s) => nameKey(s) === r.cultivarKey));
    if (cvs.length > 1) return { ...r, action: 'conflict', reason: 'несколько сортов с таким названием — выберите вручную', candidates: cvs.map((c) => c.id) };
    const cv = cvs[0];
    const matches = cv ? S.variants.filter((v) => v.cultivarId === cv.id && v.category === 'microclone' && v.packSize === r.packSize && !v.isIndividual) : [];
    if (matches.length > 1) return { ...r, action: 'conflict', reason: 'несколько SKU с такой упаковкой', candidates: matches.map((v) => v.sku) };
    if (matches.length === 1) {
      const v = matches[0];
      if (v.purchasePrice === r.price && (v.photo || !r.photo)) return { ...r, action: 'skip', sku: v.sku, reason: 'без изменений' };
      return { ...r, action: 'update', sku: v.sku, oldPrice: v.purchasePrice, reason: v.purchasePrice !== r.price ? `закупка ${v.purchasePrice ?? '—'} → ${r.price}` : 'добавлено фото' };
    }
    return { ...r, action: 'new', reason: cv ? 'новая упаковка существующего сорта' : 'новый сорт' };
  });
  const counts = rows.reduce((a, r) => ((a[r.action] = (a[r.action] || 0) + 1), a), {});
  return { rows, counts, alreadyImported: already || null };
}
