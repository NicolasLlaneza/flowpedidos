#!/usr/bin/env node
// =============================================================================
// server.mjs — Backend del panel operativo FlowPedidos (MVP)
// -----------------------------------------------------------------------------
// Sirve el panel y expone la API de operación sobre el pipeline real.
//
// Endpoints:
//   GET  /                    → panel (index.html)
//   GET  /app.js              → JS del panel
//   GET  /api/kpis            → métricas
//   GET  /api/orders          → listado filtrable (?channel=&status=&q=)
//   GET  /api/orders/:id      → detalle con trazabilidad
//   POST /api/seed            → ingesta el dataset (pipeline real, cachea IA)
//   POST /api/reset           → limpia la base
//
// Uso:  node web/server.mjs   → http://localhost:4000
// =============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { processWebhook, getKpis, getOrders, getOrderDetail, seedList } from '../lib/orchestrator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
process.loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.DEMO_PORT) || 4000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PGPORT = Number(process.env.PG_HOST_PORT) || 5433;

const pool = new pg.Pool({
    host: 'localhost', port: PGPORT, database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.TFI_APP_USER || 'tfi_app', password: process.env.TFI_APP_PASSWORD, max: 4,
});
const adminPool = new pg.Pool({
    host: 'localhost', port: PGPORT, database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n', password: process.env.POSTGRES_PASSWORD, max: 2,
});

let seeding = false;

function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
}
function file(res, fp, ct) {
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(fs.readFileSync(fp));
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const p = url.pathname;

        if (req.method === 'GET' && (p === '/' || p === '/index.html'))
            return file(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
        if (req.method === 'GET' && p === '/app.js')
            return file(res, path.join(__dirname, 'public', 'app.js'), 'application/javascript; charset=utf-8');
        // Estáticos .html adicionales (ej: whatsapp-mock.html)
        if (req.method === 'GET' && /^\/[a-z0-9_-]+\.html$/i.test(p)) {
            const fp = path.join(__dirname, 'public', p.slice(1));
            if (fs.existsSync(fp)) return file(res, fp, 'text/html; charset=utf-8');
        }

        if (req.method === 'GET' && p === '/api/kpis') {
            const c = await pool.connect();
            try { return json(res, 200, await getKpis(c)); } finally { c.release(); }
        }

        if (req.method === 'GET' && p === '/api/orders') {
            const c = await pool.connect();
            try {
                const rows = await getOrders(c, {
                    channel: url.searchParams.get('channel') || undefined,
                    status: url.searchParams.get('status') || undefined,
                    q: url.searchParams.get('q') || undefined,
                });
                return json(res, 200, { orders: rows });
            } finally { c.release(); }
        }

        if (req.method === 'GET' && p.startsWith('/api/orders/')) {
            const id = decodeURIComponent(p.split('/').pop());
            const c = await pool.connect();
            try {
                const d = await getOrderDetail(c, id);
                return d ? json(res, 200, d) : json(res, 404, { error: 'no encontrado' });
            } finally { c.release(); }
        }

        if (req.method === 'POST' && p === '/api/seed') {
            if (seeding) return json(res, 409, { error: 'seed en progreso' });
            seeding = true;
            const c = await pool.connect();
            try {
                const list = seedList();
                let ok = 0;
                for (const item of list) {
                    const wh = { resource: `/orders/${item.id}`, topic: 'orders_v2', user_id: 123456789, attempts: 1 };
                    try {
                        const r = await processWebhook(c, wh, { apiKey: OPENAI_KEY, channel: item.channel, useCache: true });
                        if (r.result === 'processed') ok++;
                    } catch { /* sigue con el resto */ }
                }
                return json(res, 200, { seeded: ok, total: list.length });
            } finally { c.release(); seeding = false; }
        }

        if (req.method === 'POST' && p === '/api/reset') {
            const c = await adminPool.connect();
            try {
                await c.query('TRUNCATE tfi.audit_log, tfi.ai_notifications, tfi.order_items, tfi.orders, tfi.customers RESTART IDENTITY CASCADE');
                return json(res, 200, { ok: true });
            } finally { c.release(); }
        }

        json(res, 404, { error: 'not found' });
    } catch (e) {
        console.error('Error:', e.message);
        json(res, 500, { error: e.message });
    }
});

server.listen(PORT, () => {
    console.log(`\n  FlowPedidos · panel operativo → http://localhost:${PORT}`);
    console.log(`  Postgres puerto ${PGPORT} · OpenAI ${OPENAI_KEY ? 'configurado' : 'FALTA'}\n`);
});
