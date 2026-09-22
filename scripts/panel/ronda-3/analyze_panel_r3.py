#!/usr/bin/env python3
"""
analyze_panel_r3.py -- analisis de la TERCERA ronda del panel (H3).

Aplica, sin cambios, el plan fijado en REGLAS-DECISION-R3.md. Reutiliza las
funciones estadisticas de ../analyze_panel_v2.py (ICC con IC, alfa de
Krippendorff, Mann-Whitney y Wilcoxon exactos, delta de Cliff) y agrega:

  * el analisis del item de conjetura de origen (verificacion del
    enmascaramiento que el tribunal pidio en NC-02);
  * el veredicto sobre H3 segun la regla pre-especificada;
  * dos analisis de sensibilidad: sin evaluadores que identificaron el origen
    y sin evaluadores con participacion previa;
  * la opcion --publicar, que escribe una copia de las respuestas con los
    correos reemplazados por E1..En (el mapa va aparte y no se versiona).

Uso:
    python analyze_panel_r3.py respuestas-r3.csv corpus_key_r3.csv
    python analyze_panel_r3.py respuestas-r3.csv corpus_key_r3.csv \
        --publicar ../../../out/panel/respuestas-ronda-3.csv --mapa mapa-evaluadores-r3.csv
    python analyze_panel_r3.py ... --excluir=<fragmento-del-correo>
"""
import csv
import importlib.util
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('v2', AQUI.parent / 'analyze_panel_v2.py')
v2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v2)

CRITERIOS = v2.CRITERIOS
ID_COLS = ('Dirección de correo electrónico', 'Nombre de usuario', 'Email Address')
CORRECTA = {'llm': 'inteligencia artificial', 'template': 'plantilla'}
UMBRAL_IDENT = 0.5          # REGLAS-DECISION-R3.md, punto 3.4
P0_AZAR = 1 / 3             # tres respuestas sustantivas posibles
ALFA = 0.05


def ident(row, i):
    for c in ID_COLS:
        if row.get(c):
            return row[c].strip()
    return f'evaluador {i + 1}'


def cargar(path, excluir):
    with open(path, encoding='utf-8-sig', newline='') as f:
        filas = list(csv.DictReader(f))
    if not filas:
        raise SystemExit('El CSV de respuestas esta vacio.')
    cols = filas[0].keys()
    ids = sorted({m.group(1) for c in cols for m in [re.search(r'—\s*(R\d{2})\s*$', c)] if m})
    evs = []
    for i, row in enumerate(filas):
        quien = ident(row, i)
        if any(x in quien for x in excluir):
            continue
        items, crit, origen = {}, {}, {}
        for mid in ids + ['CAL-A', 'CAL-B']:
            vals = [row.get(f'{c} — {mid}') for c in CRITERIOS]
            if any(v in (None, '') for v in vals):
                if mid.startswith('CAL'):
                    continue
                raise SystemExit(f'Respuesta incompleta de {quien} en {mid}')
            vals = [float(v) for v in vals]
            crit[mid], items[mid] = vals, sum(vals) / 4
        for mid in ids:
            origen[mid] = (row.get(f'Origen — {mid}') or '').strip()
        previa = (row.get('Participación previa') or '').strip().lower().startswith('s')
        evs.append({'id': quien, 'items': items, 'criterios': crit, 'origen': origen, 'previa': previa, 'fila': row})
    return ids, evs


def binom_cola_sup(k, n, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def contraste(ids, key, evs, titulo):
    k = len(evs)
    panel = {m: sum(e['items'][m] for e in evs) / k for m in ids}
    llm = [panel[m] for m in ids if key[m]['origen'] == 'llm']
    tpl = [panel[m] for m in ids if key[m]['origen'] == 'template']
    u, p, exacto = v2.mann_whitney_exacto(llm, tpl)
    d = v2.cliffs_delta(llm, tpl)
    print(f'\n=== {titulo} (k={k}) ===')
    print(f'Media modelo {sum(llm)/len(llm):.3f} · plantilla {sum(tpl)/len(tpl):.3f}')
    print(f'Mann-Whitney U={u:.1f}, p {"exacto" if exacto else "asintotico"} = {p:.6f} · delta de Cliff {d:+.3f}')
    return panel, p, d


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=', 1) if '=' in a else (a[2:], '') for a in sys.argv[1:] if a.startswith('--'))
    excluir = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--excluir=')]
    if len(args) < 2:
        raise SystemExit(__doc__)
    # --publicar y --mapa llevan el valor en el argumento siguiente
    argv = sys.argv[1:]
    def valor(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None
    publicar, mapa = valor('--publicar'), valor('--mapa')
    args = [a for a in args if a not in (publicar, mapa)]

    key = v2.load_key(Path(args[1]))
    ids, evs = cargar(Path(args[0]), excluir)
    k = len(evs)
    print(f'=== Ronda 3 · N_final = {k} evaluadores ===')
    if k < 3:
        print('N_final < 3: la ronda se declara fallida (REGLAS-DECISION-R3.md, punto 2).')
        return
    estado = 'PRINCIPAL' if k >= 6 else 'COMPLEMENTARIA (sin inferencia)'
    print(f'Estado de la ronda segun la regla 2: {estado}')
    faltan = [m for m in ids if m not in key]
    if faltan:
        raise SystemExit(f'Mensajes sin clave: {faltan}')

    # --- acuerdo ------------------------------------------------------------
    matrix = [[e['items'][m] for e in evs] for m in ids]
    icc, ic = v2.icc_familia(matrix), v2.icc_ic(matrix)
    print('\n=== Acuerdo entre evaluadores ===')
    for n, et in (('icc2_k', f'ICC(2,{k}) acuerdo absoluto, promedio  <- principal'),
                  ('icc2_1', 'ICC(2,1) acuerdo absoluto, individual'),
                  ('icc3_1', 'ICC(3,1) consistencia, individual (comparable con R1 y R2)')):
        print(f'  {et:58s} {icc[n]:+.3f} [{ic[n][0]:+.3f}; {ic[n][1]:+.3f}]')
    todos = [[e['criterios'][m][c] for e in evs] for m in ids for c in range(4)]
    print(f'  alfa de Krippendorff ordinal, valores crudos: {v2.krippendorff_alpha(todos, "ordinal"):+.3f}')

    # --- contraste principal ------------------------------------------------
    panel, p, d = contraste(ids, key, evs, 'H3 · contraste principal, todos los evaluadores')
    por_estado = defaultdict(lambda: {'llm': [], 'template': []})
    for m in ids:
        por_estado[key[m]['status']][key[m]['origen']].append(panel[m])
    difs = [sum(x['llm']) / len(x['llm']) - sum(x['template']) / len(x['template'])
            for x in por_estado.values() if x['llm'] and x['template']]
    w, pw, n_ef = v2.wilcoxon_exacto(difs)
    print(f'Wilcoxon pareado por estado: {sum(1 for x in difs if x > 0)} de {len(difs)} a favor del modelo, '
          f'W+={w:.1f}, p exacto={pw:.4f}')
    print('\nPor criterio (media modelo / plantilla / delta de Cliff):')
    for c, nom in enumerate(CRITERIOS):
        a = [sum(e['criterios'][m][c] for e in evs) / k for m in ids if key[m]['origen'] == 'llm']
        b = [sum(e['criterios'][m][c] for e in evs) / k for m in ids if key[m]['origen'] == 'template']
        print(f'  {nom:26s} {sum(a)/len(a):.2f} / {sum(b)/len(b):.2f} / {v2.cliffs_delta(a, b):+.3f}')

    # --- enmascaramiento ----------------------------------------------------
    print('\n=== Conjetura de origen (verificacion del enmascaramiento) ===')
    tot = defaultdict(lambda: [0, 0, 0])      # brazo -> [aciertos, comprometidas, no_se]
    acierto_ev = {}
    for e in evs:
        a = n = 0
        for m in ids:
            r = e['origen'][m].lower()
            brazo = key[m]['origen']
            if not r or r.startswith('no s'):
                tot[brazo][2] += 1
                continue
            ok = CORRECTA[brazo] in r
            tot[brazo][0] += ok; tot[brazo][1] += 1
            a += ok; n += 1
        acierto_ev[e['id']] = a / n if n else 0.0
    A = sum(v[0] for v in tot.values()); N = sum(v[1] for v in tot.values())
    for b, (ac, nn, ns) in tot.items():
        print(f'  brazo {b:8s}: {ac}/{nn} aciertos entre respuestas comprometidas '
              f'({100*ac/nn if nn else 0:.1f} %), {ns} «No sé»')
    tasa = A / N if N else 0.0
    pb = binom_cola_sup(A, N, P0_AZAR) if N else 1.0
    comprometido = tasa > UMBRAL_IDENT and pb < ALFA
    print(f'  global: {A}/{N} = {100*tasa:.1f} % · binomial exacta contra 1/3, cola superior: p = {pb:.4g}')
    print(f'  Enmascaramiento: {"COMPROMETIDO (el origen es identificable)" if comprometido else "SOSTENIDO"}')

    # --- veredicto ----------------------------------------------------------
    print('\n=== Veredicto sobre H3 (regla 3.5 de REGLAS-DECISION-R3.md) ===')
    if k < 6:
        print('Ronda complementaria: se reporta sin juicio de contrastacion.')
    elif p < ALFA and d > 0 and not comprometido:
        print('VALIDADA: diferencia significativa a favor del modelo con el origen enmascarado.')
    elif p < ALFA and d > 0:
        print('COMPATIBLE: diferencia significativa, pero el origen fue identificable; ver sensibilidad 1.')
    else:
        print('NO SOSTENIDA: la diferencia no alcanza significacion con el corpus enmascarado.')

    # --- sensibilidad -------------------------------------------------------
    ciegos = [e for e in evs if acierto_ev[e['id']] <= UMBRAL_IDENT]
    if len(ciegos) >= 3:
        contraste(ids, key, ciegos, f'Sensibilidad 1 · solo evaluadores con acierto <= {UMBRAL_IDENT:.0%}')
    else:
        print(f'\nSensibilidad 1: solo {len(ciegos)} evaluadores con acierto <= {UMBRAL_IDENT:.0%}; no se calcula.')
    nuevos = [e for e in evs if not e['previa']]
    if len(nuevos) != len(evs) and len(nuevos) >= 3:
        contraste(ids, key, nuevos, 'Sensibilidad 2 · sin evaluadores con participacion previa')
    print(f'\nParticipacion previa declarada: {sum(e["previa"] for e in evs)} de {k}')

    print('\n=== Detalle por evaluador (seudonimo, acierto de origen, desvio de nivel) ===')
    desv = v2.desvio_medio(evs, ids)
    for i, e in enumerate(evs):
        print(f'  E{i+1:<3d} acierto {100*acierto_ev[e["id"]]:5.1f} %  desvio {desv[e["id"]]:+.2f}'
              f'{"  (participacion previa)" if e["previa"] else ""}')

    if publicar:
        filas = [e['fila'] for e in evs]
        cols = [c for c in filas[0].keys() if c not in ID_COLS]
        with open(publicar, 'w', encoding='utf-8', newline='') as f:
            w_ = csv.writer(f)
            w_.writerow(['Evaluador'] + cols)
            for i, r in enumerate(filas):
                w_.writerow([f'E{i+1}'] + [r[c] for c in cols])
        if mapa:
            with open(mapa, 'w', encoding='utf-8', newline='') as f:
                w_ = csv.writer(f)
                w_.writerow(['seudonimo', 'identidad'])
                for i, e in enumerate(evs):
                    w_.writerow([f'E{i+1}', e['id']])
        print(f'\nPublicable escrito en {publicar} (sin correos).')


if __name__ == '__main__':
    main()
