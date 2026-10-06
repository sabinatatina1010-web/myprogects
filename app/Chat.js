import { html } from './html.js';
import { quickAsks } from './content.js';
import { createChat } from './ai/index.js';
import { saveLead } from './orders.js';

const { useEffect, useRef, useState } = React;

const CHAT_W_KEY = 'sabina.chat.width.v1';
const CHAT_H_KEY = 'sabina.chat.height.v1';
const CHAT_W_MIN = 300;
const CHAT_W_MAX = 560;
const CHAT_H_MIN = 360;
const CHAT_H_MAX = 780;

const GREET =
  'Здравствуйте! Я ИИ-консультант Сабины.\n\n' +
  'Помогу сориентироваться по питанию, марафону и продуктам. ' +
  'Можно прикрепить фото или файл кнопкой «+». ' +
  'Если понадобится личный план или запись — аккуратно переведу вас к Сабине в WhatsApp.';

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBotText(s) {
  return esc(s).replace(/\n/g, '<br>').replace(/\*\*([^*<>]+)\*\*/g, '<b>$1</b>');
}

function Bubble({ msg, onWa }) {
  if (msg.who === 'handoff') {
    return html`
      <div class="chat__handoff">
        <p>Сабина ответит лично в WhatsApp — сообщение уже подготовлено, останется только отправить.</p>
        <a href=${msg.href} target="_blank" rel="noopener" onClick=${(e) => onWa && onWa(e)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.15 6.36 2.15 11.72c0 1.9.5 3.76 1.45 5.4L2 22l5.06-1.55a9.9 9.9 0 0 0 4.98 1.27h.01c5.46 0 9.89-4.36 9.89-9.72C21.94 6.36 17.5 2 12.04 2zm5.76 14.05c-.24.67-1.4 1.23-1.93 1.31-.5.08-1.13.11-1.82-.11-.42-.14-.96-.31-1.66-.61-2.92-1.26-4.82-4.2-4.97-4.4-.14-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.45.27-.29.6-.36.8-.36h.58c.18 0 .43-.07.67.51.24.6.82 2.06.89 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.45.51-.15.14-.3.3-.13.58.17.29.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.36 1.46.29.15.46.12.63-.07.17-.2.73-.85.93-1.14.2-.29.4-.24.67-.14.27.1 1.72.81 2.01.96.29.15.49.22.56.34.07.13.07.74-.17 1.41z" /></svg>
          Написать Сабине в WhatsApp
        </a>
      </div>
    `;
  }
  const htmlText = msg.who === 'bot' ? formatBotText(msg.text || '') : esc(msg.text || '').replace(/\n/g, '<br>');
  return html`
    <div class=${'chat__bubble chat__bubble--' + (msg.who === 'user' ? 'user' : 'bot')}>
      ${(msg.files || []).map((f) => f.kind === 'image' && f.preview
        ? html`<span class="chat__media" key=${f.id}><img src=${f.preview} alt=${f.name} /></span>`
        : html`<span class="chat__file" key=${f.id}>📎 ${f.name}</span>`)}
      ${msg.text ? html`<span dangerouslySetInnerHTML=${{ __html: htmlText }} />` : null}
    </div>
  `;
}

export function Chat({ products, currency, blocked }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);
  const [typing, setTyping] = useState(false);
  const [hot, setHot] = useState(false);
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [waGoal, setWaGoal] = useState('');
  const panelRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const addRef = useRef(null);
  const resizeW = useRef(null);
  const resizeH = useRef(null);
  const busyRef = useRef(false);
  const attachGen = useRef(0);
  const reservedRef = useRef(0);
  const pendingRef = useRef([]);
  const productsRef = useRef(products);
  const currencyRef = useRef(currency);
  const chatRef = useRef(null);
  const waSaved = useRef({});
  productsRef.current = products;
  currencyRef.current = currency;
  pendingRef.current = pending;
  if (!chatRef.current) {
    chatRef.current = createChat({
      getProducts: () => productsRef.current,
      getCurrency: () => currencyRef.current
    });
  }
  const chat = chatRef.current;

  const href = chat.whatsapp(messages, waGoal);

  function rememberWa(e) {
    const link = e.currentTarget;
    let prev = '';
    try { prev = new URL(link.href).searchParams.get('text') || ''; } catch (err) {}
    const key = prev.slice(0, 180) || 'chat';
    if (!waSaved.current[key]) {
      const saved = saveLead({
        clientName: 'Чат на сайте',
        clientPhone: '',
        message: prev || waGoal || 'Переход в WhatsApp из чата',
        source: 'chat',
        totalLabel: 'Сообщение из чата'
      });
      waSaved.current[key] = saved.order.id;
    }
    const id = waSaved.current[key];
    try {
      const u = new URL(link.href);
      const text = u.searchParams.get('text') || '';
      if (text.indexOf(id) === -1) {
        u.searchParams.set('text', text + '\n\nНомер заявки: ' + id);
        link.href = u.toString();
      }
    } catch (err) {}
  }

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, typing, open]);

  useEffect(() => {
    if (!open) return;
    if (messages.length === 0) setMessages([{ id: 'greet', who: 'bot', text: GREET }]);
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 180);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) setAddOpen(false);
  }, [open]);

  useEffect(() => {
    if (!addOpen) return undefined;
    function onPointer(e) {
      if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [addOpen]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && addOpen) { setAddOpen(false); return; }
      if (e.key === 'Escape' && open && !blocked) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, blocked, addOpen]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('sabina.chat.seen')) return;
      const t = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem('sabina.chat.seen', '1');
      }, 1800);
      return () => clearTimeout(t);
    } catch (e) {}
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    function bounds(min, max, margin) {
      return { min, max: Math.min(max, Math.max(min, (margin === 'w' ? window.innerWidth - 44 : window.innerHeight - 100))) };
    }
    function applyW(px) {
      const b = bounds(CHAT_W_MIN, CHAT_W_MAX, 'w');
      const w = Math.round(Math.min(b.max, Math.max(b.min, px)));
      panel.style.setProperty('--chat-w', w + 'px');
      return w;
    }
    function applyH(px) {
      const b = bounds(CHAT_H_MIN, CHAT_H_MAX, 'h');
      const h = Math.round(Math.min(b.max, Math.max(b.min, px)));
      panel.style.setProperty('--chat-h', h + 'px');
      return h;
    }

    let savedW = 360;
    let savedH = 520;
    try {
      const nw = Number(localStorage.getItem(CHAT_W_KEY));
      const nh = Number(localStorage.getItem(CHAT_H_KEY));
      if (nw >= CHAT_W_MIN) savedW = nw;
      if (nh >= CHAT_H_MIN) savedH = nh;
    } catch (e) {}
    applyW(savedW);
    applyH(savedH);

    function bind(el, opts) {
      if (!el) return () => {};
      let dragging = false;
      let startPos = 0;
      let startSize = 0;
      function stop() {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove(opts.bodyClass);
        opts.onSave(opts.read());
      }
      function down(e) {
        if (opts.disabled()) return;
        dragging = true;
        startPos = opts.axis === 'x' ? e.clientX : e.clientY;
        startSize = opts.axis === 'x' ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height;
        document.body.classList.add(opts.bodyClass);
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      }
      function move(e) {
        if (!dragging) return;
        const delta = (opts.axis === 'x' ? e.clientX : e.clientY) - startPos;
        opts.onMove(startSize, delta);
      }
      function key(e) {
        const step = e.shiftKey ? 40 : 20;
        const cur = opts.read();
        if (e.key === opts.incKey) { opts.onSave(opts.apply(cur + step)); e.preventDefault(); }
        else if (e.key === opts.decKey) { opts.onSave(opts.apply(cur - step)); e.preventDefault(); }
      }
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('keydown', key);
      return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', stop);
        el.removeEventListener('pointercancel', stop);
        el.removeEventListener('keydown', key);
      };
    }

    const offW = bind(resizeW.current, {
      axis: 'x',
      bodyClass: 'chat-resizing-w',
      incKey: 'ArrowRight',
      decKey: 'ArrowLeft',
      disabled: () => window.innerWidth <= 480,
      read: () => parseFloat(getComputedStyle(panel).getPropertyValue('--chat-w')) || 360,
      apply: applyW,
      onMove: (start, delta) => applyW(start + delta),
      onSave: (w) => { try { localStorage.setItem(CHAT_W_KEY, String(w)); } catch (e) {} }
    });
    const offH = bind(resizeH.current, {
      axis: 'y',
      bodyClass: 'chat-resizing-h',
      incKey: 'ArrowUp',
      decKey: 'ArrowDown',
      disabled: () => false,
      read: () => parseFloat(getComputedStyle(panel).getPropertyValue('--chat-h')) || 520,
      apply: applyH,
      onMove: (start, delta) => applyH(start - delta),
      onSave: (h) => { try { localStorage.setItem(CHAT_H_KEY, String(h)); } catch (e) {} }
    });
    function onResize() {
      applyW(parseFloat(getComputedStyle(panel).getPropertyValue('--chat-w')) || 360);
      applyH(parseFloat(getComputedStyle(panel).getPropertyValue('--chat-h')) || 520);
    }
    window.addEventListener('resize', onResize);
    return () => { offW(); offH(); window.removeEventListener('resize', onResize); };
  }, []);

  function pushBot(text) {
    setMessages((list) => list.concat({ id: uid(), who: 'bot', text }));
  }

  async function addFiles(fileList) {
    const gen = attachGen.current;
    const incoming = fileList ? fileList.length : 0;
    const countAtStart = pendingRef.current.length + reservedRef.current;
    reservedRef.current += incoming;
    let added = [];
    let notices = [];
    try {
      const result = await chat.ingestFiles(fileList, countAtStart);
      added = result.added;
      notices = result.notices;
    } catch (e) {
      notices = ['Не удалось прочитать файл.'];
    } finally {
      reservedRef.current = Math.max(0, reservedRef.current - incoming);
    }
    if (gen !== attachGen.current) {
      if (added.length) pushBot('Файл не прикрепился: сообщение уже ушло. Прикрепите его ещё раз.');
      return;
    }
    notices.forEach(pushBot);
    if (!added.length) return;
    setPending((list) => {
      const room = chat.maxFiles - list.length;
      if (room <= 0) return list;
      const next = list.concat(added.slice(0, room));
      pendingRef.current = next;
      return next;
    });
  }

  function deliver(result) {
    if (!result) return;
    setMessages((list) => {
      const next = result.text ? list.concat({ id: uid(), who: 'bot', text: result.text }) : list.slice();
      if (result.handoff) {
        next.push({
          id: uid(),
          who: 'handoff',
          href: chat.whatsapp(list.concat({ who: 'user', text: result.userText }), result.userText)
        });
      }
      return next;
    });
    if (result.handoff) {
      setHot(true);
      setTimeout(() => setHot(false), 2600);
    }
  }

  async function ask(text) {
    text = String(text || '').trim();
    const files = pendingRef.current.slice();
    if ((!text && !files.length) || busyRef.current) return;
    busyRef.current = true;
    attachGen.current += 1;
    pendingRef.current = [];
    setWaGoal(text || (files.length ? 'Хочу обсудить вложение с сайта' : ''));
    setPending([]);
    if (fileRef.current) fileRef.current.value = '';

    const userMsg = {
      id: uid(),
      who: 'user',
      text: text || (files.length ? 'Вложение' : ''),
      files
    };
    setMessages((list) => list.concat(userMsg));
    setTyping(true);

    try {
      const result = await chat.ask({ text, files });
      deliver(result);
    } catch (err) {
      deliver({
        text: 'Не получилось отправить сообщение. Попробуйте ещё раз или напишите Сабине в WhatsApp.',
        handoff: true,
        userText: text
      });
    } finally {
      setTyping(false);
      busyRef.current = false;
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (busyRef.current) return;
    const val = draft;
    setDraft('');
    ask(val);
  }

  return html`
    <div class=${'chat' + (open ? ' open' : '')}>
      <div class="chat__panel" ref=${panelRef} hidden=${!open} role="dialog" aria-label="ИИ-консультант">
        <div class="chat__resize chat__resize--w" ref=${resizeW} role="separator" aria-orientation="vertical"
             aria-label="Изменить ширину чата" tabIndex="0">
          <span class="chat__resize-grip" aria-hidden="true">‹ ›</span>
        </div>
        <div class="chat__resize chat__resize--h" ref=${resizeH} role="separator" aria-orientation="horizontal"
             aria-label="Изменить высоту чата" tabIndex="0">
          <span class="chat__resize-grip" aria-hidden="true">‹ ›</span>
        </div>
        <header class="chat__h">
          <span class="chat__ava">AI</span>
          <span class="chat__who"><b>ИИ-консультант</b><i>онлайн</i></span>
          <button type="button" class="chat__x" aria-label="Закрыть чат" onClick=${() => setOpen(false)}>×</button>
        </header>
        <div class="chat__log" ref=${logRef} aria-live="polite">
          ${messages.map((msg) => html`<${Bubble} key=${msg.id} msg=${msg} onWa=${rememberWa} />`)}
          ${typing ? html`<div class="chat__bubble chat__bubble--bot chat__typing"><span></span><span></span><span></span></div>` : null}
        </div>
        <div class="chat__quick">
          ${quickAsks.map(([askText, label]) => html`
            <button type="button" key=${label} onClick=${() => ask(askText)}>${label}</button>
          `)}
        </div>
        <div class="chat__attach" hidden=${pending.length === 0}>
          ${pending.map((f) => html`
            <span class="chat__chip" key=${f.id}>
              ${f.kind === 'image' && f.preview
                ? html`<img src=${f.preview} alt="" />`
                : html`<span aria-hidden="true">📄</span>`}
              <span title=${f.name}>${f.name}</span>
              <button type="button" aria-label="Убрать" onClick=${() => setPending((list) => list.filter((item) => item.id !== f.id))}>×</button>
            </span>
          `)}
        </div>
        <form class="chat__f" onSubmit=${onSubmit}>
          <div class="chat__add" ref=${addRef}>
            <div class="chat__addmenu" hidden=${!addOpen} role="menu">
              <button type="button" role="menuitem" onClick=${() => { setAddOpen(false); if (imageRef.current) imageRef.current.click(); }}>
                Фото
              </button>
              <button type="button" role="menuitem" onClick=${() => { setAddOpen(false); if (fileRef.current) fileRef.current.click(); }}>
                Файл
              </button>
            </div>
            <button type="button" class="chat__plus" aria-label="Прикрепить фото или файл" title="Фото или файл"
                    aria-expanded=${addOpen ? 'true' : 'false'} aria-haspopup="menu"
                    onClick=${() => setAddOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <input type="file" ref=${imageRef} hidden multiple accept="image/*"
                 onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input type="file" ref=${fileRef} hidden multiple accept="image/*,.txt,.md,.csv,.json,.html,.htm,.log,.pdf,.doc,.docx,.rtf"
                 onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input type="text" ref=${inputRef} placeholder="Напишите вопрос..." autoComplete="off" maxLength="400"
                 value=${draft} onInput=${(e) => setDraft(e.target.value)} />
          <button type="submit" class="chat__send" aria-label="Отправить">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </form>
        <a class=${'chat__wa' + (hot ? ' is-hot' : '')} href=${href} target="_blank" rel="noopener" onClick=${rememberWa}>Написать Сабине в WhatsApp →</a>
      </div>
      <button class="chat__btn" type="button" aria-label="Спросить AI" aria-expanded=${open ? 'true' : 'false'}
              onClick=${() => setOpen((v) => !v)}>
        <svg class="chat__ico chat__ico--msg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4.5A2.5 2.5 0 0 1 4 13.5v-8Z" />
        </svg>
        <span class="chat__lbl">Спросить AI</span>
        <svg class="chat__ico chat__ico--x" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  `;
}
