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
    error_message
)
VALUES (
    $1::uuid,
    $2, $3, $4,
    $5, $6, $7, $8,
    $9, $10, $11, $12,
    $13
)
RETURNING id AS notification_id, generated_at;

-- Parámetros:
--   $1  = {{ $json.order_id }}
--   $2  = 'openai' | 'anthropic' | 'template'
--   $3  = 'gpt-4o-mini' | 'claude-haiku-...' | NULL si template
--   $4  = 'v1' | 'v2' | ... | NULL si template
--   $5  = {{ $json.usage.prompt_tokens || null }}
--   $6  = {{ $json.usage.completion_tokens || null }}
--   $7  = {{ $json.cost_usd || null }}
--   $8  = {{ $json.latency_ms }}
--   $9  = {{ $json.message_text }}
--   $10 = 'generated' | 'validated' | 'rejected' | 'sent' | 'failed'
--   $11 = true | false
--   $12 = 'whatsapp' | 'email' | NULL
--   $13 = {{ $json.error_message || null }}
