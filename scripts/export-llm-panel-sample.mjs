#!/usr/bin/env node
// =============================================================================
// export-llm-panel-sample.mjs · muestra estratificada de mensajes reales del LLM
// -----------------------------------------------------------------------------
// Extrae de tfi.ai_notifications una muestra de 14 mensajes generados por el
// modelo de lenguaje (provider='openai', is_fallback=false) en la corrida
// definitiva ampliada (n=147 persistidos, 141 con mensaje generado),
// estratificada por estado canónico en proporción a la distribución REAL
// observada en esa corrida (no una cuota fija), y neutraliza el saludo
// personalizado (nombre real del cliente) por un saludo genérico, para que
// el corpus del panel de evaluación no exponga identidad de clientes ni
// permita distinguir mensajes por la presencia de un nombre propio.
//
// El filtro o.external_id ~ '^[0-9]{16}$' restringe la muestra a los pedidos
// del dataset sintético (seed=42, external_id de 16 dígitos), que es la
// corrida definitiva ampliada — excluyendo la corrida complementaria de
// despacho real (n=10) y las pruebas manuales de evidencia visual, que
// insertan pedidos con external_id de otro formato y no forman parte del
// diseño muestral declarado en la sección 3.5/3.7.
//
// A diferencia de una versión anterior de este script, la cuota por estado
// ya no está hardcodeada: se calcula en tiempo de ejecución a partir del
// conteo real por estado en tfi.ai_notifications, mediante asignación
// proporcional con método del resto mayor (Hamilton), de modo que el
// script siga siendo válido si la corrida cambia de tamaño o de
// distribución de estados.
//
// Uso:
//   node export-llm-panel-sample.mjs > llm_messages_raw.csv
//
// Requiere las mismas variables de entorno que scripts/run-corrida.mjs
// (.env en la raíz del repo: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD,
// PG_HOST_PORT).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(REPO, '.env')); } catch { /* si se corre desde otro lado */ }

const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

// Tamaño total de la muestra de mensajes reales del LLM para el panel.
// (14 reales + 6 de plantilla estática = corpus de 20, según §3.5/§3.7.)
const SAMPLE_SIZE = 14;

// PRNG determinístico (mulberry32) — misma convención de reproducibilidad
// (seed=42) que dataset/generate.mjs y scripts/run-corrida.mjs.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seededPick(arr, n, rng) {
    const copy = [...arr];
    const picked = [];
    for (let i = 0; i < n && copy.length; i++) {
        const idx = Math.floor(rng() * copy.length);
        picked.push(copy.splice(idx, 1)[0]);
    }
    return picked;
}

// Asignación proporcional por método del resto mayor (Hamilton): reparte
// SAMPLE_SIZE entre los estados en proporción a sus conteos reales, sin que
// la suma de cuotas redondeadas se pase o quede corta del total pedido.
function apportion(counts, total) {
    const states = Object.keys(counts);
    const grandTotal = states.reduce((s, k) => s + counts[k], 0);
    if (grandTotal === 0) return {};
    const exact = {};
    const floor = {};
    let assigned = 0;
    for (const k of states) {
        exact[k] = (counts[k] / grandTotal) * total;
        floor[k] = Math.floor(exact[k]);
        assigned += floor[k];
    }
    let remaining = total - assigned;
    const byRemainder = [...states].sort((a, b) => (exact[b] - floor[b]) - (exact[a] - floor[a]));
    for (let i = 0; i < remaining; i++) {
        floor[byRemainder[i % byRemainder.length]] += 1;
    }
    // nunca pedir más de lo disponible en un estado
    for (const k of states) {
        floor[k] = Math.min(floor[k], counts[k]);
    }
    return floor;
}

// Neutraliza "¡Hola Nombre!" -> "¡Hola!" sin tocar el resto del mensaje.
function neutralizeGreeting(msg) {
    return msg.replace(/¡Hola\s+[^!,.]+!/i, '¡Hola!');
}

function csvEsc(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
    const rng = mulberry32(42);

    // 1) Conteo real por estado de los mensajes reales del LLM disponibles.
    const countRes = await pool.query(
        `SELECT o.status, COUNT(*)::int AS n
           FROM tfi.ai_notifications n
           JOIN tfi.orders o ON o.id = n.order_id
          WHERE n.provider = 'openai'
            AND n.is_fallback = false
            AND o.external_id ~ '^[0-9]{16}$'
          GROUP BY o.status`
    );
    const counts = {};
    for (const row of countRes.rows) counts[row.status] = row.n;

    const totalAvailable = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalAvailable === 0) {
        console.error('FAIL: no se encontraron mensajes reales del LLM en tfi.ai_notifications. ¿Corriste la corrida definitiva?');
        process.exit(1);
    }

    const quota = apportion(counts, Math.min(SAMPLE_SIZE, totalAvailable));
    console.error('Distribución real por estado:', counts);
    console.error('Cuota proporcional calculada:', quota);

    // 2) Muestreo estratificado según esa cuota.
    const rows = [];
    for (const [status, q] of Object.entries(quota)) {
        if (q === 0) continue;
        const r = await pool.query(
            `SELECT n.id AS notif_id, n.message_text, o.status, o.channel
               FROM tfi.ai_notifications n
               JOIN tfi.orders o ON o.id = n.order_id
              WHERE n.provider = 'openai'
                AND n.is_fallback = false
                AND o.external_id ~ '^[0-9]{16}$'
                AND o.status = $1
              ORDER BY n.generated_at`,
            [status]
        );
        const picked = seededPick(r.rows, q, rng);
        for (const row of picked) {
            rows.push({
                notif_id: row.notif_id,
                status: row.status,
                channel: row.channel,
                message_text: neutralizeGreeting(row.message_text),
            });
        }
    }

    const target = Math.min(SAMPLE_SIZE, totalAvailable);
    if (rows.length !== target) {
        console.error(`AVISO: se obtuvieron ${rows.length} mensajes en vez de ${target} — revisar cuotas/datos disponibles.`);
    }

    const header = 'notif_id,status,channel,message_text';
    const lines = [header, ...rows.map(r =>
        [r.notif_id, r.status, r.channel, csvEsc(r.message_text)].join(','))];
    console.log(lines.join('\n'));

    await pool.end();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
