-- =============================================================================
-- 08_update_dispatch.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query") DESPUÉS del
-- HTTP Request a Meta Cloud API (tanto en el path OK como en el de error).
--
-- Cierra el ciclo de la notificación: marca si fue enviada o falló.
-- =============================================================================

UPDATE tfi.ai_notifications
SET
    message_status = $2,
    sent_at        = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
    -- v1.3 (§3.3): dispatched_at es el anclaje de la métrica de eficiencia
    -- operativa. Se llena EN LA MISMA EJECUCIÓN que emitió el pedido, así
    -- orders.received_at → ai_notifications.dispatched_at se mide sobre
    -- una sola corrida sin depender de la ejecución posterior de otro flujo.
    dispatched_at  = CASE WHEN $2 = 'sent' THEN now() ELSE dispatched_at END,
    wa_message_id  = NULLIF($3::text, 'null'),
    error_message  = NULLIF($4::text, 'null')
WHERE id = NULLIF($1::text, 'null')::uuid
RETURNING id, message_status, sent_at, dispatched_at, wa_message_id;

-- Parámetros:
--   $1 = {{ $json.notification_id }}
--   $2 = 'sent'   cuando Meta respondió 200 con messages[0].id
--        'failed' en cualquier otro caso
--   $3 = {{ $json.wa_message_id || null }}
--          → Meta responde: { messages: [{ id: "wamid.xxx" }] }
--          → Extraer con: {{ $json.messages?.[0]?.id ?? null }}
--   $4 = {{ $json.error_reason || null }}
--          → Completar solo en path de error; null en path feliz
