import { html } from './html.js';
import {
  About, Contact, ContactModal, Faq, Footer, Header, Hero, Programs, Reviews, Steps, Ticker
} from './sections.js';
import { ShopBlock } from './ShopBlock.js';
import { Cart, Checkout, draftFromCart, draftFromProduct } from './Cart.js';
import { Chat } from './Chat.js';
import { ORDER_UNAVAILABLE, saveLead } from './orders.js';
import {
  CATALOG_KEY, copyText, countItems, loadCart, loadCurrency, loadProducts, maxOrderQty, phoneDigits, pullCatalog, saveCart, saveCurrency
} from './shop.js';

const { useEffect, useLayoutEffect, useRef, useState } = React;

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState('');
  const [currency, setCurrency] = useState(loadCurrency);
  const [products, setProducts] = useState([]);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [filter, setFilter] = useState('Все товары');
  const [cart, setCart] = useState(loadCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [orderNote, setOrderNote] = useState('');
  const [lastOrder, setLastOrder] = useState(null);
  const [bump, setBump] = useState(0);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState(false);

  const locked = menuOpen || contactOpen || cartOpen || !!checkout;

  useEffect(() => {
    document.body.classList.toggle('locked', locked);
  }, [locked]);

  useEffect(() => {
    function onScroll() { setStuck(window.scrollY > 8); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  useEffect(() => {
    const ids = ['about', 'shop', 'work', 'voices', 'qa', 'contact'];
    const sections = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!sections.length || !('IntersectionObserver' in window)) return undefined;
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
    return () => spy.disconnect();
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;

    function paint(el) {
      el.dataset.in = '1';
      el.classList.add('in');
    }

    if (!('IntersectionObserver' in window)) {
      root.querySelectorAll('.anim').forEach(paint);
      return undefined;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        paint(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -12% 0px' });

    const groups = new WeakMap();
    function watch() {
      root.querySelectorAll('.anim:not([data-in])').forEach((el) => {
        const parent = el.parentElement;
        const n = groups.get(parent) || 0;
        groups.set(parent, n + 1);
        if (!el.style.transitionDelay) el.style.transitionDelay = Math.min(n, 5) * 70 + 'ms';
        io.observe(el);
      });
    }

    watch();
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    document.querySelectorAll('.anim[data-in="1"]').forEach((el) => el.classList.add('in'));
  });

  useEffect(() => {
    let stop = false;
    pullCatalog().then((list) => {
      if (stop) return;
      setCatalogError(false);
      setCatalogReady(true);
      const next = list.filter((p) => p.active !== false);
      setProducts(next);
      setFilter((cur) => (cur !== 'Все товары' && !next.some((p) => p.tag === cur) ? 'Все товары' : cur));
    }).catch((err) => {
      console.error('catalog', err);
      if (stop) return;
      setCatalogReady(true);
      setCatalogError(true);
      setProducts([]);
    });
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    function onStorage(e) {
      if (e.key !== CATALOG_KEY) return;
      const next = loadProducts().filter((p) => p.active !== false);
      setCatalogError(false);
      setCatalogReady(true);
      setProducts(next);
      setFilter((cur) => (cur !== 'Все товары' && !next.some((p) => p.tag === cur) ? 'Все товары' : cur));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (checkout) { setCheckout(null); return; }
      if (cartOpen) { setCartOpen(false); return; }
      if (contactOpen) { setContactOpen(false); return; }
      setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [checkout, cartOpen, contactOpen]);

  function navigate() { setMenuOpen(false); }

  function openContact(e) {
    e.preventDefault();
    setMenuOpen(false);
    setContactOpen(true);
  }

  function scrollToForm(e) {
    e.preventDefault();
    setContactOpen(false);
    requestAnimationFrame(() => {
      const target = document.getElementById('contact');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function onCurrency(code) {
    setCurrency(code);
    saveCurrency(code);
  }

  function addToCart(id) {
    const p = products.find((item) => item.id === id);
    if (!p || maxOrderQty(p) < 1) {
      setOrderNote('Этого товара сейчас нет в наличии.');
      setCartOpen(true);
      return;
    }
    if (cart[id]) {
      setOrderNote('');
      setCartOpen(true);
      return;
    }
    setCart((prev) => {
      const next = Object.assign({}, prev);
      next[id] = Math.min(maxOrderQty(p), (next[id] || 0) + 1);
      saveCart(next);
      return next;
    });
    setBump((n) => n + 1);
  }

  function changeQty(id, dir) {
    setCart((prev) => {
      const next = Object.assign({}, prev);
      const p = products.find((item) => item.id === id);
      if (dir === 0) delete next[id];
      else {
        next[id] = Math.max(0, Math.min(maxOrderQty(p), (next[id] || 0) + dir));
        if (!next[id]) delete next[id];
      }
      saveCart(next);
      return next;
    });
  }

  function buy(id) {
    if (!catalogReady || catalogError || !products.length) {
      setOrderNote(ORDER_UNAVAILABLE);
      setCartOpen(true);
      return;
    }
    const p = products.find((item) => item.id === id);
    if (!p || maxOrderQty(p) < 1) {
      setOrderNote('Этого товара сейчас нет в наличии.');
      setCartOpen(true);
      return;
    }
    setCheckout(draftFromProduct(p, currency));
  }

  useEffect(() => {
    if (!catalogReady || catalogError) return;
    const ids = new Set(products.map((p) => p.id));
    setCart((prev) => {
      const next = {};
      let changed = false;
      Object.keys(prev).forEach((id) => {
        const p = products.find((item) => item.id === id);
        const cap = maxOrderQty(p);
        const qty = Math.min(prev[id] || 0, cap);
        if (ids.has(id) && qty > 0) {
          next[id] = qty;
          if (qty !== prev[id]) changed = true;
        } else changed = true;
      });
      if (!changed) return prev;
      saveCart(next);
      return next;
    });
  }, [products, catalogReady, catalogError]);

  function placeOrder() {
    if (!catalogReady || catalogError || !products.length) {
      setOrderNote(ORDER_UNAVAILABLE);
      setCartOpen(true);
      return;
    }
    const draft = draftFromCart(cart, products, currency);
    if (!draft.items.length) {
      setOrderNote(ORDER_UNAVAILABLE);
      setCartOpen(true);
      return;
    }
    setCheckout(draft);
  }

  function rejectOrder() {
    pullCatalog().then((list) => {
      setCatalogError(false);
      setProducts(list.filter((p) => p.active !== false));
    }).catch((err) => {
      console.error('catalog', err);
      setCatalogError(true);
      setProducts([]);
    });
  }

  function finishOrder(source, msg, order) {
    if (source === 'cart') {
      setCart({});
      saveCart({});
    }
    setCheckout(null);
    setLastOrder(order || null);
    setOrderNote(msg);
    setCartOpen(true);
  }

  const leadSending = useRef(false);

  function onLead(e) {
    e.preventDefault();
    if (leadSending.current) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') || '').trim();
    const contact = String(data.get('contact') || '').trim();
    const message = String(data.get('message') || '').trim();
    if (!name || !contact) {
      setNoteErr(true);
      setNote('Заполните имя и контакт.');
      return;
    }
    const form = e.currentTarget;
    leadSending.current = true;
    setNoteErr(false);
    setNote('Отправляем заявку…');
    const pending = saveLead({
      clientName: name,
      clientPhone: contact,
      message: message || 'Заявка с формы на сайте',
      source: 'contact',
      totalLabel: 'Заявка с сайта'
    });
    pending.synced.then((ok) => {
      leadSending.current = false;
      if (ok === 'rejected') {
        setNoteErr(true);
        setNote('Заявка ' + pending.order.id + ' не принята сервером. Проверьте имя и контакт.');
        return;
      }
      const text = 'Здравствуйте, Сабина! Заявка с сайта.\n' +
        'Имя: ' + name + '\n' +
        'Контакт: ' + contact +
        (message ? '\nЗапрос: ' + message : '') +
        '\nНомер заявки: ' + pending.order.id;
      const phone = phoneDigits();
      copyText(text).then((copied) => {
        const popup = phone
          ? window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank')
          : null;
        form.reset();
        const saved = ok
          ? 'Заявка ' + pending.order.id + ' сохранена в CRM.'
          : 'Заявка ' + pending.order.id + ' записана на этом устройстве и появится в CRM, когда сервер ответит.';
        let extra = popup ? ' Открываю WhatsApp.' : ' Браузер не открыл WhatsApp — разрешите всплывающие окна.';
        if (!copied) extra += ' Текст заявки не скопировался.';
        else if (!popup) extra += ' Текст уже скопирован.';
        setNoteErr(!copied);
        setNote(saved + extra);
      });
    });
  }

  return html`
    <${React.Fragment}>
      <a href="#top" class="skip">Перейти к содержимому</a>
      <${Header} stuck=${stuck} menuOpen=${menuOpen} active=${active}
        onToggle=${() => setMenuOpen((v) => !v)}
        onNavigate=${navigate}
        onContact=${openContact} />
      <main id="top">
        <${Hero} />
        <${Ticker} />
        <${About} />
        <${Programs} />
        <${ShopBlock}
          products=${products}
          catalogError=${catalogError}
          catalogReady=${catalogReady}
          currency=${currency}
          filter=${filter}
          cart=${cart}
          onCurrency=${onCurrency}
          onFilter=${setFilter}
          onAdd=${addToCart}
          onBuy=${buy} />
        <${Steps} />
        <${Reviews} />
        <${Faq} />
        <${Contact} onSubmit=${onLead} note=${note} noteErr=${noteErr} />
      </main>
      <${Footer} />
      <${ContactModal} open=${contactOpen} onClose=${() => setContactOpen(false)} onForm=${scrollToForm} />
      <${Cart}
        open=${cartOpen}
        products=${products}
        catalogReady=${catalogReady}
        catalogError=${catalogError}
        currency=${currency}
        cart=${cart}
        bump=${bump}
        orderNote=${orderNote}
        lastOrder=${lastOrder}
        onClose=${(next) => { setCartOpen(next); if (next) { setOrderNote(''); setLastOrder(null); } }}
        onChange=${changeQty}
        onOrdered=${placeOrder} />
      ${checkout ? html`<${Checkout} draft=${checkout} products=${products} currency=${currency}
        onClose=${() => setCheckout(null)} onDone=${finishOrder} onStatus=${setOrderNote} onReject=${rejectOrder} />` : null}
      <${Chat} products=${products} currency=${currency}
        blocked=${locked} />
    <//>
  `;
}
