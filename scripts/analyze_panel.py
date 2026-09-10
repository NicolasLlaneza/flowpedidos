#!/usr/bin/env python3
"""
analyze_panel.py -- análisis estadístico del panel de evaluación cualitativa (H3, §3.7)

Uso:
    python3 analyze_panel.py panel/

Espera encontrar en el directorio dado:
    corpus_key.csv               (id, origen, status, notif_id)
    scoring_evaluador_1.csv       (id, mensaje, claridad_1a5, tono_1a5, relevancia_1a5, correccion_1a5)
    scoring_evaluador_2.csv
    scoring_evaluador_3.csv

Calcula:
    - ICC(3,k): acuerdo absoluto entre los tres evaluadores (Shrout & Fleiss, 1979),
      sobre el puntaje promedio de los 4 criterios por mensaje.
    - Alfa de Krippendorff (variante intervalo): método complementario de acuerdo.
    - Delta de Cliff + U de Mann-Whitney: comparación LLM vs. plantilla, que es
      literalmente lo que H3 postula.
    - Detalle mensaje por mensaje (promedio de los 3 evaluadores, por origen).
"""

import sys
import csv
import math
from pathlib import Path
from collections import defaultdict

CRITERIA = ['claridad_1a5', 'tono_1a5', 'relevancia_1a5', 'correccion_1a5']


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def load_key(panel_dir):
    rows = read_csv(panel_dir / 'corpus_key.csv')
    return {r['id']: {'origen': r['origen'], 'status': r['status'], 'notif_id': r['notif_id']} for r in rows}


def load_scores(panel_dir, n_evaluators=3):
    """Devuelve dict: id -> [puntaje_promedio_evaluador_1, _2, _3]"""
    per_eval = []
    ids_order = None
    for ev in range(1, n_evaluators + 1):
        path = panel_dir / f'scoring_evaluador_{ev}.csv'
        rows = read_csv(path)
        scores = {}
        for r in rows:
            vals = []
            for c in CRITERIA:
                v = (r.get(c) or '').strip()
                if v == '':
                    raise ValueError(f"scoring_evaluador_{ev}.csv: fila id={r['id']} tiene '{c}' vacío. Completar antes de analizar.")
                vals.append(float(v))
            scores[r['id']] = sum(vals) / len(vals)
        per_eval.append(scores)
        if ids_order is None:
            ids_order = [r['id'] for r in rows]
    return ids_order, per_eval


def icc3k(matrix):
    """
    ICC(3,k): acuerdo absoluto promedio entre k evaluadores fijos (Shrout & Fleiss, 1979).
    matrix: lista de filas (mensajes), cada fila es lista de puntajes por evaluador (columnas).
    """
    n = len(matrix)          # mensajes
    k = len(matrix[0])       # evaluadores
    grand_mean = sum(sum(row) for row in matrix) / (n * k)

    row_means = [sum(row) / k for row in matrix]
    col_means = [sum(matrix[i][j] for i in range(n)) / n for j in range(k)]

    ss_rows = k * sum((rm - grand_mean) ** 2 for rm in row_means)
    ss_cols = n * sum((cm - grand_mean) ** 2 for cm in col_means)
    ss_total = sum((matrix[i][j] - grand_mean) ** 2 for i in range(n) for j in range(k))
    ss_error = ss_total - ss_rows - ss_cols

    ms_rows = ss_rows / (n - 1)
    ms_error = ss_error / ((n - 1) * (k - 1))

    if ms_rows == 0:
        return 0.0
    icc = (ms_rows - ms_error) / ms_rows
    return icc


def krippendorff_alpha_interval(matrix):
    """
    Alfa de Krippendorff, variante de nivel de medida por intervalo,
    para datos completos (sin missing) organizados como unidades x evaluadores.
    """
    n = len(matrix)
    k = len(matrix[0])
    values = [v for row in matrix for v in row]
    mean_all = sum(values) / len(values)

    # Do: desacuerdo observado promedio por par dentro de cada unidad
    do_num = 0.0
    do_den = 0.0
    for row in matrix:
        for i in range(k):
            for j in range(k):
                if i == j:
                    continue
                do_num += (row[i] - row[j]) ** 2
                do_den += 1
    Do = do_num / do_den if do_den else 0.0

    # De: desacuerdo esperado por azar, sobre todos los pares posibles del pool total
    de_num = 0.0
    de_den = 0.0
    for a in values:
        for b in values:
            de_num += (a - b) ** 2
            de_den += 1
    De = de_num / de_den if de_den else 0.0

    if De == 0:
        return 1.0
    return 1 - (Do / De)


def mann_whitney_u(a, b):
    """U de Mann-Whitney con aproximación normal (con corrección por empates)."""
    combined = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    n1, n2 = len(a), len(b)
    n = n1 + n2

    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j < n and combined[j][0] == combined[i][0]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        for m in range(i, j):
            ranks[m] = avg_rank
        i = j

    r1 = sum(ranks[idx] for idx in range(n) if combined[idx][1] == 0)
    u1 = r1 - n1 * (n1 + 1) / 2.0
    u2 = n1 * n2 - u1
    u = min(u1, u2)

    mu = n1 * n2 / 2.0
    tie_groups = []
    i = 0
    while i < n:
        j = i
        while j < n and combined[j][0] == combined[i][0]:
            j += 1
        tie_groups.append(j - i)
        i = j
    tie_correction = sum(t ** 3 - t for t in tie_groups)
    sigma2 = (n1 * n2 / 12.0) * ((n + 1) - tie_correction / (n * (n - 1))) if n > 1 else 0
    sigma = math.sqrt(sigma2) if sigma2 > 0 else 0

    if sigma == 0:
        z = 0.0
    else:
        if u1 > mu:
            z = (u1 - 0.5 - mu) / sigma
        else:
            z = (u1 + 0.5 - mu) / sigma

    p = 2 * (1 - norm_cdf(abs(z)))
    return u1, z, min(p, 1.0)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def cliffs_delta(a, b):
    """Delta de Cliff: (mayores - menores) / (n1*n2), sobre todos los pares (a_i, b_j)."""
    n1, n2 = len(a), len(b)
    more = 0
    less = 0
    for x in a:
        for y in b:
            if x > y:
                more += 1
            elif x < y:
                less += 1
    return (more - less) / (n1 * n2)


def main():
    if len(sys.argv) < 2:
        print('uso: python3 analyze_panel.py <directorio_panel>')
        sys.exit(1)

    panel_dir = Path(sys.argv[1])
    key = load_key(panel_dir)
    ids_order, per_eval = load_scores(panel_dir)

    matrix = [[per_eval[e][mid] for e in range(3)] for mid in ids_order]

    icc = icc3k(matrix)
    alpha = krippendorff_alpha_interval(matrix)

    panel_mean = {mid: sum(per_eval[e][mid] for e in range(3)) / 3 for mid in ids_order}

    llm_scores = [panel_mean[mid] for mid in ids_order if key[mid]['origen'] == 'llm']
    tmpl_scores = [panel_mean[mid] for mid in ids_order if key[mid]['origen'] == 'template']

    delta = cliffs_delta(llm_scores, tmpl_scores)
    u, z, p = mann_whitney_u(llm_scores, tmpl_scores)

    print('=== Acuerdo entre evaluadores ===')
    print(f'ICC(3,k)              : {icc:.3f}')
    print(f'Alfa de Krippendorff   : {alpha:.3f}')
    print()
    print('=== H3: modelo de lenguaje vs. plantilla estática ===')
    print(f'n LLM = {len(llm_scores)}, n plantilla = {len(tmpl_scores)}')
    print(f'Media LLM      : {sum(llm_scores)/len(llm_scores):.3f}')
    print(f'Media plantilla: {sum(tmpl_scores)/len(tmpl_scores):.3f}')
    print(f'Delta de Cliff : {delta:.3f}')
    print(f'U de Mann-Whitney: U={u:.1f}, z={z:.3f}, p={p:.4f}')
    print()
    print('=== Detalle por mensaje ===')
    print(f'{"id":4s} {"origen":9s} {"status":16s} {"e1":>5s} {"e2":>5s} {"e3":>5s} {"prom":>6s}')
    for mid in ids_order:
        e = [per_eval[x][mid] for x in range(3)]
        print(f'{mid:4s} {key[mid]["origen"]:9s} {key[mid]["status"]:16s} '
              f'{e[0]:5.2f} {e[1]:5.2f} {e[2]:5.2f} {panel_mean[mid]:6.2f}')


if __name__ == '__main__':
    main()
