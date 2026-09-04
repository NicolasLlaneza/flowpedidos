#!/usr/bin/env node
// =============================================================================
// run-corrida.mjs · corrida definitiva del TFI sobre el dataset seed-42
// -----------------------------------------------------------------------------
// Dispara los 150 pedidos (75 ML + 75 WC) del dataset contra los webhooks del
// pipeline, mide latencia end-to-end y emite un CSV listo para el Cap. 5.
//
// Uso:
//   node scripts/run-corrida.mjs                   # 150 pedidos, delay 400ms, wait 60s
//   node scripts/run-corrida.mjs --n 20            # sólo los primeros 20
//   node scripts/run-corrida.mjs --delay 800       # 800ms entre pedidos
//   node scripts/run-corrida.mjs --wait 120        # 120s de espera antes de cerrar
//   node scripts/run-corrida.mjs --reset           # TRUNCATE tfi.* antes de arrancar
//   node scripts/run-corrida.mjs --dry-run         # imprime plan sin disparar
//   node scripts/run-corrida.mjs --out corrida.csv # nombre del CSV de salida
//   node scripts/run-corrida.mjs --seed 42         # subdir del dataset (default 42)
//
// Verifica antes que WHATSAPP_MODE esté en 'simulate' — si está 'live' aborta,
// para no reventar el token de Meta con 150 mensajes al mismo destinatario.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO      = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(REPO, '.env'));

// --- Config ------------------------------------------------------------------
function parseArgs(argv) {
    const a = { seed: 42, n: null, delay: 400, wait: 60, reset: false, dryRun: false,
                out: null, allowLive: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if      (arg === '--seed')      a.seed  = Number(argv[++i]);
        else if (arg === '--n')         a.n     = Number(argv[++i]);
        else if (arg === '--delay')     a.delay = Number(argv[++i]);
        else if (arg === '--wait')      a.wait  = Number(argv[++i]);
        else if (arg === '--out')       a.out   = argv[++i];
        else if (arg === '--reset')     a.reset = true;
        else if (arg === '--dry-run')   a.dryRun = true;
        else if (arg === '--allow-live') a.allowLive = true;
        else { console.error('arg desconocido:', arg); process.exit(1); }
    }
    return a;
}
const ARGS = parseArgs(process.argv);

const DATASET_DIR = path.join(REPO, 'dataset', `seed-${ARGS.seed}`);
const MOCKS_DIR   = path.join(REPO, 'mocks', 'data', 'orders');
const OUT_DIR     = path.join(REPO, 'out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const outCsv = ARGS.out
    ? path.resolve(ARGS.out)
    : path.join(OUT_DIR, `corrida-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`);

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';

// --- Guardián de modo WhatsApp ----------------------------------------------
async function checkWhatsappMode() {
    try {
        const { execSync } = await import('node:child_process');
        const mode = execSync('docker compose exec -T n8n printenv WHATSAPP_MODE',
            { cwd: REPO, stdio: ['ignore','pipe','ignore'] }).toString().trim();
        if (mode.toLowerCase() === 'live' && !ARGS.allowLive) {
            console.error('\nABORTA: WHATSAPP_MODE=live en el container n8n.');
            console.error('Correr una corrida de 150 en live puede reventar el token de Meta.');
            console.error('Opciones:');
            console.error('  1) editar .env: WHATSAPP_MODE=simulate  +  docker compose up -d --force-recreate n8n');
            console.error('  2) forzar con --allow-live (bajo tu responsabilidad)\n');
            process.exit(2);
        }
        console.log(`WHATSAPP_MODE=${mode}${mode === 'live' ? ' (--allow-live)' : ''}`);
    } catch (e) {
        console.warn('no se pudo verificar WHATSAPP_MODE del container:', e.message.split('\n')[0]);
        console.warn('  → continúo, pero verificá vos que sea "simulate" antes de la corrida masiva');
    }
}

// --- Postgres helpers -------------------------------------------------------
const pool = new pg.Pool({
    host: 'localhost',
    port: Number(process.env.PG_HOST_PORT) || 5433,
    database: process.env.POSTGRES_DB || 'tfi',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD,
});

async function truncateAll() {
    await pool.query(`TRUNCATE tfi.raw_events, tfi.audit_log,
                              tfi.ai_notifications, tfi.order_items,
                              tfi.orders, tfi.customers
                      RESTART IDENTITY CASCADE`);
}

async function queryResults(externalIds) {
    if (externalIds.length === 0) return [];
    const r = await pool.query(`
        SELECT
          o.external_id, o.channel, o.status,
          o.received_at,
          EXTRACT(EPOCH FROM (o.ack_at - o.received_at)) * 1000                   AS ack_ms,
          n.provider, n.is_fallback,
          n.prompt_tokens, n.completion_tokens,
          n.cost_usd,
          n.validator_passes,
          jsonb_array_length(COALESCE(n.validator_failures, '[]'::jsonb))          AS n_validator_failures,
          n.message_status,
          n.dispatched_at,
          EXTRACT(EPOCH FROM (n.dispatched_at - o.received_at)) * 1000            AS e2e_ms,
          (n.wa_message_id LIKE 'wamid.sim_%')                                    AS wa_simulated
        FROM tfi.orders o
        LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
        WHERE o.external_id = ANY($1::text[])`, [externalIds]);
    return r.rows;
}

// --- Dispatch de pedidos ----------------------------------------------------
async function fireML(spec) {
    // Copiar el order file al mock para que el nodo Enrich lo levante
    const src = path.join(DATASET_DIR, 'orders',   `${spec.external_id}.json`);
    const dst = path.join(MOCKS_DIR, `${spec.external_id}.json`);
    fs.copyFileSync(src, dst);

    const webhookBody = JSON.parse(fs.readFileSync(
        path.join(DATASET_DIR, 'webhooks', `${spec.external_id}.json`), 'utf8'));

    return fetch(`${N8N_URL}/webhook/ml-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookBody),
    });
}

async function fireWC(spec) {
    const webhookBody = JSON.parse(fs.readFileSync(
        path.join(DATASET_DIR, 'webhooks', `${spec.external_id}.json`), 'utf8'));

    return fetch(`${N8N_URL}/webhook/wc-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookBody),
    });
}

// --- Estadísticas (intervalo de Wilson al 95%) -----------------------------
function wilson95(k, n) {
    if (n === 0) return { p: 0, low: 0, high: 0 };
    const z = 1.96, zsq = z * z;
    const p = k / n;
    const denom = 1 + zsq / n;
    const center = (p + zsq / (2 * n)) / denom;
    const margin = (z * Math.sqrt(p * (1 - p) / n + zsq / (4 * n * n))) / denom;
    return { p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
}

// --- Main --------------------------------------------------------------------
async function main() {
    console.log('== FlowPedidos · corrida definitiva ==');
    console.log(`dataset: ${DATASET_DIR}`);
    console.log(`n8n:     ${N8N_URL}`);
    console.log(`csv out: ${outCsv}\n`);

    const manifestPath = path.join(DATASET_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.error(`no encuentro manifest en ${manifestPath}`);
        console.error('regenerar dataset:  node dataset/generate.mjs');
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let specs = manifest.items;
    if (ARGS.n) specs = specs.slice(0, ARGS.n);

    const byChannel = specs.reduce((a, s) => ((a[s.channel] = (a[s.channel] || 0) + 1), a), {});
    console.log(`pedidos a disparar: ${specs.length}`);
    console.log(`  por canal:  ${JSON.stringify(byChannel)}`);
    console.log(`  edge cases: ${specs.filter(s => s.edge_case).length}`);
    console.log(`  delay entre pedidos: ${ARGS.delay} ms`);
    console.log(`  espera después del último: ${ARGS.wait} s\n`);

    if (ARGS.dryRun) { console.log('--dry-run: no dispara nada'); process.exit(0); }

    await checkWhatsappMode();

    if (ARGS.reset) {
        console.log('TRUNCATE tfi.* ...');
        await truncateAll();
    }

    // Disparo ---------------------------------------------------------------
    console.log('\ndisparando...');
    const fireResults = [];
    const t_start = Date.now();
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const t0 = Date.now();
        let httpStatus = null, error = null;
        try {
            const r = spec.channel === 'mercadolibre' ? await fireML(spec) : await fireWC(spec);
            httpStatus = r.status;
            await r.text(); // consume body
        } catch (e) { error = e.message; }
        const ms = Date.now() - t0;
        fireResults.push({
            external_id: spec.external_id, channel: spec.channel,
            canonical_status: spec.canonical_status, edge_case: spec.edge_case,
            http_status: httpStatus, fire_ms: ms, error,
        });
        // Progreso cada 10 pedidos
        if ((i + 1) % 10 === 0 || i === specs.length - 1) {
            const done = i + 1;
            const eta = Math.round((specs.length - done) * ARGS.delay / 1000);
            process.stdout.write(`  ${done}/${specs.length} disparados · fire mediano ${median(fireResults.map(x=>x.fire_ms))}ms · ETA ${eta}s\n`);
        }
        if (i < specs.length - 1) await sleep(ARGS.delay);
    }
    const t_fired = Date.now();
    console.log(`\ntodos disparados en ${((t_fired - t_start)/1000).toFixed(1)}s`);

    // Wait ------------------------------------------------------------------
    console.log(`\nesperando ${ARGS.wait}s para que el pipeline procese la cola...`);
    await sleep(ARGS.wait * 1000);

    // Query DB --------------------------------------------------------------
    console.log('consultando resultados en Postgres...');
    const externalIds = specs.map(s => s.external_id);
    const rows = await queryResults(externalIds);
    console.log(`  ${rows.length} pedidos persistidos en tfi.orders (${specs.length - rows.length} no llegaron)`);

    // Correlacionar ---------------------------------------------------------
    const byExt = new Map();
    for (const r of rows) byExt.set(r.external_id, r);

    const merged = fireResults.map(f => {
        const r = byExt.get(f.external_id) || {};
        return {
            external_id: f.external_id,
            channel: f.channel,
            canonical_status: f.canonical_status,
            edge_case: f.edge_case || '',
            http_status: f.http_status,
            fire_ms: f.fire_ms,
            error: f.error || '',
            ack_ms: r.ack_ms != null ? Math.round(r.ack_ms) : '',
            e2e_ms: r.e2e_ms != null ? Math.round(r.e2e_ms) : '',
            provider: r.provider || '',
            is_fallback: r.is_fallback != null ? r.is_fallback : '',
            prompt_tokens: r.prompt_tokens ?? '',
            completion_tokens: r.completion_tokens ?? '',
            cost_usd: r.cost_usd != null ? Number(r.cost_usd).toFixed(6) : '',
            validator_passes: r.validator_passes ?? '',
            n_validator_failures: r.n_validator_failures ?? '',
            message_status: r.message_status || '',
            wa_simulated: r.wa_simulated != null ? r.wa_simulated : '',
            db_persisted: byExt.has(f.external_id),
        };
    });

    // CSV -------------------------------------------------------------------
    const headers = Object.keys(merged[0]);
    const csv = [
        headers.join(','),
        ...merged.map(row => headers.map(h => csvEsc(row[h])).join(',')),
    ].join('\n') + '\n';
    fs.writeFileSync(outCsv, csv);
    console.log(`\nCSV escrito en ${outCsv} (${merged.length} filas)`);

    // Agregados (Cap. 5) ---------------------------------------------------
    reportAggregates(merged);

    await pool.end();
}

function median(xs) {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}
function csvEsc(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function reportAggregates(merged) {
    console.log('\n== agregados para el Cap. 5 ==\n');

    const total = merged.length;
    const persisted = merged.filter(r => r.db_persisted);
    console.log('== H1 · eficiencia operativa (received_at → dispatched_at) ==');
    const e2eList = persisted.filter(r => r.e2e_ms !== '').map(r => Number(r.e2e_ms)).sort((a,b)=>a-b);
    if (e2eList.length) {
        console.log(`  n con dispatched_at: ${e2eList.length}/${total}`);
        console.log(`  mediana: ${median(e2eList)} ms`);
        console.log(`  p90:     ${percentile(e2eList, 0.9)} ms`);
        console.log(`  p95:     ${percentile(e2eList, 0.95)} ms`);
        console.log(`  min/max: ${e2eList[0]} / ${e2eList[e2eList.length-1]} ms`);
    } else {
        console.log(`  (0 pedidos con dispatched_at — revisar Meta/simulate)`);
    }

    console.log('\n== ACK <500 ms (bloque B1) ==');
    const ackOK = persisted.filter(r => r.ack_ms !== '' && Number(r.ack_ms) < 500).length;
    const ackN  = persisted.filter(r => r.ack_ms !== '').length;
    const ackW  = wilson95(ackOK, ackN);
    console.log(`  ${ackOK}/${ackN} = ${(ackW.p*100).toFixed(1)}% · Wilson 95%: [${(ackW.low*100).toFixed(1)}%, ${(ackW.high*100).toFixed(1)}%]`);

    console.log('\n== H2 · precisión de normalización ==');
    // Criterio: sobre el conjunto de pedidos ÚNICOS que superaron la validación
    // estructural, ¿cuál fue normalizado y persistido con éxito?
    //   - canonical_status='error' es un outcome válido de la normalización
    //     (mapeo determinístico del estado desconocido de la plataforma) → cuenta
    //     como éxito en el numerador.
    //   - Rechazos estructurales (HTTP 400 en Validate) se excluyen de ambos lados:
    //     no llegaron a la etapa de normalización.
    //   - Duplicados detectados por idempotencia se excluyen también: por
    //     definición no son "pedidos únicos", y su NO-persistencia es el
    //     comportamiento correcto, no una falla de normalización.
    const structuralRejects = merged.filter(r => r.http_status === 400 || r.http_status === 422).length;
    // Detección de duplicates: fired webhooks cuyo external_id NO aparece en la DB
    // pero que sí superaron validación (HTTP 200). El generador marca estos con
    // edge_case='duplicate' y su webhook apunta al external_id anterior.
    const duplicatesDetected = merged.filter(r =>
        r.edge_case === 'duplicate' && r.http_status !== 400 && r.http_status !== 422 && !r.db_persisted
    ).length;
    const nOK = persisted.length;
    const nN  = merged.length - structuralRejects - duplicatesDetected;
    const normW = wilson95(nOK, nN);
    console.log(`  ${nOK}/${nN} = ${(normW.p*100).toFixed(1)}% · Wilson 95%: [${(normW.low*100).toFixed(1)}%, ${(normW.high*100).toFixed(1)}%]`);
    console.log(`  rechazos estructurales excluidos (validación 400): ${structuralRejects}`);
    console.log(`  duplicates detectados por idempotencia excluidos:  ${duplicatesDetected}`);

    console.log('\n== H3 · anclaje contextual del mensaje ==');
    const withMsg = persisted.filter(r => r.provider);
    const nonFB   = withMsg.filter(r => r.is_fallback !== true).length;
    const fbW     = wilson95(nonFB, withMsg.length);
    console.log(`  generados por LLM (no fallback): ${nonFB}/${withMsg.length} = ${(fbW.p*100).toFixed(1)}% · Wilson 95%: [${(fbW.low*100).toFixed(1)}%, ${(fbW.high*100).toFixed(1)}%]`);
    const p1 = withMsg.filter(r => Number(r.validator_passes) === 1).length;
    const p2 = withMsg.filter(r => Number(r.validator_passes) === 2).length;
    const p0 = withMsg.filter(r => Number(r.validator_passes) === 0).length; // template
    console.log(`  validator_passes: pass1=${p1} · pass2=${p2} · template=${p0}`);

    console.log('\n== B4 · costo económico ==');
    const withCost = withMsg.filter(r => r.cost_usd !== '' && Number(r.cost_usd) > 0);
    const totalCost = withCost.reduce((s, r) => s + Number(r.cost_usd), 0);
    const avgCost = withCost.length ? totalCost / withCost.length : 0;
    const totalTokens = withCost.reduce((s, r) => s + Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0), 0);
    console.log(`  llamadas con costo: ${withCost.length}`);
    console.log(`  costo total: $${totalCost.toFixed(6)} USD`);
    console.log(`  costo medio por mensaje: $${avgCost.toFixed(6)} USD`);
    console.log(`  tokens totales: ${totalTokens}`);
    console.log(`  proyección 300 pedidos/mes: $${(avgCost * 300).toFixed(4)} USD`);

    console.log('\n== distribución por canal ==');
    const byChan = merged.reduce((a, r) => ((a[r.channel] = (a[r.channel] || 0) + 1), a), {});
    for (const [k, v] of Object.entries(byChan)) console.log(`  ${k}: ${v}`);

    console.log('\n== edge cases ==');
    const ec = merged.filter(r => r.edge_case);
    for (const r of ec) {
        console.log(`  ${r.external_id} · ${r.channel} · ${r.edge_case} · persisted=${r.db_persisted} · status=${r.message_status || '-'}`);
    }
}

main().catch(e => { console.error('\nFAIL:', e.message); process.exit(1); });
