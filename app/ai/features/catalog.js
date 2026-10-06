import { moneyOldProduct, moneyProduct } from '../../shop.js';

export function catalogLines(products, currency) {
  return (products || []).filter((p) => p.active !== false).map((p) => {
    let line = p.name;
    if (p.size) line += ' (' + p.size + ')';
    if (p.tag) line += ' · ' + p.tag;
    line += ' — ' + moneyProduct(p, currency);
    if (p.old > p.price) line += ' (было ' + moneyOldProduct(p, currency) + ')';
    if (p.desc) line += '. ' + p.desc;
    return line;
  });
}

export const catalogFeature = {
  id: 'catalog',
  prepare(ctx) {
    const code = String(ctx.currency || '').toLowerCase();
    if (code === 'kzt' || code === 'rub' || code === 'usd') ctx.body.currency = code;
  }
};
