import { html } from './html.js';
import {
  buildItemsFromCart, buildItemsOne, countItems, labelFromItems, maxOrderQty, messengerKind, messengerLabel,
  moneyProduct, normalizePhone, openMessenger, orderText
} from './shop.js';
import { newOrderId, ORDER_UNAVAILABLE, saveOrder } from './orders.js';

const { useEffect, useRef, useState } = React;

const CART_W_KEY = 'sabina.cart.width.v1';
const CART_W_MIN = 300;
const CART_W_MAX = 720;

function cartWidthBounds() {
  return { min: CART_W_MIN, max: Math.min(CART_W_MAX, Math.max(CART_W_MIN, window.innerWidth - 24)) };
}

export function Cart({ open, products, catalogReady, catalogError, currency, cart, bump, orderNote, lastOrder, onClose, onChange, onOrdered }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNote, setPdfNote] = useState('');

  function onInvoice() {
    if (pdfBusy || !lastOrder) return;
    const pdf = window.SabinaInvoicePdf;
    if (!pdf || typeof pdf.download !== 'function') {
      setPdfNote('Библиотека PDF не загрузилась. Проверьте интернет и обновите страницу.');
      return;
    }
    setPdfBusy(true);
    setPdfNote('');
    pdf.download(lastOrder).then(() => {
      setPdfBusy(false);
    }, (err) => {
      setPdfBusy(false);
      setPdfNote((err && err.message) || 'Не удалось сформировать счёт. Обновите страницу и попробуйте ещё раз.');
    });
  }
  const panelRef = useRef(null);
  const resizeRef = useRef(null);
  const btnRef = useRef(null);
  const n = countItems(cart);
  const rows = Object.keys(cart).map((id) => {
    const p = products.find((item) => item.id === id);
    return p ? { id, p, qty: cart[id] } : null;
  }).filter(Boolean);
  const held = n > 0 && rows.length === 0;
  const catalogBlocked = !!catalogReady && held && (!!catalogError || !products.length);

  useEffect(() => {
    const btn = btnRef.current;
    if (!btn || !bump) return;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }, [bump]);

  useEffect(() => {
    const panel = panelRef.current;
    const handle = resizeRef.current;
    if (!panel || !handle) return;

    function apply(px) {
      const b = cartWidthBounds();
      const w = Math.round(Math.min(b.max, Math.max(b.min, px)));
      panel.style.setProperty('--cart-w', w + 'px');
      return w;
    }

    function saveWidth(value) {
      try {
        localStorage.setItem(CART_W_KEY, String(value));
        return true;
      } catch (e) {
        console.warn('localStorage cart width', e);
        return false;
      }
    }
    let saved = 430;
    try {
      const stored = Number(localStorage.getItem(CART_W_KEY));
      if (stored >= CART_W_MIN) saved = stored;
    } catch (e) {}
    apply(saved);

    let dragging = false;
    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('cart-resizing');
      const cur = parseFloat(getComputedStyle(panel).getPropertyValue('--cart-w')) || 430;
      try { saveWidth(cur); } catch (e) {}
    }
    function onDown(e) {
      if (window.innerWidth <= 640) return;
      dragging = true;
      document.body.classList.add('cart-resizing');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      apply(window.innerWidth - e.clientX);
    }
    function onKey(e) {
      const step = e.shiftKey ? 40 : 20;
      const cur = parseFloat(getComputedStyle(panel).getPropertyValue('--cart-w')) || 430;
      if (e.key === 'ArrowLeft') {
        const w = apply(cur + step);
        saveWidth(w);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        const w = apply(cur - step);
        saveWidth(w);
        e.preventDefault();
      }
    }
    function onResize() {
      const cur = parseFloat(getComputedStyle(panel).getPropertyValue('--cart-w')) || 430;
      apply(cur);
    }

    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
    handle.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stopDrag);
      handle.removeEventListener('pointercancel', stopDrag);
      handle.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return html`
    <button class="cartbtn" ref=${btnRef} type="button" hidden=${n === 0}
            aria-label="Открыть корзину" onClick=${() => onClose(true)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="17" cy="20" r="1.4" />
        <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20 8H7" />
      </svg>
      <b id="cartn">${n}</b>
    </button>

    <div class="cartwrap" hidden=${!open}>
      <div class="cart__ov" onClick=${() => onClose(false)}></div>
      <aside class="cart" ref=${panelRef} role="dialog" aria-label="Корзина" aria-modal="true">
        <div class="cart__resize" ref=${resizeRef} role="separator" aria-orientation="vertical"
             aria-label="Изменить ширину панели" tabIndex="0"></div>
        <header class="cart__h">
          <b>Ваш заказ</b>
          <button type="button" class="cart__x" aria-label="Закрыть" onClick=${() => onClose(false)}>×</button>
        </header>
        <ul class="cart__list">
          ${rows.map((row) => html`
            <li class="citem" key=${row.id}>
              <span class="citem__ph">${row.p.img ? html`<img src=${row.p.img} alt="" />` : null}</span>
              <span class="citem__t">${row.p.name}<i>${moneyProduct(row.p, currency)}</i></span>
              <span class="qty">
                <button type="button" aria-label="Меньше" onClick=${() => onChange(row.id, -1)}>−</button>
                <b>${row.qty}</b>
                <button type="button" aria-label="Больше" disabled=${row.qty >= maxOrderQty(row.p)} onClick=${() => onChange(row.id, 1)}>+</button>
              </span>
              <button type="button" class="citem__x" aria-label="Убрать" onClick=${() => onChange(row.id, 0)}>×</button>
            </li>
          `)}
        </ul>
        <p class="cart__empty" hidden=${rows.length > 0 || held}>Корзина пока пустая.</p>
        <footer class="cart__f">
          <div class="cart__sum"><span>Итого</span><b>${labelFromItems(buildItemsFromCart(cart, products, currency), currency)}</b></div>
          <button type="button" class="btn btn--full" disabled=${rows.length === 0 && !catalogBlocked} onClick=${onOrdered}>Оформить заказ</button>
          ${catalogBlocked ? html`<p class="cart__note" role="alert">${ORDER_UNAVAILABLE}</p>` : null}
          <p class="cart__note" role="status">${orderNote}</p>
          ${lastOrder ? html`<button type="button" class="btn btn--ghost btn--full cart__invoice" disabled=${pdfBusy} onClick=${onInvoice}>${pdfBusy ? 'Формируем PDF…' : '📄 Скачать счет-фактуру (PDF)'}</button>` : null}
          ${pdfNote ? html`<p class="cart__note">${pdfNote}</p>` : null}
          <p class="cart__hint">Оставьте имя и телефон — заказ сохранится, и я отвечу в мессенджере.</p>
        </footer>
      </aside>
    </div>
  `;
}

export function Checkout({ draft, products, currency, onClose, onDone, onStatus, onReject }) {
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const nameRef = useRef(null);
  const sending = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { if (nameRef.current) nameRef.current.focus(); }, 50);
    return () => clearTimeout(t);
  }, []);

  if (!draft) return null;

  function submit(e) {
    e.preventDefault();
    if (sending.current) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') || '').trim();
    const phoneRaw = String(data.get('phone') || '').trim();
    const phone = normalizePhone(phoneRaw);
    if (!name) { setErr('Укажите имя.'); return; }
    if (phone.length < 10) { setErr('Укажите корректный номер телефона.'); return; }

    sending.current = true;
    setSent(true);
    setErr('');
    const channel = messengerKind();
    const order = {
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      clientName: name,
      clientPhone: phoneRaw,
      items: draft.items,
      totalKzt: draft.totalKzt,
      totalLabel: draft.totalLabel,
      currency,
      messenger: channel,
      status: 'new',
      source: draft.source || 'cart'
    };
    const pending = saveOrder(order, products);
    pending.synced.then((ok) => {
      if (ok === 'blocked') {
        sending.current = false;
        setSent(false);
        setErr(ORDER_UNAVAILABLE);
        return;
      }
      if (ok === 'rejected') {
        sending.current = false;
        setSent(false);
        setErr('Заказ не принят: товара нет в наличии или данные не прошли проверку. Корзина на месте.');
        if (onReject) onReject();
        return;
      }
      openMessenger(orderText(draft, name, phoneRaw, order.id)).then((opened) => {
        const channel = opened && opened.channel;
        const copied = !!(opened && opened.copied);
        const where = !copied
          ? 'Текст заказа не скопировался. Откройте мессенджер и отправьте заказ вручную.'
          : channel === 'telegram'
            ? 'Открываю Telegram — вставьте сообщение (оно уже скопировано).'
            : channel === 'blocked'
              ? 'Браузер не открыл мессенджер. Разрешите всплывающие окна — текст заказа уже скопирован.'
              : 'Открываю WhatsApp с готовым текстом.';
        const crm = ok
          ? 'Заказ ' + order.id + ' сохранён в CRM.'
          : 'Заказ ' + order.id + ' записан на этом устройстве и появится в CRM, как только сервер ответит.';
        onDone(draft.source, where + ' ' + crm, order);
      });
    });
  }

  return html`
    <div class="chk">
      <div class="chk__ov" onClick=${onClose}></div>
      <div class="chk__box" role="dialog" aria-modal="true" aria-labelledby="chkTitle">
        <div class="chk__head">
          <div>
            <h2 class="chk__t" id="chkTitle">Оформление заказа</h2>
            <p class="chk__sub">Оставьте контакты — и я отвечу в мессенджере.</p>
          </div>
          <button type="button" class="chk__x" aria-label="Закрыть" onClick=${onClose}>×</button>
        </div>
        <form autoComplete="on" onSubmit=${submit}>
          <label class="f">
            <span>Ваше имя *</span>
            <input ref=${nameRef} type="text" name="name" placeholder="Как к вам обращаться" required autoComplete="name" />
          </label>
          <label class="f">
            <span>Номер телефона *</span>
            <input type="tel" name="phone" placeholder="+7 700 000 00 00" required autoComplete="tel" inputMode="tel" />
          </label>
          <div class="chk__sum"><span>Сумма заказа</span><b>${draft.totalLabel}</b></div>
          <button class="btn btn--full" type="submit" disabled=${sent}>${sent ? 'Отправляем…' : ('Перейти в ' + messengerLabel())}</button>
          <p class="chk__err" role="status">${err}</p>
          <p class="chk__hint">После отправки откроется чат с готовым текстом заказа.</p>
        </form>
      </div>
    </div>
  `;
}

export function draftFromCart(cart, products, currency) {
  const items = buildItemsFromCart(cart, products, currency);
  const totalKzt = items.reduce((s, it) => s + (it.lineKzt || 0), 0);
  return { source: 'cart', items, totalKzt, totalLabel: labelFromItems(items, currency) };
}

export function draftFromProduct(p, currency) {
  const items = buildItemsOne(p, currency);
  return { source: 'buy', items, totalKzt: items[0].lineKzt, totalLabel: labelFromItems(items, currency) };
}
