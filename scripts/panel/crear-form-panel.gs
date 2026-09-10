/**
 * crear-form-panel.gs — genera el Google Form del panel de evaluación
 * cualitativa (H3, §3.7 del TFI) con los 20 mensajes reales ya barajados
 * (corpus_key.csv), sin revelar su origen (llm/template).
 *
 * CÓMO USARLO:
 * 1. Andá a https://script.google.com/ → "Nuevo proyecto".
 * 2. Borrá el contenido de Code.gs y pegá este archivo completo.
 * 3. Arriba, hacé click en "Ejecutar" (▶) sobre la función crearFormPanel.
 * 4. La primera vez te va a pedir autorización — aceptá con tu cuenta.
 * 5. Mirá el "Registro de ejecución" (Ver → Registros, o Ctrl+Enter):
 *    ahí van a aparecer el link de edición y el link para compartir.
 * 6. Abrí el link de edición, revisá que esté todo bien, y compartí el
 *    link de "Enviar formulario" con tus 3 evaluadores.
 *
 * Configuración ya aplicada por el script (no hace falta tocarla):
 *   - Recopila la dirección de email del respondente (requiere login).
 *   - Limita a una respuesta por persona.
 * Esto certifica que cada respuesta viene de una cuenta de Google real
 * y distinta — la garantía de identidad que buscábamos.
 */

const MENSAJES = [
  { id: 'M01', texto: '¡Hola!, te confirmamos que tu pedido de Neumático Michelin Primacy 4 225/45 R17 ha sido entregado. Muchas gracias por tu compra.' },
  { id: 'M02', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, tu pedido de Neumático Goodyear Eagle F1 245/40 R18 pasa a preparación.' },
  { id: 'M03', texto: 'Se procesó el reembolso de tu pedido. Puede demorar unos días en verse reflejado según tu medio de pago.' },
  { id: 'M04', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, estamos preparando el Neumático Bridgestone Ecopia EP150 185/65 R14 para su envío.' },
  { id: 'M05', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, estamos preparando el Neumático Goodyear EfficientGrip 195/55 R15 para su envío.' },
  { id: 'M06', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, estamos preparando el Neumático Pirelli P7 205/55 R16 para su envío. Gracias por tu compra.' },
  { id: 'M07', texto: '¡Hola!, hemos confirmado el pago de tu pedido de Neumático Continental PowerContact 185/65 R15. Tu pedido pasará a preparación en breve.' },
  { id: 'M08', texto: 'Tu pedido fue despachado. Vas a recibirlo en los próximos días según el método de envío que elegiste.' },
  { id: 'M09', texto: 'Recibimos el pago de tu compra. Estamos preparando tu pedido para el envío. Gracias por elegirnos.' },
  { id: 'M10', texto: 'Confirmamos la entrega de tu pedido. ¡Gracias por tu compra! Si necesitás algo, escribinos.' },
  { id: 'M11', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, estamos preparando el Neumático Bridgestone Turanza T005 205/55 R16 para su envío.' },
  { id: 'M12', texto: '¡Hola!, estamos aguardando la confirmación del pago de tu pedido de 2 unidades del Neumático Pirelli Cinturato P1 195/65 R15. No dudes en contactarnos si tenés alguna consulta.' },
  { id: 'M13', texto: 'Tu pedido fue cancelado. Si fue un error o querés más información, contactanos así lo resolvemos.' },
  { id: 'M14', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, estamos preparando el Neumático Bridgestone Turanza T005 205/55 R16 para su envío. Agradecemos tu compra.' },
  { id: 'M15', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, el pedido pasa a preparación.' },
  { id: 'M16', texto: '¡Hola!, hemos confirmado tu pago. Tu pedido de Neumático Continental ContiPremium 205/60 R16 pasa a preparación. Agradecemos tu compra.' },
  { id: 'M17', texto: '¡Hola!, te confirmamos que se ha procesado el reembolso por el Servicio de alineación y balanceo (4 ruedas). Agradecemos tu comprensión y quedamos a disposición para cualquier consulta.' },
  { id: 'M18', texto: 'Estamos esperando la confirmación del pago de tu compra. Si ya pagaste, no te preocupes — en algunos casos puede demorar unos minutos.' },
  { id: 'M19', texto: '¡Hola!, hemos confirmado el pago de tu pedido. Ahora, el pedido pasa a preparación.' },
  { id: 'M20', texto: '¡Hola!, lamentamos informarte que tu pedido de 2 unidades del Neumático Fate Maxisport 195/65 R15 ha sido cancelado. Si tenés alguna consulta, no dudes en contactarnos.' },
];

// Anclas cortas de la rúbrica completa (Anexo D del TFI). El texto íntegro
// de cada nivel (1 a 5) va en la descripción del formulario, para que el
// evaluador lo tenga a mano sin que cada pregunta quede sobrecargada.
const CRITERIOS = [
  { titulo: 'Claridad', bajo: '1 = confuso/ambiguo', alto: '5 = totalmente claro y conciso' },
  { titulo: 'Adecuación del tono', bajo: '1 = tono inadecuado', alto: '5 = tono óptimo y ajustado' },
  { titulo: 'Relevancia contextual', bajo: '1 = genérico, sin datos del pedido', alto: '5 = completamente contextualizado' },
  { titulo: 'Corrección lingüística', bajo: '1 = múltiples errores graves', alto: '5 = gramaticalmente impecable' },
];

const DESCRIPCION_FORM =
  'Gracias por participar como evaluador/a externo/a de este Trabajo Final Integrador.\n\n' +
  'Vas a leer 20 mensajes cortos de atención al cliente, en orden aleatorio y sin saber cuáles fueron ' +
  'generados por un modelo de lenguaje y cuáles por una plantilla fija — esa información se mantiene ' +
  'oculta a propósito para que la evaluación sea a ciegas. Para cada mensaje, puntuá los 4 criterios ' +
  'de 1 a 5 según la rúbrica.\n\n' +
  'RÚBRICA COMPLETA:\n\n' +
  'Claridad — ¿el mensaje transmite la información de forma comprensible, sin ambigüedad ni redundancia?\n' +
  '1: confuso, no se identifica la información esencial. ' +
  '2: parcialmente comprensible, requiere relectura. ' +
  '3: comprensible en general, con alguna imprecisión menor. ' +
  '4: claro y directo. ' +
  '5: totalmente claro y conciso, sin información sobrante.\n\n' +
  'Adecuación del tono — ¿el registro es pertinente al contexto de la transacción?\n' +
  '1: tono inadecuado (ej. informal ante una cancelación, frío ante una entrega). ' +
  '2: parcialmente desajustado. ' +
  '3: aceptable pero genérico. ' +
  '4: apropiado y coherente con el estado del pedido. ' +
  '5: cordial, natural y perfectamente ajustado.\n\n' +
  'Relevancia contextual — ¿refleja los atributos específicos del pedido (producto, estado) en vez de ser genérico?\n' +
  '1: genérico, sin ningún dato del pedido. ' +
  '2: incorpora algún dato pero incorrecto o poco relevante. ' +
  '3: incorpora los datos básicos (estado) sin más detalle. ' +
  '4: incorpora varios atributos relevantes de forma coherente. ' +
  '5: completamente contextualizado, sin sonar a plantilla.\n\n' +
  'Corrección lingüística — ¿está libre de errores gramaticales u ortográficos?\n' +
  '1: múltiples errores graves. ' +
  '2: errores frecuentes y notorios. ' +
  '3: errores menores y aislados. ' +
  '4: correcto, a lo sumo un error menor. ' +
  '5: gramaticalmente impecable.\n\n' +
  'No compartas tus respuestas con los otros dos evaluadores hasta que los tres hayan terminado. ' +
  'No hace falta que sepas nada más del proyecto — de hecho, es mejor que no lo sepas hasta después de puntuar.';

function crearFormPanel() {
  const form = FormApp.create('Evaluación de calidad comunicacional — TFI (panel H3)');
  form.setDescription(DESCRIPCION_FORM);
  form.setCollectEmail(true);
  form.setLimitOneResponsePerUser(true);
  form.setProgressBar(true);
  form.setShuffleQuestions(false); // el orden de los 20 mensajes ya viene aleatorizado con semilla fija

  MENSAJES.forEach(function (m) {
    form.addSectionHeaderItem()
      .setTitle('Mensaje ' + m.id)
      .setHelpText(m.texto);

    CRITERIOS.forEach(function (c) {
      form.addScaleItem()
        .setTitle(c.titulo + ' — ' + m.id)
        .setBounds(1, 5)
        .setLabels(c.bajo, c.alto)
        .setRequired(true);
    });
  });

  Logger.log('Form creado.');
  Logger.log('Link de edición: ' + form.getEditUrl());
  Logger.log('Link para compartir con evaluadores: ' + form.getPublishedUrl());
}
