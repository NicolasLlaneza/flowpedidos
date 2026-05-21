const CH_NAME = { mercadolibre:'Mercado Libre', whatsapp:'WhatsApp', woocommerce:'Tienda Online', tienda_nube:'Tienda Nube' };
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let busy = false, done = false;

function setToast(txt, cls) {
  const t = $('toast');
  t.className = 'toast ' + (cls || 'show');
  $('toastTxt').innerHTML = txt;
}

function chanCell(ch) {
  return `<span class="chan"><span class="dot ${ch}"></span>${CH_NAME[ch]||ch}</span>`;
}

function addOrderRow(d) {
  const tb = $('orders');
  if (tb.querySelector('.empty')) tb.innerHTML = '';
  const tr = document.createElement('tr');
  tr.className = 'new';
  tr.dataset.key = d.channel + ':' + d.order_external;
  tr.innerHTML = `<td>${chanCell(d.channel)}</td>
    <td>${d.customer_name}</td>
    <td class="prod" title="${d.primary_product}">${d.primary_product}</td>
    <td>$${Number(d.total).toLocaleString('es-AR')}</td>
    <td><span class="st">${d.status}</span></td>`;
  tb.appendChild(tr);
}

async function showMessage(d) {
  const chat = $('chat');
  const empty = $('chatEmpty'); if (empty) empty.remove();
  const typing = $('typing');
  typing.classList.add('show');
  chat.scrollTop = chat.scrollHeight;
  await sleep(1100);
  typing.classList.remove('show');
  const m = d.message;
  const div = document.createElement('div');
  div.className = 'msg' + (m.is_fallback ? ' tpl' : '');
  const tag = m.is_fallback ? 'mensaje de respaldo' : 'generado por IA';
  div.innerHTML = `${m.text}<div class="t"><span>para ${d.customer_name}</span><span>${tag}</span></div>`;
  chat.insertBefore(div, typing);
  chat.scrollTop = chat.scrollHeight;
}

async function refreshStats() {
  const r = await fetch('/api/state'); const s = await r.json();
  $('sOrders').textContent = s.counts.pedidos;
  $('sChannels').textContent = s.counts.canales;
  $('sMsg').textContent = s.counts.mensajes_ia;
}

async function next() {
  if (busy || done) return;
  busy = true; $('btnNext').disabled = true; $('btnReset').disabled = true;
  try {
    const r = await fetch('/api/process', { method:'POST' });
    const d = await r.json();
    if (d.done) { done = true; setToast('Demostración completa. Presioná Reiniciar para repetir.', 'show'); return; }

    if (d.result === 'processed') {
      setToast(`<span class="ico">🛒</span> Nueva venta en <b>${CH_NAME[d.channel]}</b> — ${d.customer_name} compró ${d.primary_product}`);
      await sleep(700);
      addOrderRow(d);
      await refreshStats();
      await showMessage(d);
    } else if (d.result === 'duplicate') {
      setToast(`<span class="ico">🛡️</span> Esa venta ya había entrado. La <b>bloqueamos</b> — a ${d.customer_name||'tu cliente'} no se le cobra dos veces.`, 'dup');
      const row = document.querySelector(`tr[data-key="${d.channel}:${d.order_external}"]`);
      if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
    } else if (d.result === 'rejected') {
      setToast(`<span class="ico">🚫</span> Llegó una notificación <b>incompleta</b>. Se descartó — tus datos quedan limpios.`, 'rej');
    }
  } catch(e) { setToast('Error: ' + e.message, 'rej'); }
  finally {
    busy = false; $('btnReset').disabled = false; $('btnNext').disabled = done;
  }
}

async function reset() {
  await fetch('/api/reset', { method:'POST' });
  done = false;
  $('orders').innerHTML = '<tr><td colspan="5" class="empty">Todavía no entró ninguna venta.</td></tr>';
  $('chat').innerHTML = '<div class="empty" id="chatEmpty">Los mensajes aparecerán acá.</div><div class="typing" id="typing"><span></span><span></span><span></span></div>';
  $('sOrders').textContent='0'; $('sChannels').textContent='0'; $('sMsg').textContent='0';
  $('btnNext').disabled = false;
  setToast('Listo para empezar. Presioná "Simular próxima venta".', 'show');
}

$('btnNext').addEventListener('click', next);
$('btnReset').addEventListener('click', reset);
refreshStats();
