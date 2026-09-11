# Tablero operativo del pipeline

Tablero mínimo de monitoreo sobre `tfi.v_order_summary` y `tfi.ai_notifications`,
sin dependencias ni build: un único HTML con SVG dibujado a mano.

Responde a la recomendación de monitoreo de la sección 7.1 del TFI.

## Uso

```bash
# 1. Generar los datos desde la base (opcional: --dataset limita al dataset sintético)
cd scripts/dashboard
node export-dashboard-data.mjs

# 2. Servirlo (el fetch del JSON no funciona con file://)
python3 -m http.server 8090
# abrir http://localhost:8090/scripts/dashboard/ desde la raíz del repo,
# o http://localhost:8090/ desde este directorio
```

Si `dashboard-data.json` no existe, el tablero cae a los datos embebidos de la
corrida definitiva ampliada, de modo que abrir `index.html` directamente
(incluso con `file://`) muestra siempre algo válido.

## Qué muestra

- **Indicadores**: tiempo de confirmación al emisor contra el límite de 500 ms de
  la plataforma de origen, tasa de normalización al modelo canónico, mediana y
  percentiles del tiempo de extremo a extremo, mensajes generados y degradaciones
  a plantilla, aprobación del validador determinístico y costo del modelo.
- **Pedidos por estado canónico y canal de origen**: barras apiladas, un segmento
  por plataforma.
- **Distribución del tiempo de extremo a extremo**: histograma en bins de 100 ms
  con mediana, p90 y p95 marcados.

Cada gráfico trae tooltip al pasar el mouse y una tabla equivalente desplegable.
El tablero respeta el modo claro y oscuro del sistema.
