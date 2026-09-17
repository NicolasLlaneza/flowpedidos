#!/usr/bin/env python3
"""
sanitize-panel.py — saneamiento del CSV de respuestas del panel antes de publicarlo.

POR QUÉ EXISTE
--------------
El Anexo G del documento declara que la matriz completa de catorce mensajes por
nueve evaluadores por cuatro criterios se publica en el repositorio, para que
las medias por criterio de la Tabla 5.5 y sus coeficientes alfa sean
reejecutables por un tercero. Esa matriz es el CSV de respuestas del formulario,
y ese CSV trae la dirección de correo electrónico de cada evaluador en la columna
de identidad, porque el formulario exigía cuenta de Google para garantizar una
respuesta por persona.

Publicarlo en crudo expondría las direcciones de correo de nueve personas que
colaboraron sin contrapartida, en contra del criterio de minimización de datos
declarado en las secciones 2.7 y 3.12, y del anonimato que el Anexo G promete
cuando identifica a los evaluadores como E1 a E9.

QUÉ HACE
--------
Reemplaza la columna de identidad por un seudónimo estable EN EL MISMO ORDEN en
que el analizador asigna E1, E2, ... — el orden de aparición en el archivo—, de
modo que la Tabla G.1 del documento y el CSV publicado se corresponden fila por
fila. La respuesta excluida por el criterio de externalidad de la sección 3.7
conserva su fila, etiquetada aparte, para que el análisis de sensibilidad que la
sección 5.5 reporta también sea reejecutable.

Todo lo demás se preserva sin tocar: la marca temporal —que acredita que las
respuestas son posteriores al registro del plan de análisis— y las cincuenta y
seis valoraciones de criterio.

El mapeo seudónimo -> correo se escribe aparte y NO debe versionarse.

USO
---
    python3 sanitize-panel.py <respuestas.csv> --salida <archivo.csv> \
        --mapa <archivo-privado.csv> [--excluida <fragmento-del-correo>]

El analizador acepta el archivo saneado sin cambios; la exclusión se reproduce
con --excluir=<seudonimo de la excluida>.
"""

import argparse, csv, sys
from pathlib import Path

COLS_IDENTIDAD = ('Dirección de correo electrónico', 'Nombre de usuario', 'Email Address', 'Username')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entrada')
    ap.add_argument('--salida', required=True)
    ap.add_argument('--mapa', required=True)
    ap.add_argument('--excluida', default=None,
                    help='fragmento del correo de la respuesta excluida por el criterio de externalidad')
    a = ap.parse_args()

    with open(a.entrada, encoding='utf-8-sig', newline='') as f:
        filas = list(csv.DictReader(f))
    if not filas:
        raise SystemExit('El CSV de respuestas está vacío.')

    col = next((c for c in COLS_IDENTIDAD if c in filas[0]), None)
    if col is None:
        raise SystemExit(f'No se encontró la columna de identidad. Columnas: {list(filas[0])[:4]}')

    # El seudónimo sigue el orden de aparición, que es el que usa el analizador.
    # La respuesta excluida queda al final con etiqueta propia, para no desplazar
    # la numeración de los evaluadores que sí integran el panel.
    incluidas = [r for r in filas if not (a.excluida and a.excluida in r[col])]
    excluidas = [r for r in filas if      a.excluida and a.excluida in r[col]]

    mapa = {}
    for i, r in enumerate(incluidas, start=1):
        mapa[r[col]] = f'E{i}'
    for i, r in enumerate(excluidas, start=1):
        mapa[r[col]] = f'EX{i}'

    campos = list(filas[0].keys())
    with open(a.salida, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        for r in incluidas + excluidas:
            r = dict(r)
            r[col] = mapa[r[col]]
            w.writerow(r)

    with open(a.mapa, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['seudonimo', 'identidad'])
        for ident, seudo in sorted(mapa.items(), key=lambda kv: (kv[1][:2], int(kv[1][2:] or kv[1][1:]))):
            w.writerow([seudo, ident])

    # Control: ninguna dirección de correo puede sobrevivir en la salida.
    texto = open(a.salida, encoding='utf-8').read()
    fugas = [i for i in mapa if i and i in texto]
    if fugas:
        raise SystemExit(f'ABORTA: quedaron identidades en la salida: {fugas}')
    if '@' in texto:
        raise SystemExit('ABORTA: la salida contiene un carácter @; revisar antes de publicar.')

    print(f'{a.salida}: {len(incluidas)} evaluadores del panel (E1..E{len(incluidas)})'
          + (f' + {len(excluidas)} excluida (EX1..EX{len(excluidas)})' if excluidas else ''))
    print(f'{a.mapa}: mapeo privado de {len(mapa)} identidades. NO versionar.')
    print('control: ninguna dirección de correo sobrevive en la salida.')

if __name__ == '__main__':
    main()
