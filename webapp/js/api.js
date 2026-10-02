/* =========================================================
   HTTP-клиент к серверу Zapis
   ---------------------------------------------------------
   Кто мы — доказываем подписью Telegram: initData уходит заголовком
   в каждом запросе, сервер проверяет HMAC и сам решает, какая у человека
   роль в какой компании. Ничего из initDataUnsafe сервер на веру не берёт.

   Вне Telegram (обычный браузер) есть вход для разработки: ?dev=<id>:<имя>
   в адресе. Сервер принимает его только с DEV_AUTH=1, в бою заголовок
   игнорируется и приложение остаётся в демо-режиме на localStorage.
   ========================================================= */
import { API_BASE } from './config.js';
import { tg } from './tg.js';

const base = p => API_BASE + p;
const DEV_KEY = 'zapis.dev.user';

export const initData = () => { try { return (tg && tg.initData) || ''; } catch (e) { return ''; } };

let devUser = null;
(function pickDev() {
  try {
    const q = new URLSearchParams(location.search).get('dev');
    if (q) { devUser = q; sessionStorage.setItem(DEV_KEY, q); return; }
    devUser = sessionStorage.getItem(DEV_KEY) || null;
  } catch (e) { devUser = null; }
})();

/** Есть ли чем представиться серверу. */
export const canAuth = () => !!initData() || !!devUser;
export const devMode = () => !!devUser && !initData();

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function request(path, { method = 'GET', body = null, timeout = 15000, auth = true } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const d = initData();
    if (d) headers['X-Telegram-Init-Data'] = d;
    else if (devUser) headers['X-Dev-User'] = encodeURIComponent(devUser);
  }
  try {
    const r = await fetch(base(path), {
      method, headers, signal: ctl.signal, body: body != null ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) {
      const err = (data && data.error) || {};
      throw new ApiError(r.status, err.code || 'http', err.message || ('HTTP ' + r.status));
    }
    return data;
  } finally { clearTimeout(t); }
}

export const api = {
  ping: () => request('/api/v2/ping', { timeout: 5000, auth: false }),
  boot: start => request('/api/v2/boot', { method: 'POST', body: { start: start || '' }, timeout: 20000 }),
  changes: since => request('/api/v2/changes?since=' + encodeURIComponent(since || 0)),
  push: payload => request('/api/v2/push', { method: 'POST', body: payload, timeout: 30000 }),
  invite: id => request('/api/v2/invites/' + encodeURIComponent(id)),
  acceptInvite: (id, person) => request('/api/v2/invites/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: person }),
  broadcast: payload => request('/api/v2/broadcast', { method: 'POST', body: payload }),
  ai: (prompt, system) => request('/api/v2/ai', { method: 'POST', body: { prompt, system }, timeout: 120000 }),
  notifyTest: () => request('/api/v2/notify-test', { method: 'POST', body: {} }),
  admin: {
    stats: () => request('/api/v2/admin/stats'),
    queue: company => request('/api/v2/admin/queue' + (company ? '?company=' + encodeURIComponent(company) : '')),
    users: () => request('/api/v2/admin/users'),
    seed: data => request('/api/v2/admin/seed', { method: 'POST', body: { data }, timeout: 60000 }),
    notify: () => request('/api/v2/admin/notify', { method: 'POST', body: {} }),
    broadcast: payload => request('/api/v2/admin/broadcast', { method: 'POST', body: payload }),
  },
};
