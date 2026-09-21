-- =============================================================================
-- export-anclaje.sql
-- -----------------------------------------------------------------------------
-- Exporta lo necesario para calcular el indicador de anclaje contextual
-- definido en la seccion 3.3: proporcion de mensajes con al menos un atributo
-- del pedido verificable en el texto.
--
-- No calcula el indicador: la verificacion de presencia textual requiere
-- normalizacion y coincidencia tolerante, y se hace en
-- scripts/analizar-anclaje.py sobre esta salida.
--
-- Como aplicar:
--   docker compose exec -T postgres psql -U n8n -d tfi -A -F"," --csv < sql/export-anclaje.sql > out/anclaje-crudo.csv
--
-- El primary_product_name replica getPrimaryProductName de
-- n8n-workflows/lib/build-llm-prompt.js: el item de mayor unit_price*quantity.
-- =============================================================================

SET search_path TO tfi, public;

WITH principal AS (
    SELECT DISTINCT ON (oi.order_id)
           oi.order_id,
           oi.product_name AS primary_product_name
    FROM tfi.order_items oi
    ORDER BY oi.order_id,
             (COALESCE(oi.unit_price, 0) * COALESCE(oi.quantity, 1)) DESC,
             oi.product_name
),
conteo AS (
    SELECT order_id, COUNT(*) AS items_count
    FROM tfi.order_items
    GROUP BY order_id
)
SELECT
    n.id                        AS notif_id,
    o.external_id,
    o.channel,
    o.status                    AS order_status,
    n.provider,
    n.is_fallback,
    n.prompt_version,
    COALESCE(c.items_count, 0)  AS items_count,
    p.primary_product_name,
    o.total_amount,
    o.currency,
    o.source_created_at,
    n.atributos_usados,
    n.validator_passes,
    n.validator_failures,
    replace(replace(n.message_text, E'\n', ' '), E'\r', ' ') AS message_text
FROM tfi.ai_notifications n
JOIN tfi.orders o        ON o.id = n.order_id
LEFT JOIN principal p    ON p.order_id = n.order_id
LEFT JOIN conteo   c     ON c.order_id = n.order_id
WHERE n.provider = 'openai'
ORDER BY o.received_at;
