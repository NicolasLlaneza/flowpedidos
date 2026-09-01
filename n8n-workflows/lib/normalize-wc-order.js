// =============================================================================
// normalize-wc-order.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" de n8n (modo: "Run Once for All Items") ubicado
// inmediatamente después del Webhook trigger de WooCommerce.
//
// Diferencia respecto del flujo ML:
//   - WC manda el pedido COMPLETO en el webhook (no necesita enrich extra)
//   - El shape es muy distinto: billing/shipping objects, line_items array,
//     status en lowercase con prefijos como 'wc-' en algunos casos
//
// Esta función traduce ese shape al MODELO CANÓNICO compartido con ML:
//   { customer, order, items, meta }
//
// A partir de este punto, el resto del pipeline es idéntico al de ML
// (idempotency → persist → IA → WhatsApp), por eso converge en el mismo
// formato canónico.
// =============================================================================

const crypto = require('crypto');

const NORMALIZATION_VERSION = 'v1';
const CHANNEL = 'woocommerce';

// --- Mapeo de estados WC → modelo canónico ----------------------------------
// WC nativos: pending, processing, on-hold, completed, cancelled, refunded, failed
const STATUS_MAP = {
    'pending':     'pending_payment',
    'on-hold':     'pending_payment',
    'processing':  'paid',         // pago confirmado, en preparación
    'completed':   'delivered',    // WC marca completed cuando ya se envió/entregó
    'cancelled':   'cancelled',
    'refunded':    'refunded',
    'failed':      'error',
};

// --- Helpers (mismas funciones que el normalizador de ML para consistencia) -
function sha256(value) {
    if (value === null || value === undefined || value === '') return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}
function makePseudonym(channel, externalId) {
    const hash = crypto.createHash('sha256').update(`${channel}:${externalId}`).digest('hex').slice(0, 12);
    return `cust_${hash}`;
}

// --- Main loop --------------------------------------------------------------
const out = [];

for (const item of $input.all()) {
    const t0 = Date.now();
    // v1.3: entre Validate WC webhook y este nodo se insertaron Persist raw
    // event WC + ACK 200 WC, por lo que $input ya no trae el body del pedido.
    // Se lee el pedido directamente desde Validate WC webhook, que lo emite
    // como `.order` (ver validate-wc-webhook.js).
    const wc = $('Validate WC webhook').item.json.order || {};

    const appliedRules = [];
    const billing = wc.billing || {};
    const shipping = wc.shipping || {};

    // El nombre real puede estar en billing (típicamente) o en shipping
    const fullName = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim()
        || [shipping.first_name, shipping.last_name].filter(Boolean).join(' ').trim()
        || null;
    const phone = billing.phone || shipping.phone || null;
    const email = billing.email || null;

    // WC tiene dos identificadores posibles del cliente:
    //   - customer_id (numérico, si es usuario registrado; 0 para guest checkouts)
    //   - email (fallback estable cuando es guest)
    let externalCustomerId = wc.customer_id && wc.customer_id !== 0
        ? String(wc.customer_id)
        : (email || null);

    // D1 (v1.3): si ninguno de los dos está disponible, se genera un identificador
    // sustituto determinístico `synthetic:{channel}:{order.external_id}`. Es
    // reproducible (mismo pedido reingresado hace UPSERT sobre la misma fila) y
    // trazable (el prefijo permite filtrar y contar sustituciones). Preserva la
    // integridad referencial (customers.external_id NOT NULL) sin bloquear el
    // pedido, según §4.6 del TFI corregido.
    if (!externalCustomerId) {
        externalCustomerId = `synthetic:${CHANNEL}:${wc.id}`;
        appliedRules.push('warn:customer_id_missing_substituted');
    }

    const customer = {
        external_id: externalCustomerId,
        channel: CHANNEL,
        pseudonym: makePseudonym(CHANNEL, externalCustomerId),
        full_name: fullName,
        email,
        phone,
        email_hash: sha256(email),
        phone_hash: sha256(phone),
    };

    // Status: WC a veces prefija con 'wc-' (status interno). Lo limpiamos.
    const rawStatus = String(wc.status || '').replace(/^wc-/, '').toLowerCase();
    const status = STATUS_MAP[rawStatus] || 'error';
    if (status === 'error') appliedRules.push(`warn:unmapped_status:${rawStatus}`);

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

    // Estado de envío: WC no tiene un campo shipping.status como ML. Lo derivamos
    // del estado del pedido.
    const deliveryStatus =
        status === 'cancelled' ? 'cancelled' :
        status === 'delivered' ? 'delivered' :
        status === 'paid'      ? 'preparing' :
                                 'pending';

    const items = (wc.line_items || []).map((li) => ({
        sku: li.sku || String(li.product_id) || null,
        product_name: li.name || '(sin título)',
        quantity: Number(li.quantity) || 1,
        // line_items.price es el unitario; total/subtotal son los del item completo
        unit_price: Number(li.price ?? li.subtotal) || 0,
        delivery_status: deliveryStatus,
        metadata: {
            wc_item_id: li.id ?? null,
            wc_product_id: li.product_id ?? null,
            wc_variation_id: li.variation_id ?? null,
            tax_total: li.total_tax ?? null,
        },
    }));
    if (items.length === 0) appliedRules.push('warn:no_items');

    // v1.3: raw_event_id y ack_at vienen del nodo Persist raw event WC
    // (§4.1.1 del TFI corregido). El ack_at se persiste en tfi.orders y la
    // ventana received_at→ack_at debe quedar por debajo de 500 ms.
    const rawEvt = $('Persist raw event WC').item.json;

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
                source_channel: CHANNEL,
            },
        },
    });
}

return out;
