import { icon } from './icons.js';
import { haptic } from './tg.js';

/* ---------------- DOM ---------------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Формат ---------------- */
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const pad = n => String(n).padStart(2, '0');
export const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₸';
export const moneyShort = n => n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : String(Math.round(n));
export const num = n => new Intl.NumberFormat('ru-RU').format(n);
export const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a, b) => dayKey(a) === dayKey(b);

export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const nAppt = n => n + ' ' + plural(n, ['запись', 'записи', 'записей']);
export const nVisit = n => n + ' ' + plural(n, ['визит', 'визита', 'визитов']);
export const nClient = n => n + ' ' + plural(n, ['клиент', 'клиента', 'клиентов']);
export const nMin = m => m >= 60 ? (m % 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : Math.floor(m / 60) + ' ' + plural(Math.floor(m / 60), ['час', 'часа', 'часов'])) : m + ' мин';

export function dateLabel(d, now) {
  const t = startOfDay(now), x = startOfDay(d);
  const diff = Math.round((x - t) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}
export function dateFull(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
export function relPast(d, now) {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return days + ' ' + plural(days, ['день', 'дня', 'дней']) + ' назад';
  if (days < 31) { const w = Math.floor(days / 7); return w + ' ' + plural(w, ['неделю', 'недели', 'недель']) + ' назад'; }
  const m = Math.floor(days / 30); return m + ' ' + plural(m, ['месяц', 'месяца', 'месяцев']) + ' назад';
}
export const greet = h => h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';

/* ---------------- Компоненты ---------------- */
export function avatar(p, size = 'm', cls = '') {
  const c = p && p.color ? p.color : 'var(--p)';
  // Фото важнее инициалов: если оно есть, показываем его (§65, §66)
  if (p && p.photo) {
    return `<div class="av ${size} ${cls} av-photo" style="background-image:url('${p.photo}')"></div>`;
  }
  const st = `background:linear-gradient(145deg,${c},color-mix(in srgb,${c} 72%,#1a2030))`;
  return `<div class="av ${size} ${cls}" style="${st}">${esc(p && p.initials || '?')}</div>`;
}

/* ---------------- Фирменный цвет ----------------
   Баннер строится из одного цвета компании: второй тон градиента —
   тот же оттенок, слегка повёрнутый и притемнённый. Раньше второй
   цвет был жёстко фиолетовым, и любой выбор превращался в сине-
   фиолетовое пятно.
-------------------------------------------------- */
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return Number.isNaN(n) ? [76, 111, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0))
    : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, sat, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

/** Соседний тон того же цвета — для второй точки градиента. */
export function shiftColor(hex, dHue = 8, dLight = -0.10, dSat = -0.08) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  // у почти чёрного цвета крутить нечего — его нужно, наоборот, подсветить
  const light = l < 0.22 ? Math.min(0.42, l + 0.16) : Math.max(0.12, Math.min(0.92, l + dLight));
  return hslToHex(h + dHue, Math.max(0, Math.min(1, s + dSat)), light);
}

/** Градиент баннера из фирменного цвета компании. */
export function brandGradient(hex, deg = 160) {
  return `linear-gradient(${deg}deg,${hex} 0%,${shiftColor(hex)} 100%)`;
}

/* ---------------- Изображения ----------------
   Картинки лежат в localStorage вместе с остальными данными, а его
   квота ~5 МБ на весь домен. Поэтому любое фото ужимается до
   разумной стороны и пережимается в JPEG — иначе один снимок
   с телефона выбивает всю базу.
----------------------------------------------- */
export const IMG_MAX = { photo: 640, avatar: 320, logo: 256 };

export function resizeImage(file, max = IMG_MAX.photo, quality = 0.72) {
  return new Promise((res, rej) => {
    if (!file) { rej(new Error('нет файла')); return; }
    if (!/^image\//.test(file.type)) { rej(new Error('Это не изображение')); return; }
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Не удалось прочитать файл'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Не удалось открыть изображение'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // JPEG не умеет прозрачность
        ctx.drawImage(img, 0, 0, w, h);
        try { res(cv.toDataURL('image/jpeg', quality)); }
        catch (e) { rej(new Error('Не удалось обработать изображение')); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/** Диалог выбора файла. Возвращает data-URL или null, если отменили. */
export function pickImage(max = IMG_MAX.photo) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(inp);
    let done = false;
    const finish = v => { if (done) return; done = true; inp.remove(); res(v); };
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) { finish(null); return; }
      try { finish(await resizeImage(f, max)); }
      catch (e) { toast(e.message || 'Не удалось загрузить', 'dan'); finish(null); }
    };
    // отмену в диалоге браузер не сообщает — подстраховываемся фокусом
    window.addEventListener('focus', () => setTimeout(() => { if (!inp.files || !inp.files.length) finish(null); }, 600), { once: true });
    inp.click();
  });
}

/** Квадратная область «фото или заглушка» с кнопками замены и удаления. */
export function photoField({ src, label, hint = '', actPick, actDel, ic = 'image', round = false }) {
  return `<div class="field"><label>${esc(label)}</label>
    <div class="ph-row">
      <button class="ph-box ${round ? 'round' : ''} ${src ? 'has' : ''}" data-a="${actPick}"
        ${src ? `style="background-image:url('${src}')"` : ''}>
        ${src ? '' : icon(ic, 24)}
      </button>
      <div class="grow">
        <button class="btn xs gh" data-a="${actPick}">${icon(src ? 'refresh' : 'plus', 14)}${src ? 'Заменить' : 'Загрузить'}</button>
        ${src ? `<button class="btn xs gh" style="margin-top:8px;color:var(--dan)" data-a="${actDel}">${icon('trash', 14)}Удалить</button>` : ''}
        ${hint ? `<div class="tiny dim" style="margin-top:8px">${esc(hint)}</div>` : ''}
      </div>
    </div>
  </div>`;
}
export function tint(name, color, size = 20) {
  return `<div class="tint" style="background:${color}22;color:${color}">${icon(name, size)}</div>`;
}
export function emptyState({ ic = 'note', title, text, action, act, cls = '' }) {
  return `<div class="empty ${cls}">
    <div class="il">${icon(ic, 36, 1.6)}</div>
    <div class="t">${esc(title)}</div>
    ${text ? `<div class="s">${esc(text)}</div>` : ''}
    ${action ? `<button class="btn p" data-a="${act}">${icon('plus', 18)}${esc(action)}</button>` : ''}
  </div>`;
}
export function skeleton(n = 3) {
  return `<div class="wrap">${Array.from({ length: n }, () => '<div class="sk sk-row"></div>').join('')}</div>`;
}
export const chev = () => `<span class="chev">${icon('fwd', 18, 2)}</span>`;

/* ---------------- Тосты ---------------- */
export function toast(msg, type = '') {
  const host = $('#toasts');
  const ic = type === 'dan' ? 'alert' : type === 'ai' ? 'sparkles' : 'checkCircle';
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'ok');
  t.innerHTML = icon(ic, 17, 2) + '<span>' + esc(msg) + '</span>';
  host.appendChild(t);
  haptic(type === 'dan' ? 'error' : 'success');
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2300);
}

/* ---------------- Bottom sheet ---------------- */
let sheetStack = [];
export function sheet(opts) {
  const host = $('#sheets');
  const mask = document.createElement('div'); mask.className = 'bd-mask';
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="grab"></div><div class="sheet-h"></div><div class="sheet-b"></div><div class="sheet-f" hidden></div>`;
  host.append(mask, el);
  const api = {
    el, mask,
    set(o) {
      const h = el.querySelector('.sheet-h'), b = el.querySelector('.sheet-b'), f = el.querySelector('.sheet-f');
      h.innerHTML = (o.back ? `<button class="ico-btn flat" data-sheet-back>${icon('back', 20)}</button>` : '') +
        `<div class="t">${esc(o.title || '')}</div>` +
        (o.headAction || '') +
        `<button class="ico-btn flat" data-sheet-close>${icon('x', 20)}</button>`;
      b.innerHTML = o.body || '';
      if (o.footer) { f.innerHTML = o.footer; f.hidden = false; } else { f.hidden = true; f.innerHTML = ''; }
      if (o.back) h.querySelector('[data-sheet-back]').onclick = () => { haptic('light'); o.back(); };
      h.querySelector('[data-sheet-close]').onclick = () => api.close();
      b.scrollTop = 0;
      if (o.mount) o.mount(el);
      api._o = o;
    },
    close() {
      if (api._closed) return; api._closed = true;
      el.classList.remove('in'); mask.classList.remove('in');
      sheetStack = sheetStack.filter(s => s !== api);
      setTimeout(() => { el.remove(); mask.remove(); }, 300);
      if (api._o && api._o.onClose) api._o.onClose();
    }
  };
  mask.onclick = () => api.close();
  // свайп вниз для закрытия
  let sy = 0, dy = 0, drag = false;
  const grab = el.querySelector('.grab');
  const startDrag = e => { drag = true; sy = e.touches[0].clientY; dy = 0; el.style.transition = 'none'; };
  const moveDrag = e => { if (!drag) return; dy = Math.max(0, e.touches[0].clientY - sy); el.style.transform = `translateY(${dy}px)`; };
  const endDrag = () => { if (!drag) return; drag = false; el.style.transition = ''; el.style.transform = ''; if (dy > 90) api.close(); };
  [grab, el.querySelector('.sheet-h')].forEach(n => {
    n.addEventListener('touchstart', startDrag, { passive: true });
    n.addEventListener('touchmove', moveDrag, { passive: true });
    n.addEventListener('touchend', endDrag);
  });
  api.set(opts);
  requestAnimationFrame(() => { mask.classList.add('in'); el.classList.add('in'); });
  sheetStack.push(api);
  haptic('light');
  return api;
}
export function closeAllSheets() { sheetStack.slice().forEach(s => s.close()); }
export const topSheet = () => sheetStack[sheetStack.length - 1] || null;

export function confirmSheet({ title, text, ok = 'Подтвердить', cancel = 'Отмена', danger = false }) {
  return new Promise(res => {
    let done = false;
    const s = sheet({
      title,
      body: `<div class="sm muted" style="padding-bottom:6px;white-space:pre-line;line-height:1.5">${esc(text || '')}</div>`,
      footer: `<div class="btns"><button class="btn gh" data-c="0">${esc(cancel)}</button><button class="btn ${danger ? 'dan' : 'p'}" data-c="1">${esc(ok)}</button></div>`,
      onClose: () => { if (!done) res(false); }
    });
    s.el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { done = true; res(b.dataset.c === '1'); s.close(); });
  });
}

/* ---------------- Контекстная подсказка (§99) ----------------
   Всплывает снизу один раз на экран и не перекрывает работу:
   модальная шторка при каждом входе раздражала бы сильнее,
   чем помогала. Отметку о показе ставит вызывающая сторона.
--------------------------------------------------------------- */
export function tipCard({ title, text, ic = 'info', onClose }) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'tip';
  el.innerHTML = `
    <div class="tip-ic">${icon(ic, 19)}</div>
    <div class="grow">
      <div class="tip-t">${esc(title)}</div>
      <div class="tip-s">${esc(text)}</div>
    </div>
    <button class="tip-x" aria-label="Понятно">${icon('x', 17)}</button>`;
  host.appendChild(el);
  const close = () => {
    if (el._gone) return; el._gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
    if (onClose) onClose();
  };
  el.querySelector('.tip-x').onclick = close;
  requestAnimationFrame(() => el.classList.add('in'));
  haptic('light');
  return { close, el };
}

/** Честная заглушка: функция есть в продукте, но в демо не работает по-настоящему. */
export function demoNote(title, text, what = '') {
  const s = sheet({
    title,
    body: `<div class="row" style="gap:12px;align-items:flex-start;padding:2px 0 10px">
        <div class="tint" style="background:var(--warn-soft);color:var(--warn);width:42px;height:42px;flex:none">${icon('info', 20)}</div>
        <div class="grow">
          <div class="sm" style="line-height:1.55">${esc(text)}</div>
          ${what ? `<div class="tiny dim" style="margin-top:8px">${esc(what)}</div>` : ''}
        </div>
      </div>`,
    footer: `<button class="btn p" data-demo-ok>Понятно</button>`,
  });
  s.el.querySelector('[data-demo-ok]').onclick = () => s.close();
  return s;
}

export function promptSheet({ title, label, value = '', placeholder = '', multiline = false, ok = 'Сохранить', password = false }) {
  return new Promise(res => {
    let done = false;
    const s = sheet({
      title,
      body: `<div class="field"><label>${esc(label || '')}</label>
        ${multiline ? `<textarea class="inp" id="_pv" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="inp" id="_pv" ${password ? 'type="password" autocomplete="off" autocapitalize="off" spellcheck="false"' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>`,
      footer: `<button class="btn p" data-ok>${esc(ok)}</button>`,
      onClose: () => { if (!done) res(null); }
    });
    const inp = s.el.querySelector('#_pv');
    setTimeout(() => inp.focus(), 240);
    s.el.querySelector('[data-ok]').onclick = () => { done = true; res(inp.value.trim()); s.close(); };
  });
}


/* ---------------- Месячный календарь ----------------
   Универсальная сетка месяца. Используется и клиентом при записи,
   и бизнесом в календаре. Даты без свободных мест гасятся, но
   остаются видимыми — так понятнее, чем прятать их совсем.
   avail(date) -> null | число свободных слотов | true/false
------------------------------------------------------- */
export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function monthGrid(view, {
  selected = null, action = 'cal.pick', navAction = 'cal.month',
  avail = null, minDate = null, maxDate = null, showCounts = true,
} = {}) {
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1);
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;            // неделя с понедельника
  const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
  const lo = minDate ? startOfDay(minDate) : null;
  const hi = maxDate ? startOfDay(maxDate) : null;
  const canPrev = !lo || new Date(y, m, 0) >= lo;
  const canNext = !hi || new Date(y, m + 1, 1) <= hi;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mc-cell mc-empty"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(y, m, d);
    const key = dayKey(date);
    const isSel = selected && key === dayKey(selected);
    const isToday = key === dayKey(new Date());
    const before = lo && date < lo, after = hi && date > hi;
    let free = null;
    if (!before && !after && avail) { try { free = avail(date); } catch (e) { free = null; } }
    const off = before || after || free === 0 || free === false;
    cells.push(`<button class="mc-cell ${isSel ? 'on' : ''} ${off ? 'off' : ''} ${isToday ? 'today' : ''}"
      ${off ? 'disabled' : `data-a="${action}" data-d="${date.getTime()}"`}>
      <span class="d">${d}</span>
      ${showCounts && typeof free === 'number' && free > 0 && !isSel ? '<i class="dot"></i>' : ''}
    </button>`);
  }

  return `<div class="mcal">
    <div class="mc-head">
      <button class="ico-btn flat" ${canPrev ? `data-a="${navAction}" data-d="${prev.getTime()}"` : 'disabled'}>${icon('back', 18)}</button>
      <div class="mc-title">${MONTH_NAMES[m]} ${y}</div>
      <button class="ico-btn flat" ${canNext ? `data-a="${navAction}" data-d="${next.getTime()}"` : 'disabled'}>${icon('fwd', 18)}</button>
    </div>
    <div class="mc-wd">${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="mc-grid">${cells.join('')}</div>
  </div>`;
}

/* ---------------- Графики ---------------- */
export function bars(data, { labels = [], color = 'var(--p)', height = 120, fmt = moneyShort } = {}) {
  const max = Math.max(1, ...data);
  return `<div class="bars" style="height:${height}px">${data.map((v, i) => {
    const h = Math.max(3, Math.round(v / max * 100));
    return `<div class="b" title="${fmt(v)}"><i style="height:${h}%;background:${i === data.length - 1 ? 'linear-gradient(180deg,var(--p),var(--p-2))' : color}"></i></div>`;
  }).join('')}</div>
  ${labels.length ? `<div class="bars-x">${labels.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}`;
}

export function sparkline(data, { w = 300, h = 90, color = 'var(--p)' } = {}) {
  if (!data.length) return '';
  const max = Math.max(...data), min = Math.min(...data), rng = (max - min) || 1;
  const pts = data.map((v, i) => [i / (data.length - 1 || 1) * w, h - 6 - (v - min) / rng * (h - 16)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L ${w} ${h} L 0 ${h} Z`;
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3.6" fill="${color}"/>
  </svg>`;
}

export function donut(parts, { size = 116, thick = 14 } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = (size - thick) / 2, c = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map(p => {
    const len = p.value / total * c;
    const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${thick}"
      stroke-dasharray="${len - 2} ${c - len + 2}" stroke-dashoffset="${-off}" stroke-linecap="round"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    off += len; return s;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>`;
}

export function progress(pct, color = 'var(--p)') {
  return `<div class="prog"><i style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></i></div>`;
}

/* ---------------- Прочее ---------------- */
export const wait = ms => new Promise(r => setTimeout(r, ms));

export function loadingBlock(text = 'Загружаем…') {
  return `<div class="ai-load"><div class="ai-orb"></div><div class="sm muted">${esc(text)}</div></div>`;
}

export function segmented(name, opts, active) {
  return `<div class="seg">${opts.map(o => `<button data-a="${name}" data-v="${o.v}" class="${o.v === active ? 'on' : ''}">${esc(o.t)}</button>`).join('')}</div>`;
}
