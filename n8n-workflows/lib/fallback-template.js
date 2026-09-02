// =============================================================================
// fallback-template.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") en la rama de
// degradación funcional del workflow.
//
// Se invoca cuando:
//   - El LLM no responde dentro del timeout configurado
//   - La respuesta del LLM no parsea como JSON
//   - La respuesta no cumple la shape esperada (message/tone/confidence)
//   - El confidence devuelto es muy bajo (< 0.3)
//
// Produce un mensaje basado en plantilla estática por estado, garantizando
// que el cliente reciba algo aunque el componente generativo no funcione.
// Cap 5.8 del documento — degradación funcional controlada.
// =============================================================================

const TEMPLATE_VERSION = 'template-v1';

// Plantillas por estado del modelo canónico (alineadas con CHECK constraint
// de tfi.orders.status). Texto: argentino neutro, mismo tono que el prompt v1.
const TEMPLATES = {
    created: {
        message: 'Recibimos tu compra. Te avisamos en cuanto se confirme el pago.',
        tone: 'informativo',
    },
    pending_payment: {
        message: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.',
        tone: 'informativo',
    },
    paid: {
        message: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.',
        tone: 'cordial',
    },
    preparing: {
        message: 'Tu pedido se está preparando. Te avisamos en cuanto lo despachemos.',
        tone: 'informativo',
    },
    shipped: {
        message: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.',
        tone: 'informativo',
    },
    delivered: {
        message: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.',
        tone: 'celebratorio',
    },
    cancelled: {
        message: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.',
        tone: 'disculpa',
    },
    refunded: {
        message: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.',
        tone: 'disculpa',
    },
    error: {
        message: 'Estamos revisando algunos detalles de tu pedido. Te contactamos en cuanto tengamos novedades.',
        tone: 'informativo',
    },
};

// Plantilla absolutamente genérica si el estado tampoco existe en el map.
// No debería llegar acá si el normalizador funcionó (mapea estados desconocidos
// a 'error'), pero es defensa en profundidad.
const ULTIMATE_FALLBACK = {
    message: 'Recibimos tu compra. Te contactamos en cuanto haya novedades sobre tu pedido.',
    tone: 'informativo',
};

const input = $json;
// El status canónico vive en Route to canonical: Build LLM prompt no lo copia
// al reenviar hacia OpenAI, y Parse LLM Response reconstruye order sólo si
// existió en su input (que no es el caso). Leerlo directo evita la caída al
// ULTIMATE_FALLBACK cuando la plantilla específica del estado existía.
const status = $('Route to canonical').item.json.order.status;
const reason = input.fallback_reason || 'unknown';

const template = TEMPLATES[status] || ULTIMATE_FALLBACK;

return {
    json: {
        order_id: input.order_id,
        customer_id: input.customer_id,

        // Provider especial 'template' coherente con el CHECK constraint
        // de tfi.ai_notifications (provider='template' ↔ is_fallback=true)
        provider: 'template',
        model: null,
        prompt_version: null,

        // Sin tokens ni costo porque no fue llamada externa
        usage: { prompt_tokens: null, completion_tokens: null },
        cost_usd: 0,
        latency_ms: 0,

        // Output con la misma shape que devolvería el LLM, así el INSERT
        // posterior es uniforme y no requiere branching
        message_text: template.message,
        tone: template.tone,
        confidence: 1.0, // plantilla es 100% predecible

        // v2 (§3.3): las plantillas no explicitan qué atributos citan; se
        // reporta 'template' para diferenciar de una respuesta generativa
        // en las métricas de anclaje contextual sin inventar atributos.
        atributos_usados: ['template'],

        // v1.3 (§4.3.1): las plantillas son 100% determinísticas y no
        // pasan por el validador de reglas — no cuentan como pasada.
        validator_passes: 0,
        validator_failures: input.validator_failures || [],

        is_fallback: true,
        message_status: 'validated',

        // Telemetría: por qué se cayó al fallback
        fallback_reason: reason,
        template_version: TEMPLATE_VERSION,
        applied_template_status: status,

        // Para audit_log
        audit_event: {
            event_type: 'fallback_triggered',
            severity: 'warning',
            component: 'llm',
            message: `Degradación a plantilla por ${reason}`,
            payload: { fallback_reason: reason, status, template_version: TEMPLATE_VERSION },
        },
    },
};
