#!/usr/bin/env node
// =============================================================================
// verify-end-to-end.mjs · Bloque C — verificación de la corrida definitiva
// -----------------------------------------------------------------------------
// Imprime, sobre las últimas N corridas del pipeline, las métricas que la
// tesis reporta: latencia ACK, latencia end-to-end, uso del validador,
// distribución de proveedor y fallback, costo real por mensaje.
//
// Uso:
//   node scripts/verify-end-to-end.mjs               # N=10, ambos canales
//   node scripts/verify-end-to-end.mjs --n 30
//   node scripts/verify-end-to-end.mjs --channel woocommerce
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(__dirname, '..', '.env'));

function parseArgs(argv) {
    const a = { n: 10 };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--n') a.n = Number(argv[++i]);
        else if (argv[i] === '--channel') a.channel = argv[++i];
    }
    return a;
}
const ARGS = parseArgs(process.argv);

const pg = await import('pg');
const c = new pg.default.Client({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});
await c.connect();

const where = ARGS.channel ? `WHERE o.channel = '${ARGS.channel}'` : '';

const rows = (await c.query(`
    SELECT
      o.external_id,
      o.channel,
      o.status,
      o.received_at,
      o.ack_at,
      ROUND(EXTRACT(EPOCH FROM (o.ack_at - o.received_at)) * 1000) AS ack_ms,
      n.provider, n.is_fallback,
      n.prompt_tokens, n.completion_tokens,
      n.cost_usd::text AS cost_usd,
      n.validator_passes,
      jsonb_array_length(COALESCE(n.validator_failures, '[]'::jsonb)) AS n_failures,
      n.message_status,
      n.sent_at,
      n.dispatched_at,
      ROUND(EXTRACT(EPOCH FROM (n.dispatched_at - o.received_at)) * 1000) AS e2e_ms,
      re.processed_at IS NOT NULL AS raw_event_closed
    FROM tfi.orders o
    LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
    LEFT JOIN LATERAL (
        SELECT re.* FROM tfi.raw_events re
         WHERE re.channel = o.channel
         ORDER BY re.received_at DESC
         LIMIT 1
    ) re ON true
    ${where}
    ORDER BY o.received_at DESC
    LIMIT $1
`, [ARGS.n])).rows;

if (rows.length === 0) {
    console.log('no hay corridas registradas todavía');
    await c.end();
    process.exit(0);
}

console.log(`\núltimas ${rows.length} corridas${ARGS.channel ? ` (canal ${ARGS.channel})` : ''}\n`);
console.table(rows.map(r => ({
    order: r.external_id,
    channel: r.channel,
    status: r.status,
    ack_ms: r.ack_ms,
    e2e_ms: r.e2e_ms,
    provider: r.provider,
    tokens: r.prompt_tokens || r.completion_tokens ? `${r.prompt_tokens || 0}/${r.completion_tokens || 0}` : '-',
    cost: r.cost_usd || '-',
    passes: r.validator_passes,
    fails: r.n_failures,
    is_fb: r.is_fallback,
    msg: r.message_status,
    dispatched: r.dispatched_at ? 'yes' : 'no',
    raw_ev_closed: r.raw_event_closed,
})));

// Agregados
const withCost = rows.filter(r => r.cost_usd && Number(r.cost_usd) > 0);
const withE2E  = rows.filter(r => r.e2e_ms != null);
const okAck    = rows.filter(r => r.ack_ms != null && r.ack_ms < 500);

console.log('agregados:');
console.log(`  ACK < 500 ms: ${okAck.length}/${rows.length}`);
console.log(`  con e2e medido: ${withE2E.length} (mediana ${withE2E.length ? withE2E.map(r=>r.e2e_ms).sort((a,b)=>a-b)[Math.floor(withE2E.length/2)] : '-'} ms)`);
console.log(`  con cost_usd > 0: ${withCost.length} (total ${withCost.reduce((s,r)=>s+Number(r.cost_usd),0).toFixed(6)} USD)`);
console.log(`  fallback: ${rows.filter(r=>r.is_fallback).length}/${rows.length}`);
console.log(`  canal ml: ${rows.filter(r=>r.channel==='mercadolibre').length}, wc: ${rows.filter(r=>r.channel==='woocommerce').length}`);

await c.end();
