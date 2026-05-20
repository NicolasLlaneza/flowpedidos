// =============================================================================
// validate-webhook.js
// -----------------------------------------------------------------------------
// Pegar en un nodo "Code" de n8n (modo: "Run Once for All Items") ubicado
// inmediatamente después del Webhook trigger.
//
// Función:
//   - Valida la estructura mínima del payload entrante (estilo Mercado Libre)
//   - Si falta algo crítico, marca el item con `_validation_error` para que
//     el flujo lo rutee al rama de "respuesta 400 + audit"
//   - Si es válido, extrae el order_id desde el campo `resource` y lo deja
//     listo para que el siguiente nodo (HTTP Request) haga el enrich
//
// Output esperado por item:
//   {
//     valid: true | false,
//     errors: [string],         // vacío si valid=true
//     webhook: { ...original }, // payload tal cual llegó
//     order_id: "2000003508052235" | null,
//     channel: "mercadolibre",
//     received_at: ISO timestamp
//   }
// =============================================================================

const REQUIRED_FIELDS = ['resource', 'topic', 'user_id'];
const RESOURCE_PATTERN = /^\/orders\/(\d+)$/;
const SUPPORTED_TOPICS = ['orders_v2'];

const results = [];

for (const item of $input.all()) {
    const payload = item.json;
    const errors = [];

    // 1. Campos obligatorios presentes
    for (const field of REQUIRED_FIELDS) {
        if (payload[field] === undefined || payload[field] === null) {
            errors.push(`missing_field:${field}`);
        }
    }

    // 2. resource debe matchear el formato /orders/{id}
    let order_id = null;
    if (payload.resource) {
        const match = String(payload.resource).match(RESOURCE_PATTERN);
        if (match) {
            order_id = match[1];
        } else {
            errors.push(`invalid_resource_format:${payload.resource}`);
        }
    }

    // 3. topic debe ser uno de los soportados
    if (payload.topic && !SUPPORTED_TOPICS.includes(payload.topic)) {
        errors.push(`unsupported_topic:${payload.topic}`);
    }

    // 4. user_id debe ser numérico
    if (payload.user_id !== undefined && !Number.isFinite(Number(payload.user_id))) {
        errors.push(`invalid_user_id:${payload.user_id}`);
    }

    results.push({
        json: {
            valid: errors.length === 0,
            errors,
            webhook: payload,
            order_id,
            channel: 'mercadolibre',
            received_at: new Date().toISOString(),
        }
    });
}

return results;
