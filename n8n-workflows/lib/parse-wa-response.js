// =============================================================================
// parse-wa-response.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") DESPUÉS del nodo
// HTTP Request que llama a Meta Cloud API.
//
// El nodo HTTP Request debe tener habilitado "Continue On Fail" para que los
// errores 4xx/5xx lleguen acá en lugar de romper el workflow.
//
// Normaliza tanto el caso de éxito como el de error al mismo shape, para que
// los nodos 08_update_dispatch.sql y audit sean idénticos en ambas ramas.
//
// Output (siempre el mismo shape):
//   {
//     notification_id: uuid,
//     order_id:        uuid,
//     message_status:  'sent' | 'failed',
//     wa_message_id:   string | null,
//     error_reason:    string | null,
//     audit_event:     { ... }
//   }
// =============================================================================

const input = $json;

// Campos que venían de merge-dispatch-context (pasan transparentes por el HTTP node)
const notificationId = input.notification_id || null;
const orderId        = input.order_id        || null;
const toPhone        = input.to_phone        || null;

// --- Detectar si el HTTP node pasó un error ("Continue On Fail") -------------
const httpError = input.error || input.message || null;
const httpStatus = input.statusCode || input.status || null;
const isHttpError = !!httpError || (httpStatus && httpStatus >= 400);

if (isHttpError) {
    const errorDetail = typeof httpError === 'object'
        ? JSON.stringify(httpError)
        : String(httpError || `HTTP ${httpStatus}`);

    return {
        json: {
            notification_id: notificationId,
            order_id:        orderId,
            message_status:  'failed',
            wa_message_id:   null,
            error_reason:    errorDetail,
            audit_event: {
                event_type: 'dispatch_failed',
                severity:   'error',
                component:  'dispatcher',
                message:    `Meta API rechazó el mensaje: ${errorDetail.slice(0, 200)}`,
                payload:    { notification_id: notificationId, to: toPhone, error: errorDetail },
            },
        },
    };
}

// --- Respuesta exitosa de Meta ------------------------------------------------
// Estructura esperada: { messaging_product, contacts, messages: [{ id: "wamid..." }] }
const waMessageId = (input.messages && input.messages[0] && input.messages[0].id) || null;

if (!waMessageId) {
    // Respuesta 200 pero sin el ID esperado → tratar como error para no perder trazabilidad
    return {
        json: {
            notification_id: notificationId,
            order_id:        orderId,
            message_status:  'failed',
            wa_message_id:   null,
            error_reason:    'meta_response_missing_message_id',
            audit_event: {
                event_type: 'dispatch_failed',
                severity:   'warning',
                component:  'dispatcher',
                message:    'Meta respondió 200 pero sin messages[0].id',
                payload:    { notification_id: notificationId, raw_response: input },
            },
        },
    };
}

return {
    json: {
        notification_id: notificationId,
        order_id:        orderId,
        message_status:  'sent',
        wa_message_id:   waMessageId,
        error_reason:    null,
        audit_event: {
            event_type: 'dispatch_ok',
            severity:   'info',
            component:  'dispatcher',
            message:    `Mensaje enviado por WhatsApp (wamid: ${waMessageId})`,
            payload:    { notification_id: notificationId, to: toPhone, wa_message_id: waMessageId },
        },
    },
};
