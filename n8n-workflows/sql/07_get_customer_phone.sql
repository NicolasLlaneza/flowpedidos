-- =============================================================================
-- 07_get_customer_phone.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query") DESPUÉS de
-- 06_insert_ai_notification y ANTES de build-wa-payload.
--
-- Recupera el teléfono y nombre real del cliente para el despacho por WhatsApp.
-- Estos datos NUNCA llegan al LLM (seudonimización); se inyectan recién acá.
-- =============================================================================

SELECT
    c.phone,
    c.full_name
FROM tfi.customers  c
JOIN tfi.orders     o ON o.customer_id = c.id
WHERE o.id = $1::uuid;

-- Parámetros:
--   $1 = {{ $json.order_id }}
--        (viene del RETURNING de 06_insert_ai_notification)
--
-- Usamos order_id en lugar de customer_id: customer_id no está en ai_notifications
-- y se pierde en el RETURNING de 06. order_id sí se devuelve.
--
-- Si phone IS NULL, merge-dispatch-context.js propaga no_phone=true y el
-- IF node siguiente aborta la rama de envío.
