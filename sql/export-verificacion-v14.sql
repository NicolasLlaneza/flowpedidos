-- =============================================================================
-- export-verificacion-v14.sql · resultados de la corrida de verificación v1.4
-- -----------------------------------------------------------------------------
-- Solo agregados y textos generados sin el saludo: no devuelve nombres,
-- teléfonos ni correos.
-- Uso (desde la carpeta donde corre el stack):
--   docker compose exec -T postgres psql -U n8n -d tfi -A -F ";" -P footer=off \
--     < ruta\sql\export-verificacion-v14.sql > out\verificacion-v14.txt
-- =============================================================================

\echo '== V0 · versión del esquema'
SELECT version, applied_at FROM tfi.schema_version ORDER BY applied_at;

\echo '== V1 · pedidos y notificaciones'
SELECT (SELECT count(*) FROM tfi.orders)                                   AS pedidos,
       (SELECT count(*) FROM tfi.orders WHERE status <> 'error')            AS pedidos_notificables,
       (SELECT count(*) FROM tfi.ai_notifications)                          AS notificaciones,
       (SELECT count(*) FROM tfi.ai_notifications WHERE is_fallback)        AS plantillas;

\echo '== V2 · pedidos notificables sin notificación (esperado: 0)'
SELECT o.external_id, o.channel, o.status
FROM tfi.orders o
LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
WHERE o.status <> 'error' AND n.id IS NULL;

\echo '== V3 · distribución de pasadas del validador'
SELECT is_fallback, validator_passes, count(*) AS n
FROM tfi.ai_notifications GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== V4 · reglas que rechazaron un primer intento'
SELECT f->>'regla' AS regla, count(*) AS n
FROM tfi.ai_notifications n,
     jsonb_array_elements(n.validator_failures) v,
     jsonb_array_elements(COALESCE(v->'fallas', '[]'::jsonb)) f
WHERE (v->>'intento')::int = 1
GROUP BY 1 ORDER BY 2 DESC;

\echo '== V5 · resultado del reintento (rechazo forzado incluido)'
SELECT CASE
         WHEN NOT is_fallback AND validator_passes = 2 THEN 'reintento aprobado'
         WHEN validator_failures::text LIKE '%retry_failed%' THEN 'reintento con error de red/credencial'
         WHEN validator_failures::text LIKE '%"intento": 2%' THEN 'reintento rechazado -> plantilla'
         ELSE 'otro'
       END AS resultado, count(*) AS n
FROM tfi.ai_notifications
WHERE validator_failures::text LIKE '%"intento": 1%'
GROUP BY 1 ORDER BY 1;

\echo '== V6 · rechazos forzados (TFI_FORZAR_RECHAZO)'
SELECT o.external_id, o.channel, n.is_fallback, n.validator_passes,
       left(regexp_replace(n.message_text, '^¡Hola[^!]*!\s*', ''), 160) AS texto_final_sin_saludo
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE n.validator_failures::text LIKE '%prueba_forzada%'
ORDER BY o.external_id;

\echo '== V7 · degradación por LLM no disponible (prueba de falla)'
SELECT count(*) AS n_llm_unavailable
FROM tfi.ai_notifications WHERE validator_failures::text LIKE '%llm_unavailable%';

\echo '== V8 · costo conservado en plantillas (NM-08)'
SELECT count(*) FILTER (WHERE cost_usd > 0)  AS plantillas_con_costo,
       count(*) FILTER (WHERE cost_usd = 0)  AS plantillas_sin_llamada_previa,
       round(sum(cost_usd), 6)               AS costo_total_plantillas
FROM tfi.ai_notifications WHERE is_fallback;

\echo '== V9 · cuerpo despachado registrado (NA-06)'
SELECT message_status,
       count(*)                                        AS n,
       count(dispatched_body)                          AS con_cuerpo,
       count(*) FILTER (WHERE dispatched_body LIKE '%' || message_text || '%') AS cuerpo_contiene_texto
FROM tfi.ai_notifications GROUP BY 1 ORDER BY 1;

\echo '== V10 · auditoría de fallas de persistencia de ítems (NA-02)'
SELECT event_type, count(*) AS n
FROM tfi.audit_log
WHERE event_type IN ('items_insert_failed', 'fallback_triggered', 'error_state')
GROUP BY 1 ORDER BY 1;

\echo '== V11 · falso positivo WC-16: mensajes que contienen una medida con el id del pedido'
SELECT o.external_id, n.is_fallback, n.validator_passes, left(regexp_replace(n.message_text, '^¡Hola[^!]*!\s*', ''), 160) AS texto_sin_saludo
FROM tfi.ai_notifications n JOIN tfi.orders o ON o.id = n.order_id
WHERE n.message_text ~ ('/' || o.external_id || '\M');

\echo '== V12 · errores del reintento (esperado: ninguno con "fetch is not defined" ni "no hay cliente HTTP")'
SELECT v->>'error' AS error, count(*) AS n
FROM tfi.ai_notifications n, jsonb_array_elements(n.validator_failures) v
WHERE v ? 'error'
GROUP BY 1 ORDER BY 2 DESC;

\echo '== V13 · pedidos de título largo (NC-05): ítems persistidos (esperado: 1 por pedido)'
SELECT o.external_id, o.channel, count(i.id) AS items
FROM tfi.orders o LEFT JOIN tfi.order_items i ON i.order_id = o.id
WHERE o.external_id IN ('3000000000000145','3000000000000146','3000000000000147',
                        '3000000000000148','3000000000000149','3000000000000150')
GROUP BY 1, 2 ORDER BY 1;
