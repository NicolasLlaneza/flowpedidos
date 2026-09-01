-- =============================================================================
-- 10_complete_raw_event.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query").
-- Se ejecuta al final de cada rama terminal del pipeline (happy path,
-- duplicado, dispatch_failed). Marca el raw_event como procesado.
-- Filas con processed_at NULL son eventos cuyo procesamiento se interrumpió y
-- requieren intervención manual (§4.6).
-- =============================================================================

UPDATE tfi.raw_events
   SET processed_at = now()
 WHERE id = $1
RETURNING id, received_at, processed_at,
          EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000 AS processing_ms;

-- Parámetros:
--   $1 = raw_event_id (propagado desde el normalizador a través del canónico)
