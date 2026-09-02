#!/usr/bin/env node
// =============================================================================
// generate.mjs — Generador del dataset simulado de la tesis
// -----------------------------------------------------------------------------
// Produce N pedidos sintéticos distribuidos entre los dos canales integrados
// (Mercado Libre y WooCommerce), según el diseño documentado en
// dataset/README.md. Determinístico vía seed.
//
// Uso:
//   node generate.mjs                # seed=42, count=150 (default)
//   node generate.mjs --seed 100 --count 200
//
// Salida:
//   dataset/seed-{seed}/
//     orders/{external_id}.json      # respuesta simulada de la API (ML) o
//                                     # payload completo del pedido (WC)
//     webhooks/{external_id}.json    # notificación al endpoint del pipeline
//     manifest.json / manifest.csv   # índice con canal, estado, edge case
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Argumentos --------------------------------------------------------------
function parseArgs(argv) {
    const args = { seed: 42, count: 150 };
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
    const now = new Date('2026-09-01T18:00:00.000-03:00');
    const ms = now.getTime() - randInt(0, daysAgo) * 24 * 3600 * 1000 -
               randInt(0, 86400) * 1000;
    return new Date(ms);
}

function isoArg(d) {
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

function buyerBase(idx) {
    const [first, last] = NOMBRES[idx % NOMBRES.length];
    const city = pick(CIUDADES);
    return { first, last, city, dni: String(randInt(25000000, 45000000)),
             phoneArea: '261', phoneNum: String(randInt(5550000, 5559999)) };
}

// =============================================================================
// SPECS — el mismo layout de estados/tipos/edge cases funciona para ambos
// canales. Se agrega la dimensión channel (mercadolibre | woocommerce).
// =============================================================================
function buildSpecs(n) {
    const specs = [];

    // Distribución por estado canónico (escalable a cualquier n manteniendo proporciones)
    const statusRatios = {
        paid:            0.36,
        shipped:         0.24,
        delivered:       0.16,
        pending_payment: 0.08,
        cancelled:       0.08,
        refunded:        0.04,
        error:           0.04,
    };
    const statusDistribution = expandByRatio(statusRatios, n, 'paid');

    const typeRatios = {
        single:             0.36,
        double:             0.24,
        kit:                0.12,
        multi_with_service: 0.18,
        service_only:       0.06,
        long_title:         0.04,
    };
    const typeDistribution = expandByRatio(typeRatios, n, 'single');

    // Canal — cuota 50/50 alternada. Preserva reproducibilidad (parityByIdx).
    const channelOf = (i) => (i % 2 === 0 ? 'mercadolibre' : 'woocommerce');

    // Los siete casos límite del brief. Índices fijos para reproducibilidad
    // y para ubicarlos en ambos canales según parity (índices pares → ML,
    // impares → WC), cubriendo el espectro.
    const edgeCases = [
        { idx: 5,  type: 'no_resource'        }, // WC no aplica; se degrada a no_id
        { idx: 12, type: 'unsupported_topic'  }, // WC no aplica; se degrada a bad_action
        { idx: 19, type: 'null_buyer_id'      },
        { idx: 26, type: 'high_value'         },
        { idx: 33, type: 'low_value'          },
        { idx: 41, type: 'duplicate'          },
        { idx: 47, type: 'no_items'           },
    ];

    for (let i = 0; i < n; i++) {
        const ec = edgeCases.find(e => e.idx === i) || null;
        specs.push({
            idx: i,
            external_id: String(3000000000000000 + i + 1),
            canonical_status: statusDistribution[i],
            product_type: typeDistribution[i],
            channel: channelOf(i),
            edge_case: ec ? ec.type : null,
        });
    }
    return specs;
}

// Expande un mapa {clave: proporción} a un array de longitud n donde cada
// clave aparece round(prop*n) veces. Rellena/recorta con `pad` para llegar
// exactamente a n. Determinístico según el orden de las claves.
function expandByRatio(ratios, n, pad) {
    const out = [];
    for (const [k, r] of Object.entries(ratios)) {
        const c = Math.round(r * n);
        for (let i = 0; i < c; i++) out.push(k);
    }
    while (out.length < n) out.push(pad);
    while (out.length > n) out.pop();
    return out;
}

// =============================================================================
// MERCADO LIBRE — renderer (ML es el shape con enrich vía /orders/{id})
// =============================================================================
const ML_STATUS = {
    paid:            { status: 'paid',              detail: null,             payment: 'approved'  },
    shipped:         { status: 'paid',              detail: null,             payment: 'approved'  },
    delivered:       { status: 'paid',              detail: null,             payment: 'approved'  },
    pending_payment: { status: 'payment_required',  detail: null,             payment: 'pending'   },
    cancelled:       { status: 'cancelled',         detail: 'buyer_canceled', payment: 'cancelled' },
    refunded:        { status: 'partially_refunded',detail: null,             payment: 'refunded'  },
    error:           { status: 'invalid_unknown_X', detail: null,             payment: 'unknown'   },
};
const ML_SHIPPING = {
    paid: 'ready_to_ship', shipped: 'shipped', delivered: 'delivered',
    pending_payment: 'pending', cancelled: 'cancelled', refunded: 'shipped', error: 'pending',
};

function mlBuyer(base, edgeCase) {
    const b = {
        id: 400000000 + randInt(1, 999999),
        nickname: (base.first[0] + base.last).toUpperCase() + '_' + randInt(10, 99),
        email: `${base.first.toLowerCase()}.${base.last.toLowerCase()}@example.com`,
        phone: { area_code: base.phoneArea, number: base.phoneNum, extension: null, verified: rand() > 0.15 },
        first_name: base.first,
        last_name: base.last,
        billing_info: { doc_type: 'DNI', doc_number: base.dni },
    };
    if (edgeCase === 'null_buyer_id') b.id = null;
    return b;
}

function mlItem(forceLongTitle = false) {
    const n = pick(NEUMATICOS);
    const unitPrice = randFloat(n.price[0], n.price[1], 2);
    const baseTitle = `Neumático ${n.brand} ${n.model} ${n.size}`;
    const title = forceLongTitle
        ? baseTitle + ' — Carcasa reforzada para condiciones severas de uso, garantía extendida del fabricante, válida en todo el territorio nacional, ideal para vehículos de gama media-alta'
        : baseTitle;
    return {
        item: {
            id: 'MLA' + randInt(1000000000, 9999999999),
            title, category_id: 'MLA1747', variation_id: null,
            seller_custom_field: `${n.sku_prefix}-${n.size.replace(/[\/ ]/g, '-')}`,
            warranty: rand() > 0.5 ? 'Garantía del vendedor: 6 meses' : null,
        },
        quantity: pick([1, 1, 1, 2, 2, 4]),
        unit_price: unitPrice, currency_id: 'ARS', manufacturing_days: null,
        sale_fee: Number((unitPrice * 0.11).toFixed(2)),
    };
}

function mlServiceItem() {
    const svc = pick(SERVICIOS);
    const price = randFloat(svc.price[0], svc.price[1], 2);
    return {
        item: { id: 'MLA' + randInt(900000000, 999999999), title: svc.name,
                category_id: 'MLA417283', seller_custom_field: svc.sku },
        quantity: 1, unit_price: price, currency_id: 'ARS',
        sale_fee: Number((price * 0.11).toFixed(2)),
    };
}

function mlItemsForType(type, edgeCase) {
    let items;
    switch (type) {
        case 'single':  items = [mlItem()]; break;
        case 'double':  { const it = mlItem(); it.quantity = 2; items = [it]; break; }
        case 'kit':     { const it = mlItem(); it.quantity = 4; items = [it]; break; }
        case 'multi_with_service':
            items = [mlItem(), mlServiceItem()];
            items[0].quantity = pick([2, 4]); break;
        case 'service_only': items = [mlServiceItem()]; break;
        case 'long_title':   items = [mlItem(true)]; break;
        default:             items = [mlItem()];
    }
    if (edgeCase === 'no_items') items = [];
    if (edgeCase === 'high_value') {
        const extra = mlItem(); extra.quantity = 6; extra.unit_price = randFloat(140000, 180000);
        items.push(extra);
    }
    if (edgeCase === 'low_value') {
        items = [mlServiceItem()]; items[0].unit_price = randFloat(2500, 4500);
    }
    return items;
}

function renderMLOrder(spec, base) {
    const buyer = mlBuyer(base, spec.edge_case);
    const items = mlItemsForType(spec.product_type, spec.edge_case);
    const total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);

    const sml = ML_STATUS[spec.canonical_status];
    const dateCreated = randomDateInDays(30);
    const dateClosed  = new Date(dateCreated.getTime() + randInt(60, 7200) * 1000);
    const lastUpdated = new Date(dateClosed.getTime()  + randInt(0, 86400 * 5) * 1000);
    const pm = pickWeighted(PAYMENT_METHODS);

    return {
        id: Number(spec.external_id), status: sml.status, status_detail: sml.detail,
        date_created: isoArg(dateCreated),
        date_closed:  sml.status === 'payment_required' ? null : isoArg(dateClosed),
        last_updated: isoArg(lastUpdated),
        order_items: items,
        total_amount: Number(total.toFixed(2)),
        paid_amount: sml.payment === 'approved' ? Number(total.toFixed(2)) : 0,
        currency_id: 'ARS', buyer, seller: SELLER,
        payments: [{
            id: 8900000000 + randInt(1, 99999999), transaction_amount: Number(total.toFixed(2)),
            currency_id: 'ARS', status: sml.payment,
            date_approved: sml.payment === 'approved' ? isoArg(dateClosed) : null,
            payment_method_id: pm.id, payment_type: pm.type,
            installments: pick([1, 1, 3, 3, 6, 6, 12]),
        }],
        shipping: {
            id: 41200000000 + randInt(1, 999999999),
            status: ML_SHIPPING[spec.canonical_status] || 'pending',
            shipping_mode: 'me2', service_id: 308, cost: 0,
            tracking_number: ['shipped','delivered'].includes(spec.canonical_status)
                ? 'AR' + randInt(100000000, 999999999) + 'MLA' : null,
            date_delivered: spec.canonical_status === 'delivered' ? isoArg(lastUpdated) : null,
            receiver_address: {
                city: { name: base.city.city }, state: { name: base.city.state },
                country: { id: 'AR', name: 'Argentina' }, zip_code: base.city.zip,
            },
        },
        tags: spec.canonical_status === 'cancelled' ? ['cancelled']
            : spec.canonical_status === 'delivered' ? ['paid','delivered']
            : ['paid'],
    };
}

function renderMLWebhook(spec) {
    const base = {
        resource: `/orders/${spec.external_id}`,
        user_id: SELLER.id, topic: 'orders_v2',
        application_id: 5503910054141466, attempts: 1,
        sent: isoArg(randomDateInDays(30)), received: isoArg(new Date()),
    };
    if (spec.edge_case === 'no_resource')       delete base.resource;
    if (spec.edge_case === 'unsupported_topic') base.topic = 'questions';
    if (spec.edge_case === 'duplicate')         base.attempts = 2;
    return base;
}

// =============================================================================
// WOOCOMMERCE — renderer (WC manda el pedido COMPLETO en el webhook, no hay
// enrich posterior. El manifest publica ambos archivos por simetría; el
// webhook y el order son idénticos para WC.)
// =============================================================================
const WC_STATUS = {
    paid:            'processing',
    shipped:         'processing',   // WC no distingue shipped; el estado interno lo maneja el vendedor
    delivered:       'completed',
    pending_payment: 'pending',
    cancelled:       'cancelled',
    refunded:        'refunded',
    error:           'failed',
};

function wcItemsForType(type, edgeCase) {
    let items;
    const mkItem = (long = false) => {
        const n = pick(NEUMATICOS);
        const price = randFloat(n.price[0], n.price[1], 2);
        const nameBase = `Neumático ${n.brand} ${n.model} ${n.size}`;
        const name = long
            ? nameBase + ' — Carcasa reforzada para condiciones severas de uso, garantía extendida del fabricante, válida en todo el territorio nacional, ideal para vehículos de gama media-alta'
            : nameBase;
        return {
            id: randInt(100, 9999),
            name,
            product_id: randInt(1, 500),
            variation_id: 0,
            quantity: 1,
            subtotal: String(price),
            total: String(price),
            sku: `${n.sku_prefix}-${n.size.replace(/[\/ ]/g, '-')}`,
            price,
        };
    };
    const mkSvc = () => {
        const s = pick(SERVICIOS);
        const price = randFloat(s.price[0], s.price[1], 2);
        return {
            id: randInt(100, 9999), name: s.name, product_id: randInt(500, 700),
            variation_id: 0, quantity: 1, subtotal: String(price), total: String(price),
            sku: s.sku, price,
        };
    };
    switch (type) {
        case 'single':  items = [mkItem()]; break;
        case 'double':  { const it = mkItem(); it.quantity = 2; it.total = String(it.price*2); it.subtotal = it.total; items = [it]; break; }
        case 'kit':     { const it = mkItem(); it.quantity = 4; it.total = String(it.price*4); it.subtotal = it.total; items = [it]; break; }
        case 'multi_with_service': {
            const t = mkItem(); t.quantity = pick([2, 4]); t.total = String(t.price*t.quantity); t.subtotal = t.total;
            items = [t, mkSvc()]; break;
        }
        case 'service_only': items = [mkSvc()]; break;
        case 'long_title':   items = [mkItem(true)]; break;
        default:             items = [mkItem()];
    }
    if (edgeCase === 'no_items') items = [];
    if (edgeCase === 'high_value') {
        const extra = mkItem(); extra.quantity = 6; extra.price = randFloat(140000, 180000);
        extra.total = String(extra.price*6); extra.subtotal = extra.total;
        items.push(extra);
    }
    if (edgeCase === 'low_value') {
        items = [mkSvc()]; items[0].price = randFloat(2500, 4500);
        items[0].total = String(items[0].price); items[0].subtotal = items[0].total;
    }
    return items;
}

function renderWCOrder(spec, base) {
    const items = wcItemsForType(spec.product_type, spec.edge_case);
    const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const dateCreated = randomDateInDays(30);
    // Guest checkout — customer_id=0 y datos en billing (patrón real de WC)
    const isGuest = rand() > 0.25;
    // null_buyer_id en WC = guest sin email → forzamos ambos vacíos, el
    // normalizador genera synthetic:woocommerce:{id} en D1.
    const nullBuyer = spec.edge_case === 'null_buyer_id';

    return {
        id: Number(spec.external_id),
        parent_id: 0,
        status: WC_STATUS[spec.canonical_status],
        currency: 'ARS',
        version: '8.4.0',
        prices_include_tax: false,
        date_created: isoArg(dateCreated),
        date_modified: isoArg(dateCreated),
        date_created_gmt: dateCreated.toISOString(),
        date_modified_gmt: dateCreated.toISOString(),
        discount_total: '0.00', discount_tax: '0.00',
        shipping_total: '0.00', shipping_tax: '0.00',
        cart_tax: '0.00', total_tax: '0.00',
        total: String(total.toFixed(2)),
        customer_id: isGuest ? 0 : randInt(1, 999),
        order_key: 'wc_order_' + Math.random().toString(36).slice(2, 14),
        billing: nullBuyer
            ? { first_name: '', last_name: '', email: '', phone: base.phoneArea + base.phoneNum }
            : { first_name: base.first, last_name: base.last,
                email: `${base.first.toLowerCase()}.${base.last.toLowerCase()}@example.com`,
                phone: '+549' + base.phoneArea + base.phoneNum,
                address_1: `Calle ${randInt(100,9999)}`, city: base.city.city,
                state: base.city.state, postcode: base.city.zip, country: 'AR' },
        shipping: nullBuyer
            ? { first_name: '', last_name: '' }
            : { first_name: base.first, last_name: base.last,
                address_1: `Calle ${randInt(100,9999)}`, city: base.city.city,
                state: base.city.state, postcode: base.city.zip, country: 'AR' },
        payment_method: pick(['visa','mastercard','account_money']),
        payment_method_title: 'Tarjeta',
        transaction_id: sprint(spec.canonical_status, () => 'ch_' + Math.random().toString(36).slice(2, 12)),
        line_items: items,
        tax_lines: [], shipping_lines: [], fee_lines: [], coupon_lines: [],
        refunds: spec.canonical_status === 'refunded'
            ? [{ id: randInt(1000,9999), reason: 'Reembolso solicitado', total: '-' + String(total.toFixed(2)) }]
            : [],
    };
}

function sprint(status, fn) {
    // Devuelve el resultado sólo cuando el estado justifica que exista el dato.
    if (['paid','shipped','delivered'].includes(status)) return fn();
    return '';
}

function renderWCWebhook(spec, base) {
    // WC manda el pedido completo como body del webhook — coincide con el order.
    // El edge case 'duplicate' se maneja apuntando el mismo pedido dos veces
    // (dos entradas idénticas en el manifest, mismo file).
    return renderWCOrder(spec, base);
}

// =============================================================================
// MAIN
// =============================================================================
const outDir      = path.join(__dirname, `seed-${seed}`);
const ordersDir   = path.join(outDir, 'orders');
const webhooksDir = path.join(outDir, 'webhooks');

// Limpiar la corrida anterior para evitar mezclar output de count previo
for (const d of [ordersDir, webhooksDir]) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
}

const specs = buildSpecs(count);
const manifest = [];

for (const spec of specs) {
    const base = buyerBase(spec.idx);
    const isML = spec.channel === 'mercadolibre';

    let order, webhook;
    if (isML) {
        order   = renderMLOrder(spec, base);
        webhook = renderMLWebhook(spec);
    } else {
        // WC: order y webhook son el mismo objeto (WC envía el pedido en el body)
        order   = renderWCOrder(spec, base);
        webhook = { ...order }; // copia superficial para reflejar la duplicación real
    }

    // Duplicado: el webhook apunta al pedido anterior (mantiene idempotencia)
    if (spec.edge_case === 'duplicate' && spec.idx > 0) {
        const prev = specs[spec.idx - 1];
        if (isML) webhook.resource = `/orders/${prev.external_id}`;
        webhook.attempts = 2;
    }

    const orderFile   = path.join(ordersDir,   `${spec.external_id}.json`);
    const webhookFile = path.join(webhooksDir, `${spec.external_id}.json`);
    fs.writeFileSync(orderFile,   JSON.stringify(order,   null, 2));
    fs.writeFileSync(webhookFile, JSON.stringify(webhook, null, 2));

    manifest.push({
        idx: spec.idx,
        external_id: spec.external_id,
        channel: spec.channel,
        canonical_status: spec.canonical_status,
        product_type: spec.product_type,
        items_count: (order.line_items || order.order_items || []).length,
        total_amount: Number((order.total || order.total_amount || 0)),
        currency: order.currency || order.currency_id || 'ARS',
        edge_case: spec.edge_case,
        webhook_target: webhook.resource || null,
    });
}

// --- Manifest JSON -----------------------------------------------------------
fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({
        seed, count,
        generated_at: new Date().toISOString(),
        items: manifest,
    }, null, 2)
);

// --- Manifest CSV (Anexo C en planilla) --------------------------------------
const csvHeader = 'idx,external_id,channel,canonical_status,product_type,items_count,total_amount,currency,edge_case,webhook_target\n';
const csvBody = manifest.map(r => [
    r.idx, r.external_id, r.channel, r.canonical_status, r.product_type,
    r.items_count, r.total_amount, r.currency,
    r.edge_case || '', r.webhook_target || '',
].join(',')).join('\n');
fs.writeFileSync(path.join(outDir, 'manifest.csv'), csvHeader + csvBody + '\n');

// --- Resumen -----------------------------------------------------------------
const byChannel = manifest.reduce((a, r) => (a[r.channel] = (a[r.channel] || 0) + 1, a), {});
const byStatus  = manifest.reduce((a, r) => (a[r.canonical_status] = (a[r.canonical_status] || 0) + 1, a), {});
const byType    = manifest.reduce((a, r) => (a[r.product_type]    = (a[r.product_type]    || 0) + 1, a), {});
const edgeCount = manifest.filter(r => r.edge_case).length;

console.log(`\nGenerado dataset en ${outDir}`);
console.log(`  - ${count} pedidos, seed ${seed}`);
console.log(`  - Por canal: `, byChannel);
console.log(`  - Por estado:`, byStatus);
console.log(`  - Por tipo:  `, byType);
console.log(`  - Edge cases: ${edgeCount}\n`);
