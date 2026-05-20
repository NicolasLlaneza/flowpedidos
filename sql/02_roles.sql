-- ============================================================================
-- TFI — Roles y permisos
-- ============================================================================
--
-- Crea el usuario `tfi_app` que va a usar n8n para escribir/leer las tablas
-- del modelo canónico, con principio de mínimo privilegio:
--
--   - SOLO accede al schema `tfi` (no `public`, donde vive n8n)
--   - CRUD sobre tablas existentes
--   - USAGE sobre secuencias (necesario para audit_log.bigserial)
--   - NO puede crear/borrar tablas, alterar schema ni truncar
--   - Default privileges: aplica los mismos permisos a tablas que agreguemos
--     en futuras migraciones, sin tener que re-grantear manualmente
--
-- Esto se alinea con el cap 5.7 del documento (control de roles).
-- ============================================================================

-- El password se inyecta desde la variable POSTGRES_TFI_APP_PASSWORD del .env
-- Si ejecutás manualmente este script, reemplazá el placeholder antes de correrlo.

-- Crear el rol (idempotente: si ya existe, solo actualiza el password)
DO $$
DECLARE
    v_password text := current_setting('tfi.app_password', true);
BEGIN
    IF v_password IS NULL OR v_password = '' THEN
        RAISE EXCEPTION 'Falta tfi.app_password. Usar: SET tfi.app_password = ''xxx''; antes de correr este script.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tfi_app') THEN
        EXECUTE format('CREATE ROLE tfi_app LOGIN PASSWORD %L', v_password);
    ELSE
        EXECUTE format('ALTER ROLE tfi_app WITH PASSWORD %L', v_password);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Permisos sobre el schema tfi
-- ----------------------------------------------------------------------------

-- Acceso al schema (sin esto, no puede ni listar las tablas)
GRANT USAGE ON SCHEMA tfi TO tfi_app;

-- CRUD sobre tablas existentes (no DROP, no TRUNCATE, no DDL)
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA tfi
    TO tfi_app;

-- USAGE sobre secuencias (necesario para columnas bigserial como audit_log.id)
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA tfi
    TO tfi_app;

-- Ejecutar funciones del schema (por si agregamos helpers en el futuro)
GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA tfi
    TO tfi_app;

-- ----------------------------------------------------------------------------
-- Default privileges: aplican a objetos creados DESPUÉS de este GRANT
-- Así no hay que re-grantear cada vez que agregamos una tabla nueva.
-- ----------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA tfi
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tfi_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA tfi
    GRANT USAGE, SELECT ON SEQUENCES TO tfi_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA tfi
    GRANT EXECUTE ON FUNCTIONS TO tfi_app;

-- ----------------------------------------------------------------------------
-- Revocaciones explícitas — defensa en profundidad
-- ----------------------------------------------------------------------------

-- Quitamos explícitamente cualquier acceso al schema public (n8n interno)
REVOKE ALL ON SCHEMA public FROM tfi_app;

-- Por defecto PUBLIC tiene CONNECT en la DB. Lo dejamos, n8n lo necesita
-- conectándose con su propio usuario. tfi_app también necesita CONNECT
-- para abrir conexiones a la base.
GRANT CONNECT ON DATABASE tfi TO tfi_app;

-- ----------------------------------------------------------------------------
-- Registro en schema_version
-- ----------------------------------------------------------------------------
INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.1.0', 'Usuario tfi_app con permisos restringidos al schema tfi')
ON CONFLICT DO NOTHING;
