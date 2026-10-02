#!/usr/bin/env python3
"""
scripts/aplicar-correcciones-v14.py -- correcciones v1.4 del pipeline (opcion A)

Aplica sobre la copia de trabajo del repositorio las correcciones de los
defectos que la corrida v2 expuso y que la devolucion del tribunal (v23)
senalo. Cada cambio se ancla en un fragmento exacto del codigo actual: si un
ancla no aparece exactamente una vez, el script aborta sin escribir nada.

  C1  Call OpenAI: reintento (3 intentos, 2 s) y salida de error hacia la
      plantilla. Antes, un cierre de conexion detenia el flujo (NA-02).
  C2  Insert Items: la falla de un item ya no detiene la ejecucion; se audita
      con el mensaje de error de la base (NC-05).
  C3  Regla 1 del validador: el identificador cuenta solo como token aislado.
      Antes comparaba por subcadena ("70" dentro de "175/70", NA-01).
  C4  Regla 2 del validador: verifica que el texto cite al menos un atributo
      del pedido y que lo declarado este efectivamente citado (NC-03).
  C5  Reintento tras un rechazo: usa this.helpers.httpRequest; fetch no existe
      en los nodos Code de n8n ("fetch is not defined").
  C6  Plantilla de respaldo: conserva costo, tokens y latencia de la llamada
      rechazada en lugar de sobrescribirlos con cero (NM-08).
  C7  Update dispatch: guarda el cuerpo enviado a Meta (NA-06). Requiere la
      migracion sql/05_dispatched_body.sql. Parametros como arreglo.
  C8  Insert Items: parametros como arreglo. El nodo Postgres (typeVersion
      >= 2.5) parte por comas cada valor de texto de la lista; los titulos
      largos de los pedidos 145, 147 y 149 tienen comas, el nombre se partia
      y la cantidad recibia texto: es la causa de la falla de NC-05.
  Ademas agrega TFI_FORZAR_RECHAZO (vacia) al servicio n8n del compose.

Uso, desde la raiz del repositorio:
    python3 scripts/aplicar-correcciones-v14.py            # aplica
    python3 scripts/aplicar-correcciones-v14.py --check    # solo verifica las anclas
"""
import json, sys, uuid, pathlib

ROOT = pathlib.Path('.')
WF = ROOT / 'n8n-workflows' / 'workflow.json'
LIB = ROOT / 'n8n-workflows' / 'lib'
SQL08 = ROOT / 'n8n-workflows' / 'sql' / '08_update_dispatch.sql'
COMPOSE = ROOT / 'docker-compose.yml'
COMPOSE_ANCLA = '      OPENAI_API_KEY: ${OPENAI_API_KEY}\n'
COMPOSE_EXTRA = ('\n      # v1.4 · solo para la corrida de verificación: external_id (separados por\n'
                 '      # coma) cuyo primer intento se rechaza a propósito para ejercitar el\n'
                 '      # reintento. Vacía en operación normal.\n'
                 '      TFI_FORZAR_RECHAZO: ${TFI_FORZAR_RECHAZO:-}\n')
CHECK = '--check' in sys.argv
errores = []


def escribir(ruta, texto, referencia=None):
    # Respeta el fin de línea y el salto final del archivo original (o de
    # referencia) para que el diff muestre solo los cambios reales.
    ref = referencia if referencia is not None else ruta
    crlf, final = False, True
    if ref.exists():
        raw = ref.read_bytes()
        crlf = b'\r\n' in raw
        final = raw.endswith(b'\n')
    texto = texto.rstrip('\n') + ('\n' if final else '')
    if crlf:
        texto = texto.replace('\n', '\r\n')
    ruta.write_bytes(texto.encode('utf-8'))


def rep(texto, viejo, nuevo, donde, veces=1):
    n = texto.count(viejo)
    if n != veces:
        errores.append(f'{donde}: se esperaban {veces} apariciones de «{viejo[:60]}», hay {n}')
        return texto
    return texto.replace(viejo, nuevo)


# --- C3, C4, C5 · rehydrate-validate.js ------------------------------------
HELPERS = r'''// --- v1.4 · helpers de las reglas 1 y 2 -------------------------------------
// Regla 1: un identificador cuenta solo como token aislado. La version
// evaluada comparaba por subcadena y un identificador de dos cifras coincidia
// con la medida de un producto ("70" dentro de "175/70"): el unico rechazo de
// la corrida v2 (pedido WC-16) fue ese falso positivo.
function escRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function contieneComoToken(msg, id) {
    const rx = new RegExp('(?<![\\p{L}\\p{N}/]|\\p{N}[.,])' + escRx(id) + '(?![\\p{L}\\p{N}/]|[.,]\\p{N})', 'u');
    return rx.test(msg);
}

// Regla 2: anclaje verificable. Los criterios son los de
// scripts/analizar-anclaje.py (indicador de la seccion 3.3), de modo que la
// compuerta y el indicador miden lo mismo.
const ANCLABLES = ['primary_product_name', 'total_amount', 'items_count', 'source_created_at'];
const GENERICOS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'con', 'para', 'por',
    'neumatico', 'neumaticos', 'cubierta', 'cubiertas']);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMEROS = { 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez' };
function normTxt(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }
function citaProducto(m, nombre) {
    const toks = normTxt(nombre).split(/[^\p{L}\p{N}_/]+/u).filter(t => t.length >= 3 && !GENERICOS.has(t));
    if (!toks.length) return false;
    const hits = toks.filter(t => m.includes(t)).length;
    return hits >= Math.min(2, toks.length);
}
function citaMonto(msg, total) {
    const entero = Math.trunc(Number(total));
    if (!entero) return false;
    const obj = String(entero);
    return (String(msg).match(/[\d.,]{2,}/g) || []).some(b => {
        const d = b.replace(/\D/g, '');
        return d && (d === obj || d.startsWith(obj) || obj.startsWith(d)) && d.length >= Math.max(3, obj.length - 2);
    });
}
function citaConteo(m, n) {
    const k = Number(n);
    if (!(k > 1) || !NUMEROS[k]) return false;
    return new RegExp('\\b(' + k + '|' + NUMEROS[k] + ')\\b').test(m);
}
function citaFecha(m, iso) {
    const f = /(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!f) return false;
    const mes = Number(f[2]), dia = Number(f[3]);
    return new RegExp('\\b' + dia + '\\b[^\\d]{0,12}(' + MESES[mes - 1] + '|0?' + mes + ')\\b').test(m)
        || (new RegExp('\\b' + MESES[mes - 1] + '\\b').test(m) && new RegExp('\\b' + dia + '\\b').test(m));
}
function atributosCitados(msg, ctx) {
    const m = normTxt(msg), out = [];
    if (ctx.primary_product_name && citaProducto(m, ctx.primary_product_name)) out.push('primary_product_name');
    if (ctx.total_amount != null && citaMonto(msg, ctx.total_amount)) out.push('total_amount');
    if (ctx.items_count != null && citaConteo(m, ctx.items_count)) out.push('items_count');
    if (ctx.source_created_at && citaFecha(m, ctx.source_created_at)) out.push('source_created_at');
    return out;
}

'''

REGLA2_EXTRA = r'''
    // Regla 2 (v1.4) — anclaje verificable: el texto debe citar al menos un
    // atributo del pedido, y todo atributo anclable que el modelo declare
    // haber citado tiene que aparecer efectivamente en el texto.
    const ctx = contexto || {};
    const citados = atributosCitados(msg, ctx);
    if (!citados.length) {
        failures.push({ regla: 'anclaje_verificable', detalle: 'el texto no cita ningún atributo del pedido' });
    }
    const noCitados = (atributosUsados || []).filter(a => ANCLABLES.includes(a) && !citados.includes(a));
    if (noCitados.length) {
        failures.push({ regla: 'atributos_declarados_citados', detalle: `declarados y no citados: ${noCitados.join(',')}` });
    }
'''

FETCH_VIEJO = '''    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`retry openai ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);'''

FETCH_NUEVO = '''    // v1.4: los nodos Code de n8n no exponen fetch; la version evaluada fallaba
    // con "fetch is not defined" y degradaba sin reintentar. Se usa el cliente
    // HTTP del propio n8n (this.helpers.httpRequest), que lanza ante no-2xx.
    const url = 'https://api.openai.com/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    let data;
    if (typeof http === 'function') {
        data = await http({ method: 'POST', url, headers, body, json: true, timeout: 20000 });
    } else if (typeof fetch === 'function') {
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        data = await resp.json();
        if (!resp.ok) throw new Error(`retry openai ${resp.status}: ${JSON.stringify(data).slice(0,200)}`);
    } else {
        throw new Error('no hay cliente HTTP disponible en el nodo');
    }'''

MAIN_VIEJO = "const fullName = canonical.customer.full_name;\n"
MAIN_NUEVO = """const fullName = canonical.customer.full_name;

// v1.4: contexto que recibió el modelo (para la regla 2) y cliente HTTP de n8n
// (para el reintento). Ambos se capturan acá porque `this` no llega a las
// funciones auxiliares.
const sentContext = ($('Build LLM prompt').item.json.sent_context) || {};
const http = (this && this.helpers && typeof this.helpers.httpRequest === 'function')
    ? this.helpers.httpRequest.bind(this.helpers) : null;
"""

FORZAR_ANCLA = "let failures = runValidator(rehydrated, attemptAtributos, canonical, sentContext);\n"
FORZAR = FORZAR_ANCLA + """
// Instrumentación de la corrida de verificación: fuerza un rechazo en el
// primer intento para los external_id listados en la variable de entorno
// TFI_FORZAR_RECHAZO, para ejercitar el reintento de forma controlada.
// En operación la variable no existe y este bloque no hace nada.
let forzar = [];
try { forzar = String(($env && $env.TFI_FORZAR_RECHAZO) || '').split(',').map(s => s.trim()).filter(Boolean); } catch (e) { forzar = []; }
if (forzar.includes(String(canonical.order.external_id))) {
    failures.push({ regla: 'prueba_forzada', detalle: 'rechazo inducido por TFI_FORZAR_RECHAZO' });
}
"""

CABECERA_ANCLA = "// rehydrate-validate.js  (B3 · TFI corregido §4.3.1)\n"
CABECERA = CABECERA_ANCLA + """// v1.4 (corrida de verificación): regla 1 por token aislado, regla 2 con
// verificación de anclaje en el texto, y reintento con el cliente HTTP de n8n.
"""


def corregir_validador(t, donde):
    t = rep(t, CABECERA_ANCLA, CABECERA, donde)
    t = rep(t, '// --- Las siete reglas del validador -----------------------------------------\n',
            HELPERS + '// --- Las siete reglas del validador -----------------------------------------\n', donde)
    t = rep(t, 'function runValidator(rehydratedMsg, atributosUsados, canonical) {',
            'function runValidator(rehydratedMsg, atributosUsados, canonical, contexto) {', donde)
    t = rep(t, '        if (msg.includes(id)) {', '        if (contieneComoToken(msg, id)) {', donde)
    fin_r2 = "        failures.push({ regla: 'atributos_declarados_valen', detalle: `no válidos: ${undeclared.join(',')}` });\n    }\n"
    t = rep(t, fin_r2, fin_r2 + REGLA2_EXTRA, donde)
    t = rep(t, 'async function retryLLM(messages) {', 'async function retryLLM(messages, http) {', donde)
    t = rep(t, FETCH_VIEJO, FETCH_NUEVO, donde)
    t = rep(t, MAIN_VIEJO, MAIN_NUEVO, donde)
    t = rep(t, 'runValidator(rehydrated, attemptAtributos, canonical)',
            'runValidator(rehydrated, attemptAtributos, canonical, sentContext)', donde, veces=2)
    t = rep(t, FORZAR_ANCLA, FORZAR, donde)
    t = rep(t, 'retry = await retryLLM(messagesRetry);', 'retry = await retryLLM(messagesRetry, http);', donde)
    return t


# --- C6 · fallback-template.js ---------------------------------------------
FB_VIEJO = """        // Sin tokens ni costo porque no fue llamada externa
        usage: { prompt_tokens: null, completion_tokens: null },
        cost_usd: 0,
        latency_ms: 0,
"""
FB_NUEVO = """        // v1.4 (NM-08): se conservan los tokens, el costo y la latencia de las
        // llamadas al modelo hechas antes de degradar. La versión evaluada los
        // sobrescribía con cero, y el costo de la llamada rechazada se perdía.
        usage: { prompt_tokens: null, completion_tokens: null },
        prompt_tokens: ((input.prompt_tokens || 0) + (input.extra_prompt_tokens || 0)) || null,
        completion_tokens: ((input.completion_tokens || 0) + (input.extra_completion_tokens || 0)) || null,
        cost_usd: Number(((input.cost_usd || 0) + (input.extra_cost_usd || 0)).toFixed(6)),
        latency_ms: input.latency_ms || 0,
"""


def corregir_fallback(t, donde):
    return rep(t, FB_VIEJO, FB_NUEVO, donde)


# --- C7 · Update dispatch --------------------------------------------------
UPD_QUERY = """UPDATE tfi.ai_notifications
SET
    message_status  = $2,
    sent_at         = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
    dispatched_at   = CASE WHEN $2 = 'sent' THEN now() ELSE dispatched_at END,
    wa_message_id   = NULLIF($3::text, 'null'),
    error_message   = NULLIF($4::text, 'null'),
    dispatched_body = COALESCE(NULLIF($5::text, 'null'), dispatched_body)
WHERE id = NULLIF($1::text, 'null')::uuid
RETURNING id, message_status, sent_at, dispatched_at, wa_message_id;"""
UPD_REPL = ("={{ [$('Insert ai_notification').item.json.notification_id, $json.message_status || 'sent', "
            "$json.wa_message_id || null, $json.error_reason || null, "
            "$('Build WA payload').item.json.meta_body ? $('Build WA payload').item.json.meta_body.text.body : null] }}")

SQL08_NUEVO = """-- =============================================================================
-- 08_update_dispatch.sql  (v1.4)
-- -----------------------------------------------------------------------------
-- Nodo "Update dispatch" (Postgres, Execute Query), después del envío a Meta
-- o de su simulación. Cierra el ciclo de la notificación y, desde v1.4,
-- guarda el cuerpo exacto que se envió (dispatched_body), de modo que el
-- mensaje despachado queda acreditado y no solo el texto generado (NA-06).
-- Requiere sql/05_dispatched_body.sql.
-- =============================================================================

""" + UPD_QUERY + """

-- Parámetros (arreglo, para que las comas del cuerpo no partan los valores):
--   $1 = id de la notificación (Insert ai_notification)
--   $2 = 'sent' | 'failed'
--   $3 = wamid devuelto por Meta, o null
--   $4 = motivo del error, o null
--   $5 = meta_body.text.body armado por Build WA payload
"""

MIG05 = """-- =============================================================================
-- TFI — Migración v1.4.0: cuerpo del mensaje despachado
-- -----------------------------------------------------------------------------
-- Guarda en ai_notifications el cuerpo exacto que se envió a la API de
-- WhatsApp. La versión evaluada solo conservaba el texto generado, y el cuerpo
-- se armaba después (Build WA payload), de modo que no era posible acreditar
-- qué recibió el destinatario (hallazgo NA-06 de la devolución).
--
-- Cómo aplicar:
--   docker compose exec -T postgres psql -U n8n -d tfi -v ON_ERROR_STOP=1 < sql/05_dispatched_body.sql
-- =============================================================================

SET search_path TO tfi, public;

ALTER TABLE tfi.ai_notifications
    ADD COLUMN IF NOT EXISTS dispatched_body text;

COMMENT ON COLUMN tfi.ai_notifications.dispatched_body
    IS 'Cuerpo exacto enviado a la API de mensajería (incluye el saludo rehidratado)';

INSERT INTO tfi.schema_version (version, description)
VALUES ('v1.4.0', 'ai_notifications.dispatched_body: cuerpo despachado')
ON CONFLICT DO NOTHING;
"""

LLM_NO_DISP = """// v1.4 (NA-02): salida de error de Call OpenAI. Tras agotar los reintentos,
// el pedido deriva a la plantilla en lugar de quedar sin notificación.
const bp = $('Build LLM prompt').item.json;
const err = $json.error || $json;
const detalle = String((err && (err.message || err.description)) || 'sin detalle').slice(0, 200);
return {
    json: {
        order_id: bp.order_id,
        customer_id: bp.customer_id,
        use_fallback: true,
        fallback_reason: 'llm_unavailable',
        validator_passes: 0,
        validator_failures: [{ intento: 0, error: 'llm_unavailable: ' + detalle }],
    },
};
"""

AUDIT_ITEMS_REPL = ("={{ [$('Insert Order').item.json.order_id, 'items_insert_failed', 'error', 'persister', "
                    "'Fallo la insercion de un item del pedido', JSON.stringify({external_id: $('Route to canonical').item.json.order.external_id, "
                    "status: $('Route to canonical').item.json.order.status, error: String(($json.error && ($json.error.message || $json.error)) || 'sin detalle').slice(0, 300)}), null, 0] }}")

INS_ITEMS_VIEJO = ("={{ $('Insert Order').item.json.order_id }}, {{ $json.sku }}, {{ $json.product_name }}, "
                   "{{ $json.quantity }}, {{ $json.unit_price }}, {{ $json.delivery_status }}, "
                   "{{ JSON.stringify($json.metadata || {}) }}")
INS_ITEMS_NUEVO = ("={{ [$('Insert Order').item.json.order_id, $json.sku, $json.product_name, $json.quantity, "
                   "$json.unit_price, $json.delivery_status, JSON.stringify($json.metadata || {})] }}")


def main():
    wf = json.loads(WF.read_text(encoding='utf-8'))
    nodos = {n['name']: n for n in wf['nodes']}
    for req in ['Rehydrate + validate', 'Fallback template', 'Call OpenAI', 'Insert Items',
                'Update dispatch', 'Build WA payload', 'Audit error state']:
        if req not in nodos:
            errores.append(f'workflow.json: falta el nodo «{req}»')
    for nuevo in ['LLM no disponible', 'Audit items_failed']:
        if nuevo in nodos:
            errores.append(f'workflow.json: el nodo «{nuevo}» ya existe (¿correcciones ya aplicadas?)')
    for previo in sorted((ROOT / 'sql').glob('05_*.sql')):
        errores.append(f'sql/{previo.name} ya existe: revisar la numeración antes de agregar 05_dispatched_body.sql')
    if not SQL08.exists():
        errores.append('falta n8n-workflows/sql/08_update_dispatch.sql')
    compose = None
    if COMPOSE.exists():
        txt = COMPOSE.read_text(encoding='utf-8')
        if 'TFI_FORZAR_RECHAZO' not in txt:
            if txt.count(COMPOSE_ANCLA) != 1:
                errores.append('docker-compose.yml: la línea de OPENAI_API_KEY no aparece exactamente una vez')
            else:
                compose = txt.replace(COMPOSE_ANCLA, COMPOSE_ANCLA + COMPOSE_EXTRA)
    if errores:
        return fin(None)

    val_lib = corregir_validador((LIB / 'rehydrate-validate.js').read_text(encoding='utf-8'), 'lib/rehydrate-validate.js')
    val_nod = corregir_validador(nodos['Rehydrate + validate']['parameters']['jsCode'], 'nodo Rehydrate + validate')
    fb_lib = corregir_fallback((LIB / 'fallback-template.js').read_text(encoding='utf-8'), 'lib/fallback-template.js')
    fb_nod = corregir_fallback(nodos['Fallback template']['parameters']['jsCode'], 'nodo Fallback template')

    if errores:
        return fin(None)

    nodos['Rehydrate + validate']['parameters']['jsCode'] = val_nod
    nodos['Fallback template']['parameters']['jsCode'] = fb_nod

    # C1
    co = nodos['Call OpenAI']
    co.update({'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 2000, 'onError': 'continueErrorOutput'})
    x, y = co['position']
    wf['nodes'].append({'parameters': {'jsCode': LLM_NO_DISP}, 'id': str(uuid.uuid4()), 'name': 'LLM no disponible',
                        'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x + 208, y + 208]})
    con = wf['connections']
    main_co = con.setdefault('Call OpenAI', {}).setdefault('main', [[]])
    while len(main_co) < 2:
        main_co.append([])
    main_co[1] = [{'node': 'LLM no disponible', 'type': 'main', 'index': 0}]
    con['LLM no disponible'] = {'main': [[{'node': 'Fallback template', 'type': 'main', 'index': 0}]]}

    # C2
    ii = nodos['Insert Items']
    ii['onError'] = 'continueErrorOutput'
    aes = nodos['Audit error state']
    x, y = ii['position']
    nuevo = {'parameters': {'operation': 'executeQuery', 'query': aes['parameters']['query'],
                            'options': {'queryReplacement': AUDIT_ITEMS_REPL}},
             'id': str(uuid.uuid4()), 'name': 'Audit items_failed', 'type': aes['type'],
             'typeVersion': aes['typeVersion'], 'position': [x + 208, y + 160]}
    if ii.get('credentials'):
        nuevo['credentials'] = ii['credentials']
    wf['nodes'].append(nuevo)
    main_ii = con.setdefault('Insert Items', {}).setdefault('main', [[]])
    while len(main_ii) < 2:
        main_ii.append([])
    main_ii[1] = [{'node': 'Audit items_failed', 'type': 'main', 'index': 0}]

    # C8 (misma causa que C7): la lista de parámetros de Insert Items es texto
    # separado por comas, y un nombre de producto con coma corre los valores.
    iio = ii['parameters'].setdefault('options', {})
    if iio.get('queryReplacement', '').strip() != INS_ITEMS_VIEJO:
        errores.append('Insert Items: queryReplacement distinto del esperado')
        return fin(None)
    iio['queryReplacement'] = INS_ITEMS_NUEVO

    # C7
    ud = nodos['Update dispatch']['parameters']
    ud['query'] = UPD_QUERY
    ud.setdefault('options', {})['queryReplacement'] = UPD_REPL

    return fin({'wf': wf, 'val_lib': val_lib, 'fb_lib': fb_lib, 'compose': compose})


def fin(res):
    if errores:
        print('NO SE APLICÓ NINGÚN CAMBIO. Anclas que no coinciden:')
        for e in errores:
            print('  -', e)
        sys.exit(1)
    if CHECK:
        print('Todas las anclas coinciden: las correcciones se pueden aplicar.')
        return
    escribir(WF, json.dumps(res['wf'], ensure_ascii=False, indent=2))
    escribir(LIB / 'rehydrate-validate.js', res['val_lib'])
    escribir(LIB / 'fallback-template.js', res['fb_lib'])
    escribir(SQL08, SQL08_NUEVO)
    escribir(ROOT / 'sql' / '05_dispatched_body.sql', MIG05, referencia=ROOT / 'sql' / '04_instrumentation.sql')
    if res['compose']:
        escribir(COMPOSE, res['compose'])
        print('docker-compose.yml: se agregó TFI_FORZAR_RECHAZO al servicio n8n (vacía por defecto)')
    print('Correcciones v1.4 aplicadas:')
    for l in ['C1 Call OpenAI: reintento + salida de error a la plantilla (nodo «LLM no disponible»)',
              'C2 Insert Items: salida de error auditada (nodo «Audit items_failed»)',
              'C3 regla 1 por token aislado', 'C4 regla 2 con verificación de anclaje',
              'C5 reintento con this.helpers.httpRequest', 'C6 plantilla conserva costo y latencia',
              'C7 Update dispatch guarda el cuerpo despachado (+ sql/05_dispatched_body.sql)',
              'C8 Insert Items: parámetros como arreglo (un nombre con coma ya no corre los valores)']:
        print('  ' + l)


if __name__ == '__main__':
    main()
