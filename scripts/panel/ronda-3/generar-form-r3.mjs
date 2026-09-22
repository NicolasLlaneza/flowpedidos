#!/usr/bin/env node
// =============================================================================
// generar-form-r3.mjs · Apps Script del formulario de la TERCERA ronda
// -----------------------------------------------------------------------------
// Lee corpus_blind_r3.csv y escribe crear-form-panel-r3.gs con los mensajes
// embebidos. Respecto de la ronda 2 agrega:
//   - una pregunta de participación previa (para el análisis de sensibilidad);
//   - un ítem de conjetura de origen por mensaje, en una sección final y
//     separada, de modo que pensar en el origen no interfiera con el puntaje;
//   - ejemplos de calibración sin saludo, igual que el corpus.
//
// Uso:
//   node build-corpus-r3.mjs mensajes-corrida.csv
//   node generar-form-r3.mjs
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'corpus_blind_r3.csv');
if (!fs.existsSync(src)) { console.error('Falta corpus_blind_r3.csv: corré antes build-corpus-r3.mjs'); process.exit(1); }

function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 1);
}
const [h, ...rest] = parseCsv(fs.readFileSync(src, 'utf8'));
if (h[0] !== 'id' || h[1] !== 'mensaje') { console.error('Cabecera inesperada', h); process.exit(1); }
const corpus = rest.map(([id, mensaje]) => ({ id, mensaje }));

const gs = `// =============================================================================
// crear-form-panel-r3.gs — GENERADO por generar-form-r3.mjs. No editar a mano.
//
// 1. https://script.google.com -> Proyecto nuevo.
// 2. Pegar TODO este archivo reemplazando Código.gs y guardar.
// 3. Elegir la función crearFormulario y pulsar Ejecutar. Autorizar la primera vez.
// 4. Los enlaces quedan en Ver > Registros.
// =============================================================================

var CORPUS = ${JSON.stringify(corpus, null, 2)};

var CRITERIOS = [
  ['Claridad', 'Nada claro', 'Totalmente claro'],
  ['Adecuación del tono', 'Tono inadecuado', 'Tono óptimo'],
  ['Relevancia contextual', 'Genérico', 'Totalmente contextualizado'],
  ['Corrección lingüística', 'Con errores graves', 'Impecable']
];

var CALIBRACION = [
  { id: 'CAL-A', mensaje: 'Tu pedido cambió de estado. Ante cualquier duda podés comunicarte con nosotros por los canales habituales. Saludos cordiales.' },
  { id: 'CAL-B', mensaje: 'Ya confirmamos el pago de tu Fate Motorsport 175/70 R13. Lo estamos preparando para el envío y te avisamos apenas salga del depósito. Cualquier cosa, respondé por acá.' }
];

var ORIGENES = [
  'Lo escribió una persona',
  'Lo generó un sistema de inteligencia artificial',
  'Es una plantilla fija, igual para todos los pedidos en esa situación',
  'No sé'
];

var RUBRICA =
  'Cada mensaje se puntúa en cuatro criterios independientes, de 1 a 5:\\n\\n' +
  'CLARIDAD — ¿transmite la información de forma comprensible, sin ambigüedad ni relleno?\\n' +
  '  1 confuso · 3 comprensible con alguna imprecisión · 5 totalmente claro y conciso\\n\\n' +
  'ADECUACIÓN DEL TONO — ¿el registro es apropiado para la situación del pedido y para un canal de mensajería?\\n' +
  '  1 inadecuado · 3 aceptable pero genérico · 5 óptimo y ajustado a la situación\\n\\n' +
  'RELEVANCIA CONTEXTUAL — ¿incorpora datos específicos del pedido o es una fórmula aplicable a cualquiera?\\n' +
  '  1 genérico, sin ningún dato · 3 solo el estado · 5 varios atributos, integrados con naturalidad\\n\\n' +
  'CORRECCIÓN LINGÜÍSTICA — ¿hay errores de ortografía, gramática o concordancia?\\n' +
  '  1 errores graves · 3 errores menores aislados · 5 impecable\\n\\n' +
  'Los criterios son independientes: un mensaje puede estar perfectamente escrito y ser, aun así, poco claro o genérico.';

function crearFormulario() {
  var form = FormApp.create('Evaluación de mensajes de notificación de pedidos');
  form.setDescription(
    'Gracias por participar. Vas a evaluar mensajes que una tienda en línea envía por WhatsApp cuando ' +
    'cambia el estado de un pedido. Toma unos 20 minutos.\\n\\n' +
    'Tiene cuatro partes: una calibración con dos ejemplos, los puntajes de referencia de esos ejemplos, ' +
    'los mensajes a evaluar y, al final, una pregunta breve sobre cada mensaje.\\n\\n' +
    'Tu correo se usa solo para evitar respuestas duplicadas; no se publica.'
  );
  form.setCollectEmail(true);
  form.setLimitOneResponsePerUser(true);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);

  form.addMultipleChoiceItem()
      .setTitle('Participación previa')
      .setHelpText('¿Participaste antes en alguna evaluación de mensajes para este trabajo?')
      .setChoiceValues(['No', 'Sí'])
      .setRequired(true);

  form.addPageBreakItem().setTitle('Parte 1 de 4 · Calibración')
      .setHelpText('Puntuá estos dos ejemplos. No forman parte del conjunto a evaluar: sirven para fijar qué ' +
                   'significa cada punto de la escala.\\n\\n' + RUBRICA);
  for (var c = 0; c < CALIBRACION.length; c++) {
    form.addSectionHeaderItem().setTitle('Ejemplo ' + CALIBRACION[c].id.slice(-1)).setHelpText('«' + CALIBRACION[c].mensaje + '»');
    criterios_(form, CALIBRACION[c].id);
  }

  var pagRef = form.addPageBreakItem().setTitle('Parte 2 de 4 · Puntajes de referencia')
      .setHelpText(
        'EJEMPLO A — Claridad 2 · Tono 3 · Relevancia 1 · Corrección 5\\n' +
        'Se entiende que algo cambió, pero no qué: el destinatario no sabe si le cobraron, si se lo enviaron ' +
        'o si se lo cancelaron. No incorpora ningún dato del pedido. Está, sin embargo, bien escrito: corrección 5.\\n\\n' +
        'EJEMPLO B — Claridad 5 · Tono 5 · Relevancia 5 · Corrección 5\\n' +
        'Queda claro qué pasó y qué sigue, nombra el producto concreto y el registro acompaña la situación.\\n\\n' +
        'Los criterios no se arrastran entre sí, y la escala es absoluta contra los descriptores, no ' +
        'comparativa entre mensajes: si varios merecen 5, van 5.\\n\\n' +
        'Para continuar, respondé la pregunta de control. Si la respuesta no es correcta, esta página ' +
        'se vuelve a mostrar.');
  // Control de lectura: si la respuesta es incorrecta, el formulario vuelve a
  // mostrar esta misma página y no deja avanzar al corpus.
  var control = form.addMultipleChoiceItem()
      .setTitle('Control de lectura')
      .setHelpText('Según los puntajes de referencia: un mensaje impecablemente escrito, pero que no nombra ' +
                   'ningún dato del pedido, ¿qué puntaje de RELEVANCIA CONTEXTUAL recibe?')
      .setRequired(true);
  control.setChoices([
    control.createChoice('1', FormApp.PageNavigationType.CONTINUE),
    control.createChoice('3', pagRef),
    control.createChoice('5', pagRef)
  ]);

  form.addPageBreakItem().setTitle('Parte 3 de 4 · Mensajes a evaluar')
      .setHelpText('Son ' + CORPUS.length + ' mensajes. Puntuá cada uno con los cuatro criterios.\\n\\n' + RUBRICA);
  for (var i = 0; i < CORPUS.length; i++) {
    form.addSectionHeaderItem().setTitle('Mensaje ' + CORPUS[i].id + ' (' + (i + 1) + ' de ' + CORPUS.length + ')')
        .setHelpText('«' + CORPUS[i].mensaje + '»');
    criterios_(form, CORPUS[i].id);
  }

  form.addPageBreakItem().setTitle('Parte 4 de 4 · ¿Cómo se produjo cada mensaje?')
      .setHelpText('Los puntajes ya quedaron registrados y no se modifican. Para cada mensaje, marcá cómo creés ' +
                   'que fue producido. Si no tenés idea, elegí «No sé»: es una respuesta válida.');
  for (var j = 0; j < CORPUS.length; j++) {
    form.addMultipleChoiceItem()
        .setTitle('Origen — ' + CORPUS[j].id)
        .setHelpText('«' + CORPUS[j].mensaje + '»')
        .setChoiceValues(ORIGENES)
        .setRequired(true);
  }

  form.addParagraphTextItem().setTitle('Comentarios (opcional)').setRequired(false);

  Logger.log('Para responder: ' + form.getPublishedUrl());
  Logger.log('Para editar:    ' + form.getEditUrl());
  Logger.log('Mensajes: ' + CORPUS.length);
}

function criterios_(form, id) {
  for (var k = 0; k < CRITERIOS.length; k++) {
    form.addScaleItem().setTitle(CRITERIOS[k][0] + ' — ' + id).setBounds(1, 5)
        .setLabels(CRITERIOS[k][1], CRITERIOS[k][2]).setRequired(true);
  }
}
`;
fs.writeFileSync(path.join(__dirname, 'crear-form-panel-r3.gs'), gs, 'utf8');
console.error(`Escrito crear-form-panel-r3.gs (${corpus.length} mensajes, ${(corpus.length + 2) * 4} puntajes y ${corpus.length} conjeturas por evaluador).`);
