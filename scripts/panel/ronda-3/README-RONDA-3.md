# Tercera ronda del panel — paso a paso

Responde a NC-02: repetir el contraste de H3 con el saludo retirado en ambos
brazos y con un ítem que verifique si el origen de cada mensaje es reconocible.
Las reglas están en `REGLAS-DECISION-R3.md`; este archivo es solo el cómo.

Requiere Docker levantado con la base de la corrida y Node 18 o superior.
Todos los comandos, en cmd, desde la raíz del repo.

## 1. Exportar los mensajes de la corrida

```
docker compose exec -T postgres psql -U n8n -d tfi -q --csv < scripts\panel\ronda-3\export-corpus-r3.sql > scripts\panel\ronda-3\mensajes-corrida.csv
```

`mensajes-corrida.csv` tiene los nombres de los destinatarios: está en
`.gitignore` y **no se commitea**.

## 2. Armar el corpus y el formulario

```
cd scripts\panel\ronda-3
node build-corpus-r3.mjs mensajes-corrida.csv
node generar-form-r3.mjs
```

Revisá `corpus_blind_r3.csv`: 18 mensajes, ninguno con saludo ni nombre.

## 3. Preregistro (antes de crear el formulario)

```
git add scripts/panel/ronda-3 .gitignore
git reset scripts/panel/ronda-3/corpus_key_r3.csv
git commit -m "panel(r3): preregistro de la tercera ronda (NC-02)"
git push
```

La clave (`corpus_key_r3.csv`) se commitea recién después del cierre, para que
nadie pueda consultarla mientras responde.

## 4. Crear el formulario

1. https://script.google.com → Proyecto nuevo.
2. Pegar todo `crear-form-panel-r3.gs` reemplazando `Código.gs`. Guardar.
3. Elegir `crearFormulario` → Ejecutar → autorizar.
4. Ver → Registros: ahí están el enlace para responder y el de edición.

## 5. Recolección

- Mandá el enlace a 15 personas externas al equipo para llegar a 12.
- Mensaje sugerido: «Estoy evaluando mensajes que una tienda online manda por
  WhatsApp. Son unos 20 minutos. ¿Me das una mano?». No menciones inteligencia
  artificial ni la hipótesis.
- Solo mirá el contador de respuestas. Cerrá el formulario («No acepta
  respuestas») al llegar a 12 o a las 72 horas.

## 6. Análisis

En Formularios → Respuestas → Descargar CSV, y guardalo como
`scripts\panel\ronda-3\respuestas-r3.csv` (tiene correos: no se commitea).

```
cd scripts\panel\ronda-3
python analyze_panel_r3.py respuestas-r3.csv corpus_key_r3.csv --publicar ..\..\..\out\panel\respuestas-ronda-3.csv --mapa mapa-evaluadores-r3.csv > ..\..\..\out\panel\resultados-ronda-3.txt
```

Si alguna respuesta es de un integrante del equipo, agregá
`--excluir=<parte-del-correo>` antes del `>`.

## 7. Publicar

```
git add scripts/panel/ronda-3/corpus_key_r3.csv out/panel/respuestas-ronda-3.csv out/panel/resultados-ronda-3.txt
git commit -m "panel(r3): clave, respuestas saneadas y resultados"
git push
```

Pasame `resultados-ronda-3.txt` y actualizo §3.7, §5.4, §5.6, §6.3, §7.1,
§7.4, la Tabla 7.1 y el Anexo G según el veredicto.
