#!/usr/bin/env node
// =============================================================================
// build-panel-corpus.mjs · arma el corpus ciego de 20 mensajes del panel (§3.7)
// -----------------------------------------------------------------------------
// Combina los 14 mensajes reales del LLM (export-llm-panel-sample.mjs) con
// los 6 mensajes de plantilla estática (texto real de
// n8n-workflows/lib/fallback-template.js, uno por cada estado que
// efectivamente genera mensaje), los aleatoriza con semilla fija y produce:
//
//   panel/corpus_blind.csv   -> lo que ven los evaluadores (id, mensaje)
//   panel/corpus_key.csv     -> clave privada (id, origen, status, notif_id)
//                                NO compartir con los evaluadores
//   panel/scoring_evaluador_{1,2,3}.csv -> planilla de puntuación pre-cargada
//
// Uso:
//   node export-llm-panel-sample.mjs > llm_messages_raw.csv
//   node build-panel-corpus.mjs llm_messages_raw.csv
// =============================================================================

import fs from 'node:fs';

const inFile = process.argv[2];
if (!inFile) {
    console.error('uso: node build-panel-corpus.mjs llm_messages_raw.csv');
    process.exit(1);
}

// Texto verbatim de n8n-workflows/lib/fallback-template.js (TEMPLATES),
// uno por cada estado presente en el dataset que genera mensaje.
const TEMPLATE_MESSAGES = [
    { status: 'paid', message_text: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.' },
    { status: 'pending_payment', message_text: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.' },
    { status: 'shipped', message_text: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.' },
    { status: 'delivered', message_text: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.' },
    { status: 'cancelled', message_text: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.' },
    { status: 'refunded', message_text: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.' },
];

function parseCsvLine(line) {
    // parser CSV simple, suficiente para el formato que emite export-llm-panel-sample.mjs
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { out.push(cur); cur = ''; }
            else cur += c;
        }
    }
    out.push(cur);
    return out;
}

function csvEsc(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const raw = fs.readFileSync(inFile, 'utf8').trim().split(/\r?\n/).filter(l => l.length > 0);
const [header, ...dataLines] = raw;
const cols = header.split(',').map(c => c.trim());
const llmRows = dataLines.map(l => {
    const vals = parseCsvLine(l).map(v => v.trim());
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    return { status: row.status, notif_id: row.notif_id, message_text: row.message_text, origen: 'llm' };
});

if (llmRows.length !== 14) {
    console.error(`AVISO: llm_messages_raw.csv tiene ${llmRows.length} filas, se esperaban 14. Revisar antes de continuar.`);
}

const templateRows = TEMPLATE_MESSAGES.map(t => ({
    status: t.status, notif_id: null, message_text: t.message_text, origen: 'template',
}));

const all = [...llmRows, ...templateRows];
if (all.length !== 20) {
    console.error(`AVISO: el corpus total tiene ${all.length} mensajes, se esperaban 20.`);
}

const rng = mulberry32(42);
const shuffled = seededShuffle(all, rng);

const withIds = shuffled.map((row, i) => ({
    id: `M${String(i + 1).padStart(2, '0')}`,
    ...row,
}));

fs.mkdirSync('panel', { recursive: true });

// Corpus ciego (para evaluadores)
const blindLines = ['id,mensaje', ...withIds.map(r => `${r.id},${csvEsc(r.message_text)}`)];
fs.writeFileSync('panel/corpus_blind.csv', blindLines.join('\n') + '\n');

// Clave privada (NO compartir con evaluadores)
const keyLines = ['id,origen,status,notif_id',
    ...withIds.map(r => `${r.id},${r.origen},${r.status},${r.notif_id ?? ''}`)];
fs.writeFileSync('panel/corpus_key.csv', keyLines.join('\n') + '\n');

// Planillas de puntuación pre-cargadas, una por evaluador
const scoringHeader = 'id,mensaje,claridad_1a5,tono_1a5,relevancia_1a5,correccion_1a5';
for (const ev of [1, 2, 3]) {
    const lines = [scoringHeader, ...withIds.map(r => `${r.id},${csvEsc(r.message_text)},,,,`)];
    fs.writeFileSync(`panel/scoring_evaluador_${ev}.csv`, lines.join('\n') + '\n');
}

console.log(`OK: ${withIds.length} mensajes (${llmRows.length} LLM + ${templateRows.length} plantilla).`);
console.log('Escritos: panel/corpus_blind.csv, panel/corpus_key.csv, panel/scoring_evaluador_{1,2,3}.csv');
console.log('IMPORTANTE: panel/corpus_key.csv no debe compartirse con los evaluadores.');
