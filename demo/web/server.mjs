#!/usr/bin/env node
// =============================================================================
// server.mjs — Backend del dashboard web FlowPedidos
// -----------------------------------------------------------------------------
// Servidor HTTP liviano (sin frameworks) que:
//   - Sirve el dashboard (public/index.html)
//   - Ejecuta el pipeline REAL contra Postgres + mock + OpenAI
//   - Expone API para que el dashboard procese pedidos y consulte estado
//
// Endpoints:
//   GET  /                  → dashboard
//   GET  /api/state         → contadores + pedidos + mensajes
//   POST /api/process       → procesa el siguiente pedido de la secuencia
//   POST /api/reset         → limpia la base y reinicia la secuencia
//
// Uso:  node web/server.mjs   → http://localhost:4000
// =============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { processWebhook, getState } from '../lib/orchestrator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

process.loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.DEMO_PORT) || 4000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.TFI_APP_USER || 'tfi_app',
    password: process.env.TFI_APP_PASSWORD,
    max: 4,
});

// Pool con superuser solo para el reset (TRUNCATE)
const adminPool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
    max: 2,
});

// Secuencia curada: simula ventas llegando de distintos canales.
// Cuenta una historia de negocio:
//   1-3) ventas de 3 canales distintos → se unifican + el cliente recibe mensaje
//   4)   misma venta repetida → se evita cobrar dos veces
//   5)   un servicio falla → el cliente igual recibe respuesta (respaldo)
//   6)   notificación incompleta → se descarta
const SEQUENCE = [
    { wh: { resource: '/orders/3000000000000001', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, channel: 'mercadolibre', label: 'Venta en Mercado Libre' },
    { wh: { resource: '/orders/3000000000000003', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, channel: 'whatsapp', label: 'Venta por WhatsApp' },
    { wh: { resource: '/orders/3000000000000010', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, channel: 'woocommerce', label: 'Venta en Tienda Online' },
    { wh: { resource: '/orders/3000000000000001', topic: 'orders_v2', user_id: 123456789, attempts: 2 }, channel: 'mercadolibre', label: 'Misma venta repetida' },
    { wh: { resource: '/orders/3000000000000007', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, channel: 'tienda_nube', label: 'Venta con servicio caído', forceFallback: true },
    { wh: { topic: 'orders_v2', user_id: 123456789, attempts: 1 }, channel: 'mercadolibre', label: 'Notificación incompleta' },
];
let seqIndex = 0;

function json(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => resolve(b ? JSON.parse(b) : {}));
    });
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // --- Static: dashboard ---
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html);
        }

        // --- API: estado ---
        if (req.method === 'GET' && url.pathname === '/api/state') {
            const client = await pool.connect();
            try {
                const state = await getState(client);
                return json(res, 200, { ...state, seqIndex, seqTotal: SEQUENCE.length });
            } finally { client.release(); }
        }

        // --- API: procesar siguiente ---
        if (req.method === 'POST' && url.pathname === '/api/process') {
            if (seqIndex >= SEQUENCE.length) {
                return json(res, 200, { done: true, message: 'Secuencia completa' });
            }
            const item = SEQUENCE[seqIndex++];
            const client = await pool.connect();
            try {
                const result = await processWebhook(client, item.wh, {
                    apiKey: OPENAI_KEY,
                    channel: item.channel,
                    forceFallback: item.forceFallback === true,
                    useCache: true,
                });
                return json(res, 200, { label: item.label, ...result, seqIndex, seqTotal: SEQUENCE.length });
            } finally { client.release(); }
        }

        // --- API: reset ---
        if (req.method === 'POST' && url.pathname === '/api/reset') {
            const client = await adminPool.connect();
            try {
                await client.query('TRUNCATE tfi.audit_log, tfi.ai_notifications, tfi.order_items, tfi.orders, tfi.customers RESTART IDENTITY CASCADE');
                seqIndex = 0;
                return json(res, 200, { ok: true });
            } finally { client.release(); }
        }

        json(res, 404, { error: 'not found' });
    } catch (e) {
        console.error('Error:', e.message);
        json(res, 500, { error: e.message });
    }
});

server.listen(PORT, () => {
    console.log(`\n  FlowPedidos dashboard → http://localhost:${PORT}\n`);
    console.log(`  Postgres: puerto ${process.env.PG_HOST_PORT || 5433}`);
    console.log(`  OpenAI:   ${OPENAI_KEY ? 'configurado' : 'FALTA KEY'}`);
    console.log(`\n  Ctrl+C para detener.\n`);
});
