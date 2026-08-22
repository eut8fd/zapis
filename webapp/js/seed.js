// Генерация большого «живого» демо-набора данных (детерминированная)
const AV = ['#4C6FFF', '#8B5CF6', '#F04462', '#F79009', '#12B76A', '#06AED4', '#EC4899', '#7C3AED', '#0EA5E9', '#FB7185', '#10B981', '#6366F1'];

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

const F = ['Анна', 'Айгерим', 'Динара', 'Карина', 'Мария', 'Ольга', 'Айгуль', 'Жанна', 'Виктория', 'Салтанат', 'Гульнара', 'Алия', 'Камила', 'Дана', 'Асель', 'Марина', 'Елена', 'Наталья', 'Светлана', 'Ирина', 'Юлия', 'Татьяна', 'Аружан', 'Малика', 'Диана', 'Сабина', 'Алина', 'Кристина', 'Екатерина', 'Полина', 'Софья', 'Лаура', 'Милана', 'Амина', 'Жанель', 'Айым', 'Нурай', 'Дария', 'Валерия', 'Ксения', 'Эльмира', 'Зарина'];
const M = ['Александр', 'Максим', 'Тимур', 'Данияр', 'Ерлан', 'Азамат', 'Руслан', 'Арман', 'Дмитрий', 'Сергей', 'Алексей', 'Нурлан', 'Бекзат', 'Олжас', 'Кайрат', 'Игорь', 'Павел', 'Никита', 'Марат', 'Санжар', 'Ильяс', 'Артём'];
const SF = ['Петрова', 'Иванова', 'Смагулова', 'Ким', 'Ли', 'Абдрахманова', 'Ахметова', 'Соколова', 'Новикова', 'Жумабаева', 'Тулегенова', 'Орлова', 'Кузнецова', 'Сейтказы', 'Бекова', 'Мухамедова', 'Волкова', 'Романова', 'Ержанова', 'Садыкова', 'Нурланова', 'Исаева', 'Егорова', 'Байжанова'];
const SM = ['Петров', 'Иванов', 'Смагулов', 'Ким', 'Ли', 'Абдрахманов', 'Ахметов', 'Соколов', 'Новиков', 'Жумабаев', 'Тулегенов', 'Орлов', 'Кузнецов', 'Сейтказы', 'Беков', 'Мухамедов', 'Волков', 'Романов', 'Ержанов', 'Садыков'];

const initials = n => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const phone = r => '+7 7' + int(r, 10, 79) + ' ' + int(r, 100, 999) + ' ' + String(int(r, 10, 99)) + ' ' + String(int(r, 10, 99));

const WEEK_DEFAULT = () => ({
  1: { on: true, from: '09:00', to: '20:00', breaks: [{ from: '13:00', to: '14:00' }] },
  2: { on: true, from: '09:00', to: '20:00', breaks: [{ from: '13:00', to: '14:00' }] },
  3: { on: true, from: '09:00', to: '20:00', breaks: [{ from: '13:00', to: '14:00' }] },
  4: { on: true, from: '09:00', to: '20:00', breaks: [{ from: '13:00', to: '14:00' }] },
  5: { on: true, from: '09:00', to: '20:00', breaks: [{ from: '13:00', to: '14:00' }] },
  6: { on: true, from: '10:00', to: '18:00', breaks: [] },
  // воскресенье — короткий день: демо должно выглядеть живым в любой день недели
  0: { on: true, from: '10:00', to: '17:00', breaks: [] },
});

const CO = [
  {
    id: 'c1', name: 'Beauty Studio Lumière', short: 'Lumière', cat: 'Салон красоты', color: '#4C6FFF',
    city: 'Алматы', addr: 'ул. Достык 132, 2 этаж', phone: '+7 727 350 12 12', rating: 4.9, reviews: 214,
    plan: 'PRO', planDays: 35, slug: 'lumiere', tgLink: 'lumiere_beauty', seed: 1001,
    about: 'Студия красоты полного цикла: ногти, волосы, брови и ресницы.',
    owner: { name: 'Александр Ким', role: 'Владелец' },
    staff: [
      { name: 'Айгерим Сайдуллаева', role: 'Мастер маникюра', tags: ['nails'] },
      { name: 'Динара Тулегенова', role: 'Парикмахер-стилист', tags: ['hair'] },
      { name: 'Карина Ли', role: 'Бровист', tags: ['brow'] },
      { name: 'Мария Новикова', role: 'Мастер маникюра', tags: ['nails'] },
      { name: 'Ольга Волкова', role: 'Лешмейкер', tags: ['brow'] },
    ],
    services: [
      ['Маникюр классический', 6000, 60, 'nails'], ['Маникюр + гель-лак', 9000, 90, 'nails'],
      ['Маникюр + дизайн', 12000, 105, 'nails'], ['Наращивание ногтей', 15000, 150, 'nails'],
      ['Снятие покрытия', 2500, 30, 'nails'], ['Женская стрижка', 8000, 60, 'hair'],
      ['Мужская стрижка', 5000, 40, 'hair'], ['Окрашивание в один тон', 18000, 120, 'hair'],
      ['Мелирование', 25000, 180, 'hair'], ['Укладка', 7000, 45, 'hair'],
      ['Кератиновое выпрямление', 35000, 180, 'hair'], ['Коррекция бровей', 4000, 30, 'brow'],
      ['Окрашивание бровей', 5500, 40, 'brow'], ['Ламинирование ресниц', 12000, 75, 'brow'],
      ['Наращивание ресниц', 16000, 120, 'brow'],
    ],
    clients: 80, past: 130, future: 42, density: 1,
  },
  {
    id: 'c2', name: 'BLADE Barbershop', short: 'BLADE', cat: 'Барбершоп', color: '#2B3340',
    city: 'Алматы', addr: 'пр. Абая 44, 1 этаж', phone: '+7 727 311 44 44', rating: 4.8, reviews: 156,
    plan: 'START', planDays: 6, slug: 'blade', tgLink: 'blade_barber', seed: 2002,
    about: 'Классический барбершоп: стрижки, бороды, королевское бритьё.',
    owner: { name: 'Максим Орлов', role: 'Владелец' },
    staff: [
      { name: 'Тимур Абдрахманов', role: 'Барбер', tags: ['bar'] },
      { name: 'Данияр Смагулов', role: 'Барбер', tags: ['bar'] },
      { name: 'Ерлан Беков', role: 'Топ-барбер', tags: ['bar'] },
    ],
    services: [
      ['Мужская стрижка', 6000, 45, 'bar'], ['Стрижка машинкой', 4000, 30, 'bar'],
      ['Моделирование бороды', 5000, 40, 'bar'], ['Стрижка + борода', 9500, 75, 'bar'],
      ['Королевское бритьё', 7000, 50, 'bar'], ['Детская стрижка', 4500, 40, 'bar'],
      ['Камуфляж седины', 6500, 45, 'bar'], ['Уход за кожей лица', 5500, 35, 'bar'],
    ],
    clients: 46, past: 96, future: 26, density: .62,
  },
  {
    id: 'c3', name: 'SPA Ritual', short: 'Ritual', cat: 'Спа и массаж', color: '#12B76A',
    city: 'Астана', addr: 'ул. Кабанбай батыра 12', phone: '+7 717 255 88 00', rating: 5.0, reviews: 98,
    plan: 'PRO', planDays: 68, slug: 'ritual', tgLink: 'spa_ritual', seed: 3003,
    about: 'Спа-центр: массаж, обёртывания и авторские ритуалы.',
    owner: { name: 'Айгуль Ержанова', role: 'Владелец' },
    staff: [
      { name: 'Жанна Исаева', role: 'Массажист', tags: ['spa'] },
      { name: 'Виктория Егорова', role: 'Спа-терапевт', tags: ['spa'] },
      { name: 'Салтанат Байжанова', role: 'Массажист', tags: ['spa'] },
      { name: 'Гульнара Садыкова', role: 'Косметолог', tags: ['spa'] },
    ],
    services: [
      ['Классический массаж', 18000, 60, 'spa'], ['Тайский массаж', 25000, 90, 'spa'],
      ['Стоун-терапия', 22000, 80, 'spa'], ['Массаж лица', 12000, 45, 'spa'],
      ['Спа-ритуал «Оазис»', 45000, 150, 'spa'], ['Обёртывание', 20000, 70, 'spa'],
      ['Антицеллюлитный массаж', 19000, 60, 'spa'], ['Массаж головы', 9000, 30, 'spa'],
      ['Хаммам', 15000, 60, 'spa'], ['Ароматерапия', 16000, 50, 'spa'],
    ],
    clients: 62, past: 88, future: 24, density: .55,
  },
];

const CAT_COLOR = { nails: '#4C6FFF', hair: '#F79009', brow: '#8B5CF6', bar: '#0EA5E9', spa: '#12B76A' };
// разовые расходы: ключ категории, база, частота в месяц
const EXPENSES = [['materials', 60000, 6], ['ads', 40000, 4], ['utilities', 25000, 1], ['other_ex', 12000, 8]];
// то, что повторяется само: аренда и зарплата не заводятся руками каждый месяц
const RECUR = [
  ['expense', 'rent', 350000, 'month', ''],
  ['expense', 'salary', 220000, 'month', 'Администраторы'],
  ['income', 'rent_in', 60000, 'month', 'Кресло у окна'],
];

// стартовая тарифная сетка платформы — дальше её правит Super Admin
const PLANS = () => ([
  {
    id: 'START', name: 'START', price: 9900, period: 'month', active: true, color: '#0EA5E9',
    limits: { staff: 1, services: 20, broadcasts: 2 },
    feats: ['1 сотрудник', 'Онлайн-запись', 'База клиентов', 'Напоминания'],
  },
  {
    id: 'PRO', name: 'PRO', price: 19900, period: 'month', active: true, color: '#4C6FFF',
    limits: { staff: 10, services: 100, broadcasts: 20 },
    feats: ['До 10 сотрудников', 'AI-помощник', 'Рассылки', 'Аналитика и финансы'],
  },
  {
    id: 'BUSINESS', name: 'BUSINESS', price: 39900, period: 'month', active: true, color: '#8B5CF6',
    limits: { staff: 0, services: 0, broadcasts: 0 },
    feats: ['Без ограничений', 'Несколько филиалов', 'API и интеграции', 'Приоритетная поддержка'],
  },
]);

// «Фоновые» компании — нужны, чтобы панель Super Admin выглядела как настоящий SaaS
const BG = [
  ['Nail Bar Almaty', 'Ногтевая студия', 'Алматы', 'PRO', 26, '#EC4899'],
  ['Studio Hair&Co', 'Парикмахерская', 'Алматы', 'START', 12, '#F79009'],
  ['Brow House', 'Броу-бар', 'Астана', 'PRO', 48, '#8B5CF6'],
  ['Men’s Club', 'Барбершоп', 'Шымкент', 'BUSINESS', 71, '#0EA5E9'],
  ['Aroma Spa', 'Спа-центр', 'Астана', 'PRO', 4, '#12B76A'],
  ['Beauty Point', 'Салон красоты', 'Караганда', 'START', -3, '#F04462'],
  ['Lash Room', 'Студия ресниц', 'Алматы', 'START', 19, '#06AED4'],
  ['Barber 7', 'Барбершоп', 'Актобе', 'PRO', 33, '#6366F1'],
  ['Sakura Nails', 'Ногтевая студия', 'Алматы', 'PRO', 9, '#FB7185'],
];

function buildBackground(st, today) {
  BG.forEach((b, bi) => {
    const [name, cat, city, plan, days, color] = b;
    const r = rng(9000 + bi * 37);
    const id = 'bg' + (bi + 1);
    st.companies.push({
      id, name, short: name.split(' ')[0], cat, color, city,
      addr: 'ул. Демо ' + int(r, 1, 90), phone: phone(r), rating: +(4.4 + r() * 0.6).toFixed(1),
      reviewsCount: int(r, 20, 180), about: '', plan,
      planUntil: new Date(today.getTime() + days * 86400000).toISOString(),
      slug: id, tgLink: id, initials: initials(name), status: days < -1 ? 'blocked' : null,
      createdAt: new Date(today.getTime() - int(r, 20, 500) * 86400000).toISOString(),
      hours: WEEK_DEFAULT(), currency: '₸',
      logo: null, cover: null, finCats: { income: {}, expense: {} },
    });
    const owner = { id: id + '_owner', companyId: id, name: pick(r, M) + ' ' + pick(r, SM), role: 'Владелец', isOwner: true, active: true, initials: 'ВЛ', color: AV[bi % AV.length], phone: phone(r), schedule: WEEK_DEFAULT(), serviceIds: [], takesAppointments: false, access: 'owner', photo: null, since: null, showExp: true };
    st.employees.push(owner);
    const team = [];
    for (let i = 0; i < int(r, 1, 4); i++) {
      const nm = pick(r, F) + ' ' + pick(r, SF);
      team.push({
        id: id + '_e' + i, companyId: id, name: nm, role: 'Мастер', active: true,
        initials: initials(nm), color: AV[(bi + i) % AV.length], phone: phone(r),
        schedule: WEEK_DEFAULT(), serviceIds: [], takesAppointments: true, tags: ['nails'],
        access: 'staff', rating: (4.5 + r() * .5).toFixed(1),
        photo: null, since: today.getFullYear() - int(r, 1, 9), showExp: true,
      });
    }
    st.employees.push(...team);
    const svcs = [['Основная услуга', 9000, 60], ['Быстрая услуга', 5000, 30], ['Премиум', 20000, 120]]
      .map((s, i) => ({ id: id + '_s' + i, companyId: id, name: s[0], price: s[1], duration: s[2], cat: 'nails', color, active: true, buffer: 0, desc: '', photo: null, employeeIds: team.map(e => e.id) }));
    st.services.push(...svcs);
    team.forEach(e => { e.serviceIds = svcs.map(s => s.id); });
    const cls = [];
    for (let i = 0; i < int(r, 12, 40); i++) {
      const nm = pick(r, F) + ' ' + pick(r, SF);
      cls.push({ id: id + '_cl' + i, companyId: id, name: nm, phone: phone(r), tg: '', initials: initials(nm), color: AV[int(r, 0, AV.length - 1)], createdAt: new Date(today.getTime() - int(r, 3, 300) * 86400000).toISOString(), note: '', ai: null, tags: [] });
    }
    st.clients.push(...cls);
    for (let d = 60; d >= -7; d--) {
      if (r() < .45) continue;
      const day = new Date(today.getTime() - d * 86400000);
      if (day.getDay() === 0 && r() < .6) continue;
      const e = pick(r, team), sv = pick(r, svcs);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), int(r, 9, 18), pick(r, [0, 30]));
      st.appointments.push({
        id: id + '_ap' + d, companyId: id, clientId: pick(r, cls).id, employeeId: e.id,
        serviceIds: [sv.id], start: start.toISOString(), duration: sv.duration, price: sv.price,
        status: d > 0 ? (r() < .08 ? 'cancelled' : 'done') : 'planned', note: '', source: 'client',
        createdAt: new Date(start.getTime() - 3 * 86400000).toISOString(),
      });
    }
  });
}

export function buildSeed(anchor) {
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const st = {
    companies: [], employees: [], services: [], clients: [], appointments: [],
    expenses: [], incomes: [], reviews: [], broadcasts: [], blocks: [], notes: [],
    recurring: [], plans: PLANS(), notices: [], saBroadcasts: [],
  };

  CO.forEach(co => {
    const r = rng(co.seed);
    const untilDate = new Date(today.getTime() + co.planDays * 86400000);
    st.companies.push({
      id: co.id, name: co.name, short: co.short, cat: co.cat, color: co.color, city: co.city,
      addr: co.addr, phone: co.phone, rating: co.rating, reviewsCount: co.reviews, about: co.about,
      plan: co.plan, planUntil: untilDate.toISOString(), slug: co.slug, tgLink: co.tgLink,
      initials: initials(co.name), createdAt: new Date(today.getTime() - int(r, 120, 400) * 86400000).toISOString(),
      hours: WEEK_DEFAULT(), currency: '₸',
      logo: null, cover: null, finCats: { income: {}, expense: {} },
    });

    // владелец
    const ownerId = co.id + '_owner';
    st.employees.push({
      id: ownerId, companyId: co.id, name: co.owner.name, role: co.owner.role, isOwner: true, active: true,
      initials: initials(co.owner.name), color: AV[0], phone: phone(r), schedule: WEEK_DEFAULT(),
      serviceIds: [], takesAppointments: false, access: 'owner',
      photo: null, since: today.getFullYear() - int(r, 4, 12), showExp: true,
    });

    // сотрудники
    const emps = co.staff.map((s, i) => ({
      id: co.id + '_e' + (i + 1), companyId: co.id, name: s.name, role: s.role, active: true,
      initials: initials(s.name), color: AV[(i + 1) % AV.length], phone: phone(r),
      schedule: WEEK_DEFAULT(), serviceIds: [], takesAppointments: true, tags: s.tags,
      access: i === 0 ? 'manager' : 'staff',
      rating: (4.6 + r() * 0.4).toFixed(1),
      photo: null, since: today.getFullYear() - int(r, 1, 11), showExp: true,
    }));
    if (co.id === 'c1') { emps[4].schedule[2].on = false; emps[1].schedule[6].on = false; }
    st.employees.push(...emps);

    // услуги
    const svcs = co.services.map((s, i) => ({
      id: co.id + '_s' + (i + 1), companyId: co.id, name: s[0], price: s[1], duration: s[2],
      cat: s[3], color: CAT_COLOR[s[3]], active: true, buffer: 0, desc: '', photo: null,
      employeeIds: emps.filter(e => e.tags.includes(s[3])).map(e => e.id),
    }));
    svcs.forEach(s => { if (!s.employeeIds.length) s.employeeIds = emps.map(e => e.id); });
    emps.forEach(e => { e.serviceIds = svcs.filter(s => s.employeeIds.includes(e.id)).map(s => s.id); });
    st.services.push(...svcs);

    // клиенты
    const cls = [];
    const seen = new Set();
    for (let i = 0; i < co.clients; i++) {
      const male = co.id === 'c2' ? r() < .92 : r() < .12;
      let nm = '';
      for (let t = 0; t < 20; t++) {
        nm = male ? pick(r, M) + ' ' + pick(r, SM) : pick(r, F) + ' ' + pick(r, SF);
        if (!seen.has(nm)) break;
      }
      seen.add(nm);
      cls.push({
        id: co.id + '_cl' + (i + 1), companyId: co.id, name: nm, phone: phone(r),
        tg: '@' + ['user', 'client', 'nice', 'best', 'my'][int(r, 0, 4)] + int(r, 100, 999),
        initials: initials(nm), color: AV[int(r, 0, AV.length - 1)],
        createdAt: new Date(today.getTime() - int(r, 5, 400) * 86400000).toISOString(),
        note: '', ai: null, tags: [],
      });
    }
    // главный демо-клиент
    cls[0].name = co.id === 'c2' ? 'Азамат Жумабаев' : 'Анна Петрова';
    cls[0].initials = initials(cls[0].name);
    cls[0].phone = '+7 701 234 56 78';
    cls[0].tg = '@anna_p';
    cls[0].color = '#EC4899';
    if (co.id === 'c1') {
      cls[0].ai = {
        prefs: ['Нюдовые оттенки', 'Короткая длина'],
        care: ['Чувствительная кожа рук', 'Аллергия на ацетон'],
        next: ['Хочет попробовать французский маникюр'],
        updated: new Date(today.getTime() - 6 * 86400000).toISOString(),
      };
      cls[0].note = 'Постоянный клиент с 2024 года. Всегда приходит вовремя.';
      cls[1].ai = { prefs: ['Тёплый блонд'], care: ['Сухие кончики — нужен уход'], next: ['Планирует мелирование'], updated: new Date(today.getTime() - 14 * 86400000).toISOString() };
    }
    st.clients.push(...cls);

    const takers = emps.filter(e => e.takesAppointments);
    const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    // подобрать время, которое реально попадает в смену мастера и не рвёт перерыв
    const fitTime = (e, day, sv) => {
      const w = e.schedule[day.getDay()];
      if (!w || !w.on) return null;
      const from = hm(w.from), to = hm(w.to);
      for (let tries = 0; tries < 12; tries++) {
        const start = from + int(r, 0, Math.max(0, Math.floor((to - from - sv.duration) / 30))) * 30;
        if (start + sv.duration > to) continue;
        const bad = (w.breaks || []).some(b => start < hm(b.to) && start + sv.duration > hm(b.from));
        if (bad) continue;
        return { h: Math.floor(start / 60), m: start % 60 };
      }
      return null;
    };
    const mk = (id, cl, emp, svc, start, status, source) => ({
      id, companyId: co.id, clientId: cl.id, employeeId: emp.id, serviceIds: [svc.id],
      start: start.toISOString(), duration: svc.duration, price: svc.price, status,
      note: '', source: source || (r() < .55 ? 'client' : 'owner'),
      createdAt: new Date(start.getTime() - int(r, 1, 20) * 86400000).toISOString(),
    });

    // ---- прошлые записи (90 дней), плотнее ближе к сегодня ----
    let n = 0;
    const K = co.density;
    for (let d = 90; d >= 1; d--) {
      const day = new Date(today.getTime() - d * 86400000);
      if (day.getDay() === 0 && r() < .6) continue;
      const base = d <= 14 ? int(r, 6, 10) : d <= 30 ? int(r, 5, 8) : int(r, 3, 6);
      const perDay = Math.max(1, Math.round(base * K));
      const used = new Set();
      for (let k = 0; k < perDay; k++) {
        const emp = pick(r, takers);
        const svc = pick(r, svcs.filter(s => s.employeeIds.includes(emp.id)));
        const t = fitTime(emp, day, svc);
        if (!t) continue;
        const { h, m } = t;
        const key = emp.id + '_' + h + '_' + m;
        if (used.has(key)) continue;
        used.add(key);
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        const st2 = r() < .07 ? 'cancelled' : 'done';
        // «свежий» пул клиентов уже, чем исторический — так появляются те, кто давно не приходил
        const pool = d > 45 ? cls.slice(0, Math.round(cls.length * .85)) : cls.slice(0, Math.round(cls.length * .5));
        st.appointments.push(mk(co.id + '_ap' + (++n), pick(r, pool), emp, svc, start, st2));
      }
    }

    // ---- сегодня ----
    const todayPlan = co.id === 'c1'
      ? [['09:00', 0, 1], ['10:30', 0, 2], ['11:00', 1, 5], ['12:30', 2, 11], ['14:00', 0, 0], ['15:30', 3, 3], ['16:00', 1, 7], ['18:00', 4, 13]]
      : co.id === 'c2'
        ? [['10:00', 0, 0], ['11:30', 1, 3], ['13:00', 0, 2], ['15:00', 2, 4], ['16:30', 1, 0], ['18:00', 2, 3]]
        : [['10:00', 0, 0], ['12:00', 1, 1], ['14:30', 2, 4], ['16:00', 3, 3], ['18:00', 0, 6]];
    // Записи «на сегодня» вписываем в рабочие часы этого дня недели:
    // в короткий день (сб/вс) утренние и вечерние слоты сдвигаются внутрь окна.
    const dayWin = WEEK_DEFAULT()[today.getDay()];
    const winFrom = +dayWin.from.split(':')[0] * 60 + +dayWin.from.split(':')[1];
    const winTo = +dayWin.to.split(':')[0] * 60 + +dayWin.to.split(':')[1];
    todayPlan.forEach((p, i) => {
      const [hhmm, ei, si] = p;
      const svc = svcs[si % svcs.length];
      const working = takers.filter(e => { const w = e.schedule[today.getDay()]; return w && w.on; });
      if (!working.length) return;
      let emp = takers[ei % takers.length];
      if (!working.includes(emp)) emp = working[ei % working.length];
      const [H, Mi] = hhmm.split(':').map(Number);
      let mins = H * 60 + Mi;
      if (mins < winFrom) mins = winFrom + (i % 3) * 30;
      if (mins + svc.duration > winTo) mins = Math.max(winFrom, winTo - svc.duration - (i % 2) * 30);
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), Math.floor(mins / 60), mins % 60);
      const cl = i === 1 ? cls[0] : cls[int(r, 1, Math.min(40, cls.length - 1))];
      const a = mk(co.id + '_apT' + i, cl, emp, svc, start, 'planned');
      if (i === 1 && co.id === 'c1') a.note = 'Просила не опаздывать — спешит на встречу';
      st.appointments.push(a);
    });

    // ---- будущие записи ----
    let fn = 0;
    for (let d = 1; d <= 21 && fn < co.future; d++) {
      const day = new Date(today.getTime() + d * 86400000);
      if (day.getDay() === 0 && r() < .6) continue;
      const perDay = Math.max(1, Math.round((d <= 3 ? int(r, 4, 7) : d <= 8 ? int(r, 2, 4) : int(r, 0, 2)) * co.density));
      const used = new Set();
      for (let k = 0; k < perDay && fn < co.future; k++) {
        const emp = pick(r, takers);
        const svc = pick(r, svcs.filter(s => s.employeeIds.includes(emp.id)));
        const t = fitTime(emp, day, svc);
        if (!t) continue;
        const { h, m } = t;
        const key = emp.id + h + m; if (used.has(key)) continue; used.add(key);
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        st.appointments.push(mk(co.id + '_apF' + (++fn), pick(r, cls.slice(0, Math.min(45, cls.length))), emp, svc, start, 'planned'));
      }
    }
    // «дыры» в расписании завтра для AI-сценария
    if (co.id === 'c1') {
      st.appointments = st.appointments.filter(a => {
        if (!a.id.startsWith('c1_apF')) return true;
        const dt = new Date(a.start);
        const isTom = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - today) / 86400000) === 1;
        return !(isTom && (dt.getHours() === 12 || dt.getHours() === 14 || dt.getHours() === 17));
      });
    }

    // ---- разовые расходы за 90 дней ----
    for (let d = 90; d >= 0; d--) {
      const day = new Date(today.getTime() - d * 86400000);
      EXPENSES.forEach((e, i) => {
        const [key, base, freq] = e;
        if (d % Math.round(30 / freq) !== i % Math.round(30 / freq)) return;
        st.expenses.push({
          id: co.id + '_ex' + d + '_' + i, companyId: co.id, type: 'expense',
          amount: Math.round(base * (0.8 + r() * 0.4) / (freq > 3 ? 4 : 1)),
          cat: key, date: day.toISOString(), note: key === 'other_ex' ? 'Кофе и вода' : '',
        });
      });
    }

    // ---- регулярные платежи ----
    // Начинаем на полгода назад: тогда в любом периоде аналитики
    // аренда и зарплата уже видны, а не появляются «с завтрашнего дня».
    RECUR.forEach((x, i) => {
      const [type, cat, amount, every, note] = x;
      const from = new Date(today.getFullYear(), today.getMonth() - 6, Math.min(28, 1 + i * 4));
      st.recurring.push({
        id: co.id + '_rc' + i, companyId: co.id, type, cat,
        amount: Math.round(amount * (co.density || 1)), note, every,
        from: from.toISOString(), to: null, active: true, createdAt: from.toISOString(),
      });
    });

    // ---- отзывы ----
    const TXT = [
      'Всё очень понравилось, буду приходить ещё!', 'Мастер профессионал, результат супер.',
      'Уютно, чисто, вежливый персонал.', 'Записалась через телеграм за минуту — удобно.',
      'Отличный сервис, рекомендую!', 'Сделали быстро и аккуратно.',
      'Немного задержали по времени, но результат отличный.', 'Лучшее место в городе.',
      'Приятная атмосфера и хорошая музыка.', 'Спасибо за внимание к деталям!',
    ];
    // Отзыв всегда привязан к конкретному визиту: иначе непонятно,
    // за что оценка, и клиент может оценить один визит дважды.
    const doneAppts = st.appointments.filter(a => a.companyId === co.id && a.status === 'done');
    const rated = new Set();
    for (let i = 0; i < 20 && doneAppts.length; i++) {
      const a = pick(r, doneAppts);
      if (rated.has(a.id)) continue;
      rated.add(a.id);
      const rec = {
        id: co.id + '_rv' + i, companyId: co.id, apptId: a.id, clientId: a.clientId, employeeId: a.employeeId,
        rating: r() < .85 ? 5 : 4, text: pick(r, TXT),
        createdAt: new Date(new Date(a.start).getTime() + 3 * 3600000).toISOString(),
      };
      st.reviews.push(rec);
      a.reviewId = rec.id;
    }
    // рейтинг мастера — среднее по его отзывам, а не случайное число
    takers.forEach(e => {
      const own = st.reviews.filter(v => v.employeeId === e.id);
      if (own.length) e.rating = (own.reduce((s, v) => s + v.rating, 0) / own.length).toFixed(1);
    });
    const coRv = st.reviews.filter(v => v.companyId === co.id);
    if (coRv.length) {
      const c = st.companies.find(x => x.id === co.id);
      c.rating = +(coRv.reduce((s, v) => s + v.rating, 0) / coRv.length).toFixed(1);
      c.reviewsCount = coRv.length;
    }

    // ---- рассылки ----
    const BC = [
      { title: 'Свободные окна в пятницу', text: 'Освободилось несколько окон на пятницу — успейте записаться!', to: 42, open: 31, booked: 6 },
      { title: 'Скидка 20% на новинки', text: 'Только на этой неделе — 20% на новые услуги.', to: 78, open: 51, booked: 11 },
      { title: 'Мы соскучились', text: 'Вы давно не заходили. Дарим 15% на любую услугу.', to: 24, open: 14, booked: 3 },
    ];
    BC.forEach((b, i) => st.broadcasts.push({
      id: co.id + '_bc' + i, companyId: co.id, ...b, status: 'sent',
      sentAt: new Date(today.getTime() - (i * 9 + 3) * 86400000).toISOString(),
    }));
  });

  buildBackground(st, today);

  // пара системных уведомлений, чтобы раздел не был пустым при первом входе
  st.notices.push(
    {
      id: 'nt_seed1', kind: 'update', title: 'Календарь стал удобнее',
      text: 'Появились режимы «День / Неделя / Месяц», отпуска и больничные на диапазон дат.',
      segment: 'all', to: st.companies.length, sentAt: new Date(today.getTime() - 5 * 86400000).toISOString(),
    },
    {
      id: 'nt_seed2', kind: 'maintenance', title: 'Плановые работы в ночь на воскресенье',
      text: 'С 02:00 до 04:00 сервис может быть недоступен несколько минут.',
      segment: 'active', to: st.companies.filter(c => c.status !== 'blocked').length,
      sentAt: new Date(today.getTime() - 12 * 86400000).toISOString(),
    },
  );
  return st;
}

export const DEMO_COMPANIES = CO.map(c => ({ id: c.id, name: c.name, short: c.short }));
