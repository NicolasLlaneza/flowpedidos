#!/usr/bin/env python3
"""
analyze_panel_v2.py -- análisis de la segunda ronda del panel (H3, §3.7).

Diferencias con analyze_panel_gform.py, que cubría la primera ronda:

  * Acepta cualquier número de evaluadores (ya lo hacía) y cualquier tamaño de
    corpus, pero además separa los ítems de calibración (CAL-A, CAL-B) de los
    ítems del corpus, y los excluye del contraste de H3.
  * Agrega el contraste pareado por estado canónico, que el corpus balanceado
    habilita y el proporcional no permitía: para cada estado se compara el
    promedio del brazo del modelo contra el mensaje de plantilla de ese mismo
    estado, con la prueba de Wilcoxon de rangos con signo calculada por
    enumeración exacta (el número de pares es chico y la aproximación normal no
    corresponde).
  * Reporta la dispersión entre evaluadores en los ítems de calibración y en el
    corpus por separado, como control del efecto del anclaje.
  * Identifica evaluadores con desviación sistemática de nivel, que es lo que
    hundió el alfa de Krippendorff en la primera ronda.

Uso:
    python3 analyze_panel_v2.py <respuestas_form.csv> <corpus_key_v2.csv>
"""

import sys
import csv
import math
import re
from collections import defaultdict
from itertools import product
from pathlib import Path

CRITERIOS = ['Claridad', 'Adecuación del tono', 'Relevancia contextual', 'Corrección lingüística']
CAL_IDS = ['CAL-A', 'CAL-B']
# Puntajes de referencia de la ronda de calibración (ver CALIBRACION.md).
CAL_REF = {'CAL-A': [2, 3, 1, 5], 'CAL-B': [5, 5, 5, 5]}


def load_key(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return {r['id']: r for r in csv.DictReader(f)}


def load_responses(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit('El CSV de respuestas está vacío.')

    cols = rows[0].keys()
    msg_ids = sorted({m.group(1) for c in cols for m in [re.search(r'—\s*(M\d{2})\s*$', c)] if m})
    cal_ids = [i for i in CAL_IDS if any(c.strip().endswith(i) for c in cols)]

    evaluadores = []
    for row in rows:
        ident = (row.get('Dirección de correo electrónico') or row.get('Nombre de usuario')
                 or row.get('Marca temporal') or f'evaluador {len(evaluadores) + 1}')
        por_item, por_criterio = {}, {}
        for mid in msg_ids + cal_ids:
            vals = []
            for c in CRITERIOS:
                v = row.get(f'{c} — {mid}')
                if v is None or str(v).strip() == '':
                    raise SystemExit(f'Falta el valor de "{c} — {mid}" para {ident}')
                vals.append(float(v))
            por_item[mid] = sum(vals) / len(vals)
            por_criterio[mid] = vals
        evaluadores.append({'id': ident, 'items': por_item, 'criterios': por_criterio})
    return msg_ids, cal_ids, evaluadores


def _ms(matrix):
    """Cuadrados medios de un ANOVA de dos vías sin replicación (n objetos x k jueces)."""
    n, k = len(matrix), len(matrix[0])
    gm = sum(sum(r) for r in matrix) / (n * k)
    row_m = [sum(r) / k for r in matrix]
    col_m = [sum(matrix[i][j] for i in range(n)) / n for j in range(k)]
    ss_rows = k * sum((m - gm) ** 2 for m in row_m)
    ss_cols = n * sum((m - gm) ** 2 for m in col_m)
    ss_err = sum(sum(r) for r in matrix) * 0  # placeholder, se calcula abajo
    ss_tot = sum((matrix[i][j] - gm) ** 2 for i in range(n) for j in range(k))
    ss_err = ss_tot - ss_rows - ss_cols
    return n, k, ss_rows / (n - 1), ss_cols / (k - 1), ss_err / ((n - 1) * (k - 1))


def icc_familia(matrix):
    """Las cuatro formas de Shrout y Fleiss (1979) que este diseno admite.

    ICC(2,*) -- acuerdo ABSOLUTO: los jueces son una muestra y su sesgo de nivel
                (MSC) cuenta como error. Es lo que promete la seccion 3.7.
    ICC(3,*) -- CONSISTENCIA: los jueces son fijos y su sesgo de nivel se
                descuenta. Es lo que reportaba la ronda 1 (0,533).
    (*,1)    -- fiabilidad de UN evaluador; no depende de k, es la cifra
                comparable entre rondas con distinto tamano de panel.
    (*,k)    -- fiabilidad del promedio del panel; crece con k por
                Spearman-Brown aunque el acuerdo real no mejore.
    """
    n, k, msr, msc, mse = _ms(matrix)
    if msr == 0:
        return dict.fromkeys(('icc2_1', 'icc2_k', 'icc3_1', 'icc3_k'), 0.0)
    icc3_1 = (msr - mse) / (msr + (k - 1) * mse)
    icc3_k = (msr - mse) / msr
    d1 = msr + (k - 1) * mse + k * (msc - mse) / n
    d2 = msr + (msc - mse) / n
    return {
        'icc2_1': (msr - mse) / d1 if d1 else 0.0,
        'icc2_k': (msr - mse) / d2 if d2 else 0.0,
        'icc3_1': icc3_1,
        'icc3_k': icc3_k,
    }



# --- distribucion F en python puro (para los IC de los ICC) ------------------
def _betacf(a, b, x):
    MAXIT, EPS, FPMIN = 300, 3e-14, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    if abs(d) < FPMIN: d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def _betai(a, b, x):
    """Funcion beta incompleta regularizada I_x(a,b)."""
    if x <= 0.0: return 0.0
    if x >= 1.0: return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    bt = math.exp(lbeta + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def f_cdf(f, d1, d2):
    if f <= 0: return 0.0
    return _betai(d1 / 2.0, d2 / 2.0, d1 * f / (d1 * f + d2))


def f_ppf(p, d1, d2):
    """Cuantil de F por biseccion sobre la CDF. Suficiente para dos decimales."""
    lo, hi = 1e-9, 1e9
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if f_cdf(mid, d1, d2) < p:
            lo = mid
        else:
            hi = mid
    return math.sqrt(lo * hi)


def icc_ic(matrix, alpha=0.05):
    """IC del 95 % para las cuatro formas (McGraw y Wong, 1996, tabla 7)."""
    n, k, msr, msc, mse = _ms(matrix)
    a = alpha / 2.0
    fo = msr / mse
    fl = fo / f_ppf(1 - a, n - 1, (n - 1) * (k - 1))
    fu = fo * f_ppf(1 - a, (n - 1) * (k - 1), n - 1)
    ic3_1 = ((fl - 1) / (fl + k - 1), (fu - 1) / (fu + k - 1))
    ic3_k = (1 - 1 / fl, 1 - 1 / fu)

    r = icc_familia(matrix)['icc2_1']
    fj = msc / mse
    num = (k - 1) * (n - 1) * (k * r * fj + n * (1 + (k - 1) * r) - k * r) ** 2
    den = (n - 1) * k ** 2 * r ** 2 * fj ** 2 + (n * (1 + (k - 1) * r) - k * r) ** 2
    v = num / den
    f3u = f_ppf(1 - a, n - 1, v)
    f3l = f_ppf(1 - a, v, n - 1)
    lo = n * (msr - f3u * mse) / (f3u * (k * msc + (k * n - k - n) * mse) + n * msr)
    hi = n * (f3l * msr - mse) / (k * msc + (k * n - k - n) * mse + n * f3l * msr)
    ic2_1 = (lo, hi)
    ic2_k = (k * lo / (1 + (k - 1) * lo), k * hi / (1 + (k - 1) * hi))
    return {'icc2_1': ic2_1, 'icc2_k': ic2_k, 'icc3_1': ic3_1, 'icc3_k': ic3_k}


def _delta2_interval(a, b, _vals):
    return (a - b) ** 2


def _delta2_ordinal_factory(vals):
    """Funcion de diferencia ordinal de Krippendorff.

    delta^2(c,k) = ( suma de n_g para g entre c y k, menos (n_c + n_k)/2 )^2,
    donde n_g es la frecuencia del valor g en TODO el conjunto de datos. Es la
    metrica que corresponde a una escala de 1 a 5 con descriptores por nivel,
    en la que la distancia entre 1 y 2 no es necesariamente la misma que entre
    4 y 5.
    """
    freq = defaultdict(int)
    for v in vals:
        freq[v] += 1
    orden = sorted(freq)

    def delta2(a, b, _vals=None):
        if a == b:
            return 0.0
        lo, hi = (a, b) if a < b else (b, a)
        acum = sum(freq[g] for g in orden if lo <= g <= hi)
        return (acum - (freq[lo] + freq[hi]) / 2.0) ** 2

    return delta2


def krippendorff_alpha(matrix, metrica='interval'):
    """Alfa de Krippendorff para un diseno cruzado sin datos faltantes.

    'matrix' es una lista de unidades; cada unidad es la lista de valores que
    los k observadores le asignaron. La metrica se declara de forma explicita
    porque el coeficiente NO es comparable entre metricas distintas.
    """
    k = len(matrix[0])
    vals = [v for row in matrix for v in row]
    N = len(vals)
    delta2 = _delta2_ordinal_factory(vals) if metrica == 'ordinal' else _delta2_interval

    do = sum(delta2(row[i], row[j], vals)
             for row in matrix for i in range(k) for j in range(k) if i != j)
    Do = do / (len(matrix) * k * (k - 1)) if k > 1 else 0.0

    de = sum(delta2(a, b, vals) for a in vals for b in vals)
    # Denominador N*(N-1): los pares de un valor consigo mismo no son pares.
    De = de / (N * (N - 1)) if N > 1 else 0.0
    return 1.0 if De == 0 else 1 - Do / De


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def mann_whitney_u(a, b):
    comb = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    n1, n2, n = len(a), len(b), len(a) + len(b)
    ranks, i = [0.0] * n, 0
    while i < n:
        j = i
        while j < n and comb[j][0] == comb[i][0]:
            j += 1
        for m in range(i, j):
            ranks[m] = (i + 1 + j) / 2.0
        i = j
    r1 = sum(ranks[i] for i in range(n) if comb[i][1] == 0)
    u1 = r1 - n1 * (n1 + 1) / 2.0
    mu = n1 * n2 / 2.0
    ties, i = [], 0
    while i < n:
        j = i
        while j < n and comb[j][0] == comb[i][0]:
            j += 1
        ties.append(j - i)
        i = j
    corr = sum(t ** 3 - t for t in ties)
    s2 = (n1 * n2 / 12.0) * ((n + 1) - corr / (n * (n - 1))) if n > 1 else 0
    s = math.sqrt(s2) if s2 > 0 else 0
    z = 0.0 if s == 0 else ((u1 - 0.5 - mu) / s if u1 > mu else (u1 + 0.5 - mu) / s)
    return u1, z, min(2 * (1 - norm_cdf(abs(z))), 1.0)



def mann_whitney_exacto(a, b):
    """p exacto a dos colas por enumeracion de todas las asignaciones posibles.

    El plan de analisis pre-registrado exige el p-valor exacto. Con muestras de
    este tamano la aproximacion normal sobreestima el p de forma apreciable: en
    el caso de separacion completa entre ocho y seis observaciones, devuelve
    0,0024 donde el exacto es 0,00067.

    Devuelve (U, p, exacto) donde 'exacto' es False si hay empates entre grupos,
    caso en el que la enumeracion sobre rangos promediados deja de ser valida y
    se informa el p asintotico.
    """
    from itertools import combinations
    n1, n2 = len(a), len(b)
    if set(a) & set(b):
        u, z, p = mann_whitney_u(a, b)
        return u, p, False
    todos = list(a) + list(b)
    n = n1 + n2

    def estadistico(idx):
        ga = [todos[i] for i in idx]
        gb = [todos[i] for i in range(n) if i not in idx]
        return sum(1 for x in ga for y in gb if x > y) + 0.5 * sum(1 for x in ga for y in gb if x == y)

    obs = sum(1 for x in a for y in b if x > y) + 0.5 * sum(1 for x in a for y in b if x == y)
    media = n1 * n2 / 2.0
    extremos = 0
    total = 0
    for idx in combinations(range(n), n1):
        total += 1
        if abs(estadistico(set(idx)) - media) >= abs(obs - media) - 1e-9:
            extremos += 1
    return obs, extremos / total, True


def wilcoxon_exacto(diffs):
    """Wilcoxon de rangos con signo, p exacto por enumeración. Ignora los ceros."""
    d = [x for x in diffs if x != 0]
    n = len(d)
    if n == 0:
        return None, None, 0
    orden = sorted(range(n), key=lambda i: abs(d[i]))
    rangos = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j < n and abs(d[orden[j]]) == abs(d[orden[i]]):
            j += 1
        r = (i + 1 + j) / 2.0
        for m in range(i, j):
            rangos[orden[m]] = r
        i = j
    w_pos = sum(rangos[i] for i in range(n) if d[i] > 0)
    total = sum(rangos)
    obs = min(w_pos, total - w_pos)
    # distribución exacta: todas las asignaciones de signo equiprobables
    cuenta = 0
    for signos in product([0, 1], repeat=n):
        wp = sum(rangos[i] for i in range(n) if signos[i])
        if min(wp, total - wp) <= obs + 1e-9:
            cuenta += 1
    return w_pos, cuenta / (2 ** n), n


def cliffs_delta(a, b):
    mas = sum(1 for x in a for y in b if x > y)
    menos = sum(1 for x in a for y in b if x < y)
    return (mas - menos) / (len(a) * len(b))


def desvio_medio(evaluadores, ids):
    """Desviación media de cada evaluador respecto del promedio del panel."""
    out = {}
    for e in evaluadores:
        difs = [e['items'][i] - sum(o['items'][i] for o in evaluadores) / len(evaluadores) for i in ids]
        out[e['id']] = sum(difs) / len(difs)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--excluir=')]
    excluidos = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--excluir=')]
    if len(args) < 2:
        raise SystemExit('uso: python3 analyze_panel_v2.py <respuestas_form.csv> '
                         '<corpus_key_v2.csv> [--excluir=<identificador>]...')
    key = load_key(Path(args[1]))
    msg_ids, cal_ids, evs = load_responses(Path(args[0]))
    if excluidos:
        antes = len(evs)
        evs = [e for e in evs if not any(x in e['id'] for x in excluidos)]
        print('=== Exclusiones aplicadas por linea de comandos ===')
        for x in excluidos:
            print(f' - {x}')
        print(f'Evaluadores: {antes} -> {len(evs)}\n')
    k = len(evs)
    if k < 2:
        raise SystemExit('Se necesitan al menos dos evaluadores.')

    faltan = [m for m in msg_ids if m not in key]
    if faltan:
        raise SystemExit(f'Estos mensajes del formulario no están en la clave: {faltan}')

    print(f'=== Panel de {k} evaluadores externos ===')
    for e in evs:
        print(' -', e['id'])

    matrix = [[e['items'][m] for e in evs] for m in msg_ids]
    icc = icc_familia(matrix)
    print(f'\n=== Acuerdo entre evaluadores (corpus, n={len(msg_ids)}, k={k}) ===')
    print('Coeficiente de correlacion intraclase (Shrout y Fleiss, 1979):')
    ic = icc_ic(matrix)
    def _f(nombre, etiqueta, nota=''):
        lo, hi = ic[nombre]
        print(f'  {etiqueta:41s}: {icc[nombre]:+.3f}  IC 95 % [{lo:+.3f}; {hi:+.3f}]{nota}')
    _f('icc2_k', f'ICC(2,{k}) acuerdo absoluto, promedio panel', '   <- preespecificado en REGLAS-DECISION.md')
    _f('icc2_1', 'ICC(2,1) acuerdo absoluto, un evaluador')
    _f('icc3_1', 'ICC(3,1) consistencia, un evaluador', '   <- comparable entre rondas, sin importar k')
    _f('icc3_k', f'ICC(3,{k}) consistencia, promedio panel')
    print('  Nota: las formas (*,k) crecen con el tamano del panel por Spearman-Brown.')
    print('        La ronda 1 reporto ICC(3,4) = 0,533, que equivale a ICC(3,1) = 0,222;')
    print('        esa es la cifra contra la cual corresponde comparar ICC(3,1) de arriba.')

    print('\nAlfa de Krippendorff:')
    print('  sobre el promedio de los cuatro criterios (unidad = mensaje)')
    print(f'    metrica de intervalo : {krippendorff_alpha(matrix, "interval"):+.4f}   <- comparable con la ronda 1 (-0,110)')
    print(f'    metrica ordinal      : {krippendorff_alpha(matrix, "ordinal"):+.4f}')
    print('  Aviso: promediar cuatro valoraciones ordinales no produce un dato ordinal.')
    print('         Las cifras de abajo, por criterio y sobre los valores crudos de 1 a 5,')
    print('         son las que corresponden a la escala declarada en la seccion 3.7.')
    print('\n  por criterio, sobre los valores crudos (unidad = mensaje x criterio)')
    print(f'    {"criterio":26s} {"ordinal":>9s} {"intervalo":>11s}')
    for ci, crit in enumerate(CRITERIOS):
        m_c = [[e['criterios'][m][ci] for e in evs] for m in msg_ids]
        print(f'    {crit:26s} {krippendorff_alpha(m_c, "ordinal"):+9.4f} {krippendorff_alpha(m_c, "interval"):+11.4f}')
    todos = [[e['criterios'][m][ci] for e in evs] for m in msg_ids for ci in range(len(CRITERIOS))]
    print(f'    {"TODOS los criterios":26s} {krippendorff_alpha(todos, "ordinal"):+9.4f} {krippendorff_alpha(todos, "interval"):+11.4f}')

    if cal_ids:
        cal_m = [[e['items'][c] for e in evs] for c in cal_ids]
        disp_cal = sum(max(r) - min(r) for r in cal_m) / len(cal_m)
        disp_cor = sum(max(r) - min(r) for r in matrix) / len(matrix)
        print(f'\n=== Efecto del anclaje (control metodológico) ===')
        print(f'Rango medio entre evaluadores en calibración : {disp_cal:.2f}')
        print(f'Rango medio entre evaluadores en el corpus   : {disp_cor:.2f}')
        for c in cal_ids:
            ref = sum(CAL_REF[c]) / 4
            obs = [e['items'][c] for e in evs]
            print(f'  {c}: referencia {ref:.2f} · panel {sum(obs)/k:.2f} (min {min(obs):.2f}, max {max(obs):.2f})')

    desv = desvio_medio(evs, msg_ids)
    print('\n=== Desviación sistemática de nivel por evaluador ===')
    for ident, d in sorted(desv.items(), key=lambda x: x[1]):
        marca = '  <-- desviación mayor a medio punto' if abs(d) > 0.5 else ''
        print(f'  {d:+.2f}  {ident}{marca}')

    panel = {m: sum(e['items'][m] for e in evs) / k for m in msg_ids}
    llm = [panel[m] for m in msg_ids if key[m]['origen'] == 'llm']
    tpl = [panel[m] for m in msg_ids if key[m]['origen'] == 'template']

    print(f'\n=== H3 · contraste global (modelo vs plantilla) ===')
    print(f'n modelo = {len(llm)}, n plantilla = {len(tpl)}')
    print(f'Media modelo   : {sum(llm)/len(llm):.3f}')
    print(f'Media plantilla: {sum(tpl)/len(tpl):.3f}')
    print(f'Delta de Cliff : {cliffs_delta(llm, tpl):.3f}')
    u, z, p_asint = mann_whitney_u(llm, tpl)
    u_e, p_e, es_exacto = mann_whitney_exacto(llm, tpl)
    n_tot = len(llm) + len(tpl)
    if es_exacto:
        print(f'U de Mann-Whitney: U={u:.1f}')
        print(f'  p exacto por enumeracion : {p_e:.6f}   <- el que exige REGLAS-DECISION.md')
        print(f'  p asintotico (referencia): {p_asint:.6f}')
    else:
        print(f'U de Mann-Whitney: U={u:.1f}, z={z:.3f}, p={p_asint:.4f}  (hay empates entre grupos: p asintotico)')
    print(f'Tamano de efecto: delta de Cliff (arriba); r = Z/raiz(N) = {abs(z)/math.sqrt(n_tot):.3f} sobre la '
          f'aproximacion normal, N={n_tot}')

    # --- contraste pareado por estado, habilitado por el corpus balanceado ---
    por_estado = defaultdict(lambda: {'llm': [], 'template': []})
    for m in msg_ids:
        por_estado[key[m]['status']][key[m]['origen']].append(panel[m])
    pares = [(s, sum(v['llm']) / len(v['llm']), sum(v['template']) / len(v['template']))
             for s, v in sorted(por_estado.items()) if v['llm'] and v['template']]

    print(f'\n=== H3 · contraste pareado por estado canónico ===')
    if len(pares) < 2:
        print('No hay suficientes estados con ambos brazos representados; el corpus no está balanceado.')
    else:
        print(f'{"estado":18s} {"modelo":>8s} {"plantilla":>10s} {"dif":>7s}')
        for s, a, b in pares:
            print(f'{s:18s} {a:8.2f} {b:10.2f} {a-b:+7.2f}')
        difs = [a - b for _, a, b in pares]
        w, pw, n_ef = wilcoxon_exacto(difs)
        favor = sum(1 for d in difs if d > 0)
        print(f'\nEstados a favor del modelo: {favor} de {len(difs)}')
        print(f'Wilcoxon de rangos con signo (p exacto, n={n_ef}): W+={w:.1f}, p={pw:.4f}')
        w_tot = n_ef * (n_ef + 1) / 2.0
        print(f'Correlacion biserial de rangos apareada r = (W+ - W-)/(W+ + W-) = '
              f'{(2*w - w_tot)/w_tot:+.3f}')
        if len(difs) <= 5:
            print('  Aviso: con cinco pares o menos, el p mínimo alcanzable no baja de 0,0625;')
            print('  un resultado no significativo no distingue ausencia de efecto de falta de potencia.')

    print('\n=== Detalle por mensaje ===')
    cab = ['id', 'origen', 'estado'] + [f'e{i+1}' for i in range(k)] + ['prom']
    print(' '.join(f'{c:>10s}' for c in cab))
    for m in msg_ids:
        fila = [m, key[m]['origen'], key[m]['status']] + [f"{e['items'][m]:.2f}" for e in evs] + [f'{panel[m]:.2f}']
        print(' '.join(f'{c:>10s}' for c in fila))

    print('\n=== Medias por criterio y origen ===')
    print(f'{"criterio":26s} {"modelo":>8s} {"plantilla":>10s}')
    for ci, crit in enumerate(CRITERIOS):
        a = [sum(e['criterios'][m][ci] for e in evs) / k for m in msg_ids if key[m]['origen'] == 'llm']
        b = [sum(e['criterios'][m][ci] for e in evs) / k for m in msg_ids if key[m]['origen'] == 'template']
        print(f'{crit:26s} {sum(a)/len(a):8.2f} {sum(b)/len(b):10.2f}')


if __name__ == '__main__':
    main()
