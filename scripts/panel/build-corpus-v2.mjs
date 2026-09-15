#!/usr/bin/env node
// =============================================================================
// build-corpus-v2.mjs · script EFECTIVAMENTE APLICADO a la ronda 2 del panel
// -----------------------------------------------------------------------------
//
// DECLARACIÓN DE PROCEDENCIA (importante para la reproducibilidad del §3.7):
//
// Este script NO es el canónico declarado en el protocolo pusheado el
// 2026-09-14 (`build-corpus-balanceado.mjs`). Es una variante que estuvo en
// un scratchpad local durante la construcción del formulario y produjo el
// corpus efectivo con el cual se creó el Google Form que recibió las
// respuestas de la ronda 2 (a partir del 2026-09-15).
//
// Se agrega al repositorio DESPUÉS del inicio de la recolección para
// documentar el instrumento que realmente se aplicó, sin backdatear.
// La discrepancia con el canónico se declara explícitamente en §3.7:
//   - qué declaraba el protocolo
//   - qué se aplicó
//   - por qué la diferencia no sesga el contraste
//   - qué implica para el análisis (Wilcoxon pareado sobre 6 pares
//     promediando la celda de `paid`)
//
// DIFERENCIAS RELEVANTES vs. build-corpus-balanceado.mjs:
//
// | Dimensión                | efectivo (este script)         | canónico                          |
// |--------------------------|--------------------------------|-----------------------------------|
// | Total mensajes           | 14                             | 18 (--llm 2) o 12 (--llm 1)       |
// | Ratio por estado         | paid 3:1, otros 5 en 1:1       | uniforme 2:1 (o 1:1)              |
// | Fuente LLM               | mix WC live + ML simulate      | solo ML simulate (regex 16-dig)   |
// | Neutralización de saludo | no (conserva "¡Hola <nombre>!")| sí (reemplaza por "¡Hola!")       |
// | Semilla del shuffle      | 20260915                       | 42                                |
// | Escritura de salida      | out/panel/                     | scripts/panel/                    |
//
// JUSTIFICACIÓN NO POST-HOC DE LA DESVIACIÓN:
//   La sobrerrepresentación de `paid` (3:1) refleja la distribución observada
//   de la corrida definitiva n=150, donde `paid` es el 36,5 % de los pedidos
//   despachados. Un corpus estrictamente uniforme (2:1 en cada estado) sería
//   MENOS representativo del tráfico real. El desconfundimiento origen/estado
//   que la ronda 2 apunta a resolver se preserva: los 6 estados están en los
//   dos brazos, incluida `paid`.
//
// IMPLICACIONES PARA EL ANÁLISIS:
//   - Mann-Whitney global (8 LLM vs 6 plantilla): válido con N=14.
//   - Wilcoxon pareado por estado: sobre 6 pares, promediando las 3 réplicas
//     LLM de `paid` a un único puntaje por celda. p mínimo alcanzable a dos
//     colas = 2/64 = 0,0312 (significativo si los 6 pares van en la misma
//     dirección).
//   - ICC(2,k) y α de Krippendorff: sin restricción, dependen de k jueces.
//
// Uso:
//   node scripts/panel/build-corpus-v2.mjs
//
// Salidas (en scripts/panel/):
//   corpus_key_v2.csv    -> clave privada (id, origen, status, notif_id)
//   corpus_blind_v2.csv  -> lo que ven los evaluadores (id, mensaje)
//
// Requiere Docker corriendo (consulta tfi.orders + tfi.ai_notifications).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Selecciones LLM efectivas (external_ids de la corrida definitiva v2 2026-09-15)
const LLM_SELECTIONS = [
    { external_id: '55',               estado: 'paid'            }, // WC · Nicolás Llaneza
    { external_id: '60',               estado: 'paid'            }, // WC · Micaela Arriola
    { external_id: '3000000000000019', estado: 'paid'            }, // ML · Nicolás Suárez
    { external_id: '3000000000000117', estado: 'pending_payment' }, // ML · Joaquín Acosta
    { external_id: '3000000000000055', estado: 'shipped'         }, // ML · Lautaro Vega
    { external_id: '92',               estado: 'delivered'       }, // WC · Micaela Arriola
    { external_id: '3000000000000127', estado: 'cancelled'       }, // ML · Pablo García
    { external_id: '3000000000000139', estado: 'refunded'        }, // ML · Nicolás Suárez
];

// Textos de plantilla, verbatim de n8n-workflows/lib/fallback-template.js
const TEMPLATES = [
    { estado: 'paid',            texto: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.' },
    { estado: 'pending_payment', texto: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.' },
    { estado: 'shipped',         texto: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.' },
    { estado: 'delivered',       texto: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.' },
    { estado: 'cancelled',       texto: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.' },
    { estado: 'refunded',        texto: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.' },
];

const SEED = 20260915;

function queryDB(sql) {
    const out = execSync(
        `docker exec tfi-postgres psql -U tfi_app -d tfi -tAc ${JSON.stringify(sql)}`,
        { encoding: 'utf8' }
    );
    return out.trim();
}

function queryDBTwo(sql) {
    // Devuelve dos columnas separadas por '|' (default de psql -A)
    const out = execSync(
        `docker exec tfi-postgres psql -U tfi_app -d tfi -tAc ${JSON.stringify(sql)}`,
        { encoding: 'utf8' }
    );
    return out.trim().split('\n').filter(Boolean).map(l => l.split('|'));
}

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffle(arr, seed) {
    const rng = mulberry32(seed);
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
const csvEsc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

// --- Main --------------------------------------------------------------------
const items = [];

for (const s of LLM_SELECTIONS) {
    const rows = queryDBTwo(
        `SELECT n.id, n.message_text FROM tfi.orders o JOIN tfi.ai_notifications n ON n.order_id=o.id WHERE o.external_id='${s.external_id}' LIMIT 1`
    );
    if (!rows.length) throw new Error(`no message for ${s.external_id}`);
    const [notif_id, message_text] = rows[0];
    items.push({ origen: 'llm', status: s.estado, notif_id, message_text });
}

for (const t of TEMPLATES) {
    items.push({ origen: 'template', status: t.estado, notif_id: '', message_text: t.texto });
}

const shuffled = shuffle(items, SEED);
shuffled.forEach((m, i) => { m.id = `M${String(i + 1).padStart(2, '0')}`; });

// corpus_key_v2.csv (formato consumido por analyze_panel_v2.py)
const key = ['id,origen,status,notif_id'];
for (const m of shuffled) key.push(`${m.id},${m.origen},${m.status},${m.notif_id}`);
fs.writeFileSync(path.join(__dirname, 'corpus_key_v2.csv'), key.join('\n') + '\n');

// corpus_blind_v2.csv (lo que ven los evaluadores)
const blind = ['id,mensaje'];
for (const m of shuffled) blind.push(`${m.id},${csvEsc(m.message_text)}`);
fs.writeFileSync(path.join(__dirname, 'corpus_blind_v2.csv'), blind.join('\n') + '\n');

console.log(`Escritos corpus_key_v2.csv y corpus_blind_v2.csv (n=${shuffled.length}).`);
