/* =========================================================
   Роль человека в серверном режиме
   ---------------------------------------------------------
   В демо роль выбирают в панели. На сервере она следует из данных:
   карточка сотрудника с моим telegram-id — я в команде, открытая ссылка
   салона — я его клиент. Здесь функции, которые переключают сессию
   приложения в нужное состояние; зовут их main.js на старте и экраны,
   когда человек переходит из кабинета на страницу салона и обратно.

   Отдельный модуль, а не часть main.js: экраны импортируют его статически,
   а main.js грузит экраны динамически — иначе получилось бы кольцо.
   ========================================================= */
import { S, setHome, viewCompany, ensurePerson } from './store.js';
import { session } from './sync.js';
import { tgUser, tgId, tgUsername } from './tg.js';

const SECTION_NAMES = new Set(['book', 'my', 'profile', 'cal', 'clients', 'sub', 'ai', 'more', 'team']);

/** «<компания>[_<раздел>]» → [компания, раздел]. Идентификаторы компаний
    сами содержат подчёркивание (co_abc), поэтому режем только известный хвост. */
export function parseStart(raw) {
  raw = String(raw || '').toLowerCase();
  const i = raw.lastIndexOf('_');
  if (i > 0 && SECTION_NAMES.has(raw.slice(i + 1))) return [raw.slice(0, i), raw.slice(i + 1)];
  return [raw, ''];
}

export const SECTIONS = {
  client: { book: 'cl.book', my: 'cl.my', profile: 'cl.profile' },
  owner: { cal: 'o.cal', clients: 'o.clients', sub: 'o.subscription', ai: 'ai.home', more: 'o.more', team: 'o.team' },
  employee: { cal: 'e.cal', clients: 'e.clients', profile: 'e.profile', more: 'o.more', team: 'o.team' },
};

const tgName = () => { const u = tgUser(); return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : ''; };

/** Войти в кабинет компании по членству. null — я там не работаю. */
export function enterCompany(cid, { section = '' } = {}) {
  const ses = session() || {};
  const m = (ses.memberships || []).find(x => x.companyId === cid);
  if (!m) return null;
  S.session.role = m.isOwner ? 'owner' : 'employee';
  S.session.companyId = cid;
  S.session.employeeId = m.employeeId;
  S.session.clientId = null;
  const map = S.session.role === 'owner' ? SECTIONS.owner : SECTIONS.employee;
  return { r: map[section] || (S.session.role === 'owner' ? 'o.home' : 'e.home'), p: {} };
}

/** Открыть салон как его клиент: личность из Telegram, карточка — своя. */
export function enterAsClient(cid, section = '') {
  const ses = session() || {};
  S.session.role = 'client';
  S.session.homeId = null;
  S.session.clientIds = { ...(ses.clientCards || {}) };
  const p = ensurePerson((ses.identity && ses.identity.name) || tgName(), { tg: tgUsername(), tgId: tgId() });
  if (ses.phone && !p.phone) p.phone = ses.phone;
  if (ses.identity && ses.identity.tgId && !p.tgId) p.tgId = ses.identity.tgId;
  setHome(cid);
  viewCompany(cid);
  return { r: SECTIONS.client[section] || 'cl.company', p: {} };
}

/** Первая компания, где я работаю (владелец раньше мастера). */
export function myCabinet() {
  const ses = session() || {};
  const members = ses.memberships || [];
  const last = S.session.lastCompanyId;
  return members.find(m => m.companyId === last) || members.find(m => m.isOwner) || members[0] || null;
}
