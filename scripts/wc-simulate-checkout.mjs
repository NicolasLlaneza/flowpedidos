#!/usr/bin/env node
// =============================================================================
// wc-simulate-checkout.mjs · Bloque C-WC
// -----------------------------------------------------------------------------
// Crea un pedido real en WooCommerce vía REST API. WooCommerce dispara el
// webhook `order.updated` → n8n / webhook / wc-order → pipeline completo.
//
// Uso:
//   node scripts/wc-simulate-checkout.mjs
//   node scripts/wc-simulate-checkout.mjs --status processing
//   node scripts/wc-simulate-checkout.mjs --product 42 --status cancelled
//
// Argumentos:
//   --product <id>   product_id de línea (por defecto: busca SKU PIR-P7-TEST)
//   --status <s>     pending | on-hold | processing | completed | cancelled | refunded | failed
//   --phone <phone>  teléfono del billing (default: +542613075850)
//   --name <first>   nombre del cliente (default: Test)
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(__dirname, '..', '.env'));

function parseArgs(argv) {
    const args = { status: 'processing', phone: '+542613075850', name: 'Test' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--product') args.product = Number(argv[++i]);
        else if (a === '--status')  args.status  = argv[++i];
        else if (a === '--phone')   args.phone   = argv[++i];
        else if (a === '--name')    args.name    = argv[++i];
    }
    return args;
}
const ARGS = parseArgs(process.argv);

const WP_PORT = process.env.WP_HOST_PORT || '8080';
const WC_URL  = `http://localhost:${WP_PORT}`;
const KEY    = process.env.WC_CONSUMER_KEY;
const SECRET = process.env.WC_CONSUMER_SECRET;
if (!KEY || !SECRET) { console.error('Faltan WC_CONSUMER_KEY o WC_CONSUMER_SECRET'); process.exit(1); }

const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

async function api(method, p, body) {
    const r = await fetch(`${WC_URL}/wp-json/wc/v3${p}`, {
        method,
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = t; }
    if (!r.ok) throw new Error(`WC ${method} ${p} ${r.status}: ${JSON.stringify(d).slice(0,300)}`);
    return d;
}

async function findProduct() {
    if (ARGS.product) return { id: ARGS.product };
    const list = await api('GET', '/products?sku=PIR-P7-TEST');
    if (list.length === 0) {
        console.error('No hay producto PIR-P7-TEST. Correr `node scripts/wc-setup.mjs` primero.');
        process.exit(1);
    }
    return list[0];
}

async function main() {
    const product = await findProduct();

    // Suffix random para nombre y ID de compra (evita colisión con historia previa)
    const suffix = Date.now().toString(36).slice(-5);
    const order = {
        status: ARGS.status,
        set_paid: ['processing','completed'].includes(ARGS.status),
        currency: 'ARS',
        billing: {
            first_name: ARGS.name,
            last_name:  `Buyer-${suffix}`,
            address_1:  'Av. San Martín 1000',
            city:       'Mendoza',
            state:      'Mendoza',
            postcode:   'M5500',
            country:    'AR',
            email:      `test-${suffix}@example.com`,
            phone:      ARGS.phone,
        },
        shipping: {
            first_name: ARGS.name,
            last_name:  `Buyer-${suffix}`,
            address_1:  'Av. San Martín 1000',
            city:       'Mendoza',
            state:      'Mendoza',
            postcode:   'M5500',
            country:    'AR',
        },
        line_items: [ { product_id: product.id, quantity: 1 } ],
    };

    console.log(`POST /orders · status=${order.status} · buyer=${order.billing.first_name} ${order.billing.last_name}`);
    const t0 = Date.now();
    const created = await api('POST', '/orders', order);
    console.log(`created id=${created.id} total=${created.total} status=${created.status} · ${Date.now()-t0}ms`);
    console.log('WooCommerce dispara el webhook order.updated a n8n en los siguientes segundos.');
    console.log('Verificar con:  psql tfi -c "SELECT external_id,channel,status FROM tfi.orders ORDER BY received_at DESC LIMIT 3"');
}

main().catch(err => { console.error(err.message); process.exit(1); });
