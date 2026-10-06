import { catalogLines } from './catalog.js';

const KB = [
  { keys: ['привет', 'здравств', 'добрый'], reply: 'Привет! Расскажите цель: похудеть, очищение, разобрать питание или подобрать продукты?' },
  { keys: ['похуд', 'вес', 'строй'], reply: 'Сабина работает без жёстких диет и голода: привычки, белок, вода и режим. Есть марафон, 1:1 и разбор питания. Что ближе?' },
  { keys: ['марафон'], reply: 'Марафон стройности — онлайн-группа: чат, задания, замеры. Даты ближайшего набора лучше уточнить у Сабины — она подскажет, когда старт.\n\n[[HAND_OFF]]' },
  { keys: ['запис', 'разбор', 'консульт', '1:1', 'лично'], reply: 'Отлично, это как раз к Сабине: она соберёт запрос и предложит удобный формат.\n\nНажмите кнопку WhatsApp ниже — сообщение уже будет с вашим запросом.\n\n[[HAND_OFF]]' },
  { keys: ['продукт', 'заказ', 'herbalife', 'коктейл'], reply: 'Продукты — инструмент, не обязательны. В блоке «Магазин» можно выбрать и оформить заказ в WhatsApp.' },
  { keys: ['whatsapp', 'ватсап', 'написать', 'связ'], reply: 'Конечно. Сабина на связи лично — откройте WhatsApp кнопкой ниже, текст сообщения уже готов.\n\n[[HAND_OFF]]' }
];

const STEMS = {
  здравств: 1, похуд: 1, строй: 1, запис: 1, консульт: 1, коктейл: 1, связ: 1,
  цен: 1, прайс: 1, каталог: 1, товар: 1
};

const OFFLINE = 'Сейчас нет связи с консультантом. Ниже короткая подсказка с сайта, не полный ответ.';

export function hasTerm(text, key) {
  const q = String(text || '').toLowerCase().replace(/ё/g, 'е');
  const stem = key.replace(/ё/g, 'е');
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = STEMS[stem] ? '' : '(?![a-zа-я0-9])';
  return new RegExp('(?:^|[^a-zа-я0-9])' + esc + tail, 'i').test(q);
}

function offline(hint) {
  if (!hint) {
    return OFFLINE + '\n\nНапишите ещё раз через минуту или откройте WhatsApp.\n\n[[HAND_OFF]]';
  }
  return OFFLINE + '\n\n' + hint;
}

export function localReply(text, products, currency) {
  const q = String(text || '').toLowerCase().replace(/ё/g, 'е');
  const lines = catalogLines(products, currency);
  const asksPrice = ['цен', 'стоит', 'сколько', 'прайс', 'каталог', 'товар'].some((key) => hasTerm(q, key));
  if (asksPrice && lines.length) {
    const words = q.split(/[^a-zа-я0-9]+/).filter((w) => w.length > 3);
    const hit = lines.filter((line) => {
      const low = line.toLowerCase().replace(/ё/g, 'е');
      return words.some((w) => hasTerm(low, w));
    });
    const show = (hit.length ? hit : lines).slice(0, 8);
    return offline('Вот цены с сайта:\n\n' + show.join('\n') +
      (lines.length > show.length ? '\n\n…и ещё в блоке «Магазин».' : '') +
      '\n\nЗаказ — в магазине на сайте. Если нужна подборка «под вас» — скажите, переведу к Сабине.');
  }
  for (let i = 0; i < KB.length; i++) {
    for (let k = 0; k < KB[i].keys.length; k++) {
      if (hasTerm(q, KB[i].keys[k])) return offline(KB[i].reply);
    }
  }
  return offline('');
}

export const fallbackFeature = {
  id: 'fallback',
  fallback(ctx) {
    if (!ctx.failed || (ctx.files && ctx.files.length)) return null;
    return localReply(ctx.text, ctx.products, ctx.currency);
  }
};
