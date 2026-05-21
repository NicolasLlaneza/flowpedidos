// =============================================================================
// pipeline.mjs — Lógica del pipeline FlowPedidos (versión standalone)
// -----------------------------------------------------------------------------
// Replica EXACTAMENTE la lógica de los nodos n8n (n8n-workflows/lib/*.js) pero
// como funciones puras de Node, para poder ejecutar el pipeline completo desde
// la línea de comandos y demostrar que la lógica funciona end-to-end.
//
// Cada función corresponde a un nodo del workflow:
//   validateWebhook   → validate-webhook.js
//   normalizeOrder    → normalize-ml-order.js
//   buildPrompt       → build-llm-prompt.js
//   parseResponse     → parse-llm-response.js
//   fallbackTemplate  → fallback-template.js
// =============================================================================

import crypto from 'node:crypto';

const NORMALIZATION_VERSION = 'v1';
const PROMPT_VERSION = 'v1';
const CHANNEL = 'mercadolibre';

// --- Validación del webhook --------------------------------------------------
export function validateWebhook(payload) {
    const REQUIRED = ['resource', 'topic', 'user_id'];
    const RESOURCE_PATTERN = /^\/orders\/(\d+)$/;
    const SUPPORTED_TOPICS = ['orders_v2'];
    const errors = [];

    for (const f of REQUIRED) {
        if (payload[f] === undefined || payload[f] === null) errors.push(`missing_field:${f}`);
    }
    let orderId = null;
    if (payload.resource) {
        const m = String(payload.resource).match(RESOURCE_PATTERN);
        if (m) orderId = m[1];
        else errors.push(`invalid_resource_format:${payload.resource}`);
    }
    if (payload.topic && !SUPPORTED_TOPICS.includes(payload.topic)) {
        errors.push(`unsupported_topic:${payload.topic}`);
    }
    return { valid: errors.length === 0, errors, orderId, channel: CHANNEL };
}

// --- Helpers de normalización ------------------------------------------------
function sha256(value) {
    if (value === null || value === undefined || value === '') return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}
function makePseudonym(channel, externalId) {
    const hash = crypto.createHash('sha256').update(`${channel}:${externalId}`).digest('hex').slice(0, 12);
    return `cust_${hash}`;
}
function buildPhone(phone) {
    if (!phone) return null;
    const area = phone.area_code || '';
    const num = phone.number || '';
    return area && num ? `${area}${num}` : (num || null);
}

const STATUS_MAP = {
    confirmed: 'created', payment_required: 'pending_payment',
    payment_in_process: 'pending_payment', partially_paid: 'pending_payment',
    paid: 'paid', preparing: 'preparing', shipped: 'shipped', delivered: 'delivered',
    partially_refunded: 'refunded', refunded: 'refunded',
    pending_cancel: 'cancelled', cancelled: 'cancelled', invalid: 'error',
};
const DELIVERY_MAP = {
    pending: 'pending', handling: 'preparing', ready_to_ship: 'preparing',
    shipped: 'shipped', delivered: 'delivered', not_delivered: 'pending',
    cancelled: 'cancelled', returned: 'returned',
};

// --- Normalización ML → canónico ---------------------------------------------
export function normalizeOrder(ml) {
    const appliedRules = [];
    const buyer = ml.buyer || {};
    const fullName = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || null;
    const phone = buildPhone(buyer.phone);
    const externalCustomerId = buyer.id ? String(buyer.id) : null;
    if (!externalCustomerId) appliedRules.push('warn:buyer_id_missing');

    const customer = {
        external_id: externalCustomerId,
        channel: CHANNEL,
        pseudonym: makePseudonym(CHANNEL, externalCustomerId || ml.id),
        full_name: fullName,
        email: buyer.email || null,
        phone,
        email_hash: sha256(buyer.email),
        phone_hash: sha256(phone),
    };

    const status = STATUS_MAP[ml.status] || 'error';
    if (status === 'error') appliedRules.push(`warn:unmapped_status:${ml.status}`);

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

    const shippingStatus = ml.shipping && ml.shipping.status;
    const deliveryStatus = status === 'cancelled' ? 'cancelled'
        : (DELIVERY_MAP[shippingStatus] || 'pending');

    const items = (ml.order_items || []).map((oi) => {
        const itm = oi.item || {};
        return {
            sku: itm.seller_custom_field || itm.id || null,
            product_name: itm.title || '(sin título)',
            quantity: Number(oi.quantity) || 1,
            unit_price: Number(oi.unit_price) || 0,
            delivery_status: deliveryStatus,
            metadata: { ml_item_id: itm.id || null, category_id: itm.category_id || null },
        };
    });
    if (items.length === 0) appliedRules.push('warn:no_items');

    return { customer, order, items, appliedRules };
}

// --- Construcción del prompt (con guard anti-PII) ----------------------------
const SYSTEM_MESSAGE = `Sos un asistente de comunicación post-venta para una PyME argentina que vende online. Tu tarea es redactar mensajes cortos y cordiales para el comprador según el estado de su pedido.

REGLAS:
1. Solo usar la información del contexto. Si falta un dato, omitilo, no lo inventes.
2. No incluir razonamiento ni meta-comentarios.
3. No mencionar "IA", "modelo de lenguaje" ni similares.
4. Tono argentino neutro, cordial. Usá "vos".
5. Máximo 3 oraciones. Sin emojis.
6. No prometer tiempos de entrega ni descuentos no confirmados.

Devolvé SOLO un objeto JSON: {"message":"...","tone":"informativo|cordial|disculpa|celebratorio","confidence":0.0-1.0}`;

export function buildPrompt(normalized) {
    const { customer, order, items } = normalized;
    const primary = items.length
        ? [...items].sort((a, b) => b.unit_price * b.quantity - a.unit_price * a.quantity)[0].product_name
        : null;

    const ctx = {
        customer_pseudonym: customer.pseudonym,
        order_status: order.status,
        items_count: items.length,
        primary_product_name: primary,
        channel: order.channel,
        total_amount: order.total_amount,
        currency: order.currency,
        source_created_at: order.source_created_at,
    };

    // Guard anti-PII: aborta si se coló info personal en el contexto
    const piiKeys = ['full_name', 'email', 'phone', 'doc_number', 'address', 'first_name', 'last_name'];
    const ctxStr = JSON.stringify(ctx).toLowerCase();
    for (const k of piiKeys) {
        if (ctxStr.includes(`"${k}"`)) throw new Error(`PII leak detectado: ${k}`);
    }

    const userMessage = `Contexto del pedido:
- Cliente: ${ctx.customer_pseudonym}
- Estado: ${ctx.order_status}
- Productos: ${ctx.items_count}
- Producto principal: ${ctx.primary_product_name || '(no especificado)'}
- Total: ${ctx.total_amount} ${ctx.currency}

Generá el mensaje según las reglas.`;

    return {
        messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user', content: userMessage },
        ],
        sent_context: ctx,
        prompt_version: PROMPT_VERSION,
    };
}

// --- Llamada real a OpenAI ---------------------------------------------------
const PRICING = { 'gpt-4o-mini': { input: 0.15, output: 0.60 } };

export async function callOpenAI(messages, apiKey, model = 'gpt-4o-mini') {
    const t0 = Date.now();
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.4,
            max_tokens: 220,
            response_format: { type: 'json_object' },
            seed: 42,
        }),
        signal: AbortSignal.timeout(20000),
    });

    const latency_ms = Date.now() - t0;
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`OpenAI ${resp.status}: ${body.slice(0, 120)}`);
    }
    const data = await resp.json();
    return { data, latency_ms };
}

// --- Parseo y validación de la respuesta -------------------------------------
export function parseResponse(data, latency_ms, model = 'gpt-4o-mini') {
    const MIN_CONFIDENCE = 0.3;
    const choice = data.choices && data.choices[0];
    const text = choice && choice.message && choice.message.content;
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || null;
    const completionTokens = usage.completion_tokens || null;

    const tier = PRICING[model];
    const cost_usd = tier
        ? Number(((promptTokens || 0) * tier.input / 1e6 + (completionTokens || 0) * tier.output / 1e6).toFixed(6))
        : null;

    const errors = [];
    let parsed = null;
    try {
        const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
    } catch (e) {
        errors.push(`invalid_json:${e.message}`);
    }
    if (parsed) {
        if (typeof parsed.message !== 'string' || parsed.message.length < 20) errors.push('message_invalid');
        if (typeof parsed.confidence === 'number' && parsed.confidence < MIN_CONFIDENCE) errors.push(`low_confidence:${parsed.confidence}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        message_text: parsed && parsed.message,
        tone: parsed && parsed.tone,
        confidence: parsed && parsed.confidence,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost_usd,
        latency_ms,
    };
}

// --- Plantilla de fallback ---------------------------------------------------
const TEMPLATES = {
    created: 'Recibimos tu compra. Te avisamos en cuanto se confirme el pago.',
    pending_payment: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, puede demorar unos minutos.',
    paid: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.',
    preparing: 'Tu pedido se está preparando. Te avisamos en cuanto lo despachemos.',
    shipped: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días.',
    delivered: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra!',
    cancelled: 'Tu pedido fue cancelado. Si fue un error, contactanos para resolverlo.',
    refunded: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en reflejarse.',
    error: 'Estamos revisando tu pedido. Te contactamos en cuanto tengamos novedades.',
};

export function fallbackTemplate(status, reason) {
    return {
        provider: 'template',
        model: null,
        prompt_version: null,
        message_text: TEMPLATES[status] || TEMPLATES.error,
        tone: 'informativo',
        confidence: 1.0,
        is_fallback: true,
        cost_usd: 0,
        latency_ms: 0,
        fallback_reason: reason,
    };
}
