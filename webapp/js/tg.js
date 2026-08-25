// Мост к Telegram WebApp API (с безопасным фолбэком для обычного браузера)
const w = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
export const tg = w;
export const inTelegram = !!(w && w.initData !== undefined && w.platform && w.platform !== 'unknown');

export function initTelegram() {
  if (!w) return;
  try {
    w.ready();
    w.expand();
    if (w.disableVerticalSwipes) w.disableVerticalSwipes();
    if (w.setHeaderColor) w.setHeaderColor('bg_color');
  } catch (e) { /* старые версии клиента */ }
}

export function tgColorScheme() {
  return w && w.colorScheme === 'dark' ? 'dark' : (w ? 'light' : null);
}

export function tgUser() {
  try { return w && w.initDataUnsafe && w.initDataUnsafe.user || null; } catch (e) { return null; }
}

export function startParam() {
  try { return (w && w.initDataUnsafe && w.initDataUnsafe.start_param) || null; } catch (e) { return null; }
}

let hapticOff = false;
export function haptic(kind = 'light') {
  if (hapticOff || !w || !w.HapticFeedback) return;
  try {
    const h = w.HapticFeedback;
    if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
    else if (kind === 'select') h.selectionChanged();
    else h.impactOccurred(kind);
  } catch (e) { hapticOff = true; }
}

// Аппаратная кнопка «Назад» в шапке Telegram
export const tgBackAvailable = !!(w && w.BackButton &&
  (!w.isVersionAtLeast || w.isVersionAtLeast('6.1')));

let backHandler = null;
export function setBackButton(fn) {
  backHandler = fn;
  document.body.dataset.tgback = tgBackAvailable && fn ? '1' : '0';
  if (!w || !w.BackButton) return;
  try {
    if (fn) { w.BackButton.show(); } else { w.BackButton.hide(); }
  } catch (e) { }
}
if (w && w.onEvent) {
  try { w.onEvent('backButtonClicked', () => backHandler && backHandler()); } catch (e) { }
}

/* ---------------- контакты из Telegram ----------------
   Имя и username приходят в initData сами. Телефона там нет и не будет:
   Telegram отдаёт его только по явному согласию человека, отдельным
   запросом. Метод появился в версии 6.9 — в старом клиенте и в обычном
   браузере его нет, и тогда телефон вводится руками.
-------------------------------------------------------- */
export function tgUsername() {
  const u = tgUser();
  return (u && u.username) ? String(u.username) : '';
}
export function tgFullName() {
  const u = tgUser();
  if (!u) return '';
  return [u.first_name, u.last_name].filter(Boolean).join(' ');
}
export function tgId() {
  const u = tgUser();
  return u && u.id ? String(u.id) : '';
}

export const canRequestPhone = () => !!(w && typeof w.requestContact === 'function');

/** Спросить телефон у Telegram. Возвращает номер либо null (отказ, нет метода). */
export function requestPhone() {
  return new Promise(resolve => {
    if (!canRequestPhone()) { resolve(null); return; }
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v || null); } };
    // Ответ приходит по-разному в разных версиях клиента: то вторым
    // аргументом колбэка, то отдельным событием. Слушаем оба и берём,
    // что придёт первым.
    const onEvent = res => {
      try {
        const c = (res && res.responseUnsafe && res.responseUnsafe.contact) || {};
        finish(c.phone_number);
      } catch (e) { finish(null); }
    };
    try { if (w.onEvent) w.onEvent('contactRequested', onEvent); } catch (e) { }
    try {
      w.requestContact((ok, res) => {
        if (!ok) { finish(null); return; }
        if (res) { onEvent(res); return; }
        // согласие есть, а данных в колбэке нет — ждём события
        setTimeout(() => finish(null), 2500);
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 12000);
  });
}

export function tgClose() { if (w && w.close) w.close(); }
export function openLink(url) {
  if (w && w.openTelegramLink && /^https:\/\/t\.me\//.test(url)) return w.openTelegramLink(url);
  if (w && w.openLink) return w.openLink(url);
  window.open(url, '_blank');
}
export function shareText(text) {
  if (w && w.openTelegramLink) return w.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(text));
  copy(text);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (_) { }
    t.remove(); return true;
  }
}
