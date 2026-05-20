// =============================================================================
// parse-llm-response.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") DESPUÉS del nodo
// OpenAI/Anthropic.
//
// Función:
//   - Extrae el texto generado y la metadata de uso (tokens, latencia)
//   - Valida que sea JSON parseable con la shape esperada
//   - Calcula cost_usd usando el pricing del proveedor
//   - Devuelve un item listo para INSERT en tfi.ai_notifications,
//     o un item con use_fallback=true para que el siguiente nodo IF
//     redirija al fallback-template.js
//
// Pricing por 1M tokens (actualizar cuando cambien las tarifas).
// Fuente: https://openai.com/pricing y https://www.anthropic.com/pricing
// =============================================================================

const PRICING = {
    openai: {
        'gpt-4o-mini':  { input: 0.150, output: 0.600 },  // USD por 1M tokens
        'gpt-4o':       { input: 2.500, output: 10.000 },
    },
    anthropic: {
        'claude-haiku-4-5':   { input: 1.000, output: 5.000 },  // placeholder, ajustar
        'claude-haiku-3-5':   { input: 0.800, output: 4.000 },
    },
};

const MIN_CONFIDENCE = 0.3;            // confidence < este → fallback
const MAX_MESSAGE_LENGTH = 600;        // chars, defensa contra respuestas muy largas
const MIN_MESSAGE_LENGTH = 20;         // chars, evita respuestas vacías/triviales

// --- Helpers -----------------------------------------------------------------
function calculateCostUSD(provider, model, promptTokens, completionTokens) {
    const tier = PRICING[provider] && PRICING[provider][model];
    if (!tier) return null; // pricing desconocido → guardamos NULL en DB
    const inputCost  = (promptTokens     || 0) * tier.input  / 1_000_000;
    const outputCost = (completionTokens || 0) * tier.output / 1_000_000;
    return Number((inputCost + outputCost).toFixed(6));
}

function extractTextAndUsage(llmRaw) {
    // Soporta tanto OpenAI como Anthropic en estructuras nativas, además del
    // wrapper que aplica el nodo OpenAI de n8n.

    // n8n OpenAI node devuelve a veces { message: { content: "..." } } o
    // { content: "..." } o el formato crudo de la API.
    if (typeof llmRaw === 'string') {
        return { text: llmRaw, usage: {} };
    }

    // Formato crudo de OpenAI Chat Completions API
    if (llmRaw.choices && Array.isArray(llmRaw.choices) && llmRaw.choices[0]) {
        const choice = llmRaw.choices[0];
        const text = (choice.message && choice.message.content) ||
                     choice.text ||
                     '';
        return { text, usage: llmRaw.usage || {} };
    }

    // Formato crudo de Anthropic Messages API
    if (llmRaw.content && Array.isArray(llmRaw.content) && llmRaw.content[0]) {
        const text = llmRaw.content[0].text || '';
        const usage = llmRaw.usage ? {
            prompt_tokens:     llmRaw.usage.input_tokens,
            completion_tokens: llmRaw.usage.output_tokens,
        } : {};
        return { text, usage };
    }

    // Algunos wrappers de n8n
    if (llmRaw.message && llmRaw.message.content) {
        return { text: llmRaw.message.content, usage: llmRaw.usage || {} };
    }
    if (typeof llmRaw.content === 'string') {
        return { text: llmRaw.content, usage: llmRaw.usage || {} };
    }
    if (typeof llmRaw.text === 'string') {
        return { text: llmRaw.text, usage: llmRaw.usage || {} };
    }

    return { text: '', usage: {} };
}

function parseAndValidate(text) {
    const out = { valid: false, parsed: null, errors: [] };

    if (!text || typeof text !== 'string') {
        out.errors.push('empty_response');
        return out;
    }

    let parsed;
    try {
        // Algunos modelos pueden devolver el JSON envuelto en backticks; los limpiamos
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
    } catch (e) {
        out.errors.push(`invalid_json:${e.message}`);
        return out;
    }

    if (typeof parsed.message !== 'string') {
        out.errors.push('missing_field:message');
    } else {
        if (parsed.message.length < MIN_MESSAGE_LENGTH) {
            out.errors.push(`message_too_short:${parsed.message.length}`);
        }
        if (parsed.message.length > MAX_MESSAGE_LENGTH) {
            out.errors.push(`message_too_long:${parsed.message.length}`);
        }
    }

    if (typeof parsed.tone !== 'string') {
        out.errors.push('missing_field:tone');
    }

    if (typeof parsed.confidence !== 'number' ||
        parsed.confidence < 0 ||
        parsed.confidence > 1) {
        out.errors.push('invalid_field:confidence');
    } else if (parsed.confidence < MIN_CONFIDENCE) {
        out.errors.push(`low_confidence:${parsed.confidence}`);
    }

    out.valid = out.errors.length === 0;
    out.parsed = parsed;
    return out;
}

// --- Main --------------------------------------------------------------------
const input = $json;
const t_parse_start = Date.now();

// Identificadores y metadata heredados del build-llm-prompt
const order_id       = input.order_id;
const customer_id    = input.customer_id;
const prompt_version = input.prompt_version || 'v1';
const provider       = input.provider || 'openai';
const model          = input.model || 'gpt-4o-mini';
const startedAt      = input.llm_call_started_at;

// La respuesta real puede estar en distintos lados según cómo se conectó el nodo
const llmRaw = input.response || input.data || input.llm || input;

const { text, usage } = extractTextAndUsage(llmRaw);
const validation = parseAndValidate(text);

const promptTokens     = usage.prompt_tokens     || usage.input_tokens     || null;
const completionTokens = usage.completion_tokens || usage.output_tokens    || null;
const costUSD          = calculateCostUSD(provider, model, promptTokens, completionTokens);

const latencyMs = startedAt
    ? (Date.now() - new Date(startedAt).getTime())
    : null;

if (validation.valid) {
    // Camino feliz: usar el mensaje del LLM
    return {
        json: {
            order_id,
            customer_id,
            use_fallback: false,

            provider,
            model,
            prompt_version,

            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
            },
            cost_usd: costUSD,
            latency_ms: latencyMs,

            message_text: validation.parsed.message,
            tone: validation.parsed.tone,
            confidence: validation.parsed.confidence,
            is_fallback: false,
            message_status: 'validated',
            error_message: null,

            audit_event: {
                event_type: 'llm_call_ok',
                severity: 'info',
                component: 'llm',
                message: `LLM ${provider}/${model} respondió OK (confidence=${validation.parsed.confidence})`,
                payload: {
                    prompt_version,
                    tokens_prompt: promptTokens,
                    tokens_completion: completionTokens,
                    cost_usd: costUSD,
                    latency_ms: latencyMs,
                    confidence: validation.parsed.confidence,
                    tone: validation.parsed.tone,
                },
            },
        },
    };
}

// Respuesta inválida: marcar para que el siguiente IF node rutee al fallback
return {
    json: {
        order_id,
        customer_id,
        use_fallback: true,
        fallback_reason: validation.errors.join(','),

        // Preservamos lo que sí pudimos extraer para auditoría
        provider,
        model,
        prompt_version,
        cost_usd: costUSD,       // pagamos los tokens igual aunque sea inválida
        latency_ms: latencyMs,
        raw_response: text,       // crudo para análisis posterior
        validation_errors: validation.errors,

        // Necesario para que el nodo fallback construya bien (mantiene shape)
        order: input.order || null,
        customer: input.customer || null,
        items: input.items || null,

        audit_event: {
            event_type: 'llm_call_failed',
            severity: 'warning',
            component: 'llm',
            message: `LLM ${provider}/${model} devolvió respuesta inválida: ${validation.errors.join(', ')}`,
            payload: {
                prompt_version,
                errors: validation.errors,
                cost_usd: costUSD,
                latency_ms: latencyMs,
                raw_excerpt: text.slice(0, 200),
            },
        },
    },
};
