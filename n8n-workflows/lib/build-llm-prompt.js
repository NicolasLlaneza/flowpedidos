// =============================================================================
// build-llm-prompt.js  (v2, TFI corregido)
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") entre Insert Order
// y Call OpenAI. El estado 'error' se filtra antes de este nodo mediante un IF
// upstream — no debería llegar acá.
//
// Cambios vs v1 (ver prompts/v2.md):
//   - El contexto que va al LLM NO incluye pseudonym, ni nombre, correo o
//     teléfono. Ningún identificador de cliente cruza el límite del modelo.
//   - Se omiten claves con valor null/undefined/'' antes de serializar, para
//     que el modelo no pueda referirse a datos ausentes.
//   - Se instruye al modelo a iniciar el mensaje con el token literal
//     {{saludo}} (rehidratado por el validador posterior).
//   - Output esperado: { mensaje, atributos_usados }.
//   - Salvaguarda: throw si detecta que alguna PII se coló al contexto.
// =============================================================================

const PROMPT_VERSION = 'v2';

const HYPERPARAMS = {
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 220,
    response_format: { type: 'json_object' },
    seed: 42,
};

const SYSTEM_MESSAGE = `Sos un asistente de comunicación post-venta para una PyME argentina que vende
neumáticos por canales de comercio electrónico. Tu única tarea es redactar
mensajes cortos y cordiales para enviar al comprador tras un cambio de estado
de su pedido.

REGLAS ESTRICTAS

1. El mensaje DEBE comenzar exactamente con el token literal:
       {{saludo}}
   No lo reemplaces, no lo traduzcas, no antepongas ninguna palabra ni signo.
   Un proceso posterior sustituye el token por el saludo real con el nombre
   del cliente recuperado de la base local.

2. Solo podés usar la información que aparece en el objeto JSON del user
   message. Si un campo no está presente en el objeto, no lo inventes ni
   asumas su valor: omitilo del mensaje.

3. Nunca menciones nombre, correo, teléfono ni identificadores del cliente:
   el contexto que recibís NO los incluye. Si los inventaras, el validador
   posterior lo detecta y descarta tu respuesta.

4. Nunca menciones "OpenAI", "IA", "modelo de lenguaje", "asistente virtual"
   ni referencias a la implementación.

5. Tono: argentino neutro, cordial pero no informal. Usá "vos", no "tú" ni
   "usted". Sin emojis salvo que el contexto los pida.

6. Longitud: máximo 4 oraciones, ideal 2-3. No prometas tiempos de entrega,
   descuentos ni acciones que el contexto no confirme.

MAPEO ESTADO → CONTENIDO

Según order_status el mensaje debe orientarse así:

- created:          Confirmá recepción del pedido. Sin promesa de tiempos.
- pending_payment:  Indicá que aguardamos la confirmación del pago, sin urgencia.
- paid:             Confirmá el pago y avisá que el pedido pasa a preparación.
- preparing:        Avisá que el pedido se está armando.
- shipped:          Comunicá que el pedido fue despachado. No inventes número
                    de seguimiento si el contexto no lo trae.
- delivered:        Confirmá la entrega y agradecé la compra.
- cancelled:        Comunicá la cancelación del pedido de forma clara. No
                    minimices, no digas "estamos revisando".
- refunded:         Confirmá el reembolso.

Nota: si recibís este mensaje es porque el estado NO es 'error'. El estado
'error' se filtra antes y no llega al modelo.

OUTPUT

Devolvé EXCLUSIVAMENTE un objeto JSON válido con esta estructura:

{
  "mensaje": "{{saludo}}, ...",
  "atributos_usados": ["order_status", "primary_product_name", ...]
}

atributos_usados es la lista de claves del contexto que efectivamente citaste
en el mensaje. Sé preciso: sólo las que aparecen. Si mencionás "tu pedido"
sin referirte al producto, no incluyas primary_product_name.`;

// --- Helpers -----------------------------------------------------------------

// Toma el ítem de mayor monto como representativo (para mensajes de 1 producto).
function getPrimaryProductName(items) {
    if (!items || items.length === 0) return null;
    const sorted = [...items].sort(
        (a, b) => (Number(b.unit_price) * Number(b.quantity)) -
                  (Number(a.unit_price) * Number(a.quantity))
    );
    return sorted[0].product_name;
}

// Elimina del objeto las claves con valor null, undefined o string vacío.
// El modelo no debe ver "campo: null" — omitirlos previene alucinaciones.
function stripEmpty(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        out[k] = v;
    }
    return out;
}

// Construye el contexto que va al LLM. NUNCA incluir PII.
function buildContext(input) {
    const raw = {
        order_status:         input.order.status,
        channel:              input.order.channel,
        items_count:          (input.items || []).length,
        primary_product_name: getPrimaryProductName(input.items),
        total_amount:         input.order.total_amount,
        currency:             input.order.currency,
        source_created_at:    input.order.source_created_at,
    };
    const ctx = stripEmpty(raw);

    // Red de seguridad: nunca debe aparecer PII en el contexto que va al LLM.
    // Si algún campo prohibido se coló (bug de un cambio futuro), abortamos
    // antes de invocar al modelo y consumir tokens.
    const pii_keys = [
        'full_name', 'email', 'phone', 'doc_number', 'address',
        'first_name', 'last_name', 'pseudonym', 'external_id',
    ];
    const ctx_str = JSON.stringify(ctx).toLowerCase();
    for (const key of pii_keys) {
        if (ctx_str.includes(`"${key}"`)) {
            throw new Error(`PII leak detected: campo '${key}' no debe llegar al LLM`);
        }
    }
    return ctx;
}

function buildUserMessage(ctx) {
    return `Contexto del pedido:
${JSON.stringify(ctx, null, 2)}

Generá el mensaje según las reglas del system.`;
}

// --- Main --------------------------------------------------------------------
const input = $('Route to canonical').item.json;

if (!input.customer || !input.order) {
    throw new Error('Input inválido: faltan customer u order. Verificar el normalizador.');
}
if (input.order.status === 'error') {
    // Guardián secundario: si por algún motivo llegara con status=error, no
    // gastamos tokens. La ruta primaria de filtrado está en el IF upstream.
    throw new Error("Estado 'error' no debe llegar a Build LLM prompt.");
}

const t_build_start = Date.now();
const context = buildContext(input);
const userMessage = buildUserMessage(context);

return {
    json: {
        order_id:       $('Insert Order').item.json.order_id,
        customer_id:    $('Upsert customer').item.json.customer_id,
        prompt_version: PROMPT_VERSION,

        messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user',   content: userMessage },
        ],
        model: 'gpt-4o-mini',
        ...HYPERPARAMS,

        prompt_build_ms:      Date.now() - t_build_start,
        sent_context:         context,
        llm_call_started_at:  new Date().toISOString(),
    },
};
