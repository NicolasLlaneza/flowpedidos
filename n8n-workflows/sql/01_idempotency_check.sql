-- =============================================================================
-- 01_idempotency_check.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" de n8n (Operation: "Execute Query")
-- inmediatamente después del normalizador.
--
-- Verifica si la orden ya fue persistida (por UNIQUE external_id+channel).
-- DEVUELVE SIEMPRE 1 FILA con un booleano `already_exists`:
--   - already_exists = true  → la orden ya estaba registrada (duplicado)
--   - already_exists = false → orden nueva, continuar con la inserción
--
-- Esta forma evita el patrón problemático en n8n donde un Postgres node que
-- devuelve 0 filas hace que el siguiente nodo no reciba items y la cadena
-- se corte silenciosamente.
--
-- En el IF node siguiente usar: {{ $json.already_exists }}
--   - true  → rama duplicado (audit_log + Respond 200)
--   - false → rama nueva (Upsert customer → Insert Order → …)
--
-- También se conservan los datos del pedido existente (cuando hay match) por
-- si la rama duplicado los necesita para auditoría.
-- =============================================================================

SELECT
    o.id                  AS existing_order_id,
    o.status              AS existing_status,
    o.received_at         AS existing_received_at,
    (o.id IS NOT NULL)    AS already_exists
FROM (SELECT 1) AS _dummy
LEFT JOIN tfi.orders o
    ON o.external_id = $1
   AND o.channel     = $2;

-- Parámetros (en n8n: Query Parameters):
--   $1 = {{ $json.order.external_id }}
--   $2 = {{ $json.order.channel }}
