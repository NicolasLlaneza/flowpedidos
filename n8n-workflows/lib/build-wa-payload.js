// =============================================================================
// build-wa-payload.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") entre el SELECT de
// customer phone y el nodo HTTP Request que llama a Meta Cloud API.
//
// Función:
//   - Normaliza el teléfono al formato E.164 (Argentina: +549...)
//   - Inyecta el nombre real del cliente como saludo inicial
//     (los mensajes del LLM no contienen PII; el nombre se agrega recién acá)
//   - Construye el body JSON para POST /{PHONE_NUMBER_ID}/messages
//   - Propaga no_phone=true si falta el teléfono (el IF node siguiente aborta)
// =============================================================================

// --- Helpers -----------------------------------------------------------------

// Normaliza número argentino a E.164 (+549XXXXXXXXXX para celular).
// Casos habituales que devuelve ML:
//   - "1112345678"   → "+5491112345678"
//   - "01112345678"  → "+5491112345678"  (área con 0 de discado nacional)
//   - "+549..."      → lo devuelve tal cual (ya está bien)
// Ajustar si la PyME tiene números de línea fija (sin 9 de celular).
function toE164Argentina(raw) {
    if (!raw) return null;

    let digits = raw.replace(/\D/g, '');

    // Ya viene con código de país
    if (digits.startsWith('549') && digits.length >= 12) return `+${digits}`;
    if (digits.startsWith('54')  && digits.length >= 11) return `+549${digits.slice(2)}`;

    // Número local con 0 de discado (011..., 0351..., etc.)
    if (digits.startsWith('0')) digits = digits.slice(1);

    // Números de 10 dígitos → celular argentino estándar
    if (digits.length === 10) return `+549${digits}`;

    // Números de 8 dígitos sin área (raro, pero puede pasar con algunos registros)
    if (digits.length === 8) return `+54911${digits}`;  // asume GBA; ajustar si aplica

    // No pudimos normalizar; devolver null para que el nodo aborte
    return null;
}

function buildGreeting(fullName) {
    if (!fullName) return '';
    const firstName = fullName.trim().split(/\s+/)[0];
    return `Hola ${firstName}!\n`;
}

// --- Main --------------------------------------------------------------------
const input = $json;

// La respuesta del SELECT Postgres llega en un array; tomamos la primera fila.
// n8n puede entregar los resultados de distintas formas según la versión del nodo.
const customerRow = Array.isArray(input) ? input[0] : input;

const rawPhone    = customerRow.phone    || input.phone    || null;
const fullName    = customerRow.full_name || input.full_name || null;

// Los campos del paso anterior (notification_id, message_text, etc.) llegan
// en el item de contexto; en n8n se accede via $('NombreNodo').item.json
// Para mantener este nodo auto-contenido, los buscamos en el input directo
// (asumiendo que el Merge node o el Set node los consolidó antes).
const notificationId = input.notification_id || input.id || null;
const messageText    = input.message_text || input.message || '';
const orderId        = input.order_id || null;

// Normalizar teléfono
const phone = toE164Argentina(rawPhone);

if (!phone) {
    return {
        json: {
            no_phone: true,
            reason: rawPhone ? `phone_not_normalizable:${rawPhone}` : 'phone_missing',
            notification_id: notificationId,
            order_id: orderId,
        },
    };
}

// Componer el mensaje final con el saludo personalizado
const greeting     = buildGreeting(fullName);
const finalMessage = `${greeting}${messageText}`.trim();

// Body para POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
const metaBody = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                phone,
    type:              'text',
    text: {
        preview_url: false,
        body:        finalMessage,
    },
};

return {
    json: {
        no_phone:        false,
        notification_id: notificationId,
        order_id:        orderId,
        to_phone:        phone,
        meta_body:       metaBody,
        // Para el audit_log del dispatch
        audit_event: {
            event_type: 'dispatch_attempted',
            severity:   'info',
            component:  'dispatcher',
            message:    `Intentando envío WhatsApp a ${phone}`,
            payload:    { notification_id: notificationId, to: phone },
        },
    },
};
