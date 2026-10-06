import { html } from './html.js';
import { CURRENCIES, enabledCurrencies, maxOrderQty, moneyOldProduct, moneyProduct } from './shop.js';

const { useState } = React;

function pdfCard(p, currency) {
  const sale = p.old > p.price;
  return {
    img: p.img || '',
    tag: p.tag || '',
    name: p.name || '',
    size: p.size || '',
    desc: p.desc || '',
    priceText: moneyProduct(p, currency),
    oldText: sale ? moneyOldProduct(p, currency) : '',
    hit: !!p.hit,
    hidden: false
  };
}

export function ShopBlock({ products, catalogError, catalogReady, currency, filter, cart, onCurrency, onFilter, onAdd, onBuy }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNote, setPdfNote] = useState('');
  const tags = ['Все товары'];
  products.forEach((p) => {
    if (p.tag && tags.indexOf(p.tag) === -1) tags.push(p.tag);
  });
  const current = tags.indexOf(filter) === -1 ? 'Все товары' : filter;
  const list = products.filter((p) => current === 'Все товары' || p.tag === current);

  function onPdf() {
    if (pdfBusy) return;
    const pdf = window.SabinaCatalogPdf;
    if (!pdf || typeof pdf.download !== 'function') {
      setPdfNote('Библиотека PDF не загрузилась. Проверьте интернет и обновите страницу.');
      return;
    }
    setPdfBusy(true);
    setPdfNote('');
    pdf.download({
      products: list.map((p) => pdfCard(p, currency)),
      allowFallback: false,
      activeOnly: true,
      tag: current,
      subtitle: current,
      formatProduct: (p) => pdfCard(p, currency)
    }).then(() => {
      setPdfBusy(false);
    }, () => {
      setPdfBusy(false);
      setPdfNote('Не удалось собрать PDF. Попробуйте ещё раз.');
    });
  }

  return html`
    <section class="sec sec--shop" id="shop">
      <div class="wrap">
        <header class="sec__head sec__head--row">
          <div>
            <p class="lab anim">Магазин</p>
            <h2 class="h2 anim">Продукты <span class="c-green">для программы</span></h2>
          </div>
          <p class="sec__lead anim">
            Всё, что я использую в работе с клиентами. Не уверены, что нужно именно вам —
            напишите, подберём вместе на разборе.
          </p>
        </header>

        <div class="shop__bar">
          <div class="filters" id="filters">
            ${tags.map((t) => html`
              <button type="button" key=${t} class=${'chip' + (t === current ? ' on' : '')}
                      onClick=${() => onFilter(t)}>${t}</button>
            `)}
            <button type="button" class="shop__pdf" disabled=${pdfBusy} onClick=${onPdf}>
              ${pdfBusy ? 'Формируем PDF...' : '📄 Скачать каталог (PDF)'}
            </button>
            ${pdfNote ? html`<span class="shop__pdfnote" role="status">${pdfNote}</span>` : null}
          </div>
          <div class="curr" id="curr" role="group" aria-label="Валюта">
            ${enabledCurrencies().map((code) => html`
              <button type="button" key=${code} class=${'curr__b' + (currency === code ? ' on' : '')}
                      data-cur=${code} onClick=${() => onCurrency(code)}>
                ${CURRENCIES[code].symbol} ${CURRENCIES[code].label}
              </button>
            `)}
          </div>
        </div>

        <div class="goods" id="goods">
          ${catalogError
            ? html`<p class="shop__catalogerr" role="alert">Не удалось загрузить каталог. Попробуйте обновить страницу.</p>`
            : !catalogReady
            ? html`<p class="goods__none">Загружаем каталог…</p>`
            : list.length === 0
            ? html`<p class="goods__none">Пока нет товаров. Добавьте их в админке — файл admin.html.</p>`
            : list.map((p) => {
                const inCart = !!cart[p.id];
                const sale = p.old > p.price;
                const soldOut = maxOrderQty(p) < 1;
                return html`
                  <article class="good anim in" data-in="1" key=${p.id}>
                    <div class="good__ph">
                      ${p.img ? html`<img src=${p.img} alt=${p.name} loading="lazy" decoding="async" />` : null}
                      ${p.hit ? html`<span class="good__hit">Хит</span>` : null}
                      ${sale ? html`<span class="good__sale">−${Math.round((1 - p.price / p.old) * 100)}%</span>` : null}
                    </div>
                    <div class="good__b">
                      ${p.tag ? html`<span class="good__tag">${p.tag}</span>` : null}
                      <h3 class="good__t">${p.name}</h3>
                      ${p.size ? html`<span class="good__size">${p.size}</span>` : null}
                      ${p.desc ? html`<p class="good__d">${p.desc}</p>` : null}
                      <div class="good__bot">
                        <span class="good__price">
                          ${moneyProduct(p, currency)}
                          ${sale ? html`<s>${moneyOldProduct(p, currency)}</s>` : null}
                        </span>
                        <div class="good__acts">
                          <button type="button" class=${'good__add' + (inCart ? ' good__add--in' : '')}
                                  aria-pressed=${inCart ? 'true' : 'false'}
                                  disabled=${soldOut}
                                  onClick=${() => onAdd(p.id)}>
                            ${soldOut ? 'Нет в наличии' : (inCart ? 'В корзине ✓' : 'В корзину')}
                          </button>
                          <button type="button" class="good__buy" disabled=${soldOut} onClick=${() => onBuy(p.id)}>Заказать</button>
                        </div>
                      </div>
                    </div>
                  </article>
                `;
              })}
        </div>
      </div>
    </section>
  `;
}
