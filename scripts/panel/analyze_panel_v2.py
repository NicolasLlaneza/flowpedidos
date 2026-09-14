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


def icc3k(matrix):
    """ICC(3,k): acuerdo absoluto promedio entre k evaluadores fijos (Shrout y Fleiss, 1979)."""
    n, k = len(matrix), len(matrix[0])
    gm = sum(sum(r) for r in matrix) / (n * k)
    row_m = [sum(r) / k for r in matrix]
    col_m = [sum(matrix[i][j] for i in range(n)) / n for j in range(k)]
    ss_rows = k * sum((m - gm) ** 2 for m in row_m)
    ss_cols = n * sum((m - gm) ** 2 for m in col_m)
    ss_tot = sum((matrix[i][j] - gm) ** 2 for i in range(n) for j in range(k))
    ss_err = ss_tot - ss_rows - ss_cols
    ms_rows = ss_rows / (n - 1)
    ms_err = ss_err / ((n - 1) * (k - 1))
    return 0.0 if ms_rows == 0 else (ms_rows - ms_err) / ms_rows


def krippendorff_alpha_interval(matrix):
    k = len(matrix[0])
    vals = [v for row in matrix for v in row]
    do_n = do_d = 0.0
    for row in matrix:
        for i in range(k):
            for j in range(k):
                if i != j:
                    do_n += (row[i] - row[j]) ** 2
                    do_d += 1
    de_n = sum((a - b) ** 2 for a in vals for b in vals)
    de_d = len(vals) ** 2
    Do = do_n / do_d if do_d else 0.0
    De = de_n / de_d if de_d else 0.0
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
    if len(sys.argv) < 3:
        raise SystemExit('uso: python3 analyze_panel_v2.py <respuestas_form.csv> <corpus_key_v2.csv>')
    key = load_key(Path(sys.argv[2]))
    msg_ids, cal_ids, evs = load_responses(Path(sys.argv[1]))
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
    print(f'\n=== Acuerdo entre evaluadores (corpus, n={len(msg_ids)}) ===')
    print(f'ICC(3,{k})            : {icc3k(matrix):.3f}')
    print(f'Alfa de Krippendorff : {krippendorff_alpha_interval(matrix):.3f}')

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
    u, z, p = mann_whitney_u(llm, tpl)
    print(f'U de Mann-Whitney: U={u:.1f}, z={z:.3f}, p={p:.4f}')

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
