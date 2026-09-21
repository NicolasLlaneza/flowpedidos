-- =============================================================================
-- export-defectos.sql
-- -----------------------------------------------------------------------------
-- Tres consultas para los hallazgos NA-01, NM-08 y NA-06 de la devolucion.
-- Se ejecutan juntas y su salida se lee en pantalla, no se procesa con script.
--
-- Como aplicar:
--   docker compose exec -T postgres psql -U n8n -d tfi -f - < sql/export-defectos.sql
-- =============================================================================

SET search_path TO tfi, public;

\echo ''
\echo '=== 1. NA-01 y NM-08 · el unico rechazo del validador (WC-16) ==================='
\echo 'Se busca el mensaje que no aprobo en primer intento: su texto, las reglas que'
\echo 'violo, su costo y su latencia. El informe sostiene que el rechazo es con alta'
\echo 'probabilidad un falso positivo de la regla 1, que usa coincidencia de subcadena.'
\echo ''

SELECT
    o.external_id,
    o.channel,
    o.status,
    n.provider,
    n.is_fallback,
    n.validator_passes,
    n.validator_failures,
    n.cost_usd,
    n.latency_ms,
    n.prompt_tokens,
    n.completion_tokens,
    n.message_text
FROM tfi.ai_notifications n
JOIN tfi.orders o ON o.id = n.order_id
WHERE n.validator_passes <> 1
   OR n.is_fallback = true
   OR n.validator_failures IS NOT NULL
ORDER BY o.received_at;

\echo ''
\echo '=== 2. NA-01 · comprobacion del falso positivo ==================================='
\echo 'La regla 1 rechaza si el texto contiene el external_id. Los identificadores de'
\echo 'WooCommerce son numeros de dos digitos, de modo que cualquier cifra del mensaje'
\echo 'que los contenga como subcadena dispara el rechazo. Se lista, para cada pedido'
\echo 'de WooCommerce, si su external_id aparece como subcadena del mensaje.'
\echo ''

SELECT
    o.external_id,
    length(o.external_id)                              AS largo_id,
    position(o.external_id in n.message_text) > 0      AS id_como_subcadena,
    n.validator_passes,
    substring(n.message_text from 1 for 120)           AS inicio_mensaje
FROM tfi.ai_notifications n
JOIN tfi.orders o ON o.id = n.order_id
WHERE o.channel = 'woocommerce'
  AND n.provider = 'openai'
ORDER BY id_como_subcadena DESC, o.received_at
LIMIT 20;

\echo ''
\echo '=== 3. NA-06 · cuerpo de los mensajes efectivamente despachados =================='
\echo 'Muestra de mensajes del canal de WooCommerce con despacho confirmado. El saludo'
\echo 'nominal se neutraliza aqui mismo para poder publicarlos: lo que interesa es'
\echo 'acreditar que el cuerpo difiere entre pedidos, no quien lo recibio.'
\echo ''

SELECT
    o.external_id,
    o.status,
    n.message_status,
    n.sent_at IS NOT NULL                              AS despachado,
    regexp_replace(n.message_text, '¡Hola[^!]*!', '¡Hola!') AS mensaje_neutralizado
FROM tfi.ai_notifications n
JOIN tfi.orders o ON o.id = n.order_id
WHERE o.channel = 'woocommerce'
  AND n.provider = 'openai'
  AND n.message_status = 'sent'
ORDER BY o.received_at
LIMIT 12;

\echo ''
\echo '=== 4. control · conteos que el Capitulo 5 reporta ==============================='
\echo ''

SELECT
    (SELECT count(*) FROM tfi.orders)                                            AS pedidos_persistidos,
    (SELECT count(*) FROM tfi.ai_notifications)                                  AS notificaciones,
    (SELECT count(*) FROM tfi.ai_notifications WHERE provider = 'openai')        AS generadas_por_modelo,
    (SELECT count(*) FROM tfi.ai_notifications WHERE is_fallback)                AS degradadas_a_plantilla,
    (SELECT count(DISTINCT o.id) FROM tfi.orders o
        LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
        WHERE n.id IS NULL)                                                      AS pedidos_sin_notificacion,
    (SELECT count(DISTINCT o.id) FROM tfi.orders o
        LEFT JOIN tfi.order_items i ON i.order_id = o.id
        WHERE i.id IS NULL)                                                      AS pedidos_sin_items;
