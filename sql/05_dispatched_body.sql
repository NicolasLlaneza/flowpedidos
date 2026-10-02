-- =============================================================================
-- TFI — Migración v1.4.0: cuerpo del mensaje despachado
-- -----------------------------------------------------------------------------
-- Guarda en ai_notifications el cuerpo exacto que se envió a la API de
-- WhatsApp. La versión evaluada solo conservaba el texto generado, y el cuerpo
-- se armaba después (Build WA payload), de modo que no era posible acreditar
-- qué recibió el destinatario (hallazgo NA-06 de la devolución).
--
-- Cómo aplicar:
--   docker compose exec -T postgres psql -U n8n -d tfi -v ON_ERROR_STOP=1 < sql/05_dispatched_body.sql
-- =============================================================================

SET search_path TO tfi, public;

ALTER TABLE tfi.ai_notifications
    ADD COLUMN IF NOT EXISTS dispatched_body text;

COMMENT ON COLUMN tfi.ai_notifications.dispatched_body
    IS 'Cuerpo exacto enviado a la API de mensajería (incluye el saludo rehidratado)';

INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.4.0', 'ai_notifications.dispatched_body: cuerpo despachado')
ON CONFLICT DO NOTHING;
