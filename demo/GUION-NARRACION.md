# Guion de narración — Video de funcionamiento (demo técnico)

**Destino**: video que pide el coordinador, explicado por ustedes, mostrando el funcionamiento real.
**Tono**: técnico-explicativo (NO comercial — este es distinto al pitch de FlowPedidos).
**Formato**: voz en off sobre la grabación del terminal corriendo `node run-demo.mjs`.
**Duración estimada**: 2:30 – 3:30 min (el demo tarda ~30-40s en correr; la narración puede pausar el video en momentos clave).

---

## Dos versiones para grabar

- **Dashboard web** (recomendado): `node demo/web/server.mjs` → http://localhost:4000. Muestra el escenario real (panel del vendedor + teléfono del cliente). Narración propia abajo.
- **CLI** (terminal): `node demo/run-demo.mjs`. Muestra el detalle técnico del pipeline. Narración técnica más abajo.

---

## NARRACIÓN PARA EL DASHBOARD (vista de negocio)

Esta es la recomendada para el coordinador: muestra qué hace el pedido, no las tripas del sistema.

### Apertura
> "Esto es FlowPedidos funcionando. A la izquierda está el panel del vendedor; a la derecha, el teléfono del cliente. Vamos a simular ventas que entran desde distintos canales y ver qué pasa con cada una."

### Venta 1 — Mercado Libre
*(click "Simular próxima venta")*
> "Entra una venta desde Mercado Libre. FlowPedidos la captura, la organiza en el panel junto con todos los datos del cliente y el producto, y miren el teléfono: el cliente recibe automáticamente un mensaje confirmando su compra. Ese mensaje lo generó la inteligencia artificial según el estado del pedido — nadie lo escribió a mano."

### Venta 2 — WhatsApp
> "Ahora entra una venta por WhatsApp. Otro canal completamente distinto, pero cae en el mismo panel, unificada con la anterior. El cliente también recibe su mensaje. Esto es lo central: no importa de qué canal venga, todo queda en un solo lugar."

### Venta 3 — Tienda Online
> "Una tercera venta, esta vez desde la tienda online propia. Tres canales distintos, una sola vista ordenada. Antes esto vivía disperso en tres plataformas separadas."

### Venta 4 — Duplicado
> "Acá pasa algo importante. La primera venta vuelve a entrar — algo común cuando las plataformas reenvían notificaciones. FlowPedidos la reconoce y la bloquea. Al cliente no se le cobra dos veces ni se le manda otro mensaje. El panel no se ensucia con un duplicado."

### Venta 5 — Servicio caído (respaldo)
> "Ahora simulamos que el servicio de inteligencia artificial se cae. Miren: el cliente igual recibe una respuesta, esta vez con un mensaje de respaldo. El sistema no se rompe ni deja al cliente esperando — sigue funcionando aunque un componente externo falle."

### Venta 6 — Notificación incompleta
> "Por último, llega una notificación incompleta, sin los datos mínimos. FlowPedidos la descarta. No deja que información defectuosa entre al sistema."

### Cierre
> "En segundos procesamos ventas de tres canales, evitamos un cobro duplicado, resolvimos una caída de servicio y filtramos una notificación inválida. Todo automático, todo ordenado, sin intervención manual. Esto es FlowPedidos."

---

## NARRACIÓN TÉCNICA PARA EL CLI (terminal)

Usar esta si grabás `node demo/run-demo.mjs` (muestra los pasos internos).

## Antes de grabar

1. **Cargar crédito en OpenAI** (ya está hecho — verificado funcionando).
2. Correr `node demo/reset.mjs` (o el botón "Reiniciar" del dashboard) para limpiar la base.
3. **Dashboard**: maximizar el navegador, zoom 110-125%. **CLI**: terminal con fuente grande (16-18pt), tema oscuro.
4. Ensayá una vuelta antes de grabar la toma buena.

## Ritmo del dashboard

Cada click de "Procesar siguiente pedido" anima la barra de etapas (~4-5 seg), después aparece el pedido en la tabla y el mensaje en la columna de la derecha. Narrá mientras se anima. La secuencia tiene 6 pasos (3 con IA, 1 duplicado, 1 fallback, 1 rechazo) — al final mostrás los stats y la tabla llena.

---

## Estructura de la narración

### Apertura (antes de correr el comando)
> "Lo que vamos a mostrar es el pipeline de procesamiento de pedidos funcionando de punta a punta. No son pantallas de ejemplo: el sistema recibe pedidos reales, los procesa, los guarda en una base de datos PostgreSQL, y genera los mensajes con inteligencia artificial. Todo lo que van a ver ocurre de verdad."

*(Acá ejecutás `node run-demo.mjs`)*

---

### Pedido 1 — Happy path (el flujo completo)
> "El primer pedido entra desde Mercado Libre. El sistema valida que la notificación tenga la estructura correcta. Después consulta la plataforma para traer todos los datos completos del pedido — esto se llama enriquecimiento. Acá viene un paso clave: la normalización. Cada plataforma representa los datos distinto, así que el sistema los convierte a un modelo común, único. Verifica que no sea un duplicado, registra al cliente, y persiste el pedido en la base."

> "Antes de generar el mensaje, observen este paso: seudonimización. Al servicio de inteligencia artificial solo le mandamos un identificador anónimo del cliente, nunca su nombre, mail o teléfono. Eso es privacidad por diseño. Y finalmente, la IA genera el mensaje personalizado para el comprador."

*(Señalar el mensaje generado en pantalla)*
> "Este mensaje no estaba escrito de antemano. Lo generó el modelo en este momento, según el estado del pedido."

---

### Pedido 2 — Consistencia
> "El segundo pedido sigue exactamente el mismo flujo. Esto muestra que el proceso es consistente, no un caso armado."

---

### Pedido 3 — Idempotencia (el reenvío)
> "Ahora viene algo importante. Este es el mismo pedido que el primero, reenviado — algo que pasa todo el tiempo en la realidad, cuando la plataforma manda la notificación dos veces. Miren: el sistema lo detecta, marca que ya existe, y lo bloquea. No se procesa de nuevo, no se le cobra al cliente dos veces, no se le manda otro mensaje. Esto es el control de idempotencia."

---

### Pedido 4 — Resiliencia (el fallback)
> "Acá simulamos una falla del servicio de inteligencia artificial — porque en producción, los servicios externos a veces no responden. Observen qué hace el sistema: en lugar de romperse o dejar al cliente sin respuesta, degrada a una plantilla predefinida. El cliente igual recibe una comunicación válida. Esto es la resiliencia: el sistema sigue funcionando aunque un componente externo falle."

---

### Pedido 5 — Validación (el rechazo)
> "El último evento es una notificación inválida, sin los datos mínimos. El sistema la rechaza con un código de error, la registra en la auditoría, y no deja que información defectuosa avance por el pipeline."

---

### Cierre (sobre el resumen final)
> "El resumen muestra lo que pasó: pedidos procesados, duplicados bloqueados, eventos rechazados, y el costo real en inteligencia artificial. Y abajo, el estado de la base de datos: cada pedido, cliente, ítem y notificación quedó registrado, junto con la traza completa de auditoría de cada paso. Todo esto ocurrió en segundos, de forma automática, y quedó documentado. Esto demuestra que la lógica de la arquitectura propuesta funciona."

---

## Notas

- Si grabás con el fallback activo (sin crédito OpenAI), **cambiá la narración del Pedido 1**: en vez de "la IA genera el mensaje", decí "el sistema genera el mensaje — en este caso por plantilla, porque mostramos también el mecanismo de respaldo". Es honesto y sigue siendo válido.
- Lo ideal es grabar CON crédito para mostrar la IA real en los pedidos 1 y 2, y dejar el fallback solo para el pedido 4 (donde lo forzamos a propósito).
- Si el coordinador quiere ver la base de datos directamente, podés agregar al final una consulta en vivo:
  `docker compose exec postgres psql -U tfi_app -d tfi -c "SELECT external_id, status, (SELECT message_text FROM tfi.ai_notifications n WHERE n.order_id=o.id) FROM tfi.orders o;"`
