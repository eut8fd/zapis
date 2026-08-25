import {
  S, co, cid, emp, staff, svcs, client, clients, now, today, rangeStats, lostClients, clientStats,
  emit, toHM, addBroadcast,
} from '../store.js';
import {
  demoNote, esc, money, moneyShort, hhmm, dateLabel, relPast, avatar, emptyState, sheet, toast, wait,
  loadingBlock, nAppt, nVisit, plural, addDays, dayKey, WD, confirmSheet, promptSheet, progress,
} from '../ui.js';
import { icon } from '../icons.js';
import { route, go, render } from '../router.js';
import { on } from '../bus.js';
import { addServiceSheet, voiceNoteSheet } from '../flows.js';
import { broadcastFlow } from './more.js';
import { haptic, copy } from '../tg.js';
import {
  weeklyReport, gapsFor, gapCandidates, gapText, returnText, storyVariants, STORY_TOPICS,
  QUICK_PROMPTS, chatAnswer, aiIsLive, askLive, contextFor,
} from '../ai-engine.js';

const rr = () => render(false);

/* =========================================================
   AI — главная
   ========================================================= */
const CARDS = [
  ['ai.report', 'chart', 'Анализ недели', 'Что происходило в бизнесе'],
  ['ai.gaps', 'clock', 'Свободные окна', 'Как заполнить расписание'],
  ['ai.return', 'users', 'Клиенты', 'Кого стоит вернуть'],
  ['ai.stories', 'image', 'Продвижение', 'Создать текст для сторис'],
  ['ai.voice', 'mic', 'Голосовая заметка', 'Запомнить информацию о клиенте'],
];

route('ai.home', {
  perm: 'analytics',
  tab: 'o.more',
  render() {
    const s7 = rangeStats(7);
    const lost = lostClients(cid(), 45);
    const gaps = gapsFor(addDays(today(), 1));
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button><div class="grow"></div>
      <span class="bdg ai">${aiIsLive() ? 'LIVE' : 'DEMO'}</span></div>
    <div class="wrap">
      <div class="ai-hero">
        <div style="width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.2);display:grid;place-items:center">${icon('sparkles', 24)}</div>
        <div class="t">AI-помощник</div>
        <div class="s">Анализирует клиентов, находит точки роста и пишет тексты за вас.</div>
      </div>
    </div>

    <div class="wrap sec">
      <button class="card press" style="width:100%;padding:14px;text-align:left;display:flex;gap:12px;align-items:center;border-color:var(--ai-soft)" data-a="nav" data-r="ai.chat">
        <div class="tint" style="background:var(--ai-soft);color:var(--ai);width:42px;height:42px">${icon('msg', 20)}</div>
        <div class="grow"><div class="b sm">Спросить о бизнесе</div>
          <div class="tiny muted">«Почему стало меньше записей?»</div></div>
        ${icon('fwd', 18)}
      </button>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Что я умею</div></div>
      <div class="wrap stack s">
        ${CARDS.map(c => `<button class="ai-card" style="width:100%;text-align:left" data-a="${c[0].startsWith('ai.voice') ? 'ai.voicePick' : 'nav'}" data-r="${c[0]}">
          <div class="ic">${icon(c[1], 19)}</div>
          <div class="grow"><div class="b sm">${c[2]}</div><div class="tiny muted" style="margin-top:2px">${c[3]}</div></div>
          ${icon('fwd', 16)}
        </button>`).join('')}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><div class="sec-t">Инсайты сейчас</div></div>
      <div class="wrap stack s">
        <div class="ins ${s7.deltaRev >= 0 ? 'good' : 'warn'}">
          <div class="h">${icon(s7.deltaRev >= 0 ? 'trendUp' : 'trendDown', 15)}Выручка ${s7.deltaRev >= 0 ? 'выросла' : 'снизилась'} на ${Math.abs(s7.deltaRev)}%</div>
          <div class="b">За 7 дней — <b>${money(s7.revenue)}</b>, ${nAppt(s7.count)}, средний чек <b>${money(s7.avg)}</b>.</div>
          <button class="btn xs gh" style="margin-top:10px" data-a="nav" data-r="ai.report">Подробнее</button>
        </div>
        ${gaps.length ? `<div class="ins warn">
          <div class="h">${icon('clock', 15)}Завтра ${gaps.length} свободных ${plural(gaps.length, ['окно', 'окна', 'окон'])}</div>
          <div class="b">${gaps.slice(0, 3).map(g => toHM(g.s) + '–' + toHM(g.e) + ' · ' + esc(g.emp.name.split(' ')[0])).join('<br>')}</div>
          <button class="btn xs p" style="margin-top:10px" data-a="nav" data-r="ai.gaps">Заполнить окна</button>
        </div>` : ''}
        ${lost.length ? `<div class="ins opp">
          <div class="h">${icon('users', 15)}${lost.length} ${plural(lost.length, ['клиент не возвращался', 'клиента не возвращались', 'клиентов не возвращались'])} 45+ дней</div>
          <div class="b">Суммарно они принесли <b>${money(lost.reduce((s, x) => s + x.st.spent, 0))}</b>. Их можно вернуть одной рассылкой.</div>
          <button class="btn xs p" style="margin-top:10px" data-a="nav" data-r="ai.return">Создать рассылку</button>
        </div>` : ''}
      </div>
    </div>`;
  },
});

on('ai.voicePick', () => {
  const list = clients().slice(0, 30);
  const s = sheet({
    title: 'О ком заметка?',
    body: `<div class="stack s">${list.map(c => `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="ai.voiceGo" data-id="${c.id}">
      ${avatar(c, 's')}<div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
      <div class="st">${c.ai ? 'есть AI-заметки' : 'нет заметок'}</div></div>${icon('mic', 18)}</button>`).join('')}</div>`,
  });
  window.__vp = s;
});
on('ai.voiceGo', ds => { window.__vp.close(); setTimeout(() => voiceNoteSheet(ds.id), 280); });

/* =========================================================
   Отчёт за неделю
   ========================================================= */
route('ai.report', {
  tab: 'o.more',
  render() {
    const r = weeklyReport();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Итоги недели</div><div class="top-sub">${r.period}</div></div>
      <span class="bdg ai">${icon('sparkles', 11, 2.4)} AI</span></div>

    <div class="wrap"><div class="card pad">
      <div class="grid3">
        <div><div class="tiny muted b">ВЫРУЧКА</div>
          <div style="font-size:19px;font-weight:750;letter-spacing:-.03em;margin-top:2px">${moneyShort(r.revenue)} ₸</div>
          <div class="tiny ${r.deltaRev >= 0 ? 'up' : 'down'}">${r.deltaRev >= 0 ? '↑' : '↓'} ${Math.abs(r.deltaRev)}%</div></div>
        <div><div class="tiny muted b">ЗАПИСЕЙ</div>
          <div style="font-size:19px;font-weight:750;letter-spacing:-.03em;margin-top:2px">${r.count}</div>
          <div class="tiny ${r.deltaCount >= 0 ? 'up' : 'down'}">${r.deltaCount >= 0 ? '+' : ''}${r.deltaCount}</div></div>
        <div><div class="tiny muted b">СРЕДНИЙ ЧЕК</div>
          <div style="font-size:19px;font-weight:750;letter-spacing:-.03em;margin-top:2px">${moneyShort(r.avg)} ₸</div>
          <div class="tiny dim">за визит</div></div>
      </div>
    </div></div>

    <div class="wrap sec stack">
      ${r.good ? ins('good', 'checkCircle', r.good) : ''}
      ${r.attention ? ins('warn', 'alert', r.attention) : ''}
      ${r.growth ? ins('opp', 'zap', r.growth) : ''}
      ${r.lost ? ins('opp', 'users', r.lost) : ''}
    </div>

    <div class="wrap sec">
      <button class="btn ai" data-a="ai.regen">${icon('refresh', 18)}Обновить анализ</button>
    </div>
    <div class="wrap sec"><div class="tiny dim center">Отчёт построен по реальным данным вашей демо-базы за последние 7 дней</div></div>`;
  },
});
function ins(cls, ic, o) {
  return `<div class="ins ${cls}">
    <div class="h">${icon(ic, 15)}${esc(o.title)}</div>
    <div class="b">${esc(o.text)}</div>
    ${o.action ? `<button class="btn xs p" style="margin-top:11px" data-a="${o.action.a === 'ai.gaps' || o.action.a === 'ai.return' ? 'nav' : o.action.a}" data-r="${o.action.a}" ${o.action.payload ? `data-name="${esc(o.action.payload.name)}" data-price="${o.action.payload.price}" data-dur="${o.action.payload.duration}"` : ''}>${esc(o.action.t)}</button>` : ''}
  </div>`;
}
on('ai.addService', ds => addServiceSheet({ name: ds.name, price: ds.price, duration: ds.dur }));
on('ai.regen', async () => {
  const s = sheet({ title: 'AI', body: loadingBlock('Пересчитываю показатели…') });
  await wait(1300); s.close(); rr(); toast('Анализ обновлён', 'ai');
});

/* =========================================================
   Заполнить свободные окна
   ========================================================= */
const gapSt = { date: null, sent: null };
route('ai.gaps', {
  tab: 'o.more',
  render() {
    if (!gapSt.date) gapSt.date = addDays(today(), 1);
    const d = gapSt.date;
    const gaps = gapsFor(d);
    const cands = gapCandidates();
    if (gapSt.sent) return sentView();
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Свободные окна</div><div class="top-sub">${dateLabel(d, now())}</div></div>
      <span class="bdg ai">${icon('sparkles', 11, 2.4)} AI</span></div>

    <div class="chips" style="margin-bottom:14px">
      ${[0, 1, 2, 3, 4].map(i => { const x = addDays(today(), i); return `<button class="chip p ${dayKey(x) === dayKey(d) ? 'on' : ''}" data-a="gp.date" data-d="${x.getTime()}">${i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[x.getDay()] + ' ' + x.getDate()}</button>`; }).join('')}
    </div>

    ${gaps.length ? `
      <div class="wrap"><div class="ins warn">
        <div class="h">${icon('clock', 15)}${dateLabel(d, now())} свободно ${gaps.length} ${plural(gaps.length, ['окно', 'окна', 'окон'])}</div>
        <div class="b">${gaps.map(g => `<b>${toHM(g.s)}–${toHM(g.e)}</b> · ${esc(g.emp.name.split(' ')[0])}`).join('<br>')}</div>
      </div></div>

      <div class="wrap sec"><div class="card pad">
        <div class="row" style="gap:8px;margin-bottom:8px">${icon('users', 16)}<b class="sm">Кому предложить</b></div>
        <div class="sm muted">У вас ${cands.length} ${plural(cands.length, ['клиент', 'клиента', 'клиентов'])} без будущей записи — им потенциально подойдёт это время.</div>
        <div class="row" style="gap:-8px;margin-top:10px">
          ${cands.slice(0, 7).map((x, i) => `<div class="av s" style="background:${x.c.color};margin-left:${i ? -10 : 0}px;border:2px solid var(--sf)">${esc(x.c.initials)}</div>`).join('')}
          ${cands.length > 7 ? `<div class="av s" style="background:var(--sf-3);color:var(--tx-2);margin-left:-10px;border:2px solid var(--sf)">+${cands.length - 7}</div>` : ''}
        </div>
      </div></div>

      <div class="wrap sec">
        <div class="sec-t" style="margin-bottom:8px">Предлагаемый текст</div>
        <div class="card pad">
          <div class="sm" style="white-space:pre-wrap;line-height:1.55" id="_gt">${esc(gapText(d, gaps))}</div>
          <div class="row" style="gap:8px;margin-top:12px">
            <button class="btn xs gh" data-a="gp.edit">${icon('pencil', 14)}Изменить</button>
            <button class="btn xs gh" data-a="gp.regen">${icon('refresh', 14)}Другой вариант</button>
          </div>
        </div>
      </div>

      <div class="wrap sec"><div class="btns">
        <button class="btn gh" data-a="gp.test">Отправить тест</button>
        <button class="btn ai" data-a="gp.send" data-n="${cands.length}">${icon('send', 17)}Запустить</button>
      </div></div>`
      : `<div class="wrap">${emptyState({ ic: 'checkCircle', title: 'Свободных окон нет', text: 'Расписание на этот день заполнено. Отличная работа!' })}</div>`}`;
  },
});
function sentView() {
  const r = gapSt.sent;
  return `<div class="top"><button class="ico-btn" data-a="gp.reset">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Рассылка отправлена</div></div></div>
    <div class="succ">
      <div class="check">${icon('check', 44, 3)}</div>
      <div class="t">Отправлено</div>
      <div class="s">${r.to} ${plural(r.to, ['клиенту', 'клиентам', 'клиентам'])}</div>
    </div>
    <div class="wrap"><div class="grid3">
      <div class="st-card center"><div class="v">${r.to}</div><div class="l">получили</div></div>
      <div class="st-card center"><div class="v">${r.open}</div><div class="l">перешли</div></div>
      <div class="st-card center"><div class="v" style="color:var(--ok)">${r.booked}</div><div class="l">записались</div></div>
    </div></div>
    <div class="wrap sec"><div class="ins good">
      <div class="h">${icon('trendUp', 15)}Окна заполняются</div>
      <div class="b">Из ${r.to} получателей ${r.open} открыли сообщение, ${r.booked} уже записались. Это ≈ <b>${money(r.booked * 9000)}</b> дополнительной выручки.</div>
    </div></div>
    <div class="wrap sec"><div class="btns">
      <button class="btn gh" data-a="gp.reset">Ещё раз</button>
      <button class="btn p" data-a="tab" data-r="o.cal">Открыть календарь</button>
    </div></div>`;
}
on('gp.date', ds => { gapSt.date = new Date(+ds.d); rr(); });
on('gp.edit', async () => {
  const cur = document.querySelector('#_gt').textContent;
  const v = await promptSheet({ title: 'Текст рассылки', label: 'Сообщение', value: cur, multiline: true });
  if (v) { document.querySelector('#_gt').textContent = v; toast('Текст обновлён'); }
});
on('gp.regen', async () => {
  const el = document.querySelector('#_gt');
  const old = el.textContent;
  el.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  await wait(900);
  const v = storyVariants('gaps');
  el.textContent = v[Math.floor(Math.random() * v.length)];
  haptic('success');
});
on('gp.test', () => demoNote('Тестовая отправка', 'В демо-версии сообщения не уходят в Telegram по-настоящему — рассылка симулируется, чтобы показать весь сценарий целиком.', 'В рабочей версии тест приходит вам в личные сообщения от бота.'));
on('gp.send', async ds => {
  const n = +ds.n;
  const s = sheet({ title: 'Рассылка', body: loadingBlock('Отправляем ' + n + ' сообщений…') });
  await wait(1700);
  const open = Math.max(1, Math.round(n * 0.6));
  const booked = Math.max(1, Math.round(open * 0.18));
  gapSt.sent = { to: n, open, booked };
  addBroadcast({ title: 'Свободные окна ' + dateLabel(gapSt.date, now()).toLowerCase(), text: document.querySelector('#_gt') ? document.querySelector('#_gt').textContent : '', to: n, open, booked });
  s.close(); rr(); haptic('success');
});
on('gp.reset', () => { gapSt.sent = null; rr(); });

/* =========================================================
   Вернуть клиентов
   ========================================================= */
route('ai.return', {
  tab: 'o.more',
  render() {
    const lost = lostClients(cid(), 45);
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Кого вернуть</div><div class="top-sub">${lost.length} ${plural(lost.length, ['клиент', 'клиента', 'клиентов'])}</div></div>
      <span class="bdg ai">${icon('sparkles', 11, 2.4)} AI</span></div>
    ${lost.length ? `
      <div class="wrap"><div class="ins opp">
        <div class="h">${icon('users', 15)}Потенциал возврата</div>
        <div class="b">Эти клиенты уже приносили вам <b>${money(lost.reduce((s, x) => s + x.st.spent, 0))}</b>. Даже 20% возврата — это <b>${money(Math.round(lost.reduce((s, x) => s + x.st.avg, 0) * 0.2))}</b> за один визит каждого.</div>
      </div></div>
      <div class="wrap sec"><button class="btn ai" data-a="rt.send">${icon('megaphone', 18)}Создать рассылку для них</button></div>
      <div class="sec">
        <div class="sec-h"><div class="sec-t">Список</div></div>
        <div class="wrap stack s">
          ${lost.slice(0, 25).map(({ c, st }) => `<button class="lrow press" style="border-radius:16px;border:1px solid var(--bd);width:100%" data-a="nav" data-r="o.client" data-id="${c.id}">
            ${avatar(c, 'm')}
            <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
              <div class="st">${nVisit(st.visits)} · ${moneyShort(st.spent)} ₸</div>
              <div class="tiny" style="color:var(--warn);font-weight:650;margin-top:2px">был ${relPast(new Date(st.last.start), now())}</div></div>
            <span class="chev">${icon('fwd', 18, 2)}</span></button>`).join('')}
        </div>
      </div>`
      : `<div class="wrap">${emptyState({ ic: 'checkCircle', title: 'Все клиенты с вами', text: 'Никто не пропадал больше чем на 45 дней.' })}</div>`}`;
  },
});
on('rt.send', () => broadcastFlow({ aud: 'lost', title: 'Возвращаем клиентов', text: returnText() }));

/* =========================================================
   Генератор сторис
   ========================================================= */
const stSt = { topic: null, custom: '', variants: null, loading: false };
route('ai.stories', {
  tab: 'o.more',
  render() {
    return `
    <div class="top"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">Тексты для сторис</div><div class="top-sub">AI напишет за вас</div></div></div>

    <div class="sec" style="margin-top:0">
      <div class="sec-h"><div class="sec-t">Что рекламируем?</div></div>
      <div class="wrap stack s">
        ${Object.entries(STORY_TOPICS).map(([k, t]) => `<button class="lrow press" style="border-radius:16px;border:1px solid ${stSt.topic === k ? 'var(--ai)' : 'var(--bd)'};width:100%;${stSt.topic === k ? 'background:var(--ai-soft)' : ''}" data-a="st.topic" data-v="${k}">
          <div class="ic" style="background:var(--ai-soft);color:var(--ai)">${icon(['clock', 'zap', 'gift', 'users', 'pencil'][Object.keys(STORY_TOPICS).indexOf(k)], 18)}</div>
          <div class="grow" style="text-align:left"><div class="tl">${t}</div></div>
          ${stSt.topic === k ? `<span style="color:var(--ai)">${icon('checkCircle', 19)}</span>` : icon('fwd', 17)}
        </button>`).join('')}
      </div>
    </div>

    ${stSt.loading ? `<div class="wrap sec">${loadingBlock('Придумываю варианты…')}</div>` : ''}

    ${stSt.variants ? `<div class="sec">
      <div class="sec-h"><div class="sec-t">Варианты</div>
        <button class="sec-a" data-a="st.more">${icon('refresh', 14)} Ещё</button></div>
      <div class="wrap stack s">
        ${stSt.variants.map((v, i) => `<div class="card pad">
          <div class="row between" style="margin-bottom:8px"><span class="bdg ai">Вариант ${i + 1}</span>
            <button class="btn xs gh" data-a="st.copy" data-i="${i}">${icon('copy', 13)}Копировать</button></div>
          <div class="sm" style="white-space:pre-wrap;line-height:1.55">${esc(v)}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}`;
  },
});
on('st.topic', async ds => {
  stSt.topic = ds.v;
  if (ds.v === 'custom') {
    const v = await promptSheet({ title: 'Своя тема', label: 'О чём написать?', placeholder: 'Например, новый мастер в команде' });
    if (!v) { stSt.topic = null; rr(); return; }
    stSt.custom = v;
  }
  stSt.loading = true; stSt.variants = null; rr();
  await wait(1200);
  stSt.variants = storyVariants(stSt.topic, stSt.custom);
  stSt.loading = false; rr(); haptic('success');
});
on('st.more', async () => {
  stSt.loading = true; rr();
  await wait(900);
  const v = storyVariants(stSt.topic, stSt.custom);
  stSt.variants = [...v].sort(() => Math.random() - .5);
  stSt.loading = false; rr();
});
on('st.copy', async ds => { await copy(stSt.variants[+ds.i]); toast('Текст скопирован'); });

/* =========================================================
   AI-чат
   ========================================================= */
route('ai.chat', {
  tab: 'o.more',
  render() {
    const msgs = S.aiChat[cid()] || [];
    return `
    <div class="top blur"><button class="ico-btn" data-a="back">${icon('back', 19)}</button>
      <div class="grow"><div class="top-t">AI-помощник</div><div class="top-sub">${aiIsLive() ? 'LIVE' : 'знает данные вашей компании'}</div></div>
      ${msgs.length ? `<button class="ico-btn" data-a="ch.clear">${icon('trash', 17)}</button>` : ''}</div>

    <div class="wrap" style="display:flex;flex-direction:column;gap:10px;padding-bottom:130px">
      ${!msgs.length ? `<div class="card pad" style="border-color:var(--ai-soft);background:var(--ai-soft)">
        <div class="row" style="gap:8px;color:var(--ai);margin-bottom:6px">${icon('sparkles', 17)}<b class="sm">Спросите о своём бизнесе</b></div>
        <div class="sm" style="color:var(--tx-2);line-height:1.5">Я вижу ваши записи, клиентов, услуги и выручку. Отвечаю по реальным данным.</div>
      </div>` : ''}
      ${msgs.map(m => `<div class="bubble ${m.role}">${m.role === 'ai' ? esc(m.text) : esc(m.text)}</div>`).join('')}
      ${window.__aiThinking ? `<div class="bubble ai"><span class="dots"><i></i><i></i><i></i></span></div>` : ''}
    </div>

    <div class="fixbar" style="bottom:calc(var(--tab-h) + var(--safe-b));background:var(--bg);padding:8px 12px 10px;border-top:1px solid var(--bd)">
      <div class="chips" style="padding:0 0 8px">
        ${QUICK_PROMPTS.map(p => `<button class="chip" data-a="ch.quick" data-q="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <div class="search" style="height:48px">
        <input id="_chat" placeholder="Спросите о своём бизнесе…" data-enter="ch.send">
        <button class="ico-btn p" style="width:34px;height:34px" data-a="ch.send">${icon('send', 16)}</button>
      </div>
    </div>`;
  },
  mount() {
    const box = document.querySelector('.screen');
    if (box) window.scrollTo(0, document.body.scrollHeight);
  },
});
on('ch.quick', ds => sendMsg(ds.q));
on('ch.send', () => { const i = document.querySelector('#_chat'); if (i && i.value.trim()) sendMsg(i.value.trim()); });
on('ch.clear', () => { S.aiChat[cid()] = []; emit(); });

async function sendMsg(text) {
  const key = cid();
  S.aiChat[key] = S.aiChat[key] || [];
  S.aiChat[key].push({ role: 'me', text });
  window.__aiThinking = true;
  emit(); rr();
  setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30);
  let answer;
  if (aiIsLive()) {
    try { answer = await askLive(contextFor() + '\n\nВопрос владельца: ' + text); }
    catch (e) { answer = 'Не удалось получить ответ от модели (' + e.message + '). Переключаюсь на демо-режим.\n\n' + chatAnswer(text); }
  } else {
    await wait(900 + Math.random() * 600);
    answer = chatAnswer(text);
  }
  window.__aiThinking = false;
  S.aiChat[key].push({ role: 'ai', text: answer });
  emit(); rr(); haptic('light');
  setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 40);
}
