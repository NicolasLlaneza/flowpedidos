#!/usr/bin/env node
// =============================================================================
// export-dashboard-data.mjs · alimenta el tablero operativo del pipeline
// -----------------------------------------------------------------------------
// Escribe dashboard-data.json junto al index.html del tablero. Admite dos
// fuentes, y la elección no es indiferente:
//
//   --from-csv  (por defecto)  out/corrida-v2.csv
//       La evidencia publicada de la corrida reportada en el Capítulo 5.
//       No requiere base de datos ni credenciales: cualquiera que clone el
//       repositorio puede regenerar el tablero y obtener exactamente las
//       cifras del documento. Es la fuente que el tablero debe usar para la
//       figura del §8.1.
//
//   --from-db                  tfi.orders + tfi.ai_notifications
//       El estado actual de la base. Sirve para monitorear una corrida en
//       curso, y es la única fuente que permite RECALCULAR el indicador de
//       anclaje contextual, porque requiere el texto de cada mensaje y el
//       campo atributos_usados, que la evidencia publicada no incluye. Desde
//       el CSV el indicador se cita del agregado publicado en
//       out/anclaje-resultado.txt, declarando esa procedencia.
//
// Uso:
//   node export-dashboard-data.mjs                      # desde el CSV de la corrida
//   node export-dashboard-data.mjs --from-db            # desde la base
//   node export-dashboard-data.mjs --from-db --dataset  # sólo el dataset sintético
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const desdeDb = process.argv.includes('--from-db');
const soloDataset = process.argv.includes('--dataset');

const ORDEN_ESTADOS = ['paid', 'shipped', 'delivered', 'pending_payment', 'cancelled', 'refunded', 'error'];
const BIN_MS = 100;

// -----------------------------------------------------------------------------
// Medición externa de la confirmación al emisor (§5.2)
// -----------------------------------------------------------------------------
// El campo ack_ms del esquema vale cero en todas las filas porque la misma
// sentencia de inserción asigna received_at y ack_at: es nulo por construcción
// y NO constituye una medición. Reportarlo como latencia sería un error, según
// declara la propia §5.2.
//
// El contraste del criterio (a) de H1 se hace contra una medición externa al
// sistema sobre treinta solicitudes al endpoint. Esos son los valores que el
// tablero debe mostrar, etiquetados como lo que son: una cota inferior del
// tiempo que observaría el emisor, porque se tomaron contra la dirección local
// y excluyen el tramo del túnel público.
const ACK_EXTERNO = {
    medido_por_pedido: false,
    n: 30,
    mediana_ms: 38,
    min_ms: 33,
    p95_ms: 104,
    max_ms: 131,
    umbral_ms: 500,
    instrumento: 'medición externa al endpoint, 30 solicitudes (§5.2)',
    nota: 'cota inferior: excluye el tramo del túnel público que un emisor externo sí atraviesa',
};

// -----------------------------------------------------------------------------
// Indicador de anclaje contextual publicado (§3.3)
// -----------------------------------------------------------------------------
// El indicador exige el texto de cada mensaje, y out/corrida-v2.csv registra
// latencias, costo y estado del despacho pero no message_text. Sin embargo el
// resultado SÍ está publicado: out/anclaje-resultado.txt es la salida de
// scripts/analizar-anclaje.py sobre los 142 mensajes que generó el modelo en la
// corrida reportada.
//
// Se lee de ese archivo en lugar de transcribirse a una constante, por el mismo
// motivo por el que el exportador reescribe el bloque embebido de index.html:
// un valor copiado a mano se separa de su fuente, y esta figura ya sufrió esa
// divergencia una vez.
//
// La limitación que queda es de reproducibilidad, no de resultado, y el tablero
// la declara: se cita un agregado publicado porque la entrada del script
// (out/anclaje-crudo.csv) no está versionada, de modo que un tercero puede leer
// el valor pero no recalcularlo.
// El parámetro `generadosEsperados` es el control que impide que esta tarjeta se
// desincronice de la corrida, que es el error por el que la Figura 8.1 llegó a
// mostrar 147/141/0. El agregado y el CSV son dos archivos distintos: si se
// regenera la corrida y no se vuelve a correr analizar-anclaje.py, el tablero
// mostraría indicadores nuevos con un anclaje viejo, y nada lo diría. Acá se
// contrastan, y ante la menor discrepancia no se publica el número.
function leerAnclajePublicado(generadosEsperados) {
    const ruta = path.join(REPO, 'out', 'anclaje-resultado.txt');
    let txt;
    try { txt = fs.readFileSync(ruta, 'utf8'); } catch { return null; }

    const entero = (rx) => { const m = txt.match(rx); return m ? Number(m[1]) : null; };
    const evaluados = entero(/generados por el modelo[^:]*:\s*(\d+)/i);
    const conAlguno = entero(/Con al menos un atributo[^:]*:\s*(\d+)/i);
    if (evaluados == null || conAlguno == null || !evaluados) return null;

    // Desglose por atributo: verificado en el texto vs. declarado por el modelo.
    // Es el contraste que mide la brecha de la regla 2 del validador, que acepta
    // la declaración sin comprobarla contra el texto.
    const porAtributo = [];
    const rxAttr = /^\s{2}(\w+)\s+verificado\s+(\d+)\s+declarado\s+(\d+)\s*$/gm;
    for (const m of txt.matchAll(rxAttr)) {
        porAtributo.push({ atributo: m[1], verificado: Number(m[2]), declarado: Number(m[3]) });
    }

    const noAnclables = [];
    const rxNo = /^\s{2}(\w+)\s+declarado\s+(\d+)\s*$/gm;
    for (const m of txt.matchAll(rxNo)) {
        noAnclables.push({ atributo: m[1], declarado: Number(m[2]) });
    }

    const brecha = txt.match(/declaran un atributo anclable y no lo citan[^:]*:\s*(\d+)\s+de\s+(\d+)/i);

    // Los mensajes que evaluó el analizador tienen que ser los que generó el
    // modelo en esta corrida: los que llevan mensaje, menos los que degradaron a
    // plantilla. Si no coinciden, el .txt es de otra corrida.
    if (generadosEsperados != null && evaluados !== generadosEsperados) {
        console.warn(`  ! anclaje DESACTUALIZADO: out/anclaje-resultado.txt evaluó ${evaluados} `
                   + `mensajes y esta corrida generó ${generadosEsperados}.`);
        console.warn('    No se publica el indicador. Regenerarlo con:');
        console.warn('      docker compose exec -T postgres psql -U n8n -d tfi -q --csv '
                   + '< sql/export-anclaje.sql > out/anclaje-crudo.csv');
        console.warn('      python scripts/analizar-anclaje.py out/anclaje-crudo.csv '
                   + '> out/anclaje-resultado.txt');
        return {
            disponible: false,
            desactualizado: true,
            evaluados_en_el_agregado: evaluados,
            generados_en_la_corrida: generadosEsperados,
            motivo: `out/anclaje-resultado.txt corresponde a otra corrida: evaluó ${evaluados} `
                  + `mensajes y ésta generó ${generadosEsperados}`,
        };
    }

    const ic = wilson(conAlguno, evaluados);

    // Control de integridad contra el intervalo que imprime el propio archivo:
    // si no coinciden, el archivo y este exportador no están hablando de la
    // misma corrida y hay que mirarlo antes de publicar la figura.
    const icArchivo = txt.match(/IC Wilson 95 %\s*=\s*\[\s*([\d.]+)\s*;\s*([\d.]+)\s*\]/i);
    if (icArchivo && ic) {
        const desvio = Math.max(Math.abs(ic.low - Number(icArchivo[1])),
                                Math.abs(ic.high - Number(icArchivo[2])));
        if (desvio > 0.15) {
            console.warn(`  ! anclaje: el IC recalculado [${ic.low}; ${ic.high}] no coincide con `
                       + `el publicado [${icArchivo[1]}; ${icArchivo[2]}] — revisar antes de usar la figura`);
        }
    }

    return {
        disponible: true,
        origen: 'publicado',
        procedencia: 'out/anclaje-resultado.txt — salida de scripts/analizar-anclaje.py sobre la corrida del Capítulo 5',
        limitacion: 'la entrada del script se publica en out/anclaje-crudo-anon.csv, con el saludo nominal '
                  + 'reemplazado por [NOMBRE]; el reemplazo no altera el resultado, que un tercero puede recalcular',
        denominador: 'mensajes que generó el modelo, antes del despacho; excluye la degradación a plantilla',
        evaluados,
        con_al_menos_uno: conAlguno,
        pct: Number((conAlguno / evaluados * 100).toFixed(1)),
        ic,
        por_atributo: porAtributo,
        declarados_no_anclables: noAnclables,
        // Ojo con las unidades: acá se cuentan MENSAJES con alguna declaración
        // ausente del texto, no declaraciones individuales como en --from-db.
        mensajes_con_declaracion_ausente: brecha ? Number(brecha[1]) : null,
        mensajes_base: brecha ? Number(brecha[2]) : evaluados,
    };
}

// -----------------------------------------------------------------------------
// Detalle de los rechazos del validador (NA-01)
// -----------------------------------------------------------------------------
// out/corrida-v2.csv no trae validator_failures. El detalle se publica aparte,
// en out/validador-rechazos.csv, copiado del campo validator_failures de
// tfi.ai_notifications (sql/export-defectos.sql). No lleva datos personales.
function leerRechazosPublicados() {
    const ruta = path.join(REPO, 'out', 'validador-rechazos.csv');
    let txt;
    try { txt = fs.readFileSync(ruta, 'utf8'); } catch { return {}; }
    const lineas = txt.replace(/\r/g, '').split('\n').filter(Boolean);
    const cab = lineas.shift().split(',');
    const out = {};
    for (const l of lineas) {
        const cols = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
        const f = Object.fromEntries(cab.map((k, i) => [k, cols[i]]));
        const clave = `${f.channel}:${f.external_id}`;
        (out[clave] = out[clave] || []).push({ intento: f.intento, regla: f.regla, detalle: f.detalle });
    }
    return out;
}

// -----------------------------------------------------------------------------
// Utilidades estadísticas
// -----------------------------------------------------------------------------
function percentilLineal(ordenados, p) {
    const n = ordenados.length;
    if (!n) return null;
    const k = (n - 1) * p;
    const f = Math.floor(k);
    const c = Math.min(f + 1, n - 1);
    return ordenados[f] + (k - f) * (ordenados[c] - ordenados[f]);
}

/**
 * Intervalo de Wilson al 95 %, el mismo método que declara el §3.10.
 * Se prefiere a la aproximación normal porque conserva su cobertura con
 * muestras chicas y con proporciones próximas a la unidad, que es la
 * situación de este estudio.
 */
function wilson(exitos, total, z = 1.959963985) {
    if (!total) return null;
    const p = exitos / total;
    const den = 1 + (z * z) / total;
    const centro = (p + (z * z) / (2 * total)) / den;
    const semi = (z / den) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
    return {
        pct: Number((p * 100).toFixed(1)),
        low: Number((Math.max(0, centro - semi) * 100).toFixed(1)),
        high: Number((Math.min(1, centro + semi) * 100).toFixed(1)),
    };
}

function bins(valores) {
    if (!valores.length) return [];
    const lo = Math.floor(Math.min(...valores) / BIN_MS) * BIN_MS;
    const hi = Math.ceil(Math.max(...valores) / BIN_MS) * BIN_MS;
    const out = [];
    for (let from = lo; from < hi; from += BIN_MS) {
        out.push({ from, to: from + BIN_MS, count: valores.filter(v => v >= from && v < from + BIN_MS).length });
    }
    return out;
}

function resumenLatencia(valores) {
    const v = [...valores].sort((a, b) => a - b);
    if (!v.length) return null;
    return {
        n: v.length,
        mediana: Math.round(percentilLineal(v, 0.5)),
        p90: Math.round(percentilLineal(v, 0.9)),
        p95: Math.round(percentilLineal(v, 0.95)),
        min: v[0],
        max: v[v.length - 1],
        media: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)),
    };
}

// -----------------------------------------------------------------------------
// Indicador de anclaje contextual (§3.3)
// -----------------------------------------------------------------------------
// El §3.3 define como segundo indicador de calidad la proporción de mensajes
// que incorporan al menos un atributo verificable del pedido. El validador de
// siete reglas NO lo verifica: su regla 2 sólo comprueba que los nombres que el
// modelo declara en atributos_usados pertenezcan al conjunto de claves válidas
// del contexto, no que esos atributos aparezcan en el texto.
//
// Esta función cierra esa brecha: verifica PRESENCIA TEXTUAL de cada atributo
// en el mensaje, que es lo que el indicador mide. Se calcula sobre la salida
// del modelo, declarando el denominador, porque calculado sobre los mensajes
// despachados valdría cien por ciento por construcción y mediría la compuerta
// en lugar de la calidad.
const PALABRAS_ESTADO = {
    created: /recib|confirm|orden|pedido/i,
    pending_payment: /pag|esper/i,
    paid: /pag|confirm/i,
    preparing: /prepar|arm/i,
    shipped: /despach|env[ií]|camino/i,
    delivered: /entreg|recib/i,
    cancelled: /cancel|anul/i,
    refunded: /reembols|devolu|reintegr/i,
};

export function atributosCitados(mensaje, ctx) {
    const texto = String(mensaje || '').toLowerCase();
    const citados = [];

    // primary_product_name: alcanza con una palabra distintiva (>4 letras) del
    // nombre del producto. "Neumático Pirelli Cinturato P1" → "pirelli".
    if (ctx.primary_product_name) {
        const palabras = String(ctx.primary_product_name).toLowerCase()
            .split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 4);
        if (palabras.some(w => texto.includes(w))) citados.push('primary_product_name');
    }

    const kw = PALABRAS_ESTADO[ctx.order_status];
    if (kw && kw.test(mensaje)) citados.push('order_status');

    if (Number(ctx.items_count) > 1 && /\b\d+\s+(unidades?|productos?|art[ií]culos?|[ií]tems?)\b/i.test(mensaje)) {
        citados.push('items_count');
    }

    const monto = Math.round(Number(ctx.total_amount) || 0);
    if (monto > 0 && (texto.includes(String(monto)) || texto.includes(monto.toLocaleString('es-AR')))) {
        citados.push('total_amount');
    }

    return citados;
}

// -----------------------------------------------------------------------------
// Fuente 1 — evidencia publicada (out/corrida-v2.csv)
// -----------------------------------------------------------------------------
function leerCsv(ruta) {
    if (!fs.existsSync(ruta)) {
        const rel = path.relative(REPO, ruta).replace(/\\/g, '/');
        const e = new Error(
            `No se encontró ${rel}.\n\n`
          + `  Es la evidencia publicada de la corrida del Capítulo 5, y el tablero la\n`
          + `  necesita para regenerarse sin base de datos. Si estás monitoreando una\n`
          + `  corrida en curso, la fuente es la base:\n\n`
          + `      node export-dashboard-data.mjs --from-db\n`);
        e.esperado = true;   // error de uso: alcanza con el mensaje, sin traza
        throw e;
    }
    const lineas = fs.readFileSync(ruta, 'utf8').trim().split(/\r?\n/);
    const cab = lineas[0].split(',');
    return lineas.slice(1).map(l => {
        const celdas = l.split(',');
        return Object.fromEntries(cab.map((k, i) => [k, celdas[i]]));
    });
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const bool = (v) => /^t(rue)?$/i.test(String(v || ''));

/**
 * Ordena los estados para el gráfico sin perder ninguno.
 *
 * ORDEN_ESTADOS es la lista canónica del §3.2, y filtrar por ella descartaba en
 * silencio cualquier estado que no estuviera: las barras dejaban de sumar el
 * total de pedidos y el tablero no lo decía. Un estado nuevo —porque se amplió
 * el modelo canónico, o porque un normalizador dejó pasar un valor crudo de la
 * plataforma— tiene que verse, aunque sea al final y fuera del orden previsto.
 */
function ordenarEstados(porEstado) {
    const canonicos = ORDEN_ESTADOS.filter(s => porEstado[s]);
    const fuera = Object.keys(porEstado).filter(s => !ORDEN_ESTADOS.includes(s)).sort();
    if (fuera.length) {
        console.warn(`  ! estados fuera del modelo canónico del §3.2: ${fuera.join(', ')}`);
        console.warn('    se grafican al final. Revisar si es un estado nuevo o un valor '
                   + 'crudo que el normalizador dejó pasar.');
    }
    return [...canonicos, ...fuera].map(s => ({
        estado: s, ...porEstado[s], fuera_del_modelo: ORDEN_ESTADOS.includes(s) ? undefined : true,
    }));
}

function desdeCsv() {
    const rutaCorrida = path.join(REPO, 'out', 'corrida-v2.csv');
    const filas = leerCsv(rutaCorrida);

    // El log del disparador del canal simulado aporta los webhooks emitidos y
    // los rechazos estructurales, que la tabla de pedidos no puede contener:
    // un webhook rechazado no produce un pedido.
    let emitidos = null, rechazados = null;
    const rutaDisparo = path.join(REPO, 'out', 'corrida-v2-ml.csv');
    if (fs.existsSync(rutaDisparo)) {
        const d = leerCsv(rutaDisparo);
        rechazados = d.filter(r => String(r.http_status) === '400').length;
        emitidos = d.length + filas.filter(r => r.channel === 'woocommerce').length;
    }

    const conMensaje = filas.filter(r => r.message_status);
    const fallback = filas.filter(r => bool(r.is_fallback));
    const costo = filas.reduce((s, r) => s + (num(r.cost_usd) || 0), 0);

    const e2ePorModo = {};
    for (const modo of ['live', 'simulate']) {
        const v = filas.filter(r => r.dispatch_mode === modo && num(r.e2e_ms) != null)
                       .map(r => num(r.e2e_ms));
        if (v.length) e2ePorModo[modo] = { ...resumenLatencia(v), bins: bins(v) };
    }

    const porEstado = {};
    for (const r of filas) {
        porEstado[r.status] = porEstado[r.status] || { ml: 0, wc: 0 };
        if (r.channel === 'mercadolibre') porEstado[r.status].ml++;
        else if (r.channel === 'woocommerce') porEstado[r.status].wc++;
    }

    // Pedidos cuya inserción de ítems se interrumpió. La evidencia publicada no
    // trae el conteo de ítems por pedido, de modo que esto no se mide acá: se
    // toma de lo que el §5.5 informa, que son los tres pedidos cuyo estado de
    // plataforma no mapea a ningún estado canónico. Se marca como dato
    // declarado y no medido, para que el tablero no aparente una precisión que
    // esta fuente no tiene. Con --from-db el conteo sí se mide.
    const sinItemsDeclarado = filas.filter(r => r.status === 'error').length;

    const conCosto = conMensaje.filter(r => num(r.cost_usd) > 0);
    const reglasPorPedido = leerRechazosPublicados();
    const rechazosValidador = filas
        .filter(r => bool(r.is_fallback) || num(r.validator_passes) > 1)
        .map(r => ({
            external_id: r.external_id,
            channel: r.channel,
            status: r.status,
            validator_passes: num(r.validator_passes),
            degrado_a_plantilla: bool(r.is_fallback),
            reglas: reglasPorPedido[`${r.channel}:${r.external_id}`] || [],
        }));

    return {
        meta: {
            corrida: 'definitiva reportada en el Capítulo 5',
            fuente: 'out/corrida-v2.csv (evidencia publicada)',
            reproducible_sin_base: true,
            generado_en: new Date().toISOString(),
        },
        kpi: {
            webhooks_emitidos: emitidos,
            rechazados_400: rechazados,
            persistidos: filas.length,
            con_mensaje: conMensaje.length,
            sin_mensaje: filas.length - conMensaje.length,
            fallback: fallback.length,
            aprobados_primer_intento: conMensaje.length - fallback.length,
            costo_total_usd: Number(costo.toFixed(6)),
            // Sobre los mensajes con costo registrado (142): la degradación
            // de WC-16 quedó con costo 0 porque la plantilla lo sobrescribió
            // (NM-08), igual que divide el §5.2.
            costo_por_mensaje_usd: conCosto.length
                ? Number((costo / conCosto.length).toFixed(6)) : null,
            mensajes_con_costo: conCosto.length,
        },
        ack: ACK_EXTERNO,
        h2: tasasH2(filas.length, emitidos, rechazados, sinItemsDeclarado, 'declarado en §5.5'),
        latencia: e2ePorModo,
        estados: ordenarEstados(porEstado),
        validador: {
            evaluados: conMensaje.length,
            aprobados_primer_intento: conMensaje.length - fallback.length,
            con_segunda_pasada: filas.filter(r => num(r.validator_passes) > 1).length,
            rechazos: rechazosValidador,
        },
        anclaje: leerAnclajePublicado(conMensaje.length - fallback.length) || {
            disponible: false,
            motivo: 'no se encontró out/anclaje-resultado.txt; el indicador se calcula '
                  + 'con --from-db, o publicando message_text en la evidencia de la corrida',
        },
        ...detallePorPedido(filas.map(r => ({
            external_id: r.external_id,
            channel: r.channel,
            status: r.status,
            dispatch_mode: r.dispatch_mode,
            interno_ms: num(r.interno_ms),
            dispatch_ms: num(r.dispatch_ms),
            e2e_ms: num(r.e2e_ms),
            message_status: r.message_status || null,
            is_fallback: r.message_status ? bool(r.is_fallback) : null,
            validator_passes: num(r.validator_passes),
            cost_usd: num(r.cost_usd),
            llm_latency_ms: num(r.llm_latency_ms),
        }))),
    };
}

// -----------------------------------------------------------------------------
// Detalle por pedido
// -----------------------------------------------------------------------------
// El tablero permite bajar de cualquier agregado a los pedidos que lo producen.
// Eso es lo que convierte una cifra en algo verificable: quien lee «1
// degradación a plantilla» puede ver cuál pedido fue, con qué regla, y
// contrastarlo contra el anexo sin abrir un CSV.
//
// Se emite como lista de filas y lista de columnas en lugar de objetos, porque
// el archivo se embebe dentro del propio index.html para que el tablero abra
// sin servidor, y repetir las claves en 148 filas lo triplicaría.
const COLUMNAS = ['external_id', 'channel', 'status', 'dispatch_mode', 'interno_ms',
                  'dispatch_ms', 'e2e_ms', 'message_status', 'is_fallback',
                  'validator_passes', 'cost_usd', 'llm_latency_ms'];

function detallePorPedido(filas) {
    return {
        columnas: COLUMNAS,
        pedidos: filas.map(f => COLUMNAS.map(c => (f[c] === undefined ? null : f[c]))),
    };
}

// -----------------------------------------------------------------------------
// Las dos tasas de normalización (§3.3)
// -----------------------------------------------------------------------------
// El §3.3 define dos tasas complementarias, y el juicio sobre H2 depende de
// cuál se adopte y de qué se cuente como "persistido con éxito":
//
//   admisión estructural  = pedidos que superan la validación / webhooks emitidos
//   condicional           = pedidos normalizados con éxito / pedidos admitidos
//
// La tasa condicional admite a su vez dos denominadores, y el documento no
// declara cuál usa: contar sólo la cabecera del pedido, o exigir además que
// sus ítems persistan. Como order_items es una de las tres entidades de
// negocio del modelo canónico (§4.4), el tablero informa ambas y deja la
// decisión a la vista en lugar de resolverla en silencio.
function tasasH2(persistidos, emitidos, rechazados, sinItems, procedenciaItems = 'medido') {
    const out = {};
    if (emitidos) {
        out.admision_estructural = {
            exitos: persistidos, total: emitidos,
            ...wilson(persistidos, emitidos),
            denominador: 'webhooks emitidos',
        };
    }
    out.condicional_cabecera = {
        exitos: persistidos, total: persistidos,
        ...wilson(persistidos, persistidos),
        denominador: 'pedidos admitidos; cuenta sólo la cabecera del pedido',
    };
    if (sinItems != null) {
        out.condicional_con_items = {
            exitos: persistidos - sinItems, total: persistidos,
            ...wilson(persistidos - sinItems, persistidos),
            denominador: 'pedidos admitidos; exige además que los ítems persistan',
            procedencia: procedenciaItems,
        };
    }
    out.umbral_h2 = 95;
    return out;
}

// -----------------------------------------------------------------------------
// Fuente 2 — base de datos en vivo
// -----------------------------------------------------------------------------
async function desdeBase() {
    const { default: pg } = await import('pg');
    try { process.loadEnvFile(path.join(REPO, '.env')); } catch { /* noop */ }

    const pool = new pg.Pool({
        host: 'localhost',
        port: Number(process.env.PG_HOST_PORT) || 5433,
        database: process.env.POSTGRES_DB || 'tfi',
        user: process.env.POSTGRES_USER || 'n8n',
        password: process.env.POSTGRES_PASSWORD,
    });
    const filtro = soloDataset ? `WHERE o.external_id ~ '^[0-9]{16}$'` : '';

    try {
        const { rows: pedidos } = await pool.query(`
            SELECT o.id, o.external_id, o.channel, o.status, o.total_amount,
                   (SELECT count(*) FROM tfi.order_items i WHERE i.order_id = o.id)::int AS items,
                   n.message_text, n.message_status, n.is_fallback, n.cost_usd,
                   n.validator_passes, n.validator_failures, n.atributos_usados,
                   EXTRACT(EPOCH FROM (n.dispatched_at - o.received_at)) * 1000 AS e2e_ms,
                   (n.wa_message_id LIKE 'wamid.sim_%') AS simulado,
                   (SELECT product_name FROM tfi.order_items i
                     WHERE i.order_id = o.id ORDER BY i.quantity * i.unit_price DESC LIMIT 1) AS producto
            FROM tfi.orders o
            LEFT JOIN tfi.ai_notifications n ON n.order_id = o.id
            ${filtro}
        `);

        const { rows: [ev] } = await pool.query(`
            SELECT (SELECT count(*) FROM tfi.raw_events)::int AS emitidos,
                   (SELECT count(*) FROM tfi.audit_log
                     WHERE event_type = 'validation_failed')::int AS rechazados
        `);

        const conMensaje = pedidos.filter(p => p.message_status);
        const fallback = pedidos.filter(p => p.is_fallback);
        const sinItems = pedidos.filter(p => p.items === 0).length;
        const costo = pedidos.reduce((s, p) => s + Number(p.cost_usd || 0), 0);

        // --- Anclaje contextual, por verificación textual -------------------
        const generados = pedidos.filter(p => p.message_text && !p.is_fallback);
        const dist = {};
        const porAtributo = {};
        let declaradosNoPresentes = 0, totalDeclarados = 0;

        for (const p of generados) {
            const citados = atributosCitados(p.message_text, {
                primary_product_name: p.producto,
                order_status: p.status,
                items_count: p.items,
                total_amount: p.total_amount,
            });
            dist[citados.length] = (dist[citados.length] || 0) + 1;
            for (const a of citados) porAtributo[a] = (porAtributo[a] || 0) + 1;

            // Contraste con lo que el modelo declaró haber citado: la regla 2
            // del validador acepta la declaración sin comprobarla contra el
            // texto, de modo que la brecha entre ambas es medible.
            const declarados = Array.isArray(p.atributos_usados) ? p.atributos_usados : [];
            totalDeclarados += declarados.length;
            declaradosNoPresentes += declarados.filter(a => !citados.includes(a)).length;
        }

        const conAlguno = generados.filter(p => atributosCitados(p.message_text, {
            primary_product_name: p.producto, order_status: p.status,
            items_count: p.items, total_amount: p.total_amount,
        }).length > 0).length;

        const e2ePorModo = {};
        for (const [modo, pred] of [['live', p => p.simulado === false], ['simulate', p => p.simulado === true]]) {
            const v = pedidos.filter(p => pred(p) && p.e2e_ms != null).map(p => Math.round(Number(p.e2e_ms)));
            if (v.length) e2ePorModo[modo] = { ...resumenLatencia(v), bins: bins(v) };
        }

        const porEstado = {};
        for (const p of pedidos) {
            porEstado[p.status] = porEstado[p.status] || { ml: 0, wc: 0 };
            if (p.channel === 'mercadolibre') porEstado[p.status].ml++;
            else if (p.channel === 'woocommerce') porEstado[p.status].wc++;
        }

        return {
            meta: {
                corrida: soloDataset ? 'dataset sintético (seed=42)' : 'estado actual de la base',
                fuente: 'tfi.orders + tfi.ai_notifications',
                reproducible_sin_base: false,
                generado_en: new Date().toISOString(),
            },
            kpi: {
                webhooks_emitidos: ev.emitidos || null,
                rechazados_400: ev.rechazados || null,
                persistidos: pedidos.length,
                con_mensaje: conMensaje.length,
                sin_mensaje: pedidos.length - conMensaje.length,
                fallback: fallback.length,
                aprobados_primer_intento: conMensaje.length - fallback.length,
                costo_total_usd: Number(costo.toFixed(6)),
                costo_por_mensaje_usd: conMensaje.length
                    ? Number((costo / conMensaje.length).toFixed(6)) : null,
            },
            ack: ACK_EXTERNO,
            h2: tasasH2(pedidos.length, ev.emitidos, ev.rechazados, sinItems),
            latencia: e2ePorModo,
            estados: ordenarEstados(porEstado),
            validador: {
                evaluados: conMensaje.length,
                aprobados_primer_intento: conMensaje.length - fallback.length,
                con_segunda_pasada: pedidos.filter(p => Number(p.validator_passes) > 1).length,
                rechazos: pedidos
                    .filter(p => p.validator_failures && p.validator_failures.length)
                    .map(p => ({
                        external_id: p.external_id,
                        channel: p.channel,
                        status: p.status,
                        validator_passes: p.validator_passes,
                        degrado_a_plantilla: p.is_fallback,
                        reglas: (p.validator_failures[0]?.fallas || [])
                            .map(f => ({ regla: f.regla, detalle: f.detalle })),
                    })),
            },
            anclaje: {
                disponible: true,
                origen: 'computado',
                procedencia: 'verificación textual sobre tfi.ai_notifications.message_text',
                denominador: 'mensajes generados por el modelo, antes del despacho',
                evaluados: generados.length,
                con_al_menos_uno: conAlguno,
                pct: generados.length
                    ? Number((conAlguno / generados.length * 100).toFixed(1)) : null,
                promedio_por_mensaje: generados.length
                    ? Number((Object.entries(dist).reduce((s, [k, v]) => s + Number(k) * v, 0) / generados.length).toFixed(2))
                    : null,
                distribucion: Object.entries(dist)
                    .map(([k, v]) => ({ atributos: Number(k), mensajes: v }))
                    .sort((a, b) => a.atributos - b.atributos),
                por_atributo: Object.entries(porAtributo)
                    .map(([a, n]) => ({ atributo: a, mensajes: n }))
                    .sort((a, b) => b.mensajes - a.mensajes),
                declarados_no_presentes: declaradosNoPresentes,
                total_declarados: totalDeclarados,
            },
            ...detallePorPedido(pedidos.map(p => ({
                external_id: p.external_id,
                channel: p.channel,
                status: p.status,
                dispatch_mode: p.simulado === false ? 'live' : (p.simulado === true ? 'simulate' : null),
                // La base registra el instante de despacho pero no el desglose
                // entre componente interno y viaje contra la API, que sí trae
                // la evidencia publicada. Se emiten en nulo antes que inventarlos.
                interno_ms: null,
                dispatch_ms: null,
                e2e_ms: p.e2e_ms == null ? null : Math.round(Number(p.e2e_ms)),
                message_status: p.message_status || null,
                is_fallback: p.message_status ? Boolean(p.is_fallback) : null,
                validator_passes: p.validator_passes == null ? null : Number(p.validator_passes),
                cost_usd: p.cost_usd == null ? null : Number(p.cost_usd),
                llm_latency_ms: null,
            }))),
        };
    } finally {
        await pool.end();
    }
}

// -----------------------------------------------------------------------------
/**
 * Sincroniza los datos embebidos del tablero.
 *
 * index.html lleva una copia de los datos dentro de un bloque
 * <script id="fallback-data">, para que abrirlo con file:// —sin servidor y
 * sin base de datos— muestre siempre algo válido. Esa copia es la que termina
 * en la figura del documento.
 *
 * Mantenerla a mano fue el origen de una divergencia real: la figura llegó a
 * mostrar las cifras de una corrida anterior mientras el capítulo de
 * resultados reportaba otras. Escribirla desde el mismo objeto que produce el
 * JSON hace que esa divergencia no pueda volver a ocurrir.
 */
function embeber(data) {
    const ruta = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(ruta, 'utf8');
    const rx = /(<script type="application\/json" id="fallback-data">)([\s\S]*?)(<\/script>)/;
    if (!rx.test(html)) {
        console.warn('  ! no encontré el bloque fallback-data en index.html; no se embebió nada');
        return false;
    }
    fs.writeFileSync(ruta, html.replace(rx, `$1\n${JSON.stringify(data)}\n$3`), 'utf8');
    return true;
}

async function main() {
    const data = desdeDb ? await desdeBase() : desdeCsv();
    const destino = path.join(__dirname, 'dashboard-data.json');
    fs.writeFileSync(destino, JSON.stringify(data, null, 1), 'utf8');

    // Por defecto se embebe al exportar desde la evidencia publicada, que es la
    // fuente de la figura del documento. Desde la base no, porque ahí los datos
    // son el estado momentáneo de una corrida en curso.
    const embeberAhora = process.argv.includes('--embed')
        || (!desdeDb && !process.argv.includes('--no-embed'));
    if (embeberAhora && embeber(data)) {
        console.log('  datos embebidos en index.html (el tablero abre sin servidor)');
    }

    console.log(`Escrito ${destino}`);
    console.log(`  fuente              : ${data.meta.fuente}`);
    console.log(`  pedidos persistidos : ${data.kpi.persistidos}`);
    console.log(`  con mensaje         : ${data.kpi.con_mensaje} (sin mensaje: ${data.kpi.sin_mensaje})`);
    console.log(`  degradaciones       : ${data.kpi.fallback}`);
    console.log(`  costo total         : USD ${data.kpi.costo_total_usd}`);
    for (const [modo, l] of Object.entries(data.latencia)) {
        console.log(`  e2e ${modo.padEnd(9)}: mediana ${l.mediana} ms (n=${l.n})`);
    }
    if (data.anclaje.disponible) {
        const ic = data.anclaje.ic ? ` IC [${data.anclaje.ic.low}; ${data.anclaje.ic.high}]` : '';
        console.log(`  anclaje             : ${data.anclaje.pct} % cita al menos un atributo `
                  + `(${data.anclaje.con_al_menos_uno}/${data.anclaje.evaluados})${ic}`
                  + ` — ${data.anclaje.origen}`);
    } else {
        console.log(`  anclaje             : no computable — ${data.anclaje.motivo}`);
    }
}

main().catch(err => {
    // Un error de uso se explica solo; la traza de Node sólo estorba. Los
    // errores inesperados sí se imprimen completos, que es cuando sirve.
    console.error(err && err.esperado ? '\n' + err.message : err);
    process.exitCode = 1;
});
