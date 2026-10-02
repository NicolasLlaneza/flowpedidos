// =============================================================================
// rehydrate-validate.js  (B3 · TFI corregido §4.3.1)
// v1.4 (corrida de verificación): regla 1 por token aislado, regla 2 con
// verificación de anclaje en el texto, y reintento con el cliente HTTP de n8n.
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

// --- v1.4 · helpers de las reglas 1 y 2 -------------------------------------
// Regla 1: un identificador cuenta solo como token aislado. La version
// evaluada comparaba por subcadena y un identificador de dos cifras coincidia
// con la medida de un producto ("70" dentro de "175/70"): el unico rechazo de
// la corrida v2 (pedido WC-16) fue ese falso positivo.
function escRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function contieneComoToken(msg, id) {
    const rx = new RegExp('(?<![\\p{L}\\p{N}/]|\\p{N}[.,])' + escRx(id) + '(?![\\p{L}\\p{N}/]|[.,]\\p{N})', 'u');
    return rx.test(msg);
}

// Regla 2: anclaje verificable. Los criterios son los de
// scripts/analizar-anclaje.py (indicador de la seccion 3.3), de modo que la
// compuerta y el indicador miden lo mismo.
const ANCLABLES = ['primary_product_name', 'total_amount', 'items_count', 'source_created_at'];
const GENERICOS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'con', 'para', 'por',
    'neumatico', 'neumaticos', 'cubierta', 'cubiertas']);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMEROS = { 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez' };
function normTxt(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }
function citaProducto(m, nombre) {
    const toks = normTxt(nombre).split(/[^\p{L}\p{N}_/]+/u).filter(t => t.length >= 3 && !GENERICOS.has(t));
    if (!toks.length) return false;
    const hits = toks.filter(t => m.includes(t)).length;
    return hits >= Math.min(2, toks.length);
}
function citaMonto(msg, total) {
    const entero = Math.trunc(Number(total));
    if (!entero) return false;
    const obj = String(entero);
    return (String(msg).match(/[\d.,]{2,}/g) || []).some(b => {
        const d = b.replace(/\D/g, '');
        return d && (d === obj || d.startsWith(obj) || obj.startsWith(d)) && d.length >= Math.max(3, obj.length - 2);
    });
}
function citaConteo(m, n) {
    const k = Number(n);
    if (!(k > 1) || !NUMEROS[k]) return false;
    return new RegExp('\\b(' + k + '|' + NUMEROS[k] + ')\\b').test(m);
}
function citaFecha(m, iso) {
    const f = /(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!f) return false;
    const mes = Number(f[2]), dia = Number(f[3]);
    return new RegExp('\\b' + dia + '\\b[^\\d]{0,12}(' + MESES[mes - 1] + '|0?' + mes + ')\\b').test(m)
        || (new RegExp('\\b' + MESES[mes - 1] + '\\b').test(m) && new RegExp('\\b' + dia + '\\b').test(m));
}
function atributosCitados(msg, ctx) {
    const m = normTxt(msg), out = [];
    if (ctx.primary_product_name && citaProducto(m, ctx.primary_product_name)) out.push('primary_product_name');
    if (ctx.total_amount != null && citaMonto(msg, ctx.total_amount)) out.push('total_amount');
    if (ctx.items_count != null && citaConteo(m, ctx.items_count)) out.push('items_count');
    if (ctx.source_created_at && citaFecha(m, ctx.source_created_at)) out.push('source_created_at');
    return out;
}

// --- Las siete reglas del validador -----------------------------------------
function runValidator(rehydratedMsg, atributosUsados, canonical, contexto) {
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
        if (contieneComoToken(msg, id)) {
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

    // Regla 2 (v1.4) — anclaje verificable: el texto debe citar al menos un
    // atributo del pedido, y todo atributo anclable que el modelo declare
    // haber citado tiene que aparecer efectivamente en el texto.
    const ctx = contexto || {};
    const citados = atributosCitados(msg, ctx);
    if (!citados.length) {
        failures.push({ regla: 'anclaje_verificable', detalle: 'el texto no cita ningún atributo del pedido' });
    }
    const noCitados = (atributosUsados || []).filter(a => ANCLABLES.includes(a) && !citados.includes(a));
    if (noCitados.length) {
        failures.push({ regla: 'atributos_declarados_citados', detalle: `declarados y no citados: ${noCitados.join(',')}` });
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
async function retryLLM(messages, http) {
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
    // v1.4: los nodos Code de n8n no exponen fetch; la version evaluada fallaba
    // con "fetch is not defined" y degradaba sin reintentar. Se usa el cliente
    // HTTP del propio n8n (this.helpers.httpRequest), que lanza ante no-2xx.
    const url = 'https://api.openai.com/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    let data;
    if (typeof http === 'function') {
        data = await http({ method: 'POST', url, headers, body, json: true, timeout: 20000 });
    } else if (typeof fetch === 'function') {
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        data = await resp.json();
        if (!resp.ok) throw new Error(`retry openai ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
    } else {
        throw new Error('no hay cliente HTTP disponible en el nodo');
    }
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

// v1.4: contexto que recibió el modelo (para la regla 2) y cliente HTTP de n8n
// (para el reintento). Ambos se capturan acá porque `this` no llega a las
// funciones auxiliares.
const sentContext = ($('Build LLM prompt').item.json.sent_context) || {};
const http = (this && this.helpers && typeof this.helpers.httpRequest === 'function')
    ? this.helpers.httpRequest.bind(this.helpers) : null;

// --- Intento 1 ---------------------------------------------------------------
let attemptText = parsed.message_text;
let attemptAtributos = parsed.atributos_usados || [];
let rehydrated = rehydrate(attemptText, fullName);
let failures = runValidator(rehydrated, attemptAtributos, canonical, sentContext);

// Instrumentación de la corrida de verificación: fuerza un rechazo en el
// primer intento para los external_id listados en la variable de entorno
// TFI_FORZAR_RECHAZO, para ejercitar el reintento de forma controlada.
// En operación la variable no existe y este bloque no hace nada.
let forzar = [];
try { forzar = String(($env && $env.TFI_FORZAR_RECHAZO) || '').split(',').map(s => s.trim()).filter(Boolean); } catch (e) { forzar = []; }
if (forzar.includes(String(canonical.order.external_id))) {
    failures.push({ regla: 'prueba_forzada', detalle: 'rechazo inducido por TFI_FORZAR_RECHAZO' });
}

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
        retry = await retryLLM(messagesRetry, http);
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
    failures = runValidator(rehydrated, attemptAtributos, canonical, sentContext);

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
