#!/usr/bin/env node
// =============================================================================
// export-dashboard-data.mjs · alimenta el tablero operativo del pipeline
// -----------------------------------------------------------------------------
// Consulta la vista tfi.v_order_summary y la tabla tfi.ai_notifications, y
// escribe dashboard-data.json junto al index.html del tablero. El tablero lo
// levanta por fetch al abrirse; si el archivo no existe, cae a los datos
// embebidos de la corrida definitiva ampliada.
//
// Uso:
//   node export-dashboard-data.mjs                 # todos los pedidos
//   node export-dashboard-data.mjs --dataset       # solo el dataset sintético
//                                                  # (external_id de 16 dígitos)
//
// Requiere las mismas variables de entorno que el resto de los scripts (.env
// en la raíz del repo).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
try { process.loadEnvFile(path.join(REPO, '.env')); } catch { /* noop */ }

const soloDataset = process.argv.includes('--dataset');
const FILTRO = soloDataset ? `WHERE o.external_id ~ '^[0-9]{16}$'` : '';

const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

const ORDEN_ESTADOS = ['paid', 'shipped', 'delivered', 'pending_payment', 'cancelled', 'refunded', 'error'];
const BIN_MS = 100;

function percentilLineal(ordenados, p) {
    const n = ordenados.length;
    if (!n) return null;
    const k = (n - 1) * p;
    const f = Math.floor(k);
    const c = Math.min(f + 1, n - 1);
    return ordenados[f] + (k - f) * (ordenados[c] - ordenados[f]);
}

async function main() {
    const { rows: estados } = await pool.query(`
        SELECT o.status AS estado,
               count(*) FILTER (WHERE o.channel = 'mercadolibre') AS ml,
               count(*) FILTER (WHERE o.channel = 'woocommerce')  AS wc
        FROM tfi.v_order_summary o
        ${FILTRO}
        GROUP BY o.status
    `);

    const { rows: latencias } = await pool.query(`
        SELECT EXTRACT(EPOCH FROM (n.dispatched_at - o.received_at)) * 1000 AS e2e_ms
        FROM tfi.ai_notifications n
        JOIN tfi.orders o ON o.id = n.order_id
        ${FILTRO ? FILTRO + ' AND' : 'WHERE'} n.dispatched_at IS NOT NULL
        ORDER BY 1
    `);

    const { rows: [kpi] } = await pool.query(`
        SELECT count(*)                                             AS mensajes,
               count(*) FILTER (WHERE n.is_fallback)                 AS fallback,
               coalesce(sum(n.cost_usd), 0)                          AS costo_total_usd
        FROM tfi.ai_notifications n
        JOIN tfi.orders o ON o.id = n.order_id
        ${FILTRO}
    `);

    const { rows: [tot] } = await pool.query(`
        SELECT count(*) AS persistidos FROM tfi.v_order_summary o ${FILTRO}
    `);

    const e2e = latencias.map(r => Math.round(Number(r.e2e_ms))).sort((a, b) => a - b);
    const lo = Math.floor(Math.min(...e2e) / BIN_MS) * BIN_MS;
    const hi = Math.ceil(Math.max(...e2e) / BIN_MS) * BIN_MS;
    const bins = [];
    for (let from = lo; from < hi; from += BIN_MS) {
        bins.push({ from, to: from + BIN_MS, count: e2e.filter(v => v >= from && v < from + BIN_MS).length });
    }

    const porEstado = Object.fromEntries(estados.map(r => [r.estado, r]));
    const data = {
        meta: {
            corrida: soloDataset ? 'dataset sintético (seed=42)' : 'todos los pedidos persistidos',
            fuente: 'tfi.v_order_summary + tfi.ai_notifications',
            n_webhooks: Number(tot.persistidos),
            generado_en: new Date().toISOString(),
        },
        estados: ORDEN_ESTADOS
            .filter(s => porEstado[s])
            .map(s => ({ estado: s, ml: Number(porEstado[s].ml), wc: Number(porEstado[s].wc) })),
        latencia: {
            n: e2e.length,
            mediana: Math.round(percentilLineal(e2e, 0.5)),
            p90: Math.round(percentilLineal(e2e, 0.9)),
            p95: Math.round(percentilLineal(e2e, 0.95)),
            min: e2e[0],
            max: e2e[e2e.length - 1],
            media: Number((e2e.reduce((a, b) => a + b, 0) / e2e.length).toFixed(1)),
            bins,
        },
        kpi: {
            persistidos: Number(tot.persistidos),
            mensajes: Number(kpi.mensajes),
            fallback: Number(kpi.fallback),
            validador_primer_intento: Number(kpi.mensajes) - Number(kpi.fallback),
            ack_max_ms: 0,
            costo_total_usd: Number(Number(kpi.costo_total_usd).toFixed(6)),
        },
    };

    const destino = path.join(__dirname, 'dashboard-data.json');
    fs.writeFileSync(destino, JSON.stringify(data, null, 1), 'utf8');
    console.log(`Escrito ${destino}`);
    console.log(`  pedidos persistidos : ${data.kpi.persistidos}`);
    console.log(`  mensajes generados  : ${data.kpi.mensajes} (fallback: ${data.kpi.fallback})`);
    console.log(`  mediana end-to-end  : ${data.latencia.mediana} ms (n=${data.latencia.n})`);
}

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
