// =============================================================================
// rehydrate-validate.js  (B3 · TFI corregido §4.3.1)
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") ubicado ENTRE
// Parse LLM Response y Use Fallback?
//
// Función (contrato del §4.3.1 del documento):
//   1. Rehidrata el token literal {{saludo}} con el nombre real del cliente
//      recuperado de Route to canonical (base local). Si el nombre es nulo
//      usa "¡Hola!" — resuelve la identidad fuera del alcance del LLM.
//   2. Somete el mensaje a las siete reglas del validador determinístico.
//   3. Ante fallo, reintenta una vez llamando a OpenAI SIN seed (para variar
//      la respuesta). Si el segundo intento también falla, emite
//      use_fallback=true para que el IF posterior rutee a la plantilla.
//   4. Persiste el conteo de pasadas y el detalle de las reglas violadas
//      en validator_passes / validator_failures.
//
// Se corre después del primer intento del LLM (Parse LLM Response). El
// reintento sucede acá, no como duplicación de nodos, para mantener el
// workflow lineal.
// =============================================================================

const SALUDO_TOKEN_RX = /\{\{\s*saludo\s*\}\}/g;

// Atributos válidos del contexto v2 (los únicos que el LLM ve).
const VALID_CTX_KEYS = new Set([
    'order_status', 'channel', 'items_count', 'primary_product_name',
    'total_amount', 'currency', 'source_created_at', 'template',
]);

// Palabras clave por estado — mapeo estado→contenido del prompt v2.
// La regla 3 exige coherencia entre el estado del pedido y el texto.
const STATE_KEYWORDS = {
    created:         /recib|confirm|orden|pedido/i,
    pending_payment: /pag|esper/i,
    paid:            /pag|confirm/i,
    preparing:       /prepar|arm/i,
    shipped:         /despach|env[ií]|camino/i,
    delivered:       /entreg|recib/i,
    cancelled:       /cancel|anul/i,
    refunded:        /reembols|devolu|reintegr/i,
};

// --- Rehidratación -----------------------------------------------------------
function rehydrate(msg, fullName) {
    const nombre = (fullName || '').trim();
    const saludo = nombre ? `¡Hola ${nombre}!` : '¡Hola!';
    return msg.replace(SALUDO_TOKEN_RX, saludo);
}

// --- Las siete reglas del validador -----------------------------------------
function runValidator(rehydratedMsg, atributosUsados, canonical) {
    const failures = [];
    const msg = String(rehydratedMsg || '');
    const status = canonical.order.status;

    // Regla 1 — ausencia de identificadores internos en el texto
    const idsPresentes = [
        canonical.customer.pseudonym,
        canonical.customer.external_id,
        canonical.order.external_id,
    ].filter(Boolean).map(String);
    for (const id of idsPresentes) {
        if (msg.includes(id)) {
            failures.push({ regla: 'sin_identificadores_internos', detalle: `contiene '${id}'` });
        }
    }
    if (/synthetic:|cust_[a-f0-9]{6,}/i.test(msg)) {
        failures.push({ regla: 'sin_identificadores_internos', detalle: 'patrón synthetic o cust_' });
    }

    // Regla 2 — correspondencia entre atributos_usados y claves válidas del contexto
    const undeclared = (atributosUsados || [])
        .filter(a => typeof a === 'string')
        .filter(a => !VALID_CTX_KEYS.has(a));
    if (undeclared.length) {
        failures.push({ regla: 'atributos_declarados_valen', detalle: `no válidos: ${undeclared.join(',')}` });
    }

    // Regla 3 — consistencia estado→contenido (mapeo del prompt v2)
    const kw = STATE_KEYWORDS[status];
    if (kw && !kw.test(msg)) {
        failures.push({ regla: 'consistencia_estado_contenido', detalle: `estado '${status}' no coincide con contenido` });
    }

    // Regla 4 — ausencia de datos no provistos en el contexto (tracking, direcciones)
    if (/tracking[- ]?\w{5,}/i.test(msg)) {
        failures.push({ regla: 'sin_datos_no_provistos', detalle: 'tracking inventado' });
    }
    if (/\bcalle\s+\w+\s+\d{2,}/i.test(msg)) {
        failures.push({ regla: 'sin_datos_no_provistos', detalle: 'dirección inventada' });
    }

    // Regla 5 — adecuación del registro lingüístico (vos, no tú/usted, no emoji)
    if (/\btú\b|\busted\b/i.test(msg)) {
        failures.push({ regla: 'registro_linguistico', detalle: 'usa tú o usted en vez de vos' });
    }
    if (/\p{Extended_Pictographic}/u.test(msg)) {
        failures.push({ regla: 'registro_linguistico', detalle: 'contiene emoji' });
    }

    // Regla 6 — ausencia de PII fabricada (email, teléfono no provistos)
    if (/[\w.-]+@[\w.-]+\.[\w]{2,}/i.test(msg)) {
        failures.push({ regla: 'sin_pii_fabricada', detalle: 'email en el mensaje' });
    }
    if (/(?:\+?\d[\s-]?){9,}/.test(msg)) {
        failures.push({ regla: 'sin_pii_fabricada', detalle: 'número que parece teléfono' });
    }

    // Regla 7 — saludo rehidratado (no queda el token literal)
    if (SALUDO_TOKEN_RX.test(msg)) {
        // reset lastIndex tras el test global
        SALUDO_TOKEN_RX.lastIndex = 0;
        failures.push({ regla: 'saludo_rehidratado', detalle: 'quedó el token {{saludo}} sin reemplazar' });
    }
    SALUDO_TOKEN_RX.lastIndex = 0;

    return failures;
}

// --- Reintento LLM sin seed (para variar la salida) -------------------------
async function retryLLM(messages) {
    const apiKey = ($env && $env.OPENAI_API_KEY) || '';
    if (!apiKey) throw new Error('OPENAI_API_KEY no disponible en el nodo');
    const body = {
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.4,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        // Deliberadamente sin `seed` — reintentar con seed idéntico produce
        // la misma respuesta y el validador vuelve a fallar por el mismo motivo.
    };
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`retry openai ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
    const text = data?.choices?.[0]?.message?.content || '';
    const usage = data?.usage || {};
    return { text, usage };
}

function parseLLMJson(text) {
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(cleaned); } catch (e) { return null; }
}

// --- Main --------------------------------------------------------------------
const parsed = $json;

// Si Parse LLM Response ya decidió caer a fallback (respuesta LLM inválida),
// se pasa el item tal cual: el IF posterior (Use Fallback?) lo enruta.
if (parsed.use_fallback) {
    return { json: parsed };
}

const canonical = $('Route to canonical').item.json;
const fullName = canonical.customer.full_name;

// --- Intento 1 ---------------------------------------------------------------
let attemptText = parsed.message_text;
let attemptAtributos = parsed.atributos_usados || [];
let rehydrated = rehydrate(attemptText, fullName);
let failures = runValidator(rehydrated, attemptAtributos, canonical);

let validator_passes = 1;
const validator_failures = [];
let extraPromptTokens = 0;
let extraCompletionTokens = 0;
let extraCostUSD = 0;

if (failures.length > 0) {
    // Registro del primer fallo para trazabilidad y armo prompt de corrección
    validator_failures.push({ intento: 1, fallas: failures });

    const correctionMsg = `Tu respuesta anterior falló las reglas del validador: ${failures.map(f => f.regla).join(', ')}. `
        + `Detalles: ${failures.map(f => f.detalle).join(' | ')}. `
        + `Reescribí el mensaje respetando todas las reglas del system y las mismas invariantes de output.`;

    // Reconstruyo la conversación desde Build LLM prompt
    const buildPrompt = $('Build LLM prompt').item.json;
    const messagesRetry = [
        ...buildPrompt.messages,
        { role: 'assistant', content: attemptText },
        { role: 'user', content: correctionMsg },
    ];

    let retry;
    try {
        retry = await retryLLM(messagesRetry);
    } catch (err) {
        // El reintento falló por red/auth — degradamos a plantilla registrando
        // el fallo del validator más el del retry.
        validator_failures.push({ intento: 2, error: `retry_failed: ${err.message}` });
        return {
            json: {
                ...parsed,
                use_fallback: true,
                fallback_reason: 'validator_failed_retry_error',
                validator_passes: 1,
                validator_failures,
            },
        };
    }

    validator_passes = 2;
    extraPromptTokens = retry.usage.prompt_tokens || 0;
    extraCompletionTokens = retry.usage.completion_tokens || 0;
    // Pricing coherente con parse-llm-response.js
    extraCostUSD = ((extraPromptTokens * 0.150) + (extraCompletionTokens * 0.600)) / 1_000_000;

    const retryParsed = parseLLMJson(retry.text);
    if (!retryParsed || typeof retryParsed.mensaje !== 'string') {
        validator_failures.push({ intento: 2, fallas: [{ regla: 'invalid_json', detalle: 'segunda respuesta no parseable' }] });
        return {
            json: {
                ...parsed,
                use_fallback: true,
                fallback_reason: 'validator_failed_retry_unparseable',
                validator_passes,
                validator_failures,
                extra_prompt_tokens: extraPromptTokens,
                extra_completion_tokens: extraCompletionTokens,
                extra_cost_usd: extraCostUSD,
            },
        };
    }

    attemptText = retryParsed.mensaje;
    attemptAtributos = Array.isArray(retryParsed.atributos_usados) ? retryParsed.atributos_usados : [];
    rehydrated = rehydrate(attemptText, fullName);
    failures = runValidator(rehydrated, attemptAtributos, canonical);

    if (failures.length > 0) {
        validator_failures.push({ intento: 2, fallas: failures });
        return {
            json: {
                ...parsed,
                use_fallback: true,
                fallback_reason: 'validator_failed_twice',
                validator_passes,
                validator_failures,
                extra_prompt_tokens: extraPromptTokens,
                extra_completion_tokens: extraCompletionTokens,
                extra_cost_usd: extraCostUSD,
            },
        };
    }
}

// --- Éxito -------------------------------------------------------------------
// Acumulo tokens/costo si hubo retry.
const totalPromptTokens     = (parsed.prompt_tokens     || 0) + extraPromptTokens;
const totalCompletionTokens = (parsed.completion_tokens || 0) + extraCompletionTokens;
const totalCost             = Number(((parsed.cost_usd || 0) + extraCostUSD).toFixed(6));

return {
    json: {
        ...parsed,
        message_text: rehydrated,           // ya rehidratado, listo para despacho
        atributos_usados: attemptAtributos,  // los que el intento válido declaró
        message_status: 'validated',        // pasó las 7 reglas
        validator_passes,
        validator_failures,
        prompt_tokens:     totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        cost_usd:          totalCost,
    },
};
