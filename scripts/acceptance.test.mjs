// Запуск приёмочных сценариев в Node: npm test
import { runScenarios } from '../src/engine/scenarios.js';
import { buildSeed } from '../src/engine/seed.js';
import { parsePriceList, previewPriceList } from '../src/engine/pricelist.js';
import { readFileSync, existsSync } from 'node:fs';

let failed = 0;
for (const r of runScenarios()) {
  console.log(`${r.pass ? '✔' : '✘'} ${r.id} ${r.title}`);
  for (const c of r.checks) if (!c.ok || !r.pass) console.log(`    ${c.ok ? '·' : '✘'} ${c.text}`);
  if (!r.pass) failed++;
}

const S = buildSeed(Date.UTC(2026, 10, 13, 10));
console.log(`seed: ${S.variants.length} SKU, ${S.orders.length} заказов, ${S.lots.length} партий, ${S.audit.length} записей аудита`);

for (const f of ['public/samples/alfa_price_okt.xlsx', 'public/samples/alfa_price_nov.xlsx']) {
  if (!existsSync(f)) continue;
  const buf = readFileSync(f);
  const parsed = await parsePriceList(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const pv = previewPriceList(S, parsed, 'LAB-1');
  const photos = parsed.rows.filter((r) => r.photo).length;
  console.log(`${f}: строк ${parsed.rows.length}, фото ${photos}, ${JSON.stringify(pv.counts)}`);
  for (const r of parsed.rows.slice(0, 40)) console.log(`   r${r.rowNo} ${r.name} | pack ${r.packSize} | ${r.price} | photo:${r.photo ? r.photo.length : 0} ${r.warnings.join('; ')}`);
}

if (failed) { console.error(`\n${failed} сценариев не прошли`); process.exit(1); }
console.log('\nВсе сценарии пройдены');
