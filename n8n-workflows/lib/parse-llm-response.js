// =============================================================================
// parse-llm-response.js  (v2, TFI corregido)
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") DESPUÉS del nodo
// OpenAI/Anthropic.
//
// Función:
//   - Extrae el texto generado y la metadata de uso (tokens, latencia)
//   - Valida que sea JSON parseable con la shape v2: { mensaje, atributos_usados }
//   - Verifica que el mensaje comience con el token {{saludo}} (rehidratado
//     por el validador determinístico posterior, spec de B3)
//   - Calcula cost_usd usando el pricing del proveedor
//   - Devuelve un item con message_text + atributos_usados listo para el
//     validador posterior; o con use_fallback=true para redirigir a la
//     plantilla determinística.
//
// Pricing por 1M tokens (actualizar cuando cambien las tarifas).
// Fuente: https://openai.com/pricing
// =============================================================================

const PRICING = {
    openai: {
        // Vigente al 2026-09-01
        'gpt-4o-mini':  { input: 0.150, output: 0.600 },
        'gpt-4o':       { input: 2.500, output: 10.000 },
    },
    anthropic: {
        'claude-haiku-4-5':   { input: 1.000, output: 5.000 },
        'claude-haiku-3-5':   { input: 0.800, output: 4.000 },
    },
};

const MAX_MESSAGE_LENGTH = 600;
const MIN_MESSAGE_LENGTH = 20;
const SALUDO_TOKEN = '{{saludo}}';

// --- Helpers -----------------------------------------------------------------
function calculateCostUSD(provider, model, promptTokens, completionTokens) {
    const tier = PRICING[provider] && PRICING[provider][model];
    if (!tier) return null;
    const inputCost  = (promptTokens     || 0) * tier.input  / 1_000_000;
    const outputCost = (completionTokens || 0) * tier.output / 1_000_000;
    return Number((inputCost + outputCost).toFixed(6));
}

function extractTextAndUsage(llmRaw) {
    // Camino 0: primitivo
    if (typeof llmRaw === 'string') return { text: llmRaw, usage: {} };
    if (!llmRaw || typeof llmRaw !== 'object') return { text: '', usage: {} };

    // Camino 1: OpenAI Chat Completions crudo → choices[0].message.content
    if (Array.isArray(llmRaw.choices) && llmRaw.choices[0]) {
        const ch = llmRaw.choices[0];
        const text = (ch.message && ch.message.content) || ch.text || '';
        return { text, usage: llmRaw.usage || {} };
    }

    // Camino 2: n8n LangChain OpenAI "Message a Model" op → { message: { content: [{type:"output_text", text}] } }
    if (llmRaw.message && llmRaw.message.content) {
        const mc = llmRaw.message.content;
        if (Array.isArray(mc) && mc[0]) {
            const b = mc[0];
            return { text: b.text || b.content || (typeof b === 'string' ? b : ''), usage: llmRaw.usage || llmRaw.tokenUsage || {} };
        }
        if (typeof mc === 'string') return { text: mc, usage: llmRaw.usage || {} };
    }

    // Camino 3: OpenAI Responses API / algunas versiones del nodo → { content: [{type:"output_text", text}] } al top
    if (Array.isArray(llmRaw.content) && llmRaw.content[0]) {
        const b = llmRaw.content[0];
        const text = b.text || b.content || (typeof b === 'string' ? b : '');
        const usage = llmRaw.usage ? {
            prompt_tokens:     llmRaw.usage.input_tokens     || llmRaw.usage.prompt_tokens,
            completion_tokens: llmRaw.usage.output_tokens    || llmRaw.usage.completion_tokens,
        } : {};
        return { text, usage };
    }

    // Camino 4: strings simples en top-level
    if (typeof llmRaw.content === 'string') return { text: llmRaw.content, usage: llmRaw.usage || {} };
    if (typeof llmRaw.text === 'string')    return { text: llmRaw.text,    usage: llmRaw.usage || {} };
    if (typeof llmRaw.output === 'string')  return { text: llmRaw.output,  usage: llmRaw.usage || {} };

    // Camino 5 (defensa en profundidad): walker recursivo — busca la primera propiedad
    // 'text' que sea string no vacío. Cubre wrappers futuros del nodo sin re-tocar código.
    function walk(node, depth) {
        if (!node || depth > 6) return null;
        if (typeof node === 'object' && !Array.isArray(node)) {
            if (typeof node.text === 'string' && node.text.trim() !== '') return node.text;
            for (const v of Object.values(node)) {
                const r = walk(v, depth + 1);
                if (r) return r;
            }
        } else if (Array.isArray(node)) {
            for (const v of node) {
                const r = walk(v, depth + 1);
                if (r) return r;
            }
        }
        return null;
    }
    const walked = walk(llmRaw, 0);
    if (walked) return { text: walked, usage: llmRaw.usage || {} };

    return { text: '', usage: {} };
}

// Valida el shape v2: { mensaje: string, atributos_usados: string[] }
function parseAndValidate(text) {
    const out = { valid: false, parsed: null, errors: [] };

    if (!text || typeof text !== 'string') {
        out.errors.push('empty_response');
        return out;
    }

    let parsed;
    try {
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
    } catch (e) {
        out.errors.push(`invalid_json:${e.message}`);
        return out;
    }

    if (typeof parsed.mensaje !== 'string') {
        out.errors.push('missing_field:mensaje');
    } else {
        if (parsed.mensaje.length < MIN_MESSAGE_LENGTH) {
            out.errors.push(`message_too_short:${parsed.mensaje.length}`);
        }
        if (parsed.mensaje.length > MAX_MESSAGE_LENGTH) {
            out.errors.push(`message_too_long:${parsed.mensaje.length}`);
        }
        // El mensaje debe empezar con {{saludo}} (rehidratado por B3).
        // Aceptamos que haya venido con o sin espacio previo por robustez.
        if (!parsed.mensaje.trimStart().startsWith(SALUDO_TOKEN)) {
            out.errors.push('saludo_token_missing');
        }
    }

    if (!Array.isArray(parsed.atributos_usados)) {
        out.errors.push('missing_field:atributos_usados');
    } else {
        const invalid = parsed.atributos_usados.filter(a => typeof a !== 'string');
        if (invalid.length > 0) out.errors.push('atributos_usados_not_strings');
    }

    out.valid = out.errors.length === 0;
    out.parsed = parsed;
    return out;
}

// --- Main --------------------------------------------------------------------
const input = $json;
const t_parse_start = Date.now();

const order_id       = input.order_id;
const customer_id    = input.customer_id;
const prompt_version = input.prompt_version || 'v2';
const provider       = input.provider || 'openai';
const model          = input.model || 'gpt-4o-mini';
const startedAt      = input.llm_call_started_at;

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
    return {
        json: {
            order_id,
            customer_id,
            use_fallback: false,

            provider,
            model,
            prompt_version,

prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
            },
            cost_usd: costUSD,
            latency_ms: latencyMs,

            // v2: mensaje con {{saludo}} sin rehidratar; atributos declarados.
            message_text: validation.parsed.mensaje,
            atributos_usados: validation.parsed.atributos_usados,
            is_fallback: false,
            message_status: 'generated',
            error_message: null,

            audit_event: {
                event_type: 'llm_call_ok',
                severity: 'info',
                component: 'llm',
                message: `LLM ${provider}/${model} respondió OK`,
                payload: {
                    prompt_version,
                    tokens_prompt: promptTokens,
                    tokens_completion: completionTokens,
                    cost_usd: costUSD,
                    latency_ms: latencyMs,
                    atributos_usados: validation.parsed.atributos_usados,
                },
            },
        },
    };
}

return {
    json: {
        order_id,
        customer_id,
        use_fallback: true,
        fallback_reason: validation.errors.join(','),

        provider,
        model,
        prompt_version,
        cost_usd: costUSD,
        latency_ms: latencyMs,
        raw_response: text,
        validation_errors: validation.errors,

        order:    input.order    || null,
        customer: input.customer || null,
        items:    input.items    || null,

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
