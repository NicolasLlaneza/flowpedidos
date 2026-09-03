// =============================================================================
// simulate-wa-response.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" (modo: "Run Once for Each Item") en la rama
// simulate del IF "WA live?".
//
// Emite una respuesta con la misma shape que devuelve Meta Cloud API para
// que Parse WA response y Update dispatch funcionen sin cambios. NO llama
// a la API — se usa durante la corrida cuantitativa (150 pedidos) para
// evitar que Meta detecte patrón de spam sobre volumen batch al mismo
// destinatario, según se declara en §5.2 del TFI corregido.
//
// La entregabilidad real se valida por separado sobre una muestra chica
// con destinatarios distintos.
// =============================================================================

const payload = $('Build WA payload').item.json;
const to = payload?.body?.to || 'unknown';

// wamid sintético: prefijo distintivo para poder filtrar en queries
// (SELECT ... WHERE wa_message_id LIKE 'wamid.sim_%')
const suffix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const fakeWamid = 'wamid.sim_' + suffix;

// Meta responde algo así:
//   { messaging_product: "whatsapp", contacts: [{...}], messages: [{ id: "wamid.HBg..." }] }
// Emitimos exactamente esa shape para que Parse WA response lo tome igual.
return {
    json: {
        messaging_product: 'whatsapp',
        contacts: [{ input: to, wa_id: to.replace(/\D/g, '') }],
        messages: [{ id: fakeWamid, message_status: 'accepted' }],
        _simulated: true,
    },
};
