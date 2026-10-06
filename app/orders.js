/* Заказы и клиенты: localStorage + /api, те же ключи, что у админки. */

const ORDERS_KEY = 'sabina.orders.v1';
const CLIENTS_KEY = 'sabina.clients.v1';
const OUTBOX_KEY = 'sabina.outbox.v1';

function readOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function writeOutbox(list) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn('localStorage outbox', e);
    return false;
  }
}

function outboxKey(item) {
  if (!item) return '';
  if (item.method === 'POST' && item.url === '/api/orders' && item.body && item.body.id) {
    return 'order:' + item.body.id;
  }
  if (item.method === 'POST' && item.url === '/api/clients' && item.body) {
    return 'client:' + (item.body.phone || item.body.id || '');
  }
  return (item.method || '') + ' ' + (item.url || '');
}

function sameBody(a, b) {
  try { return JSON.stringify(a && a.body) === JSON.stringify(b && b.body); }
  catch (e) { return false; }
}

function remember(item) {
  const key = outboxKey(item);
  const q = readOutbox().filter((x) => outboxKey(x) !== key);
  q.push(item);
  writeOutbox(q);
}

function forget(item) {
  const key = outboxKey(item);
  writeOutbox(readOutbox().filter((x) => outboxKey(x) !== key || !sameBody(x, item)));
}

function sendOnce(item) {
  const hasBody = item.body != null;
  return fetch(item.url, {
    method: item.method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(item.body) : undefined
  }).then((r) => {
    if ((item.method === 'DELETE' || item.method === 'PATCH') && r.status === 404) return;
    if (!r.ok) {
      return r.json().catch(() => ({})).then((data) => {
        const err = new Error('http');
        err.status = r.status;
        err.code = data && data.error;
        throw err;
      });
    }
  });
}

function dropSettled(item, err) {
  if (!err) { forget(item); return; }
  if (err.status === 404 && (item.method === 'DELETE' || item.method === 'PATCH')) forget(item);
  if (err.status === 400 || err.status === 409 || err.status === 413) forget(item);
}

function deliver(item) {
  remember(item);
  function attempt(n) {
    return sendOnce(item).then(() => {
      forget(item);
      return true;
    }).catch((err) => {
      if (err && (err.status === 400 || err.status === 409 || err.status === 413 || (err.status === 404 && (item.method === 'DELETE' || item.method === 'PATCH')))) {
        dropSettled(item, err);
        if (err.code === 'catalog unavailable') return 'blocked';
        return 'rejected';
      }
      if (n < 2) {
        return new Promise((ok) => { setTimeout(ok, 400 * (n + 1)); }).then(() => attempt(n + 1));
      }
      return false;
    });
  }
  return attempt(0);
}

let flushing = null;

function flushOutbox() {
  if (flushing) return flushing;
  const q = readOutbox().slice();
  if (!q.length) return Promise.resolve();
  let chain = Promise.resolve();
  q.forEach((item) => {
    chain = chain.then(() => sendOnce(item).then(() => { forget(item); }).catch((err) => { dropSettled(item, err); }));
  });
  flushing = chain.then(() => { flushing = null; }, () => { flushing = null; });
  return flushing;
}

flushOutbox();
window.addEventListener('online', () => { flushOutbox(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushOutbox();
});
setInterval(() => {
  if (readOutbox().length) flushOutbox();
}, 20000);

function flattenCrmList(node, out) {
  if (out == null) out = [];
  if (node == null || typeof node === 'string') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => flattenCrmList(item, out));
    return out;
  }
  if (typeof node === 'object') {
    const hasId = node.id != null && String(node.id) !== '';
    if (Object.prototype.hasOwnProperty.call(node, 'value') && !hasId) {
      return flattenCrmList(node.value, out);
    }
    if (hasId) out.push(node);
  }
  return out;
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function phoneKey(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

function loadLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? flattenCrmList(JSON.parse(raw)) : [];
  } catch (e) { return []; }
}

function saveLocal(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn('localStorage ' + key, e);
    return false;
  }
}

function upsertClient(order) {
  if (!order) return;
  const phone = phoneKey(order.clientPhone);
  const name = String(order.clientName || '').trim();
  if (!phone && !name) return;

  const list = loadLocal(CLIENTS_KEY);
  const rawContact = String(order.clientPhone || '').trim().toLowerCase();
  let idx = -1;
  if (phone) {
    idx = list.findIndex((c) => phoneKey(c.phone) === phone);
  } else if (rawContact) {
    idx = list.findIndex((c) => String(c.phoneDisplay || '').trim().toLowerCase() === rawContact);
  } else {
    const nameKey = name.toLowerCase();
    idx = list.findIndex((c) => !phoneKey(c.phone) && String(c.name || '').trim().toLowerCase() === nameKey);
  }

  const now = new Date().toISOString();
  let client;
  if (idx >= 0) {
    client = list[idx];
    if (name) {
      client.name = name;
      client.nameAt = order.createdAt || now;
    }
    if (phone) {
      client.phone = phone;
      client.phoneDisplay = order.clientPhone || client.phoneDisplay || ('+' + phone);
    } else if (order.clientPhone) {
      client.phoneDisplay = order.clientPhone;
    }
    client.updatedAt = now;
    client.lastOrderAt = order.createdAt || now;
    list.splice(idx, 1);
    list.unshift(client);
  } else {
    client = {
      id: newId('c'),
      phone,
      phoneDisplay: order.clientPhone || (phone ? '+' + phone : ''),
      name: name || 'Без имени',
      nameAt: order.createdAt || now,
      createdAt: order.createdAt || now,
      updatedAt: now,
      lastOrderAt: order.createdAt || now,
      notes: '',
      hidden: false
    };
    list.unshift(client);
  }

  saveLocal(CLIENTS_KEY, list);
  deliver({ url: '/api/clients', method: 'POST', body: client });
}

export const ORDER_UNAVAILABLE = 'Оформление заказа временно недоступно. Свяжитесь с нами в WhatsApp';

function catalogCovers(order, products) {
  const source = String((order && order.source) || '');
  if (source === 'contact') return true;
  if (!Array.isArray(products) || !products.length) return false;
  const known = {};
  products.forEach((p) => { if (p && p.id) known[p.id] = true; });
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return false;
  return items.every((it) => it && it.id && it.id !== 'lead' && known[it.id]);
}

export function saveOrder(order, products) {
  if (!catalogCovers(order, products)) {
    return { order, synced: Promise.resolve('blocked') };
  }
  const list = loadLocal(ORDERS_KEY).map((o) => {
    if (!o) return o;
    if (!Array.isArray(o.items)) o.items = o.items ? [o.items] : [];
    return o;
  });
  if (!list.some((o) => o && o.id === order.id)) list.unshift(order);
  saveLocal(ORDERS_KEY, list);
  try { upsertClient(order); } catch (e) {}
  const synced = deliver({ url: '/api/orders', method: 'POST', body: order });
  return { order, synced };
}

export function saveLead(fields) {
  const message = String((fields && fields.message) || '').trim();
  const order = {
    id: newOrderId(),
    createdAt: new Date().toISOString(),
    clientName: String((fields && fields.clientName) || '').trim() || 'Без имени',
    clientPhone: String((fields && fields.clientPhone) || '').trim(),
    items: [{
      id: 'lead',
      name: message || 'Заявка с сайта',
      size: '',
      qty: 1,
      price: 0,
      currency: 'kzt',
      unitLabel: '',
      lineKzt: 0
    }],
    totalKzt: 0,
    totalLabel: (fields && fields.totalLabel) || 'Заявка',
    currency: 'kzt',
    messenger: 'whatsapp',
    status: 'new',
    source: (fields && fields.source) || 'contact'
  };
  return saveOrder(order);
}

export function newOrderId() {
  return newId('o');
}
