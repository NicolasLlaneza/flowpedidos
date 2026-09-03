// =============================================================================
// FlowPedidos · panel operativo (v1.3)
// -----------------------------------------------------------------------------
// Consume la API read-only expuesta por server.mjs y refleja el estado real
// del pipeline. Auto-refresh cada 5s (con toggle). No dispara pedidos: se
// alimenta de tfi.orders / tfi.ai_notifications / tfi.audit_log que carga n8n.
// =============================================================================

const CH_NAME = { mercadolibre:'Mercado Libre', woocommerce:'WooCommerce', whatsapp:'WhatsApp' };
const ST_NAME = { paid:'Pagado', shipped:'Enviado', delivered:'Entregado',
                  pending_payment:'Pago pendiente', created:'Creado', preparing:'Preparando',
                  cancelled:'Cancelado', refunded:'Reembolsado', error:'Error' };
const EV_NAME = { webhook_received:'Webhook recibido', validation_failed:'Validación fallida',
                  persisted_ok:'Pedido registrado', duplicate_detected:'Duplicado detectado',
                  llm_call_ok:'Mensaje generado por IA', llm_call_failed:'IA falló · fallback',
                  fallback_triggered:'Degradación a plantilla',
                  message_sent:'WhatsApp despachado', no_phone:'Sin teléfono del cliente',
                  dispatch_failed:'Fallo al despachar', error_state:'Estado error · sin mensaje',
                  normalization_warnings:'Advertencias del normalizador' };

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n||0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const money6 = (n) => '$' + Number(n||0).toFixed(6);
const pct = (n) => (Number(n||0) * 100).toFixed(1) + '%';
const fmtMs = (n) => n == null ? '—' : (n < 1000 ? Math.round(n) + ' ms' : (n/1000).toFixed(2) + ' s');

let selected = null;
let refreshTimer = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function chanCell(ch) {
  return `<span class="chan"><span class="dot ${ch}"></span>${CH_NAME[ch]||ch}</span>`;
}

// Badge de estado WhatsApp basado en la fila de ai_notifications
function waBadge(row) {
  if (!row.provider) return '<span class="wa-badge wa-none"><span class="icon">—</span> sin generar</span>';
  const isSim = row.wa_message_id && row.wa_message_id.startsWith('wamid.sim_');
  const sent = row.message_status === 'sent';
  const failed = row.message_status === 'failed';
  const fb = row.is_fallback;
  if (sent && isSim)   return '<span class="wa-badge wa-sim"><span class="icon">✓</span> simulado</span>';
  if (sent && fb)      return '<span class="wa-badge wa-fallback"><span class="icon">⚡</span> plantilla</span>';
  if (sent)            return '<span class="wa-badge wa-sent"><span class="icon">✓</span> enviado</span>';
  if (failed)          return '<span class="wa-badge wa-failed"><span class="icon">✗</span> falló</span>';
  if (fb)              return '<span class="wa-badge wa-fallback"><span class="icon">⚡</span> plantilla</span>';
  return `<span class="wa-badge wa-none"><span class="icon">·</span> ${row.message_status || 'pendiente'}</span>`;
}

async function loadKpis() {
  const k = await api('/api/kpis');
  $('kPedidosHoy').textContent = k.pedidos_hoy;
  $('kPedidosTotal').textContent = k.pedidos_total;
  $('kIngresos').textContent = money(k.ingresos_hoy);
  $('kPendientes').textContent = k.pendientes + ' pendientes';
  $('kEntrega').textContent = Number(k.mensajes_total) > 0 ? pct(k.tasa_entrega) : '—';
  $('kEnviados').textContent = k.mensajes_enviados;
  $('kMensajes').textContent = k.mensajes_total;
  $('kCostoHoy').textContent = money6(k.cost_hoy_usd);
  $('kCostoTotal').textContent = 'acumulado ' + money6(k.cost_total_usd);
  $('kCanales').textContent = k.canales;
  $('kErrores').textContent = k.errores + ' con error';
}

async function loadOrders() {
  const params = new URLSearchParams();
  if ($('fChannel').value) params.set('channel', $('fChannel').value);
  if ($('fStatus').value)  params.set('status',  $('fStatus').value);
  if ($('search').value.trim()) params.set('q', $('search').value.trim());

  const { orders } = await api('/api/orders?' + params.toString());
  const body = $('ordersBody');
  const empty = $('emptyBox');
  $('ordersCount').textContent = orders.length ? `${orders.length} pedido(s)` : '';

  if (!orders.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = orders.map(o => `
    <tr data-id="${o.external_id}" class="${o.external_id === selected ? 'sel' : ''}">
      <td>${chanCell(o.channel)}</td>
      <td>${o.customer_name || '<span style="color:var(--gray)">—</span>'}</td>
      <td class="prod" title="${o.product||''}">${o.product || '—'}</td>
      <td>${money(o.total_amount)}</td>
      <td><span class="st ${o.status}">${ST_NAME[o.status]||o.status}</span></td>
      <td>${waBadge(o)}</td>
    </tr>`).join('');

  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => selectOrder(tr.dataset.id, tr));
  });

  // Si hay uno seleccionado y sigue visible, mantengo el detalle actualizado
  if (selected && orders.find(o => o.external_id === selected)) {
    // refresh detail silently
    refreshDetail(selected);
  }
}

async function selectOrder(id, tr) {
  document.querySelectorAll('#ordersBody tr.sel').forEach(t => t.classList.remove('sel'));
  if (tr) tr.classList.add('sel');
  selected = id;
  await refreshDetail(id);
}

async function refreshDetail(id) {
  const d = await api('/api/orders/' + encodeURIComponent(id));
  renderDetail(d);
}

function renderDetail(d) {
  const o = d.order;
  const n = d.notif;
  const items = d.items.map(i =>
    `<div class="kv"><span>${i.quantity}× ${i.product_name}</span><span>${money(i.unit_price)}</span></div>`
  ).join('');

  // --- Mensaje enviado al cliente
  let msgBlock = '<div class="empty" style="padding:20px 0">No se generó mensaje.</div>';
  if (n) {
    const isSim = n.wa_message_id && n.wa_message_id.startsWith('wamid.sim_');
    const statusLbl = n.message_status === 'sent'
      ? (isSim ? 'despachado en simulación'
                : `despachado por WhatsApp${n.dispatched_at ? ' · ' + new Date(n.dispatched_at).toLocaleTimeString('es-AR') : ''}`)
      : (n.message_status || 'pendiente');
    msgBlock = `
      <div class="msg-card ${n.is_fallback ? 'fallback' : ''}">
        <div class="msg-body">${escapeHtml(n.message_text || '')}</div>
        <div class="msg-meta">
          <span>${statusLbl}</span>
          <span>${n.is_fallback ? 'plantilla determinística' : ('generado por ' + (n.provider || 'IA'))}</span>
        </div>
      </div>`;
  }

  // --- Trazabilidad técnica (colapsable)
  const metrics = n ? `
    <div class="metric-grid">
      <div class="metric ${o.ack_ms != null && o.ack_ms < 500 ? 'ok' : 'warn'}">
        <div class="m-l">ACK</div><div class="m-v">${fmtMs(o.ack_ms)}</div>
      </div>
      <div class="metric ok">
        <div class="m-l">End-to-end</div><div class="m-v">${fmtMs(n.e2e_ms)}</div>
      </div>
      <div class="metric ${n.validator_passes === 1 ? 'ok' : (n.validator_passes === 2 ? 'warn' : '')}">
        <div class="m-l">Validador</div>
        <div class="m-v">${n.validator_passes != null ? 'pass ' + n.validator_passes : '—'}</div>
      </div>
      <div class="metric">
        <div class="m-l">Costo LLM</div>
        <div class="m-v">${n.cost_usd != null ? money6(n.cost_usd) : '—'}</div>
      </div>
    </div>
    <div class="kv"><span>Provider</span><span>${n.provider || '—'} ${n.model ? '· ' + n.model : ''}</span></div>
    ${n.prompt_tokens != null ? `<div class="kv"><span>Tokens</span><span>${n.prompt_tokens} prompt · ${n.completion_tokens} completion</span></div>` : ''}
    ${n.atributos_usados && n.atributos_usados.length ? `<div class="kv"><span>Atributos citados</span><span>${n.atributos_usados.join(', ')}</span></div>` : ''}
    ${n.wa_message_id ? `<div class="kv"><span>wa_message_id</span><span style="font-family:monospace;font-size:11px;color:var(--dim)">${n.wa_message_id.slice(0,32)}${n.wa_message_id.length>32?'…':''}</span></div>` : ''}
    ${n.validator_failures && n.validator_failures.length ? `<div class="kv"><span>Reglas violadas</span><span style="color:var(--amber)">${n.validator_failures.length}</span></div>` : ''}
  ` : '<div class="kv"><span style="color:var(--gray)">Sin datos de generación de mensaje</span></div>';

  // Timeline del audit_log
  const tl = d.audit.map(a => {
    const cls = a.severity === 'error' ? 'err' : (a.severity === 'warning' ? 'warn' : '');
    const t = new Date(a.created_at).toLocaleTimeString('es-AR');
    return `<li class="${cls}"><span class="ev">${EV_NAME[a.event_type]||a.event_type}</span>
              <span class="tm">${t}</span>
              <span class="comp">${a.component || ''}</span></li>`;
  }).join('') || '<li style="color:var(--gray)">Sin eventos en audit_log</li>';

  $('detail').innerHTML = `
    <div class="dh">Pedido #${(o.external_id || '').slice(-8)}</div>
    <div class="dsub">
      ${chanCell(o.channel)}
      <span>&middot;</span>
      <span>${new Date(o.received_at).toLocaleString('es-AR')}</span>
    </div>

    <div class="sect">
      <div class="lbl">Cliente</div>
      <div class="kv"><span>Nombre</span><span>${o.customer_name || '—'}</span></div>
      <div class="kv"><span>Seudónimo (uso interno)</span><span style="font-family:monospace;font-size:11px">${o.pseudonym || '—'}</span></div>
      <div class="privacy">Al generar el mensaje, el LLM recibe sólo atributos del pedido — nunca nombre, correo, teléfono ni pseudónimo. La identidad se rehidrata localmente después del validador (§4.3.1).</div>
    </div>

    <div class="sect">
      <div class="lbl">Productos</div>
      ${items || '<div class="kv"><span>Sin productos</span><span></span></div>'}
      <div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px">
        <span><b>Total</b></span><span><b>${money(o.total_amount)} ${o.currency}</b></span>
      </div>
    </div>

    <div class="sect">
      <div class="lbl">Mensaje enviado al cliente</div>
      ${msgBlock}
    </div>

    <div class="sect">
      <button class="tech-toggle" id="btnTech">▶ Trazabilidad técnica</button>
      <div class="tech-body" id="techBody">
        ${metrics}
        <div class="lbl" style="margin-top:14px">Timeline (audit_log)</div>
        <ul class="tl">${tl}</ul>
      </div>
    </div>`;

  // Toggle plegable
  const btn = $('btnTech');
  const body = $('techBody');
  btn.addEventListener('click', () => {
    const isOpen = body.classList.toggle('open');
    btn.textContent = (isOpen ? '▼' : '▶') + ' Trazabilidad técnica';
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function refreshAll() {
  try {
    await Promise.all([loadKpis(), loadOrders()]);
    $('statusText').textContent = 'Sistema activo · ' + new Date().toLocaleTimeString('es-AR');
  } catch (e) {
    $('statusText').textContent = 'Error de conexión';
    console.error(e);
  }
}

async function reset() {
  if (!confirm('¿Vaciar TODOS los pedidos del panel? (TRUNCATE tfi.*)')) return;
  await api('/api/reset', { method: 'POST' });
  selected = null;
  $('detail').innerHTML = '<div class="empty">Base vaciada.</div>';
  await refreshAll();
}

// Auto-refresh --------------------------------------------------------------
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(refreshAll, 5000);
}
function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

// Filtros con debounce ------------------------------------------------------
let debounceT;
function onFilter() { clearTimeout(debounceT); debounceT = setTimeout(loadOrders, 250); }

$('btnReset').addEventListener('click', reset);
$('btnRefresh').addEventListener('click', refreshAll);
$('search').addEventListener('input', onFilter);
$('fChannel').addEventListener('change', loadOrders);
$('fStatus').addEventListener('change', loadOrders);
$('autoRefresh').addEventListener('change', (e) => {
  if (e.target.checked) startAutoRefresh(); else stopAutoRefresh();
});

refreshAll();
startAutoRefresh();
