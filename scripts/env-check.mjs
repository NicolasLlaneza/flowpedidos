#!/usr/bin/env node
// =============================================================================
// env-check.mjs · valida que .env tenga las variables que C necesita
// -----------------------------------------------------------------------------
// Imprime, por cada variable, su presencia (OK / MISSING) y de dónde sale.
// No revela valores.
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const VARS = [
    // Bloques anteriores
    { name: 'POSTGRES_USER',        need: 'always',  hint: 'ya configurado' },
    { name: 'POSTGRES_PASSWORD',    need: 'always',  hint: 'ya configurado' },
    { name: 'TFI_APP_USER',         need: 'always',  hint: 'ya configurado' },
    { name: 'TFI_APP_PASSWORD',     need: 'always',  hint: 'ya configurado' },
    { name: 'OPENAI_API_KEY',       need: 'always',  hint: 'B2/B3/B4 · https://platform.openai.com/api-keys' },
    { name: 'WHATSAPP_PHONE_NUMBER_ID', need: 'always', hint: 'Meta Business Manager' },
    { name: 'WHATSAPP_ACCESS_TOKEN', need: 'always', hint: 'Meta Business Manager (rotar cuando expire)' },

    // Bloque C — WooCommerce
    { name: 'WP_HOST_PORT',         need: 'wc', default: '8080', hint: 'puerto del container tfi-wordpress' },
    { name: 'WC_CONSUMER_KEY',      need: 'wc',  hint: 'WC → Ajustes → Avanzado → REST API → Añadir clave' },
    { name: 'WC_CONSUMER_SECRET',   need: 'wc',  hint: 'ídem — copia una única vez' },
    { name: 'WC_WEBHOOK_SECRET',    need: 'wc',  hint: 'ya configurado en sesión de junio' },

    // Bloque C — Mercado Libre
    { name: 'ML_APP_CLIENT_ID',     need: 'ml',  hint: 'developers.mercadolibre.com.ar → Tus aplicaciones' },
    { name: 'ML_APP_CLIENT_SECRET', need: 'ml',  hint: 'ídem' },
    { name: 'ML_ACCESS_TOKEN',      need: 'ml-post-oauth', hint: 'lo genera ml-setup.mjs' },
    { name: 'ML_REFRESH_TOKEN',     need: 'ml-post-oauth', hint: 'lo genera ml-setup.mjs' },
    { name: 'NGROK_AUTHTOKEN',      need: 'ml',  hint: 'dashboard.ngrok.com → Auth' },
    { name: 'NGROK_STATIC_DOMAIN',  need: 'ml-opt', hint: 'opcional · dashboard.ngrok.com → Domains' },
];

const LABELS = {
    always: 'requerido',
    wc: 'C-WC',
    ml: 'C-ML',
    'ml-post-oauth': 'C-ML (post OAuth)',
    'ml-opt': 'C-ML (opcional)',
};

let missing = 0;
console.log(`${'variable'.padEnd(28)} ${'estado'.padEnd(10)} ${'bloque'.padEnd(20)} pista`);
console.log('-'.repeat(100));
for (const v of VARS) {
    const val = process.env[v.name];
    const ok = val && val.trim() !== '';
    const status = ok ? 'OK' : 'MISSING';
    const block = LABELS[v.need];
    console.log(`${v.name.padEnd(28)} ${status.padEnd(10)} ${block.padEnd(20)} ${v.hint}`);
    if (!ok && v.need !== 'ml-opt' && v.need !== 'ml-post-oauth') missing++;
}
console.log('-'.repeat(100));
console.log(missing === 0
    ? '\nlisto · scripts/wc-setup.mjs y scripts/ml-setup.mjs pueden correr'
    : `\nfaltan ${missing} variables requeridas — completar en .env antes de correr los setup`);
