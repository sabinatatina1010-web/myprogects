import { phoneDigits } from '../../shop.js';

const HAND_OFF_MARK = '[[HAND_OFF]]';

export function parseHandoff(reply) {
  const raw = String(reply || '');
  const handoff = raw.indexOf(HAND_OFF_MARK) !== -1;
  const clean = raw.split(HAND_OFF_MARK).join('').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, handoff };
}

export function buildWaText(history, userText) {
  const lines = ['Здравствуйте, Сабина!', 'Пишу с сайта — ИИ-консультант предложил связаться с вами.'];
  let goal = '';
  (history || []).forEach((item) => {
    if (item.who === 'user') {
      const t = String(item.text || '').trim();
      if (t && t.length > goal.length && t.length < 180) goal = t;
    }
  });
  if (userText && String(userText).trim()) goal = String(userText).trim();
  if (goal) lines.push('', 'Мой запрос: ' + goal);
  lines.push('', 'Буду благодарна, если подскажете следующий шаг.');
  return lines.join('\n');
}

export function waLink(text) {
  const t = text || 'Здравствуйте Сабина, хочу проконсультироваться';
  return 'https://wa.me/' + phoneDigits() + '?text=' + encodeURIComponent(t);
}

export function whatsapp(history, userText) {
  return waLink(buildWaText(history, userText));
}

export const handoffFeature = {
  id: 'handoff',
  after(ctx, result) {
    const raw = result && typeof result.text === 'string' ? result.text : '';
    return parseHandoff(raw);
  }
};
