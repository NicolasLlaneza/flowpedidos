#!/usr/bin/env node
// =============================================================================
// build-corpus-r3.mjs · corpus ciego de la TERCERA ronda del panel (H3)
// -----------------------------------------------------------------------------
// Responde a NC-02 de la devolución del tribunal (v23): en la ronda 2 los
// mensajes del modelo conservaban el saludo con el nombre del destinatario y los
// de plantilla no llevaban saludo, de modo que el origen era reconocible y la
// personalización nominal —que aporta un paso determinístico del pipeline, no el
// modelo— quedaba confundida con el origen.
//
// Cambios respecto de la ronda 2:
//   1. El saludo se RETIRA en ambos brazos. Los mensajes del modelo empiezan en
//      el cuerpo ("Te confirmamos que..."); las plantillas nunca tuvieron saludo.
//      Lo que el panel compara es solo el cuerpo del mensaje.
//   2. Diseño cruzado 2 + 1 por estado, el previsto en el protocolo original:
//      dos mensajes del modelo y la plantilla de cada uno de los seis estados
//      despachables que la corrida ejercitó. 18 mensajes (12 contra 6).
//   3. Identificadores R01..R18, para no confundirlos con los M01..M14 de la
//      ronda 2.
//
// Entrada: el CSV que produce export-corpus-r3.sql (columnas notif_id,
// order_status, message_text). No necesita dependencias ni conexión a la base.
//
// Uso:
//   node build-corpus-r3.mjs mensajes-corrida.csv
//
// Salidas (en este directorio):
//   corpus_blind_r3.csv   lo que ven los evaluadores (id, mensaje) — se publica
//   corpus_key_r3.csv     clave (id, origen, status, notif_id)     — se publica
//                         recién DESPUÉS del cierre de la recolección
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = 2026;
const LLM_POR_ESTADO = 2;
const ESTADOS = ['paid', 'pending_payment', 'shipped', 'delivered', 'cancelled', 'refunded'];

// Texto verbatim de n8n-workflows/lib/fallback-template.js (constante TEMPLATES).
const TEMPLATES = {
    paid: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.',
    pending_payment: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.',
    shipped: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.',
    delivered: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.',
    cancelled: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.',
    refunded: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.',
};

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (arr, n, rng) => { const c = [...arr], out = []; for (let i = 0; i < n && c.length; i++) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]); return out; };
const shuffle = (arr, rng) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const [h, ...rest] = rows.filter(r => r.length > 1);
    return rest.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

// Retira el saludo inicial ("¡Hola Nombre Apellido!, ", "¡Hola!, ", "Hola Nombre, ")
// y pone en mayúscula la primera letra del cuerpo.
function sinSaludo(m) {
    const s = m.replace(/^\s*¡?\s*hola\b[^!.,]*[!.,]?\s*[,.]?\s*/i, '');
    return s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
}
const csvEsc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

const entrada = process.argv[2];
if (!entrada) { console.error('uso: node build-corpus-r3.mjs <mensajes-corrida.csv>'); process.exit(1); }
const filas = parseCsv(fs.readFileSync(entrada, 'utf8'))
    .filter(r => r.message_text && r.notif_id)
    .sort((a, b) => a.notif_id.localeCompare(b.notif_id));   // orden estable, independiente del export

const rng = mulberry32(SEED);
const items = [];
for (const st of ESTADOS) {
    const cand = filas.filter(r => r.order_status === st);
    if (cand.length < LLM_POR_ESTADO) { console.error(`FAIL: ${st} tiene ${cand.length} mensajes`); process.exit(1); }
    for (const r of pick(cand, LLM_POR_ESTADO, rng)) items.push({ origen: 'llm', status: st, notif_id: r.notif_id, texto: sinSaludo(r.message_text) });
    items.push({ origen: 'template', status: st, notif_id: '', texto: TEMPLATES[st] });
}

// Control: ningún mensaje puede conservar un saludo ni un nombre propio en posición de saludo.
const conSaludo = items.filter(i => /hola/i.test(i.texto));
if (conSaludo.length) { console.error('FAIL: quedó un saludo en', conSaludo.map(i => i.texto.slice(0, 40))); process.exit(1); }

const blind = ['id,mensaje'], key = ['id,origen,status,notif_id'];
shuffle(items, rng).forEach((it, i) => {
    const id = `R${String(i + 1).padStart(2, '0')}`;
    blind.push(`${id},${csvEsc(it.texto)}`);
    key.push(`${id},${it.origen},${it.status},${it.notif_id}`);
});
fs.writeFileSync(path.join(__dirname, 'corpus_blind_r3.csv'), blind.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, 'corpus_key_r3.csv'), key.join('\n') + '\n', 'utf8');
console.error(`Corpus R3: ${items.length} mensajes (12 del modelo, 6 de plantilla), saludo retirado en ambos brazos.`);
