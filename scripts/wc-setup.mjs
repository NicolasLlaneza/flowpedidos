#!/usr/bin/env node
// =============================================================================
// wc-setup.mjs · Bloque C-WC
// -----------------------------------------------------------------------------
// Deja WooCommerce listo para la corrida definitiva, de forma idempotente:
//   1. Verifica que exista un webhook activo apuntando a n8n con
//      topic=order.updated y el secret de .env. Si falta lo crea.
//   2. Crea (o actualiza) un producto simple PIR-P7-TEST de 85.000 ARS
//      con stock, listo para el checkout del script simulate-checkout.
//
// Uso:
//   node scripts/wc-setup.mjs
//
// Requiere en .env:
//   WC_CONSUMER_KEY, WC_CONSUMER_SECRET, WC_WEBHOOK_SECRET, WP_HOST_PORT
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const WP_PORT = process.env.WP_HOST_PORT || '8080';
const WC_URL  = `http://localhost:${WP_PORT}`;
const N8N_INTERNAL_URL = 'http://n8n:5678/webhook/wc-order';

const KEY    = process.env.WC_CONSUMER_KEY;
const SECRET = process.env.WC_CONSUMER_SECRET;
const HOOK_SECRET = process.env.WC_WEBHOOK_SECRET;

if (!KEY || !SECRET) {
    console.error('Faltan WC_CONSUMER_KEY o WC_CONSUMER_SECRET en .env');
    console.error('Ver scripts/README.md Paso 2 (crear REST API key)');
    process.exit(1);
}
if (!HOOK_SECRET) {
    console.error('Falta WC_WEBHOOK_SECRET en .env');
    process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

async function api(method, path, body) {
    const url = `${WC_URL}/wp-json/wc/v3${path}`;
    const opts = {
        method,
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) {
        console.error(`WC API ${method} ${path} → ${r.status}`);
        console.error(typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400));
        throw new Error(`http ${r.status}`);
    }
    return data;
}

// -----------------------------------------------------------------------------
// 1. Webhook
// -----------------------------------------------------------------------------
async function ensureWebhook() {
    const existing = await api('GET', '/webhooks?per_page=50');
    const match = existing.find(w =>
        w.topic === 'order.updated' &&
        w.delivery_url === N8N_INTERNAL_URL
    );
    if (match) {
        console.log(`webhook ok · id=${match.id} status=${match.status}`);
        if (match.status !== 'active') {
            await api('PUT', `/webhooks/${match.id}`, { status: 'active' });
            console.log('  → re-activado');
        }
        return match;
    }
    console.log('creando webhook order.updated → n8n');
    const created = await api('POST', '/webhooks', {
        name: 'flowpedidos-tfi',
        topic: 'order.updated',
        delivery_url: N8N_INTERNAL_URL,
        secret: HOOK_SECRET,
        status: 'active',
    });
    console.log(`  → creado id=${created.id}`);
    return created;
}

// -----------------------------------------------------------------------------
// 2. Producto de prueba
// -----------------------------------------------------------------------------
const TEST_PRODUCT = {
    name: 'Neumático Pirelli P7 205/55 R16 · TEST',
    type: 'simple',
    regular_price: '85000',
    sku: 'PIR-P7-TEST',
    description: 'Producto simulado para la corrida definitiva del pipeline TFI.',
    short_description: 'Test product · pipeline TFI',
    manage_stock: true,
    stock_quantity: 999,
    status: 'publish',
    catalog_visibility: 'visible',
    virtual: false,
    downloadable: false,
};

async function ensureProduct() {
    const existing = await api('GET', `/products?sku=${TEST_PRODUCT.sku}`);
    if (existing.length > 0) {
        const p = existing[0];
        console.log(`producto ok · id=${p.id} sku=${p.sku} price=${p.price} stock=${p.stock_quantity}`);
        const needsUpdate = p.regular_price !== TEST_PRODUCT.regular_price
            || Number(p.stock_quantity) < 100;
        if (needsUpdate) {
            await api('PUT', `/products/${p.id}`, {
                regular_price: TEST_PRODUCT.regular_price,
                stock_quantity: TEST_PRODUCT.stock_quantity,
            });
            console.log('  → actualizado precio/stock');
        }
        return p;
    }
    console.log('creando producto de prueba');
    const created = await api('POST', '/products', TEST_PRODUCT);
    console.log(`  → creado id=${created.id} sku=${created.sku}`);
    return created;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
    console.log(`WC endpoint: ${WC_URL}`);
    console.log(`webhook target (interno docker): ${N8N_INTERNAL_URL}\n`);

    const hook = await ensureWebhook();
    const product = await ensureProduct();

    console.log('\nlisto · ejecutar para simular un pedido real:');
    console.log(`  node scripts/wc-simulate-checkout.mjs --product ${product.id} --status processing`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
