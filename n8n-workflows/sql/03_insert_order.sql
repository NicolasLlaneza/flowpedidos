-- =============================================================================
-- 03_insert_order.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query").
-- Se ejecuta DESPUÉS de upsert_customer y solo si el idempotency_check
-- devolvió 0 filas (la orden es nueva).
--
-- ON CONFLICT DO NOTHING: defensa adicional contra race condition si dos
-- webhooks idénticos entran en paralelo. Si ya existe, devuelve 0 filas.
-- =============================================================================

INSERT INTO tfi.orders (
    external_id, channel, customer_id,
    status, total_amount, currency,
    source_created_at, raw_payload, normalization_version,
    received_at, ack_at
)
VALUES (
    $1, $2, $3,
    $4, $5, $6,
    $7, $8::jsonb, $9,
    $10::timestamptz, $10::timestamptz
)
ON CONFLICT (external_id, channel) DO NOTHING
RETURNING id AS order_id, received_at, ack_at;

-- Parámetros:
--   $1  = {{ $json.order.external_id }}
--   $2  = {{ $json.order.channel }}
--   $3  = {{ $json.customer_id }}                     -- viene del upsert previo
--   $4  = {{ $json.order.status }}
--   $5  = {{ $json.order.total_amount }}
--   $6  = {{ $json.order.currency }}
--   $7  = {{ $json.order.source_created_at }}
--   $8  = {{ JSON.stringify($json.order.raw_payload) }}
--   $9  = {{ $json.order.normalization_version }}
--   $10 = {{ $json.ack_at }}                          -- desde Persist raw event (v1.3)
--                                                      Se usa como received_at y ack_at:
--                                                      capturan el mismo instante (webhook
--                                                      arrival + ACK inmediato ~ms después).
