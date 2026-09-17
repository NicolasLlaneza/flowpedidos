#!/usr/bin/env python3
"""
sanitize-wamid.py — saneamiento de los CSV de corrida antes de publicarlos.

POR QUÉ EXISTE
--------------
El identificador de mensaje que devuelve la API de WhatsApp Business Cloud
(`wamid`) lleva el número de teléfono del destinatario codificado en base64
dentro de su estructura binaria:

    wamid.HBgNNTQ5OTk5OTk5OTk5ORUCABEYEjAxMjM0NTY3ODlBQkNERUYwMQA=
            ^^^^^^^^^^^^^^^^^^ -> "5499999999999"

(El wamid de arriba es ficticio y se incluye solo para ilustrar la estructura;
no corresponde a ningún despacho de la corrida.)

Publicar los CSV con esa columna en crudo expone los teléfonos reales de los
destinatarios verificados, en contradicción directa con el criterio de
minimización declarado en las secciones 2.7 y 3.12 del documento y con el
epígrafe de la Tabla H.1, que declara omitido el wamid por ese mismo motivo.

QUÉ HACE
--------
1. `wamid`        -> `wamid_hash`: sha256 del wamid completo, 16 hex. Único por
                     mensaje, no reversible, auditable por quien tenga el wamid.
2. `wamid_origen`: `meta` para los identificadores reales devueltos por la API,
                   `simulado` para los del simulador, vacío si no hubo despacho.
3. `destinatario`: seudónimo estable D1..Dn por número de teléfono, con el mismo
                   criterio con que el esquema seudonimiza clientes (`cust_`).
                   Permite verificar la cantidad de destinatarios distintos y su
                   reparto sin publicar ningún número.

El mapeo seudónimo -> teléfono se escribe aparte y NO debe versionarse.

USO
---
    python3 sanitize-wamid.py <entrada.csv> [<entrada.csv> ...] \
        --salida <dir> --mapa <archivo-privado.csv>
"""

import argparse, base64, csv, hashlib, re, sys
from pathlib import Path

def telefono(wamid: str):
    """Extrae el teléfono embebido en un wamid real de Meta, o None."""
    if not wamid or not wamid.startswith('wamid.'):
        return None
    cuerpo = wamid[len('wamid.'):]
    try:
        crudo = base64.b64decode(cuerpo + '=' * (-len(cuerpo) % 4))
    except Exception:
        return None
    m = re.search(rb'(\d{11,15})', crudo)
    return m.group(1).decode() if m else None

def origen(wamid: str):
    if not wamid:                     return ''
    if wamid.startswith('wamid.sim'): return 'simulado'
    if wamid.startswith('wamid.'):    return 'meta'
    return 'desconocido'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entradas', nargs='+')
    ap.add_argument('--salida', required=True)
    ap.add_argument('--mapa', required=True)
    a = ap.parse_args()

    salida = Path(a.salida); salida.mkdir(parents=True, exist_ok=True)
    mapa = {}                          # telefono -> Dn, estable entre archivos

    for ruta in a.entradas:
        ruta = Path(ruta)
        with open(ruta, encoding='utf-8-sig', newline='') as f:
            filas = list(csv.DictReader(f))
        if not filas:
            print(f'  {ruta.name}: vacío, se omite'); continue
        if 'wamid' not in filas[0]:
            print(f'  {ruta.name}: sin columna wamid, no requiere saneamiento'); continue

        for r in filas:
            tel = telefono(r['wamid'])
            if tel and tel not in mapa:
                mapa[tel] = f'D{len(mapa) + 1}'

        campos = []
        for c in filas[0]:
            campos.append('wamid_hash' if c == 'wamid' else c)
            if c == 'wamid':
                campos += ['wamid_origen', 'destinatario']

        destino = salida / ruta.name
        with open(destino, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=campos)
            w.writeheader()
            n_meta = 0
            for r in filas:
                wam = r.pop('wamid')
                tel = telefono(wam)
                r['wamid_hash'] = hashlib.sha256(wam.encode()).hexdigest()[:16] if wam else ''
                r['wamid_origen'] = origen(wam)
                r['destinatario'] = mapa.get(tel, '')
                n_meta += r['wamid_origen'] == 'meta'
                w.writerow(r)
        print(f'  {ruta.name}: {len(filas)} filas, {n_meta} identificadores reales de Meta -> {destino}')

    with open(a.mapa, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['seudonimo', 'telefono'])
        for tel, seudo in sorted(mapa.items(), key=lambda kv: kv[1]):
            w.writerow([seudo, tel])
    print(f'\nmapeo privado ({len(mapa)} destinatarios) -> {a.mapa}')
    print('NO versionar ese archivo.')

if __name__ == '__main__':
    main()
