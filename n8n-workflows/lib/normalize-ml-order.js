// =============================================================================
// normalize-ml-order.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" de n8n (modo: "Run Once for All Items") ubicado
// después del HTTP Request que trae /orders/{id} desde mock-marketplace.
//
// Función:
//   - Mapea la estructura cruda de Mercado Libre al modelo canónico
//   - Calcula SHA-256 de email y teléfono (para dedupe futuro sin exponer PII)
//   - Genera pseudonym determinístico por (channel, external_id)
//   - Normaliza el estado del pedido al dominio del CHECK constraint en tfi.orders
//   - Devuelve un objeto listo para los nodos Postgres siguientes
//
// Input por item (lo que devuelve el HTTP Request):
//   { id, status, buyer, order_items, total_amount, currency_id, ... }
//
// Output por item:
//   {
//     customer: { external_id, channel, pseudonym, full_name, email, phone,
//                 email_hash, phone_hash },
//     order:    { external_id, channel, status, total_amount, currency,
//                 source_created_at, raw_payload, normalization_version },
//     items:    [{ sku, product_name, quantity, unit_price, delivery_status }],
//     meta:     { normalization_ms, applied_rules }
//   }
// =============================================================================

const crypto = require('crypto');

const NORMALIZATION_VERSION = 'v1';
const CHANNEL = 'mercadolibre';

// --- Mapeo de estados ML → modelo canónico -----------------------------------
// El CHECK constraint en tfi.orders sólo permite estos valores:
//   created, pending_payment, paid, preparing, shipped, delivered, cancelled,
//   refunded, error
const STATUS_MAP = {
    // ML real puede mandar: confirmed, payment_required, payment_in_process,
    // partially_paid, paid, partially_refunded, pending_cancel, cancelled,
    // invalid, ...
    confirmed:            'created',
    payment_required:     'pending_payment',
    payment_in_process:   'pending_payment',
    partially_paid:       'pending_payment',
    paid:                 'paid',
    preparing:            'preparing',  // estado custom si lo usamos
    shipped:              'shipped',
    delivered:            'delivered',
    partially_refunded:   'refunded',
    refunded:             'refunded',
    pending_cancel:       'cancelled',
    cancelled:            'cancelled',
    invalid:              'error',
};

// --- Mapeo de shipping status ML → delivery_status canónico ------------------
const DELIVERY_STATUS_MAP = {
    pending:        'pending',
    handling:       'preparing',
    ready_to_ship:  'preparing',
    shipped:        'shipped',
    delivered:      'delivered',
    not_delivered: 'pending',
    cancelled:      'cancelled',
    returned:       'returned',
};

// --- Helpers -----------------------------------------------------------------
function sha256(value) {
    if (value === null || value === undefined || value === '') return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}

function makePseudonym(channel, externalId) {
    // Determinístico: misma combinación siempre da el mismo pseudonym.
    // Sirve para deduplicar entre webhooks repetidos y mantener trazabilidad
    // sin exponer el id real al LLM.
    const hash = crypto
        .createHash('sha256')
        .update(`${channel}:${externalId}`)
        .digest('hex')
        .slice(0, 12);
    return `cust_${hash}`;
}

function buildPhoneString(phone) {
    if (!phone) return null;
    const area = phone.area_code || '';
    const num = phone.number || '';
    return area && num ? `${area}${num}` : (num || null);
}

function normalizeStatus(mlStatus, mlStatusDetail) {
    const mapped = STATUS_MAP[mlStatus];
    if (mapped) return mapped;
    // Status desconocido: lo registramos en applied_rules y devolvemos 'error'
    // para que un humano lo revise; mejor que omitir o adivinar.
    return 'error';
}

function deriveDeliveryStatus(orderStatus, shippingStatus) {
    if (orderStatus === 'cancelled') return 'cancelled';
    if (shippingStatus && DELIVERY_STATUS_MAP[shippingStatus]) {
        return DELIVERY_STATUS_MAP[shippingStatus];
    }
    return 'pending';
}

// --- Main loop ---------------------------------------------------------------
const out = [];

for (const item of $input.all()) {
    const t0 = Date.now();
    const ml = item.json;
    const appliedRules = [];

    // Customer
    const buyer = ml.buyer || {};
    const fullName = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || null;
    const phone = buildPhoneString(buyer.phone);

    // D1 (v1.3): si el buyer_id viene nulo, se genera un identificador sustituto
    // determinístico `synthetic:{channel}:{order.external_id}`. Es reproducible
    // (mismo pedido reingresado hace UPSERT sobre la misma fila) y trazable
    // (el prefijo permite filtrar y contar sustituciones). Preserva la
    // integridad referencial (customers.external_id NOT NULL) sin bloquear
    // el pedido, según §4.6 del TFI corregido.
    let externalCustomerId = buyer.id ? String(buyer.id) : null;
    if (!externalCustomerId) {
        externalCustomerId = `synthetic:${CHANNEL}:${ml.id}`;
        appliedRules.push('warn:buyer_id_missing_substituted');
    }

    const customer = {
        external_id: externalCustomerId,
        channel: CHANNEL,
        pseudonym: makePseudonym(CHANNEL, externalCustomerId),
        full_name: fullName,
        email: buyer.email || null,
        phone,
        email_hash: sha256(buyer.email),
        phone_hash: sha256(phone),
    };

    // Order
    const status = normalizeStatus(ml.status, ml.status_detail);
    if (status === 'error') {
        appliedRules.push(`warn:unmapped_status:${ml.status}`);
    }

    const order = {
        external_id: String(ml.id),
        channel: CHANNEL,
        status,
        total_amount: Number(ml.total_amount) || 0,
        currency: ml.currency_id || 'ARS',
        source_created_at: ml.date_created || new Date().toISOString(),
        raw_payload: ml,
        normalization_version: NORMALIZATION_VERSION,
    };

    // Items
    const shippingStatus = ml.shipping && ml.shipping.status;
    const deliveryStatus = deriveDeliveryStatus(status, shippingStatus);

    const items = (ml.order_items || []).map((oi) => {
        const itm = oi.item || {};
        return {
            sku: itm.seller_custom_field || itm.id || null,
            product_name: itm.title || '(sin título)',
            quantity: Number(oi.quantity) || 1,
            unit_price: Number(oi.unit_price) || 0,
            delivery_status: deliveryStatus,
            metadata: {
                ml_item_id: itm.id || null,
                category_id: itm.category_id || null,
                warranty: itm.warranty || null,
                sale_fee: oi.sale_fee || null,
            },
        };
    });

    if (items.length === 0) {
        appliedRules.push('warn:no_items');
    }

    // v1.3: raw_event_id y ack_at vienen del nodo Persist raw event ML
    // (§4.1.1 del TFI corregido). El ack_at se persiste en tfi.orders y la
    // ventana received_at→ack_at debe quedar por debajo de 500 ms.
    const rawEvt = $('Persist raw event ML').item.json;

    out.push({
        json: {
            customer,
            order,
            items,
            raw_event_id: rawEvt.raw_event_id,
            ack_at: rawEvt.ack_at,
            meta: {
                normalization_ms: Date.now() - t0,
                applied_rules: appliedRules,
                normalization_version: NORMALIZATION_VERSION,
            },
        },
    });
}

return out;
