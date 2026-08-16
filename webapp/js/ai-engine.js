// AI-движок: считает инсайты по реальным данным демо-базы.
// Режим LIVE (если задан ключ) отправляет тот же контекст в модель, DEMO — генерирует локально.
import { S, co, cid, rangeStats, staff, svcs, clients, lostClients, freeGaps, dayAppts, now, today, clientStats, appts } from './store.js';
import { money, nAppt, plural, dateLabel } from './ui.js';
import { toHM } from './store.js';

export const aiIsLive = () => S.aiMode === 'live' && !!localStorage.getItem('zapis.ai.key');

/* ---------------- Отчёт за неделю ---------------- */
export function weeklyReport(companyId = cid()) {
  const s = rangeStats(7, companyId);
  const top = s.byService[0];
  const topEmp = s.byEmployee[0];
  const c = co(companyId);

  // пустые окна за прошедшую неделю
  let bigGap = null;
  for (let d = 1; d <= 6; d++) {
    const date = new Date(today().getTime() - d * 86400000);
    staff(companyId).forEach(e => {
      // интересны «дыры» внутри рабочего дня, а не полностью выходные смены
      if (!dayAppts(date, { employeeId: e.id, companyId }).length) return;
      freeGaps(date, e.id, companyId, 120).forEach(g => {
        const len = g.e - g.s;
        if (!bigGap || len > bigGap.len) bigGap = { date, emp: e, len, s: g.s, e: g.e };
      });
    });
  }

  // спрос на отсутствующую услугу (демо-сигнал из переписок)
  const missing = {
    c1: { name: 'Педикюр', count: 7, price: 9000, duration: 90 },
    c2: { name: 'Окрашивание бороды', count: 5, price: 6000, duration: 40 },
    c3: { name: 'Массаж для двоих', count: 6, price: 45000, duration: 90 },
  }[companyId];

  const lost = lostClients(companyId, 45);

  return {
    period: 'Последние 7 дней',
    revenue: s.revenue, deltaRev: s.deltaRev, count: s.count, deltaCount: s.deltaCount, avg: s.avg,
    newClients: s.newClients, cancelled: s.cancelled,
    good: top ? {
      title: 'Что хорошо',
      text: `«${top.name}» — самая популярная услуга недели: ${nAppt(top.count)} на ${money(top.sum)}.` +
        (topEmp ? ` Лидер по выручке — ${topEmp.name.split(' ')[0]} (${money(topEmp.sum)}).` : ''),
    } : null,
    attention: bigGap ? {
      title: 'На что обратить внимание',
      text: `${bigGap.emp.name.split(' ')[0]}, ${dateLabel(bigGap.date, now()).toLowerCase()} (${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][bigGap.date.getDay()]}) — окно ${toHM(bigGap.s)}–${toHM(bigGap.e)}, это ${Math.round(bigGap.len / 60)} ч простоя. Примерно ${money(Math.round(Math.round(bigGap.len / 60) * (s.avg || 8000) / 1000) * 1000)} упущенной выручки.`,
      action: { t: 'Заполнить окна', a: 'ai.gaps' },
    } : null,
    growth: missing ? {
      title: 'Возможность роста',
      text: `За неделю ${missing.count} ${plural(missing.count, ['клиент спрашивал', 'клиента спрашивали', 'клиентов спрашивали'])}: «Делаете ли вы ${missing.name.toLowerCase()}?». Такой услуги нет в вашем прайсе.`,
      action: { t: 'Добавить услугу', a: 'ai.addService', payload: missing },
    } : null,
    lost: lost.length ? {
      title: 'Клиенты',
      text: `${lost.length} ${plural(lost.length, ['клиент не был', 'клиента не были', 'клиентов не были'])} у вас больше 45 дней. Суммарно они принесли ${money(lost.reduce((x, y) => x + y.st.spent, 0))}.`,
      action: { t: 'Создать рассылку', a: 'ai.return' },
    } : null,
    company: c,
  };
}

/* ---------------- Свободные окна ---------------- */
export function gapsFor(date, companyId = cid()) {
  const out = [];
  staff(companyId).forEach(e => {
    freeGaps(date, e.id, companyId, 60).forEach(g => out.push({ emp: e, s: g.s, e: g.e, len: g.e - g.s }));
  });
  return out.sort((a, b) => a.s - b.s);
}

export function gapCandidates(companyId = cid(), limit = 24) {
  const n = now();
  return clients(companyId).map(c => ({ c, st: clientStats(c.id) }))
    .filter(x => x.st.visits > 0 && !x.st.next)
    .sort((a, b) => new Date(b.st.last.start) - new Date(a.st.last.start))
    .slice(0, limit);
}

export function gapText(date, gaps, companyId = cid()) {
  const c = co(companyId);
  const times = gaps.slice(0, 3).map(g => toHM(g.s)).join(', ');
  return `Привет! Это ${c.short} ✨\n\nУ нас освободились окна на ${dateLabel(date, now()).toLowerCase()}: ${times}.\n\nЕсли хотите привести себя в порядок — записывайтесь в один клик, места быстро разбирают 💫`;
}

/* ---------------- Возврат клиентов ---------------- */
export function returnText(companyId = cid()) {
  const c = co(companyId);
  return `${c.short} скучает по вам 🤍\n\nВы давно не заглядывали. Дарим 15% на любую услугу при записи на этой неделе.\n\nЗабронировать время — пара секунд.`;
}

/* ---------------- Генератор сторис ---------------- */
const TOPICS = {
  gaps: 'Свободные окна завтра',
  service: 'Новая услуга',
  promo: 'Акция',
  back: 'Возвращаем клиентов',
  custom: 'Своя тема',
};
export function storyVariants(topic, custom = '', companyId = cid()) {
  const c = co(companyId);
  const s = rangeStats(30, companyId);
  const top = s.byService[0] ? s.byService[0].name : svcs(companyId)[0].name;
  const V = {
    gaps: [
      `⏰ Завтра есть окошки!\n\n${c.short} ждёт вас: 12:00 · 14:30 · 17:00\n\nЗапись в 2 клика по кнопке ниже 👇`,
      `Кто хотел «на завтра»? 🙌\n\nОсвободилось несколько мест. ${top} — и день заиграет по-другому.\n\nСвайп вверх, чтобы занять время.`,
      `Свободные окна на завтра ✨\n12:00 / 14:30 / 17:00\n\nПишите время в директ или записывайтесь сами по ссылке.`,
    ],
    service: [
      `🆕 Новинка в ${c.short}\n\nМы добавили новую услугу — попробуйте первыми. Первым 10 клиентам приятный бонус.\n\nЗапись по кнопке.`,
      `Мы услышали вас 💛\n\nВы часто спрашивали — и теперь это есть в нашем прайсе. Ждём вас!`,
      `Новая услуга уже в расписании ✨ Успейте записаться на удобное время — мест немного.`,
    ],
    promo: [
      `🔥 −20% на ${top.toLowerCase()}\n\nТолько до конца недели. Количество мест ограничено.\n\nЗапись — по кнопке ниже.`,
      `Акция недели в ${c.short} 💫\n\n${top} со скидкой. Идеальный повод обновить образ.`,
      `Скидка выходного дня 🎁\nЗаписывайтесь на любое свободное время — цена приятно удивит.`,
    ],
    back: [
      `Мы соскучились 🤍\n\nДавно вас не видели. Дарим 15% на любую услугу — просто запишитесь на этой неделе.`,
      `Помните, как было хорошо? 😊\n\nВозвращайтесь — ваш мастер уже ждёт. Бонус за возвращение внутри.`,
      `Ваше место всё ещё за вами ✨ Запишитесь на этой неделе и получите приятный подарок.`,
    ],
  };
  if (topic === 'custom') {
    const t = custom || 'наше предложение';
    return [
      `✨ ${t}\n\n${c.short} · ${c.city}\nЗапись в один клик по кнопке ниже.`,
      `${t} 💫\n\nМы приготовили для вас кое-что приятное. Успейте занять время!`,
      `Тема дня: ${t}\n\nПодробности — в директ, запись — по ссылке в профиле.`,
    ];
  }
  return V[topic] || V.promo;
}
export const STORY_TOPICS = TOPICS;

/* ---------------- Голосовая заметка ---------------- */
const DEMO_VOICE = [
  {
    text: 'Анна предпочитает нюдовые оттенки, у неё чувствительная кожа, и в следующий раз хочет французский маникюр.',
    ai: { prefs: ['Нюдовые оттенки'], care: ['Чувствительная кожа'], next: ['Хочет французский маникюр'] },
  },
  {
    text: 'Клиент любит короткую длину, приходит раз в три недели, просил напоминать за день.',
    ai: { prefs: ['Короткая длина', 'Визит раз в 3 недели'], care: ['Напоминать за день'], next: [] },
  },
  {
    text: 'Аллергия на аммиак, красим только безаммиачной краской. Хочет попробовать тёплый блонд весной.',
    ai: { prefs: ['Безаммиачная краска'], care: ['Аллергия на аммиак'], next: ['Тёплый блонд'] },
  },
];
export const demoVoice = i => DEMO_VOICE[i % DEMO_VOICE.length];

export function parseNote(text) {
  const t = (text || '').toLowerCase();
  const prefs = [], care = [], next = [];
  const map = [
    [/нюд/, prefs, 'Нюдовые оттенки'], [/француз/, next, 'Хочет французский маникюр'],
    [/чувствительн/, care, 'Чувствительная кожа'], [/аллерг\w*\s+на\s+([а-яё]+)/, care, m => 'Аллергия на ' + m[1]],
    [/коротк/, prefs, 'Короткая длина'], [/длинн/, prefs, 'Длинные ногти'],
    [/блонд/, next, 'Интересует блонд'], [/каре/, next, 'Хочет каре'],
    [/красн|ярк/, prefs, 'Яркие цвета'], [/спокойн|пастель/, prefs, 'Пастельные тона'],
    [/опазд/, care, 'Часто опаздывает'], [/вовремя|пунктуал/, care, 'Всегда приходит вовремя'],
    [/напомин/, care, 'Просит напоминание заранее'], [/кофе/, prefs, 'Любит кофе без сахара'],
    [/бород/, prefs, 'Уход за бородой'], [/масса?ж/, next, 'Интересуется массажем'],
    [/беремен/, care, 'Беременность — щадящий уход'], [/сух/, care, 'Сухая кожа/кончики'],
  ];
  map.forEach(([re, bucket, val]) => {
    const m = t.match(re);
    if (m) bucket.push(typeof val === 'function' ? val(m) : val);
  });
  if (!prefs.length && !care.length && !next.length) {
    const s = (text || '').trim();
    if (s) prefs.push(s.length > 90 ? s.slice(0, 90) + '…' : s);
  }
  return { prefs, care, next, updated: now().toISOString() };
}

/* ---------------- Чат ---------------- */
export const QUICK_PROMPTS = [
  'Почему стало меньше записей?',
  'Какая услуга самая прибыльная?',
  'Кого можно вернуть?',
  'Как заполнить завтра?',
  'Сколько я заработал за месяц?',
];

export function chatAnswer(q, companyId = cid()) {
  const t = q.toLowerCase();
  const s7 = rangeStats(7, companyId), s30 = rangeStats(30, companyId);
  const c = co(companyId);

  if (/прибыль|выгодн|доходн|прибыльн/.test(t)) {
    const top = s30.byService.slice(0, 3);
    return `За 30 дней самые прибыльные услуги:\n\n` +
      top.map((x, i) => `${i + 1}. ${x.name} — ${money(x.sum)} (${nAppt(x.count)})`).join('\n') +
      `\n\nСредний чек по салону — ${money(s30.avg)}. Если поднять цену «${top[0] ? top[0].name : ''}» на 10%, при той же загрузке это даст +${money(Math.round((top[0] ? top[0].sum : 0) * 0.1))} в месяц.`;
  }
  if (/меньше запис|падени|снизил|упал/.test(t)) {
    const dir = s7.deltaCount >= 0 ? 'больше' : 'меньше';
    return `За последние 7 дней записей стало ${dir} на ${Math.abs(s7.deltaCount)}, чем неделей раньше (${s7.count} против ${s7.count - s7.deltaCount}).\n\n` +
      `Отмен за период: ${s7.cancelled}. Новых клиентов: ${s7.newClients}.\n\n` +
      `Основная причина — незаполненные окна в будние дни. Загрузка мастеров ≈ ${s7.load}%. Быстрое решение: рассылка по клиентам, которые давно не были.`;
  }
  if (/верн|давно не бы|потерял/.test(t)) {
    const l = lostClients(companyId, 45).slice(0, 5);
    if (!l.length) return 'Отличная новость: клиентов, которые давно не возвращались, сейчас нет.';
    return `Нашёл ${l.length}+ клиентов, которые не были больше 45 дней:\n\n` +
      l.map(x => `• ${x.c.name} — ${x.st.visits} визитов, ${money(x.st.spent)}`).join('\n') +
      `\n\nМогу подготовить для них рассылку с бонусом за возвращение.`;
  }
  if (/завтра|окн|заполн|свободн/.test(t)) {
    const d = new Date(today().getTime() + 86400000);
    const g = gapsFor(d, companyId);
    if (!g.length) return 'Завтра свободных окон почти нет — расписание плотное. Отличная работа!';
    return `Завтра свободно ${g.length} ${plural(g.length, ['окно', 'окна', 'окон'])}:\n\n` +
      g.slice(0, 5).map(x => `• ${toHM(x.s)}–${toHM(x.e)} · ${x.emp.name.split(' ')[0]}`).join('\n') +
      `\n\nЕсть ${gapCandidates(companyId).length} клиентов, которым может подойти это время. Запустить рассылку?`;
  }
  if (/заработ|выручк|доход|сколько.*месяц/.test(t)) {
    return `За 30 дней:\n\n• Выручка — ${money(s30.revenue)}\n• Записей — ${s30.count}\n• Средний чек — ${money(s30.avg)}\n• Расходы — ${money(s30.expenses)}\n• Чистая прибыль — ${money(s30.profit)}\n\nК предыдущему месяцу выручка ${s30.deltaRev >= 0 ? 'выросла' : 'снизилась'} на ${Math.abs(s30.deltaRev)}%.`;
  }
  if (/клиент|сколько.*клиент|база/.test(t)) {
    return `В базе ${clients(companyId).length} клиентов. За 30 дней пришло ${s30.newClients} новых, повторно вернулись ${s30.repeat}.\n\nДоля повторных визитов — ключевая метрика: у вас ${Math.round(s30.repeat / Math.max(1, s30.count) * 100)}%.`;
  }
  if (/сотрудник|мастер|команд|загруз/.test(t)) {
    return `Загрузка команды за 30 дней:\n\n` + s30.byEmployee.map(e => `• ${e.name.split(' ')[0]} — ${nAppt(e.count)}, ${money(e.sum)}`).join('\n') +
      `\n\nСамый загруженный мастер приносит ${Math.round((s30.byEmployee[0] ? s30.byEmployee[0].sum : 0) / Math.max(1, s30.revenue) * 100)}% выручки.`;
  }
  if (/цен|подня|дорог|дешев/.test(t)) {
    return `Средний чек — ${money(s30.avg)}. При загрузке ${s30.load}% поднимать цены безопасно на топовые услуги: спрос на них стабильный.\n\nРекомендую +10% на «${s30.byService[0] ? s30.byService[0].name : 'популярную услугу'}» и оставить цены на входные услуги — они приводят новых клиентов.`;
  }
  return `Смотрю данные ${c.name}.\n\nЗа 30 дней: ${s30.count} записей, выручка ${money(s30.revenue)}, средний чек ${money(s30.avg)}.\n\nМогу разобрать: загрузку мастеров, самые прибыльные услуги, клиентов для возврата или как заполнить ближайшие свободные окна — просто спросите.`;
}

/* ---------------- LIVE-режим ---------------- */
export async function askLive(prompt, system) {
  const key = localStorage.getItem('zapis.ai.key');
  const url = localStorage.getItem('zapis.ai.url') || 'https://api.anthropic.com/v1/messages';
  if (!key) throw new Error('no key');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: localStorage.getItem('zapis.ai.model') || 'claude-sonnet-5',
      max_tokens: 900, system: system || 'Ты — AI-ассистент салона. Отвечай коротко и по делу, на русском.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('AI ' + r.status);
  const j = await r.json();
  return (j.content || []).map(c => c.text).join('\n');
}

export function contextFor(companyId = cid()) {
  const s = rangeStats(30, companyId);
  const c = co(companyId);
  return `Компания: ${c.name} (${c.cat}, ${c.city}).\nЗа 30 дней: записей ${s.count}, выручка ${s.revenue}, средний чек ${s.avg}, новых клиентов ${s.newClients}, отмен ${s.cancelled}.\nУслуги-лидеры: ${s.byService.slice(0, 5).map(x => x.name + ' (' + x.count + ')').join(', ')}.\nМастера: ${s.byEmployee.map(x => x.name + ' — ' + x.count).join(', ')}.`;
}
