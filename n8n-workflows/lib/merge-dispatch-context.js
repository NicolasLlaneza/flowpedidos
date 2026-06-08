// =============================================================================
// merge-dispatch-context.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") DESPUÉS del nodo
// "Get customer phone" (07_get_customer_phone.sql).
//
// Problema que resuelve:
//   En n8n, cada nodo Postgres reemplaza el item con sus propias filas.
//   Después de 07_get_customer_phone, el item solo tiene { phone, full_name }.
//   Los campos que venían de 06_insert_ai_notification (notification_id,
//   order_id, message_text) ya no están en $json.
//   Este nodo los recupera accediendo al output del nodo anterior por nombre.
//
// IMPORTANTE — Nombre del nodo Postgres de inserción:
//   El nodo que ejecuta 06_insert_ai_notification.sql DEBE llamarse exactamente:
//   "Insert ai_notification"
//   (sin comillas en n8n; el nombre es sensible a mayúsculas/minúsculas)
// =============================================================================

// Output del nodo 06 (campos del RETURNING)
const aiNotif = $('Insert ai_notification').first().json;

// Output del nodo 07 (fila del SELECT customer)
const customerRow = $input.first().json;

const notificationId = aiNotif.notification_id || null;
const orderId        = aiNotif.order_id        || null;
const messageText    = aiNotif.message_text    || '';
const phone          = customerRow.phone       || null;
const fullName       = customerRow.full_name   || null;

return {
    json: {
        notification_id: notificationId,
        order_id:        orderId,
        message_text:    messageText,
        phone,
        full_name:       fullName,
    },
};
