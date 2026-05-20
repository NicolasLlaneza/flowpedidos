// =============================================================================
// build-llm-prompt.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") ubicado entre la
// persistencia de la orden y el nodo OpenAI/Anthropic.
//
// Función:
//   - Toma el item normalizado + el order_id ya persistido
//   - Aplica seudonimización ESTRICTA: solo el pseudonym y datos no-PII
//     llegan al modelo (cumple cap 5.7 — privacidad por diseño)
//   - Arma los mensajes system + user con el prompt v1
//   - Devuelve los hiperparámetros del prompt para que el nodo LLM los use
//
// IMPORTANTE: este es el ÚNICO lugar donde se decide qué información ve el LLM.
// Cualquier campo agregado acá puede filtrar PII al servicio externo.
// =============================================================================

const PROMPT_VERSION = 'v1';

// Hiperparámetros del prompts/v1.md (versión inicial)
const HYPERPARAMS = {
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 220,
    response_format: { type: 'json_object' },
    seed: 42,
};

const SYSTEM_MESSAGE = `Sos un asistente de comunicación post-venta para una PyME argentina que vende
neumáticos en Mercado Libre. Tu única tarea es redactar mensajes cortos y
cordiales para enviar al comprador después de un cambio en el estado de su
pedido.

REGLAS ESTRICTAS:
1. Solo usar información que esté en el contexto JSON que te entrego.
   Si un dato falta, no lo inventes ni lo asumas: omitilo del mensaje.
2. No incluyas tu razonamiento, disculpas por restricciones, ni meta-comentarios.
3. No mencionés a "OpenAI", "IA", "modelo de lenguaje" ni similares.
4. Tono: argentino neutro, cordial pero no informal. Usá "vos", no "tú" ni "usted".
5. Longitud: máximo 4 oraciones, idealmente 2-3. Sin emojis salvo que el contexto
   los pida explícitamente.
6. No prometas tiempos de entrega, descuentos, ni acciones que el contexto no
   confirme.
7. Si el estado es "error" o el contexto está incompleto, generá un mensaje
   genérico de "estamos revisando tu pedido" sin inventar detalles.

OUTPUT:
Devolvé exclusivamente un objeto JSON válido con esta estructura:
{
  "message": "texto del mensaje, listo para enviar",
  "tone": "informativo" | "cordial" | "disculpa" | "celebratorio",
  "confidence": número entre 0 y 1
}

confidence refleja qué tan completa es la información del contexto.
Si tuviste que omitir datos importantes, bajá la confidence.`;

// --- Helpers -----------------------------------------------------------------
function getPrimaryProductName(items) {
    if (!items || items.length === 0) return null;
    // Tomamos el item de mayor monto (más representativo del pedido)
    const sorted = [...items].sort(
        (a, b) => (Number(b.unit_price) * Number(b.quantity)) -
                  (Number(a.unit_price) * Number(a.quantity))
    );
    return sorted[0].product_name;
}

function buildContext(input) {
    // SOLO estos campos pueden llegar al LLM.
    // No incluir nunca: full_name, email, phone, doc_number, billing_info, etc.
    const ctx = {
        customer_pseudonym: input.customer.pseudonym,
        order_status: input.order.status,
        items_count: (input.items || []).length,
        primary_product_name: getPrimaryProductName(input.items),
        channel: input.order.channel,
        total_amount: input.order.total_amount,
        currency: input.order.currency,
        source_created_at: input.order.source_created_at,
    };

    // Defensa: lanzar error si alguna PII se coló accidentalmente
    const pii_keys = ['full_name', 'email', 'phone', 'doc_number', 'address', 'first_name', 'last_name'];
    const ctx_str = JSON.stringify(ctx).toLowerCase();
    for (const key of pii_keys) {
        if (ctx_str.includes(`"${key}"`)) {
            throw new Error(`PII leak detected: campo ${key} no debe llegar al LLM`);
        }
    }

    return ctx;
}

function buildUserMessage(ctx) {
    return `Contexto del pedido:
- Pseudónimo del cliente: ${ctx.customer_pseudonym}
- Estado normalizado: ${ctx.order_status}
- Cantidad de productos: ${ctx.items_count}
- Producto principal: ${ctx.primary_product_name || '(no especificado)'}
- Canal de venta: ${ctx.channel}
- Monto total: ${ctx.total_amount} ${ctx.currency}
- Fecha del pedido: ${ctx.source_created_at}

Generá el mensaje según las reglas del system.`;
}

// --- Main --------------------------------------------------------------------
const input = $json;

if (!input.customer || !input.order) {
    throw new Error('Input inválido: faltan customer u order. Verificar el normalizador.');
}

const t_build_start = Date.now();
const context = buildContext(input);
const userMessage = buildUserMessage(context);

return {
    json: {
        // Identificadores que vamos a necesitar después
        order_id: input.order_id,
        customer_id: input.customer_id,
        prompt_version: PROMPT_VERSION,

        // Mensajes para el nodo OpenAI (algunos nodos los esperan en .messages,
        // otros directamente; ajustar según la versión del nodo OpenAI)
        messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user',   content: userMessage },
        ],

        // Hiperparámetros — el nodo OpenAI permite override con estos campos
        model: 'gpt-4o-mini',
        ...HYPERPARAMS,

        // Métricas internas
        prompt_build_ms: Date.now() - t_build_start,
        // Conservamos el contexto enviado para auditoría posterior
        sent_context: context,
        // Para que el parser sepa cuándo arrancó la llamada
        llm_call_started_at: new Date().toISOString(),
    },
};
