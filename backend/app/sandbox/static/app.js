/* =========================================================
   Консоль песочницы.

   Она ничего не считает сама: каждое действие — запрос к тому же API,
   которым будет пользоваться Mini App. Если что-то работает здесь,
   значит работает на сервере, а не в этом файле.
   ========================================================= */

const API = '/api/v1';
const LS = 'zapis.sandbox.v1';

const state = {
  users: {},        // имя -> { token, refresh, tgId }
  current: null,
  me: null,
  companyId: null,
  branchId: null,
  services: [],
  employees: [],
  catalog: [],
  booking: null,    // выбранная компания клиента
  slots: [],
};

/* ---------------------------------------------------------------- утилиты */

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));
const money = minor => (minor / 100).toLocaleString('ru-RU') + ' ₸';
const todayISO = (shift = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return d.toISOString().slice(0, 10);
};

let toastTimer = null;
function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'on ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3600);
}

function saveLocal() {
  localStorage.setItem(LS, JSON.stringify({ users: state.users, current: state.current }));
}
function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || '{}');
    state.users = raw.users || {};
    state.current = raw.current || null;
  } catch (e) { /* первый запуск */ }
}

/* ------------------------------------------------------------------ запрос */

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const session = state.current ? state.users[state.current] : null;
  if (auth && session) opts.headers.Authorization = 'Bearer ' + session.token;

  const r = await fetch(API + path, opts);
  if (r.status === 204) return null;

  let data = null;
  try { data = await r.json(); } catch (e) { /* пустой ответ */ }

  if (!r.ok) {
    const err = (data && data.error) || {};
    // Сессия живёт 15 минут: молча обновляем и повторяем один раз.
    if (r.status === 401 && session && session.refresh && !opts._retried) {
      const ok = await refresh(session);
      if (ok) return api(path, { method, body, auth, headers, _retried: true });
    }
    const fields = err.details && err.details.fields;
    const extra = fields ? ' (' + Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : '';
    throw new Error((err.message || `Ошибка ${r.status}`) + extra);
  }
  return data;
}

async function refresh(session) {
  try {
    const r = await fetch(API + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    session.token = data.access_token;
    session.refresh = data.refresh_token;
    saveLocal();
    return true;
  } catch (e) { return false; }
}

async function guard(fn) {
  try { await fn(); } catch (e) { toast(e.message, 'dan'); }
}

/* ------------------------------------------------------------------ вкладки */

document.querySelectorAll('nav button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === btn));
    document.querySelectorAll('[data-pane]').forEach(p => {
      p.hidden = p.dataset.pane !== btn.dataset.tab;
    });
    if (btn.dataset.tab === 'business') renderBusiness();
    if (btn.dataset.tab === 'client') renderClient();
    if (btn.dataset.tab === 'state') loadState();
  };
});

/* ------------------------------------------------------------------- люди */

async function login(name, phone) {
  const data = await api('/dev/login', {
    method: 'POST', auth: false,
    body: { name, phone: phone || null, language_code: 'ru' },
  });
  state.users[name] = { token: data.access_token, refresh: data.refresh_token, tgId: null };
  state.current = name;
  saveLocal();
  await loadMe();
  toast('Вошли как ' + name, 'ok');
}

async function loadMe() {
  if (!state.current) { state.me = null; renderWho(); return; }
  state.me = await api('/me');
  const session = state.users[state.current];
  session.tgId = state.me.telegram_user_id;
  saveLocal();
  renderWho();
  await renderUsers();
}

function renderWho() {
  const who = $('#who');
  if (!state.me) { who.textContent = 'не вошли'; return; }
  const roles = state.me.memberships.map(m => `${m.company_name} · ${m.role}`).join(', ');
  who.innerHTML = `<b>${esc(state.me.display_name)}</b> · id ${state.me.telegram_user_id}`
    + (roles ? ` · ${esc(roles)}` : ' · клиент');
}

async function renderUsers() {
  const box = $('#usersBox');
  const known = Object.keys(state.users);
  if (!known.length) { box.innerHTML = '<div class="empty">Пока никого</div>'; return; }

  let server = [];
  try { server = await api('/dev/users', { auth: false }); } catch (e) { /* не критично */ }
  const byId = new Map(server.map(u => [u.telegram_user_id, u]));

  const table = el('table');
  table.innerHTML = '<tr><th>Имя</th><th>Telegram ID</th><th>Компании</th><th></th></tr>';
  known.forEach(name => {
    const s = state.users[name];
    const info = byId.get(s.tgId);
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(name)}${name === state.current ? ' <span class="pill ok">активен</span>' : ''}</td>
      <td>${s.tgId ?? '—'}</td>
      <td>${esc((info && info.companies.join(', ')) || '—')}</td>`;
    const td = el('td');
    const b = el('button', 'btn gh sm', name === state.current ? 'вы здесь' : 'переключиться');
    b.disabled = name === state.current;
    b.onclick = () => guard(async () => {
      state.current = name; saveLocal();
      state.companyId = null;
      await loadMe();
      toast('Теперь вы ' + name, 'ok');
    });
    td.append(b);
    tr.append(td);
    table.append(tr);
  });

  box.innerHTML = '';
  box.append(table);

  const inv = el('div', 'row');
  inv.style.marginTop = '12px';
  inv.innerHTML = `<div><label>Принять приглашение в команду (токен из вкладки «Бизнес»)</label>
    <input id="invToken" placeholder="вставьте токен"></div>`;
  const btn = el('button', 'btn sm', 'Принять');
  btn.onclick = () => guard(async () => {
    const token = $('#invToken').value.trim();
    if (!token) throw new Error('Нужен токен приглашения');
    const res = await api(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    toast(`Вы в команде «${res.company_name}» как ${res.role}`, 'ok');
    await loadMe();
  });
  const wrap = el('div');
  wrap.style.flex = '0 0 auto';
  wrap.append(btn);
  inv.append(wrap);
  box.append(inv);
}

$('#loginBtn').onclick = () => guard(async () => {
  const name = $('#loginName').value.trim();
  if (name.length < 2) throw new Error('Имя должно быть длиннее');
  await login(name, $('#loginPhone').value.trim());
  $('#loginName').value = '';
  $('#loginPhone').value = '';
});

/* ------------------------------------------------------------------ бизнес */

function ownedMembership() {
  if (!state.me) return null;
  return state.me.memberships.find(m => m.role === 'owner') || state.me.memberships[0] || null;
}

async function renderBusiness() {
  $('#bizNoUser').hidden = !!state.me;
  $('#bizCreate').hidden = true;
  $('#bizPanel').hidden = true;
  if (!state.me) return;

  const membership = ownedMembership();
  if (!membership) { $('#bizCreate').hidden = false; return; }

  state.companyId = membership.company_id;
  $('#bizPanel').hidden = false;

  await guard(async () => {
    const company = await api(`/companies/${state.companyId}`);
    const branches = await api(`/companies/${state.companyId}/branches`);
    state.branchId = branches.length ? branches[0].id : null;

    $('#bizTitle').textContent = company.name;
    const status = company.status === 'published'
      ? '<span class="pill ok">опубликована</span>'
      : '<span class="pill warn">черновик</span>';
    $('#bizSub').innerHTML = `${status} · ${esc(company.category)} · ${esc(company.currency_code)}`
      + (branches.length ? ` · ${esc(branches[0].timezone)}` : '');

    fillSettings(company.settings || {});
    await loadServices();
    await loadEmployees();
    await loadSchedule();
  });
}

$('#coCreate').onclick = () => guard(async () => {
  const company = await api('/companies', {
    method: 'POST',
    body: {
      name: $('#coName').value.trim(),
      category: $('#coCat').value,
      city: $('#coCity').value.trim(),
      timezone: $('#coTz').value,
      currency_code: 'KZT',
      default_locale: 'ru',
      phone: $('#coPhone').value.trim() || null,
      address: $('#coAddr').value.trim() || null,
      accepted_terms_version: '1.0',
      accepted_privacy_version: '1.0',
    },
  });
  const about = $('#coAbout').value.trim();
  if (about) await api(`/companies/${company.id}`, { method: 'PATCH', body: { description: about } });
  toast('Компания создана', 'ok');
  await loadMe();
  await renderBusiness();
});

/* --- услуги --- */

async function loadServices() {
  state.services = await api(`/companies/${state.companyId}/services?include_inactive=true`);
  const box = $('#svcList');
  if (!state.services.length) { box.innerHTML = '<div class="empty">Услуг пока нет</div>'; return; }

  const table = el('table');
  table.innerHTML = '<tr><th>Услуга</th><th>Цена</th><th>Время</th><th>Мастера</th></tr>';
  state.services.forEach(s => {
    const tr = el('tr');
    const dur = s.buffer_after_minutes
      ? `${s.duration_minutes}+${s.buffer_after_minutes} мин`
      : `${s.duration_minutes} мин`;
    tr.innerHTML = `<td>${esc(s.name)}${s.active ? '' : ' <span class="pill">выкл</span>'}</td>
      <td>${money(s.price_minor)}</td><td>${dur}</td>
      <td>${s.employee_ids.length || '<span class="pill dan">нет</span>'}</td>`;
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

$('#svcAdd').onclick = () => guard(async () => {
  await api(`/companies/${state.companyId}/services`, {
    method: 'POST',
    body: {
      name: $('#svcName').value.trim(),
      price_minor: Math.round(Number($('#svcPrice').value) * 100),
      duration_minutes: Number($('#svcDur').value),
      buffer_before_minutes: 0,
      buffer_after_minutes: Number($('#svcBuf').value),
      employee_ids: state.employees.map(e => e.id),
      public: true,
    },
  });
  $('#svcName').value = '';
  toast('Услуга добавлена', 'ok');
  await loadServices();
  await loadEmployees();
});

/* --- команда --- */

async function loadEmployees() {
  state.employees = await api(`/companies/${state.companyId}/employees`);
  const box = $('#empList');
  if (!state.employees.length) { box.innerHTML = '<div class="empty">Мастеров пока нет</div>'; return; }

  const table = el('table');
  table.innerHTML = '<tr><th>Мастер</th><th>Услуги</th><th>Доступ</th><th></th></tr>';
  state.employees.forEach(e => {
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(e.display_name)}<div class="pill">${esc(e.role_title || 'мастер')}</div></td>
      <td>${e.service_ids.length || '<span class="pill dan">нет</span>'}</td>
      <td>${e.has_access ? '<span class="pill ok">есть</span>' : '<span class="pill">нет</span>'}</td>`;

    const td = el('td');
    const link = el('button', 'btn gh sm', 'все услуги');
    link.title = 'Привязать мастера ко всем услугам компании';
    link.onclick = () => guard(async () => {
      await api(`/companies/${state.companyId}/employees/${e.id}`, {
        method: 'PATCH', body: { service_ids: state.services.map(s => s.id) },
      });
      toast('Услуги привязаны', 'ok');
      await loadEmployees();
      await loadServices();
    });

    const invite = el('button', 'btn gh sm', 'пригласить');
    invite.style.marginLeft = '6px';
    invite.title = 'Выдать ссылку: мастер войдёт своим именем и будет получать уведомления';
    invite.onclick = () => guard(async () => {
      const inv = await api(`/companies/${state.companyId}/invites`, {
        method: 'POST',
        body: { role: 'master', employee_id: e.id, permissions: [], expires_in_hours: 72 },
      });
      const out = el('div', 'msg', `<div class="meta">токен приглашения — вставьте его на вкладке «Люди»</div>${esc(inv.token)}`);
      td.parentElement.parentElement.after(out);
      toast('Приглашение создано', 'ok');
    });

    td.append(link, invite);
    tr.append(td);
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

$('#empAdd').onclick = () => guard(async () => {
  await api(`/companies/${state.companyId}/employees`, {
    method: 'POST',
    body: {
      display_name: $('#empName').value.trim(),
      role_title: $('#empRole').value.trim() || null,
      phone: null,
      bio: null,
      takes_appointments: true,
      branch_ids: state.branchId ? [state.branchId] : [],
      service_ids: state.services.map(s => s.id),
    },
  });
  $('#empName').value = '';
  toast('Мастер добавлен', 'ok');
  await loadEmployees();
  await loadServices();
});

/* --- график --- */

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function buildWeekdayRows(rules) {
  const box = $('#wdBox');
  box.innerHTML = '';
  const byDay = new Map(rules.map(r => [r.weekday, r]));
  WEEKDAYS.forEach((label, i) => {
    const rule = byDay.get(i);
    const row = el('div', 'wd');
    row.innerHTML = `
      <input type="checkbox" data-wd="${i}" ${rule || i < 6 ? 'checked' : ''}>
      <label>${label}</label>
      <input type="time" data-from="${i}" value="${rule ? rule.start : '10:00'}">
      <span style="color:var(--dim)">—</span>
      <input type="time" data-to="${i}" value="${rule ? rule.end : '20:00'}">`;
    box.append(row);
  });
}

async function loadSchedule() {
  if (!state.branchId) return;
  const rules = await api(
    `/companies/${state.companyId}/schedule/rules?branch_id=${state.branchId}`
  );
  const branchRules = rules.filter(r => !r.employee_id);
  buildWeekdayRows(branchRules);
  if (branchRules.length && branchRules[0].breaks.length) {
    $('#brFrom').value = branchRules[0].breaks[0].start;
    $('#brTo').value = branchRules[0].breaks[0].end;
  }
}

$('#wdSave').onclick = () => guard(async () => {
  const breaks = [];
  const from = $('#brFrom').value, to = $('#brTo').value;
  if (from && to && from < to) breaks.push({ start: from, end: to, title: 'Перерыв' });

  const rules = [];
  WEEKDAYS.forEach((_, i) => {
    if (!$(`[data-wd="${i}"]`).checked) return;
    rules.push({
      weekday: i,
      start: $(`[data-from="${i}"]`).value,
      end: $(`[data-to="${i}"]`).value,
      breaks,
    });
  });
  await api(`/companies/${state.companyId}/schedule/rules`, {
    method: 'PUT',
    body: { branch_id: state.branchId, employee_id: null, rules },
  });
  toast('График сохранён', 'ok');
});

/* --- правила записи --- */

function fillSettings(settings) {
  $('#cfgStep').value = settings.slot_step_minutes ?? 30;
  $('#cfgLead').value = settings.lead_time_minutes ?? 0;
  $('#cfgCancel').value = settings.cancellation_deadline_hours ?? 0;
  $('#cfgRem').value = (settings.reminders_minutes || [5, 2]).join(', ');
}

$('#cfgSave').onclick = () => guard(async () => {
  const reminders = $('#cfgRem').value.split(',')
    .map(v => Number(v.trim())).filter(v => v > 0);
  await api(`/companies/${state.companyId}`, {
    method: 'PATCH',
    body: {
      settings: {
        slot_step_minutes: Number($('#cfgStep').value),
        lead_time_minutes: Number($('#cfgLead').value),
        cancellation_deadline_hours: Number($('#cfgCancel').value),
        reminders_minutes: reminders,
      },
    },
  });
  toast('Правила сохранены', 'ok');
});

/* --- публикация --- */

$('#checkPub').onclick = () => guard(async () => {
  const res = await api(`/companies/${state.companyId}/publish-check`);
  $('#pubOut').innerHTML = res.ready
    ? '<span class="pill ok">всё заполнено, можно публиковать</span>'
    : 'Не хватает: ' + res.missing.map(m => `<span class="pill dan">${esc(m)}</span>`).join(' ');
});

$('#doPub').onclick = () => guard(async () => {
  await api(`/companies/${state.companyId}/publish`, { method: 'POST' });
  toast('Компания опубликована', 'ok');
  await renderBusiness();
});

/* --- календарь --- */

$('#calLoad').onclick = () => guard(loadCalendar);

async function loadCalendar() {
  const from = $('#calFrom').value || todayISO();
  const to = $('#calTo').value || todayISO(14);
  const rows = await api(
    `/companies/${state.companyId}/appointments?date_from=${from}&date_to=${to}&include_cancelled=true`
  );
  const box = $('#calList');
  if (!rows.length) { box.innerHTML = '<div class="empty">Записей нет</div>'; return; }

  const table = el('table');
  table.innerHTML = '<tr><th>Когда</th><th>Услуга</th><th>Мастер</th><th>Статус</th><th></th></tr>';
  rows.forEach(a => {
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(a.local_date)} ${esc(a.local_time)}</td>
      <td>${esc(a.title)}<div class="pill">${money(a.price_minor)}</div></td>
      <td>${esc(a.employee_name || '')}</td>
      <td>${statusPill(a.status)}</td>`;
    const td = el('td');
    if (a.status === 'confirmed' || a.status === 'checked_in') {
      td.append(actionBtn('завершить', () => act(a.id, 'complete')));
      td.append(actionBtn('неявка', () => act(a.id, 'no-show')));
      td.append(actionBtn('отменить', () => act(a.id, 'cancel', { reason: 'салон отменил' })));
    }
    tr.append(td);
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

function actionBtn(label, fn) {
  const b = el('button', 'btn gh sm', label);
  b.style.marginRight = '6px';
  b.onclick = () => guard(fn);
  return b;
}

async function act(id, what, body) {
  await api(`/companies/${state.companyId}/appointments/${id}/${what}`, {
    method: 'POST', body: body || {},
  });
  toast('Готово', 'ok');
  await loadCalendar();
}

function statusPill(status) {
  const map = {
    confirmed: ['ok', 'подтверждена'],
    completed: ['ok', 'завершена'],
    checked_in: ['ok', 'пришёл'],
    no_show: ['warn', 'неявка'],
    cancelled_by_client: ['dan', 'отменил клиент'],
    cancelled_by_company: ['dan', 'отменил салон'],
    pending_payment: ['warn', 'ждёт оплаты'],
  };
  const [cls, text] = map[status] || ['', status];
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

/* ------------------------------------------------------------------ клиент */

async function renderClient() {
  $('#clNoUser').hidden = !!state.me;
  $('#clPanel').hidden = !state.me;
  if (!state.me) return;
  if (!$('#bkDate').value) $('#bkDate').value = todayISO();
  await guard(loadCatalog);
  await guard(loadMyAppointments);
}

$('#catLoad').onclick = () => guard(loadCatalog);

async function loadCatalog() {
  const q = $('#catQ').value.trim();
  const page = await api('/public/companies' + (q ? '?q=' + encodeURIComponent(q) : ''), { auth: false });
  state.catalog = page.items;
  const box = $('#catList');
  if (!page.items.length) {
    box.innerHTML = '<div class="empty">Опубликованных компаний нет. Опубликуйте свою во вкладке «Бизнес».</div>';
    return;
  }
  const table = el('table');
  table.innerHTML = '<tr><th>Компания</th><th>Город</th><th>От</th><th></th></tr>';
  page.items.forEach(c => {
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(c.name)}<div class="pill">${esc(c.category)}</div></td>
      <td>${esc(c.city || '—')}</td>
      <td>${c.min_price_minor ? money(c.min_price_minor) : '—'}</td>`;
    const td = el('td');
    td.append(actionBtn('записаться', () => openBooking(c)));
    tr.append(td);
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

async function openBooking(company) {
  state.booking = company;
  $('#bookCard').hidden = false;
  $('#bookTitle').textContent = 'Запись · ' + company.name;

  const [services, staff, page] = await Promise.all([
    api(`/public/companies/${company.slug}/services`, { auth: false }),
    api(`/public/companies/${company.slug}/staff`, { auth: false }),
    api(`/public/companies/${company.slug}`, { auth: false }),
  ]);
  state.booking.branch = page.branches[0];
  $('#bookSub').textContent = `${page.address || ''} · ${page.branches[0] ? page.branches[0].timezone : ''}`;

  const svcSel = $('#bkSvc');
  svcSel.innerHTML = services.map(s =>
    `<option value="${s.id}">${esc(s.name)} · ${money(s.price_minor)} · ${s.duration_minutes} мин</option>`
  ).join('');

  const empSel = $('#bkEmp');
  empSel.innerHTML = '<option value="">любой мастер</option>' + staff.map(e =>
    `<option value="${e.id}">${esc(e.display_name)}</option>`
  ).join('');

  $('#bkSlots').innerHTML = '<div class="empty">Нажмите «Показать время»</div>';
}

$('#bkLoad').onclick = () => guard(loadSlots);

async function loadSlots() {
  const c = state.booking;
  if (!c) throw new Error('Сначала выберите компанию');
  const svc = $('#bkSvc').value;
  const emp = $('#bkEmp').value;
  const from = $('#bkDate').value || todayISO();
  const to = new Date(from);
  to.setDate(to.getDate() + 6);

  let url = `/public/companies/${c.slug}/availability?service_ids=${svc}`
    + `&date_from=${from}&date_to=${to.toISOString().slice(0, 10)}`;
  if (emp) url += `&employee_id=${emp}`;

  const data = await api(url, { auth: false });
  const box = $('#bkSlots');
  box.innerHTML = '';

  const withSlots = data.days.filter(d => d.slots.length);
  if (!withSlots.length) {
    box.innerHTML = '<div class="empty">Свободного времени нет. Проверьте график, привязку мастера к услуге и «мин. время до записи».</div>';
    return;
  }

  withSlots.forEach(day => {
    box.append(el('div', 'day-h', esc(day.date)));
    const wrap = el('div', 'slots');
    day.slots.forEach(slot => {
      const b = el('button', 'slot', `${slot.local_time}`);
      b.title = 'мастер ' + slot.employee_id.slice(0, 8);
      b.onclick = () => guard(() => book(slot, data.branch_id, svc));
      wrap.append(b);
    });
    box.append(wrap);
  });
}

async function book(slot, branchId, serviceId) {
  const c = state.booking;
  const key = `book-${c.id}-${slot.employee_id}-${slot.starts_at}`;
  const appt = await api(`/companies/${c.id}/appointments/self`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: {
      branch_id: branchId,
      employee_id: slot.employee_id,
      service_ids: [serviceId],
      starts_at: slot.starts_at,
      client_comment: null,
      availability_token: slot.token,
    },
  });
  toast(`Записаны на ${appt.local_date} ${appt.local_time}`, 'ok');
  await loadSlots();
  await loadMyAppointments();
}

$('#myLoad').onclick = () => guard(loadMyAppointments);

async function loadMyAppointments() {
  const rows = await api('/me/appointments?scope=all');
  const box = $('#myList');
  if (!rows.length) { box.innerHTML = '<div class="empty">Записей пока нет</div>'; return; }

  const table = el('table');
  table.innerHTML = '<tr><th>Когда</th><th>Где</th><th>Услуга</th><th>Статус</th><th></th></tr>';
  rows.forEach(a => {
    const tr = el('tr');
    tr.innerHTML = `<td>${esc(a.local_date)} ${esc(a.local_time)}</td>
      <td>${esc(a.company_name || '')}</td>
      <td>${esc(a.title)}<div class="pill">${money(a.price_minor)}</div></td>
      <td>${statusPill(a.status)}</td>`;
    const td = el('td');
    if (a.can_cancel) {
      td.append(actionBtn('отменить', async () => {
        await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: { reason: 'передумал' } });
        toast('Запись отменена', 'ok');
        await loadMyAppointments();
      }));
    }
    if (a.status === 'completed') {
      td.append(actionBtn('отзыв 5★', async () => {
        await api('/reviews', {
          method: 'POST',
          body: { appointment_id: a.id, rating: 5, comment: 'Всё понравилось' },
        });
        toast('Отзыв отправлен', 'ok');
      }));
    }
    tr.append(td);
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

/* ------------------------------------------------------------- уведомления */

async function loadInbox() {
  const who = $('#inboxWho');
  const known = Object.entries(state.users);
  const current = who.value;
  who.innerHTML = '<option value="">всем</option>' + known.map(([name, s]) =>
    `<option value="${s.tgId || ''}">${esc(name)}</option>`
  ).join('');
  who.value = current;

  const url = '/dev/inbox' + (current ? '?recipient=' + current : '');
  let items = [];
  try { items = await api(url, { auth: false }); } catch (e) { return; }

  const box = $('#inbox');
  if (!items.length) { box.innerHTML = '<div class="empty">Пока пусто</div>'; return; }

  const nameById = new Map(known.map(([name, s]) => [s.tgId, name]));
  box.innerHTML = '';
  items.slice().reverse().forEach(m => {
    const when = new Date(m.at).toLocaleTimeString('ru-RU');
    const to = nameById.get(m.to) || ('id ' + m.to);
    box.append(el('div', 'msg', `<div class="meta">${when} → ${esc(to)}</div>${esc(m.text)}`));
  });
}

async function loadQueue() {
  let rows = [];
  try { rows = await api('/dev/queue', { auth: false }); } catch (e) { return; }
  const box = $('#queue');
  if (!rows.length) { box.innerHTML = '<div class="empty">Пусто</div>'; return; }

  const table = el('table');
  table.innerHTML = '<tr><th>Шаблон</th><th>Когда</th><th>Статус</th><th>Попыток</th></tr>';
  rows.forEach(j => {
    const tr = el('tr');
    const when = new Date(j.scheduled_at).toLocaleString('ru-RU');
    const cls = { sent: 'ok', failed: 'dan', cancelled: '', retry: 'warn' }[j.status] || '';
    tr.innerHTML = `<td>${esc(j.template)}</td><td>${when}</td>
      <td><span class="pill ${cls}">${esc(j.status)}</span></td><td>${j.attempts}</td>`;
    table.append(tr);
  });
  box.innerHTML = '';
  box.append(table);
}

$('#inboxClear').onclick = () => guard(async () => {
  await api('/dev/inbox', { method: 'DELETE', auth: false });
  await loadInbox();
});
$('#inboxWho').onchange = () => guard(loadInbox);

/* ---------------------------------------------------------------- состояние */

async function loadState() {
  const data = await api('/dev/state', { auth: false });
  const labels = {
    users: 'пользователи', companies: 'компании', services: 'услуги',
    employees: 'мастера', clients: 'клиенты', appointments: 'записи',
    notifications: 'задачи уведомлений', delivered: 'доставлено сообщений',
  };
  const table = el('table');
  Object.entries(labels).forEach(([key, label]) => {
    const tr = el('tr');
    tr.innerHTML = `<td>${label}</td><td><b>${data[key]}</b></td>`;
    table.append(tr);
  });
  const box = $('#stateBox');
  box.innerHTML = '';
  box.append(table);
}

$('#stateLoad').onclick = () => guard(loadState);

$('#wipe').onclick = () => guard(async () => {
  if (!confirm('Стереть все данные песочницы? Тарифы останутся.')) return;
  await api('/dev/reset', { method: 'POST', auth: false });
  state.users = {};
  state.current = null;
  state.me = null;
  state.companyId = null;
  saveLocal();
  renderWho();
  await renderUsers();
  await loadState();
  toast('База очищена', 'ok');
});

/* ------------------------------------------------------------------- запуск */

async function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('ru-RU');
  try {
    const h = await fetch(API + '/live');
    $('#health').textContent = h.ok ? 'backend жив' : 'backend не отвечает';
    $('#health').className = 'badge' + (h.ok ? ' on' : '');
  } catch (e) {
    $('#health').textContent = 'backend не отвечает';
    $('#health').className = 'badge';
  }
  if (!$('[data-pane="notify"]').hidden) {
    await loadInbox();
    await loadQueue();
  }
}

(async function boot() {
  loadLocal();
  $('#calFrom').value = todayISO();
  $('#calTo').value = todayISO(14);
  if (state.current && state.users[state.current]) {
    try { await loadMe(); } catch (e) { state.current = null; saveLocal(); }
  }
  await renderUsers();
  await tick();
  setInterval(tick, 3000);
})();
