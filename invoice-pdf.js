/* Счёт на оплату в браузере. html2pdf подключается отдельно и виден как window.html2pdf. */
(function () {
  'use strict';

  var STYLE_ID = 'invpdf-style';
  var CURRENCIES = {
    kzt: { symbol: '₸', round: 0 },
    rub: { symbol: '₽', round: 0 },
    usd: { symbol: '$', round: 2 }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function company() {
    var c = window.__invoiceCompany || {};
    return {
      name: c.name || '—',
      bin: c.bin_iin || '—',
      address: c.address || '—',
      phone: c.phone || '—',
      email: c.email || '',
      bank: c.bank_name || '—',
      iban: c.iban || '—',
      bik: c.bik || '—'
    };
  }

  function rates() {
    var shop = window.SHOP && window.SHOP.rates;
    return shop || { kzt: 1 };
  }

  function parseAmount(label) {
    var s = String(label || '').replace(/\s/g, '').replace(',', '.');
    var match = s.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function formatMoney(kzt, currency, rate) {
    var code = currency || 'kzt';
    var meta = CURRENCIES[code] || CURRENCIES.kzt;
    var used = Number(rate);
    if (!used) {
      used = Number(rates()[code]);
      if (!used) used = 1;
    }
    var val = (Number(kzt) || 0) * used;
    var n = meta.round === 0 ? Math.round(val) : Math.round(val * 100) / 100;
    var s = meta.round === 0 ? String(n) : n.toFixed(2);
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return code === 'usd' ? meta.symbol + s : s + ' ' + meta.symbol;
  }

  /* Курс заказа, а не сегодняшний: итог уже сохранён в totalLabel. */
  function orderRate(order) {
    var kzt = Number(order.totalKzt != null ? order.totalKzt : order.total_kzt);
    var parsed = parseAmount(order.totalLabel || order.total_label);
    if (kzt > 0 && isFinite(parsed)) return parsed / kzt;
    var live = Number(rates()[currencyOf(order)]);
    return live || 1;
  }

  function orderItems(order) {
    var items = order.items || order.items_json || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }
    return Array.isArray(items) ? items : [];
  }

  function invoiceNo(order) {
    var id = String(order.id || '').toUpperCase();
    return id ? ('СЧ-' + id) : 'СЧ';
  }

  function invoiceDate(order) {
    var raw = order.createdAt || order.created_at;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU');
  }

  function currencyOf(order) {
    return order.currency || 'kzt';
  }

  function totalText(order) {
    if (order.totalLabel) return String(order.totalLabel);
    if (order.total_label) return String(order.total_label);
    return formatMoney(order.totalKzt || order.total_kzt || 0, currencyOf(order), orderRate(order));
  }

  function unitText(item, currency, rate) {
    if (item.unitLabel) return String(item.unitLabel);
    var qty = Number(item.qty) || 0;
    var line = Number(item.lineKzt);
    if (qty > 0 && isFinite(line)) return formatMoney(line / qty, currency, rate);
    return formatMoney(0, currency, rate);
  }

  function lineText(item, currency, rate) {
    if (item.lineKzt != null && item.lineKzt !== '' && isFinite(Number(item.lineKzt))) {
      return formatMoney(item.lineKzt, currency, rate);
    }
    return unitText(item, currency, rate);
  }

  function cell(cls, text) {
    return '<span class="inv__c ' + cls + '">' + esc(text) + '</span>';
  }

  function buildSheet(order, extra) {
    extra = extra || {};
    var seller = company();
    var items = orderItems(order).filter(function (item) {
      return item && typeof item === 'object';
    });
    var currency = currencyOf(order);
    var rate = orderRate(order);
    var buyerName = String(extra.name || order.clientName || order.client_name || '').trim() || '—';
    var buyerPhone = String(extra.phone || order.clientPhone || order.client_phone || '').trim() || '—';
    var buyerBin = String(extra.bin || '').trim();
    var buyerAddress = String(extra.address || '').trim();
    var rows = items.map(function (item, index) {
      return '<div class="inv__row inv__keep">' +
        cell('inv__n', String(index + 1)) +
        cell('inv__name', item.name || '—') +
        cell('inv__size', item.size || '—') +
        cell('inv__qty', String(item.qty || 0)) +
        cell('inv__price', unitText(item, currency, rate)) +
        cell('inv__sum', lineText(item, currency, rate)) +
      '</div>';
    }).join('');
    if (!rows) {
      rows = '<div class="inv__row inv__keep">' + cell('inv__name', 'Нет позиций') + '</div>';
    }
    var email = seller.email
      ? '<p>Email: ' + esc(seller.email) + '</p>'
      : '';
    var root = document.createElement('div');
    root.className = 'invpdf';
    root.innerHTML =
      '<p class="inv__brand">' + esc(seller.name) + '</p>' +
      '<p class="inv__title">СЧЕТ НА ОПЛАТУ № ' + esc(invoiceNo(order)) + ' от ' + esc(invoiceDate(order)) + '</p>' +
      '<div class="inv__cols">' +
        '<div class="inv__col">' +
          '<b>Продавец</b>' +
          '<p>' + esc(seller.name) + '</p>' +
          '<p>ИИН/БИН: ' + esc(seller.bin) + '</p>' +
          '<p>Адрес: ' + esc(seller.address) + '</p>' +
          '<p>Телефон: ' + esc(seller.phone) + '</p>' +
          email +
          '<p>Банк: ' + esc(seller.bank) + '</p>' +
          '<p>IBAN: ' + esc(seller.iban) + '</p>' +
          '<p>БИК: ' + esc(seller.bik) + '</p>' +
        '</div>' +
        '<div class="inv__col">' +
          '<b>Покупатель</b>' +
          '<p>' + esc(buyerName) + '</p>' +
          '<p>Телефон: ' + esc(buyerPhone) + '</p>' +
          '<p>ИИН/БИН: ' + esc(buyerBin || 'Физическое лицо') + '</p>' +
          '<p>Адрес: ' + esc(buyerAddress || '—') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="inv__table">' +
        '<div class="inv__hrow">' +
          cell('inv__n', '№') +
          cell('inv__name', 'Наименование товара / услуги') +
          cell('inv__size', 'Объем / Размер') +
          cell('inv__qty', 'Кол-во') +
          cell('inv__price', 'Цена за ед.') +
          cell('inv__sum', 'Сумма') +
        '</div>' +
        rows +
      '</div>' +
      '<div class="inv__tot inv__keep">' +
        '<p><b>Итого к оплате: ' + esc(totalText(order)) + '</b></p>' +
        '<p class="inv__meta">Всего наименований ' + items.length + ', на сумму ' + esc(totalText(order)) + '</p>' +
        '<p class="inv__meta">Без НДС</p>' +
      '</div>' +
      '<div class="inv__sign inv__keep">' +
        '<p>Счет действителен в течение 3 банковских дней.</p>' +
        '<div class="inv__signrow"><span>Руководитель / Продавец</span><i></i></div>' +
        '<div class="inv__signrow"><span>Бухгалтер</span><i></i></div>' +
        '<div class="inv__stamp">М.П.</div>' +
      '</div>';
    return root;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.invpdf{width:680px;box-sizing:border-box;background:#fff;color:#161616;',
      'font-family:Onest,Segoe UI,sans-serif;padding:16px 18px 18px;overflow:visible;',
      'font-kerning:none;letter-spacing:.2px;}',
      '.invpdf-cover{position:fixed;inset:0;z-index:2147483001;background:#F4FBF6;display:flex;',
      'align-items:center;justify-content:center;font-family:Onest,Segoe UI,sans-serif;',
      'color:#14713E;font-size:18px;font-weight:700;}',
      '.inv__brand{margin:0;font-size:26px;font-weight:800;letter-spacing:0;line-height:1.25;padding-left:2px;}',
      '.inv__title{margin:14px 0 0;font-size:15px;font-weight:800;letter-spacing:.2px;line-height:1.4;padding-left:2px;}',
      '.inv__cols{display:block;margin:16px 0;font-size:0;}',
      '.inv__col{display:inline-block;width:calc(50% - 8px);vertical-align:top;border:1px solid #222;',
      'padding:12px 14px 12px 16px;box-sizing:border-box;overflow:visible;font-size:12px;}',
      '.inv__col+.inv__col{margin-left:16px;}',
      '.inv__col b{display:block;margin:0 0 6px;font-size:13px;}',
      '.inv__col p{margin:0 0 3px;font-size:12px;line-height:1.45;}',
      '.inv__table{border:1px solid #222;font-size:11.5px;}',
      '.inv__hrow,.inv__row{display:block;white-space:nowrap;overflow:visible;}',
      '.inv__row{border-top:1px solid #c8c8c8;}',
      '.inv__hrow{background:#f2f2f2;font-weight:700;}',
      '.inv__c{display:inline-block;vertical-align:top;white-space:normal;padding:8px 8px 8px 10px;',
      'font-size:11.5px;line-height:1.4;border-right:1px solid #c8c8c8;box-sizing:border-box;overflow:visible;}',
      '.inv__c:last-child{border-right:0;}',
      '.inv__n{width:40px;text-align:center;}',
      '.inv__name{width:calc(100% - 404px);}',
      '.inv__size{width:100px;}',
      '.inv__qty{width:64px;text-align:center;}',
      '.inv__price,.inv__sum{width:100px;text-align:right;}',
      '.inv__tot{margin-top:14px;text-align:right;}',
      '.inv__tot p{margin:0;}',
      '.inv__tot b{font-size:16px;}',
      '.inv__meta{margin-top:4px;font-size:12px;color:#333;}',
      '.inv__sign{margin-top:22px;font-size:13px;}',
      '.inv__sign p{margin:0 0 8px;}',
      '.inv__signrow{display:block;margin:16px 0;max-width:460px;white-space:nowrap;}',
      '.inv__signrow span{display:inline-block;width:210px;vertical-align:bottom;}',
      '.inv__signrow i{display:inline-block;width:200px;border-bottom:1px solid #222;height:18px;vertical-align:bottom;}',
      '.inv__stamp{width:74px;height:74px;border:1px dashed #777;display:flex;align-items:center;',
      'justify-content:center;color:#666;font-size:12px;margin-top:8px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function removeNode(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function padBlocks(root) {
    var pageH = 267 * 96 / 25.4;
    var blocks = root.querySelectorAll('.inv__keep');
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var parentTop = root.getBoundingClientRect().top;
      var rect = block.getBoundingClientRect();
      var top = rect.top - parentTop;
      var height = rect.bottom - rect.top;
      if (height <= 0 || height >= pageH) continue;
      var room = pageH - (top % pageH);
      if (room < height) {
        var spacer = document.createElement('div');
        spacer.style.display = 'block';
        spacer.style.height = Math.ceil(room) + 'px';
        block.parentNode.insertBefore(spacer, block);
      }
    }
  }

  function placeholderRequisites(c) {
    var iban = String(c.iban || '').replace(/\s/g, '').toUpperCase();
    var bin = String(c.bin_iin || '').replace(/\D/g, '');
    var phone = String(c.phone || '');
    if (!iban || !bin || !c.bank_name || !c.name) return true;
    if (iban === 'KZ123456789012345678') return true;
    if (bin === '900101300000') return true;
    if (/000[\s-]*00[\s-]*00/.test(phone)) return true;
    return false;
  }

  function loadCompany() {
    return fetch('/api/company', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('company');
      return r.json();
    });
  }

  function download(order, extra) {
    if (!order) return Promise.reject(new Error('order missing'));
    if (typeof window.html2pdf !== 'function') {
      return Promise.reject(new Error('html2pdf missing'));
    }
    return loadCompany().then(function (profile) {
      window.__invoiceCompany = profile || {};
      if (placeholderRequisites(window.__invoiceCompany)) {
        return Promise.reject(new Error('Заполните реквизиты продавца в админке: название, БИН, банк, IBAN и телефон.'));
      }
      return renderPdf(order, extra);
    });
  }

  function renderPdf(order, extra) {
    var id = String(order.id || 'order');
    var filename = 'Invoice_' + id + '.pdf';
    ensureStyle();
    var root = buildSheet(order, extra);
    var cover = document.createElement('div');
    cover.className = 'invpdf-cover';
    cover.textContent = 'Формируем счет…';
    var scrollY = window.scrollY || 0;
    document.body.insertBefore(root, document.body.firstChild);
    document.body.appendChild(cover);
    window.scrollTo(0, 0);

    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'visible';
    return fonts.then(function () {
      padBlocks(root);
      var options = {
        margin: 15,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: 680,
          scrollX: 0,
          scrollY: 0,
          onclone: function (doc) {
            doc.documentElement.style.overflow = 'visible';
            doc.body.style.overflow = 'visible';
            doc.body.style.margin = '0';
            var sheet = doc.querySelector('.invpdf');
            if (sheet) sheet.style.overflow = 'visible';
          }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['legacy'] }
      };
      return new Promise(function (resolve, reject) {
        window.html2pdf().set(options).from(root).toPdf().get('pdf').then(function (pdf) {
          try {
            saveBlob(pdf.output('blob'), filename);
            resolve();
          } catch (err) {
            reject(err);
          }
        }, reject);
      });
    }).then(function () {
      document.body.style.overflow = prevOverflow;
      removeNode(root);
      removeNode(cover);
      window.scrollTo(0, scrollY);
    }, function (err) {
      document.body.style.overflow = prevOverflow;
      removeNode(root);
      removeNode(cover);
      window.scrollTo(0, scrollY);
      throw err;
    });
  }

  window.SabinaInvoicePdf = { download: download };
})();
