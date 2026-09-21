#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analizar-anclaje.py — indicador de anclaje contextual (seccion 3.3).

POR QUE EXISTE
--------------
La seccion 3.3 define un segundo indicador de calidad: la proporcion de
mensajes con al menos un atributo del pedido verificable en el texto. Ese
indicador nunca se calculo, y el Capitulo 5 reportaba en su lugar la tasa de
aprobacion del validador deterministico (142/143), que mide otra cosa: la
regla 2 de rehydrate-validate.js comprueba que los nombres de clave declarados
en atributos_usados pertenezcan al conjunto de claves validas del contexto,
no que los valores aparezcan en el mensaje.

Este script calcula el indicador que la seccion 3.3 define.

QUE CUENTA COMO ANCLAJE
-----------------------
El contexto que recibe el modelo tiene siete claves (build-llm-prompt.js):

    order_status, channel, items_count, primary_product_name,
    total_amount, currency, source_created_at

Solo cuatro identifican al pedido en particular y por lo tanto pueden
constituir anclaje verificable:

    primary_product_name, total_amount, items_count, source_created_at

Las otras tres se excluyen con fundamento:
  - order_status no tiene un valor literal que aparezca en el texto: es la
    intencion comunicativa del mensaje, no un dato citado. Contarlo haria que
    todo mensaje bien formado anclara por construccion.
  - channel es un identificador interno y la regla 1 del validador prohibe
    que aparezca.
  - currency es generico: '$' o 'pesos' aparece en cualquier mensaje que
    mencione un monto, y ya se cuenta a traves de total_amount.

CRITERIO DE PRESENCIA TEXTUAL
-----------------------------
La coincidencia es tolerante, porque el modelo reformula:
  - total_amount: se comparan las cifras del mensaje normalizadas a digitos
    contra la parte entera del monto, para admitir '12.345,67', '$12345' o
    '12.345'.
  - primary_product_name: se exige que al menos dos de sus tokens
    distintivos (longitud >= 3, sin articulos ni la palabra generica del
    rubro) aparezcan en el mensaje.
  - items_count: se admite el digito o su nombre en espanol, y solo se
    evalua cuando es mayor que uno, porque 'un producto' es demasiado comun
    para atribuirlo al contexto.
  - source_created_at: se admite el dia y el mes en cifras o el mes en
    palabras.

Cada criterio es deliberadamente conservador: prefiere no acreditar un
anclaje dudoso antes que inflar el indicador.

USO
---
    python scripts/analizar-anclaje.py out/anclaje-crudo.csv
"""

import csv
import json
import math
import re
import sys
import unicodedata
from collections import Counter

MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
         'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

NUMEROS = {2: ['2', 'dos'], 3: ['3', 'tres'], 4: ['4', 'cuatro'],
           5: ['5', 'cinco'], 6: ['6', 'seis'], 7: ['7', 'siete'],
           8: ['8', 'ocho'], 9: ['9', 'nueve'], 10: ['10', 'diez']}

GENERICOS = {'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'con',
             'para', 'por', 'neumatico', 'neumaticos', 'cubierta', 'cubiertas'}

ANCLAJES = ['primary_product_name', 'total_amount', 'items_count',
            'source_created_at']


def norm(s):
    """Minusculas sin tildes."""
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower()


def wilson(k, n, z=1.959963984540054):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    centro = (p + z * z / (2 * n)) / d
    radio = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centro - radio), min(1.0, centro + radio))


def presente_monto(msg, total):
    """La parte entera del monto aparece entre las cifras del mensaje."""
    try:
        entero = int(float(total))
    except (TypeError, ValueError):
        return False
    if entero == 0:
        return False
    objetivo = str(entero)
    for bloque in re.findall(r'[\d.,]{2,}', msg):
        digitos = re.sub(r'\D', '', bloque)
        if not digitos:
            continue
        if digitos == objetivo or digitos.startswith(objetivo) or objetivo.startswith(digitos):
            if len(digitos) >= max(3, len(objetivo) - 2):
                return True
    return False


def presente_producto(msg, nombre):
    """Al menos dos tokens distintivos del nombre aparecen en el mensaje."""
    m = norm(msg)
    tokens = [t for t in re.split(r'[^\w/]+', norm(nombre))
              if len(t) >= 3 and t not in GENERICOS]
    if not tokens:
        return False
    hits = sum(1 for t in tokens if t in m)
    return hits >= min(2, len(tokens))


def presente_conteo(msg, n_items):
    """El conteo de items aparece como digito o palabra. Solo si es > 1."""
    try:
        k = int(n_items)
    except (TypeError, ValueError):
        return False
    if k <= 1 or k not in NUMEROS:
        return False
    m = norm(msg)
    return any(re.search(r'\b' + re.escape(v) + r'\b', m) for v in NUMEROS[k])


def presente_fecha(msg, iso):
    """El dia y el mes de la fecha de alta aparecen en el mensaje."""
    mm = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    if not mm:
        return False
    mes, dia = int(mm.group(2)), int(mm.group(3))
    m = norm(msg)
    if re.search(r'\b%d\b[^\d]{0,12}(%s|%02d|%d)\b' % (dia, MESES[mes - 1], mes, mes), m):
        return True
    return bool(re.search(r'\b%s\b' % MESES[mes - 1], m) and re.search(r'\b%d\b' % dia, m))


def main():
    if len(sys.argv) < 2:
        sys.exit('uso: python scripts/analizar-anclaje.py <anclaje-crudo.csv>')

    filas = list(csv.DictReader(open(sys.argv[1], encoding='utf-8')))
    if not filas:
        sys.exit('ABORTA: el CSV no tiene filas. Revisar la consulta de exportacion.')

    gen = [f for f in filas if str(f.get('is_fallback', '')).lower() in ('f', 'false', '0', '')]

    verif_por_attr = Counter()
    declar_por_attr = Counter()
    con_alguno = 0
    declaran_sin_verificar = 0
    detalle = []

    for f in gen:
        msg = f.get('message_text') or ''
        try:
            declarados = json.loads(f.get('atributos_usados') or '[]')
            if isinstance(declarados, dict):
                declarados = list(declarados.keys())
        except (ValueError, TypeError):
            declarados = []
        declarados = [d for d in declarados if isinstance(d, str)]
        for d in declarados:
            declar_por_attr[d] += 1

        verif = []
        if presente_producto(msg, f.get('primary_product_name')):
            verif.append('primary_product_name')
        if presente_monto(msg, f.get('total_amount')):
            verif.append('total_amount')
        if presente_conteo(msg, f.get('items_count')):
            verif.append('items_count')
        if presente_fecha(msg, f.get('source_created_at')):
            verif.append('source_created_at')

        for v in verif:
            verif_por_attr[v] += 1
        if verif:
            con_alguno += 1

        anclables_declarados = [d for d in declarados if d in ANCLAJES]
        no_verificados = [d for d in anclables_declarados if d not in verif]
        if no_verificados:
            declaran_sin_verificar += 1
        detalle.append((f.get('external_id'), f.get('order_status'),
                        sorted(verif), sorted(no_verificados)))

    n = len(gen)
    lo, hi = wilson(con_alguno, n)

    print('=== Indicador de anclaje contextual (seccion 3.3) ===')
    print(f'Mensajes generados por el modelo (excluye plantilla): {n}')
    print(f'Con al menos un atributo del pedido verificable en el texto: {con_alguno}')
    print(f'Proporcion: {100.0 * con_alguno / n:.1f} %'
          f'   IC Wilson 95 % = [{100 * lo:.1f} ; {100 * hi:.1f}]')
    print()
    print('Por atributo (verificado en el texto / declarado por el modelo):')
    for a in ANCLAJES:
        print(f'  {a:24s} verificado {verif_por_attr[a]:4d}   declarado {declar_por_attr[a]:4d}')
    print()
    otros = sorted(set(declar_por_attr) - set(ANCLAJES))
    if otros:
        print('Claves declaradas que no constituyen anclaje verificable:')
        for a in otros:
            print(f'  {a:24s} declarado {declar_por_attr[a]:4d}')
        print()
    print(f'Mensajes que declaran un atributo anclable y no lo citan en el texto: '
          f'{declaran_sin_verificar} de {n} ({100.0 * declaran_sin_verificar / n:.1f} %)')
    print()
    print('--- primeros 15 casos, para inspeccion manual ---')
    print(f'{"pedido":<18}{"estado":<18}{"verificados":<46}no verificados')
    for ext, st, v, nv in detalle[:15]:
        print(f'{str(ext):<18}{str(st):<18}{",".join(v) or "-":<46}{",".join(nv) or "-"}')


if __name__ == '__main__':
    main()
