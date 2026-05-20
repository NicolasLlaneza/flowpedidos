-- =============================================================================
-- 04_insert_items.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Insert" en modo "Multiple Items")
-- o en modo "Execute Query" iterando por item.
--
-- Para "Execute Query" con un solo item por ejecución, usar este SQL.
-- En n8n, antes de este nodo, usar un "Split In Batches" o "Item Lists" para
-- expandir $json.items en items individuales.
-- =============================================================================

INSERT INTO tfi.order_items (
    order_id, sku, product_name,
    quantity, unit_price, delivery_status, metadata
)
VALUES (
    $1, $2, $3,
    $4, $5, $6, $7::jsonb
)
RETURNING id AS item_id;

-- Parámetros (uno por item del array):
--   $1 = {{ $json.order_id }}
--   $2 = {{ $json.sku }}
--   $3 = {{ $json.product_name }}
--   $4 = {{ $json.quantity }}
--   $5 = {{ $json.unit_price }}
--   $6 = {{ $json.delivery_status }}
--   $7 = {{ JSON.stringify($json.metadata || {}) }}
