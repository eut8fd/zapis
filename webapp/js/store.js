import { buildSeed } from './seed.js';
import { startOfDay, dayKey, pad } from './ui.js';

const KEY = 'zapis.demo.v2';
const VER = 9;

export const S = {
  v: VER, anchor: null, shift: 0, theme: 'auto', aiMode: 'demo', onboarded: true,
  session: { role: 'owner', companyId: 'c1', employeeId: 'c1_owner', clientId: 'c1_cl1' },
  data: null, aiChat: {}, seenTips: {},
};

/* ---------- подписки ---------- */
const subs = new Set();
export const sub = fn => { subs.add(fn); return () => subs.delete(fn); };
let saveTimer = null;
export function emit() {
  subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 120);
}

/* ---------- время демо ---------- */
export const now = () => new Date(Date.now() + S.shift);
export const today = () => startOfDay(now());
export function setShift(ms) { S.shift = ms; emit(); }
export function shiftBy(ms) { S.shift += ms; emit(); }

/* ---------- persist ---------- */
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: VER, anchor: S.anchor, shift: S.shift, theme: S.theme, aiMode: S.aiMode, onboarded: S.onboarded, session: S.session, data: S.data, aiChat: S.aiChat, seenTips: S.seenTips })); }
  catch (e) { console.warn('save failed', e); }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function shiftTree(node, ms) {
  if (Array.isArray(node)) { node.forEach(n => shiftTree(n, ms)); return; }
  if (node && typeof node === 'object') {
    for (const k in node) {
      const v = node[k];
      if (typeof v === 'string' && ISO.test(v)) node[k] = new Date(new Date(v).getTime() + ms).toISOString();
      else if (v && typeof v === 'object') shiftTree(v, ms);
    }
  }
}

export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
  if (!raw || raw.v !== VER || !raw.data) { reset(false); return; }
  Object.assign(S, raw);
  // Демо всегда «свежее»: переносим данные на текущий день
  const a = startOfDay(new Date(S.anchor));
  const t = startOfDay(new Date());
  const diff = Math.round((t - a) / 86400000);
  if (diff !== 0) { shiftTree(S.data, diff * 86400000); S.anchor = t.toISOString(); }
  autoComplete();
}

export function reset(doEmit = true) {
  const t = startOfDay(new Date());
  S.anchor = t.toISOString();
  S.shift = 0;
  S.data = buildSeed(t);
  S.session = { role: 'owner', companyId: 'c1', employeeId: 'c1_owner', clientId: 'c1_cl1' };
  S.aiChat = {}; S.onboarded = true; S.seenTips = {};
  autoComplete();
  if (doEmit) emit(); else save();
}

// Записи, закончившиеся более 2 часов назад, автоматически считаем выполненными
export function autoComplete() {
  const n = now().getTime();
  let ch = 0;
  S.data.appointments.forEach(a => {
    if (a.status !== 'planned') return;
    const end = new Date(a.start).getTime() + a.duration * 60000;
    if (end < n - 2 * 3600000) { a.status = 'done'; ch++; }
  });
  return ch;
}

/* ---------- селекторы ---------- */
export const D = () => S.data;
export const cid = () => S.session.companyId;
export const co = (id = cid()) => S.data.companies.find(c => c.id === id);
export const allCompanies = () => S.data.companies;
export const emps = (id = cid()) => S.data.employees.filter(e => e.companyId === id && e.active !== false);
export const staff = (id = cid()) => emps(id).filter(e => e.takesAppointments);
export const emp = eid => S.data.employees.find(e => e.id === eid);
export const svcs = (id = cid()) => S.data.services.filter(s => s.companyId === id && s.active !== false);
export const svc = sid => S.data.services.find(s => s.id === sid);
export const clients = (id = cid()) => S.data.clients.filter(c => c.companyId === id);
export const client = cl => S.data.clients.find(c => c.id === cl);
export const appts = (id = cid()) => S.data.appointments.filter(a => a.companyId === id);
export const appt = aid => S.data.appointments.find(a => a.id === aid);
export const reviews = (id = cid()) => S.data.reviews.filter(r => r.companyId === id);
export const broadcasts = (id = cid()) => S.data.broadcasts.filter(b => b.companyId === id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
export const blocks = (id = cid()) => S.data.blocks.filter(b => b.companyId === id);

export const me = () => S.session.role === 'client' ? client(S.session.clientId) : emp(S.session.employeeId);
export const isOwner = () => S.session.role === 'owner';
export const isEmployee = () => S.session.role === 'employee';

export function apptEnd(a) { return new Date(new Date(a.start).getTime() + a.duration * 60000); }
export function apptTitle(a) { return (a.serviceIds || []).map(id => (svc(id) || {}).name).filter(Boolean).join(' + ') || 'Услуга'; }
export function apptColor(a) { const s = svc((a.serviceIds || [])[0]); return s ? s.color : '#4C6FFF'; }

export function dayAppts(date, { employeeId = null, companyId = cid(), includeCancelled = false } = {}) {
  const k = dayKey(date);
  return appts(companyId)
    .filter(a => dayKey(new Date(a.start)) === k)
    .filter(a => includeCancelled || a.status !== 'cancelled')
    .filter(a => !employeeId || a.employeeId === employeeId)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function clientAppts(clientId) {
  return S.data.appointments.filter(a => a.clientId === clientId).sort((a, b) => new Date(b.start) - new Date(a.start));
}
export function clientStats(clientId) {
  const list = clientAppts(clientId);
  const done = list.filter(a => a.status === 'done');
  const spent = done.reduce((s, a) => s + a.price, 0);
  const next = list.filter(a => a.status === 'planned' && new Date(a.start) > now()).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const last = done[0];
  return { visits: done.length, spent, avg: done.length ? Math.round(spent / done.length) : 0, next, last, all: list };
}

export function nextAppt(companyId = cid(), employeeId = null) {
  const n = now();
  return appts(companyId)
    .filter(a => a.status === 'planned' && new Date(a.start) > n)
    .filter(a => !employeeId || a.employeeId === employeeId)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
}

/* ---------- расписание и слоты ---------- */
export const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
export const toHM = min => pad(Math.floor(min / 60)) + ':' + pad(min % 60);

export function workDay(e, date) {
  const s = e.schedule && e.schedule[date.getDay()];
  if (!s || !s.on) return null;
  return s;
}
export function companyHours(date, id = cid()) {
  const c = co(id); const s = c && c.hours && c.hours[date.getDay()];
  return s && s.on ? s : null;
}

export function busyFor(empId, date, companyId = cid()) {
  const k = dayKey(date);
  const out = appts(companyId)
    .filter(a => a.employeeId === empId && a.status !== 'cancelled' && dayKey(new Date(a.start)) === k)
    .map(a => { const s = new Date(a.start); return { s: s.getHours() * 60 + s.getMinutes(), e: s.getHours() * 60 + s.getMinutes() + a.duration, id: a.id }; });
  blocks(companyId).filter(b => (b.employeeId === empId || !b.employeeId) && dayKey(new Date(b.start)) === k)
    .forEach(b => { const s = new Date(b.start), e = new Date(b.end); out.push({ s: s.getHours() * 60 + s.getMinutes(), e: e.getHours() * 60 + e.getMinutes(), block: true }); });
  return out;
}

export function slotFree(empId, date, startMin, duration, companyId = cid(), ignoreId = null) {
  const e = emp(empId); if (!e) return false;
  const w = workDay(e, date); if (!w) return false;
  const from = toMin(w.from), to = toMin(w.to);
  if (startMin < from || startMin + duration > to) return false;
  for (const b of (w.breaks || [])) {
    if (startMin < toMin(b.to) && startMin + duration > toMin(b.from)) return false;
  }
  for (const b of busyFor(empId, date, companyId)) {
    if (b.id && b.id === ignoreId) continue;
    if (startMin < b.e && startMin + duration > b.s) return false;
  }
  const n = now();
  if (dayKey(date) === dayKey(n)) {
    const cur = n.getHours() * 60 + n.getMinutes();
    if (startMin < cur + 10) return false;
  }
  if (startOfDay(date) < startOfDay(n)) return false;
  return true;
}

export function slotsFor(empIds, date, duration, { step = 30, companyId = cid(), ignoreId = null } = {}) {
  const list = empIds.map(emp).filter(Boolean);
  const days = list.map(e => workDay(e, date)).filter(Boolean);
  if (!days.length) return [];
  const from = Math.min(...days.map(d => toMin(d.from)));
  const to = Math.max(...days.map(d => toMin(d.to)));
  const out = [];
  for (let m = Math.ceil(from / step) * step; m + duration <= to; m += step) {
    const who = list.find(e => slotFree(e.id, date, m, duration, companyId, ignoreId));
    out.push({ min: m, t: toHM(m), free: !!who, empId: who ? who.id : null });
  }
  return out;
}

export function nextFreeFor(empId, duration, companyId = cid(), maxDays = 14) {
  const base = today();
  for (let d = 0; d < maxDays; d++) {
    const date = new Date(base.getTime() + d * 86400000);
    const s = slotsFor([empId], date, duration, { companyId }).find(x => x.free);
    if (s) return { date, slot: s };
  }
  return null;
}

export function freeGaps(date, empId, companyId = cid(), minLen = 60) {
  const e = emp(empId); const w = e && workDay(e, date); if (!w) return [];
  const from = toMin(w.from), to = toMin(w.to);
  const busy = busyFor(empId, date, companyId).concat((w.breaks || []).map(b => ({ s: toMin(b.from), e: toMin(b.to) })))
    .sort((a, b) => a.s - b.s);
  const gaps = []; let cur = from;
  busy.forEach(b => { if (b.s - cur >= minLen) gaps.push({ s: cur, e: b.s }); cur = Math.max(cur, b.e); });
  if (to - cur >= minLen) gaps.push({ s: cur, e: to });
  return gaps;
}

/* ---------- действия ---------- */
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createAppointment({ clientId, employeeId, serviceIds, start, note = '', source = 'owner', companyId = cid() }) {
  const list = serviceIds.map(svc).filter(Boolean);
  const a = {
    id: uid('ap_'), companyId, clientId, employeeId, serviceIds,
    start: new Date(start).toISOString(),
    duration: list.reduce((s, x) => s + x.duration, 0) || 60,
    price: list.reduce((s, x) => s + x.price, 0),
    status: 'planned', note, source, createdAt: now().toISOString(),
  };
  S.data.appointments.push(a);
  emit();
  return a;
}
export function cancelAppointment(id, by = 'owner') {
  const a = appt(id); if (!a) return;
  a.status = 'cancelled'; a.cancelledBy = by; a.cancelledAt = now().toISOString();
  emit();
}
export function completeAppointment(id) {
  const a = appt(id); if (!a) return;
  a.status = 'done'; a.completedAt = now().toISOString();
  emit();
}
export function restoreAppointment(id) { const a = appt(id); if (a) { a.status = 'planned'; emit(); } }
export function moveAppointment(id, start, employeeId) {
  const a = appt(id); if (!a) return;
  a.start = new Date(start).toISOString();
  if (employeeId) a.employeeId = employeeId;
  a.status = 'planned';
  emit();
}
export function setApptNote(id, note) { const a = appt(id); if (a) { a.note = note; emit(); } }

export function createClient({ name, phone = '', tg = '', companyId = cid() }) {
  const AVc = ['#4C6FFF', '#8B5CF6', '#F04462', '#F79009', '#12B76A', '#06AED4', '#EC4899'];
  const c = {
    id: uid('cl_'), companyId, name, phone, tg,
    initials: name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
    color: AVc[Math.floor(Math.random() * AVc.length)], createdAt: now().toISOString(), note: '', ai: null, tags: [],
  };
  S.data.clients.push(c); emit(); return c;
}
export function updateClient(id, patch) { const c = client(id); if (c) { Object.assign(c, patch); emit(); } }

export function createService({ name, price, duration, employeeIds, companyId = cid(), cat = 'nails' }) {
  const CATC = { nails: '#4C6FFF', hair: '#F79009', brow: '#8B5CF6', bar: '#0EA5E9', spa: '#12B76A' };
  const s = {
    id: uid('s_'), companyId, name, price: +price, duration: +duration, cat,
    color: CATC[cat] || '#4C6FFF', active: true, buffer: 0, desc: '',
    employeeIds: employeeIds && employeeIds.length ? employeeIds : staff(companyId).map(e => e.id),
  };
  S.data.services.push(s);
  s.employeeIds.forEach(id => { const e = emp(id); if (e && !e.serviceIds.includes(s.id)) e.serviceIds.push(s.id); });
  emit(); return s;
}
export function updateService(id, patch) {
  const s = svc(id); if (!s) return;
  Object.assign(s, patch);
  if (patch.employeeIds) {
    S.data.employees.filter(e => e.companyId === s.companyId).forEach(e => {
      const has = patch.employeeIds.includes(e.id);
      e.serviceIds = e.serviceIds.filter(x => x !== id);
      if (has) e.serviceIds.push(id);
    });
  }
  emit();
}
export function deleteService(id) {
  const s = svc(id); if (!s) return;
  s.active = false; emit();
}

export function createEmployee({ name, role, phone = '', serviceIds = [], companyId = cid() }) {
  const AVc = ['#4C6FFF', '#8B5CF6', '#F04462', '#F79009', '#12B76A', '#06AED4'];
  const e = {
    id: uid('e_'), companyId, name, role, phone, active: true, takesAppointments: true,
    initials: name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
    color: AVc[Math.floor(Math.random() * AVc.length)],
    schedule: JSON.parse(JSON.stringify(emps(companyId)[0].schedule)),
    serviceIds: serviceIds.length ? serviceIds : svcs(companyId).map(s => s.id),
    access: 'staff', rating: '5.0',
  };
  S.data.employees.push(e);
  e.serviceIds.forEach(sid => { const s = svc(sid); if (s && !s.employeeIds.includes(e.id)) s.employeeIds.push(e.id); });
  emit(); return e;
}
export function updateEmployee(id, patch) {
  const e = emp(id); if (!e) return;
  Object.assign(e, patch);
  if (patch.serviceIds) {
    svcs(e.companyId).forEach(s => {
      s.employeeIds = s.employeeIds.filter(x => x !== id);
      if (patch.serviceIds.includes(s.id)) s.employeeIds.push(id);
    });
  }
  emit();
}
export function removeEmployee(id) { const e = emp(id); if (e) { e.active = false; emit(); } }

export function addBlock({ employeeId, start, end, reason = 'Перерыв', companyId = cid() }) {
  S.data.blocks.push({ id: uid('bl_'), companyId, employeeId, start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason });
  emit();
}
export function removeBlock(id) { S.data.blocks = S.data.blocks.filter(b => b.id !== id); emit(); }

export function addMoney({ type, amount, cat, note = '', companyId = cid(), date = null }) {
  const rec = { id: uid('m_'), companyId, type, amount: +amount, cat, note, date: (date ? new Date(date) : now()).toISOString() };
  (type === 'income' ? S.data.incomes : S.data.expenses).push(rec);
  emit(); return rec;
}

export function addBroadcast(b) {
  const rec = { id: uid('bc_'), companyId: cid(), status: 'sent', sentAt: now().toISOString(), open: 0, booked: 0, ...b };
  S.data.broadcasts.push(rec); emit(); return rec;
}

export function setPlan(companyId, plan, days) {
  const c = co(companyId); if (!c) return;
  c.plan = plan;
  if (days != null) c.planUntil = new Date(now().getTime() + days * 86400000).toISOString();
  emit();
}
export function setCompanyStatus(companyId, status) { const c = co(companyId); if (c) { c.status = status; emit(); } }

/* ---------- статистика ---------- */
export function rangeStats(days, companyId = cid()) {
  const end = now(), start = new Date(startOfDay(end).getTime() - (days - 1) * 86400000);
  const all = appts(companyId);
  const inR = a => { const d = new Date(a.start); return d >= start && d <= end; };
  const done = all.filter(a => a.status === 'done' && inR(a));
  const planned = all.filter(a => a.status !== 'cancelled' && inR(a));
  const cancelled = all.filter(a => a.status === 'cancelled' && inR(a));
  const revenue = done.reduce((s, a) => s + a.price, 0);

  // предыдущий период
  const pStart = new Date(start.getTime() - days * 86400000), pEnd = new Date(start.getTime() - 1);
  const pDone = all.filter(a => a.status === 'done' && new Date(a.start) >= pStart && new Date(a.start) <= pEnd);
  const pRev = pDone.reduce((s, a) => s + a.price, 0);

  // ряд по дням
  const series = [], labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfDay(end).getTime() - i * 86400000);
    const k = dayKey(d);
    series.push(done.filter(a => dayKey(new Date(a.start)) === k).reduce((s, a) => s + a.price, 0));
    labels.push(days <= 7 ? ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()] : String(d.getDate()));
  }

  const byService = {};
  done.forEach(a => a.serviceIds.forEach(id => {
    const s = svc(id); if (!s) return;
    byService[id] = byService[id] || { name: s.name, color: s.color, count: 0, sum: 0 };
    byService[id].count++; byService[id].sum += s.price;
  }));
  const byEmployee = {};
  done.forEach(a => {
    const e = emp(a.employeeId); if (!e) return;
    byEmployee[e.id] = byEmployee[e.id] || { name: e.name, color: e.color, count: 0, sum: 0 };
    byEmployee[e.id].count++; byEmployee[e.id].sum += a.price;
  });

  const cls = clients(companyId);
  const newClients = cls.filter(c => new Date(c.createdAt) >= start).length;
  const clientIds = new Set(done.map(a => a.clientId));
  let repeat = 0;
  clientIds.forEach(id => { if (all.filter(a => a.clientId === id && a.status === 'done').length > 1) repeat++; });

  const expenses = S.data.expenses.filter(e => e.companyId === companyId && new Date(e.date) >= start && new Date(e.date) <= end)
    .reduce((s, e) => s + e.amount, 0);
  const extraIncome = S.data.incomes.filter(e => e.companyId === companyId && new Date(e.date) >= start && new Date(e.date) <= end)
    .reduce((s, e) => s + e.amount, 0);

  return {
    days, revenue, income: revenue + extraIncome, expenses, profit: revenue + extraIncome - expenses,
    count: done.length, planned: planned.length, cancelled: cancelled.length,
    avg: done.length ? Math.round(revenue / done.length) : 0,
    prevRevenue: pRev, prevCount: pDone.length,
    deltaRev: pRev ? Math.round((revenue - pRev) / pRev * 100) : (revenue ? 100 : 0),
    deltaCount: done.length - pDone.length,
    series, labels,
    byService: Object.values(byService).sort((a, b) => b.count - a.count),
    byEmployee: Object.values(byEmployee).sort((a, b) => b.sum - a.sum),
    newClients, repeat, totalClients: cls.length,
    load: Math.min(100, Math.round(done.length / Math.max(1, staff(companyId).length * days * 6) * 100)),
  };
}

export function todayStats(companyId = cid(), employeeId = null) {
  const list = dayAppts(now(), { companyId, employeeId });
  const done = list.filter(a => a.status === 'done');
  return {
    count: list.length,
    revenue: done.reduce((s, a) => s + a.price, 0),
    potential: list.reduce((s, a) => s + a.price, 0),
    clients: new Set(list.map(a => a.clientId)).size,
    done: done.length,
    list,
  };
}

export function lostClients(companyId = cid(), days = 45) {
  const n = now();
  return clients(companyId).map(c => {
    const st = clientStats(c.id);
    return { c, st };
  }).filter(x => x.st.visits > 0 && !x.st.next && x.st.last && (n - new Date(x.st.last.start)) / 86400000 > days)
    .sort((a, b) => b.st.spent - a.st.spent);
}

/* ---------- супер-админ ---------- */
export function saStats() {
  const cs = allCompanies();
  const PRICE = { START: 9900, PRO: 19900, BUSINESS: 39900 };
  const active = cs.filter(c => c.status !== 'blocked' && new Date(c.planUntil) > now());
  return {
    companies: cs.length,
    active: active.length,
    mrr: active.reduce((s, c) => s + (PRICE[c.plan] || 0), 0),
    users: S.data.employees.length,
    clients: S.data.clients.length,
    todayAppts: S.data.appointments.filter(a => dayKey(new Date(a.start)) === dayKey(now()) && a.status !== 'cancelled').length,
    totalAppts: S.data.appointments.length,
    expiring: cs.filter(c => { const d = (new Date(c.planUntil) - now()) / 86400000; return d > 0 && d < 10; }),
    blocked: cs.filter(c => c.status === 'blocked'),
    price: PRICE,
  };
}
export function companyStats(id) {
  return {
    team: emps(id).length,
    clients: clients(id).length,
    appts: appts(id).length,
    revenue: appts(id).filter(a => a.status === 'done').reduce((s, a) => s + a.price, 0),
  };
}
