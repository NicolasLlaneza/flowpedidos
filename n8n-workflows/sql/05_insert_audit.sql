-- =============================================================================
-- 05_insert_audit.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query") usado a lo largo
-- del workflow para registrar eventos.
--
-- Usar uno por rama lógica: webhook_received, validation_failed,
-- enrich_ok, enrich_failed, normalization_ok, duplicate_detected,
-- persisted_ok, llm_call_ok, llm_call_failed, fallback_triggered,
-- message_sent, etc.
-- =============================================================================

INSERT INTO tfi.audit_log (
    order_id, event_type, severity, component,
    message, payload, duration_ms, retry_attempt
)
VALUES (
    $1::uuid, $2, $3, $4,
    $5, $6::jsonb, $7, $8
)
RETURNING id AS audit_id, created_at;

-- Parámetros:
--   $1 = {{ $json.order_id }}                         -- NULL si aún no hay order
--   $2 = 'webhook_received' / 'validation_failed' / etc.
--   $3 = 'info' / 'warning' / 'error'
--   $4 = 'webhook' / 'normalizer' / 'persister' / 'llm' / 'auditor'
--   $5 = 'mensaje legible para humanos'
--   $6 = {{ JSON.stringify({...contexto relevante}) }}
--   $7 = {{ $json.duration_ms || null }}
--   $8 = {{ $json.retry_attempt || 0 }}
