#!/usr/bin/env node
// =============================================================================
// generate.mjs — Generador del dataset simulado de la tesis
// -----------------------------------------------------------------------------
// Produce N pedidos sintéticos con shape de Mercado Libre, distribuidos según
// el diseño documentado en dataset/README.md. Determinístico vía seed.
//
// Uso:
//   node generate.mjs                # seed=42, count=50 (default)
//   node generate.mjs --seed 100 --count 100
//
// Salida: dataset/seed-{N}/{orders,webhooks,manifest.json,manifest.csv}
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Argumentos --------------------------------------------------------------
function parseArgs(argv) {
    const args = { seed: 42, count: 50 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--seed')  args.seed  = Number(argv[++i]);
        if (a === '--count') args.count = Number(argv[++i]);
    }
    return args;
}
const { seed, count } = parseArgs(process.argv);

// --- PRNG sembrado (Mulberry32) ----------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min, max, decimals = 2) =>
    Number((min + rand() * (max - min)).toFixed(decimals));

// --- Datos base --------------------------------------------------------------

const NEUMATICOS = [
    { brand: 'Pirelli',     model: 'Cinturato P1',  size: '195/65 R15', price: [70000, 90000],  sku_prefix: 'PIR-CP1' },
    { brand: 'Pirelli',     model: 'P7',            size: '205/55 R16', price: [85000, 110000], sku_prefix: 'PIR-P7'  },
    { brand: 'Bridgestone', model: 'Turanza T005',  size: '205/55 R16', price: [90000, 115000], sku_prefix: 'BST-T005'},
    { brand: 'Bridgestone', model: 'Ecopia EP150',  size: '185/65 R14', price: [60000, 80000],  sku_prefix: 'BST-EP150'},
    { brand: 'Michelin',    model: 'Primacy 4',     size: '225/45 R17', price: [130000, 165000],sku_prefix: 'MCH-PRI4'},
    { brand: 'Michelin',    model: 'Energy XM2',    size: '175/70 R13', price: [55000, 72000],  sku_prefix: 'MCH-EXM2'},
    { brand: 'Goodyear',    model: 'EfficientGrip', size: '195/55 R15', price: [72000, 92000],  sku_prefix: 'GDY-EFG' },
    { brand: 'Goodyear',    model: 'Eagle F1',      size: '245/40 R18', price: [160000, 200000],sku_prefix: 'GDY-EF1' },
    { brand: 'Continental', model: 'PowerContact',  size: '185/65 R15', price: [68000, 88000],  sku_prefix: 'CON-PWC' },
    { brand: 'Continental', model: 'ContiPremium',  size: '205/60 R16', price: [95000, 120000], sku_prefix: 'CON-CPC' },
    { brand: 'Hankook',     model: 'Kinergy',       size: '175/65 R14', price: [50000, 68000],  sku_prefix: 'HNK-KIN' },
    { brand: 'Fate',        model: 'Maxisport',     size: '195/65 R15', price: [55000, 72000],  sku_prefix: 'FAT-MXS' },
];

const SERVICIOS = [
    { name: 'Servicio de alineación y balanceo (4 ruedas)', price: [15000, 22000], sku: 'SVC-ALI-BAL-4' },
    { name: 'Servicio de instalación de neumáticos (4 ruedas)', price: [8000, 14000], sku: 'SVC-INS-4' },
    { name: 'Servicio de rotación de neumáticos', price: [5000, 9000], sku: 'SVC-ROT' },
    { name: 'Revisión y ajuste de presión', price: [3000, 6000], sku: 'SVC-PRES' },
];

const NOMBRES = [
    ['Juan',     'Pérez'],     ['María',  'Gómez'],     ['Carlos', 'López'],
    ['Lucía',    'Fernández'], ['Diego',  'Rodríguez'], ['Sofía',  'Martínez'],
    ['Pablo',    'García'],    ['Valentina','Sánchez'], ['Mateo',  'Romero'],
    ['Camila',   'Torres'],    ['Federico','Díaz'],     ['Florencia','Ruiz'],
    ['Tomás',    'Álvarez'],   ['Martina','Herrera'],   ['Lautaro','Vega'],
    ['Agustina', 'Castro'],    ['Joaquín','Acosta'],    ['Catalina','Medina'],
    ['Nicolás',  'Suárez'],    ['Emma',   'Ortiz'],
];

const CIUDADES = [
    { city: 'Mendoza',       state: 'Mendoza',     zip: 'M5500' },
    { city: 'Godoy Cruz',    state: 'Mendoza',     zip: 'M5501' },
    { city: 'Maipú',         state: 'Mendoza',     zip: 'M5515' },
    { city: 'Las Heras',     state: 'Mendoza',     zip: 'M5539' },
    { city: 'Luján de Cuyo', state: 'Mendoza',     zip: 'M5507' },
    { city: 'Guaymallén',    state: 'Mendoza',     zip: 'M5519' },
    { city: 'Buenos Aires',  state: 'CABA',        zip: 'C1425' },
    { city: 'La Plata',      state: 'Buenos Aires',zip: 'B1900' },
    { city: 'Córdoba',       state: 'Córdoba',     zip: 'X5000' },
    { city: 'San Juan',      state: 'San Juan',    zip: 'J5400' },
    { city: 'Rosario',       state: 'Santa Fe',    zip: 'S2000' },
];

const PAYMENT_METHODS = [
    { id: 'visa',          type: 'credit_card', weight: 30 },
    { id: 'mastercard',    type: 'credit_card', weight: 20 },
    { id: 'account_money', type: 'account_money', weight: 30 },
    { id: 'debvisa',       type: 'debit_card',  weight: 15 },
    { id: 'pagofacil',     type: 'ticket',      weight:  5 },
];

const SELLER = { id: 123456789, nickname: 'NEUMATICOS_MENDOZA' };

// --- Helpers de generación ---------------------------------------------------

function pickWeighted(arr) {
    const total = arr.reduce((s, x) => s + x.weight, 0);
    let r = rand() * total;
    for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
    return arr[arr.length - 1];
}

function randomDateInDays(daysAgo) {
    const now = new Date('2026-05-20T18:00:00.000-03:00');
    const ms = now.getTime() - randInt(0, daysAgo) * 24 * 3600 * 1000 -
               randInt(0, 86400) * 1000;
    return new Date(ms);
}

function isoArg(d) {
    // ISO format with -03:00 (Mendoza)
    const pad = (n) => String(n).padStart(2, '0');
    const y = d.getUTCFullYear();
    const mo = pad(d.getUTCMonth() + 1);
    const da = pad(d.getUTCDate());
    const h = pad(d.getUTCHours() - 3 >= 0 ? d.getUTCHours() - 3 : d.getUTCHours() + 21);
    const mi = pad(d.getUTCMinutes());
    const s  = pad(d.getUTCSeconds());
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${y}-${mo}-${da}T${h}:${mi}:${s}.${ms}-03:00`;
}

function makeBuyer(idx) {
    const [first, last] = NOMBRES[idx % NOMBRES.length];
    const city = pick(CIUDADES);
    return {
        id: 400000000 + randInt(1, 999999),
        nickname: (first[0] + last).toUpperCase() + '_' + randInt(10, 99),
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        phone: {
            area_code: '261',
            number: String(randInt(5550000, 5559999)),
            extension: null,
            verified: rand() > 0.15, // 85% verified
        },
        first_name: first,
        last_name: last,
        billing_info: {
            doc_type: 'DNI',
            doc_number: String(randInt(25000000, 45000000)),
        },
        _city: city, // metadato interno, no se incluye en el output ML
    };
}

function makeItem(forceLongTitle = false) {
    const n = pick(NEUMATICOS);
    const unitPrice = randFloat(n.price[0], n.price[1], 2);
    const baseTitle = `Neumático ${n.brand} ${n.model} ${n.size}`;
    const title = forceLongTitle
        ? baseTitle + ' — Carcasa reforzada para condiciones severas de uso, garantía extendida del fabricante, válida en todo el territorio nacional, ideal para vehículos de gama media-alta'
        : baseTitle;
    return {
        item: {
            id: 'MLA' + randInt(1000000000, 9999999999),
            title,
            category_id: 'MLA1747',
            variation_id: null,
            seller_custom_field: `${n.sku_prefix}-${n.size.replace(/[\/ ]/g, '-').replace('R','R')}`,
            warranty: rand() > 0.5 ? 'Garantía del vendedor: 6 meses' : null,
        },
        quantity: pick([1, 1, 1, 2, 2, 4]), // bias hacia 1
        unit_price: unitPrice,
        currency_id: 'ARS',
        manufacturing_days: null,
        sale_fee: Number((unitPrice * 0.11).toFixed(2)),
    };
}

function makeServiceItem() {
    const svc = pick(SERVICIOS);
    const price = randFloat(svc.price[0], svc.price[1], 2);
    return {
        item: {
            id: 'MLA' + randInt(900000000, 999999999),
            title: svc.name,
            category_id: 'MLA417283',
            seller_custom_field: svc.sku,
        },
        quantity: 1,
        unit_price: price,
        currency_id: 'ARS',
        sale_fee: Number((price * 0.11).toFixed(2)),
    };
}

// --- Diseño de los 50 -------------------------------------------------------
// Devuelve un array de "specs" que el generador resuelve a JSON
function buildSpecs(n) {
    const specs = [];

    // Distribución por estado
    const statusDistribution = [
        ...Array(18).fill('paid'),
        ...Array(12).fill('shipped'),
        ...Array( 8).fill('delivered'),
        ...Array( 4).fill('pending_payment'),
        ...Array( 4).fill('cancelled'),
        ...Array( 2).fill('refunded'),
        ...Array( 2).fill('error'),
    ];
    // Trim/padding si count != 50
    while (statusDistribution.length < n) statusDistribution.push('paid');
    while (statusDistribution.length > n) statusDistribution.pop();

    // Distribución por tipo
    const typeDistribution = [
        ...Array(18).fill('single'),
        ...Array(12).fill('double'),
        ...Array( 6).fill('kit'),
        ...Array( 9).fill('multi_with_service'),
        ...Array( 3).fill('service_only'),
        ...Array( 2).fill('long_title'),
    ];
    while (typeDistribution.length < n) typeDistribution.push('single');
    while (typeDistribution.length > n) typeDistribution.pop();

    // Edge case flags
    const edgeCases = new Set();
    edgeCases.add(JSON.stringify({ idx: 5,  type: 'no_resource'        }));
    edgeCases.add(JSON.stringify({ idx: 12, type: 'unsupported_topic'  }));
    edgeCases.add(JSON.stringify({ idx: 19, type: 'null_buyer_id'      }));
    edgeCases.add(JSON.stringify({ idx: 26, type: 'high_value'         }));
    edgeCases.add(JSON.stringify({ idx: 33, type: 'low_value'          }));
    edgeCases.add(JSON.stringify({ idx: 41, type: 'duplicate'          }));
    edgeCases.add(JSON.stringify({ idx: 47, type: 'no_items'           }));

    // Combinar
    for (let i = 0; i < n; i++) {
        const ec = [...edgeCases].map(s => JSON.parse(s)).find(e => e.idx === i);
        specs.push({
            idx: i,
            external_id: String(3000000000000000 + i + 1),
            ml_status: statusDistribution[i],
            product_type: typeDistribution[i],
            edge_case: ec ? ec.type : null,
        });
    }
    return specs;
}

// --- Mapear status canónico → status ML (para que el normalizador lo procese) ---
const STATUS_TO_ML = {
    paid:            { status: 'paid',              detail: null,            payment: 'approved' },
    shipped:         { status: 'paid',              detail: null,            payment: 'approved' },
    delivered:       { status: 'paid',              detail: null,            payment: 'approved' },
    pending_payment: { status: 'payment_required',  detail: null,            payment: 'pending'  },
    cancelled:       { status: 'cancelled',         detail: 'buyer_canceled',payment: 'cancelled'},
    refunded:        { status: 'partially_refunded',detail: null,            payment: 'refunded' },
    error:           { status: 'invalid_unknown_X', detail: null,            payment: 'unknown'  }, // status no mapeado
};

const SHIPPING_STATUS = {
    paid:            'ready_to_ship',
    shipped:         'shipped',
    delivered:       'delivered',
    pending_payment: 'pending',
    cancelled:       'cancelled',
    refunded:        'shipped',
    error:           'pending',
};

// --- Render de un order ML completo -----------------------------------------
function renderOrder(spec) {
    const buyer = makeBuyer(spec.idx);
    if (spec.edge_case === 'null_buyer_id') {
        buyer.id = null;
    }

    let items;
    switch (spec.product_type) {
        case 'single':
            items = [makeItem()];
            break;
        case 'double': {
            const it = makeItem();
            it.quantity = 2;
            items = [it];
            break;
        }
        case 'kit': {
            const it = makeItem();
            it.quantity = 4;
            items = [it];
            break;
        }
        case 'multi_with_service':
            items = [makeItem(), makeServiceItem()];
            items[0].quantity = pick([2, 4]);
            break;
        case 'service_only':
            items = [makeServiceItem()];
            break;
        case 'long_title':
            items = [makeItem(true)];
            break;
        default:
            items = [makeItem()];
    }

    if (spec.edge_case === 'no_items') items = [];

    // Total
    let total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    if (spec.edge_case === 'high_value') {
        const extra = makeItem();
        extra.quantity = 6;
        extra.unit_price = randFloat(140000, 180000);
        items.push(extra);
        total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    }
    if (spec.edge_case === 'low_value') {
        items = [makeServiceItem()];
        items[0].unit_price = randFloat(2500, 4500);
        total = items[0].unit_price;
    }

    // Status
    const sml = STATUS_TO_ML[spec.ml_status];
    const dateCreated = randomDateInDays(30);
    const dateClosed  = new Date(dateCreated.getTime() + randInt(60, 7200) * 1000);
    const lastUpdated = new Date(dateClosed.getTime()  + randInt(0, 86400 * 5) * 1000);

    const paymentMethod = pickWeighted(PAYMENT_METHODS);

    const order = {
        id: Number(spec.external_id),
        status: sml.status,
        status_detail: sml.detail,
        date_created: isoArg(dateCreated),
        date_closed:  sml.status === 'payment_required' ? null : isoArg(dateClosed),
        last_updated: isoArg(lastUpdated),
        expiration_date: null,
        order_items: items,
        total_amount: Number(total.toFixed(2)),
        paid_amount: sml.payment === 'approved' ? Number(total.toFixed(2)) : 0,
        currency_id: 'ARS',
        buyer,
        seller: SELLER,
        payments: [{
            id: 8900000000 + randInt(1, 99999999),
            transaction_amount: Number(total.toFixed(2)),
            currency_id: 'ARS',
            status: sml.payment,
            date_approved: sml.payment === 'approved' ? isoArg(dateClosed) : null,
            payment_method_id: paymentMethod.id,
            payment_type: paymentMethod.type,
            installments: pick([1, 1, 3, 3, 6, 6, 12]),
        }],
        shipping: {
            id: 41200000000 + randInt(1, 999999999),
            status: SHIPPING_STATUS[spec.ml_status] || 'pending',
            shipping_mode: 'me2',
            service_id: 308,
            cost: 0,
            tracking_number: ['shipped','delivered'].includes(spec.ml_status)
                ? 'AR' + randInt(100000000, 999999999) + 'MLA'
                : null,
            date_delivered: spec.ml_status === 'delivered' ? isoArg(lastUpdated) : null,
            receiver_address: {
                city:    { name: buyer._city.city },
                state:   { name: buyer._city.state },
                country: { id: 'AR', name: 'Argentina' },
                zip_code: buyer._city.zip,
            },
        },
        tags: spec.ml_status === 'cancelled' ? ['cancelled'] :
              spec.ml_status === 'delivered' ? ['paid','delivered'] :
              ['paid'],
    };

    // Remove internal _city marker before serialize
    delete order.buyer._city;

    return order;
}

function renderWebhook(spec) {
    const base = {
        resource: `/orders/${spec.external_id}`,
        user_id: SELLER.id,
        topic: 'orders_v2',
        application_id: 5503910054141466,
        attempts: 1,
        sent: isoArg(randomDateInDays(30)),
        received: isoArg(new Date()),
    };

    // Edge cases que afectan al webhook
    if (spec.edge_case === 'no_resource')       delete base.resource;
    if (spec.edge_case === 'unsupported_topic') base.topic = 'questions';
    if (spec.edge_case === 'duplicate')         base.attempts = 2;

    return base;
}

// --- Main --------------------------------------------------------------------
const outDir   = path.join(__dirname, `seed-${seed}`);
const ordersDir   = path.join(outDir, 'orders');
const webhooksDir = path.join(outDir, 'webhooks');

for (const d of [outDir, ordersDir, webhooksDir]) {
    fs.mkdirSync(d, { recursive: true });
}

const specs = buildSpecs(count);
const manifest = [];

for (const spec of specs) {
    const order = renderOrder(spec);
    const webhook = renderWebhook(spec);

    // Si edge_case=duplicate, generamos webhook duplicado pero NO duplicamos el order:
    // el duplicate apunta al MISMO external_id que otro pedido. Lo manejamos abajo
    // sobreescribiendo el webhook a apuntar al pedido anterior.
    if (spec.edge_case === 'duplicate' && spec.idx > 0) {
        webhook.resource = `/orders/${specs[spec.idx - 1].external_id}`;
        webhook.attempts = 2;
    }

    const orderFile   = path.join(ordersDir,   `${spec.external_id}.json`);
    const webhookFile = path.join(webhooksDir, `${spec.external_id}.json`);

    fs.writeFileSync(orderFile,   JSON.stringify(order, null, 2));
    fs.writeFileSync(webhookFile, JSON.stringify(webhook, null, 2));

    manifest.push({
        idx: spec.idx,
        external_id: spec.external_id,
        canonical_status: spec.ml_status,
        product_type: spec.product_type,
        items_count: order.order_items.length,
        total_amount: order.total_amount,
        currency: order.currency_id,
        edge_case: spec.edge_case,
        webhook_target: webhook.resource || null,
    });
}

// Manifest JSON
fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({
        seed,
        count,
        generated_at: new Date().toISOString(),
        items: manifest,
    }, null, 2)
);

// Manifest CSV (para Anexo C en planilla)
const csvHeader = 'idx,external_id,canonical_status,product_type,items_count,total_amount,currency,edge_case,webhook_target\n';
const csvBody = manifest
    .map(r => [r.idx, r.external_id, r.canonical_status, r.product_type,
               r.items_count, r.total_amount, r.currency,
               r.edge_case || '', r.webhook_target || ''].join(','))
    .join('\n');
fs.writeFileSync(path.join(outDir, 'manifest.csv'), csvHeader + csvBody + '\n');

// Resumen en consola
const byStatus = manifest.reduce((acc, r) => { acc[r.canonical_status] = (acc[r.canonical_status] || 0) + 1; return acc; }, {});
const byType   = manifest.reduce((acc, r) => { acc[r.product_type]    = (acc[r.product_type]    || 0) + 1; return acc; }, {});
const edgeCount = manifest.filter(r => r.edge_case).length;

console.log(`\n✅ Generado dataset en ${outDir}`);
console.log(`   - ${count} pedidos`);
console.log(`   - Por estado:`, byStatus);
console.log(`   - Por tipo: `, byType);
console.log(`   - Edge cases: ${edgeCount}`);
console.log(`   - Seed: ${seed}\n`);
