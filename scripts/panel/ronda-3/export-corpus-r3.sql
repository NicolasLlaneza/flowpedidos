-- =============================================================================
-- export-corpus-r3.sql · insumo del corpus de la tercera ronda del panel
-- -----------------------------------------------------------------------------
-- Exporta los mensajes que el modelo generó en la corrida reportada (Cap. 5).
-- La salida contiene los saludos con el nombre real de los destinatarios:
-- NO se versiona (ver .gitignore). El corpus que se publica es el que produce
-- build-corpus-r3.mjs, con el saludo retirado.
--
-- Uso (cmd, desde la raíz del repo, con Docker levantado):
--   docker compose exec -T postgres psql -U n8n -d tfi -q --csv < scripts\panel\ronda-3\export-corpus-r3.sql > scripts\panel\ronda-3\mensajes-corrida.csv
-- =============================================================================
SET search_path TO tfi, public;

SELECT n.id        AS notif_id,
       o.status    AS order_status,
       o.channel,
       replace(replace(n.message_text, E'\n', ' '), E'\r', ' ') AS message_text
FROM tfi.ai_notifications n
JOIN tfi.orders o ON o.id = n.order_id
WHERE n.provider = 'openai'
  AND n.is_fallback = false
ORDER BY n.id;
