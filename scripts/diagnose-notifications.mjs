#!/usr/bin/env node
// =============================================================================
// diagnose-notifications.mjs · diagnóstico rápido de tfi.ai_notifications
// -----------------------------------------------------------------------------
// Muestra, para cada patrón reconocible de external_id, cuántas notificaciones
// reales del LLM hay y con qué estados — para distinguir la corrida definitiva
// ampliada (external_id sintético del dataset, típicamente 3000000000000XXX)
// de otras corridas o pruebas manuales (ids de WooCommerce reales, más cortos).
//
// Uso:
//   node diagnose-notifications.mjs
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(REPO, '.env')); } catch { /* noop */ }

const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

async function main() {
    const r = await pool.query(`
        SELECT
            o.external_id,
            o.channel,
            o.status,
            n.generated_at,
            length(o.external_id) AS ext_len,
            (o.external_id ~ '^[0-9]{16}$') AS looks_synthetic
        FROM tfi.ai_notifications n
        JOIN tfi.orders o ON o.id = n.order_id
        WHERE n.provider = 'openai' AND n.is_fallback = false
        ORDER BY n.generated_at
    `);

    console.log(`Total notificaciones reales del LLM: ${r.rows.length}\n`);

    const groups = { synthetic: [], other: [] };
    for (const row of r.rows) {
        (row.looks_synthetic ? groups.synthetic : groups.other).push(row);
    }

    for (const [label, rows] of Object.entries(groups)) {
        console.log(`--- ${label} (${rows.length}) ---`);
        const byStatus = {};
        for (const row of rows) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
        console.log('  por estado:', byStatus);
        if (rows.length) {
            console.log('  rango de fechas:', rows[0].generated_at, '->', rows[rows.length - 1].generated_at);
            console.log('  ejemplo external_id:', rows[0].external_id, `(len=${rows[0].ext_len})`);
        }
        console.log();
    }

    await pool.end();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
