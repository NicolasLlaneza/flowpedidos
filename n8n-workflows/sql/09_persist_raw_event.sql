-- =============================================================================
-- 09_persist_raw_event.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query").
-- Se ejecuta INMEDIATAMENTE después de la validación de esquema y ANTES del
-- Respond to Webhook. Persiste el payload original y captura el instante que
-- se usará como ack_at para la fila de orders (§4.1.1 del TFI corregido).
--
-- No es una cola de mensajes: no hay consumidor con reintento sobre
-- raw_events. Es persistencia ante interrupción posterior del pipeline (§4.6).
-- =============================================================================

INSERT INTO tfi.raw_events (channel, payload)
VALUES ($1, $2::jsonb)
RETURNING id AS raw_event_id, received_at AS ack_at;

-- Parámetros:
--   $1 = canal ('mercadolibre' | 'woocommerce')
--   $2 = payload original del webhook (objeto crudo serializado)
