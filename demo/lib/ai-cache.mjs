// =============================================================================
// ai-cache.mjs — Cache de mensajes generados por IA
// -----------------------------------------------------------------------------
// Para no quemar crédito de OpenAI en cada corrida del demo, los mensajes se
// generan UNA vez y se guardan en disco. Las corridas siguientes los reproducen.
// Sigue siendo real: el mensaje lo generó la IA, solo que no se vuelve a pedir.
//
// Clave del cache: `${channel}:${external_id}` (mismo namespace que idempotencia)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', 'web', 'ai-cache.json');

let cache = null;

function load() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
        cache = {};
    }
    return cache;
}

export function getCached(channel, externalId) {
    const c = load();
    return c[`${channel}:${externalId}`] || null;
}

export function setCached(channel, externalId, message) {
    const c = load();
    c[`${channel}:${externalId}`] = message;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

export function hasCache() {
    return Object.keys(load()).length > 0;
}
