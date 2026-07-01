// =============================================================================
// normalize-wc-order.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" de n8n (modo: "Run Once for All Items") ubicado
// después de `validate-wc-webhook.js` (rama true del IF "Valid?").
//
// Función:
//   - Mapea la estructura cruda de WooCommerce al MISMO modelo canónico que
//     produce `normalize-ml-order.js`. A partir de este nodo, el flujo es
//     idéntico para ambos canales (idempotencia → persistencia → LLM → WA).
//   - Calcula SHA-256 de email y teléfono (dedupe futuro sin exponer PII).
//   - Genera pseudonym determinístico por (channel, external_id).
//   - Normaliza el estado WooCommerce al dominio del CHECK constraint de
//     tfi.orders.
//
// Diferencias clave con Mercado Libre:
//   - WooCommerce manda el pedido COMPLETO en el webhook (no hay enrich).
//   - El cliente vive en `billing`; los productos en `line_items`.
//   - Los invitados (guest checkout) llegan con `customer_id = 0`; en ese caso
//     usamos el email de facturación como external_id.
//   - No hay estados de envío nativos (shipped/delivered vienen de plugins de
//     tracking); el delivery_status se deriva del estado del pedido.
//
// Input por item (output de validate-wc-webhook.js):
//   { order: { id, status, billing, line_items, total, currency, ... }, ... }
//
// Output por item: idéntico shape que normalize-ml-order.js
//   { customer, order, items, meta }
// =============================================================================

const crypto = require('crypto');

const NORMALIZATION_VERSION = 'v1';
const CHANNEL = 'woocommerce';

// --- Mapeo de estados WooCommerce → modelo canónico --------------------------
// El CHECK constraint en tfi.orders sólo permite:
//   created, pending_payment, paid, preparing, shipped, delivered, cancelled,
//   refunded, error
// Estados nativos de WooCommerce:
//   pending, on-hold, processing, completed, cancelled, refunded, failed,
//   checkout-draft
const STATUS_MAP = {
    'checkout-draft': 'created',
    pending:          'pending_payment',  // esperando pago
    'on-hold':        'pending_payment',  // p.ej. transferencia bancaria pendiente
    processing:       'paid',             // pago recibido, pedido en preparación
    completed:        'delivered',        // WooCommerce lo da por finalizado/entregado
    cancelled:        'cancelled',
    refunded:         'refunded',
    failed:           'error',            // pago fallido
};

// delivery_status del item derivado del estado del pedido (WC no lo trae por item)
const DELIVERY_BY_STATUS = {
    created:          'pending',
    pending_payment:  'pending',
    paid:             'preparing',
    shipped:          'shipped',
    delivered:        'delivered',
    cancelled:        'cancelled',
    refunded:         'returned',
    error:            'pending',
};

// --- Helpers -----------------------------------------------------------------
function sha256(value) {
    if (value === null || value === undefined || value === '') return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}

function makePseudonym(channel, externalId) {
    const hash = crypto
        .createHash('sha256')
        .update(`${channel}:${externalId}`)
        .digest('hex')
        .slice(0, 12);
    return `cust_${hash}`;
}

function normalizeStatus(wcStatus, appliedRules) {
    const mapped = STATUS_MAP[wcStatus];
    if (mapped) return mapped;
    appliedRules.push(`warn:unmapped_status:${wcStatus}`);
    return 'error';
}

// --- Main loop ---------------------------------------------------------------
const out = [];

for (const item of $input.all()) {
    const t0 = Date.now();
    // Soporta recibir el pedido en item.json.order (desde validate-wc-webhook)
    // o directo en item.json (test manual con el body crudo).
    const src = item.json || {};
    const wc = (src.order && typeof src.order === 'object') ? src.order : src;
    const appliedRules = [];

    // Customer (WooCommerce lo trae en `billing`)
    const billing = wc.billing || {};
    const fullName = [billing.first_name, billing.last_name].filter(Boolean).join(' ') || null;
    const email = billing.email || null;
    const phone = billing.phone || null;

    // Guest checkout → customer_id = 0; caemos al email como identificador.
    let externalCustomerId = (wc.customer_id && Number(wc.customer_id) > 0)
        ? String(wc.customer_id)
        : (email || null);
    if (!externalCustomerId) {
        appliedRules.push('warn:customer_id_and_email_missing');
    }

    const customer = {
        external_id: externalCustomerId,
        channel: CHANNEL,
        pseudonym: makePseudonym(CHANNEL, externalCustomerId || wc.id),
        full_name: fullName,
        email,
        phone,
        email_hash: sha256(email),
        phone_hash: sha256(phone),
    };

    // Order
    const status = normalizeStatus(wc.status, appliedRules);

    const order = {
        external_id: String(wc.id),
        channel: CHANNEL,
        status,
        total_amount: Number(wc.total) || 0,
        currency: wc.currency || 'ARS',
        source_created_at: wc.date_created_gmt || wc.date_created || new Date().toISOString(),
        raw_payload: wc,
        normalization_version: NORMALIZATION_VERSION,
    };

    // Items (WooCommerce los trae en `line_items`)
    const deliveryStatus = DELIVERY_BY_STATUS[status] || 'pending';
    const items = (wc.line_items || []).map((li) => ({
        sku: li.sku || (li.product_id ? String(li.product_id) : null),
        product_name: li.name || '(sin título)',
        quantity: Number(li.quantity) || 1,
        // WooCommerce: `price` es el precio unitario; `total`/`subtotal` son de la línea.
        unit_price: Number(li.price) || 0,
        delivery_status: deliveryStatus,
        metadata: {
            wc_item_id: li.id || null,
            product_id: li.product_id || null,
            variation_id: li.variation_id || null,
        },
    }));

    if (items.length === 0) {
        appliedRules.push('warn:no_items');
    }

    out.push({
        json: {
            customer,
            order,
            items,
            meta: {
                normalization_ms: Date.now() - t0,
                applied_rules: appliedRules,
                normalization_version: NORMALIZATION_VERSION,
            },
        },
    });
}

return out;
