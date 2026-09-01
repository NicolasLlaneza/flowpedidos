-- ============================================================================
-- TFI — Migración v1.3.0: instrumentación de latencia, validador y raw_events
-- ============================================================================
--
-- Corresponde a los identificadores contractuales nombrados en los Capítulos 3
-- y 4 reescritos del TFI (fuente de verdad). Renombrar cualquiera de estos
-- campos rompe el documento en silencio:
--
--   orders.ack_at                        (§4.1.1, confirmación temprana)
--   ai_notifications.dispatched_at       (§3.3, métrica end-to-end)
--   ai_notifications.atributos_usados    (§3.3, indicador de anclaje)
--   ai_notifications.validator_passes    (§4.3.1, contador de reintentos OK)
--   ai_notifications.validator_failures  (§4.3.1, reglas violadas)
--   tfi.raw_events                       (§4.1.1, persistencia previa al ACK)
--
-- Cómo aplicar:
--   docker compose exec postgres psql -U postgres -d tfi -f /migrations/04_instrumentation.sql
--
-- Idempotente: puede correrse sobre base nueva o sobre base existente.
-- ============================================================================

SET search_path TO tfi, public;

-- ----------------------------------------------------------------------------
-- 1. orders.ack_at — instante en que se emite el HTTP 200 al emisor
-- ----------------------------------------------------------------------------
-- La ventana received_at → ack_at debe ubicarse por debajo de 500 ms para
-- cumplir el requisito operativo de Mercado Libre (§4.1.1). NULL mientras el
-- ACK aún no se emitió (por ejemplo, si la validación de esquema falló antes).
ALTER TABLE tfi.orders
    ADD COLUMN IF NOT EXISTS ack_at timestamptz;

COMMENT ON COLUMN tfi.orders.ack_at
    IS 'Instante del HTTP 200 al emisor; received_at→ack_at debe ser <500 ms (§4.1.1)';

-- ----------------------------------------------------------------------------
-- 2. ai_notifications — instrumentación del componente cognitivo
-- ----------------------------------------------------------------------------
ALTER TABLE tfi.ai_notifications
    ADD COLUMN IF NOT EXISTS dispatched_at       timestamptz,
    ADD COLUMN IF NOT EXISTS atributos_usados    jsonb,
    ADD COLUMN IF NOT EXISTS validator_passes    smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS validator_failures  jsonb;

COMMENT ON COLUMN tfi.ai_notifications.dispatched_at
    IS 'Instante del despacho confirmado por WhatsApp; par con orders.received_at para eficiencia operativa (§3.3)';
COMMENT ON COLUMN tfi.ai_notifications.atributos_usados
    IS 'Atributos del pedido que el mensaje efectivamente cita (§3.3, indicador de anclaje contextual)';
COMMENT ON COLUMN tfi.ai_notifications.validator_passes
    IS 'Cantidad de pasadas del validador determinístico; 1 = pasó al primer intento (§4.3.1)';
COMMENT ON COLUMN tfi.ai_notifications.validator_failures
    IS 'Reglas violadas en cada pasada fallida; array de {regla, detalle} (§4.3.1)';

-- ----------------------------------------------------------------------------
-- 3. tfi.raw_events — persistencia del payload previa al ACK (§4.1.1)
-- ----------------------------------------------------------------------------
-- El evento se persiste ANTES de emitir el HTTP 200 al emisor. Si el
-- procesamiento posterior se interrumpe, la fila queda como registro
-- recuperable manualmente. NO es una cola de mensajes en sentido estricto: no
-- hay consumidor con reintento (limitación declarada en §4.6).
CREATE TABLE IF NOT EXISTS tfi.raw_events (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel       varchar(32) NOT NULL,
    payload       jsonb       NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now(),
    processed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS raw_events_received_at_idx
    ON tfi.raw_events (received_at DESC);

CREATE INDEX IF NOT EXISTS raw_events_unprocessed_idx
    ON tfi.raw_events (received_at DESC)
    WHERE processed_at IS NULL;

COMMENT ON TABLE  tfi.raw_events
    IS 'Payload original persistido antes del ACK; recuperable manualmente si el procesamiento se interrumpe (§4.1.1, §4.6)';
COMMENT ON COLUMN tfi.raw_events.processed_at
    IS 'Fija el momento en que el pipeline terminó de procesar este evento; NULL = pendiente/interrumpido';

-- ----------------------------------------------------------------------------
-- 4. audit_log insert-only — control técnico que respalda §4.5 (Tabla 4.2)
-- ----------------------------------------------------------------------------
-- El COMMENT sobre la tabla declaraba 'insert-only, sin updates' desde v1.0.0
-- pero no había mecanismo que lo respaldara. Con esto, ni siquiera el rol
-- operativo puede modificar el log una vez insertado.
REVOKE UPDATE, DELETE ON tfi.audit_log FROM tfi_app;

-- ----------------------------------------------------------------------------
-- 5. Registro de versión
-- ----------------------------------------------------------------------------
INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.3.0', 'Instrumentación: ack_at, dispatched_at, atributos_usados, validator_*, raw_events, audit_log insert-only')
ON CONFLICT DO NOTHING;
