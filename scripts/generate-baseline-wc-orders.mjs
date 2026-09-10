#!/usr/bin/env node
// =============================================================================
// generate-baseline-wc-orders.mjs · Baseline manual §3.6
// -----------------------------------------------------------------------------
// Crea 10 pedidos reales en WooCommerce con mix de estados para el instrumento
// de cronometrado de la línea base manual. Distribuye los pedidos sobre los
// productos publicados (round-robin) y varía el estado según la distribución:
//
//   2 × pending      → pending_payment
//   3 × processing   → paid
//   3 × completed    → delivered
//   1 × cancelled    → cancelled
//   1 × refunded     → refunded
//
// Uso:
//   node scripts/generate-baseline-wc-orders.mjs
//   node scripts/generate-baseline-wc-orders.mjs --phones "+5492613075850,+5491199887766,+5493511223344,+5494455667788"
//   node scripts/generate-baseline-wc-orders.mjs --delay-ms 5000       # más rápido si estás en simulate
//
// Delay entre pedidos: default 20000ms (20s). Con 10 pedidos y 4 números en
// modo live, cada número recibe ~2-3 mensajes en ~3.5 min total → lejos del
// umbral de spam de Meta. En simulate podés bajar el delay a 500ms sin riesgo.
//
// Salida: out/baseline-wc-orders.json — lista de {id, wc_status, thesis_status,
// product_id, product_name, total, phone} lista para usar en el artifact.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));

// Pool de teléfonos (round-robin) para probar que el workflow no está hardcoded
// a un único número. Con WHATSAPP_MODE=simulate no salen mensajes reales.
const PHONES_ARG = process.argv.indexOf('--phones');
const PHONES = PHONES_ARG > -1
    ? process.argv[PHONES_ARG + 1].split(',').map(s => s.trim())
    : ['+542613075850', '+5491199887766', '+5493511223344', '+5494455667788'];

const DELAY_ARG = process.argv.indexOf('--delay-ms');
const DELAY_MS  = DELAY_ARG > -1 ? Number(process.argv[DELAY_ARG + 1]) : 20000;

const WP_PORT = process.env.WP_HOST_PORT || '8080';
const WC_URL  = `http://localhost:${WP_PORT}`;
const KEY     = process.env.WC_CONSUMER_KEY;
const SECRET  = process.env.WC_CONSUMER_SECRET;
if (!KEY || !SECRET) {
    console.error('Faltan WC_CONSUMER_KEY / WC_CONSUMER_SECRET en .env');
    process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

async function api(method, p, body) {
    // Usamos ?rest_route= en vez de /wp-json/ para que funcione con permalinks
    // en modo "Plain" (default de WP). Ambas formas son válidas en la REST API
    // de WordPress; la query-string es más portable.
    const [routePath, queryString] = p.split('?');
    const restRoute = `/wc/v3${routePath}`;
    const url = `${WC_URL}/?rest_route=${encodeURIComponent(restRoute)}${queryString ? '&' + queryString : ''}`;
    const r = await fetch(url, {
        method,
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = t; }
    if (!r.ok) throw new Error(`WC ${method} ${p} ${r.status}: ${JSON.stringify(d).slice(0,300)}`);
    return d;
}

// distribución de estados: (WC status, thesis status)
const DISTRIBUTION = [
    ['pending',    'pending_payment'],
    ['pending',    'pending_payment'],
    ['processing', 'paid'],
    ['processing', 'paid'],
    ['processing', 'paid'],
    ['completed',  'delivered'],
    ['completed',  'delivered'],
    ['completed',  'delivered'],
    ['cancelled',  'cancelled'],
    ['refunded',   'refunded'],
];

async function main() {
    console.log('1. Buscando productos publicados en WC...');
    const products = await api('GET', '/products?status=publish&per_page=20');
    if (products.length === 0) {
        console.error('No hay productos publicados. Publicá al menos 1 producto en /wp-admin/ antes de correr esto.');
        process.exit(1);
    }
    console.log(`   → ${products.length} productos encontrados:`);
    products.forEach(p => console.log(`     [${p.id}] ${p.name} · $${p.price}`));

    console.log(`\n   Pool de teléfonos (round-robin): ${PHONES.length} números`);
    PHONES.forEach((p, i) => console.log(`     [${i+1}] ${p}`));
    const whatsappMode = process.env.WHATSAPP_MODE || '(no seteado — n8n usa default)';
    console.log(`   WHATSAPP_MODE en .env: ${whatsappMode}`);
    console.log(`   Delay entre pedidos: ${DELAY_MS}ms (total estimado: ~${(DISTRIBUTION.length * DELAY_MS / 1000).toFixed(0)}s)`);

    console.log(`\n2. Creando ${DISTRIBUTION.length} pedidos con mix de estados...`);
    const created = [];

    for (let i = 0; i < DISTRIBUTION.length; i++) {
        const [wcStatus, thesisStatus] = DISTRIBUTION[i];
        const product = products[i % products.length]; // round-robin producto
        const phone   = PHONES[i % PHONES.length];      // round-robin teléfono
        const suffix  = Date.now().toString(36).slice(-5) + '-' + i;

        const order = {
            status: wcStatus,
            set_paid: ['processing','completed'].includes(wcStatus),
            currency: 'ARS',
            billing: {
                first_name: 'Cliente',
                last_name:  `Baseline-${(i+1).toString().padStart(2,'0')}`,
                address_1:  'Av. San Martín 1000',
                city:       'Mendoza',
                state:      'Mendoza',
                postcode:   'M5500',
                country:    'AR',
                email:      `baseline-${suffix}@example.com`,
                phone:      phone,
            },
            shipping: {
                first_name: 'Cliente',
                last_name:  `Baseline-${(i+1).toString().padStart(2,'0')}`,
                address_1:  'Av. San Martín 1000',
                city:       'Mendoza',
                state:      'Mendoza',
                postcode:   'M5500',
                country:    'AR',
            },
            line_items: [ { product_id: product.id, quantity: 1 } ],
        };

        const t0 = Date.now();
        const c = await api('POST', '/orders', order);
        console.log(`   [${(i+1).toString().padStart(2,'0')}/10] id=${c.id} · ${wcStatus.padEnd(10)} → ${thesisStatus.padEnd(15)} · ${product.name.slice(0,30).padEnd(30)} · phone=${phone} · $${c.total} · ${Date.now()-t0}ms`);
        created.push({
            id: c.id,
            wc_status: wcStatus,
            thesis_status: thesisStatus,
            product_id: product.id,
            product_name: product.name,
            total: c.total,
            currency: c.currency,
            phone: phone,
        });

        // delay para evitar rate-limit de Meta y dar tiempo a n8n a procesar
        if (i < DISTRIBUTION.length - 1) {
            const eta = ((DISTRIBUTION.length - 1 - i) * DELAY_MS / 1000).toFixed(0);
            process.stdout.write(`        esperando ${DELAY_MS}ms antes del próximo pedido (ETA ${eta}s)...\r`);
            await new Promise(r => setTimeout(r, DELAY_MS));
            process.stdout.write(' '.repeat(80) + '\r');
        }
    }

    const outDir = path.join(ROOT, 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'baseline-wc-orders.json');
    fs.writeFileSync(outPath, JSON.stringify({
        generated_at: new Date().toISOString(),
        n: created.length,
        distribution: {
            pending_payment: created.filter(o => o.thesis_status === 'pending_payment').length,
            paid:            created.filter(o => o.thesis_status === 'paid').length,
            delivered:       created.filter(o => o.thesis_status === 'delivered').length,
            cancelled:       created.filter(o => o.thesis_status === 'cancelled').length,
            refunded:        created.filter(o => o.thesis_status === 'refunded').length,
        },
        orders: created,
    }, null, 2));
    console.log(`\n3. Escrito ${outPath}`);
    console.log(`   Verificá en http://localhost:${WP_PORT}/wp-admin/edit.php?post_type=shop_order`);
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
