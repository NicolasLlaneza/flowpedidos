#!/usr/bin/env node
// =============================================================================
// build-corpus-balanceado.mjs · corpus ciego balanceado por estado canónico
// -----------------------------------------------------------------------------
// Reemplaza al par export-llm-panel-sample.mjs + build-panel-corpus.mjs para la
// segunda ronda del panel (§3.7). La diferencia es el diseño muestral.
//
// El corpus de la primera ronda se extrajo de forma proporcional a la
// distribución real de estados de la corrida, que concentra la mayor parte de
// las notificaciones en 'paid'. El resultado fue que origen y estado quedaron
// parcialmente confundidos: once de veinte mensajes eran 'paid', y diez de los
// catorce del brazo del modelo, contra uno de los seis del brazo de plantilla.
// Con ese reparto no es posible separar el efecto del origen del efecto del
// estado comunicado, cosa que afecta especialmente al criterio de relevancia
// contextual.
//
// Este script impone en cambio un diseño cruzado: para CADA estado canónico que
// invoca al modelo de lenguaje se toman LLM_POR_ESTADO mensajes generados y el
// único mensaje de plantilla que ese estado admite. La proporción entre brazos
// es por lo tanto idéntica en todos los estados, y origen y estado quedan
// ortogonales.
//
// Nota de diseño: la plantilla estática produce UN texto fijo por estado
// (n8n-workflows/lib/fallback-template.js), de modo que el brazo de control no
// puede tener más de un mensaje por estado sin repetir texto literal. Esa es la
// razón por la cual los brazos no son de igual tamaño: lo que se balancea es la
// presencia de cada estado en ambos brazos, no el conteo total.
//
// Uso:
//   node build-corpus-balanceado.mjs              # 2 mensajes LLM por estado -> 18
//   node build-corpus-balanceado.mjs --llm 3      # 3 mensajes LLM por estado -> 24
//
// Salidas (en este mismo directorio):
//   corpus_blind_v2.csv  -> lo que ven los evaluadores (id, mensaje)
//   corpus_key_v2.csv    -> clave privada (id, origen, status, notif_id)
//                           NO compartir con los evaluadores
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
try { process.loadEnvFile(path.join(REPO, '.env')); } catch { /* noop */ }

const SEED = 42;
const argIdx = process.argv.indexOf('--llm');
const LLM_POR_ESTADO = argIdx !== -1 ? Number(process.argv[argIdx + 1]) : 2;
if (!Number.isInteger(LLM_POR_ESTADO) || LLM_POR_ESTADO < 1) {
    console.error('--llm debe ser un entero >= 1');
    process.exit(1);
}

// Estados canónicos que efectivamente invocan al modelo de lenguaje. 'error' se
// filtra antes de la generación por diseño del prompt v2, y por eso no integra
// el corpus.
const ESTADOS = ['paid', 'shipped', 'delivered', 'pending_payment', 'cancelled', 'refunded'];

// Texto verbatim de n8n-workflows/lib/fallback-template.js (constante TEMPLATES).
const TEMPLATE_MESSAGES = {
    paid: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.',
    pending_payment: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.',
    shipped: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.',
    delivered: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.',
    cancelled: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.',
    refunded: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.',
};

const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

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
    for (let i = 0; i < n && copy.length; i++) picked.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    return picked;
}
function seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// Mismo criterio de anonimización que la primera ronda: el saludo se neutraliza
// para que el nombre del destinatario no sea una pista del origen del mensaje.
const neutralizeGreeting = m => m.replace(/¡Hola\s+[^!,.]+!/i, '¡Hola!');
const csvEsc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

async function main() {
    const rng = mulberry32(SEED);
    const items = [];
    const faltantes = [];

    for (const status of ESTADOS) {
        const { rows } = await pool.query(
            `SELECT n.id AS notif_id, n.message_text, o.status
               FROM tfi.ai_notifications n
               JOIN tfi.orders o ON o.id = n.order_id
              WHERE n.provider = 'openai'
                AND n.is_fallback = false
                AND o.external_id ~ '^[0-9]{16}$'
                AND o.status = $1
              ORDER BY n.generated_at`,
            [status]
        );
        if (rows.length < LLM_POR_ESTADO) {
            faltantes.push(`${status}: hay ${rows.length}, se piden ${LLM_POR_ESTADO}`);
            continue;
        }
        for (const r of seededPick(rows, LLM_POR_ESTADO, rng)) {
            items.push({ origen: 'llm', status, notif_id: r.notif_id, message_text: neutralizeGreeting(r.message_text) });
        }
        items.push({ origen: 'template', status, notif_id: '', message_text: TEMPLATE_MESSAGES[status] });
    }

    if (faltantes.length) {
        console.error('FAIL: no hay suficientes mensajes reales para un diseño balanceado.');
        for (const f of faltantes) console.error('  -', f);
        console.error('Bajá --llm o ampliá la corrida antes de construir el corpus.');
        process.exit(1);
    }

    const mezclado = seededShuffle(items, rng);
    const blind = ['id,mensaje'];
    const key = ['id,origen,status,notif_id'];
    mezclado.forEach((it, i) => {
        const id = `M${String(i + 1).padStart(2, '0')}`;
        blind.push(`${id},${csvEsc(it.message_text)}`);
        key.push(`${id},${it.origen},${it.status},${it.notif_id}`);
    });

    fs.writeFileSync(path.join(__dirname, 'corpus_blind_v2.csv'), blind.join('\n') + '\n', 'utf8');
    fs.writeFileSync(path.join(__dirname, 'corpus_key_v2.csv'), key.join('\n') + '\n', 'utf8');

    const nLlm = mezclado.filter(i => i.origen === 'llm').length;
    console.error(`Corpus balanceado: ${mezclado.length} mensajes (${nLlm} del modelo, ${mezclado.length - nLlm} de plantilla).`);
    console.error(`Por estado: ${LLM_POR_ESTADO} del modelo + 1 de plantilla, en los ${ESTADOS.length} estados que invocan al modelo.`);
    console.error('Escritos corpus_blind_v2.csv y corpus_key_v2.csv.');
}

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
