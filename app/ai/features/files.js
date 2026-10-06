export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function isImage(file) {
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (/^image\/(jpeg|jpg|pjpeg|png|gif|webp|bmp|x-png|avif)$/.test(mime)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|avif)$/.test(name);
}

function isHeic(file) {
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return /heic|heif/.test(mime) || /\.(heic|heif)$/.test(name);
}

function isTextFile(file) {
  const name = (file && file.name) || '';
  const mime = (file && file.type) || '';
  if (/^text\//i.test(mime) || /json|xml|javascript|csv/i.test(mime)) return true;
  return /\.(txt|md|csv|json|html?|log|rtf)$/i.test(name);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read fail'));
    r.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read fail'));
    r.readAsText(file, 'UTF-8');
  });
}

function compressImage(file) {
  return readAsDataUrl(file).then((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) { resolve(src); return; }
      const scale = Math.min(1, max / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      const preferPng = /png$/i.test(file.type || '') || /\.png$/i.test(file.name || '');
      const dataUrl = canvas.toDataURL(preferPng ? 'image/png' : 'image/jpeg', 0.85);
      resolve(!dataUrl || dataUrl.length < 64 ? src : dataUrl);
    };
    img.onerror = () => resolve(src);
    img.src = src;
  }));
}

export function buildUserContent(userText, files) {
  const parts = [];
  let text = String(userText || '').trim();
  const imageNames = [];
  const textBlocks = [];
  const fileNames = [];

  (files || []).forEach((f) => {
    if (f.kind === 'image' && f.dataUrl && f.dataUrl.indexOf('data:image/') === 0) {
      parts.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'high' } });
      imageNames.push(f.name);
    } else if (f.kind === 'text' && f.text) {
      textBlocks.push('--- файл «' + f.name + '» ---\n' + f.text);
    } else if (f.kind === 'file' && f.dataUrl) {
      if (f.dataUrl.indexOf('data:image/') === 0) {
        parts.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'high' } });
        imageNames.push(f.name);
      } else {
        parts.push({ type: 'file', file: { filename: f.name, file_data: f.dataUrl } });
        fileNames.push(f.name);
      }
    }
  });

  let lead = text;
  if (!lead) {
    if (imageNames.length) lead = 'Посмотрите это фото и кратко опишите, что на нём важно для питания/продуктов.';
    else if (textBlocks.length || fileNames.length) lead = 'Посмотрите вложение и кратко скажите, что важно.';
  }
  const meta = [];
  if (imageNames.length) meta.push('фото: ' + imageNames.join(', '));
  if (fileNames.length) meta.push('файлы: ' + fileNames.join(', '));
  if (meta.length) lead += (lead ? '\n\n' : '') + 'Прикреплено — ' + meta.join('; ') + '.';
  if (textBlocks.length) lead += (lead ? '\n\n' : '') + textBlocks.join('\n\n');

  if (lead) parts.unshift({ type: 'text', text: lead });
  if (!parts.length) return text || 'Здравствуйте';
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function hasMedia(content) {
  return Array.isArray(content) && content.some((part) => part && part.type && part.type !== 'text');
}

export function slimHistory(apiMessages) {
  const out = [];
  let keep = -1;
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === 'user' && hasMedia(apiMessages[i].content)) {
      keep = i;
      break;
    }
  }
  apiMessages.forEach((m, j) => {
    if (j === keep || typeof m.content === 'string') { out.push(m); return; }
    if (Array.isArray(m.content)) {
      const textBits = [];
      m.content.forEach((p) => {
        if (p.type === 'text' && p.text) textBits.push(p.text);
        else if (p.type === 'image_url') textBits.push('[изображение]');
        else if (p.type === 'file') textBits.push('[файл]');
      });
      out.push({ role: m.role, content: textBits.join('\n') || '[вложение]' });
    } else out.push(m);
  });
  return out;
}

export async function ingestFiles(fileList, pendingCount) {
  const files = Array.prototype.slice.call(fileList || []);
  const added = [];
  const notices = [];
  let count = pendingCount || 0;

  for (const file of files) {
    if (count >= MAX_FILES) {
      notices.push('Можно прикрепить максимум ' + MAX_FILES + ' файла за раз.');
      break;
    }
    if (!file || file.size > MAX_FILE_BYTES) {
      notices.push('Файл «' + ((file && file.name) || '') + '» слишком большой (до 5 МБ).');
      continue;
    }
    if (isHeic(file)) {
      notices.push('Формат HEIC/HEIF браузер не открывает. Сохраните фото как JPG или PNG и прикрепите снова.');
      continue;
    }
    try {
      if (isImage(file)) {
        const dataUrl = await compressImage(file);
        if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
          notices.push('Не удалось подготовить фото «' + file.name + '». Попробуйте JPG/PNG.');
          continue;
        }
        added.push({
          id: uid(), name: file.name, mime: file.type || 'image/jpeg',
          kind: 'image', preview: dataUrl, dataUrl
        });
        count += 1;
      } else if (isTextFile(file)) {
        let text = String(await readAsText(file) || '');
        if (text.length > 40000) text = text.slice(0, 40000) + '\n…[текст обрезан]';
        added.push({
          id: uid(), name: file.name, mime: file.type || 'text/plain', kind: 'text', text
        });
        count += 1;
      } else {
        const dataUrl = await readAsDataUrl(file);
        if (dataUrl.indexOf('data:image/') === 0) {
          added.push({
            id: uid(), name: file.name, mime: 'image/jpeg', kind: 'image', preview: dataUrl, dataUrl
          });
          count += 1;
        } else {
          added.push({
            id: uid(), name: file.name, mime: file.type || 'application/octet-stream', kind: 'file', dataUrl
          });
          count += 1;
        }
      }
    } catch (e) {
      notices.push('Не удалось прочитать файл «' + ((file && file.name) || '') + '».');
    }
  }

  return { added, notices };
}

export const filesFeature = {
  id: 'files',
  fallback(ctx) {
    if (!ctx.failed || !ctx.files || !ctx.files.length) return null;
    const msg = ctx.error && ctx.error.message ? String(ctx.error.message) : '';
    return 'Не удалось разобрать фото/файл через AI' +
      (msg ? ' (' + msg.replace(/^openai:\s*/i, '').slice(0, 160) + ')' : '') +
      '.\n\nПопробуйте JPG/PNG поменьше или опишите текстом. ' +
      'Можно также написать Сабине в WhatsApp.\n\n[[HAND_OFF]]';
  }
};
