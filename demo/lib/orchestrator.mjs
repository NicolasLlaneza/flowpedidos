// =============================================================================
// orchestrator.mjs — Orquestación del pipeline (devuelve datos estructurados)
// -----------------------------------------------------------------------------
// Misma lógica que run-demo.mjs pero sin imprimir a consola: devuelve un objeto
// con los pasos y el resultado, para que lo consuma el dashboard web.
// =============================================================================

import {
    validateWebhook, normalizeOrder, buildPrompt,
    callOpenAI, parseResponse, fallbackTemplate,
} from './pipeline.mjs';

const MOCK_URL = process.env.MOCK_URL || 'http://localhost:3001';

async function auditLog(client, orderId, eventType, severity, component, message, payload) {
    await client.query(
        `INSERT INTO tfi.audit_log (order_id, event_type, severity, component, message, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [orderId, eventType, severity, component, message, JSON.stringify(payload || {})]
    );
}

// Procesa un webhook y devuelve el detalle estructurado de cada paso.
export async function processWebhook(client, webhook, opts = {}) {
    const apiKey = opts.apiKey;
    const steps = [];
    const t0 = Date.now();
    const push = (label, status, detail) => steps.push({ n: steps.length + 1, label, status, detail });

    // 1. Validación
    const v = validateWebhook(webhook);
    if (!v.valid) {
        push('Validación de estructura', 'error', `rechazado: ${v.errors.join(', ')}`);
        await auditLog(client, null, 'validation_failed', 'warning', 'webhook',
            `Webhook inválido: ${v.errors.join(', ')}`, { errors: v.errors });
        return { result: 'rejected', order_external: webhook.resource || '(sin resource)', steps, errors: v.errors };
    }
    push('Webhook recibido y validado', 'ok', `topic=${webhook.topic}`);

    // 2. Enrich
    let mlOrder;
    try {
        const r = await fetch(`${MOCK_URL}/orders/${v.orderId}`);
        if (!r.ok) throw new Error(`mock devolvió ${r.status}`);
        mlOrder = await r.json();
        push('Consulta a la plataforma (enrich)', 'ok', `orden ${mlOrder.id}`);
    } catch (e) {
        push('Consulta a la plataforma (enrich)', 'error', e.message);
        return { result: 'error', order_external: v.orderId, steps };
    }

    // 3. Normalización
    const norm = normalizeOrder(mlOrder);
    push('Normalización al modelo canónico', 'ok', `estado: ${norm.order.status}`);

    // 4. Idempotencia
    const dupCheck = await client.query(
        'SELECT id FROM tfi.orders WHERE external_id=$1 AND channel=$2',
        [norm.order.external_id, norm.order.channel]
    );
    if (dupCheck.rows.length > 0) {
        push('Control de duplicados', 'warn', 'YA EXISTE — bloqueado');
        await auditLog(client, dupCheck.rows[0].id, 'duplicate_detected', 'info', 'persister',
            'Webhook reenviado de orden ya procesada', { external_id: norm.order.external_id });
        return {
            result: 'duplicate',
            order_external: norm.order.external_id,
            status: norm.order.status,
            steps,
        };
    }
    push('Control de duplicados', 'ok', 'nuevo');

    // 5. Cliente
    const cRes = await client.query(
        `INSERT INTO tfi.customers (external_id, channel, pseudonym, full_name, email, phone, email_hash, phone_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (external_id, channel) DO UPDATE SET updated_at=now()
         RETURNING id, pseudonym`,
        [norm.customer.external_id, norm.customer.channel, norm.customer.pseudonym,
         norm.customer.full_name, norm.customer.email, norm.customer.phone,
         norm.customer.email_hash, norm.customer.phone_hash]
    );
    const customerId = cRes.rows[0].id;
    push('Cliente registrado', 'ok', norm.customer.pseudonym);

    // 6. Orden
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
    push('Pedido persistido', 'ok', orderId.slice(0, 8) + '…');

    // 7. Items
    for (const it of norm.items) {
        await client.query(
            `INSERT INTO tfi.order_items (order_id, sku, product_name, quantity, unit_price, delivery_status, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [orderId, it.sku, it.product_name, it.quantity, it.unit_price, it.delivery_status, JSON.stringify(it.metadata)]
        );
    }
    push('Items del pedido', 'ok', `${norm.items.length} item(s)`);
    await auditLog(client, orderId, 'persisted_ok', 'info', 'persister', 'Pedido normalizado y persistido', { status: norm.order.status });

    // 8. Seudonimización + prompt
    const prompt = buildPrompt(norm);
    push('Seudonimización (sin PII al LLM)', 'ok', `solo ${norm.customer.pseudonym} viaja al LLM`);

    // 9. IA + parse / fallback
    let notif;
    try {
        if (opts.forceFallback) throw new Error('fallo simulado de API');
        const { data, latency_ms } = await callOpenAI(prompt.messages, apiKey);
        const parsed = parseResponse(data, latency_ms);
        if (!parsed.valid) throw new Error(`respuesta inválida: ${parsed.errors.join(',')}`);
        notif = { provider: 'openai', model: 'gpt-4o-mini', prompt_version: prompt.prompt_version, ...parsed, is_fallback: false };
        push('Generación con IA (OpenAI)', 'ok', `${parsed.latency_ms} ms · US$${parsed.cost_usd}`);
    } catch (e) {
        const reason = e.message.replace(/\s+/g, ' ').slice(0, 48);
        notif = fallbackTemplate(norm.order.status, reason);
        notif.prompt_version = null;
        push('Generación con IA (OpenAI)', 'warn', `fallback a plantilla (${reason})`);
    }

    // 10. Persistir notificación
    await client.query(
        `INSERT INTO tfi.ai_notifications
         (order_id, provider, model, prompt_version, prompt_tokens, completion_tokens, cost_usd, latency_ms, message_text, message_status, is_fallback)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, notif.provider, notif.model, notif.prompt_version,
         notif.prompt_tokens || null, notif.completion_tokens || null,
         notif.cost_usd, notif.latency_ms, notif.message_text, 'validated', notif.is_fallback]
    );
    await auditLog(client, orderId, notif.is_fallback ? 'fallback_triggered' : 'llm_call_ok',
        notif.is_fallback ? 'warning' : 'info', 'llm',
        notif.is_fallback ? 'Degradación a plantilla' : 'Mensaje generado por IA',
        { cost_usd: notif.cost_usd, latency_ms: notif.latency_ms });
    push('Notificación registrada', 'ok', notif.is_fallback ? 'plantilla' : 'IA');

    return {
        result: 'processed',
        order_external: norm.order.external_id,
        order_id: orderId,
        status: norm.order.status,
        total: norm.order.total_amount,
        currency: norm.order.currency,
        customer_pseudonym: norm.customer.pseudonym,
        primary_product: norm.items[0] ? norm.items[0].product_name : null,
        items_count: norm.items.length,
        channel: norm.order.channel,
        message: {
            text: notif.message_text,
            tone: notif.tone,
            confidence: notif.confidence,
            provider: notif.provider,
            is_fallback: notif.is_fallback,
            cost_usd: notif.cost_usd,
            latency_ms: notif.latency_ms,
        },
        elapsed_ms: Date.now() - t0,
        steps,
    };
}

// Estado actual de la base para el panel de stats
export async function getState(client) {
    const counts = await client.query(`
        SELECT
          (SELECT count(*) FROM tfi.orders)           AS pedidos,
          (SELECT count(*) FROM tfi.customers)        AS clientes,
          (SELECT count(*) FROM tfi.order_items)      AS items,
          (SELECT count(*) FROM tfi.ai_notifications) AS notificaciones,
          (SELECT count(*) FROM tfi.audit_log)        AS eventos,
          (SELECT coalesce(sum(cost_usd),0) FROM tfi.ai_notifications) AS costo_total
    `);
    const orders = await client.query(`
        SELECT o.external_id, o.status, o.total_amount, o.currency, c.pseudonym,
               n.message_text, n.provider, n.is_fallback, n.cost_usd, n.latency_ms
        FROM tfi.orders o
        LEFT JOIN tfi.customers c ON c.id = o.customer_id
        LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
        ORDER BY o.received_at
    `);
    return { counts: counts.rows[0], orders: orders.rows };
}
