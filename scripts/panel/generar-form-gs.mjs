#!/usr/bin/env node
// =============================================================================
// generar-form-gs.mjs · produce el Apps Script del formulario de la 2.ª ronda
// -----------------------------------------------------------------------------
// Lee corpus_blind_v2.csv y escribe crear-form-panel-v2.gs con los mensajes ya
// embebidos, listo para pegar en script.google.com y ejecutar.
//
// Se genera en lugar de editarse a mano para que el formulario no pueda
// desincronizarse del corpus: los identificadores M01..Mnn del formulario son
// por construcción los mismos que los de corpus_key_v2.csv, que es lo que el
// análisis usa para reasociar cada puntaje con su origen.
//
// Uso:
//   node build-corpus-balanceado.mjs
//   node generar-form-gs.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0] !== '');
}

const csvPath = path.join(__dirname, 'corpus_blind_v2.csv');
if (!fs.existsSync(csvPath)) {
    console.error('No encuentro corpus_blind_v2.csv. Corré antes build-corpus-balanceado.mjs.');
    process.exit(1);
}
const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const header = rows.shift();
if (header[0] !== 'id' || header[1] !== 'mensaje') {
    console.error('Cabecera inesperada en corpus_blind_v2.csv:', header);
    process.exit(1);
}
const corpus = rows.map(([id, mensaje]) => ({ id, mensaje }));
if (!corpus.length) { console.error('El corpus está vacío.'); process.exit(1); }

const gs = `// =============================================================================
// crear-form-panel-v2.gs — GENERADO AUTOMÁTICAMENTE por generar-form-gs.mjs
// No editar a mano: regenerar desde corpus_blind_v2.csv.
//
// Crea el formulario de evaluación de la segunda ronda del panel, con ronda de
// calibración previa y corpus balanceado por estado canónico.
//
// Para usarlo:
//   1. Entrar a https://script.google.com y crear un proyecto nuevo.
//   2. Pegar TODO este archivo reemplazando el contenido de Código.gs.
//   3. Guardar (disquete), elegir la función crearFormulario en el selector
//      superior y pulsar Ejecutar. La primera vez pide autorizar el acceso a
//      Google Forms y Drive: es normal, es el permiso para crear el formulario
//      en la propia cuenta.
//   4. El enlace del formulario queda impreso en el registro de ejecución
//      (Ver > Registros) y el formulario aparece en Drive.
// =============================================================================

var CORPUS = ${JSON.stringify(corpus, null, 2)};

var CRITERIOS = [
  ['Claridad', 'Nada claro', 'Totalmente claro'],
  ['Adecuación del tono', 'Tono inadecuado', 'Tono óptimo'],
  ['Relevancia contextual', 'Genérico', 'Totalmente contextualizado'],
  ['Corrección lingüística', 'Con errores graves', 'Impecable']
];

var CALIBRACION = [
  {
    id: 'CAL-A',
    mensaje: 'Hola. Tu pedido cambió de estado. Ante cualquier duda podés comunicarte con nosotros por los canales habituales. Saludos cordiales.'
  },
  {
    id: 'CAL-B',
    mensaje: '¡Hola! Ya confirmamos el pago de tu Fate Motorsport 175/70 R13. Lo estamos preparando para el envío y te avisamos apenas salga del depósito. Cualquier cosa, respondé por acá.'
  }
];

var RUBRICA =
  'Cada mensaje se punta en cuatro criterios independientes, de 1 a 5:\\n\\n' +
  'CLARIDAD — ¿transmite la información de forma comprensible, sin ambigüedad ni relleno?\\n' +
  '  1 confuso · 3 comprensible con alguna imprecisión · 5 totalmente claro y conciso\\n\\n' +
  'ADECUACIÓN DEL TONO — ¿el registro es apropiado para la situación del pedido y para un canal de mensajería?\\n' +
  '  1 inadecuado · 3 aceptable pero genérico · 5 óptimo y ajustado a la situación\\n\\n' +
  'RELEVANCIA CONTEXTUAL — ¿incorpora datos específicos del pedido o es una fórmula aplicable a cualquiera?\\n' +
  '  1 genérico, sin ningún dato · 3 solo el estado · 5 varios atributos, integrados con naturalidad\\n\\n' +
  'CORRECCIÓN LINGÜÍSTICA — ¿hay errores de ortografía, gramática o concordancia?\\n' +
  '  1 errores graves · 3 errores menores aislados · 5 impecable\\n\\n' +
  'Los cuatro criterios son independientes: un mensaje puede estar perfectamente escrito y ser, aun así, poco claro o genérico.';

function crearFormulario() {
  var form = FormApp.create('Evaluación de calidad comunicacional — TFI (panel H3, 2.ª ronda)');

  form.setDescription(
    'Gracias por participar. Se trata de evaluar la calidad de una serie de mensajes de notificación ' +
    'de pedidos de comercio electrónico. Toma alrededor de 15 minutos.\\n\\n' +
    'El formulario tiene dos partes: primero una breve ronda de calibración con dos ejemplos, y después ' +
    'el conjunto de mensajes a evaluar. La calibración sirve para que todos los evaluadores usemos la ' +
    'escala de la misma manera; sus respuestas no forman parte del resultado principal.\\n\\n' +
    'Importante: no intente deducir de dónde viene cada mensaje. Puntúe lo que lee.'
  );

  form.setCollectEmail(true);
  form.setLimitOneResponsePerUser(true);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);

  // --- Parte 1: calibración ------------------------------------------------
  form.addPageBreakItem()
      .setTitle('Parte 1 de 3 · Calibración')
      .setHelpText(
        'Puntúe estos dos mensajes de ejemplo con la rúbrica. No pertenecen al conjunto a evaluar: ' +
        'sirven para fijar qué significa cada punto de la escala. En la página siguiente va a ver los ' +
        'puntajes de referencia y por qué son esos.\\n\\n' + RUBRICA
      );

  for (var c = 0; c < CALIBRACION.length; c++) {
    var ej = CALIBRACION[c];
    form.addSectionHeaderItem()
        .setTitle('Ejemplo ' + ej.id.slice(-1))
        .setHelpText('«' + ej.mensaje + '»');
    agregarCriterios_(form, ej.id);
  }

  // --- Parte 2: devolución de la calibración -------------------------------
  form.addPageBreakItem()
      .setTitle('Parte 2 de 3 · Puntajes de referencia')
      .setHelpText(
        'EJEMPLO A — Claridad 2 · Tono 3 · Relevancia 1 · Corrección 5\\n' +
        'Se entiende que algo cambió, pero no qué cambió: el destinatario no sabe si le cobraron, si se ' +
        'lo enviaron o si se lo cancelaron. No incorpora ningún dato del pedido, de modo que serviría sin ' +
        'cambios para cualquier cliente. Está, sin embargo, impecablemente escrito: por eso corrección 5.\\n\\n' +
        'EJEMPLO B — Claridad 5 · Tono 5 · Relevancia 5 · Corrección 5\\n' +
        'Queda claro qué pasó, qué sigue y qué puede hacer el destinatario; nombra el producto concreto, ' +
        'así que no sería aplicable tal cual a otro pedido; y el registro acompaña la situación sin ' +
        'sobreactuarla.\\n\\n' +
        'Dos cosas que conviene retener. Primero: los criterios no se arrastran entre sí — el ejemplo A ' +
        'saca 5 en corrección y 1 en relevancia. Segundo: la escala es absoluta contra los descriptores, ' +
        'no comparativa entre mensajes; si varios merecen 5, van 5.'
      );
  form.addMultipleChoiceItem()
      .setTitle('¿Leyó los puntajes de referencia?')
      .setChoiceValues(['Sí, puedo continuar'])
      .setRequired(true);

  // --- Parte 3: el corpus --------------------------------------------------
  form.addPageBreakItem()
      .setTitle('Parte 3 de 3 · Mensajes a evaluar')
      .setHelpText(
        'Son ' + CORPUS.length + ' mensajes. Puntúe cada uno con los mismos cuatro criterios.\\n\\n' + RUBRICA
      );

  for (var i = 0; i < CORPUS.length; i++) {
    var m = CORPUS[i];
    form.addSectionHeaderItem()
        .setTitle('Mensaje ' + m.id + ' (' + (i + 1) + ' de ' + CORPUS.length + ')')
        .setHelpText('«' + m.mensaje + '»');
    agregarCriterios_(form, m.id);
  }

  form.addParagraphTextItem()
      .setTitle('Comentarios (opcional)')
      .setHelpText('¿Hubo algún mensaje que le costara puntuar? ¿Algún criterio que le resultara ambiguo?')
      .setRequired(false);

  Logger.log('Formulario creado.');
  Logger.log('Para responder: ' + form.getPublishedUrl());
  Logger.log('Para editar:    ' + form.getEditUrl());
  Logger.log('Mensajes del corpus: ' + CORPUS.length + ' · preguntas de puntaje: ' + ((CORPUS.length + CALIBRACION.length) * CRITERIOS.length));
}

function agregarCriterios_(form, id) {
  for (var k = 0; k < CRITERIOS.length; k++) {
    form.addScaleItem()
        .setTitle(CRITERIOS[k][0] + ' — ' + id)
        .setBounds(1, 5)
        .setLabels(CRITERIOS[k][1], CRITERIOS[k][2])
        .setRequired(true);
  }
}
`;

const out = path.join(__dirname, 'crear-form-panel-v2.gs');
fs.writeFileSync(out, gs, 'utf8');
console.error(`Escrito ${out}`);
console.error(`  mensajes del corpus     : ${corpus.length}`);
console.error(`  preguntas de puntaje    : ${(corpus.length + 2) * 4}`);
