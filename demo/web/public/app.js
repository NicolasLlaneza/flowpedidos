const CH_NAME = { mercadolibre:'Mercado Libre', whatsapp:'WhatsApp', woocommerce:'Tienda Online', tienda_nube:'Tienda Nube' };
const ST_NAME = { paid:'Pagado', shipped:'Enviado', delivered:'Entregado', pending_payment:'Pago pendiente', created:'Creado', preparing:'Preparando', cancelled:'Cancelado', refunded:'Reembolsado', error:'Error' };
const EV_NAME = { webhook_received:'Webhook recibido', validation_failed:'Validación fallida', persisted_ok:'Pedido registrado', duplicate_detected:'Duplicado detectado', llm_call_ok:'Mensaje generado por IA', fallback_triggered:'Degradación a plantilla' };

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n||0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
let selected = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function chanCell(ch) {
  return `<span class="chan"><span class="dot ${ch}"></span>${CH_NAME[ch]||ch}</span>`;
}

async function loadKpis() {
  const k = await api('/api/kpis');
  $('kPedidos').textContent = k.pedidos;
  $('kIngresos').textContent = money(k.ingresos);
  $('kPendientes').textContent = k.pendientes;
  $('kMensajes').textContent = k.mensajes;
  $('kCanales').textContent = k.canales;
}

async function loadOrders() {
  const params = new URLSearchParams();
  if ($('fChannel').value) params.set('channel', $('fChannel').value);
  if ($('fStatus').value) params.set('status', $('fStatus').value);
  if ($('search').value.trim()) params.set('q', $('search').value.trim());
  const { orders } = await api('/api/orders?' + params.toString());

  const body = $('ordersBody');
  const seedbox = $('seedbox');
  $('ordersCount').textContent = orders.length ? `${orders.length} pedido(s)` : '';

  if (!orders.length) {
    body.innerHTML = '';
    seedbox.style.display = 'block';
    return;
  }
  seedbox.style.display = 'none';
  body.innerHTML = orders.map(o => `
    <tr data-id="${o.external_id}">
      <td>${chanCell(o.channel)}</td>
      <td>${o.customer_name || '—'}</td>
      <td class="prod" title="${o.product||''}">${o.product || '—'}</td>
      <td>${money(o.total_amount)}</td>
      <td><span class="st ${o.status}">${ST_NAME[o.status]||o.status}</span></td>
    </tr>`).join('');

  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => selectOrder(tr.dataset.id, tr));
  });
}

async function selectOrder(id, tr) {
  document.querySelectorAll('#ordersBody tr.sel').forEach(t => t.classList.remove('sel'));
  if (tr) tr.classList.add('sel');
  selected = id;
  const d = await api('/api/orders/' + encodeURIComponent(id));
  const o = d.order;
  const items = d.items.map(i => `<div class="kv"><span>${i.quantity}× ${i.product_name}</span><span>${money(i.unit_price)}</span></div>`).join('');
  const msg = d.notif ? `
    <div class="msg ${d.notif.is_fallback?'tpl':''}">
      ${d.notif.message_text}
      <div class="tag"><span>${d.notif.is_fallback?'plantilla de respaldo':'generado por IA ('+(d.notif.model||'')+')'}</span><span>${d.notif.latency_ms?d.notif.latency_ms+' ms':''}</span></div>
    </div>` : '<div class="empty">Sin mensaje</div>';
  const tl = d.audit.map(a => {
    const cls = a.severity==='error'?'err':a.severity==='warning'?'warn':'';
    const t = new Date(a.created_at).toLocaleTimeString('es-AR');
    return `<li class="${cls}"><span class="ev">${EV_NAME[a.event_type]||a.event_type}</span> <span class="tm">${t}</span></li>`;
  }).join('');

  $('detail').innerHTML = `
    <div class="dh">Pedido #${o.external_id.slice(-6)}</div>
    <div class="dsub">${chanCell(o.channel)} &nbsp;·&nbsp; ${new Date(o.received_at).toLocaleString('es-AR')}</div>

    <div class="sect">
      <div class="lbl">Cliente</div>
      <div class="kv"><span>Nombre</span><span>${o.customer_name||'—'}</span></div>
      <div class="kv"><span>Seudónimo (uso interno)</span><span>${o.pseudonym||'—'}</span></div>
      <div class="privacy">Al generar el mensaje, la IA recibe solo el seudónimo — nunca nombre, email ni teléfono.</div>
    </div>

    <div class="sect">
      <div class="lbl">Productos</div>
      ${items || '<div class="kv"><span>Sin productos</span><span></span></div>'}
      <div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px"><span><b>Total</b></span><span><b>${money(o.total_amount)} ${o.currency}</b></span></div>
    </div>

    <div class="sect">
      <div class="lbl">Mensaje enviado al cliente</div>
      ${msg}
    </div>

    <div class="sect">
      <div class="lbl">Trazabilidad</div>
      <ul class="tl">${tl||'<li>Sin eventos</li>'}</ul>
    </div>`;
}

async function refreshAll() {
  await Promise.all([loadKpis(), loadOrders()]);
}

async function seed() {
  $('btnSeed').disabled = true; $('btnSeed').textContent = 'Cargando…';
  const sb = $('btnSeed2'); if (sb) { sb.disabled = true; sb.textContent = 'Cargando…'; }
  try {
    await api('/api/seed', { method: 'POST' });
    await refreshAll();
  } catch (e) { alert('Error al cargar: ' + e.message); }
  finally { $('btnSeed').disabled = false; $('btnSeed').textContent = 'Cargar pedidos'; }
}

async function reset() {
  if (!confirm('¿Vaciar todos los pedidos del panel?')) return;
  await api('/api/reset', { method: 'POST' });
  selected = null;
  $('detail').innerHTML = '<div class="empty">Seleccioná un pedido de la lista para ver su detalle.</div>';
  await refreshAll();
}

// debounce para la búsqueda
let t;
function onFilter() { clearTimeout(t); t = setTimeout(loadOrders, 250); }

$('btnSeed').addEventListener('click', seed);
$('btnReset').addEventListener('click', reset);
$('btnRefresh').addEventListener('click', refreshAll);
$('search').addEventListener('input', onFilter);
$('fChannel').addEventListener('change', loadOrders);
$('fStatus').addEventListener('change', loadOrders);
const sb2 = $('btnSeed2'); if (sb2) sb2.addEventListener('click', seed);

refreshAll();
