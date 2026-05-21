#!/usr/bin/env node
// =============================================================================
// run-demo.mjs — Demo CLI del pipeline FlowPedidos
// -----------------------------------------------------------------------------
// Ejecuta el pipeline COMPLETO sobre pedidos reales del dataset:
//   webhook → validación → enrich (mock ML) → normalización → idempotencia →
//   persistencia (Postgres real) → seudonimización → IA (OpenAI real) →
//   validación de respuesta / fallback → auditoría
//
// Salida pensada para grabarse con OBS y narrar en voz en off.
//
// Uso:
//   node run-demo.mjs               # secuencia curada (recomendado para grabar)
//   node run-demo.mjs 3000000000000001 3000000000000002   # IDs específicos
// =============================================================================

import pg from 'pg';
import {
    validateWebhook, normalizeOrder, buildPrompt,
    callOpenAI, parseResponse, fallbackTemplate,
} from './lib/pipeline.mjs';

// --- Cargar variables de entorno desde ../.env -------------------------------
try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (e) {
    console.error('No pude cargar ../.env:', e.message);
    process.exit(1);
}

const MOCK_URL = 'http://localhost:3001';
const DB = {
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.TFI_APP_USER || 'tfi_app',
    password: process.env.TFI_APP_PASSWORD,
};
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// --- Colores y helpers de presentación ---------------------------------------
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
    red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m', gray: '\x1b[90m',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = `${c.green}✓${c.reset}`;
const warn = `${c.yellow}⚠${c.reset}`;
const fail = `${c.red}✗${c.reset}`;

function header(title, sub) {
    const line = '━'.repeat(62);
    console.log(`\n${c.cyan}${line}${c.reset}`);
    console.log(`  ${c.bold}${title}${c.reset}${sub ? `  ${c.gray}·  ${sub}${c.reset}` : ''}`);
    console.log(`${c.cyan}${line}${c.reset}`);
}

async function step(num, label, fn, pauseMs = 350) {
    process.stdout.write(`  ${c.gray}[${num}]${c.reset} ${label.padEnd(34)}`);
    await sleep(pauseMs);
    try {
        const result = await fn();
        const detail = result && result.__detail ? `${c.gray}${result.__detail}${c.reset}` : '';
        console.log(`${ok} ${detail}`);
        return result;
    } catch (e) {
        console.log(`${fail} ${c.red}${e.message}${c.reset}`);
        throw e;
    }
}

// --- Pipeline para un pedido -------------------------------------------------
async function processWebhook(client, webhook, opts = {}) {
    const v = validateWebhook(webhook);

    header(`PEDIDO ${webhook.resource || '(sin resource)'}`, 'Mercado Libre');

    // 1. Validación
    await step('1', 'Webhook recibido y validado', async () => {
        if (!v.valid) {
            const err = new Error(`rechazado: ${v.errors.join(', ')}`);
            err.__validation = true;
            throw err;
        }
        return { __detail: `topic=${webhook.topic}` };
    }).catch((e) => {
        if (e.__validation) {
            console.log(`  ${c.yellow}→ HTTP 400 · evento descartado, registrado en auditoría${c.reset}`);
            return null;
        }
        throw e;
    });
    if (!v.valid) {
        await auditLog(client, null, 'validation_failed', 'warning', 'webhook',
            `Webhook inválido: ${v.errors.join(', ')}`, { errors: v.errors });
        return { status: 'rejected' };
    }

    // 2. Enrich desde el mock de la plataforma
    const mlOrder = await step('2', 'Consulta a la plataforma (enrich)', async () => {
        const r = await fetch(`${MOCK_URL}/orders/${v.orderId}`);
        if (!r.ok) throw new Error(`mock devolvió ${r.status}`);
        const data = await r.json();
        return Object.assign(data, { __detail: `orden ${data.id}` });
    });

    // 3. Normalización
    const norm = await step('3', 'Normalización al modelo canónico', async () => {
        const n = normalizeOrder(mlOrder);
        return Object.assign(n, { __detail: `estado: ${c.bold}${n.order.status}${c.reset}${c.gray}` });
    });

    // 4. Idempotencia
    const isDuplicate = await step('4', 'Control de duplicados', async () => {
        const r = await client.query(
            'SELECT id FROM tfi.orders WHERE external_id=$1 AND channel=$2',
            [norm.order.external_id, norm.order.channel]
        );
        const dup = r.rows.length > 0;
        return { dup, existingId: dup ? r.rows[0].id : null, __detail: dup ? `${c.yellow}YA EXISTE${c.reset}${c.gray}` : 'nuevo' };
    });

    if (isDuplicate.dup) {
        console.log(`  ${c.yellow}→ Duplicado detectado. No se reprocesa ni se reenvía mensaje.${c.reset}`);
        await auditLog(client, isDuplicate.existingId, 'duplicate_detected', 'info', 'persister',
            'Webhook reenviado de orden ya procesada', { external_id: norm.order.external_id });
        return { status: 'duplicate' };
    }

    // 5. Persistir cliente
    const customerId = await step('5', 'Cliente registrado', async () => {
        const r = await client.query(
            `INSERT INTO tfi.customers (external_id, channel, pseudonym, full_name, email, phone, email_hash, phone_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (external_id, channel) DO UPDATE SET updated_at=now()
             RETURNING id, pseudonym`,
            [norm.customer.external_id, norm.customer.channel, norm.customer.pseudonym,
             norm.customer.full_name, norm.customer.email, norm.customer.phone,
             norm.customer.email_hash, norm.customer.phone_hash]
        );
        return { id: r.rows[0].id, __detail: `${norm.customer.pseudonym}` };
    });

    // 6. Persistir orden
    const orderId = await step('6', 'Pedido persistido', async () => {
        const o = norm.order;
        const r = await client.query(
            `INSERT INTO tfi.orders (external_id, channel, customer_id, status, total_amount, currency, source_created_at, raw_payload, normalization_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
             ON CONFLICT (external_id, channel) DO NOTHING
             RETURNING id`,
            [o.external_id, o.channel, customerId.id, o.status, o.total_amount, o.currency,
             o.source_created_at, JSON.stringify(o.raw_payload), o.normalization_version]
        );
        return { id: r.rows[0].id, __detail: `${c.gray}${r.rows[0].id.slice(0, 8)}…` };
    });

    // 7. Persistir items
    await step('7', 'Items del pedido', async () => {
        for (const it of norm.items) {
            await client.query(
                `INSERT INTO tfi.order_items (order_id, sku, product_name, quantity, unit_price, delivery_status, metadata)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
                [orderId.id, it.sku, it.product_name, it.quantity, it.unit_price, it.delivery_status, JSON.stringify(it.metadata)]
            );
        }
        return { __detail: `${norm.items.length} item(s)` };
    });

    await auditLog(client, orderId.id, 'persisted_ok', 'info', 'persister',
        'Pedido normalizado y persistido', { status: norm.order.status });

    // 8. Seudonimización + build prompt
    const prompt = await step('8', 'Seudonimización (sin PII al LLM)', async () => {
        const p = buildPrompt(norm);
        return Object.assign(p, { __detail: `solo ${norm.customer.pseudonym} viaja al LLM` });
    });

    // 9. Llamada a IA + parseo / fallback
    let notif;
    const forceFail = opts.forceFallback === true;
    await step('9', 'Generación con IA (OpenAI)', async () => {
        try {
            if (forceFail) throw new Error('fallo simulado de API');
            const { data, latency_ms } = await callOpenAI(prompt.messages, OPENAI_KEY);
            const parsed = parseResponse(data, latency_ms);
            if (!parsed.valid) throw new Error(`respuesta inválida: ${parsed.errors.join(',')}`);
            notif = {
                provider: 'openai', model: 'gpt-4o-mini', prompt_version: prompt.prompt_version,
                ...parsed, is_fallback: false,
            };
            return { __detail: `${parsed.latency_ms} ms · US$${parsed.cost_usd}` };
        } catch (e) {
            // Degradación funcional → plantilla
            // Resumimos el motivo a una línea corta para no romper el formato
            const reason = e.message.replace(/\s+/g, ' ').slice(0, 48);
            notif = fallbackTemplate(norm.order.status, reason);
            notif.prompt_version = null;
            return { __detail: `${c.yellow}fallback a plantilla (${reason}…)${c.reset}${c.gray}` };
        }
    });

    // 10. Persistir notificación
    await step('10', 'Notificación registrada', async () => {
        await client.query(
            `INSERT INTO tfi.ai_notifications
             (order_id, provider, model, prompt_version, prompt_tokens, completion_tokens, cost_usd, latency_ms, message_text, message_status, is_fallback)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [orderId.id, notif.provider, notif.model, notif.prompt_version,
             notif.prompt_tokens || null, notif.completion_tokens || null,
             notif.cost_usd, notif.latency_ms, notif.message_text, 'validated', notif.is_fallback]
        );
        await auditLog(client, orderId.id, notif.is_fallback ? 'fallback_triggered' : 'llm_call_ok',
            notif.is_fallback ? 'warning' : 'info', 'llm',
            notif.is_fallback ? 'Degradación a plantilla' : 'Mensaje generado por IA',
            { cost_usd: notif.cost_usd, latency_ms: notif.latency_ms });
        return { __detail: notif.is_fallback ? 'plantilla' : 'IA' };
    });

    // Mostrar el mensaje generado
    console.log(`\n  ${c.magenta}💬 Mensaje ${notif.is_fallback ? '(plantilla de respaldo)' : 'generado por IA'}:${c.reset}`);
    console.log(`     ${c.bold}"${notif.message_text}"${c.reset}`);
    if (notif.tone) console.log(`     ${c.gray}tono: ${notif.tone}${notif.confidence ? ` · confianza: ${notif.confidence}` : ''}${c.reset}`);

    return { status: 'processed', orderId: orderId.id, notif };
}

async function auditLog(client, orderId, eventType, severity, component, message, payload) {
    await client.query(
        `INSERT INTO tfi.audit_log (order_id, event_type, severity, component, message, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [orderId, eventType, severity, component, message, JSON.stringify(payload || {})]
    );
}

// --- Secuencia curada para el demo -------------------------------------------
// Cuenta una historia: happy path → otro happy path → duplicado → fallback
function curatedSequence() {
    return [
        { wh: { resource: '/orders/3000000000000001', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, label: 'Happy path' },
        { wh: { resource: '/orders/3000000000000003', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, label: 'Otro pedido' },
        { wh: { resource: '/orders/3000000000000001', topic: 'orders_v2', user_id: 123456789, attempts: 2 }, label: 'Reenvío (duplicado)' },
        { wh: { resource: '/orders/3000000000000007', topic: 'orders_v2', user_id: 123456789, attempts: 1 }, label: 'Resiliencia', forceFallback: true },
        { wh: { topic: 'orders_v2', user_id: 123456789, attempts: 1 }, label: 'Webhook inválido' },
    ];
}

// --- Main --------------------------------------------------------------------
async function main() {
    console.log(`\n${c.bold}${c.cyan}  FlowPedidos — Demostración del pipeline${c.reset}`);
    console.log(`${c.gray}  Procesamiento real: Postgres + mock Mercado Libre + OpenAI${c.reset}`);

    const client = new pg.Client(DB);
    await client.connect();

    // Asegurar que los fixtures del dataset estén disponibles en el mock
    // (deben haberse copiado a mocks/data/orders/ — ver reset.mjs)

    const argv = process.argv.slice(2);
    const sequence = argv.length
        ? argv.map((id) => ({ wh: { resource: `/orders/${id}`, topic: 'orders_v2', user_id: 123456789, attempts: 1 }, label: id }))
        : curatedSequence();

    const summary = { processed: 0, duplicate: 0, rejected: 0, totalCost: 0 };

    for (const item of sequence) {
        try {
            const res = await processWebhook(client, item.wh, { forceFallback: item.forceFallback });
            if (res.status === 'processed') {
                summary.processed++;
                summary.totalCost += res.notif.cost_usd || 0;
            } else if (res.status === 'duplicate') summary.duplicate++;
            else if (res.status === 'rejected') summary.rejected++;
        } catch (e) {
            console.log(`  ${fail} Error procesando: ${e.message}`);
        }
        await sleep(600);
    }

    // Resumen final
    header('RESUMEN', `${sequence.length} eventos procesados`);
    console.log(`  ${ok} Procesados correctamente:  ${c.bold}${summary.processed}${c.reset}`);
    console.log(`  ${warn} Duplicados bloqueados:     ${c.bold}${summary.duplicate}${c.reset}`);
    console.log(`  ${fail} Rechazados (inválidos):    ${c.bold}${summary.rejected}${c.reset}`);
    console.log(`  ${c.gray}💰 Costo total en IA:        US$${summary.totalCost.toFixed(6)}${c.reset}`);

    // Mostrar el estado real de la base
    const counts = await client.query(`
        SELECT
          (SELECT count(*) FROM tfi.orders)           AS pedidos,
          (SELECT count(*) FROM tfi.customers)        AS clientes,
          (SELECT count(*) FROM tfi.order_items)      AS items,
          (SELECT count(*) FROM tfi.ai_notifications) AS notificaciones,
          (SELECT count(*) FROM tfi.audit_log)        AS eventos_auditados
    `);
    const r = counts.rows[0];
    console.log(`\n  ${c.cyan}Estado de la base de datos:${c.reset}`);
    console.log(`     ${c.gray}pedidos: ${r.pedidos} · clientes: ${r.clientes} · items: ${r.items} · notificaciones: ${r.notificaciones} · auditoría: ${r.eventos_auditados}${c.reset}`);

    await client.end();
    console.log(`\n${c.green}${c.bold}  ✓ Demostración completa${c.reset}\n`);
}

main().catch((e) => {
    console.error(`\n${c.red}Error fatal: ${e.message}${c.reset}`);
    console.error(e.stack);
    process.exit(1);
});
