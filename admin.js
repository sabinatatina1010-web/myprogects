/* ══════════════════════════════════════════════════════════
   Админка: добавление и правка товаров
   ══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var Data    = window.ShopData;
  var Orders  = window.ShopOrders;
  var Clients = window.ShopClients;
  var CFG     = window.SHOP || {};
  var SESS   = 'sabina.admin.ok';

  if (Data) {
    Data.onConflict = function (list) {
      items = Array.isArray(list) ? list : [];
      if (typeof render === 'function') render();
      if (typeof say === 'function') {
        say('Каталог уже изменили в другом окне. Показан актуальный список — повторите свою правку.', true);
      }
    };
  }

  var CUR_LABEL = {
    kzt: 'Тенге (₸)',
    rub: 'Рубли (₽)',
    usd: 'Доллар ($)'
  };

  /* ─── Вход ─── */
  var gate  = document.getElementById('gate');
  var panel = document.getElementById('panel');

  function shopSettingsMissing() {
    var shop = window.SHOP;
    if (!shop || typeof shop !== 'object') return true;
    var phone = String(shop.phone || '').replace(/\D/g, '');
    if (!phone || /^0+$/.test(phone) || phone === '70000000000' || phone === '77000000000') return true;
    var rates = shop.rates;
    if (!rates || typeof rates !== 'object' || !(Number(rates.kzt) > 0)) return true;
    return false;
  }

  function showShopSettingsNotice() {
    var el = document.getElementById('shopCfgWarn');
    if (!el) return;
    el.hidden = !shopSettingsMissing();
  }

  function openPanel() {
    gate.hidden = true;
    panel.hidden = false;
    showShopSettingsNotice();
    render();
    setTab(activeTab || 'goods');
    loadOrders();
    if (window.SabinaSync) window.SabinaSync.flush();
    if (Data.pull) {
      Data.pull().then(function (list) {
        if (list == null) return;
        items = list;
        render();
      });
    }
    loadCompany();
  }

  var CO_ERRORS = {
    'missing name': 'Укажите название.',
    'bad bin': 'БИН или ИИН — 12 цифр. Примерный номер не принимается.',
    'bad iban': 'IBAN должен начинаться с KZ и содержать 20 символов. Примерный счёт не принимается.',
    'missing bank': 'Укажите банк.',
    'bad phone': 'Укажите настоящий телефон.',
    'bad email': 'Проверьте почту.',
    unauthorized: 'Сессия истекла. Войдите снова.'
  };

  function companyMsg(text, isErr) {
    var el = document.getElementById('coMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('adm__crmhint--warn', !!isErr);
    el.classList.toggle('adm__crmhint--ok', !!(text && !isErr));
  }

  function fillCompany(c) {
    c = c || {};
    document.getElementById('coName').value = c.name || '';
    document.getElementById('coBin').value = c.bin_iin || '';
    document.getElementById('coAddr').value = c.address || '';
    document.getElementById('coPhone').value = c.phone || '';
    document.getElementById('coEmail').value = c.email || '';
    document.getElementById('coBank').value = c.bank_name || '';
    document.getElementById('coIban').value = c.iban || '';
    document.getElementById('coBik').value = c.bik || '';
  }

  function loadCompany() {
    if (!document.getElementById('coForm')) return;
    fetch('/api/company', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('company');
      return r.json();
    }).then(function (data) {
      fillCompany(data);
    }, function () {
      companyMsg('Не удалось загрузить реквизиты.', true);
    });
  }

  function saveCompany(e) {
    e.preventDefault();
    var body = {
      name: document.getElementById('coName').value.trim(),
      bin_iin: document.getElementById('coBin').value.trim(),
      address: document.getElementById('coAddr').value.trim(),
      phone: document.getElementById('coPhone').value.trim(),
      email: document.getElementById('coEmail').value.trim(),
      bank_name: document.getElementById('coBank').value.trim(),
      iban: document.getElementById('coIban').value.trim(),
      bik: document.getElementById('coBik').value.trim()
    };
    var headers = window.SabinaSync ? window.SabinaSync.headers(true) : { 'Content-Type': 'application/json' };
    companyMsg('Сохраняем…', false);
    fetch('/api/company', {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          companyMsg(CO_ERRORS[data && data.error] || 'Не удалось сохранить реквизиты.', true);
          return;
        }
        companyMsg('Реквизиты сохранены. Счёт на оплату их подставит.', false);
      });
    }, function () {
      companyMsg('Сервер не ответил.', true);
    });
  }

  var coForm = document.getElementById('coForm');
  if (coForm) coForm.addEventListener('submit', saveCompany);

  function orderNote(text) {
    var el = document.getElementById('ordMsg');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
  }

  function applyOrderStatus(id, status) {
    orderNote('');
    Promise.resolve(Orders.updateStatus(id, status)).then(function (ok) {
      if (ok === 'rejected') orderNote('Не хватает остатка — статус не изменён.');
      loadOrders();
    }, loadOrders);
  }

  document.getElementById('gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = document.getElementById('pass').value;
    var errEl = document.getElementById('gateErr');
    errEl.textContent = '';
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      if (!res.ok || !res.data || !res.data.token) {
        errEl.textContent = 'Неверный пароль.';
        return;
      }
      try {
        sessionStorage.setItem('sabina.admin.token', res.data.token);
        sessionStorage.setItem(SESS, '1');
      } catch (err) {}
      openPanel();
    }).catch(function () {
      errEl.textContent = 'Сервер не ответил. Закройте окно PowerShell и снова запустите server.ps1.';
    });
  });

  /* ─── Вкладки: товары / заказы / клиенты ─── */
  var activeTab   = 'goods';
  var goodsSec    = document.getElementById('goodsSec');
  var ordersSec   = document.getElementById('ordersSec');
  var clientsSec  = document.getElementById('clientsSec');
  var goodsWarn   = document.getElementById('goodsWarn');
  var exportBtn   = document.getElementById('export');
  var newBtn      = document.getElementById('newBtn');
  var ordList     = document.getElementById('ordList');
  var ordCount    = document.getElementById('ordCount');
  var ordBadge    = document.getElementById('ordBadge');
  var cliList     = document.getElementById('cliList');
  var cliCount    = document.getElementById('cliCount');
  var cliBadge    = document.getElementById('cliBadge');
  var cliSearch   = document.getElementById('cliSearch');
  var ordFilter   = 'all';
  var clientFilter = null; /* { phone: '77…' } или { name: '…' } */
  var ordersCache = [];
  var clientsCache = [];

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.adm__tab').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    goodsSec.hidden = tab !== 'goods';
    ordersSec.hidden = tab !== 'orders';
    clientsSec.hidden = tab !== 'clients';
    goodsWarn.hidden = tab !== 'goods';
    exportBtn.hidden = tab !== 'goods';
    newBtn.hidden = tab !== 'goods';
    if (tab === 'orders' || tab === 'clients') loadCrm();
  }

  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) setTab(b.getAttribute('data-tab'));
  });

  document.getElementById('ordFilters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ostatus]');
    if (!b) return;
    ordFilter = b.getAttribute('data-ostatus');
    document.querySelectorAll('#ordFilters .chip').forEach(function (c) {
      c.classList.toggle('on', c === b);
    });
    renderOrders();
  });

  document.getElementById('ordRefresh').addEventListener('click', loadCrm);
  document.getElementById('cliRefresh').addEventListener('click', loadCrm);

  if (cliSearch) {
    cliSearch.addEventListener('input', function () {
      renderClients();
    });
  }

  function loadCrm() {
    var ordPromise = Orders
      ? Orders.load()
      : Promise.resolve({ list: [], fromApi: false });

    ordPromise.then(function (res) {
      if (res && res.unauthorized) {
        try {
          sessionStorage.removeItem('sabina.admin.token');
          sessionStorage.removeItem(SESS);
        } catch (e) {}
        panel.hidden = true;
        gate.hidden = false;
        document.getElementById('gateErr').textContent = 'Сессия истекла. Войдите снова.';
        return null;
      }
      if (Array.isArray(res)) {
        ordersCache = res;
        setOrdersHint(null);
      } else {
        ordersCache = (res && res.list) || [];
        setOrdersHint(!!(res && res.fromApi));
      }

      /* из заказов дописываем клиентов без дублей */
      if (Clients) Clients.syncFromOrders(ordersCache);

      var cliPromise = Clients
        ? Clients.load()
        : Promise.resolve({ list: [] });

      return cliPromise;
    }).then(function (cres) {
      if (cres == null) return;
      if (Array.isArray(cres)) clientsCache = cres;
      else if (cres && cres.list) clientsCache = cres.list;
      else clientsCache = (Clients && Clients.loadLocal()) || [];
      renderOrders();
      renderClients();
    });
  }

  function loadOrders() { loadCrm(); }

  function setOrdersHint(fromApi) {
    var el = document.getElementById('ordApiHint');
    if (!el) return;
    if (fromApi === true) {
      el.hidden = false;
      el.className = 'adm__crmhint adm__crmhint--ok';
      el.textContent = 'Сервер заказов подключён — заявки с любого устройства попадают сюда.';
    } else if (fromApi === false) {
      el.hidden = false;
      el.className = 'adm__crmhint adm__crmhint--warn';
      el.innerHTML = 'Сервер заказов сейчас недоступен. Видны только заказы <b>этого браузера</b>. ' +
        'Запустите <b>server.ps1</b> и откройте сайт и админку с одного адреса (например http://localhost:8127/).';
    } else {
      el.hidden = true;
    }
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function phoneDigits(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    return d;
  }

  function phoneHref(phone) {
    var d = phoneDigits(phone);
    return d ? 'tel:+' + d : '#';
  }

  /* сообщение от вас к клиенту (не заявка клиента к вам) */
  function replyToClientText(o) {
    var name = String(o.clientName || '').trim() || 'друг';
    var lines = [
      'Здравствуйте, ' + name + '!',
      '',
      'Вы хотели заказать у нас:'
    ];
    var items = o.items || [];
    var i;
    if (!items.length) {
      lines.push('— уточните, пожалуйста, что именно вас интересует.');
    } else {
      for (i = 0; i < items.length; i++) {
        var it = items[i];
        lines.push(
          (i + 1) + '. ' + (it.name || 'Товар') +
          (it.size ? ' (' + it.size + ')' : '') +
          ' — ' + (it.qty || 1) + ' шт.' +
          (it.unitLabel ? ' × ' + it.unitLabel : '')
        );
      }
      if (o.totalLabel) {
        lines.push('');
        lines.push('Итого: ' + o.totalLabel);
      }
    }
    lines.push('');
    lines.push('Подскажите, всё верно? Готова помочь с оформлением.');
    return lines.join('\n');
  }

  function waClientHref(o) {
    var d = phoneDigits(o.clientPhone);
    if (!d) return '';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(replyToClientText(o));
  }

  function statusLabel(status) {
    if (status === 'done') return 'готов';
    if (status === 'work') return 'в работе';
    return 'новый';
  }

  function statusBadgeClass(status) {
    if (status === 'done') return 'bdg--off';
    if (status === 'work') return 'bdg--work';
    return 'bdg--hit';
  }

  function statusActions(id, status) {
    var html = '';
    if (status === 'new') {
      html += '<button type="button" class="pcard__btn pcard__btn--work" data-owork="' + esc(id) + '">В работе</button>';
      html += '<button type="button" class="pcard__btn" data-odone="' + esc(id) + '">Готово</button>';
    } else if (status === 'work') {
      html += '<button type="button" class="pcard__btn" data-odone="' + esc(id) + '">Готово</button>';
      html += '<button type="button" class="pcard__btn" data-onew="' + esc(id) + '">Вернуть</button>';
    } else {
      html += '<button type="button" class="pcard__btn pcard__btn--work" data-owork="' + esc(id) + '">В работу</button>';
      html += '<button type="button" class="pcard__btn" data-onew="' + esc(id) + '">В новые</button>';
    }
    return html;
  }

  function orderMatchesClient(o) {
    if (!clientFilter) return true;
    if (clientFilter.phone) return phoneDigits(o.clientPhone) === clientFilter.phone;
    if (clientFilter.name) {
      return String(o.clientName || '').trim().toLowerCase() === clientFilter.name &&
        !phoneDigits(o.clientPhone);
    }
    return true;
  }

  function renderOrders() {
    var list = ordersCache.filter(function (o) {
      if (!orderMatchesClient(o)) return false;
      if (ordFilter === 'all') return true;
      return (o.status || 'new') === ordFilter;
    });

    var fresh = ordersCache.filter(function (o) { return (o.status || 'new') === 'new'; }).length;
    ordCount.textContent = list.length;
    if (ordBadge) {
      ordBadge.hidden = fresh === 0;
      ordBadge.textContent = fresh;
    }

    var filterBar = document.getElementById('ordClientFilter');
    if (filterBar) {
      if (clientFilter) {
        var label = clientFilter.label || clientFilter.phone || clientFilter.name || 'клиент';
        filterBar.hidden = false;
        filterBar.innerHTML =
          'Показаны заказы клиента <b>' + esc(label) + '</b> · ' +
          '<button type="button" class="lnk" id="ordClearClient">Показать всех</button>';
      } else {
        filterBar.hidden = true;
        filterBar.innerHTML = '';
      }
    }

    ordList.innerHTML = '';

    if (!list.length) {
      ordList.innerHTML = '<li class="adm__empty">Пока нет заказов с этим фильтром.</li>';
      return;
    }

    list.forEach(function (o) {
      var status = o.status || 'new';
      var itemsHtml = (o.items || []).map(function (it) {
        return '<li>' + esc(it.name) +
          (it.size ? ' <i>(' + esc(it.size) + ')</i>' : '') +
          ' — <b>' + esc(it.qty) + ' шт.</b> × ' + esc(it.unitLabel || '') + '</li>';
      }).join('');

      var wa = waClientHref(o);
      var waBtn = wa
        ? '<a class="pcard__btn pcard__btn--wa" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>'
        : '<button type="button" class="pcard__btn pcard__btn--wa" disabled title="Нет номера телефона">WhatsApp</button>';

      var li = document.createElement('li');
      li.className = 'ocard' +
        (status === 'done' ? ' ocard--done' : '') +
        (status === 'work' ? ' ocard--work' : '');
      li.innerHTML =
        '<div class="ocard__top">' +
          '<div class="ocard__who">' +
            '<b>' + esc(o.clientName || 'Без имени') + '</b>' +
            '<a href="' + phoneHref(o.clientPhone) + '">' + esc(o.clientPhone || '—') + '</a>' +
          '</div>' +
          '<div class="ocard__meta">' +
            '<span class="bdg ' + statusBadgeClass(status) + '">' + statusLabel(status) + '</span>' +
            '<span class="ocard__dt">' + esc(o.id ? ('№ ' + o.id) : '') + ' · ' + esc(formatDate(o.createdAt)) + '</span>' +
          '</div>' +
        '</div>' +
        '<ul class="ocard__items">' + itemsHtml + '</ul>' +
        '<div class="ocard__bot">' +
          '<span class="ocard__total">Итого: <b>' + esc(o.totalLabel || '—') + '</b></span>' +
          '<div class="ocard__acts">' +
            '<button type="button" class="pcard__btn" data-invoice="' + esc(o.id) + '">📄 Скачать счет (PDF)</button>' +
            waBtn +
            statusActions(o.id, status) +
            '<button type="button" class="pcard__btn pcard__btn--del" data-odel="' + esc(o.id) + '">Удалить</button>' +
          '</div>' +
        '</div>';

      ordList.appendChild(li);
    });
  }

  document.getElementById('ordersSec').addEventListener('click', function (e) {
    if (e.target.id === 'ordClearClient' || e.target.closest('#ordClearClient')) {
      clientFilter = null;
      renderOrders();
    }
  });

  function moneySum(kzt) {
    try {
      if (Data && Data.money) return Data.money(kzt || 0);
    } catch (e) {}
    return (Math.round(kzt || 0)).toLocaleString('ru-RU') + ' ₸';
  }

  /* клиенты из CRM + статистика из заказов (телефон = уникальный ключ) */
  function enrichClients() {
    var byPhone = {};
    ordersCache.forEach(function (o) {
      if (!o || !o.id) return;
      var dig = phoneDigits(o.clientPhone);
      var key = dig || ('name:' + String(o.clientName || '').trim().toLowerCase());
      if (!key) return;
      if (!byPhone[key]) byPhone[key] = { orders: [], totalKzt: 0, newCount: 0, workCount: 0 };
      byPhone[key].orders.push(o);
      byPhone[key].totalKzt += Number(o.totalKzt) || 0;
      var st = o.status || 'new';
      if (st === 'new') byPhone[key].newCount++;
      if (st === 'work') byPhone[key].workCount++;
    });

    function clientFromOrders(key, stats) {
      var sorted = stats.orders.slice().sort(function (a, b) {
        return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
      });
      var last = sorted[0] || {};
      return {
        id: key,
        key: key,
        phone: phoneDigits(last.clientPhone),
        phoneDisplay: last.clientPhone || '',
        name: last.clientName || 'Без имени',
        lastOrderAt: last.createdAt,
        notes: '',
        orders: stats.orders,
        totalKzt: stats.totalKzt,
        newCount: stats.newCount,
        workCount: stats.workCount
      };
    }

    var base = (clientsCache || []).filter(function (c) { return c && c.id; });

    var fromBase = base.map(function (c) {
      var dig = phoneDigits(c.phone);
      var key = dig || ('name:' + String(c.name || '').trim().toLowerCase()) || c.id;
      var stats = byPhone[key] || { orders: [], totalKzt: 0, newCount: 0, workCount: 0 };
      var sortedOrders = stats.orders.slice().sort(function (a, b) {
        return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
      });
      var freshAt = sortedOrders[0] && sortedOrders[0].createdAt;
      var storedAt = c.lastOrderAt;
      var lastAt = freshAt;
      if (storedAt && (!freshAt || (Date.parse(storedAt) || 0) > (Date.parse(freshAt) || 0))) {
        lastAt = storedAt;
      }
      return {
        id: c.id,
        key: key,
        phone: dig,
        phoneDisplay: c.phoneDisplay || (dig ? '+' + dig : ''),
        name: c.name || 'Без имени',
        lastOrderAt: lastAt || storedAt || freshAt,
        notes: c.notes || '',
        hidden: !!c.hidden,
        orders: stats.orders,
        totalKzt: stats.totalKzt,
        newCount: stats.newCount,
        workCount: stats.workCount
      };
    }).filter(function (c) { return !c.hidden; });

    var seen = {};
    fromBase.forEach(function (c) { if (c.key) seen[c.key] = true; });
    Object.keys(byPhone).forEach(function (key) {
      if (!seen[key]) fromBase.push(clientFromOrders(key, byPhone[key]));
    });

    return fromBase.sort(function (a, b) {
      return (Date.parse(b.lastOrderAt || 0) || 0) - (Date.parse(a.lastOrderAt || 0) || 0);
    });
  }

  function clientGreeting(c) {
    var name = String(c.name || '').trim() || 'друг';
    var lines = ['Здравствуйте, ' + name + '!', ''];
    if (c.orders && c.orders.length) {
      var last = c.orders.slice().sort(function (a, b) {
        return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
      })[0];
      var firstItem = last && last.items && last.items[0];
      if (firstItem && firstItem.name) {
        lines.push('Вы хотели заказать у нас: ' + firstItem.name +
          (c.orders.length > 1 ? ' (и ещё ' + (c.orders.length - 1) + ')' : '') + '.');
        lines.push('');
      } else {
        lines.push('Что вы хотели заказать у нас?');
        lines.push('');
      }
    } else {
      lines.push('Что вы хотели заказать у нас?');
      lines.push('');
    }
    lines.push('Подскажите, всё верно? Готова помочь с оформлением.');
    return lines.join('\n');
  }

  function waClientLink(c) {
    if (!c.phone) return '';
    return 'https://wa.me/' + c.phone + '?text=' + encodeURIComponent(clientGreeting(c));
  }

  function saveClientNotes(id, notes) {
    if (!Clients) return;
    var list = Clients.loadLocal();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].notes = notes;
        list[i].notesAt = new Date().toISOString();
        Clients.saveLocal(list);
        if (window.SabinaSync) {
          window.SabinaSync.send({ url: '/api/clients', method: 'POST', body: list[i] });
        }
        clientsCache = list;
        return;
      }
    }
  }

  function hideClient(id) {
    if (!Clients) return;
    var list = Clients.loadLocal();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].hidden = true;
        list[i].hiddenAt = new Date().toISOString();
        Clients.saveLocal(list);
        if (window.SabinaSync) {
          window.SabinaSync.send({ url: '/api/clients', method: 'POST', body: list[i] });
        }
        clientsCache = list;
        return;
      }
    }
  }

  function renderClients() {
    if (!cliList) return;
    var allClients = enrichClients();
    var clients = allClients;
    var q = String((cliSearch && cliSearch.value) || '').trim().toLowerCase();
    var qDigits = q.replace(/\D/g, '');

    if (q) {
      clients = clients.filter(function (c) {
        var nameOk = String(c.name || '').toLowerCase().indexOf(q) !== -1;
        var phone = String(c.phoneDisplay || '') + String(c.phone || '');
        var phoneOk = qDigits && phone.replace(/\D/g, '').indexOf(qDigits) !== -1;
        return nameOk || phoneOk;
      });
    }

    if (cliCount) cliCount.textContent = clients.length;
    if (cliBadge) {
      cliBadge.hidden = allClients.length === 0;
      cliBadge.textContent = allClients.length;
    }

    cliList.innerHTML = '';
    if (!clients.length) {
      cliList.innerHTML = '<li class="adm__empty">Пока нет клиентов. Они появятся после первых заказов.</li>';
      return;
    }

    clients.forEach(function (c) {
      var wa = waClientLink(c);
      var waBtn = wa
        ? '<a class="pcard__btn pcard__btn--wa" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>'
        : '<button type="button" class="pcard__btn pcard__btn--wa" disabled title="Нет номера">WhatsApp</button>';

      var badges = '';
      if (c.newCount) badges += '<span class="bdg bdg--hit">' + c.newCount + ' нов.</span>';
      if (c.workCount) badges += '<span class="bdg bdg--work">' + c.workCount + ' в работе</span>';

      var sorted = (c.orders || []).slice().sort(function (a, b) {
        return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
      });
      var lastItems = (sorted[0] && sorted[0].items) || [];
      var preview = lastItems.slice(0, 2).map(function (it) {
        return esc(it.name) + (it.qty > 1 ? ' ×' + esc(it.qty) : '');
      }).join(', ');
      if (lastItems.length > 2) preview += '…';

      var canEdit = c.id && String(c.id).charAt(0) === 'c';

      var li = document.createElement('li');
      li.className = 'ccard';
      li.innerHTML =
        '<div class="ccard__top">' +
          '<div class="ocard__who">' +
            '<b>' + esc(c.name) + '</b>' +
            (c.phone
              ? '<a href="' + phoneHref(c.phoneDisplay || c.phone) + '">' + esc(c.phoneDisplay || ('+' + c.phone)) + '</a>'
              : (c.phoneDisplay
                ? '<span>' + esc(c.phoneDisplay) + '</span>'
                : '<span class="ocard__dt">без телефона</span>')) +
          '</div>' +
          '<div class="ocard__meta">' + badges + '</div>' +
        '</div>' +
        '<div class="ccard__stats">' +
          '<span><i>Заказов</i><b>' + (c.orders ? c.orders.length : 0) + '</b></span>' +
          '<span><i>Сумма</i><b>' + esc(moneySum(c.totalKzt)) + '</b></span>' +
        '</div>' +
        '<p class="ccard__last">' +
          (preview ? 'Последний: ' + preview + '<br>' : '') +
          '<span class="ocard__dt">' + esc(formatDate(c.lastOrderAt)) + '</span>' +
        '</p>' +
        '<label class="ccard__note">' +
          '<span>Заметка</span>' +
          '<textarea rows="2" data-cli-notes="' + esc(c.id) + '" placeholder="Комментарий по клиенту"' +
            (canEdit ? '' : ' disabled') + '>' + esc(c.notes || '') + '</textarea>' +
        '</label>' +
        '<div class="ocard__acts">' +
          (canEdit
            ? '<button type="button" class="pcard__btn" data-cli-save="' + esc(c.id) + '">Сохранить</button>'
            : '') +
          waBtn +
          '<button type="button" class="pcard__btn" data-cli-key="' + esc(c.key) + '">Заказы</button>' +
          (canEdit
            ? '<button type="button" class="pcard__btn" data-cli-hide="' + esc(c.id) + '">Скрыть</button>'
            : '') +
        '</div>';
      cliList.appendChild(li);
    });
  }

  if (cliList) {
    cliList.addEventListener('click', function (e) {
      var save = e.target.closest('[data-cli-save]');
      if (save) {
        var sid = save.getAttribute('data-cli-save');
        var ta = cliList.querySelector('textarea[data-cli-notes="' + sid + '"]');
        saveClientNotes(sid, ta ? ta.value : '');
        save.textContent = 'Сохранено';
        setTimeout(function () { save.textContent = 'Сохранить'; }, 1200);
        return;
      }

      var hide = e.target.closest('[data-cli-hide]');
      if (hide) {
        if (!confirm('Скрыть клиента из списка?')) return;
        hideClient(hide.getAttribute('data-cli-hide'));
        renderClients();
        return;
      }

      var b = e.target.closest('[data-cli-key]');
      if (!b) return;
      var key = b.getAttribute('data-cli-key');
      var clients = enrichClients();
      var c = null;
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].key === key) { c = clients[i]; break; }
      }
      if (!c) return;
      if (c.phone) {
        clientFilter = { phone: c.phone, label: c.name };
      } else {
        clientFilter = {
          name: String(c.name || '').trim().toLowerCase(),
          label: c.name
        };
      }
      setTab('orders');
      renderOrders();
    });
  }

  var invoiceOrder = null;
  var invModal = document.getElementById('invModal');

  function findOrder(id) {
    for (var i = 0; i < ordersCache.length; i++) {
      if (ordersCache[i] && ordersCache[i].id === id) return ordersCache[i];
    }
    return null;
  }

  function closeInvoice() {
    if (invModal) invModal.hidden = true;
    invoiceOrder = null;
  }

  function openInvoice(id) {
    var o = findOrder(id);
    if (!o || !invModal) return;
    invoiceOrder = o;
    document.getElementById('invName').value = o.clientName || '';
    document.getElementById('invPhone').value = o.clientPhone || '';
    document.getElementById('invBin').value = '';
    document.getElementById('invAddr').value = '';
    document.getElementById('invMsg').textContent = '';
    document.getElementById('invSave').disabled = false;
    invModal.hidden = false;
  }

  if (invModal) {
    invModal.addEventListener('click', function (e) {
      if (e.target.id === 'invX' || e.target.hasAttribute('data-close')) closeInvoice();
    });
    document.getElementById('invSave').addEventListener('click', function () {
      if (!invoiceOrder) return;
      var pdf = window.SabinaInvoicePdf;
      var msg = document.getElementById('invMsg');
      var btn = document.getElementById('invSave');
      if (!pdf || typeof pdf.download !== 'function') {
        msg.textContent = 'Библиотека PDF не загрузилась. Проверьте интернет и обновите страницу.';
        return;
      }
      btn.disabled = true;
      msg.textContent = 'Формируем PDF…';
      pdf.download(invoiceOrder, {
        name: document.getElementById('invName').value,
        phone: document.getElementById('invPhone').value,
        bin: document.getElementById('invBin').value,
        address: document.getElementById('invAddr').value
      }).then(function () {
        btn.disabled = false;
        msg.textContent = '';
        closeInvoice();
      }, function (err) {
        btn.disabled = false;
        msg.textContent = (err && err.message) ? err.message : 'Не удалось сформировать счёт. Обновите страницу и попробуйте ещё раз.';
      });
    });
  }

  ordList.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !Orders) return;

    if (b.dataset.invoice) {
      openInvoice(b.dataset.invoice);
      return;
    }
    if (b.dataset.owork) {
      applyOrderStatus(b.dataset.owork, 'work');
      return;
    }
    if (b.dataset.odone) {
      applyOrderStatus(b.dataset.odone, 'done');
      return;
    }
    if (b.dataset.onew) {
      applyOrderStatus(b.dataset.onew, 'new');
      return;
    }
    if (b.dataset.odel) {
      if (!confirm('Удалить этот заказ?')) return;
      Promise.resolve(Orders.remove(b.dataset.odel)).then(loadOrders, loadOrders);
    }
  });

  /* ─── Данные товаров ─── */
  var items = Data.load();

  function persist() {
    if (!Data.save(items)) {
      say('Браузер не дал сохранить изменения. Нажмите «Сохранить в файл».', true);
    }
    render();
  }

  /* ─── Форма ─── */
  var formBox   = document.getElementById('formBox');
  var form      = document.getElementById('form');
  var elId      = document.getElementById('id');
  var elName    = document.getElementById('name');
  var elPrice   = document.getElementById('price');
  var elCur     = document.getElementById('currency');
  var elQty     = document.getElementById('qty');
  var elType    = document.getElementById('type');
  var elOld     = document.getElementById('old');
  var elTag     = document.getElementById('tag');
  var elSize    = document.getElementById('size');
  var elDesc    = document.getElementById('desc');
  var elImg     = document.getElementById('img');
  var elHit     = document.getElementById('hit');
  var elOn      = document.getElementById('active');
  var preview   = document.getElementById('preview');
  var msg       = document.getElementById('msg');
  var saveBtn   = document.getElementById('saveBtn');
  var cancel    = document.getElementById('cancel');
  var title     = document.getElementById('formTitle');

  function say(text, isErr) {
    msg.textContent = text;
    msg.classList.toggle('err', !!isErr);
    if (text) setTimeout(function () { msg.textContent = ''; msg.classList.remove('err'); }, 4000);
  }

  function showPreview(src) {
    var s = String(src || '').trim();
    preview.innerHTML = s
      ? '<img src="' + esc(s) + '" alt="">'
      : '<span>нет фото</span>';
  }

  function openForm() {
    formBox.hidden = false;
    document.body.classList.add('locked');
    elName.focus();
  }

  function closeForm() {
    clearForm();
    formBox.hidden = true;
    document.body.classList.remove('locked');
  }

  elImg.addEventListener('input', function () { showPreview(elImg.value.trim()); });

  document.getElementById('pickBtn').addEventListener('click', function () {
    document.getElementById('file').click();
  });

  document.getElementById('clearImg').addEventListener('click', function () {
    elImg.value = '';
    showPreview('');
  });

  document.getElementById('file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var im = new Image();
      im.onload = function () {
        var max = 900;
        var k = Math.min(1, max / Math.max(im.width, im.height));
        var c = document.createElement('canvas');
        c.width = Math.round(im.width * k);
        c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);

        elImg.value = c.toDataURL('image/jpeg', 0.82);
        showPreview(elImg.value);
        say('Фото загружено.');
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  function clearForm() {
    form.reset();
    elId.value = '';
    elCur.value = 'kzt';
    elQty.value = '';
    elType.value = 'Товар';
    elOn.checked = true;
    showPreview('');
    title.textContent = 'Новый товар';
    saveBtn.textContent = 'Добавить товар';
  }

  newBtn.addEventListener('click', function () {
    clearForm();
    openForm();
  });

  cancel.addEventListener('click', closeForm);

  formBox.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeForm();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !formBox.hidden) closeForm();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name = elName.value.trim();
    var price = Number(elPrice.value);

    if (!name || !(price >= 0)) {
      say('Заполните название и цену.', true);
      return;
    }

    var data = {
      id:       elId.value || Data.newId(),
      name:     name,
      tag:      elTag.value.trim(),
      size:     elSize.value.trim(),
      desc:     elDesc.value.trim(),
      price:    price,
      old:      Number(elOld.value) || 0,
      currency: elCur.value || 'kzt',
      qty:      String(elQty.value || '').trim() === '' ? null : Math.max(0, Math.round(Number(elQty.value) || 0)),
      type:     elType.value || 'Товар',
      img:      elImg.value.trim(),
      hit:      elHit.checked,
      active:   elOn.checked
    };

    var i = index(data.id);
    if (i > -1) {
      items[i] = data;
      say('Изменения сохранены.');
    } else {
      items.push(data);
      say('Товар добавлен.');
    }

    clearForm();
    formBox.hidden = true;
    document.body.classList.remove('locked');
    persist();
  });

  function index(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return i;
    return -1;
  }

  function edit(id) {
    var p = items[index(id)];
    if (!p) return;

    elId.value = p.id;
    elName.value = p.name || '';
    elPrice.value = p.price || 0;
    elCur.value = p.currency || 'kzt';
    elQty.value = (p.qty == null || p.qty === '') ? '' : p.qty;
    elType.value = p.type || 'Товар';
    elOld.value = p.old || '';
    elTag.value = p.tag || '';
    elSize.value = p.size || '';
    elDesc.value = p.desc || '';
    elImg.value = p.img || '';
    elHit.checked = !!p.hit;
    elOn.checked = p.active !== false;
    showPreview(p.img || '');

    title.textContent = 'Правка товара';
    saveBtn.textContent = 'Сохранить изменения';
    openForm();
  }

  /* ─── Список карточками ─── */
  var list  = document.getElementById('list');
  var count = document.getElementById('count');
  var tags  = document.getElementById('tags');

  function formatOwn(n, code) {
    return Data.moneyOwn(n, code || 'kzt');
  }

  function render() {
    count.textContent = items.length;
    list.innerHTML = '';

    tags.innerHTML = '';
    var seen = {};
    items.forEach(function (p) {
      if (p.tag && !seen[p.tag]) {
        seen[p.tag] = 1;
        var o = document.createElement('option');
        o.value = p.tag;
        tags.appendChild(o);
      }
    });

    if (!items.length) {
      list.innerHTML = '<li class="adm__empty">Товаров пока нет. Нажмите «+ Новый товар».</li>';
      return;
    }

    items.forEach(function (p, i) {
      var li = document.createElement('li');
      li.className = 'pcard' + (p.active === false ? ' pcard--off' : '');

      var cur = p.currency || 'kzt';
      var badges =
        '<span class="bdg bdg--tag">' + esc(p.type || 'Товар') + '</span>' +
        '<span class="bdg">' + (p.qty == null || p.qty === '' ? 'Остаток не ведётся' : (Number(p.qty) <= 0 ? 'Нет в наличии' : ('Остаток: ' + p.qty))) + '</span>' +
        (p.tag ? '<span class="bdg">' + esc(p.tag) + '</span>' : '') +
        (p.hit ? '<span class="bdg bdg--hit">хит</span>' : '') +
        (p.active === false ? '<span class="bdg bdg--off">скрыт</span>' : '');

      var priceHtml =
        '<span>' + formatOwn(p.price, cur) + '</span>' +
        '<span class="pcard__cur">' + esc(CUR_LABEL[cur] || cur) + '</span>' +
        (p.old ? '<s>' + formatOwn(p.old, cur) + '</s>' : '');

      li.innerHTML =
        '<div class="pcard__ph' + (p.img ? '' : ' pcard__ph--empty') + '">' +
          (p.img ? '<img src="' + esc(p.img) + '" alt="">' : 'нет фото') +
        '</div>' +
        '<div class="pcard__b">' +
          '<div class="pcard__badges">' + badges + '</div>' +
          '<div class="pcard__n">' + esc(p.name) + '</div>' +
          '<div class="pcard__p">' + priceHtml + '</div>' +
          '<div class="pcard__d">' + esc(p.desc || p.size || '') + '</div>' +
          '<div class="pcard__a">' +
            '<button type="button" class="pcard__btn" data-edit="' + esc(p.id) + '">Изменить</button>' +
            '<button type="button" class="pcard__btn pcard__btn--del" data-del="' + esc(p.id) + '">Удалить</button>' +
          '</div>' +
          '<div class="pcard__move">' +
            '<button type="button" class="ibtn" data-up="' + i + '" title="Выше" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button type="button" class="ibtn" data-down="' + i + '" title="Ниже" ' + (i === items.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '</div>' +
        '</div>';

      list.appendChild(li);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.edit) { edit(b.dataset.edit); return; }

    if (b.dataset.del) {
      var i = index(b.dataset.del);
      if (i > -1 && confirm('Удалить «' + items[i].name + '»?')) {
        items.splice(i, 1);
        persist();
      }
      return;
    }

    var up = b.dataset.up, down = b.dataset.down;
    if (up !== undefined) { swap(Number(up), Number(up) - 1); }
    if (down !== undefined) { swap(Number(down), Number(down) + 1); }
  });

  function swap(a, b) {
    if (b < 0 || b >= items.length) return;
    var t = items[a];
    items[a] = items[b];
    items[b] = t;
    persist();
  }

  document.getElementById('pdfCatalog').addEventListener('click', function () {
    var btn = this;
    if (btn.disabled) return;
    var pdf = window.SabinaCatalogPdf;
    if (!pdf || typeof pdf.download !== 'function') {
      say('Библиотека PDF не загрузилась. Проверьте интернет и обновите страницу.', true);
      return;
    }
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Формируем PDF...';

    function cardFrom(p) {
      var cur = p.currency || 'kzt';
      var old = Number(p.old) || 0;
      var price = Number(p.price) || 0;
      return {
        img: p.img || '',
        tag: p.tag || '',
        name: p.name || '',
        size: p.size || '',
        desc: p.desc || '',
        priceText: Data.moneyOwn(price, cur),
        oldText: old > price ? Data.moneyOwn(old, cur) : '',
        hit: !!p.hit,
        hidden: p.active === false
      };
    }

    pdf.download({
      products: items.map(cardFrom),
      allowFallback: false,
      activeOnly: false,
      subtitle: 'Полный каталог',
      formatProduct: cardFrom
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    }, function () {
      btn.disabled = false;
      btn.textContent = label;
      say('Не удалось собрать PDF. Попробуйте ещё раз.', true);
    });
  });

  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('Очистить каталог? Товары пропадут, пока вы не добавите их заново.')) return;
    Data.reset();
    items = [];
    persist();
  });

  document.getElementById('export').addEventListener('click', function () {
    var src =
      '/* ══════════════════════════════════════════════════════════\n' +
      '   Настройки магазина и список товаров\n' +
      '   Файл выгружен из админки ' + new Date().toLocaleString('ru-RU') + '\n' +
      '   ══════════════════════════════════════════════════════════ */\n\n' +
      'window.SHOP = ' + JSON.stringify(CFG, null, 2) + ';\n\n' +
      'window.DEFAULT_PRODUCTS = ' + JSON.stringify(items, null, 2) + ';\n';

    var blob = new Blob([src], { type: 'text/javascript;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'products.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);

    say('Файл products.js скачан — положите его в папку сайта вместо старого.');
  });

  render();

  try {
    if (sessionStorage.getItem(SESS) === '1' && sessionStorage.getItem('sabina.admin.token')) openPanel();
  } catch (e) {}
})();
