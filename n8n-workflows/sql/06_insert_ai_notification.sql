-- =============================================================================
-- 06_insert_ai_notification.sql
-- -----------------------------------------------------------------------------
-- Pegar en un nodo "Postgres" (Operation: "Execute Query") después de
-- invocar al LLM y validar la respuesta.
--
-- Cubre los tres casos:
--   a) Respuesta LLM válida → provider='openai'/'anthropic', is_fallback=false
--   b) Respuesta LLM inválida → message_status='rejected', is_fallback=false
--   c) Fallback a plantilla   → provider='template', is_fallback=true
--
-- El CHECK constraint en la tabla valida la coherencia provider↔is_fallback.
-- =============================================================================

INSERT INTO tfi.ai_notifications (
    order_id,
    provider, model, prompt_version,
    prompt_tokens, completion_tokens, cost_usd, latency_ms,
    message_text, message_status, is_fallback, delivery_channel,
    error_message,
    atributos_usados, validator_passes, validator_failures
)
VALUES (
    NULLIF($1::text, 'null')::uuid,
    $2, NULLIF($3::text, 'null'), NULLIF($4::text, 'null'),
    NULLIF($5::text, 'null')::integer, NULLIF($6::text, 'null')::integer, NULLIF($7::text, 'null')::numeric, NULLIF($8::text, 'null')::integer,
    $9, $10, NULLIF($11::text, 'null')::boolean, NULLIF($12::text, 'null'),
    NULLIF($13::text, 'null'),
    NULLIF($14::text, 'null')::jsonb,
    COALESCE(NULLIF($15::text, 'null')::smallint, 1),
    NULLIF($16::text, 'null')::jsonb
)
RETURNING id AS notification_id, order_id, message_text, atributos_usados,
          validator_passes, validator_failures, generated_at;
-- order_id y message_text son necesarios para los nodos de despacho (07, 08).
-- atributos_usados, validator_passes, validator_failures alimentan las
-- métricas del §3.3 y §4.3.1 del TFI corregido.

-- Parámetros:
--   $1  = {{ $json.order_id }}
--   $2  = 'openai' | 'anthropic' | 'template'
--   $3  = 'gpt-4o-mini' | 'claude-haiku-...' | NULL si template
--   $4  = 'v1' | 'v2' | ... | NULL si template
--   $5  = {{ $json.prompt_tokens || null }}
--   $6  = {{ $json.completion_tokens || null }}
--   $7  = {{ $json.cost_usd || null }}
--   $8  = {{ $json.latency_ms }}
--   $9  = {{ $json.message_text }}
--   $10 = 'generated' | 'validated' | 'rejected' | 'sent' | 'failed'
--   $11 = true | false
--   $12 = 'whatsapp' | 'email' | NULL
--   $13 = {{ $json.error_message || null }}
--   $14 = {{ JSON.stringify($json.atributos_usados || []) }}    -- v1.3 (§3.3)
--   $15 = {{ $json.validator_passes || 1 }}                     -- v1.3 (§4.3.1)
--   $16 = {{ JSON.stringify($json.validator_failures || []) }}  -- v1.3 (§4.3.1)
