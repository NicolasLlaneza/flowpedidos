-- =============================================================================
-- export-tabla-5-4.sql
-- -----------------------------------------------------------------------------
-- Genera el contenido de la Tabla 5.4 del documento: un mensaje por cada estado
-- canónico que invoca al modelo de lenguaje, tomado de LA CORRIDA REPORTADA en
-- el Capítulo 5 (2026-09-15) y no de una ejecución anterior.
--
-- Qué cambia respecto de la tabla que hay hoy en el documento:
--   1. Los ejemplos pasan a provenir de la corrida reportada. El epígrafe actual
--      declara que provienen de "una ejecución del pipeline bajo la misma
--      configuración", que es una salvedad que deja de hacer falta.
--   2. Se agrega el estado `shipped`, hoy ausente pese a que el epígrafe promete
--      "uno por cada estado canónico que invoca al modelo de lenguaje" y a que
--      ese estado aportó dieciocho pedidos a la etapa de generación.
--
-- El saludo se neutraliza a "¡Hola!" deliberadamente: en el brazo de WooCommerce
-- el nombre del cliente es el del destinatario real de la verificación de
-- despacho, de modo que reproducirlo publicaría un dato personal, en contra del
-- criterio de minimización de las secciones 2.7 y 3.12.
--
-- Uso:
--   docker exec -i tfi-postgres psql -U postgres -d tfi -f - < export-tabla-5-4.sql
-- =============================================================================

\pset format unaligned
\pset fieldsep ' || '
\pset footer off

WITH rankeadas AS (
    SELECT
        o.status                                           AS estado,
        n.id                                               AS notif_id,
        regexp_replace(n.message, '^¡Hola[^!]*!', '¡Hola!') AS mensaje,
        o.channel,
        ROW_NUMBER() OVER (PARTITION BY o.status ORDER BY n.created_at) AS rn
    FROM tfi.ai_notifications n
    JOIN tfi.orders o ON o.id = n.order_id
    WHERE o.received_at >= '2026-09-15'      -- solo la corrida reportada
      AND n.is_fallback     = false          -- generado por el modelo, no plantilla
      AND n.provider        = 'openai'
      AND n.validator_passes = 1             -- aprobado en primer intento
)
SELECT estado, notif_id, channel, mensaje
FROM rankeadas
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
-- Controles. Los valores esperados, ya verificados contra out/corrida-v2.csv:
--   pedidos de la corrida reportada .................... 148
--   alcanzaron la etapa de generación .................. 143
--   aprobados por el validador en primer intento ....... 142
--   degradados a plantilla estática .................... 1
--   estados canónicos con al menos un mensaje del modelo . 6
--   mensajes con el token de saludo sin sustituir ...... 0
--   mensajes con un seudónimo interno (cust_) .......... 0
-- -----------------------------------------------------------------------------
\echo ''
\echo '--- controles ---'

SELECT 'pedidos de la corrida reportada' AS control, count(*)::text AS valor
FROM tfi.orders WHERE received_at >= '2026-09-15'
UNION ALL
SELECT 'alcanzaron la etapa de generación', count(*)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15'
UNION ALL
SELECT 'aprobados por el validador en primer intento', count(*)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15' AND n.validator_passes = 1
UNION ALL
SELECT 'degradados a plantilla estática', count(*)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15' AND n.is_fallback = true
UNION ALL
SELECT 'estados canónicos con mensaje del modelo', count(DISTINCT o.status)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15' AND n.is_fallback = false AND n.provider = 'openai'
UNION ALL
SELECT 'mensajes con el token de saludo sin sustituir', count(*)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15' AND n.message LIKE '%{{saludo}}%'
UNION ALL
SELECT 'mensajes con seudónimo interno (cust_)', count(*)::text
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE o.received_at >= '2026-09-15' AND n.message LIKE '%cust\_%';
