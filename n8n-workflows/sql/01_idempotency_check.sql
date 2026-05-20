-- =============================================================================
-- 01_idempotency_check.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" de n8n (Operation: "Execute Query")
-- inmediatamente después del normalizador.
--
-- Verifica si la orden ya fue persistida (por UNIQUE external_id+channel).
-- Devuelve 1 fila si ya existe, 0 filas si es nueva.
--
-- En n8n usar un IF node después: si rows > 0, ir al rama "duplicado"
-- (loguear en audit_log y responder 200 sin re-insertar).
-- =============================================================================

SELECT
    o.id              AS order_id,
    o.external_id,
    o.channel,
    o.status,
    o.received_at,
    true              AS already_exists
FROM tfi.orders o
WHERE o.external_id = $1
  AND o.channel     = $2;

-- Parámetros (en n8n: Query Parameters):
--   $1 = {{ $json.order.external_id }}
--   $2 = {{ $json.order.channel }}
