-- =============================================================================
-- 08_update_dispatch.sql  (v1.4)
-- -----------------------------------------------------------------------------
-- Nodo "Update dispatch" (Postgres, Execute Query), después del envío a Meta
-- o de su simulación. Cierra el ciclo de la notificación y, desde v1.4,
-- guarda el cuerpo exacto que se envió (dispatched_body), de modo que el
-- mensaje despachado queda acreditado y no solo el texto generado (NA-06).
-- Requiere sql/05_dispatched_body.sql.
-- =============================================================================

UPDATE tfi.ai_notifications
SET
    message_status  = $2,
    sent_at         = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
    dispatched_at   = CASE WHEN $2 = 'sent' THEN now() ELSE dispatched_at END,
    wa_message_id   = NULLIF($3::text, 'null'),
    error_message   = NULLIF($4::text, 'null'),
    dispatched_body = COALESCE(NULLIF($5::text, 'null'), dispatched_body)
WHERE id = NULLIF($1::text, 'null')::uuid
RETURNING id, message_status, sent_at, dispatched_at, wa_message_id;

-- Parámetros (arreglo, para que las comas del cuerpo no partan los valores):
--   $1 = id de la notificación (Insert ai_notification)
--   $2 = 'sent' | 'failed'
--   $3 = wamid devuelto por Meta, o null
--   $4 = motivo del error, o null
--   $5 = meta_body.text.body armado por Build WA payload
