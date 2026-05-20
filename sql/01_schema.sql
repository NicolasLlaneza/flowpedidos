-- ============================================================================
-- TFI — Modelo de datos canónico
-- Tecnicatura Universitaria en Programación, UTN-FRM, 2026
-- ============================================================================
--
-- Schema dedicado `tfi` para aislar nuestras tablas de las tablas internas
-- de n8n (que viven en `public`).
--
-- Convenciones:
--   - PKs uuid generadas con gen_random_uuid()
--   - timestamps timestamptz (con timezone) por consistencia
--   - JSONB para payloads originales y contextos (más eficiente que TEXT)
--   - Naming: snake_case, plural en tablas, singular en columnas
--   - FKs con ON DELETE: CASCADE para items, RESTRICT para orders→customers
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS tfi;
SET search_path TO tfi, public;

-- pgcrypto provee gen_random_uuid() (PG13+ ya lo trae, pero lo aseguramos)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Tabla: customers
-- ----------------------------------------------------------------------------
-- Identifica al comprador. Aplica seudonimización para uso con el LLM:
-- el pipeline envía `pseudonym` al modelo, nunca el nombre/email real.
-- ============================================================================
CREATE TABLE tfi.customers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     varchar(128) NOT NULL,
    channel         varchar(32)  NOT NULL,
    pseudonym       varchar(64)  NOT NULL,
    -- Datos personales: minimizados pero conservados para auditoría operativa
    full_name       varchar(255),
    email           varchar(255),
    phone           varchar(64),
    -- Hashes para matching sin exponer el dato (futuro: dedupe entre canales)
    email_hash      char(64),
    phone_hash      char(64),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customers_external_uq UNIQUE (external_id, channel)
);

CREATE INDEX customers_email_hash_idx ON tfi.customers (email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX customers_pseudonym_idx  ON tfi.customers (pseudonym);

COMMENT ON TABLE  tfi.customers IS 'Compradores normalizados; pseudonym se usa al invocar el LLM';
COMMENT ON COLUMN tfi.customers.pseudonym IS 'Token opaco enviado al LLM en lugar de PII (ej: cust_abc123)';

-- ============================================================================
-- Tabla: orders
-- ----------------------------------------------------------------------------
-- Entidad central. UNIQUE(external_id, channel) garantiza idempotencia:
-- un webhook reenviado por la plataforma no crea un duplicado.
-- ============================================================================
CREATE TABLE tfi.orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     varchar(128) NOT NULL,
    channel         varchar(32)  NOT NULL,
    customer_id     uuid REFERENCES tfi.customers(id) ON DELETE RESTRICT,
    -- Estado normalizado del modelo canónico (no el estado crudo del canal)
    status          varchar(32)  NOT NULL,
    total_amount    numeric(14,2) NOT NULL,
    currency        char(3)      NOT NULL DEFAULT 'ARS',
    -- Timestamps
    source_created_at timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    processed_at      timestamptz,
    -- Trazabilidad: guardamos el payload crudo para reconstruir o re-procesar
    raw_payload     jsonb        NOT NULL,
    -- Versionado del mapeo aplicado (por si cambia el adaptador del canal)
    normalization_version varchar(16) NOT NULL DEFAULT 'v1',

    CONSTRAINT orders_external_uq    UNIQUE (external_id, channel),
    CONSTRAINT orders_status_chk     CHECK (status IN (
        'created','pending_payment','paid','preparing','shipped',
        'delivered','cancelled','refunded','error'
    )),
    CONSTRAINT orders_channel_chk    CHECK (channel IN (
        'mercadolibre','woocommerce','shopify','tienda_nube','whatsapp','manual'
    )),
    CONSTRAINT orders_amount_chk     CHECK (total_amount >= 0)
);

CREATE INDEX orders_status_idx       ON tfi.orders (status);
CREATE INDEX orders_channel_idx      ON tfi.orders (channel);
CREATE INDEX orders_received_at_idx  ON tfi.orders (received_at DESC);
CREATE INDEX orders_customer_id_idx  ON tfi.orders (customer_id);

COMMENT ON TABLE  tfi.orders IS 'Pedidos en modelo canónico; UNIQUE(external_id,channel) = idempotencia';
COMMENT ON COLUMN tfi.orders.normalization_version IS 'Versión del adaptador de canal que produjo este registro';
COMMENT ON COLUMN tfi.orders.raw_payload IS 'JSON original del webhook, conservado para re-procesamiento';

-- ============================================================================
-- Tabla: order_items
-- ----------------------------------------------------------------------------
-- Productos asociados al pedido. CASCADE: si se borra el order, se van.
-- ============================================================================
CREATE TABLE tfi.order_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL REFERENCES tfi.orders(id) ON DELETE CASCADE,
    sku             varchar(128),
    product_name    varchar(512) NOT NULL,
    quantity        integer      NOT NULL,
    unit_price      numeric(14,2) NOT NULL,
    delivery_status varchar(32)  NOT NULL DEFAULT 'pending',
    metadata        jsonb,

    CONSTRAINT order_items_qty_chk     CHECK (quantity > 0),
    CONSTRAINT order_items_price_chk   CHECK (unit_price >= 0),
    CONSTRAINT order_items_delivery_chk CHECK (delivery_status IN (
        'pending','preparing','shipped','delivered','returned','cancelled'
    ))
);

CREATE INDEX order_items_order_id_idx ON tfi.order_items (order_id);
CREATE INDEX order_items_sku_idx      ON tfi.order_items (sku) WHERE sku IS NOT NULL;

-- ============================================================================
-- Tabla: ai_notifications
-- ----------------------------------------------------------------------------
-- Mensajes generados (LLM o plantilla fallback). Diseñada para soportar
-- los experimentos de cost tracking y comparación entre proveedores.
-- ============================================================================
CREATE TABLE tfi.ai_notifications (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            uuid NOT NULL REFERENCES tfi.orders(id) ON DELETE CASCADE,
    -- Origen del mensaje
    provider            varchar(32) NOT NULL,  -- openai, anthropic, template
    model               varchar(64),           -- gpt-4o-mini, claude-haiku, NULL si template
    prompt_version      varchar(16),           -- v1, v2, ... (NULL si template)
    -- Métricas para análisis económico y de performance (fix metodológico)
    prompt_tokens       integer,
    completion_tokens   integer,
    cost_usd            numeric(10,6),         -- 6 decimales = fracciones de centavo
    latency_ms          integer,
    -- Resultado
    message_text        text NOT NULL,
    message_status      varchar(32) NOT NULL DEFAULT 'generated',
    is_fallback         boolean NOT NULL DEFAULT false,
    delivery_channel    varchar(32),           -- whatsapp, email, sms (para futuro)
    -- Trazabilidad
    generated_at        timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz,
    error_message       text,

    CONSTRAINT ai_notif_provider_chk CHECK (provider IN ('openai','anthropic','template')),
    CONSTRAINT ai_notif_status_chk   CHECK (message_status IN (
        'generated','validated','sent','failed','rejected'
    )),
    -- Si es fallback, debe usar provider='template' y viceversa
    CONSTRAINT ai_notif_fallback_chk CHECK (
        (is_fallback = true  AND provider = 'template') OR
        (is_fallback = false AND provider <> 'template')
    )
);

CREATE INDEX ai_notif_order_id_idx       ON tfi.ai_notifications (order_id);
CREATE INDEX ai_notif_generated_at_idx   ON tfi.ai_notifications (generated_at DESC);
CREATE INDEX ai_notif_provider_model_idx ON tfi.ai_notifications (provider, model);

COMMENT ON TABLE  tfi.ai_notifications IS 'Mensajes generados; soporta análisis comparativo de proveedores';
COMMENT ON COLUMN tfi.ai_notifications.cost_usd IS 'Costo USD calculado con pricing vigente del proveedor';
COMMENT ON COLUMN tfi.ai_notifications.prompt_version IS 'Versión del prompt en /prompts del repo';

-- ============================================================================
-- Tabla: audit_log
-- ----------------------------------------------------------------------------
-- Registro técnico-operativo. Una fila por evento relevante del pipeline.
-- Permite reconstruir el ciclo de vida de cada pedido (cap 5.8 del doc).
-- ============================================================================
CREATE TABLE tfi.audit_log (
    id              bigserial PRIMARY KEY,
    -- Vínculos opcionales (NULL si el evento es previo a tener order_id)
    order_id        uuid REFERENCES tfi.orders(id) ON DELETE SET NULL,
    -- Clasificación del evento
    event_type      varchar(64) NOT NULL,
    severity        varchar(16) NOT NULL DEFAULT 'info',
    component       varchar(32) NOT NULL,  -- webhook, normalizer, llm, persister, ...
    -- Detalle
    message         text,
    payload         jsonb,
    error_code      varchar(64),
    error_message   text,
    -- Métricas opcionales del paso
    duration_ms     integer,
    retry_attempt   integer DEFAULT 0,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT audit_severity_chk CHECK (severity IN ('debug','info','warning','error','critical'))
);

CREATE INDEX audit_order_id_idx     ON tfi.audit_log (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX audit_event_type_idx   ON tfi.audit_log (event_type);
CREATE INDEX audit_created_at_idx   ON tfi.audit_log (created_at DESC);
CREATE INDEX audit_severity_idx     ON tfi.audit_log (severity) WHERE severity IN ('error','critical');

COMMENT ON TABLE tfi.audit_log IS 'Trazabilidad operativa del pipeline; insert-only, sin updates';

-- ============================================================================
-- Trigger: actualizar updated_at de customers en cada UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION tfi.tg_set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_set_updated_at
    BEFORE UPDATE ON tfi.customers
    FOR EACH ROW
    EXECUTE FUNCTION tfi.tg_set_updated_at();

-- ============================================================================
-- Vista: resumen por pedido (útil para queries de evaluación)
-- ============================================================================
CREATE VIEW tfi.v_order_summary AS
SELECT
    o.id                AS order_id,
    o.external_id,
    o.channel,
    o.status,
    o.total_amount,
    o.currency,
    o.received_at,
    o.processed_at,
    EXTRACT(EPOCH FROM (o.processed_at - o.received_at)) * 1000 AS processing_ms,
    c.pseudonym         AS customer_pseudonym,
    (SELECT count(*) FROM tfi.order_items i WHERE i.order_id = o.id)        AS items_count,
    (SELECT count(*) FROM tfi.ai_notifications n WHERE n.order_id = o.id)   AS notifications_count,
    (SELECT bool_or(is_fallback) FROM tfi.ai_notifications n WHERE n.order_id = o.id) AS used_fallback
FROM tfi.orders o
LEFT JOIN tfi.customers c ON c.id = o.customer_id;

COMMENT ON VIEW tfi.v_order_summary IS 'Resumen por pedido para queries de evaluación y métricas';

-- ============================================================================
-- Versión del schema (para futuras migraciones)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tfi.schema_version (
    version     varchar(16) PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    description text
);

INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.0.0', 'Schema inicial: 5 entidades + vista de resumen')
ON CONFLICT DO NOTHING;
