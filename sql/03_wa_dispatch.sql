-- ============================================================================
-- TFI — Migración v1.2.0: soporte para despacho WhatsApp
-- ============================================================================
--
-- Agrega wa_message_id a ai_notifications para guardar el ID que devuelve
-- la Meta Cloud API al enviar el mensaje. Necesario para:
--   - Trazabilidad: relacionar el registro local con el evento en Meta
--   - Fase 5: webhook de estado de entrega (delivered / read) desde Meta
--
-- Cómo aplicar (primera vez):
--   docker compose exec postgres psql -U postgres -d tfi -f /migrations/03_wa_dispatch.sql
-- ============================================================================

SET search_path TO tfi, public;

-- Columna para el ID devuelto por Meta al hacer POST /messages
-- NULL mientras no se haya intentado el envío, vacío si falla antes de recibir ID
ALTER TABLE tfi.ai_notifications
    ADD COLUMN IF NOT EXISTS wa_message_id varchar(128);

-- Índice para buscar por wa_message_id cuando lleguen webhooks de entrega de Meta
CREATE INDEX IF NOT EXISTS ai_notif_wa_msg_id_idx
    ON tfi.ai_notifications (wa_message_id)
    WHERE wa_message_id IS NOT NULL;

COMMENT ON COLUMN tfi.ai_notifications.wa_message_id
    IS 'ID devuelto por Meta Cloud API al enviar; permite correlacionar webhooks de entrega';

-- ============================================================================
-- Registro de versión
-- ============================================================================
INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.2.0', 'ai_notifications: agrega wa_message_id para trazabilidad WhatsApp')
ON CONFLICT DO NOTHING;
