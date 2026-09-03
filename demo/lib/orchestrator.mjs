// =============================================================================
// orchestrator.mjs — Orquestación del pipeline (devuelve datos estructurados)
// -----------------------------------------------------------------------------
// Misma lógica que el pipeline real, pero:
//   - acepta el canal de origen (para simular multicanal)
//   - cachea los mensajes de IA (no quema crédito en cada corrida)
//   - devuelve datos pensados para la vista de negocio (nombre real del
//     cliente para el vendedor, producto, canal, mensaje)
// =============================================================================

import {
    validateWebhook, normalizeOrder, buildPrompt,
    callOpenAI, parseResponse, fallbackTemplate,
} from './pipeline.mjs';
import { getCached, setCached } from './ai-cache.mjs';

const MOCK_URL = process.env.MOCK_URL || 'http://localhost:3001';

async function auditLog(client, orderId, eventType, severity, component, message, payload) {
    await client.query(
        `INSERT INTO tfi.audit_log (order_id, event_type, severity, component, message, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [orderId, eventType, severity, component, message, JSON.stringify(payload || {})]
    );
}

export async function processWebhook(client, webhook, opts = {}) {
    const apiKey = opts.apiKey;
    const channel = opts.channel || 'mercadolibre';
    const useCache = opts.useCache !== false;
    const steps = [];
    const t0 = Date.now();
    const push = (label, status, detail) => steps.push({ n: steps.length + 1, label, status, detail });

    // 1. Validación
    const v = validateWebhook(webhook);
    if (!v.valid) {
        push('Validación', 'error', `rechazado: ${v.errors.join(', ')}`);
        await auditLog(client, null, 'validation_failed', 'warning', 'webhook',
            `Webhook inválido: ${v.errors.join(', ')}`, { errors: v.errors });
        return { result: 'rejected', channel, steps, errors: v.errors };
    }
    push('Recepción y validación', 'ok', 'datos completos');

    // 2. Enrich
    let mlOrder;
    try {
        const r = await fetch(`${MOCK_URL}/orders/${v.orderId}`);
        if (!r.ok) throw new Error(`mock devolvió ${r.status}`);
        mlOrder = await r.json();
        push('Consulta del pedido completo', 'ok', `orden ${mlOrder.id}`);
    } catch (e) {
        push('Consulta del pedido completo', 'error', e.message);
        return { result: 'error', channel, steps };
    }

    // 3. Normalización (con el canal de origen simulado)
    const norm = normalizeOrder(mlOrder, channel);
    push('Organización de datos', 'ok', `estado: ${norm.order.status}`);

    // 4. Idempotencia
    const dupCheck = await client.query(
        'SELECT id FROM tfi.orders WHERE external_id=$1 AND channel=$2',
        [norm.order.external_id, norm.order.channel]
    );
    if (dupCheck.rows.length > 0) {
        push('Control de duplicados', 'warn', 'pedido repetido — bloqueado');
        await auditLog(client, dupCheck.rows[0].id, 'duplicate_detected', 'info', 'persister',
            'Webhook reenviado de orden ya procesada', { external_id: norm.order.external_id });
        return {
            result: 'duplicate',
            channel,
            order_external: norm.order.external_id,
            customer_name: [mlOrder.buyer?.first_name, mlOrder.buyer?.last_name].filter(Boolean).join(' '),
            status: norm.order.status,
            steps,
        };
    }
    push('Control de duplicados', 'ok', 'pedido nuevo');

    // 5-7. Persistencia
    const cRes = await client.query(
        `INSERT INTO tfi.customers (external_id, channel, pseudonym, full_name, email, phone, email_hash, phone_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (external_id, channel) DO UPDATE SET updated_at=now()
         RETURNING id, pseudonym, full_name`,
        [norm.customer.external_id, norm.customer.channel, norm.customer.pseudonym,
         norm.customer.full_name, norm.customer.email, norm.customer.phone,
         norm.customer.email_hash, norm.customer.phone_hash]
    );
    const customerId = cRes.rows[0].id;

    const oRes = await client.query(
        `INSERT INTO tfi.orders (external_id, channel, customer_id, status, total_amount, currency, source_created_at, raw_payload, normalization_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (external_id, channel) DO NOTHING
         RETURNING id`,
        [norm.order.external_id, norm.order.channel, customerId, norm.order.status,
         norm.order.total_amount, norm.order.currency, norm.order.source_created_at,
         JSON.stringify(norm.order.raw_payload), norm.order.normalization_version]
    );
    const orderId = oRes.rows[0].id;

    for (const it of norm.items) {
        await client.query(
            `INSERT INTO tfi.order_items (order_id, sku, product_name, quantity, unit_price, delivery_status, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [orderId, it.sku, it.product_name, it.quantity, it.unit_price, it.delivery_status, JSON.stringify(it.metadata)]
        );
    }
    push('Registro centralizado', 'ok', `${norm.items.length} producto(s)`);
    await auditLog(client, orderId, 'persisted_ok', 'info', 'persister', 'Pedido registrado', { status: norm.order.status });

    // 8-9. Mensaje (cache → IA → fallback)
    const prompt = buildPrompt(norm);
    let notif, source;

    if (opts.forceFallback) {
        notif = fallbackTemplate(norm.order.status, 'fallo simulado de servicio');
        source = 'fallback';
        push('Mensaje al cliente', 'warn', 'respaldo (servicio caído)');
    } else {
        const cached = useCache ? getCached(channel, norm.order.external_id) : null;
        if (cached) {
            notif = { ...cached, is_fallback: false };
            source = 'cache';
            push('Mensaje al cliente', 'ok', 'generado por IA');
        } else {
            try {
                const { data, latency_ms } = await callOpenAI(prompt.messages, apiKey);
                const parsed = parseResponse(data, latency_ms);
                if (!parsed.valid) throw new Error(parsed.errors.join(','));
                notif = { provider: 'openai', model: 'gpt-4o-mini', prompt_version: prompt.prompt_version, ...parsed, is_fallback: false };
                setCached(channel, norm.order.external_id, {
                    provider: 'openai', model: 'gpt-4o-mini',
                    message_text: parsed.message_text, tone: parsed.tone, confidence: parsed.confidence,
                    prompt_tokens: parsed.prompt_tokens, completion_tokens: parsed.completion_tokens,
                    cost_usd: parsed.cost_usd, latency_ms: parsed.latency_ms,
                });
                source = 'openai';
                push('Mensaje al cliente', 'ok', 'generado por IA');
            } catch (e) {
                notif = fallbackTemplate(norm.order.status, e.message.slice(0, 40));
                source = 'fallback';
                push('Mensaje al cliente', 'warn', 'respaldo (servicio caído)');
            }
        }
    }

    await client.query(
        `INSERT INTO tfi.ai_notifications
         (order_id, provider, model, prompt_version, prompt_tokens, completion_tokens, cost_usd, latency_ms, message_text, message_status, is_fallback)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, notif.provider, notif.model || null, notif.prompt_version || null,
         notif.prompt_tokens || null, notif.completion_tokens || null,
         notif.cost_usd || 0, notif.latency_ms || 0, notif.message_text, 'validated', notif.is_fallback]
    );
    await auditLog(client, orderId, notif.is_fallback ? 'fallback_triggered' : 'llm_call_ok',
        notif.is_fallback ? 'warning' : 'info', 'llm',
        notif.is_fallback ? 'Degradación a plantilla' : 'Mensaje generado por IA',
        { source, cost_usd: notif.cost_usd, latency_ms: notif.latency_ms });

    const buyer = mlOrder.buyer || {};
    return {
        result: 'processed',
        channel,
        order_external: norm.order.external_id,
        order_id: orderId,
        status: norm.order.status,
        total: norm.order.total_amount,
        currency: norm.order.currency,
        customer_name: [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || 'Cliente',
        customer_pseudonym: norm.customer.pseudonym,
        primary_product: norm.items[0] ? norm.items[0].product_name : '(sin productos)',
        items_count: norm.items.length,
        message: {
            text: notif.message_text,
            tone: notif.tone,
            is_fallback: notif.is_fallback,
            source, // openai | cache | fallback
        },
        elapsed_ms: Date.now() - t0,
        steps,
    };
}

// --- Lista de pedidos a seedear (panel operativo) ---------------------------
// Conjunto curado que cubre TODOS los estados del ciclo de vida del pedido,
// para que el panel muestre variedad realista. Los números de pedido se eligen
// según la distribución del dataset (dataset/seed-42), evitando los casos que
// rompen la persistencia (pedido 20 = comprador sin id, pedido 48 = sin items).
// Canal asignado round-robin para mostrar multicanal.
const SEED_CHANNELS = ['mercadolibre', 'whatsapp', 'woocommerce', 'tienda_nube'];
const SEED_ORDER_NUMBERS = [
    // paid (1-18)
    1, 2, 3, 4, 7, 9, 11, 14,
    // shipped (19-30)
    21, 23, 25, 27, 30,
    // delivered (31-38)
    31, 32, 35, 38,
    // pending_payment (39-42)
    39, 40,
    // cancelled (43-46)
    43, 45,
    // refunded (47-48) — 47 es válido, 48 no tiene items
    47,
    // error: estado ML no mapeable (49-50)
    49,
];
export function seedList() {
    return SEED_ORDER_NUMBERS.map((n, idx) => ({
        id: String(3000000000000000 + n),
        channel: SEED_CHANNELS[idx % SEED_CHANNELS.length],
    }));
}

// --- KPIs del panel (operativo + técnico, v1.3) ------------------------------
// - pedidos_hoy / ingresos_hoy → visión PyME
// - tasa_entrega → % de ai_notifications con message_status='sent'
// - cost_hoy_usd → costo real acumulado del LLM en el día
// - pedidos_total y mensajes_total → totales para vista de auditoría
export async function getKpis(client) {
    const r = await client.query(`
        WITH hoy AS (SELECT date_trunc('day', now()) AS d)
        SELECT
          (SELECT count(*)  FROM tfi.orders o, hoy WHERE o.received_at >= hoy.d)                           AS pedidos_hoy,
          (SELECT count(*)  FROM tfi.orders)                                                                AS pedidos_total,
          (SELECT coalesce(sum(o.total_amount),0) FROM tfi.orders o, hoy
             WHERE o.received_at >= hoy.d AND o.status <> 'cancelled')                                      AS ingresos_hoy,
          (SELECT count(*)  FROM tfi.orders WHERE status IN ('created','pending_payment'))                  AS pendientes,
          (SELECT count(*)  FROM tfi.orders WHERE status = 'error')                                         AS errores,
          (SELECT count(*)  FROM tfi.ai_notifications)                                                      AS mensajes_total,
          (SELECT count(*)  FROM tfi.ai_notifications WHERE message_status = 'sent')                        AS mensajes_enviados,
          (SELECT count(*)  FROM tfi.ai_notifications WHERE is_fallback = true)                             AS mensajes_fallback,
          (SELECT coalesce(sum(cost_usd),0) FROM tfi.ai_notifications n, hoy
             WHERE n.generated_at >= hoy.d)                                                                 AS cost_hoy_usd,
          (SELECT coalesce(sum(cost_usd),0) FROM tfi.ai_notifications)                                      AS cost_total_usd,
          (SELECT count(DISTINCT channel) FROM tfi.orders)                                                  AS canales
    `);
    const k = r.rows[0];
    const enviados = Number(k.mensajes_enviados);
    const totalMsg = Number(k.mensajes_total);
    k.tasa_entrega = totalMsg > 0 ? enviados / totalMsg : 0;
    return k;
}

// --- Listado filtrable -------------------------------------------------------
// Enriquecido con campos v1.3 que el panel técnico necesita:
//   wa_message_id, validator_passes, cost_usd, message_status.
export async function getOrders(client, { channel, status, q } = {}) {
    const where = [];
    const params = [];
    if (channel) { params.push(channel); where.push(`o.channel = $${params.length}`); }
    if (status)  { params.push(status);  where.push(`o.status  = $${params.length}`); }
    if (q) {
        params.push(`%${q.toLowerCase()}%`);
        const i = params.length;
        where.push(`(lower(c.full_name) LIKE $${i} OR lower(o.external_id) LIKE $${i}
                     OR EXISTS (SELECT 1 FROM tfi.order_items it WHERE it.order_id=o.id AND lower(it.product_name) LIKE $${i}))`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await client.query(`
        SELECT o.id, o.external_id, o.channel, o.status,
               o.total_amount, o.currency, o.received_at, o.ack_at,
               EXTRACT(EPOCH FROM (o.ack_at - o.received_at)) * 1000 AS ack_ms,
               c.full_name AS customer_name,
               (SELECT product_name FROM tfi.order_items it WHERE it.order_id=o.id LIMIT 1) AS product,
               (SELECT count(*) FROM tfi.order_items it WHERE it.order_id=o.id)             AS items_count,
               n.provider, n.is_fallback, n.message_status,
               n.wa_message_id,
               n.validator_passes,
               n.cost_usd,
               n.dispatched_at,
               EXTRACT(EPOCH FROM (n.dispatched_at - o.received_at)) * 1000 AS e2e_ms
        FROM tfi.orders o
        LEFT JOIN tfi.customers c        ON c.id = o.customer_id
        LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
        ${whereSql}
        ORDER BY o.received_at DESC
    `, params);
    return r.rows;
}

// --- Detalle de un pedido con trazabilidad -----------------------------------
// Devuelve todo lo que el panel muestra en el lado derecho: cliente, items,
// notificación (con métricas técnicas del bloque B), audit_log completo.
export async function getOrderDetail(client, externalId) {
    const oRes = await client.query(`
        SELECT o.*, c.full_name AS customer_name, c.pseudonym, c.email, c.phone,
               EXTRACT(EPOCH FROM (o.ack_at - o.received_at)) * 1000 AS ack_ms
        FROM tfi.orders o LEFT JOIN tfi.customers c ON c.id=o.customer_id
        WHERE o.external_id = $1 LIMIT 1`, [externalId]);
    if (!oRes.rows.length) return null;
    const order = oRes.rows[0];
    const items = (await client.query(
        `SELECT product_name, quantity, unit_price, delivery_status
         FROM tfi.order_items WHERE order_id=$1`, [order.id])).rows;
    const notif = (await client.query(`
        SELECT provider, model, prompt_version, prompt_tokens, completion_tokens, cost_usd,
               latency_ms, message_text, message_status, is_fallback,
               atributos_usados, validator_passes, validator_failures,
               wa_message_id, sent_at, dispatched_at, error_message,
               EXTRACT(EPOCH FROM (dispatched_at - $2::timestamptz)) * 1000 AS e2e_ms,
               (wa_message_id LIKE 'wamid.sim_%') AS wa_simulated
        FROM tfi.ai_notifications
        WHERE order_id=$1 ORDER BY generated_at DESC LIMIT 1`,
        [order.id, order.received_at])).rows[0] || null;
    const audit = (await client.query(
        `SELECT event_type, severity, component, message, created_at
         FROM tfi.audit_log WHERE order_id=$1 ORDER BY created_at ASC`, [order.id])).rows;
    return { order, items, notif, audit };
}

// Estado actual para el panel del vendedor
export async function getState(client) {
    const counts = await client.query(`
        SELECT
          (SELECT count(*) FROM tfi.orders)                          AS pedidos,
          (SELECT count(DISTINCT channel) FROM tfi.orders)           AS canales,
          (SELECT count(*) FROM tfi.ai_notifications WHERE NOT is_fallback) AS mensajes_ia,
          (SELECT count(*) FROM tfi.audit_log)                       AS eventos
    `);
    const orders = await client.query(`
        SELECT o.external_id, o.channel, o.status, o.total_amount, o.currency,
               c.full_name, c.pseudonym,
               (SELECT product_name FROM tfi.order_items i WHERE i.order_id=o.id LIMIT 1) AS product,
               n.message_text, n.provider, n.is_fallback
        FROM tfi.orders o
        LEFT JOIN tfi.customers c ON c.id = o.customer_id
        LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
        ORDER BY o.received_at
    `);
    return { counts: counts.rows[0], orders: orders.rows };
}
