-- =============================================================================
-- 11_audit_normalization_warnings.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query") ubicado entre
-- Route to canonical y Check idempotency.
--
-- Registra en audit_log las reglas que el normalizador aplicó (buyer_id
-- sustituido, no_items, estados no mapeados, etc.). Si el pedido normalizó
-- sin observaciones, no inserta nada — el WHERE evalúa false y el SELECT
-- devuelve cero filas.
--
-- Diseño: usar INSERT ... SELECT ... WHERE en lugar de un IF node upstream
-- evita un merge de ramas posterior. El nodo siempre corre; sólo tiene
-- efecto cuando hay reglas.
-- =============================================================================

INSERT INTO tfi.audit_log (
    order_id, event_type, severity, component,
    message, payload, duration_ms, retry_attempt
)
SELECT
    NULL, 'normalization_warnings', 'warning', 'normalizer',
    'Reglas aplicadas por el normalizador (buyer_id sustituto, estados no mapeados, etc.)',
    $1::jsonb, NULL, 0
WHERE jsonb_array_length(
        COALESCE(($1::jsonb)->'applied_rules', '[]'::jsonb)
      ) > 0
RETURNING id AS audit_id, created_at;

-- Parámetros:
--   $1 = {{ JSON.stringify({channel: $json.order.channel,
--                           external_id: $json.order.external_id,
--                           applied_rules: $json.meta.applied_rules}) }}
--        (payload completo; el WHERE inspecciona `applied_rules` adentro)
