-- export-wc16-na06.sql
-- (1) Producto del pedido WC-16 (external_id 70): origen probable del '70' que
--     disparo la regla sin_identificadores_internos.
-- (2) Que registra audit_log sobre los despachos: si guarda el cuerpo enviado
--     a Meta, acredita (o no) el saludo duplicado de NA-06.
SET search_path TO tfi, public;

\echo '=== 1. Pedido WC-16 ==='
SELECT o.external_id, o.channel, o.status, i.product_name, i.quantity, o.total_amount
FROM tfi.orders o JOIN tfi.order_items i ON i.order_id = o.id
WHERE o.channel = 'woocommerce' AND o.external_id = '70';

\echo '=== 2. Tipos de evento de despacho en audit_log ==='
SELECT event_type, component, count(*)
FROM tfi.audit_log
WHERE event_type ILIKE '%dispatch%' OR component ILIKE '%whats%' OR component ILIKE '%dispatch%'
GROUP BY 1,2 ORDER BY 1;

\echo '=== 3. Claves del payload de esos eventos ==='
SELECT DISTINCT event_type, jsonb_object_keys(payload) AS clave
FROM tfi.audit_log
WHERE (event_type ILIKE '%dispatch%' OR component ILIKE '%dispatch%')
  AND jsonb_typeof(payload) = 'object'
ORDER BY 1,2;

\echo '=== 4. Tres ejemplos de payload de despacho del canal WC, saludo neutralizado ==='
SELECT o.external_id,
       regexp_replace(a.payload::text, '¡Hola[^!]*!', '¡Hola!', 'g') AS payload
FROM tfi.audit_log a JOIN tfi.orders o ON o.id = a.order_id
WHERE (a.event_type ILIKE '%dispatch%' OR a.component ILIKE '%dispatch%')
  AND o.channel = 'woocommerce'
ORDER BY a.created_at
LIMIT 3;
