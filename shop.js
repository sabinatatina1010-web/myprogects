/* ══════════════════════════════════════════════════════════
   Магазин: каталог, корзина и заказ в мессенджер
   ══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var CATALOG_KEY = 'sabina.catalog.v4';
  var CART_KEY    = 'sabina.cart.v1';
  var CUR_KEY     = 'sabina.currency.v1';
  var ORDERS_KEY  = 'sabina.orders.v1';
  var CLIENTS_KEY = 'sabina.clients.v1';
  var CFG         = window.SHOP || {};
  var OUTBOX_KEY  = 'sabina.outbox.v1';
  var TOKEN_KEY   = 'sabina.admin.token';

  function adminHeaders(withJson) {
    var h = {};
    if (withJson) h['Content-Type'] = 'application/json';
    try {
      var token = sessionStorage.getItem(TOKEN_KEY);
      if (token) h['X-Admin-Token'] = token;
    } catch (e) {}
    return h;
  }

  function readOutbox() {
    try {
      var raw = localStorage.getItem(OUTBOX_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeOutbox(list) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function outboxKey(item) {
    if (!item) return '';
    if (item.method === 'POST' && item.url === '/api/orders' && item.body && item.body.id) {
      return 'order:' + item.body.id;
    }
    if (item.method === 'POST' && item.url === '/api/clients' && item.body) {
      return 'client:' + (item.body.phone || item.body.id || '');
    }
    if (item.url === '/api/catalog') return 'catalog';
    return (item.method || '') + ' ' + (item.url || '');
  }

  function sameBody(a, b) {
    try { return JSON.stringify(a && a.body) === JSON.stringify(b && b.body); }
    catch (e) { return false; }
  }

  function remember(item) {
    var key = outboxKey(item);
    var q = readOutbox().filter(function (x) { return outboxKey(x) !== key; });
    q.push(item);
    writeOutbox(q);
  }

  function forget(item) {
    var key = outboxKey(item);
    writeOutbox(readOutbox().filter(function (x) {
      return outboxKey(x) !== key || !sameBody(x, item);
    }));
  }

  function sendOnce(item) {
    var hasBody = item.body != null;
    return fetch(item.url, {
      method: item.method,
      headers: adminHeaders(hasBody),
      body: hasBody ? JSON.stringify(item.body) : undefined
    }).then(function (r) {
      if ((item.method === 'DELETE' || item.method === 'PATCH') && r.status === 404) return;
      if (r.status === 409) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          var err = new Error('conflict');
          err.status = 409;
          err.data = data;
          throw err;
        });
      }
      if (!r.ok) {
        var err = new Error('http');
        err.status = r.status;
        throw err;
      }
    });
  }

  function dropSettled(item, err) {
    if (!err) { forget(item); return true; }
    if (err.status === 409) {
      if (item.url === '/api/catalog' && err.data && window.ShopData && window.ShopData.applyServer) {
        window.ShopData.applyServer(err.data);
      }
      forget(item);
      return false;
    }
    if (err.status === 404 && (item.method === 'DELETE' || item.method === 'PATCH')) {
      forget(item);
      return true;
    }
    if (err.status === 400 || err.status === 413) { forget(item); return false; }
    return null;
  }

  function deliver(item) {
    remember(item);
    function attempt(n) {
      return sendOnce(item).then(function () {
        forget(item);
        return true;
      }).catch(function (err) {
        var settled = dropSettled(item, err);
        if (settled !== null) {
          if (err && (err.status === 400 || err.status === 409 || err.status === 413)) return 'rejected';
          return settled;
        }
        if (n < 2) {
          return new Promise(function (ok) { setTimeout(ok, 400 * (n + 1)); })
            .then(function () { return attempt(n + 1); });
        }
        return false;
      });
    }
    return attempt(0);
  }

  var flushing = null;
  function flushOutbox() {
    if (flushing) return flushing;
    var q = readOutbox().slice();
    if (!q.length) return Promise.resolve();
    var chain = Promise.resolve();
    q.forEach(function (item) {
      chain = chain.then(function () {
        return sendOnce(item).then(function () {
          forget(item);
        }).catch(function (err) {
          dropSettled(item, err);
        });
      });
    });
    flushing = chain.then(function () { flushing = null; }, function () { flushing = null; });
    return flushing;
  }

  window.SabinaSync = { send: deliver, flush: flushOutbox, headers: adminHeaders };
  flushOutbox();
  window.addEventListener('online', function () { flushOutbox(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') flushOutbox();
  });
  setInterval(function () {
    if (readOutbox().length) flushOutbox();
  }, 20000);

  var CURRENCIES = {
    kzt: { code: 'kzt', symbol: '₸', label: 'тенге', round: 0 },
    rub: { code: 'rub', symbol: '₽', label: 'руб.', round: 0 },
    usd: { code: 'usd', symbol: '$', label: 'USD', round: 2 }
  };

  function loadCurrency() {
    try {
      var saved = localStorage.getItem(CUR_KEY);
      if (saved && CURRENCIES[saved]) return saved;
    } catch (e) {}
    var def = CFG.currency || 'kzt';
    return CURRENCIES[def] ? def : 'kzt';
  }

  var currency = loadCurrency();

  var serverCatalogReady = false;

  function rates() {
    var src = (CFG && CFG.rates) || {};
    var out = { kzt: 1 };
    ['kzt', 'rub', 'usd'].forEach(function (code) {
      var n = Number(src[code]);
      if (n > 0) out[code] = n;
    });
    out.kzt = 1;
    return out;
  }

  function formatAmount(val, code) {
    var meta = CURRENCIES[code] || CURRENCIES.kzt;
    var n = meta.round === 0 ? Math.round(val) : Math.round(val * 100) / 100;
    var s = meta.round === 0 ? String(n) : n.toFixed(2);
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return code === 'usd' ? meta.symbol + s : s + ' ' + meta.symbol;
  }

  function normalize(p) {
    return {
      id: p.id,
      name: p.name || '',
      tag: p.tag || '',
      size: p.size || '',
      desc: p.desc || '',
      price: Number(p.price) || 0,
      old: Number(p.old) || 0,
      currency: CURRENCIES[p.currency] ? p.currency : 'kzt',
      qty: (p.qty == null || p.qty === '') ? null : Math.max(0, Math.round(Number(p.qty) || 0)),
      type: p.type === 'Услуга' ? 'Услуга' : 'Товар',
      img: p.img || '',
      hit: !!p.hit,
      active: p.active !== false
    };
  }

  var catalogStamp = '';
  var catalogGen = 0;
  var catalogChain = Promise.resolve();

  /* ─── Хранилище каталога (им же пользуется админка) ─── */
  var Data = window.ShopData = {

    load: function () {
      try {
        var raw = localStorage.getItem(CATALOG_KEY);
        if (raw) {
          var list = JSON.parse(raw);
          if (Array.isArray(list)) return list.map(normalize);
        }
      } catch (e) { /* хранилище недоступно */ }
      return [];
    },

    save: function (list) {
      try {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(list));
      } catch (e) {
        return false;
      }
      catalogGen += 1;
      var snapshot;
      try { snapshot = JSON.parse(JSON.stringify(list)); }
      catch (e2) { snapshot = list; }
      catalogChain = catalogChain.catch(function () { return null; }).then(function () {
        var updatedAt = new Date().toISOString();
        return deliver({
          url: '/api/catalog',
          method: 'PUT',
          body: { products: snapshot, baseUpdatedAt: catalogStamp, updatedAt: updatedAt }
        }).then(function (ok) {
          if (ok) catalogStamp = updatedAt;
        });
      });
      return true;
    },

    setStamp: function (stamp) {
      catalogStamp = stamp || '';
    },

    applyServer: function (data) {
      catalogGen += 1;
      catalogStamp = (data && data.updatedAt) || '';
      var list = data && Array.isArray(data.products) ? data.products.map(normalize) : [];
      try { localStorage.setItem(CATALOG_KEY, JSON.stringify(list)); } catch (e) {}
      if (typeof Data.onConflict === 'function') Data.onConflict(list);
      return list;
    },

    pull: function () {
      var gen = catalogGen;
      return fetch('/api/catalog', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('no api');
          return r.json();
        })
        .then(function (data) {
          if (gen !== catalogGen) return null;
          if (!data || !Array.isArray(data.products)) {
            serverCatalogReady = false;
            return null;
          }
          catalogStamp = data.updatedAt || '';
          var norm = data.products.map(normalize);
          try { localStorage.setItem(CATALOG_KEY, JSON.stringify(norm)); } catch (e) {}
          serverCatalogReady = norm.length > 0;
          return norm;
        })
        .catch(function () {
          serverCatalogReady = false;
          return null;
        });
    },

    serverReady: function () {
      return serverCatalogReady;
    },

    reset: function () {
      try { localStorage.removeItem(CATALOG_KEY); } catch (e) {}
    },

    /* цена товара → тенге */
    toKzt: function (amount, fromCode) {
      var code = fromCode || 'kzt';
      var rate = Number(rates()[code]);
      if (code !== 'kzt' && !(rate > 0)) return Number(amount) || 0;
      var divisor = rate > 0 ? rate : 1;
      return (Number(amount) || 0) / divisor;
    },

    /* тенге → выбранная валюта витрины */
    convert: function (kztAmount, forceCode) {
      var code = forceCode || currency;
      var table = rates();
      if (!(Number(table[code]) > 0)) code = 'kzt';
      var rate = Number(table[code]) || 1;
      var meta = CURRENCIES[code] || CURRENCIES.kzt;
      var val = (Number(kztAmount) || 0) * rate;
      if (meta.round === 0) return Math.round(val);
      return Math.round(val * 100) / 100;
    },

    /* показать сумму уже в нужной валюте (без пересчёта) — для админки */
    moneyOwn: function (n, code) {
      return formatAmount(Number(n) || 0, code || 'kzt');
    },

    /* цена товара с учётом его валюты → валюта витрины */
    moneyProduct: function (p, forceCode) {
      var code = forceCode || currency;
      var kzt = Data.toKzt(p.price, p.currency || 'kzt');
      return formatAmount(Data.convert(kzt, code), code);
    },

    moneyOldProduct: function (p, forceCode) {
      if (!(p.old > 0)) return '';
      var code = forceCode || currency;
      var kzt = Data.toKzt(p.old, p.currency || 'kzt');
      return formatAmount(Data.convert(kzt, code), code);
    },

    /* сумма в тенге → валюта витрины (для итого корзины) */
    money: function (kztAmount, forceCode) {
      var code = forceCode || currency;
      return formatAmount(Data.convert(kztAmount, code), code);
    },

    currency: function () { return currency; },

    setCurrency: function (code) {
      if (!CURRENCIES[code]) return;
      currency = code;
      try { localStorage.setItem(CUR_KEY, code); } catch (e) {}
    },

    newId: function () {
      return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
  };

  /* развернуть битые ответы PowerShell {value:[…]} / {value, Count} */
  function flattenCrmList(node, out) {
    if (out == null) out = [];
    if (node == null) return out;
    if (typeof node === 'string') return out;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) flattenCrmList(node[i], out);
      return out;
    }
    if (typeof node === 'object') {
      var hasId = node.id != null && String(node.id) !== '';
      if (Object.prototype.hasOwnProperty.call(node, 'value') && !hasId) {
        return flattenCrmList(node.value, out);
      }
      if (hasId) out.push(node);
    }
    return out;
  }

  function pendingBy(method, urlPrefix) {
    var out = [];
    readOutbox().forEach(function (item) {
      if (!item || item.method !== method || String(item.url || '').indexOf(urlPrefix) !== 0) return;
      out.push(item);
    });
    return out;
  }

  function idFromUrl(url, prefix) {
    return decodeURIComponent(String(url || '').split(prefix)[1] || '');
  }

  function parseOrdersPayload(data) {
    if (Array.isArray(data)) return { orders: flattenCrmList(data), deleted: [] };
    var orders = [];
    var deleted = [];
    if (data && data.orders != null) orders = flattenCrmList(data.orders);
    else orders = flattenCrmList(data);
    if (!orders.length && data && data.id) orders = [data];
    if (data && Array.isArray(data.deleted)) {
      data.deleted.forEach(function (id) { if (id) deleted.push(String(id)); });
    }
    return { orders: orders, deleted: deleted };
  }

  function parseClientsPayload(data) {
    if (Array.isArray(data)) return { clients: flattenCrmList(data), deleted: [] };
    var clients = [];
    var deleted = [];
    if (data && data.clients != null) clients = flattenCrmList(data.clients);
    else clients = flattenCrmList(data);
    if (!clients.length && data && data.id) clients = [data];
    if (data && Array.isArray(data.deleted)) {
      data.deleted.forEach(function (id) { if (id) deleted.push(String(id)); });
    }
    return { clients: clients, deleted: deleted };
  }

  function deletedMap(ids) {
    var map = {};
    (ids || []).forEach(function (id) { if (id) map[String(id)] = true; });
    return map;
  }

  function pendingOrderDeletes() {
    var map = {};
    pendingBy('DELETE', '/api/orders/').forEach(function (item) {
      var id = idFromUrl(item.url, '/api/orders/');
      if (id) map[id] = true;
    });
    return map;
  }

  function pendingOrderBodies() {
    var list = [];
    pendingBy('POST', '/api/orders').forEach(function (item) {
      if (item.url === '/api/orders' && item.body && item.body.id) list.push(item.body);
    });
    return list;
  }

  function applyPendingPatches(list) {
    var patches = {};
    pendingBy('PATCH', '/api/orders/').forEach(function (item) {
      var id = idFromUrl(item.url, '/api/orders/');
      if (id && item.body) patches[id] = item.body;
    });
    return list.map(function (o) {
      var p = o && patches[o.id];
      if (!p || !p.status) return o;
      var copy = {};
      var k;
      for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) copy[k] = o[k]; }
      copy.status = p.status;
      if (p.updatedAt) copy.updatedAt = p.updatedAt;
      return copy;
    });
  }

  function pendingClientBodies() {
    var list = [];
    pendingBy('POST', '/api/clients').forEach(function (item) {
      if (item.url === '/api/clients' && item.body && item.body.id) list.push(item.body);
    });
    return list;
  }

  var PAGE_SIZE = 200;

  function fetchPaged(url, listKey) {
    function page(cursor, acc, deleted, guard) {
      var join = url.indexOf('?') === -1 ? '?' : '&';
      var q = 'limit=' + PAGE_SIZE;
      if (cursor) {
        q += '&beforeSort=' + encodeURIComponent(cursor.sort) + '&beforeRow=' + encodeURIComponent(cursor.row);
      }
      return fetch(url + join + q, {
        cache: 'no-store',
        headers: adminHeaders(false)
      }).then(function (r) {
        if (r.status === 401) {
          var denied = new Error('unauthorized');
          denied.status = 401;
          throw denied;
        }
        if (!r.ok) throw new Error('no api');
        var ct = (r.headers.get('content-type') || '');
        if (ct.indexOf('json') === -1) throw new Error('not json');
        return r.json();
      }).then(function (data) {
        var parsed = listKey === 'orders' ? parseOrdersPayload(data) : parseClientsPayload(data);
        var chunk = listKey === 'orders' ? parsed.orders : parsed.clients;
        if (!Array.isArray(chunk)) chunk = [];
        var next = acc.concat(chunk);
        var dels = deleted.concat(parsed.deleted || []);
        var more = null;
        if (chunk.length && data && data.nextSort != null && data.nextRow != null) {
          more = { sort: data.nextSort, row: data.nextRow };
        }
        if (more && guard < 100) return page(more, next, dels, guard + 1);
        return { items: next, deleted: dels };
      });
    }
    return page(null, [], [], 0);
  }

  /* ─── CRM: заказы (localStorage + /api/orders при наличии сервера) ─── */
  var Orders = window.ShopOrders = {

    newId: function () {
      return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    loadLocal: function () {
      try {
        var raw = localStorage.getItem(ORDERS_KEY);
        var list = raw ? flattenCrmList(JSON.parse(raw)) : [];
        return list.map(function (o) {
          if (!o) return o;
          if (!Array.isArray(o.items)) o.items = o.items ? [o.items] : [];
          return o;
        });
      } catch (e) { return []; }
    },

    saveLocal: function (list) {
      try {
        localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
        return true;
      } catch (e) { return false; }
    },

    /* синхронно: сразу в браузер + фоном на сервер */
    add: function (order) {
      var list = Orders.loadLocal();
      var exists = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === order.id) { exists = true; break; }
      }
      if (!exists) list.unshift(order);
      Orders.saveLocal(list);

      try {
        if (window.ShopClients) window.ShopClients.upsertFromOrder(order);
      } catch (e) {}

      var synced = deliver({ url: '/api/orders', method: 'POST', body: order });

      return { order: order, synced: synced };
    },

    /* Сервер — источник правды. Локально добавляются только ещё не дошедшие заявки. */
    merge: function (serverList, extraList, deleted) {
      var map = {};
      var i, o;

      function norm(order) {
        if (!order || !order.id) return null;
        if (deleted && deleted[order.id]) return null;
        var items = order.items;
        if (!Array.isArray(items)) items = items ? [items] : [];
        order.items = items;
        return order;
      }

      var a = Array.isArray(serverList) ? serverList : [];
      var b = Array.isArray(extraList) ? extraList : [];
      for (i = 0; i < a.length; i++) {
        o = norm(a[i]);
        if (o) map[o.id] = o;
      }
      for (i = 0; i < b.length; i++) {
        o = norm(b[i]);
        if (o && !map[o.id]) map[o.id] = o;
      }

      return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) {
        return (Date.parse(y.createdAt || 0) || 0) - (Date.parse(x.createdAt || 0) || 0);
      });
    },

    load: function () {
      var sync = (window.SabinaSync && window.SabinaSync.flush) ? window.SabinaSync.flush() : Promise.resolve();
      return Promise.resolve(sync).then(function () {
        var local = Orders.loadLocal();
        return fetchPaged('/api/orders', 'orders')
          .then(function (data) {
            var parsed = { orders: data.items, deleted: data.deleted };
            var deleted = deletedMap(parsed.deleted);
            var pendingDel = pendingOrderDeletes();
            var id;
            for (id in pendingDel) deleted[id] = true;
            var list = applyPendingPatches(Orders.merge(parsed.orders, pendingOrderBodies(), deleted));
            Orders.saveLocal(list);
            return { list: list, fromApi: true };
          })
          ['catch'](function (err) {
            var deleted = pendingOrderDeletes();
            var kept = local.filter(function (o) { return o && !deleted[o.id]; });
            var list = applyPendingPatches(Orders.merge(kept, pendingOrderBodies(), deleted));
            return { list: list, fromApi: false, unauthorized: !!(err && err.status === 401) };
          });
      });
    },

    updateStatus: function (id, status) {
      var now = new Date().toISOString();
      var list = Orders.loadLocal();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].status = status;
          list[i].updatedAt = now;
          break;
        }
      }
      Orders.saveLocal(list);
      return deliver({
        url: '/api/orders/' + encodeURIComponent(id),
        method: 'PATCH',
        body: { status: status, updatedAt: now }
      });
    },

    remove: function (id) {
      var list = Orders.loadLocal().filter(function (o) { return o.id !== id; });
      Orders.saveLocal(list);
      return deliver({ url: '/api/orders/' + encodeURIComponent(id), method: 'DELETE' });
    }
  };

  /* ─── CRM: клиенты (без дублей по телефону) ─── */
  var Clients = window.ShopClients = {

    phoneKey: function (phone) {
      var d = String(phone || '').replace(/\D/g, '');
      if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
      if (d.length === 10) d = '7' + d;
      return d;
    },

    newId: function () {
      return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    loadLocal: function () {
      try {
        var raw = localStorage.getItem(CLIENTS_KEY);
        return raw ? flattenCrmList(JSON.parse(raw)) : [];
      } catch (e) { return []; }
    },

    saveLocal: function (list) {
      try {
        localStorage.setItem(CLIENTS_KEY, JSON.stringify(list));
        return true;
      } catch (e) { return false; }
    },

    merge: function (serverList, extraList, deleted) {
      function stamp(v) {
        var t = Date.parse(v || 0);
        return isNaN(t) ? 0 : t;
      }
      function pair(a, b) {
        if (!a) return b;
        if (!b) return a;
        function pickStamp(atA, atB) {
          var ta = stamp(atA);
          var tb = stamp(atB);
          if (ta || tb) return ta >= tb;
          return null;
        }
        var namePick = pickStamp(a.nameAt, b.nameAt);
        var nameFromA = namePick === null
          ? stamp(a.updatedAt || a.lastOrderAt || a.createdAt) >= stamp(b.updatedAt || b.lastOrderAt || b.createdAt)
          : namePick;
        var notesPick = pickStamp(a.notesAt, b.notesAt);
        var notes = notesPick === null
          ? ((a.notes && String(a.notes).length) ? a.notes : (b.notes || ''))
          : (notesPick ? (a.notes != null ? a.notes : (b.notes || '')) : (b.notes != null ? b.notes : (a.notes || '')));
        var hidePick = pickStamp(a.hiddenAt, b.hiddenAt);
        return {
          id: a.id || b.id,
          phone: Clients.phoneKey(a.phone || b.phone),
          phoneDisplay: a.phoneDisplay || b.phoneDisplay || '',
          name: (nameFromA ? a.name : b.name) || a.name || b.name || 'Без имени',
          nameAt: nameFromA ? (a.nameAt || '') : (b.nameAt || ''),
          createdAt: a.createdAt || b.createdAt,
          updatedAt: stamp(a.updatedAt) >= stamp(b.updatedAt) ? (a.updatedAt || b.updatedAt) : (b.updatedAt || a.updatedAt),
          lastOrderAt: stamp(a.lastOrderAt) >= stamp(b.lastOrderAt) ? (a.lastOrderAt || b.lastOrderAt) : (b.lastOrderAt || a.lastOrderAt),
          notes: notes,
          notesAt: notesPick === null ? '' : (notesPick ? (a.notesAt || '') : (b.notesAt || '')),
          hidden: hidePick === null ? !!(a.hidden || b.hidden) : !!(hidePick ? a.hidden : b.hidden),
          hiddenAt: hidePick === null ? '' : (hidePick ? (a.hiddenAt || '') : (b.hiddenAt || ''))
        };
      }
      var map = {};
      function take(c) {
        if (!c) return;
        if (c.id && deleted && deleted[c.id]) return;
        var key = Clients.phoneKey(c.phone) || c.id;
        if (!key) return;
        if (!map[key]) map[key] = c;
        else map[key] = pair(map[key], c);
      }
      var lists = [serverList, extraList];
      for (var li = 0; li < lists.length; li++) {
        var arr = Array.isArray(lists[li]) ? lists[li] : [];
        for (var i = 0; i < arr.length; i++) take(arr[i]);
      }
      return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
        return (Date.parse(b.lastOrderAt || b.updatedAt || 0) || 0) -
          (Date.parse(a.lastOrderAt || a.updatedAt || 0) || 0);
      });
    },

    /* создать или обновить клиента по телефону — без дублей.
       skipApi=true: только localStorage (массовый sync из заказов не долбит сервер) */
    upsertFromOrder: function (order, skipApi) {
      if (!order) return null;
      var phone = Clients.phoneKey(order.clientPhone);
      var name = String(order.clientName || '').trim();
      if (!phone && !name) return null;

      var list = Clients.loadLocal();
      var idx = -1;
      var i;
      if (phone) {
        for (i = 0; i < list.length; i++) {
          if (Clients.phoneKey(list[i].phone) === phone) { idx = i; break; }
        }
      } else if (String(order.clientPhone || '').trim()) {
        var rawContact = String(order.clientPhone).trim().toLowerCase();
        for (i = 0; i < list.length; i++) {
          if (String(list[i].phoneDisplay || '').trim().toLowerCase() === rawContact) { idx = i; break; }
        }
      } else {
        var nameKey = name.toLowerCase();
        for (i = 0; i < list.length; i++) {
          if (!Clients.phoneKey(list[i].phone) &&
              String(list[i].name || '').trim().toLowerCase() === nameKey) {
            idx = i;
            break;
          }
        }
      }

      var now = new Date().toISOString();
      if (skipApi && idx >= 0) return list[idx];
      var client;
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
          id: Clients.newId(),
          phone: phone,
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

      Clients.saveLocal(list);

      if (!skipApi) {
        deliver({ url: '/api/clients', method: 'POST', body: client });
      }

      return client;
    },

    /* дописать клиентов из старых заказов локально (без массового POST) */
    syncFromOrders: function (orders) {
      var arr = Array.isArray(orders) ? orders : [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id) Clients.upsertFromOrder(arr[i], true);
      }
      return Clients.loadLocal();
    },

    load: function () {
      var sync = (window.SabinaSync && window.SabinaSync.flush) ? window.SabinaSync.flush() : Promise.resolve();
      return Promise.resolve(sync).then(function () {
        var local = Clients.loadLocal();
        return fetchPaged('/api/clients', 'clients')
          .then(function (data) {
            var parsed = { clients: data.items, deleted: data.deleted };
            var deleted = deletedMap(parsed.deleted);
            var list = Clients.merge(parsed.clients, pendingClientBodies(), deleted);
            Clients.saveLocal(list);
            return { list: list, fromApi: true };
          })
          ['catch'](function () {
            return { list: local, fromApi: false };
          });
      });
    },

    remove: function (id) {
      var list = Clients.loadLocal().filter(function (c) { return c.id !== id; });
      Clients.saveLocal(list);
      deliver({ url: '/api/clients/' + encodeURIComponent(id), method: 'DELETE' });
    }
  };

  /* ─── Дальше — только витрина. В админке этих блоков нет ─── */
  var grid = document.getElementById('goods');
  if (!grid) return;

  var filters   = document.getElementById('filters');
  var currBox   = document.getElementById('curr');
  var cartBtn   = document.getElementById('cartbtn');
  var cartCount = document.getElementById('cartn');
  var cartWrap  = document.getElementById('cartwrap');
  var cartPanel = document.getElementById('cartpanel');
  var cartResize = document.getElementById('cartresize');
  var cartList  = document.getElementById('cartlist');
  var cartTotal = document.getElementById('carttotal');
  var cartEmpty = document.getElementById('cartempty');
  var orderBtn  = document.getElementById('order');
  var orderNote = document.getElementById('ordernote');
  var chkBox    = document.getElementById('checkout');
  var chkForm   = document.getElementById('chkForm');
  var chkName   = document.getElementById('chkName');
  var chkPhone  = document.getElementById('chkPhone');
  var chkErr    = document.getElementById('chkErr');
  var chkGo     = document.getElementById('chkGo');
  var chkSum    = document.getElementById('chkSum');

  var products = Data.load().filter(function (p) { return p.active !== false; });
  var cart     = loadCart();
  var current  = 'Все товары';
  var pending  = null; /* черновик заказа до отправки в мессенджер */

  function renderCurrency() {
    if (!currBox) return;
    currBox.querySelectorAll('[data-cur]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-cur') === Data.currency());
    });
  }

  if (currBox) {
    currBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cur]');
      if (!b) return;
      Data.setCurrency(b.getAttribute('data-cur'));
      renderCurrency();
      renderGoods();
      renderCart();
    });
  }

  /* ─── Корзина в памяти браузера ─── */
  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (e) { return {}; }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function countItems() {
    var n = 0;
    for (var id in cart) n += cart[id];
    return n;
  }

  function find(id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return null;
  }

  function total() {
    var sum = 0;
    for (var id in cart) {
      var p = find(id);
      if (p) sum += Data.toKzt(p.price, p.currency || 'kzt') * cart[id];
    }
    return sum;
  }

  /* ─── Витрина ─── */
  function tags() {
    var list = ['Все товары'];
    products.forEach(function (p) {
      if (p.tag && list.indexOf(p.tag) === -1) list.push(p.tag);
    });
    return list;
  }

  function renderFilters() {
    if (!filters) return;
    var list = tags();
    filters.hidden = false;
    filters.innerHTML = '';
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (t === current ? ' on' : '');
      b.textContent = t;
      b.addEventListener('click', function () {
        current = t;
        renderFilters();
        renderGoods();
      });
      filters.appendChild(b);
    });
  }

  function renderGoods() {
    var list = products.filter(function (p) {
      return current === 'Все товары' || p.tag === current;
    });

    grid.innerHTML = '';

    if (!list.length) {
      grid.innerHTML = '<p class="goods__none">Пока нет товаров. Добавьте их в админке — файл admin.html.</p>';
      return;
    }

    list.forEach(function (p) {
      var card = document.createElement('article');
      card.className = 'good anim in';

      var img = p.img
        ? '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">'
        : '';

      card.innerHTML =
        '<div class="good__ph">' + img +
          (p.hit ? '<span class="good__hit">Хит</span>' : '') +
          (p.old > p.price ? '<span class="good__sale">−' + Math.round((1 - p.price / p.old) * 100) + '%</span>' : '') +
        '</div>' +
        '<div class="good__b">' +
          (p.tag ? '<span class="good__tag">' + esc(p.tag) + '</span>' : '') +
          '<h3 class="good__t">' + esc(p.name) + '</h3>' +
          (p.size ? '<span class="good__size">' + esc(p.size) + '</span>' : '') +
          (p.desc ? '<p class="good__d">' + esc(p.desc) + '</p>' : '') +
          '<div class="good__bot">' +
            '<span class="good__price">' + Data.moneyProduct(p) +
              (p.old > p.price ? '<s>' + Data.moneyOldProduct(p) + '</s>' : '') +
            '</span>' +
            '<div class="good__acts">' +
              cartBtnHtml(p.id) +
              '<button type="button" class="good__buy" data-buy="' + esc(p.id) + '">Заказать</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      grid.appendChild(card);
    });
  }

  function cartBtnHtml(id) {
    var inCart = !!cart[id];
    return '<button type="button" class="good__add' + (inCart ? ' good__add--in' : '') +
           '" data-id="' + esc(id) + '"' +
           (inCart ? ' aria-pressed="true"' : '') + '>' +
           (inCart ? 'В корзине ✓' : 'В корзину') +
           '</button>';
  }

  function syncCartButtons() {
    grid.querySelectorAll('.good__add').forEach(function (b) {
      var id = b.dataset.id;
      var inCart = !!cart[id];
      b.classList.toggle('good__add--in', inCart);
      b.setAttribute('aria-pressed', inCart ? 'true' : 'false');
      b.textContent = inCart ? 'В корзине ✓' : 'В корзину';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─── Корзина: отрисовка ─── */
  function renderCart() {
    var n = countItems();
    var cleaned = false;

    if (cartBtn) {
      cartBtn.hidden = n === 0;
      if (cartCount) cartCount.textContent = n;
    }

    if (!cartList) return;
    cartList.innerHTML = '';

    var ids = Object.keys(cart);

    if (cartEmpty) cartEmpty.hidden = ids.length > 0;
    if (orderBtn)  orderBtn.disabled = ids.length === 0;

    ids.forEach(function (id) {
      var p = find(id);
      if (!p) {
        delete cart[id];
        cleaned = true;
        return;
      }

      var row = document.createElement('li');
      row.className = 'citem';
      row.innerHTML =
        '<span class="citem__ph">' + (p.img ? '<img src="' + esc(p.img) + '" alt="">' : '') + '</span>' +
        '<span class="citem__t">' + esc(p.name) + '<i>' + Data.moneyProduct(p) + '</i></span>' +
        '<span class="qty">' +
          '<button type="button" data-minus="' + esc(id) + '" aria-label="Меньше">−</button>' +
          '<b>' + cart[id] + '</b>' +
          '<button type="button" data-plus="' + esc(id) + '" aria-label="Больше">+</button>' +
        '</span>' +
        '<button type="button" class="citem__x" data-del="' + esc(id) + '" aria-label="Убрать">×</button>';

      cartList.appendChild(row);
    });

    if (cleaned) {
      saveCart();
      n = countItems();
      if (cartBtn) {
        cartBtn.hidden = n === 0;
        if (cartCount) cartCount.textContent = n;
      }
      if (cartEmpty) cartEmpty.hidden = Object.keys(cart).length > 0;
      if (orderBtn) orderBtn.disabled = Object.keys(cart).length === 0;
    }

    if (cartTotal) cartTotal.textContent = Data.money(total());
    syncCartButtons();
  }

  function add(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCart();
    bump();
  }

  function bump() {
    if (!cartBtn) return;
    cartBtn.classList.remove('pop');
    void cartBtn.offsetWidth;
    cartBtn.classList.add('pop');
  }

  function openCart(open) {
    if (!cartWrap) return;
    cartWrap.hidden = !open;
    document.body.classList.toggle('locked', open);
    if (open && orderNote) orderNote.textContent = '';
  }

  /* ─── Ширина правой панели корзины ─── */
  var CART_W_KEY = 'sabina.cart.width.v1';
  var CART_W_MIN = 300;
  var CART_W_MAX = 720;

  function cartWidthBounds() {
    var max = Math.min(CART_W_MAX, Math.max(CART_W_MIN, window.innerWidth - 24));
    return { min: CART_W_MIN, max: max };
  }

  function applyCartWidth(px) {
    if (!cartPanel) return;
    var b = cartWidthBounds();
    var w = Math.round(Math.min(b.max, Math.max(b.min, px)));
    cartPanel.style.setProperty('--cart-w', w + 'px');
    return w;
  }

  function loadCartWidth() {
    var saved = 430;
    try {
      var n = Number(localStorage.getItem(CART_W_KEY));
      if (n >= CART_W_MIN) saved = n;
    } catch (e) {}
    applyCartWidth(saved);
  }

  function saveCartWidth(w) {
    try { localStorage.setItem(CART_W_KEY, String(w)); } catch (e) {}
  }

  function bindCartResize() {
    if (!cartResize || !cartPanel) return;
    loadCartWidth();

    var dragging = false;

    function onMove(clientX) {
      if (!dragging) return;
      applyCartWidth(window.innerWidth - clientX);
    }

    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('cart-resizing');
      var cur = parseFloat(getComputedStyle(cartPanel).getPropertyValue('--cart-w')) || 430;
      saveCartWidth(cur);
    }

    cartResize.addEventListener('pointerdown', function (e) {
      if (window.innerWidth <= 640) return;
      dragging = true;
      document.body.classList.add('cart-resizing');
      try { cartResize.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });

    cartResize.addEventListener('pointermove', function (e) {
      onMove(e.clientX);
    });

    cartResize.addEventListener('pointerup', stopDrag);
    cartResize.addEventListener('pointercancel', stopDrag);

    cartResize.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 20;
      var cur = parseFloat(getComputedStyle(cartPanel).getPropertyValue('--cart-w')) || 430;
      if (e.key === 'ArrowLeft') {
        saveCartWidth(applyCartWidth(cur + step));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        saveCartWidth(applyCartWidth(cur - step));
        e.preventDefault();
      }
    });

    window.addEventListener('resize', function () {
      var cur = parseFloat(getComputedStyle(cartPanel).getPropertyValue('--cart-w')) || 430;
      applyCartWidth(cur);
    });
  }

  /* ─── Заказ: модалка → CRM → мессенджер ─── */
  function messengerKind() {
    return String(CFG.messenger || 'whatsapp').toLowerCase() === 'telegram'
      ? 'telegram' : 'whatsapp';
  }

  function messengerLabel() {
    return messengerKind() === 'telegram' ? 'Telegram' : 'WhatsApp';
  }

  function buildItemsFromCart() {
    var items = [];
    for (var id in cart) {
      var p = find(id);
      if (!p) continue;
      var qty = cart[id];
      var unitKzt = Data.toKzt(p.price, p.currency || 'kzt');
      items.push({
        id: p.id,
        name: p.name,
        size: p.size || '',
        qty: qty,
        price: p.price,
        currency: p.currency || 'kzt',
        unitLabel: Data.moneyProduct(p),
        lineKzt: unitKzt * qty
      });
    }
    return items;
  }

  function buildItemsOne(p) {
    var unitKzt = Data.toKzt(p.price, p.currency || 'kzt');
    return [{
      id: p.id,
      name: p.name,
      size: p.size || '',
      qty: 1,
      price: p.price,
      currency: p.currency || 'kzt',
      unitLabel: Data.moneyProduct(p),
      lineKzt: unitKzt
    }];
  }

  function sumItemsKzt(items) {
    var s = 0;
    for (var i = 0; i < items.length; i++) s += items[i].lineKzt || 0;
    return s;
  }

  function orderText(draft, name, phone) {
    var lines = ['Здравствуйте Сабина, хочу сделать заказ', ''];
    lines.push('Имя: ' + name);
    lines.push('Телефон: ' + phone);
    lines.push('');

    draft.items.forEach(function (it, idx) {
      lines.push((idx + 1) + '. ' + it.name +
        (it.size ? ' (' + it.size + ')' : '') +
        ' — ' + it.qty + ' шт. × ' + it.unitLabel);
    });

    lines.push('');
    lines.push('Итого: ' + draft.totalLabel);
    if (draft.orderId) lines.push('Номер заказа: ' + draft.orderId);
    return lines.join('\n');
  }

  function openCheckout(draft) {
    if (!chkBox || !draft || !draft.items || !draft.items.length) return;
    pending = draft;
    if (chkSum) chkSum.textContent = draft.totalLabel;
    if (chkGo) {
      chkGo.disabled = false;
      chkGo.textContent = 'Перейти в ' + messengerLabel();
    }
    if (chkErr) chkErr.textContent = '';
    if (chkForm) chkForm.reset();
    chkBox.hidden = false;
    document.body.classList.add('locked');
    if (chkName) setTimeout(function () { chkName.focus(); }, 50);
  }

  function closeCheckout() {
    if (!chkBox) return;
    chkBox.hidden = true;
    pending = null;
    if (!cartWrap || cartWrap.hidden) document.body.classList.remove('locked');
  }

  function normalizePhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    return d;
  }

  function openMessenger(text) {
    var kind = messengerKind();
    copy(text);

    if (kind === 'telegram') {
      var user = String(CFG.telegram || '').replace(/^@/, '').trim();
      if (user) window.open('https://t.me/' + encodeURIComponent(user), '_blank');
      return 'telegram';
    }

    var phone = String(CFG.phone || '').replace(/\D/g, '');
    if (!phone) return 'blocked';
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');
    return 'whatsapp';
  }

  function orderBlockedNote() {
    if (orderNote) orderNote.textContent = 'Оформление заказа временно недоступно. Свяжитесь с нами в WhatsApp';
    openCart(true);
  }

  function finishOrder(name, phone) {
    if (!pending) return;
    if (!Data.serverReady() || !products.length) {
      orderBlockedNote();
      return;
    }

    var draft = pending;
    var kind = messengerKind();
    var order = {
      id: Orders.newId(),
      createdAt: new Date().toISOString(),
      clientName: name,
      clientPhone: phone,
      items: draft.items,
      totalKzt: draft.totalKzt,
      totalLabel: draft.totalLabel,
      currency: Data.currency(),
      messenger: kind,
      status: 'new',
      source: draft.source || 'cart'
    };

    var saved = Orders.add(order);
    saved.synced.then(function (ok) {
      if (ok === 'rejected') {
        openCart(true);
        if (orderNote) orderNote.textContent = 'Заказ не принят: товара нет в наличии или данные не прошли проверку. Корзина на месте.';
        return;
      }

      draft.orderId = order.id;
      var text = orderText(draft, name, phone);
      var channel = openMessenger(text);

      var okMsg = channel === 'telegram'
        ? 'Заказ сохранён. Открываю Telegram — вставьте сообщение (оно уже скопировано).'
        : 'Заказ сохранён. Открываю WhatsApp с готовым текстом.';
      if (!ok) okMsg += ' Он появится в CRM, как только сервер ответит.';

      closeCheckout();

      if (draft.source === 'cart') {
        cart = {};
        saveCart();
        renderCart();
      }

      openCart(true);
      if (orderNote) orderNote.textContent = okMsg;
    });
  }

  function sendOrder() {
    if (!countItems()) return;
    if (!Data.serverReady() || !products.length) {
      orderBlockedNote();
      return;
    }
    var items = buildItemsFromCart();
    if (!items.length) {
      orderBlockedNote();
      return;
    }
    var totalKzt = sumItemsKzt(items);
    openCheckout({
      source: 'cart',
      items: items,
      totalKzt: totalKzt,
      totalLabel: Data.money(totalKzt)
    });
  }

  function buyOne(id) {
    var p = find(id);
    if (!Data.serverReady() || !p) {
      orderBlockedNote();
      return;
    }
    var items = buildItemsOne(p);
    openCheckout({
      source: 'buy',
      items: items,
      totalKzt: items[0].lineKzt,
      totalLabel: Data.moneyProduct(p)
    });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)['catch'](function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  if (chkForm) {
    chkForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (chkName && chkName.value || '').trim();
      var phoneRaw = (chkPhone && chkPhone.value || '').trim();
      var phone = normalizePhone(phoneRaw);

      if (!name) {
        if (chkErr) chkErr.textContent = 'Укажите имя.';
        return;
      }
      if (phone.length < 10) {
        if (chkErr) chkErr.textContent = 'Укажите корректный номер телефона.';
        return;
      }
      if (chkGo) chkGo.disabled = true;
      finishOrder(name, phoneRaw);
    });
  }

  if (chkBox) {
    chkBox.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeCheckout();
    });
  }

  /* ─── События ─── */
  grid.addEventListener('click', function (e) {
    var addBtn = e.target.closest('.good__add');
    if (addBtn) {
      var id = addBtn.dataset.id;
      if (cart[id]) {
        openCart(true);
        return;
      }
      add(id);
      return;
    }

    var buyBtn = e.target.closest('.good__buy');
    if (buyBtn) buyOne(buyBtn.dataset.buy);
  });

  if (cartList) {
    cartList.addEventListener('click', function (e) {
      var t = e.target;
      var id = t.dataset.plus || t.dataset.minus || t.dataset.del;
      if (!id) return;

      if (t.dataset.plus)  cart[id] = (cart[id] || 0) + 1;
      if (t.dataset.minus) cart[id] = Math.max(0, (cart[id] || 0) - 1);
      if (t.dataset.del)   cart[id] = 0;
      if (!cart[id]) delete cart[id];

      saveCart();
      renderCart();
    });
  }

  if (cartBtn)  cartBtn.addEventListener('click', function () { openCart(true); });
  if (orderBtn) orderBtn.addEventListener('click', sendOrder);

  if (cartWrap) {
    cartWrap.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) openCart(false);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (chkBox && !chkBox.hidden) { closeCheckout(); return; }
    if (cartWrap && !cartWrap.hidden) openCart(false);
  });

  renderCurrency();
  renderFilters();
  renderGoods();
  renderCart();
  bindCartResize();

  Data.pull().then(function (list) {
    if (!Array.isArray(list)) {
      products = [];
    } else {
      products = list.filter(function (p) { return p.active !== false; });
    }
    if (current !== 'Все товары' && tags().indexOf(current) === -1) current = 'Все товары';
    renderFilters();
    renderGoods();
    renderCart();
  });

  /* админка в другой вкладке сохранила каталог — подтянуть без перезагрузки */
  window.addEventListener('storage', function (e) {
    if (e.key !== CATALOG_KEY) return;
    products = Data.load().filter(function (p) { return p.active !== false; });
    if (current !== 'Все товары' && tags().indexOf(current) === -1) current = 'Все товары';
    renderFilters();
    renderGoods();
    renderCart();
  });
})();
