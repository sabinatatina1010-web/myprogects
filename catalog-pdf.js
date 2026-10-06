/* PDF-каталог в браузере. html2pdf подключается отдельно и виден как window.html2pdf. */
(function () {
  'use strict';

  var STYLE_ID = 'catpdf-style';

  function clip(text, max) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max - 1);
    cut = cut.replace(/\s+\S*$/, '');
    return (cut || s.slice(0, max - 1)) + '…';
  }

  function imgUrl(img) {
    var s = String(img || '').trim();
    if (!s) return '';
    if (s.indexOf('data:') === 0 || s.indexOf('blob:') === 0) return s;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.charAt(0) === '/') return window.location.origin + s;
    return window.location.origin + '/' + s.replace(/^\.\//, '');
  }

  function readFallback() {
    try {
      var raw = localStorage.getItem('sabina.catalog.v4');
      if (raw) {
        var list = JSON.parse(raw);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) {}
    return [];
  }

  function resolveProducts(opt) {
    var list = opt.products || [];
    if (list.length) return list.slice();
    if (!opt.allowFallback) return [];
    list = readFallback();
    if (opt.activeOnly) {
      list = list.filter(function (p) { return p && p.active !== false; });
    }
    if (opt.tag && opt.tag !== 'Все товары') {
      list = list.filter(function (p) { return p && p.tag === opt.tag; });
    }
    if (typeof opt.formatProduct === 'function') list = list.map(opt.formatProduct);
    return list;
  }

  function contacts() {
    var shop = window.SHOP || {};
    var phone = String(shop.phone || '').replace(/\D/g, '');
    var tg = String(shop.telegram || '').replace(/^@/, '');
    var parts = [];
    if (phone) parts.push('+' + phone);
    if (tg) parts.push('Telegram @' + tg);
    if (window.location && window.location.origin && window.location.origin !== 'null') {
      parts.push(window.location.origin);
    }
    return parts.join('   ·   ');
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.catpdf{width:720px;background:#fff;color:#12241B;',
      'font-family:Onest,Segoe UI,sans-serif;}',
      '.catpdf-cover{position:fixed;inset:0;z-index:2147483001;background:#F4FBF6;display:flex;',
      'align-items:center;justify-content:center;font-family:Onest,Segoe UI,sans-serif;',
      'color:#14713E;font-size:18px;font-weight:700;}',
      '.catpdf__head{display:flex;align-items:center;gap:12px;padding:16px 18px;background:#E8F6ED;border-radius:16px;}',
      '.catpdf__logo{width:44px;height:44px;border-radius:12px;object-fit:cover;background:#fff;}',
      '.catpdf__brand{font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.1;}',
      '.catpdf__brandsub{font-size:12px;color:#3E5247;margin-top:2px;}',
      '.catpdf__title{margin:18px 0 4px;font-size:28px;font-weight:800;letter-spacing:-.03em;}',
      '.catpdf__sub{margin:0 0 16px;font-size:13px;color:#3E5247;}',
      '.catpdf__row{display:flex;gap:12px;margin:0 0 12px;break-inside:avoid;page-break-inside:avoid;}',
      '.catpdf__card{flex:0 0 calc(50% - 6px);width:calc(50% - 6px);border:1px solid #E2EBE4;border-radius:16px;overflow:hidden;background:#fff;}',
      '.catpdf__ph{height:140px;background:#F4FBF6;position:relative;}',
      '.catpdf__ph img{width:100%;height:140px;object-fit:cover;display:block;}',
      '.catpdf__empty{height:140px;display:flex;align-items:center;justify-content:center;color:#7C9084;font-size:12px;}',
      '.catpdf__hit{position:absolute;top:8px;left:8px;background:#1FA85C;color:#fff;font-size:10px;font-weight:800;',
      'letter-spacing:.04em;padding:3px 8px;border-radius:999px;}',
      '.catpdf__body{padding:10px 12px 12px;}',
      '.catpdf__badges{display:flex;flex-wrap:wrap;gap:6px;min-height:18px;margin-bottom:6px;}',
      '.catpdf__tag{display:inline-block;background:#E8F6ED;color:#14713E;font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;}',
      '.catpdf__off{display:inline-block;background:#FFEAE3;color:#C2412D;font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;}',
      '.catpdf__name{margin:0;font-size:15px;font-weight:800;line-height:1.25;letter-spacing:-.02em;}',
      '.catpdf__size{display:block;margin-top:3px;font-size:11px;color:#7C9084;}',
      '.catpdf__desc{margin:6px 0 0;font-size:11px;line-height:1.35;color:#3E5247;max-height:44px;overflow:hidden;}',
      '.catpdf__price{margin-top:8px;font-size:16px;font-weight:800;color:#14713E;}',
      '.catpdf__price s{margin-left:6px;font-size:12px;font-weight:600;color:#7C9084;}',
      '.catpdf__foot{margin-top:16px;padding-top:10px;border-top:1px solid #E2EBE4;font-size:11px;color:#3E5247;}',
      '.catpdf__none{padding:28px 8px;font-size:14px;color:#3E5247;}'
    ].join('');
    document.head.appendChild(s);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  function waitImages(root) {
    var imgs = [].slice.call(root.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      function settle(node) {
        if (node.className !== 'catpdf__logo' && !node.naturalWidth && node.parentNode) {
          var ph = node.parentNode;
          ph.removeChild(node);
          ph.appendChild(el('div', 'catpdf__empty', 'нет фото'));
        }
      }
      if (img.complete) {
        settle(img);
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        var triedPlain = img.getAttribute('crossorigin') == null;
        function finish() {
          settle(img);
          resolve();
        }
        img.onload = function () { resolve(); };
        img.onerror = function () {
          if (!triedPlain) {
            triedPlain = true;
            img.onload = function () { resolve(); };
            img.onerror = finish;
            img.removeAttribute('crossorigin');
            var src = img.src;
            img.src = '';
            img.src = src;
            return;
          }
          finish();
        };
      });
    }));
  }

  function buildSheet(products, subtitle) {
    var root = el('div', 'catpdf');
    var head = el('div', 'catpdf__head');
    var logo = document.createElement('img');
    logo.className = 'catpdf__logo';
    logo.alt = '';
    logo.src = imgUrl('logo.png');
    head.appendChild(logo);
    var brand = el('div');
    brand.appendChild(el('div', 'catpdf__brand', 'Сабина'));
    brand.appendChild(el('div', 'catpdf__brandsub', 'консультант по питанию'));
    head.appendChild(brand);
    root.appendChild(head);

    root.appendChild(el('h1', 'catpdf__title', 'Каталог продукции'));
    var date = new Date().toLocaleDateString('ru-RU');
    var sub = (subtitle || 'Все товары') + ' · от ' + date;
    if (products.length) sub += ' · ' + products.length + ' ' + plural(products.length);
    root.appendChild(el('p', 'catpdf__sub', sub));

    if (!products.length) {
      root.appendChild(el('p', 'catpdf__none', 'В этой выборке пока нет товаров.'));
    } else {
      var rows = el('div', 'catpdf__rows');
      for (var i = 0; i < products.length; i += 2) {
        var row = el('div', 'catpdf__row');
        row.appendChild(card(products[i]));
        if (products[i + 1]) row.appendChild(card(products[i + 1]));
        rows.appendChild(row);
      }
      root.appendChild(rows);
    }

    var foot = el('div', 'catpdf__foot', contacts());
    root.appendChild(foot);
    return root;
  }

  function plural(n) {
    var n10 = n % 10;
    var n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return 'товар';
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'товара';
    return 'товаров';
  }

  function card(p) {
    var node = el('article', 'catpdf__card');
    var ph = el('div', 'catpdf__ph');
    var src = imgUrl(p.img);
    if (src) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = src;
      if (src.indexOf('data:') !== 0 && src.indexOf('blob:') !== 0) img.crossOrigin = 'anonymous';
      ph.appendChild(img);
    } else {
      ph.appendChild(el('div', 'catpdf__empty', 'нет фото'));
    }
    if (p.hit) ph.appendChild(el('span', 'catpdf__hit', 'Хит'));
    node.appendChild(ph);

    var body = el('div', 'catpdf__body');
    var badges = el('div', 'catpdf__badges');
    if (p.tag) badges.appendChild(el('span', 'catpdf__tag', p.tag));
    if (p.hidden) badges.appendChild(el('span', 'catpdf__off', 'Скрыт'));
    body.appendChild(badges);
    body.appendChild(el('h2', 'catpdf__name', p.name || 'Без названия'));
    if (p.size) body.appendChild(el('span', 'catpdf__size', p.size));
    if (p.desc) body.appendChild(el('p', 'catpdf__desc', clip(p.desc, 180)));
    var price = el('div', 'catpdf__price', p.priceText || '');
    if (p.oldText) price.appendChild(el('s', '', p.oldText));
    body.appendChild(price);
    node.appendChild(body);
    return node;
  }

  function stampPages(pdf) {
    var total = pdf.internal.getNumberOfPages();
    var width = pdf.internal.pageSize.getWidth();
    var height = pdf.internal.pageSize.getHeight();
    for (var i = 1; i <= total; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(120);
      pdf.text(String(i) + ' / ' + String(total), width - 16, height - 6, { align: 'right' });
    }
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

  function padRows(root) {
    // Внутренняя высота A4 при полях 10 мм и 96 dpi — так html2pdf режет страницы.
    var pageH = 277 * 96 / 25.4;
    var rows = root.querySelectorAll('.catpdf__row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var parentTop = root.getBoundingClientRect().top;
      var rect = row.getBoundingClientRect();
      var top = rect.top - parentTop;
      var height = rect.bottom - rect.top;
      if (height >= pageH) continue;
      if (Math.floor(top / pageH) !== Math.floor((top + height - 1) / pageH)) {
        var spacer = document.createElement('div');
        spacer.style.display = 'block';
        spacer.style.height = (pageH - (top % pageH)) + 'px';
        row.parentNode.insertBefore(spacer, row);
      }
    }
  }

  function download(opt) {
    opt = opt || {};
    if (typeof window.html2pdf !== 'function') {
      return Promise.reject(new Error('html2pdf missing'));
    }
    var products = resolveProducts(opt);
    var day = new Date().toISOString().slice(0, 10);
    var filename = opt.filename || ('Catalog_' + day + '.pdf');
    ensureStyle();
    var root = buildSheet(products, opt.subtitle);
    var cover = el('div', 'catpdf-cover', 'Формируем PDF…');
    var scrollY = window.scrollY || 0;
    document.body.insertBefore(root, document.body.firstChild);
    document.body.appendChild(cover);
    window.scrollTo(0, 0);

    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return fonts.then(function () {
      return waitImages(root);
    }).then(function () {
      padRows(root);
      var options = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 720 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['legacy'] }
      };
      return new Promise(function (resolve, reject) {
        window.html2pdf().set(options).from(root).toPdf().get('pdf').then(function (pdf) {
          try {
            stampPages(pdf);
            saveBlob(pdf.output('blob'), filename);
            resolve();
          } catch (err) {
            reject(err);
          }
        }, reject);
      });
    }).then(function () {
      removeNode(root);
      removeNode(cover);
      window.scrollTo(0, scrollY);
    }, function (err) {
      removeNode(root);
      removeNode(cover);
      window.scrollTo(0, scrollY);
      throw err;
    });
  }

  window.SabinaCatalogPdf = { download: download };
})();
