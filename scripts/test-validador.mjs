// test-validador.mjs — prueba fuera de n8n de lib/rehydrate-validate.js y
// lib/fallback-template.js (v1.4). Uso, desde la raíz del repo:
//   node scripts/test-validador.mjs
// No usa red ni base: $json, $(), $env y this.helpers.httpRequest son stubs.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const SRC_VAL = readFileSync('n8n-workflows/lib/rehydrate-validate.js', 'utf8');
const SRC_FB = readFileSync('n8n-workflows/lib/fallback-template.js', 'utf8');

function nodo(src) { return new AsyncFunction('$json', '$', '$env', src); }
const validar = nodo(SRC_VAL), plantilla = nodo(SRC_FB);

const CTX = {
    order_status: 'shipped', channel: 'woocommerce', items_count: 1,
    primary_product_name: 'Neumático Fate Motorsport 175/70 R13',
    total_amount: 98500, currency: 'ARS', source_created_at: '2026-09-02T14:10:00Z',
};
function entorno({ externalId = '70', ctx = CTX, env = { OPENAI_API_KEY: 'sk-test' }, http } = {}) {
    const nodos = {
        'Route to canonical': { order: { status: 'shipped', external_id: externalId },
            customer: { full_name: 'Ana', pseudonym: 'cust_ab12cd34', external_id: '9001' } },
        'Build LLM prompt': { sent_context: ctx, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] },
    };
    const $ = n => ({ item: { json: nodos[n] } });
    const llamadas = [];
    const helpers = http === undefined ? {} : { httpRequest: async opts => { llamadas.push(opts); return http(opts); } };
    return { $, env, self: { helpers }, llamadas };
}
function llm(mensaje, atributos) {
    return { message_text: mensaje, atributos_usados: atributos, prompt_tokens: 300, completion_tokens: 60, cost_usd: 0.000081, latency_ms: 900 };
}
const respuesta = (mensaje, atributos) => ({
    choices: [{ message: { content: JSON.stringify({ mensaje, atributos_usados: atributos }) } }],
    usage: { prompt_tokens: 400, completion_tokens: 70 },
});
async function correr(json, e) { return (await validar.call(e.self, json, e.$, e.env)).json; }

let ok = 0;
async function caso(nombre, fn) {
    try { await fn(); ok++; console.log('OK   ', nombre); }
    catch (err) { console.log('FALLA', nombre, '\n      ', err.message); process.exitCode = 1; }
}

const BIEN = '{{saludo}} Tu Fate Motorsport 175/70 R13 ya fue despachado y está en camino.';

await caso('WC-16: id 70 dentro de 175/70 ya no es falso positivo', async () => {
    const e = entorno({ http: () => { throw new Error('no debería reintentar'); } });
    const r = await correr(llm(BIEN, ['primary_product_name', 'order_status']), e);
    assert.equal(r.message_status, 'validated');
    assert.equal(r.validator_passes, 1);
    assert.equal(e.llamadas.length, 0);
    assert.match(r.message_text, /^¡Hola Ana!/);
});

await caso('id aislado se rechaza y el reintento lo corrige (passes = 2, sin seed)', async () => {
    const e = entorno({ externalId: '4471', http: () => respuesta(BIEN, ['primary_product_name']) });
    const r = await correr(llm('{{saludo}} Tu pedido 4471 (Fate Motorsport 175/70) ya fue despachado.', ['primary_product_name']), e);
    assert.equal(r.message_status, 'validated');
    assert.equal(r.validator_passes, 2);
    assert.equal(e.llamadas.length, 1);
    assert.equal(e.llamadas[0].body.seed, undefined);
    assert.equal(e.llamadas[0].json, true);
    assert.equal(r.validator_failures[0].fallas[0].regla, 'sin_identificadores_internos');
    assert.equal(r.prompt_tokens, 700);
    assert.ok(r.cost_usd > 0.000081);
});

await caso('mensaje sin ningún atributo del pedido falla por anclaje', async () => {
    const e = entorno({ http: () => respuesta(BIEN, ['primary_product_name']) });
    const r = await correr(llm('{{saludo}} Tu pedido ya fue despachado y está en camino.', ['order_status']), e);
    assert.equal(r.validator_passes, 2);
    assert.ok(r.validator_failures[0].fallas.some(f => f.regla === 'anclaje_verificable'));
});

await caso('declara producto sin citarlo -> atributos_declarados_citados', async () => {
    const e = entorno({ http: () => respuesta(BIEN, ['primary_product_name']) });
    const r = await correr(llm('{{saludo}} Tu compra de $98.500 ya fue despachada.', ['primary_product_name', 'total_amount']), e);
    const fallas = r.validator_failures[0].fallas.map(f => f.regla);
    assert.ok(fallas.includes('atributos_declarados_citados'));
    assert.ok(!fallas.includes('anclaje_verificable'));  // el monto sí está citado
});

await caso('monto, cantidad y fecha se reconocen como anclaje', async () => {
    const e = entorno({ ctx: { ...CTX, items_count: 3 }, http: () => { throw new Error('no debería reintentar'); } });
    const r = await correr(llm('{{saludo}} Tus tres productos del 2 de septiembre, por $98.500, ya fueron despachados.',
        ['items_count', 'source_created_at', 'total_amount']), e);
    assert.equal(r.validator_passes, 1);
    assert.equal(r.message_status, 'validated');
});

await caso('reintento que lanza -> fallback validator_failed_retry_error', async () => {
    const e = entorno({ externalId: '4471', http: () => { throw new Error('401 invalid_api_key'); } });
    const r = await correr(llm('{{saludo}} Tu pedido 4471 ya fue despachado.', []), e);
    assert.equal(r.use_fallback, true);
    assert.equal(r.fallback_reason, 'validator_failed_retry_error');
    assert.match(r.validator_failures[1].error, /401 invalid_api_key/);
});

await caso('sin this.helpers ni fetch -> error explícito, no "fetch is not defined"', async () => {
    const fetchOriginal = globalThis.fetch; globalThis.fetch = undefined;
    try {
        const e = entorno({ externalId: '4471' });
        const r = await correr(llm('{{saludo}} Tu pedido 4471 ya fue despachado.', []), e);
        assert.equal(r.fallback_reason, 'validator_failed_retry_error');
        assert.match(r.validator_failures[1].error, /no hay cliente HTTP/);
    } finally { globalThis.fetch = fetchOriginal; }
});

await caso('segundo intento también falla -> validator_failed_twice', async () => {
    const e = entorno({ externalId: '4471', http: () => respuesta('{{saludo}} El 4471 salió.', []) });
    const r = await correr(llm('{{saludo}} Tu pedido 4471 ya fue despachado.', []), e);
    assert.equal(r.fallback_reason, 'validator_failed_twice');
    assert.equal(r.validator_passes, 2);
});

await caso('TFI_FORZAR_RECHAZO fuerza el reintento solo para el id listado', async () => {
    const e = entorno({ env: { OPENAI_API_KEY: 'k', TFI_FORZAR_RECHAZO: '70, 99' }, http: () => respuesta(BIEN, ['primary_product_name']) });
    const r = await correr(llm(BIEN, ['primary_product_name']), e);
    assert.equal(r.validator_passes, 2);
    assert.equal(r.validator_failures[0].fallas[0].regla, 'prueba_forzada');
    const e2 = entorno({ externalId: '71', env: { OPENAI_API_KEY: 'k', TFI_FORZAR_RECHAZO: '70' }, http: () => { throw new Error('x'); } });
    assert.equal((await correr(llm(BIEN, ['primary_product_name']), e2)).validator_passes, 1);
});

await caso('plantilla conserva tokens y costo de las llamadas previas (NM-08)', async () => {
    const e = entorno();
    const r = (await plantilla.call(e.self, { order_id: 1, customer_id: 2, fallback_reason: 'validator_failed_twice',
        prompt_tokens: 300, completion_tokens: 60, cost_usd: 0.000081, latency_ms: 900,
        extra_prompt_tokens: 400, extra_completion_tokens: 70, extra_cost_usd: 0.000102 }, e.$, e.env)).json;
    assert.equal(r.prompt_tokens, 700);
    assert.equal(r.completion_tokens, 130);
    assert.equal(r.cost_usd, 0.000183);
    assert.equal(r.latency_ms, 900);
    assert.equal(r.is_fallback, true);
});

await caso('plantilla sin llamadas previas (LLM caído) deja tokens en null y costo 0', async () => {
    const e = entorno();
    const r = (await plantilla.call(e.self, { order_id: 1, customer_id: 2, fallback_reason: 'llm_unavailable' }, e.$, e.env)).json;
    assert.equal(r.prompt_tokens, null);
    assert.equal(r.cost_usd, 0);
    assert.equal(r.fallback_reason, 'llm_unavailable');
});

// --- C8 / NC-05 · parámetros del nodo Postgres ------------------------------
// Réplica de la lógica de n8n-nodes-base (Postgres v2, typeVersion >= 2.5,
// executeQuery.operation.js + helpers/utils.js stringToArray): cada {{ }} de
// una lista en texto se evalúa y, si no es JSON, se parte por comas.
function parametrosN8n(valores) {
    const out = [];
    for (const v of valores) {
        const s = v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        let esJson = true; try { JSON.parse(s.trim()); } catch { esJson = false; }
        out.push(...(esJson ? [s] : s.split(',').filter(Boolean).map(x => x.trim())));
    }
    return out;
}
import { existsSync } from 'node:fs';
await caso('NC-05: el título del pedido 145 corría la cantidad con la lista en texto; el arreglo no', async () => {
    const f = 'dataset/seed-42/orders/3000000000000145.json';
    if (!existsSync(f)) { console.log('      (sin dataset: se omite la reproducción)'); return; }
    const oi = JSON.parse(readFileSync(f, 'utf8')).order_items[0];
    const fila = ['uuid-orden', oi.item.seller_custom_field, oi.item.title, oi.quantity, oi.unit_price, 'pending', '{}'];
    const texto = parametrosN8n(fila);
    assert.ok(texto.length > 7, 'con la lista en texto se esperaban más de 7 valores');
    assert.ok(Number.isNaN(Number(texto[3])), `$4 (quantity) recibe «${texto[3]}»`);
    const wf = JSON.parse(readFileSync('n8n-workflows/workflow.json', 'utf8'));
    const qr = wf.nodes.find(n => n.name === 'Insert Items').parameters.options.queryReplacement;
    assert.match(qr, /^=\{\{\s*\[/, 'Insert Items debe pasar los parámetros como arreglo');
    console.log(`      lista en texto: ${texto.length} valores; $4 = «${texto[3]}»`);
});

console.log(`\n${ok} casos OK`);
