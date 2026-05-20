-- =============================================================================
-- 02_upsert_customer.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query").
--
-- INSERT con ON CONFLICT: si el comprador ya existe (mismo external_id+channel)
-- actualiza los datos por si vinieron actualizados en este pedido.
-- En cualquier caso devuelve la fila con `id` (uuid) para usar en orders.customer_id.
-- =============================================================================

INSERT INTO tfi.customers (
    external_id, channel, pseudonym,
    full_name, email, phone,
    email_hash, phone_hash
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (external_id, channel) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name,  tfi.customers.full_name),
    email      = COALESCE(EXCLUDED.email,      tfi.customers.email),
    phone      = COALESCE(EXCLUDED.phone,      tfi.customers.phone),
    email_hash = COALESCE(EXCLUDED.email_hash, tfi.customers.email_hash),
    phone_hash = COALESCE(EXCLUDED.phone_hash, tfi.customers.phone_hash),
    updated_at = now()
RETURNING id AS customer_id, pseudonym;

-- Parámetros:
--   $1 = {{ $json.customer.external_id }}
--   $2 = {{ $json.customer.channel }}
--   $3 = {{ $json.customer.pseudonym }}
--   $4 = {{ $json.customer.full_name }}
--   $5 = {{ $json.customer.email }}
--   $6 = {{ $json.customer.phone }}
--   $7 = {{ $json.customer.email_hash }}
--   $8 = {{ $json.customer.phone_hash }}
