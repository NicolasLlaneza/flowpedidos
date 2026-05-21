#!/usr/bin/env node
// =============================================================================
// reset.mjs — Prepara el entorno para grabar el demo
// -----------------------------------------------------------------------------
// 1. Copia los fixtures del dataset (seed-42) a mocks/data/orders/ para que
//    el mock-marketplace pueda servirlos.
// 2. Limpia las tablas del schema tfi para que el demo arranque de cero
//    (necesario para que la demostración de idempotencia se vea bien en cada toma).
//
// Uso:
//   node reset.mjs            # copia fixtures + limpia tablas
//   node reset.mjs --no-clean # solo copia fixtures, no toca la base
// =============================================================================

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

try {
    process.loadEnvFile(path.join(ROOT, '.env'));
} catch (e) {
    console.error('No pude cargar .env:', e.message);
    process.exit(1);
}

const noClean = process.argv.includes('--no-clean');

// --- 1. Copiar fixtures del dataset al mock ----------------------------------
const datasetOrders = path.join(ROOT, 'dataset', 'seed-42', 'orders');
const mockOrders = path.join(ROOT, 'mocks', 'data', 'orders');

if (!fs.existsSync(datasetOrders)) {
    console.error(`No existe el dataset en ${datasetOrders}. Corré primero: node dataset/generate.mjs`);
    process.exit(1);
}

fs.mkdirSync(mockOrders, { recursive: true });
const files = fs.readdirSync(datasetOrders).filter((f) => f.endsWith('.json'));
for (const f of files) {
    fs.copyFileSync(path.join(datasetOrders, f), path.join(mockOrders, f));
}
console.log(`✓ ${files.length} fixtures copiados a mocks/data/orders/`);

// --- 2. Limpiar tablas (orden respetando FKs) --------------------------------
if (noClean) {
    console.log('→ --no-clean: no se tocó la base de datos');
    process.exit(0);
}

const client = new pg.Client({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    // Usamos el superuser para TRUNCATE (tfi_app no tiene ese privilegio — correcto)
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

try {
    await client.connect();
    await client.query('TRUNCATE tfi.audit_log, tfi.ai_notifications, tfi.order_items, tfi.orders, tfi.customers RESTART IDENTITY CASCADE');
    console.log('✓ Tablas del schema tfi limpiadas (datos de demo previos eliminados)');
    await client.end();
} catch (e) {
    console.error('Error limpiando la base:', e.message);
    console.error('¿Está corriendo el stack? docker compose up -d');
    process.exit(1);
}

console.log('\n✓ Entorno listo para grabar. Ahora: node run-demo.mjs');
