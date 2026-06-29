# Investigación: usuarios test reales de ML y WooCommerce

Para reemplazar (parcial o totalmente) el mock por integraciones reales y poder defender que el sistema funciona contra plataformas verdaderas — no contra un nginx que sirve fixtures.

---

## Mercado Libre — Test Users (recomendado)

ML **no tiene sandbox** separado; tiene un sistema de **test users** que operan en el ambiente productivo pero aislados entre sí.

### Características clave

- Se pueden crear **hasta 10 test users** por cuenta de developer
- Cada test user es un seller/buyer "ficticio" con credenciales propias
- Los test users **solo pueden interactuar con otros test users** (publican, compran, venden entre ellos — sin afectar el marketplace real)
- **Una vez creado un test user, no se puede borrar ni recuperar** — guardar las credenciales inmediatamente
- Los **webhooks funcionan igual que en producción**, incluyendo el topic `orders_v2`
- **Rate limit**: 1500 req/min por seller (más que suficiente)

### Flujo para integrarlo

1. **Crear cuenta de developer**: https://developers.mercadolibre.com.ar/
2. **Registrar una app** en el panel de desarrolladores:
   - Anotar `client_id` y `client_secret`
   - Configurar **redirect URI** (para OAuth) y **notifications URL** (para los webhooks)
3. **Conseguir un access_token de tu cuenta real** (vía OAuth con scope `read offline_access write`)
4. **Crear test users** con `POST` a la API:
   ```bash
   curl -X POST \
     "https://api.mercadolibre.com/users/test_user?access_token=TU_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"site_id":"MLA"}'   # MLA = Argentina
   ```
   Response trae:
   ```json
   { "id": 123456789, "nickname": "TETE12345678", "password": "qatest1234",
     "site_status": "active", "email": "test_user_xxx@testuser.com" }
   ```
   **Guardar esos datos ya** (no hay endpoint para recuperarlos).
5. **Hacer login con un test user comprador y otro vendedor** en mercadolibre.com.ar usando esas credenciales
6. **Publicar un producto** desde el seller de prueba (vía panel web o API)
7. **Comprarlo** desde el buyer de prueba → ML dispara el webhook `orders_v2` a tu URL

### Bloqueante: webhook URL pública

Tu n8n está en `localhost:5678`. ML necesita una **URL pública HTTPS** para llamarte. Las opciones:

- **ngrok** (gratis, lo más simple): `ngrok http 5678` → te da una URL tipo `https://abc.ngrok-free.app`. La configurás como Notifications Callback URL en el panel de ML.
- **Cloudflare Tunnel** (gratis, sin tiempo límite, requiere dominio): más estable que ngrok free pero más setup.

### Esfuerzo estimado

- Setup developer + app: 30 min
- OAuth flow para token: 30 min
- Crear test users + listings: 30 min
- ngrok + configurar webhook URL en ML: 15 min
- Primera prueba end-to-end: 30 min
- **Total: ~2 horas**

### Ventaja para la tesis

Podés decir: *"el sistema fue probado con la API real de Mercado Libre vía test users, recibiendo webhooks reales de la plataforma, no mocks."* Eso responde directo a la observación CONEAU-style de "¿qué tan representativo es tu dataset?".

---

## WooCommerce — local con Docker (recomendado)

WooCommerce **no tiene sandbox hosted**. Es un plugin de WordPress; cada tienda es independiente. Hay tres caminos:

### A. WordPress + WooCommerce en Docker (recomendado)

Levantar al lado del stack actual:

```yaml
# Agregar a docker-compose.yml
wordpress:
  image: wordpress:latest
  container_name: tfi-wordpress
  depends_on:
    - mysql
  environment:
    WORDPRESS_DB_HOST: mysql
    WORDPRESS_DB_USER: wp
    WORDPRESS_DB_PASSWORD: wppassword
    WORDPRESS_DB_NAME: wordpress
  ports:
    - "8080:80"
  networks:
    - tfi-net

mysql:
  image: mysql:8
  container_name: tfi-mysql
  environment:
    MYSQL_ROOT_PASSWORD: rootpass
    MYSQL_DATABASE: wordpress
    MYSQL_USER: wp
    MYSQL_PASSWORD: wppassword
  volumes:
    - mysql_data:/var/lib/mysql
  networks:
    - tfi-net
```

Después: `docker compose up -d` → abrís `http://localhost:8080` → instalás WordPress + WooCommerce desde el wizard (5-10 min).

**Setup en WordPress**:
1. Instalar plugin "WooCommerce" desde el admin
2. Crear 1-2 productos de prueba
3. Ir a **WooCommerce → Settings → Advanced → REST API** → crear credenciales (consumer key + secret)
4. Ir a **WooCommerce → Settings → Advanced → Webhooks** → crear webhook nuevo:
   - **Topic**: Order created (o updated)
   - **Delivery URL**: `http://n8n:5678/webhook/woocommerce` (red interna entre containers, **no necesita ngrok**)
   - **Status**: Active

**Ventaja**: como WP y n8n viven en la misma red Docker, el webhook llega sin exponer nada a internet.

### B. WordPress Playground (rápido pero efímero)

https://playground.wordpress.net — un WordPress en el navegador, sin instalación. Útil para una demo de 5 minutos pero **el estado se pierde al cerrar la pestaña**. No sirve para tests reproducibles.

### C. InstaWP (sitios temporales gratuitos)

https://instawp.com — crea instancias de WP con un click, expiran en 24-48h en el free tier. Mejor que Playground porque la URL es pública (Webhook → n8n vía ngrok funciona).

### Esfuerzo estimado para A (Docker)

- Agregar servicios a compose: 5 min
- Levantar + wizard de WP: 15 min
- Instalar plugin WooCommerce: 5 min
- Crear producto y configurar webhook: 15 min
- **Total: ~40 min**

### Auth del webhook

WooCommerce manda webhooks **firmados** con HMAC-SHA256 usando un secret que vos definís. En n8n hay que validar la firma (otro Code node al principio del flujo, comparando contra `X-WC-Webhook-Signature` del header).

---

## Recomendación táctica

Para la tesis, **hacer ambos pero en este orden**:

1. **WooCommerce con Docker local primero** (40 min) — porque no necesita ngrok ni cuenta externa, suma multicanal real al panel del MVP, y la firma HMAC del webhook es un caso técnico interesante para mencionar en cap 5.7.
2. **ML test users después** (~2 hs) — para tener la integración con marketplace argentino real, que es lo que dice tu propuesta.

Ambos en paralelo al mock actual: el mock queda como **fallback** si las integraciones externas se caen durante la grabación del video o la defensa.

---

## Cambios necesarios en el workflow para soportarlo

El workflow actual hardcodea `channel = mercadolibre` en `Normalize ML order`. Para multicanal real hay que:

1. **Agregar un nodo Webhook por canal** (uno para ML, otro para WooCommerce con paths distintos: `/webhook/ml-order` y `/webhook/wc-order`)
2. **Adaptadores de normalización separados** — el shape de WooCommerce es muy diferente al de ML (los items vienen en `line_items`, el cliente en `billing`, etc.). Crear `normalize-wc-order.js` aparte
3. **Convergencia**: ambos adaptadores producen la MISMA estructura canónica (`{customer, order, items}`), después de eso el flujo es idéntico
4. **Validación HMAC para WC** al principio de su rama

Para WooCommerce, el normalizador sería algo así (referencia, no hay que ejecutarlo ahora):
```js
const wc = $input.first().json.body;
const customer = {
  external_id: String(wc.customer_id || wc.billing.email),
  channel: 'woocommerce',
  pseudonym: makePseudonym('woocommerce', wc.customer_id),
  full_name: `${wc.billing.first_name} ${wc.billing.last_name}`,
  email: wc.billing.email,
  phone: wc.billing.phone,
  email_hash: sha256(wc.billing.email),
  phone_hash: sha256(wc.billing.phone),
};
const order = {
  external_id: String(wc.id),
  channel: 'woocommerce',
  status: WC_STATUS_MAP[wc.status] || 'error',
  total_amount: Number(wc.total),
  currency: wc.currency,
  source_created_at: wc.date_created,
  raw_payload: wc,
  normalization_version: 'v1',
};
const items = wc.line_items.map(li => ({
  sku: li.sku, product_name: li.name,
  quantity: li.quantity, unit_price: Number(li.price),
  delivery_status: 'pending', metadata: { wc_item_id: li.id }
}));
```

---

## Lo que sí necesitamos confirmar antes de avanzar

- ¿Tenés/tuviste cuenta en Mercado Libre Argentina? (No los datos, solo si existe)
- ¿Querés que armemos el setup WooCommerce ya en la próxima sesión?

Sources:
- [Test users · Mercado Libre](https://global-selling.mercadolibre.com/devsite/start-testing-global-selling)
- [Mercado Libre API Essential Guide](https://rollout.com/integration-guides/mercado-libre/api-essentials)
- [Mercado Libre webhooks](https://rollout.com/integration-guides/mercado-libre/quick-guide-to-implementing-webhooks-in-mercado-libre)
- [WooCommerce REST API docs](https://developer.woocommerce.com/docs/apis/rest-api/)
- [WooCommerce webhooks](https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks/)
- [Testing WooCommerce webhooks locally](https://www.hooklistener.com/guides/woocommerce-webhook-testing)
