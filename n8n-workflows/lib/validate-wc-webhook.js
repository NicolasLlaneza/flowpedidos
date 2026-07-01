// =============================================================================
// validate-wc-webhook.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" de n8n (modo: "Run Once for All Items") ubicado
// inmediatamente después del Webhook trigger de WooCommerce (/webhook/wc-order).
//
// Función:
//   - Valida la FIRMA HMAC-SHA256 que WooCommerce agrega en el header
//     `x-wc-webhook-signature` (base64 del HMAC del body crudo con el secret
//     definido en WooCommerce → Settings → Advanced → Webhooks).
//   - Detecta el "ping" que WooCommerce envía al crear/activar el webhook
//     (body sin `id`/`line_items`) para no procesarlo como pedido.
//   - Valida la estructura mínima del pedido (id, line_items, billing).
//   - A diferencia del webhook de ML, WooCommerce manda el PEDIDO COMPLETO en
//     el body: NO hay paso de enrich. Este nodo deja el pedido listo para
//     `normalize-wc-order.js`.
//
// IMPORTANTE — firma HMAC sobre el body CRUDO:
//   WooCommerce firma los bytes exactos del body. Si n8n re-serializa el JSON,
//   el orden de claves / escapes unicode puede cambiar y la firma no coincide.
//   Para una validación confiable, activá en el nodo Webhook:
//       Options → "Raw Body" = ON
//   Con eso el body crudo queda disponible y la firma valida siempre. Si no está
//   disponible, este nodo cae a JSON.stringify(body) como best-effort y lo avisa
//   en applied_rules (útil en dev, no confiar en prod).
//
// Secret: se lee de $env.WC_WEBHOOK_SECRET. Si no está seteado, la validación de
//   firma se OMITE (modo dev) y se registra un warning — así podés probar el
//   flujo antes de configurar el secret.
//
// Output esperado por item:
//   {
//     valid: true | false,
//     errors: [string],           // vacío si valid=true
//     is_ping: true | false,       // true = webhook de activación, no un pedido
//     signature_valid: true | false | null,  // null = no verificada (sin secret)
//     order: { ...pedido WooCommerce },       // body tal cual, para normalizar
//     channel: "woocommerce",
//     applied_rules: [string],
//     received_at: ISO timestamp
//   }
// =============================================================================

const crypto = require('crypto');

const CHANNEL = 'woocommerce';
const SECRET = (typeof $env !== 'undefined' && $env.WC_WEBHOOK_SECRET) || '';

// --- Helpers -----------------------------------------------------------------

// Intenta recuperar el body CRUDO (bytes exactos) para validar la firma.
// n8n con "Raw Body: ON" lo deja en item.binary.data (base64) o en rawBody.
function getRawBody(item, bodyObj) {
    if (item.json && typeof item.json.rawBody === 'string') return item.json.rawBody;
    if (item.binary && item.binary.data && item.binary.data.data) {
        try { return Buffer.from(item.binary.data.data, 'base64').toString('utf8'); }
        catch (e) { /* ignore */ }
    }
    // Best-effort: re-serializa el objeto. Puede no coincidir byte a byte.
    return { fallback: true, value: JSON.stringify(bodyObj) };
}

// Comparación en tiempo constante para evitar timing attacks.
function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(ba, bb); }
    catch (e) { return false; }
}

function getHeader(headers, name) {
    if (!headers) return null;
    // n8n normaliza los headers a minúsculas, pero soportamos ambos por las dudas.
    return headers[name] || headers[name.toLowerCase()] || null;
}

// --- Main loop ---------------------------------------------------------------
const results = [];

for (const item of $input.all()) {
    const raw = item.json || {};
    const headers = raw.headers || {};
    // El Webhook node de n8n envuelve el payload en item.json.body.
    const body = (raw.body && typeof raw.body === 'object') ? raw.body : raw;
    const errors = [];
    const appliedRules = [];

    // 1. Detectar el ping de activación (WooCommerce manda {"webhook_id": N})
    const isPing = body && body.webhook_id !== undefined
        && body.id === undefined && body.line_items === undefined;
    if (isPing) {
        results.push({
            json: {
                valid: false, errors: ['ping'], is_ping: true, signature_valid: null,
                order: null, channel: CHANNEL, applied_rules: ['info:webhook_ping'],
                received_at: new Date().toISOString(),
            },
        });
        continue;
    }

    // 2. Validar la firma HMAC-SHA256 (base64)
    let signatureValid = null;
    if (!SECRET) {
        appliedRules.push('warn:wc_secret_not_configured_signature_skipped');
    } else {
        const provided = getHeader(headers, 'x-wc-webhook-signature');
        if (!provided) {
            errors.push('missing_signature_header');
            signatureValid = false;
        } else {
            const rawBody = getRawBody(item, body);
            const rawValue = (rawBody && rawBody.fallback) ? rawBody.value : rawBody;
            if (rawBody && rawBody.fallback) {
                appliedRules.push('warn:raw_body_unavailable_used_stringify');
            }
            const expected = crypto.createHmac('sha256', SECRET)
                .update(rawValue, 'utf8').digest('base64');
            signatureValid = safeEqual(expected, provided);
            if (!signatureValid) errors.push('invalid_signature');
        }
    }

    // 3. Estructura mínima del pedido
    if (body.id === undefined || body.id === null) errors.push('missing_field:id');
    if (!Array.isArray(body.line_items)) errors.push('missing_field:line_items');
    if (!body.billing || typeof body.billing !== 'object') {
        appliedRules.push('warn:billing_missing');
    }

    results.push({
        json: {
            valid: errors.length === 0,
            errors,
            is_ping: false,
            signature_valid: signatureValid,
            order: body,
            channel: CHANNEL,
            applied_rules: appliedRules,
            received_at: new Date().toISOString(),
        },
    });
}

return results;
