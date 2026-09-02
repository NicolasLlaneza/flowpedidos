# Runbook · Bloque C — Cuentas test end-to-end

Instrucciones para dejar el pipeline listo para la corrida definitiva con
tráfico real de los dos canales (Mercado Libre y WooCommerce) sobre cuentas
de prueba. Combina pasos automatizables (scripts en este directorio) y
pasos manuales que requieren tu login en cada plataforma.

Todo lo automatizable corre desde `scripts/`. Todos los pasos manuales
están numerados y aislados abajo — no hay decisiones ocultas.

---

## Prerequisitos

Estos valores deben estar en `.env` antes de empezar. El script
`scripts/env-check.mjs` los valida:

| Variable | De dónde sale | Se usa en |
|---|---|---|
| `NGROK_AUTHTOKEN` | dashboard.ngrok.com → Auth → Your Authtoken | container `ngrok` |
| `NGROK_STATIC_DOMAIN` | dashboard.ngrok.com → Domains → New Domain (gratuito) | mismo, opcional |
| `WC_ADMIN_USER` / `WC_ADMIN_PASSWORD` | credenciales del WordPress local (http://localhost:8080/wp-admin) | scripts WC |
| `WC_CONSUMER_KEY` / `WC_CONSUMER_SECRET` | WooCommerce → Settings → Advanced → REST API → Add key (Read/Write) | scripts WC |
| `WC_WEBHOOK_SECRET` | ya está en .env, generado en la sesión de junio | validación firma en n8n |
| `ML_APP_CLIENT_ID` / `ML_APP_CLIENT_SECRET` | developers.mercadolibre.com.ar → Tus aplicaciones → Crear/editar | scripts ML |
| `ML_ACCESS_TOKEN` | resultado del flujo OAuth (script lo obtiene) | scripts ML |

---

## WooCommerce (C-WC)

WooCommerce ya corre en Docker (`tfi-wordpress`, `tfi-mysql`) en la red
interna `tfi-net`. El webhook viaja por red privada — no requiere ngrok.

### Paso 1 (manual, una vez): inicializar WordPress si es primera corrida

1. Abrir http://localhost:8080/wp-admin/install.php
2. Idioma → Español (Argentina)
3. Título del sitio: `Neumáticos Mendoza (test)`, usuario admin: `admin`,
   password: cualquiera (guardarla en `.env` como `WC_ADMIN_PASSWORD`),
   email cualquiera.
4. Instalar WordPress → Login.
5. Plugins → Añadir nuevo → buscar "WooCommerce" → Instalar → Activar.
6. Setup wizard de WC → moneda ARS, tienda Argentina, saltar
   integraciones opcionales.

### Paso 2 (manual, una vez): crear REST API key

1. WooCommerce → Ajustes → Avanzado → API REST → Añadir clave.
2. Descripción: `pipeline tfi`, Usuario: admin, Permisos: **Lectura/Escritura**.
3. Generar → copiar `Consumer key` y `Consumer secret` → guardar en `.env`
   como `WC_CONSUMER_KEY` y `WC_CONSUMER_SECRET`.

### Paso 3 (automatizable): registrar webhook + producto de prueba

```bash
node scripts/wc-setup.mjs
```

El script hace, de forma idempotente:

- Verifica que exista un webhook activo con `topic=order.updated` apuntando
  a `http://n8n:5678/webhook/wc-order` (URL interna Docker). Si falta, lo
  crea con el secret de `.env`.
- Crea (o actualiza) un producto simple `PIR-P7-TEST` de $85.000 ARS,
  con stock, listo para checkout.
- Imprime el `product_id` para usarlo en el simulador de checkout.

### Paso 4 (automatizable): simular un pedido real

```bash
node scripts/wc-simulate-checkout.mjs --status processing
```

Crea un pedido vía REST API con estado `processing` (= canonical `paid`).
El webhook de WC dispara el pipeline y el pedido queda en `tfi.orders`.

Otros valores válidos de `--status`: `pending`, `on-hold`, `completed`,
`cancelled`, `refunded`, `failed`. Cada uno ejercita una rama distinta
del mapeo `WC_STATUS → canonical` en `lib/normalize-wc-order.js`.

---

## Mercado Libre (C-ML)

ML sí requiere URL pública porque su plataforma emite las notificaciones
desde infraestructura propia. Se resuelve con **ngrok** — un container
opcional del docker-compose (perfil `ml-test`).

### Paso 1 (manual, una vez): app en developers.mercadolibre.com.ar

1. Ir a https://developers.mercadolibre.com.ar/panel → Iniciar sesión.
2. Tus aplicaciones → Crear aplicación.
3. Datos:
   - Nombre: `flowpedidos-test`
   - Descripción corta: `Pipeline TFI · corrida definitiva`
   - URL del sitio: `http://localhost:5678`
   - URI de redirección: `http://localhost:5678/rest/oauth2-credential/callback` (temporal)
   - Tópicos: marcar **orders_v2**
   - Scopes: `read`, `offline_access`
4. Guardar → copiar `App ID` y `Secret Key` → guardar en `.env` como
   `ML_APP_CLIENT_ID` y `ML_APP_CLIENT_SECRET`.

### Paso 2 (automatizable): levantar ngrok

```bash
docker compose --profile ml-test up -d ngrok
```

Verificar en http://localhost:4040 (inspector) el dominio público
asignado, por ejemplo `https://xyz.ngrok-free.app`. Si tenés un
`NGROK_STATIC_DOMAIN` configurado en `.env`, será ese.

Actualizar la app de ML: developers.mercadolibre.com.ar → tu app →
editar → **URI de notificaciones**: `https://<tu-dominio>.ngrok-free.app/webhook/ml-order`.
Guardar.

### Paso 3 (automatizable): crear test users y obtener token

```bash
node scripts/ml-setup.mjs
```

El script hace:

- Flujo OAuth guiado: abre en tu navegador la URL de autorización, te pide
  pegar el `code` que devuelve ML y hace el intercambio por
  `access_token` + `refresh_token`. Los persiste en `.env`.
- Crea dos test users (comprador + vendedor) vía `POST /users/test_user`.
- Imprime credenciales de ambos (site_status, nickname, password, email
  interno de ML). Se guardan en `scripts/.ml-testusers.json` (git-ignored).

### Paso 4 (manual): hacer una compra desde el buyer

1. Abrir una ventana privada en el navegador.
2. Ir a https://www.mercadolibre.com.ar → login con las credenciales del
   test user comprador.
3. Buscar una publicación del test user vendedor (o crear una con el
   seller antes, ver `scripts/ml-publish-item.mjs` como ayuda futura).
4. Comprar. ML dispara `orders_v2` → ngrok → n8n `/webhook/ml-order`.
5. Verificar en el inspector de ngrok (http://localhost:4040) el POST
   entrante, en `tfi-postgres` la fila en `raw_events` y en
   `tfi.orders` la orden persistida.

---

## Verificación final

```bash
node scripts/verify-end-to-end.mjs
```

Imprime, sobre las últimas 10 corridas del pipeline:
- Latencia `received_at → ack_at` (bloque B1)
- Latencia `received_at → dispatched_at` (bloque B5)
- `validator_passes` y `validator_failures` (bloque B3)
- `cost_usd` real desde tokens (bloque B4)
- Distribución por canal (mercadolibre / woocommerce)

Si estos números están, la corrida definitiva está lista.
