import { html } from './html.js';
import { checks, faq, fitNo, fitYes, nav, programs, reviews, steps, INSTAGRAM } from './content.js';
import { formatPhone, phoneDigits, telegramUser } from './shop.js';

const { useState } = React;

function Mark({ foot }) {
  return html`
    <a href="#top" class=${'mark' + (foot ? ' mark--foot' : '')}>
      <img class="mark__ico" src="logo.png?v=3" alt="" width="40" height="40" />
      <span class="mark__tx">Сабина<i>консультант по питанию</i></span>
    </a>
  `;
}

export function Header({ stuck, menuOpen, active, onToggle, onNavigate, onContact }) {
  return html`
    <header class=${'head' + (stuck ? ' stuck' : '')} id="head">
      <div class="wrap head__in">
        <${Mark} />
        <nav class=${'menu' + (menuOpen ? ' open' : '')} id="menu">
          ${nav.map(([href, label]) => html`
            <a key=${href} href=${href} class=${active === href.slice(1) ? 'on' : ''}
               aria-current=${active === href.slice(1) ? 'true' : undefined}
               onClick=${() => onNavigate(href)}>${label}</a>
          `)}
          <a href="#contact" id="navContact" onClick=${onContact}>Контакт</a>
          <a href="#contact" class=${'btn btn--sm menu__cta' + (active === 'contact' ? ' on' : '')}
             onClick=${() => onNavigate('#contact')}>Записаться</a>
        </nav>
        <button class="toggle${menuOpen ? ' on' : ''}" id="toggle" aria-label="Меню"
                aria-expanded=${menuOpen ? 'true' : 'false'} onClick=${onToggle}>
          <span class="toggle__txt">${menuOpen ? 'Закрыть' : 'Меню'}</span>
          <span class="toggle__ico"><i></i><i></i></span>
        </button>
      </div>
    </header>
  `;
}

export function Hero() {
  return html`
    <section class="hero">
      <span class="blob blob--1" aria-hidden="true"></span>
      <span class="blob blob--2" aria-hidden="true"></span>
      <svg class="leaf leaf--1" viewBox="0 0 64 64" aria-hidden="true"><path d="M58 6C30 6 6 20 6 42c0 6 3 12 8 16C18 36 32 22 52 16 34 26 22 40 18 60c26 4 40-18 40-54Z" /></svg>
      <svg class="leaf leaf--2" viewBox="0 0 64 64" aria-hidden="true"><path d="M58 6C30 6 6 20 6 42c0 6 3 12 8 16C18 36 32 22 52 16 34 26 22 40 18 60c26 4 40-18 40-54Z" /></svg>
      <div class="wrap hero__in">
        <div class="hero__col">
          <p class="pill anim"><span class="pill__dot"></span> 10 лет в нутрициологии · онлайн</p>
          <h1 class="hero__h anim">
            Стройность <span class="hl">без диет<svg viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 9c40-7 120-9 196-4" /></svg></span>
            и вечного голода
          </h1>
          <p class="hero__lead anim">
            Меня зовут Сабина. Десять лет я работаю с питанием и веду марафоны стройности
            онлайн. Моя задача — не посадить вас на диету, а перестроить то,
            как вы едите каждый день.
          </p>
          <div class="hero__btns anim">
            <a href="#contact" class="btn">Записаться на разбор</a>
            <a href="#work" class="btn btn--ghost">Смотреть программы</a>
          </div>
          <ul class="ticks anim">
            <li>Без голода</li>
            <li>Без запретных списков</li>
            <li>Онлайн из любого города</li>
          </ul>
        </div>
        <div class="hero__ph anim">
          <span class="hero__ring" aria-hidden="true"></span>
          <figure class="shot">
            <img src="IMG_3896.PNG" alt="Сабина, консультант по питанию"
                 width="1284" height="1928" fetchPriority="high" decoding="async"
                 onError=${(e) => {
                   const shot = e.currentTarget.closest('.shot');
                   if (shot) shot.classList.add('shot--none');
                   e.currentTarget.remove();
                 }} />
          </figure>
          <div class="float float--a">
            <span class="float__ico float__ico--green">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg>
            </span>
            <b>10 лет практики</b>
            <i>питание и привычки</i>
          </div>
          <div class="float float--b">
            <span class="float__ico float__ico--coral">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3v9h9" /></svg>
            </span>
            <b>Тарелка 50 / 25 / 25</b>
            <i>понятная система</i>
          </div>
          <div class="float float--c">
            <span class="float__ava" aria-hidden="true"><i>А</i><i>М</i><i>Д</i></span>
            <b>Группы набираются<br />круглый год</b>
          </div>
        </div>
      </div>
      <div class="wrap">
        <ul class="stats">
          <li class="anim"><b>10<span>+</span></b><i>лет в профессии</i></li>
          <li class="anim"><b>4</b><i>формата работы</i></li>
          <li class="anim"><b>100<span>%</span></b><i>онлайн, без поездок</i></li>
          <li class="anim"><b>2</b><i>языка: рус / каз</i></li>
        </ul>
      </div>
    </section>
  `;
}

export function Ticker() {
  const span = html`<span>Снижение веса<i>✦</i>Пищевые привычки<i>✦</i>Очищение организма<i>✦</i>Энергия<i>✦</i>Марафоны онлайн<i>✦</i></span>`;
  return html`
    <div class="tick" aria-hidden="true">
      <div class="tick__row">${span}${span}</div>
    </div>
  `;
}

export function About() {
  return html`
    <section class="sec" id="about">
      <div class="wrap about">
        <div class="about__ph anim">
          <img class="about__img about__img--big" src="img-breakfast.jpg" alt="Сбалансированный завтрак: йогурт с ягодами, смузи и овсянка" loading="lazy" decoding="async" width="1024" height="768" />
          <img class="about__img about__img--sm" src="img-water.jpg" alt="Стакан воды с лимоном и мятой" loading="lazy" decoding="async" width="1024" height="768" />
          <div class="about__badge"><b>Без срывов</b><i>еда, а не ограничения</i></div>
        </div>
        <div class="about__tx">
          <p class="lab anim">Подход</p>
          <h2 class="h2 anim">Диета заканчивается. <span class="c-green">Привычка\u00A0— нет.</span></h2>
          <p class="lead anim">
            За десять лет практики я видела одну и ту же историю сотни раз: человек выдерживает
            жёсткое ограничение, теряет вес, возвращается к прежней жизни и набирает обратно.
            Проблема не в силе воли — ограничение невозможно продлить на всю жизнь.
          </p>
          <p class="anim">
            Поэтому я работаю иначе. Сначала мы разбираем ваш реальный день: во сколько вы едите,
            что пропускаете, где начинается переедание и чего организму не хватает. Затем выстраиваем
            режим, который выдерживает встречи, командировки, детей и усталость.
          </p>
          <p class="anim">
            Основа рациона — достаточное количество белка, воды и клетчатки. Продукты Herbalife
            Nutrition я использую как инструмент, который помогает закрыть норму, когда на готовку
            нет времени. Инструмент, а не замену еде.
          </p>
          <ul class="checks">
            ${checks.map(([b, rest]) => html`<li class="anim" key=${b}><b>${b}</b>${rest}</li>`)}
          </ul>
        </div>
      </div>
      <div class="wrap">
        <div class="fit">
          <div class="fit__col fit__col--yes anim">
            <p class="fit__h"><span>✓</span> Вам подойдёт, если</p>
            <ul>${fitYes.map((t) => html`<li key=${t}>${t}</li>`)}</ul>
          </div>
          <div class="fit__col fit__col--no anim">
            <p class="fit__h"><span>✕</span> Лучше не начинать, если</p>
            <ul>${fitNo.map((t) => html`<li key=${t}>${t}</li>`)}</ul>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function Programs() {
  return html`
    <section class="sec" id="work">
      <div class="wrap">
        <header class="sec__head sec__head--row">
          <div>
            <p class="lab anim">Программы</p>
            <h2 class="h2 anim">Четыре формата <span class="c-green">работы</span></h2>
          </div>
          <p class="sec__lead anim">Выберите глазами, а дальше подскажу: на первом разборе видно, что подходит именно вам.</p>
        </header>
        <div class="cards">
          ${programs.map((p) => html`
            <a class="card anim" href="#contact" key=${p.title}>
              <span class="card__ph">
                <img src=${p.img} alt=${p.alt} loading="lazy" decoding="async" width="1024" height="768" />
                <span class=${'card__tag' + p.tagClass}>${p.tag}</span>
              </span>
              <span class="card__b">
                <span class="card__t">${p.title}</span>
                <span class="card__d">${p.text}</span>
                <span class="card__go">Подробнее <i>→</i></span>
              </span>
            </a>
          `)}
        </div>
      </div>
    </section>
  `;
}

export function Steps() {
  return html`
    <section class="sec sec--mint" id="method">
      <div class="wrap">
        <header class="sec__head">
          <p class="lab anim">Как работаем</p>
          <h2 class="h2 anim">Четыре шага <span class="c-green">до нового режима</span></h2>
        </header>
        <ol class="steps">
          ${steps.map(([title, text], i) => html`
            <li class="anim" key=${title}>
              <span class="steps__n">${i + 1}</span>
              <h3>${title}</h3>
              <p>${text}</p>
            </li>
          `)}
        </ol>
      </div>
    </section>
  `;
}

export function Reviews() {
  return html`
    <section class="sec" id="voices">
      <div class="wrap">
        <header class="sec__head">
          <p class="lab anim">Отзывы</p>
          <h2 class="h2 anim">Что говорят <span class="c-green">после программы</span></h2>
        </header>
        <div class="quotes">
          ${reviews.map((q) => html`
            <figure class="q anim" key=${q.name}>
              <span class="q__stars" aria-label="5 из 5">★★★★★</span>
              <blockquote>${q.text}</blockquote>
              <figcaption><span class=${'q__ava' + q.tone}>${q.letter}</span><b>${q.name}</b><i>${q.meta}</i></figcaption>
            </figure>
          `)}
        </div>
        <p class="note anim">Замените эти тексты на реальные отзывы ваших клиентов.</p>
      </div>
    </section>
  `;
}

export function Faq() {
  const [open, setOpen] = useState(null);
  return html`
    <section class="sec sec--mint" id="qa">
      <div class="wrap">
        <header class="sec__head">
          <p class="lab anim">Вопросы</p>
          <h2 class="h2 anim">Что спрашивают <span class="c-green">чаще всего</span></h2>
        </header>
        <div class="qa">
          ${faq.map(([q, a], i) => html`
            <details class="qa__i anim" key=${q} open=${open === i}
              onClick=${(e) => {
                if (!e.target.closest('summary')) return;
                e.preventDefault();
                setOpen(open === i ? null : i);
              }}>
              <summary>${q}<span class="qa__s"></span></summary>
              <div><p>${a}</p></div>
            </details>
          `)}
        </div>
      </div>
    </section>
  `;
}

function ChanIcon({ kind }) {
  if (kind === 'wa') {
    return html`<span class="chan__ico chan__ico--wa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.8A8 8 0 0 1 8.4 19L4 20l1.1-4.3A8 8 0 1 1 20 11.8Z" /></svg></span>`;
  }
  if (kind === 'tg') {
    return html`<span class="chan__ico chan__ico--tg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3 16-6-4-3 4-1-6L3 11 21 4Z" /></svg></span>`;
  }
  if (kind === 'ig') {
    return html`<span class="chan__ico chan__ico--ig"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r=".8" /></svg></span>`;
  }
  return html`<span class="chan__ico chan__ico--ph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1 1 1 0 0 1 5 4Z" /></svg></span>`;
}

export function channelItems() {
  const phone = phoneDigits();
  const pretty = formatPhone(phone);
  const tg = telegramUser();
  return [
    { kind: 'wa', k: 'WhatsApp', v: pretty, href: 'https://wa.me/' + phone, blank: true },
    { kind: 'tg', k: 'Telegram', v: '@' + tg, href: 'https://t.me/' + tg, blank: true },
    { kind: 'ig', k: 'Instagram', v: '@' + INSTAGRAM, href: 'https://instagram.com/' + INSTAGRAM, blank: true },
    { kind: 'ph', k: 'Телефон', v: pretty, href: 'tel:+' + phone, blank: false }
  ];
}

export function Contact({ onSubmit, note, noteErr }) {
  const channels = channelItems();
  return html`
    <section class="sec contact" id="contact">
      <div class="wrap">
        <div class="cta">
          <span class="cta__blob" aria-hidden="true"></span>
          <div class="cta__tx">
            <p class="lab lab--light anim">Контакты</p>
            <h2 class="h2 h2--light anim">Напишите мне — <span class="c-lime">разберёмся вместе</span></h2>
            <p class="cta__lead anim">Первый шаг — короткий разговор. Расскажете свою ситуацию, я скажу, какой формат подойдёт и что будет дальше.</p>
            <div class="chan">
              ${channels.map((c) => html`
                <a class="chan__i anim" key=${c.k} href=${c.href}
                   target=${c.blank ? '_blank' : undefined}
                   rel=${c.blank ? 'noopener' : undefined}>
                  <${ChanIcon} kind=${c.kind} />
                  <span class="chan__k">${c.k}</span>
                  <span class="chan__v">${c.v}</span>
                </a>
              `)}
            </div>
          </div>
          <form class="form anim" id="form" noValidate onSubmit=${onSubmit}>
            <p class="form__t">Оставьте заявку</p>
            <p class="form__sub">Отвечу лично и без автоответчиков.</p>
            <label class="f"><span>Имя</span><input type="text" name="name" autoComplete="name" placeholder="Как к вам обращаться" /></label>
            <label class="f"><span>Телефон или ник</span><input type="text" name="contact" autoComplete="tel" placeholder="+7 ___ ___ __ __" /></label>
            <label class="f"><span>Запрос</span><textarea name="message" rows="3" placeholder="Что хотите изменить"></textarea></label>
            <button type="submit" class="btn btn--full">Отправить заявку</button>
            <p class=${'form__n' + (noteErr ? ' err' : '')} id="note" role="status">${note}</p>
          </form>
        </div>
      </div>
    </section>
  `;
}

export function Footer() {
  return html`
    <footer class="foot">
      <div class="wrap foot__in">
        <${Mark} foot=${true} />
        <p class="foot__d">
          Материалы сайта носят информационный характер и не являются медицинской
          услугой или назначением. Herbalife Nutrition — товарный знак правообладателя.
        </p>
        <div class="foot__side">
          <span class="foot__c">© ${new Date().getFullYear()} Сабина</span>
          <a href="#top" class="foot__up">Наверх ↑</a>
        </div>
      </div>
    </footer>
  `;
}

export function ContactModal({ open, onClose, onForm }) {
  if (!open) return null;
  const channels = channelItems();
  return html`
    <div class="cmod" id="contactModal">
      <div class="cmod__ov" onClick=${onClose}></div>
      <div class="cmod__box" role="dialog" aria-modal="true" aria-labelledby="cmodTitle">
        <div class="cmod__head">
          <div>
            <h2 class="cmod__t" id="cmodTitle">Связаться со мной</h2>
            <p class="cmod__sub">Выберите удобный способ — отвечу лично.</p>
          </div>
          <button type="button" class="cmod__x" onClick=${onClose} aria-label="Закрыть">×</button>
        </div>
        <div class="cmod__chan">
          ${channels.map((c) => html`
            <a class="cmod__i" key=${c.k} href=${c.href}
               target=${c.blank ? '_blank' : undefined}
               rel=${c.blank ? 'noopener' : undefined}>
              <${ChanIcon} kind=${c.kind} />
              <span class="cmod__k">${c.k}</span>
              <span class="cmod__v">${c.v}</span>
            </a>
          `)}
        </div>
        <a href="#contact" class="btn btn--full cmod__cta" onClick=${onForm}>Оставить заявку на сайте</a>
      </div>
    </div>
  `;
}
