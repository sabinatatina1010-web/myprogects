/* Каталог, валюты и корзина. Ключи localStorage те же, что у админки. */

export const CATALOG_KEY = 'sabina.catalog.v4';
export const CART_KEY = 'sabina.cart.v1';
export const CUR_KEY = 'sabina.currency.v1';

export const CURRENCIES = {
  kzt: { code: 'kzt', symbol: '₸', label: 'Тенге', round: 0 },
  rub: { code: 'rub', symbol: '₽', label: 'Рубли', round: 0 },
  usd: { code: 'usd', symbol: '$', label: 'Доллар', round: 2 }
};

export function shopCfg() {
  return window.SHOP || {
    messenger: 'whatsapp',
    phone: '',
    telegram: '',
    currency: 'kzt',
    rates: { kzt: 1 }
  };
}

export function rates() {
  const raw = shopCfg().rates;
  const out = { kzt: 1 };
  if (!raw || typeof raw !== 'object') return out;
  ['kzt', 'rub', 'usd'].forEach((code) => {
    const n = Number(raw[code]);
    if (n > 0) out[code] = n;
  });
  if (!(Number(out.kzt) > 0)) out.kzt = 1;
  return out;
}

export function enabledCurrencies() {
  const known = rates();
  return ['kzt', 'rub', 'usd'].filter((code) => code === 'kzt' || Number(known[code]) > 0);
}

export function phoneDigits() {
  return String(shopCfg().phone || '').replace(/\D/g, '');
}

export function telegramUser() {
  return String(shopCfg().telegram || '').replace(/^@/, '');
}

export function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
    return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9, 11);
  }
  return d ? '+' + d : '';
}

export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  return d;
}

export function messengerKind() {
  return String(shopCfg().messenger || 'whatsapp').toLowerCase() === 'telegram'
    ? 'telegram' : 'whatsapp';
}

export function messengerLabel() {
  return messengerKind() === 'telegram' ? 'Telegram' : 'WhatsApp';
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

export function pullCatalog() {
  return fetch('/api/catalog', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('catalog status ' + r.status);
      return r.json();
    })
    .then((data) => {
      if (!data || !Array.isArray(data.products)) throw new Error('invalid catalog format');
      const norm = data.products.map(normalize);
      try {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(norm));
      } catch (e) {
        console.warn('localStorage catalog', e);
      }
      return norm;
    });
}

export function loadProducts() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.map(normalize);
    }
  } catch (e) {
    console.warn('localStorage catalog', e);
  }
  return [];
}

export function loadCurrency() {
  const allowed = enabledCurrencies();
  try {
    const saved = localStorage.getItem(CUR_KEY);
    if (saved && allowed.indexOf(saved) !== -1) return saved;
  } catch (e) {
    console.warn('localStorage currency', e);
  }
  const def = shopCfg().currency || 'kzt';
  return allowed.indexOf(def) !== -1 ? def : 'kzt';
}

export function saveCurrency(code) {
  try {
    localStorage.setItem(CUR_KEY, code);
    return true;
  } catch (e) {
    console.warn('localStorage currency', e);
    return false;
  }
}

export function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const cart = {};
    Object.keys(raw).forEach((id) => {
      const n = Math.round(Number(raw[id]));
      if (id && n > 0) cart[id] = n;
    });
    return cart;
  } catch (e) { return {}; }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    return true;
  } catch (e) {
    console.warn('localStorage cart', e);
    return false;
  }
}

export function formatAmount(val, code) {
  const meta = CURRENCIES[code] || CURRENCIES.kzt;
  const n = meta.round === 0 ? Math.round(val) : Math.round(val * 100) / 100;
  let s = meta.round === 0 ? String(n) : n.toFixed(2);
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return code === 'usd' ? meta.symbol + s : s + ' ' + meta.symbol;
}

export function toKzt(amount, fromCode) {
  const code = fromCode || 'kzt';
  const rate = Number(rates()[code]);
  if (code !== 'kzt' && !(rate > 0)) return Number(amount) || 0;
  const divisor = rate > 0 ? rate : 1;
  return (Number(amount) || 0) / divisor;
}

export function convert(kztAmount, code) {
  const table = rates();
  const target = code && Number(table[code]) > 0 ? code : 'kzt';
  const rate = Number(table[target]) || 1;
  const meta = CURRENCIES[target] || CURRENCIES.kzt;
  const val = (Number(kztAmount) || 0) * rate;
  if (meta.round === 0) return Math.round(val);
  return Math.round(val * 100) / 100;
}

export function moneyProduct(p, currency) {
  const kzt = toKzt(p.price, p.currency || 'kzt');
  return formatAmount(convert(kzt, currency), currency);
}

export function moneyOldProduct(p, currency) {
  if (!(p.old > 0)) return '';
  const kzt = toKzt(p.old, p.currency || 'kzt');
  return formatAmount(convert(kzt, currency), currency);
}

export function money(kztAmount, currency) {
  return formatAmount(convert(kztAmount, currency), currency);
}

/* null — остаток не ведётся (потолок 99). 0 — нет в наличии. */
export function maxOrderQty(p) {
  if (!p) return 0;
  if (p.qty == null || p.qty === '') return 99;
  const n = Math.round(Number(p.qty));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(99, n);
}

export function countItems(cart) {
  return Object.keys(cart).reduce((n, id) => n + (cart[id] || 0), 0);
}

export function cartTotalKzt(cart, products) {
  let sum = 0;
  Object.keys(cart).forEach((id) => {
    const p = products.find((item) => item.id === id);
    if (p) sum += toKzt(p.price, p.currency || 'kzt') * cart[id];
  });
  return sum;
}

export function buildItemsFromCart(cart, products, currency) {
  const items = [];
  Object.keys(cart).forEach((id) => {
    const p = products.find((item) => item.id === id);
    if (!p) return;
    const qty = cart[id];
    const unitKzt = toKzt(p.price, p.currency || 'kzt');
    const unitValue = convert(unitKzt, currency);
    items.push({
      id: p.id,
      name: p.name,
      size: p.size || '',
      qty,
      price: p.price,
      currency: p.currency || 'kzt',
      unitLabel: formatAmount(unitValue, currency),
      unitValue,
      lineKzt: Math.round(unitKzt * qty)
    });
  });
  return items;
}

export function buildItemsOne(p, currency) {
  const unitKzt = toKzt(p.price, p.currency || 'kzt');
  const unitValue = convert(unitKzt, currency);
  return [{
    id: p.id,
    name: p.name,
    size: p.size || '',
    qty: 1,
    price: p.price,
    currency: p.currency || 'kzt',
    unitLabel: formatAmount(unitValue, currency),
    unitValue,
    lineKzt: Math.round(unitKzt)
  }];
}

export function labelFromItems(items, currency) {
  let sum = 0;
  (items || []).forEach((it) => { sum += (Number(it.unitValue) || 0) * (it.qty || 0); });
  return formatAmount(sum, currency);
}

export function orderText(draft, name, phone, orderId) {
  const lines = ['Здравствуйте Сабина, хочу сделать заказ', '', 'Имя: ' + name, 'Телефон: ' + phone, ''];
  draft.items.forEach((it, idx) => {
    lines.push((idx + 1) + '. ' + it.name +
      (it.size ? ' (' + it.size + ')' : '') +
      ' — ' + it.qty + ' шт. × ' + it.unitLabel);
  });
  lines.push('', 'Итого: ' + draft.totalLabel);
  if (orderId) lines.push('Номер заказа: ' + orderId);
  return lines.join('\n');
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  }
  return new Promise((resolve) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    resolve(!!ok);
  });
}

export function openMessenger(text) {
  const copied = copyText(text);
  let popup = null;
  let channel = 'blocked';
  if (messengerKind() === 'telegram') {
    const user = telegramUser();
    if (user) popup = window.open('https://t.me/' + encodeURIComponent(user), '_blank');
    channel = popup ? 'telegram' : 'blocked';
  } else {
    const phone = phoneDigits();
    if (phone) popup = window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');
    channel = popup ? 'whatsapp' : 'blocked';
  }
  return copied.then((ok) => ({ channel, copied: !!ok }));
}
