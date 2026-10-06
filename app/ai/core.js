import { postChat } from './transport.js';
import { MAX_FILES, buildUserContent, ingestFiles, slimHistory } from './features/files.js';
import { whatsapp } from './features/handoff.js';

const HISTORY_LIMIT = 16;

function readCatalog(options) {
  const products = typeof options.getProducts === 'function' ? options.getProducts() : options.products;
  const currency = typeof options.getCurrency === 'function' ? options.getCurrency() : options.currency;
  return { products: products || [], currency };
}

export function createSession(options = {}) {
  const features = options.features || [];
  const history = [];

  async function ask({ text, files } = {}) {
    const userText = String(text || '').trim();
    const attached = files ? files.slice() : [];
    if (!userText && !attached.length) return null;

    const { products, currency } = readCatalog(options);
    history.push({ role: 'user', content: buildUserContent(userText, attached) });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);

    const ctx = {
      text: userText,
      files: attached,
      products,
      currency,
      apiMessages: history,
      body: { messages: slimHistory(history) },
      failed: false,
      error: null
    };

    features.forEach((feature) => {
      if (typeof feature.prepare === 'function') feature.prepare(ctx);
    });

    let raw = '';
    try {
      raw = await postChat(ctx.body);
      history.push({
        role: 'assistant',
        content: raw.split('[[HAND_OFF]]').join('').replace(/\n{3,}/g, '\n\n').trim()
      });
    } catch (err) {
      console.error('chat', err);
      ctx.failed = true;
      ctx.error = err;
      raw = 'Сейчас не получилось ответить. Напишите менеджеру в WhatsApp.\n\n[[HAND_OFF]]';
    }

    let result = { text: raw, handoff: false, raw, userText };
    features.forEach((feature) => {
      if (typeof feature.after !== 'function') return;
      const next = feature.after(ctx, result);
      if (next) result = Object.assign({}, result, next, { raw, userText });
    });
    return result;
  }

  return {
    ask,
    ingestFiles,
    whatsapp,
    maxFiles: MAX_FILES
  };
}
