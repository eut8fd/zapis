/* =========================================================
   Доступ к панели Super Admin
   ---------------------------------------------------------
   Панель закрыта двумя независимыми ключами:
     1) Telegram ID  — если id пользователя есть в ADMIN_TG_IDS,
        панель доступна сразу и код не спрашивается;
     2) секретный код — вводится вручную (скрытый вход в «Настройках»)
        или приходит от бота в ссылке ?start=admin&key=…

   В коде хранится ТОЛЬКО SHA-256 секрета, самого кода в исходниках нет.
   Меняется одной командой:
        powershell scripts/set-admin-code.ps1 -Code "новый-код" -TelegramId 123456789
   ========================================================= */

// ДЕМО-РЕЖИМ: панель Super Admin открыта свободно через демо-панель.
// Обычные пользователи входа не видят (в боте и интерфейсе его нет).
// Перед продакшеном поставить false — включится проверка ID + кода.
export const DEMO_OPEN_ADMIN = true;

/* Адрес сервера (server/serve.py).

   Пусто означает «тот же адрес, что и само приложение»: так работает
   локальный запуск и Fly.io, где статику и API отдаёт один serve.py.

   На GitHub Pages приложение и сервер живут на разных адресах, и сюда
   нужно вписать адрес сервера целиком, без слэша на конце, например
   'https://zapis-bot.fly.dev'. Пока здесь пусто, Mini App на Pages
   работает в демо-режиме на localStorage — см. sync.js. */
export const API_BASE = '';

// username бота — для ссылок «поделиться страницей записи»
export const BOT_USERNAME = 'Demotelaibot';

// Telegram ID тех, кому панель открыта без кода. Пример: [123456789, 987654321]
export const ADMIN_TG_IDS = [];

// SHA-256 секретного кода (по умолчанию — «zapis-super-2026», обязательно смените)
export const ADMIN_CODE_SHA256 = 'fa627a7fe7c38d9caab4f7e831933fab9deb3f587198cfe662a81e882bd6841d';

const UNLOCK_KEY = 'zapis.sa.unlock';

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Телеграм-аккаунт в белом списке? */
export function isWhitelisted(user) {
  if (!user || !user.id) return false;
  return ADMIN_TG_IDS.map(Number).includes(Number(user.id));
}

/** Код уже вводился в этом браузере? (храним хэш, не сам код) */
export function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === ADMIN_CODE_SHA256; } catch (e) { return false; }
}

/** Проверить код и запомнить разблокировку */
export async function unlockWithCode(code) {
  if (!code) return false;
  const h = await sha256(String(code).trim());
  if (h !== ADMIN_CODE_SHA256) return false;
  try { localStorage.setItem(UNLOCK_KEY, ADMIN_CODE_SHA256); } catch (e) { }
  return true;
}

export function lockAdmin() {
  try { localStorage.removeItem(UNLOCK_KEY); } catch (e) { }
}

/** Итоговая проверка доступа к Super Admin */
export function adminAllowed(user) {
  if (DEMO_OPEN_ADMIN) return true;
  return isWhitelisted(user) || isUnlocked();
}
