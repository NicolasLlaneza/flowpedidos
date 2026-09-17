-- =============================================================================
-- export-tabla-5-3.sql
-- -----------------------------------------------------------------------------
-- Genera el contenido de la Tabla 5.3 del documento: un mensaje real por cada
-- estado canónico que efectivamente invoca al modelo de lenguaje, con el saludo
-- resuelto —es decir, con el nombre sintético completo ya sustituido en lugar
-- del token {{saludo}}—.
--
-- Por qué con el nombre completo y no neutralizado: la Tabla 5.3 es la
-- evidencia de que la sustitución determinística posterior a la generación
-- funciona, que es la corrección al defecto de fuga de seudónimo del prompt v1.
-- Neutralizar el saludo borra exactamente lo que la tabla debe demostrar. Los
-- nombres provienen del generador con semilla 42 y no corresponden a personas
-- reales, de modo que no hay dato personal que proteger.
--
-- Uso:
--   docker exec -i tfi-postgres psql -U postgres -d tfi -f - < export-tabla-5-3.sql
--
-- o, si preferís dejarlo dentro del contenedor:
--   docker cp export-tabla-5-3.sql tfi-postgres:/tmp/
--   docker exec tfi-postgres psql -U postgres -d tfi -f /tmp/export-tabla-5-3.sql
-- =============================================================================

\pset format unaligned
\pset fieldsep ' || '
\pset footer off

-- Un mensaje por estado canónico, el primero de cada uno en orden de creación,
-- restringido a los generados por el modelo (no plantilla) y aprobados por el
-- validador en su primer intento.
WITH ranked AS (
    SELECT
        o.status                          AS estado,
        n.id                              AS notif_id,
        n.message                         AS mensaje,
        n.provider,
        n.is_fallback,
        n.validator_passes,
        c.full_name                       AS destinatario,
        ROW_NUMBER() OVER (PARTITION BY o.status ORDER BY n.created_at) AS rn
    FROM tfi.ai_notifications n
    JOIN tfi.orders    o ON o.id = n.order_id
    JOIN tfi.customers c ON c.id = o.customer_id
    WHERE n.is_fallback = false
      AND n.provider    = 'openai'
      AND n.validator_passes = 1
)
SELECT estado, notif_id, destinatario, mensaje
FROM ranked
WHERE rn = 1
ORDER BY CASE estado
    WHEN 'paid'            THEN 1
    WHEN 'pending_payment' THEN 2
    WHEN 'shipped'         THEN 3
    WHEN 'delivered'       THEN 4
    WHEN 'cancelled'       THEN 5
    WHEN 'refunded'        THEN 6
    ELSE 7
END;

-- -----------------------------------------------------------------------------
-- Comprobaciones de consistencia con lo afirmado en el Capítulo 5.
-- Los cuatro valores deben dar: 141, 141, 0 y 147.
-- -----------------------------------------------------------------------------
\echo ''
\echo '--- verificaciones ---'

SELECT 'mensajes generados por el modelo'            AS control, count(*)::text AS valor
FROM tfi.ai_notifications WHERE is_fallback = false AND provider = 'openai'
UNION ALL
SELECT 'aprobados por el validador en primer intento', count(*)::text
FROM tfi.ai_notifications WHERE validator_passes = 1
UNION ALL
SELECT 'degradados a plantilla estática',             count(*)::text
FROM tfi.ai_notifications WHERE is_fallback = true
UNION ALL
SELECT 'pedidos únicos persistidos',                  count(*)::text
FROM tfi.orders
UNION ALL
SELECT 'mensajes que aún contienen el token de saludo sin sustituir', count(*)::text
FROM tfi.ai_notifications WHERE message LIKE '%{{saludo}}%'
UNION ALL
SELECT 'mensajes que contienen un seudónimo interno (cust_)',         count(*)::text
FROM tfi.ai_notifications WHERE message LIKE '%cust\_%';
