# Guion de narración — Video de funcionamiento (MVP)

**Destino**: video que pide el coordinador, mostrando el funcionamiento real, explicado por ustedes.
**Sobre qué se graba**: el panel de operación en http://localhost:4000.
**Tono**: técnico-explicativo. Se introduce terminología y se la explica en lenguaje claro.
**Duración estimada**: 3 a 4 minutos.
**Narración**: una sola voz, en off.

---

## Antes de grabar

1. Stack arriba: `docker compose up -d`
2. Levantar el panel: `node demo/web/server.mjs`
3. En el navegador, abrir http://localhost:4000 y, si está vacío, presionar **"Cargar pedidos"** (esto ingesta el dataset por el pipeline real; los mensajes ya están cacheados, no gasta IA).
4. Tener un pedido elegido para mostrar el detalle (idealmente uno con mensaje de IA).
5. Maximizar el navegador, zoom 110%.

---

## Glosario que se usa en la narración

Para que la narración suene precisa, estos son los términos y su explicación breve:

- **Webhook**: notificación automática que una plataforma (Mercado Libre, etc.) envía cuando ocurre un evento, como una nueva venta.
- **Pipeline**: la secuencia de pasos por la que pasa cada pedido, de principio a fin.
- **Modelo de datos canónico**: una estructura única y común a la que se traducen los pedidos de todos los canales, sin importar el formato original de cada uno.
- **Normalización**: el proceso de convertir los datos de cada canal a ese modelo común.
- **Idempotencia**: la propiedad que garantiza que procesar el mismo evento dos veces produzca el mismo resultado — es decir, no duplica ni vuelve a cobrar.
- **Seudonimización**: reemplazar los datos personales por un identificador anónimo antes de enviarlos a un servicio externo.
- **Trazabilidad / auditoría**: el registro de cada paso que ocurrió con un pedido, para poder reconstruir su historia.

---

## NARRACIÓN

### Apertura — qué es esto
> "Lo que estamos viendo es el panel de operación de FlowPedidos, nuestra arquitectura de integración multicanal para PyMEs de comercio electrónico. No son pantallas de ejemplo: cada pedido que aparece acá fue procesado de verdad por el sistema, almacenado en una base de datos PostgreSQL, y su mensaje fue generado con inteligencia artificial."

### El panel — el valor
> "Arriba tenemos los indicadores de operación: cantidad de pedidos procesados, ingresos, pedidos pendientes, mensajes enviados, y la cantidad de canales activos. Acá está la primera idea central: estos pedidos llegaron desde cuatro canales distintos — Mercado Libre, WhatsApp, una tienda online y Tienda Nube — pero están todos unificados en una sola vista. Esto es lo que resuelve la fragmentación operativa: en lugar de revisar cuatro plataformas por separado, el negocio tiene un único punto de control."

### Cómo llega un pedido — el pipeline con terminología
> "¿Cómo llega cada pedido hasta acá? A través de un pipeline de varios pasos. Primero, la plataforma de venta emite un webhook — una notificación automática — cuando se genera una orden. El sistema valida que esa notificación tenga la estructura correcta. Después consulta la plataforma para traer los datos completos del pedido, un paso que llamamos enriquecimiento."

> "El paso clave que viene a continuación es la normalización al modelo de datos canónico. Cada canal representa la información de forma diferente; el sistema traduce todos esos formatos a una estructura común y única. Eso es lo que permite que un pedido de Mercado Libre y uno de WhatsApp convivan en la misma tabla con la misma estructura."

> "Antes de guardar, el sistema aplica un control de idempotencia: verifica que el pedido no haya sido procesado antes. Esto evita duplicados cuando una plataforma reenvía la misma notificación, algo que ocurre con frecuencia. Si el pedido es nuevo, se persiste en la base junto con el cliente y los productos."

### El detalle — privacidad y trazabilidad
*(click en un pedido)*
> "Si abrimos un pedido, vemos su detalle completo. Acá hay un punto importante de diseño: el cliente se identifica con su nombre real para el vendedor, pero observen el seudónimo. Cuando el sistema genera el mensaje con inteligencia artificial, le envía únicamente ese seudónimo — nunca el nombre, el email ni el teléfono. Esto es seudonimización, y responde al principio de privacidad por diseño."

> "Más abajo está el mensaje que recibió el cliente, generado automáticamente por el modelo de lenguaje según el estado del pedido. Y al final, la trazabilidad: el registro cronológico de cada paso que ocurrió con este pedido. En cualquier momento se puede reconstruir exactamente qué pasó, cuándo y por qué."

### Filtros / multicanal
*(usar el filtro de canal o estado)*
> "El panel permite filtrar por canal, por estado o buscar un pedido puntual. Esto convierte la operación, que antes estaba dispersa y era manual, en una gestión centralizada y consultable."

### Cierre
> "En resumen: FlowPedidos recibe pedidos de múltiples canales mediante webhooks, los normaliza a un modelo de datos común, controla duplicados con idempotencia, protege los datos personales mediante seudonimización, genera comunicaciones con inteligencia artificial, y deja trazabilidad completa de todo el proceso. Esto demuestra que la lógica de la arquitectura propuesta funciona de manera integrada y reproducible."

---

## Notas de grabación

- **Si querés mostrar resiliencia**: el sistema tiene un mecanismo de degradación funcional — si el servicio de IA falla, genera el mensaje con una plantilla de respaldo. En el panel, los pedidos con respaldo muestran la etiqueta "plantilla de respaldo" en su detalle. Podés mencionarlo aunque no haya uno visible.
- **Honestidad académica**: esto es un MVP evaluado en entorno controlado, no un producto en producción. Si lo aclarás, suma rigor: "esta es una implementación de referencia, evaluada con un conjunto de pedidos representativos".
- **Ritmo**: pausar al pasar de un bloque al siguiente. No leer de corrido.
- **Términos**: la primera vez que uses un término técnico, explicalo en la misma frase (como está redactado arriba). No asumas que el coordinador conoce "idempotencia" o "canónico".

---

## Comando para mostrar la base directamente (opcional, cierre técnico)

Si querés cerrar mostrando que los datos están realmente en PostgreSQL:

```bash
docker compose exec postgres psql -U tfi_app -d tfi -c \
"SELECT external_id, channel, status, (SELECT message_text FROM tfi.ai_notifications n WHERE n.order_id=o.id) AS mensaje FROM tfi.orders o LIMIT 5;"
```
