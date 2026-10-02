// Общие сценарии: карточка записи, создание записи, блокировка времени,
// добавление клиента/услуги, голосовая AI-заметка.
import {
  S, co, cid, emp, emps, staff, svc, svcs, client, clients, appt, appts, apptTitle, apptColor, apptEnd,
  now, today, slotsFor, slotFree, toMin, toHM, createAppointment, cancelAppointment, completeAppointment,
  moveAppointment, createClient, createService, updateService, addBlock, addAbsence, ABSENCE, clientStats, updateClient,
  nextFreeFor, workDay, workWindow, cats, addCat, addReview, reviewFor, tipSeen, markTip,
  canTouchAppt, bookableStaff, can, setLang, me, apptsInRange, sub, isServer,
} from './store.js';
import { LANGS, lang } from './i18n.js';
import {
  t, sheet, toast, confirmSheet, esc, money, hhmm, dateLabel, dateFull, nMin, avatar, WD, MON_SHORT, dayKey,
  startOfDay, addDays, emptyState, promptSheet, wait, loadingBlock, relPast, plural, monthGrid,
  WD_FULL, slotGroups, wheel, mountWheel, normPhone, prettyPhone,
  pickImage, photoField, IMG_MAX, tipCard,
} from './ui.js';
import { icon, catIcon } from './icons.js';
import { on } from './bus.js';
import { go, current } from './router.js';
import { haptic, openLink, copy, tgUsername, canRequestPhone, requestPhone } from './tg.js';
import { parseNote, demoVoice } from './ai-engine.js';

/* =========================================================
   Контекстная подсказка при первом входе в раздел (§99)
   Показывается ровно один раз; включить заново можно
   в разделе «Обучение».
   ========================================================= */
export function tipOnce(key, { title, text, ic = 'info', delay = 700 } = {}) {
  if (tipSeen(key)) return;
  const from = current().r;
  setTimeout(() => {
    // За время задержки человек мог уйти на другой экран — тогда подсказка
    // догонит его не там, где она про что-то объясняет. Проверяем маршрут,
    // а не только отметку: отметку мог снять сброс подсказок.
    if (tipSeen(key) || current().r !== from) return;
    if (document.querySelector('.tip')) return;      // одна подсказка за раз
    tipCard({ title, text, ic, onClose: () => markTip(key) });
  }, delay);
}

/* =========================================================
   Переключатель языка
   ---------------------------------------------------------
   Язык лежал только в настройках и в профиле. Человек, которому
   приложение открылось на чужом языке, до настроек не доходит —
   он их не находит. Поэтому кнопка стоит в шапке главного экрана,
   рядом с названием: видно сразу, меняется в два касания.

   Класс приходит снаружи: в цветной шапке салона кнопка белая
   поверх фотографии, на обычном экране — обычная.
   ========================================================= */
export function langBtn(cls = '') {
  const cur = LANGS.find(l => l.id === lang()) || LANGS[0];
  return `<button class="ico-btn lang-btn ${cls}" data-a="lang.open" title="${esc(t('Язык'))}">
    ${icon('globe', 16)}<span>${esc(cur.short)}</span>
  </button>`;
}

on('lang.open', () => {
  const s = sheet({
    title: t('Язык'),
    body: `<div class="stack s">
      ${LANGS.map(l => `<button class="lrow press" style="border-radius:16px;border:1.5px solid ${lang() === l.id ? 'var(--p)' : 'var(--bd)'};width:100%;${lang() === l.id ? 'background:var(--p-soft)' : ''}" data-a="lang.set" data-v="${l.id}">
        <div class="ic" style="${lang() === l.id ? 'background:var(--p);color:#fff' : ''}">${esc(l.short)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${esc(l.t)}</div></div>
        ${lang() === l.id ? `<span style="color:var(--p)">${icon('checkCircle', 19)}</span>` : ''}
      </button>`).join('')}
    </div>`,
  });
  window.__lang = s;
});
on('lang.set', ds => {
  // Шторку закрываем до смены языка: setLang перерисовывает экран под ней,
  // и оставшаяся сверху шторка со старыми подписями выглядит как сбой.
  if (window.__lang) { window.__lang.close(); window.__lang = null; }
  setLang(ds.v);
});

/* =========================================================
   Обращение в поддержку платформы
   ---------------------------------------------------------
   Одна шторка на всех: клиент, мастер, владелец пишут об одном и том же —
   «не работает», «как сделать», «хочу вот так». Отличается только то,
   куда уходит готовый текст, — это и передаёт вызывающий.
   ========================================================= */
export const SUPPORT_TOPICS = {
  bug: 'Что-то не работает',
  howto: 'Как сделать',
  feature: 'Пожелание',
  other: 'Другое',
};

export function supportSheet({ title = 'Написать в поддержку', note = '', onSend } = {}) {
  const st = { topic: 'bug' };
  const s = sheet({
    title: t(title),
    body: `<div class="field"><label>${t('Тема')}</label>
        <div class="pick">${Object.entries(SUPPORT_TOPICS).map(([k, v]) =>
      `<button class="o ${k === st.topic ? 'on' : ''}" data-a="sup.topic" data-v="${k}">${t(v)}</button>`).join('')}</div></div>
      <div class="field"><label>${t('Подробности')}</label>
        <textarea class="inp" id="_sup" style="min-height:110px" placeholder="${esc(t('Что происходит и чего вы ждали'))}"></textarea></div>
      ${note ? `<div class="tiny dim" style="padding:0 4px">${t(note)}</div>` : ''}`,
    footer: `<button class="btn p" data-a="sup.send">${icon('send', 18)}${t('Отправить')}</button>`,
    onClose: () => { window.__sup = null; },
  });
  window.__sup = { s, st, onSend };
  return s;
}
on('sup.topic', (ds, el) => {
  const w = window.__sup; if (!w) return;
  w.st.topic = ds.v;
  w.s.el.querySelectorAll('[data-a="sup.topic"]').forEach(o => o.classList.toggle('on', o === el));
});
on('sup.send', () => {
  const w = window.__sup; if (!w) return;
  const text = (w.s.el.querySelector('#_sup').value || '').trim();
  if (!text) { toast(t('Опишите, что случилось'), 'dan'); return; }
  w.onSend({ topic: w.st.topic, subject: SUPPORT_TOPICS[w.st.topic], text });
  window.__sup = null;
  w.s.close();
  toast(t('Обращение отправлено'));
});

/* =========================================================
   Мои данные
   ---------------------------------------------------------
   Одна шторка на все роли: имя и телефон есть и у клиента, и у мастера,
   и у владельца, а раньше поменять их мог только клиент.

   Телефон обязателен и проверяется. До этого пустая строка спокойно
   сохранялась — в базе оставался человек без единого способа с ним
   связаться, и никто об этом не знал. Номер берём из Telegram одним
   нажатием: там он уже подтверждён, и опечатки исключены.
   ========================================================= */
export function myDataSheet({ name = '', phone = '', tg = '', note = '', onSave } = {}) {
  const st = { name, phone };
  const uname = String(tg || tgUsername() || '').replace(/^@/, '');
  const s = sheet({ title: t('Мои данные'), body: '' });

  const capture = () => {
    const n = s.el.querySelector('#_mdn'), p = s.el.querySelector('#_mdp');
    if (n) st.name = n.value;
    if (p) st.phone = p.value;
  };

  const draw = () => {
    const ok = !!normPhone(st.phone);
    s.set({
      title: t('Мои данные'),
      body: `
        ${uname ? `<div class="lrow" style="border-radius:16px;border:1px solid var(--bd);margin-bottom:12px">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('msg', 18)}</div>
          <div class="grow"><div class="tl">@${esc(uname)}</div>
            <div class="st">${t('Из вашего профиля Telegram')}</div></div>
        </div>` : ''}
        <div class="field"><label>${t('Как к вам обращаться?')}</label>
          <input class="inp" id="_mdn" value="${esc(st.name)}" placeholder="${esc(t('Имя'))}"></div>
        <div class="field"><label>${t('Телефон')}</label>
          <input class="inp" id="_mdp" type="tel" inputmode="tel" value="${esc(st.phone)}" placeholder="+7 700 000 00 00">
          ${st.phone && !ok ? `<div class="tiny" style="color:var(--dan);margin-top:6px;padding:0 4px">${t('Проверьте номер: нужны все цифры')}</div>` : ''}
        </div>
        ${canRequestPhone() ? `<button class="btn gh sm" data-a="md.tg" style="margin-bottom:12px">${icon('phone', 16)}${t('Взять телефон из Telegram')}</button>` : ''}
        ${note ? `<div class="tiny dim" style="padding:0 4px">${t(note)}</div>` : ''}`,
      footer: `<button class="btn p" data-a="md.ok">${t('Сохранить')}</button>`,
    });
  };

  on('md.tg', async () => {
    capture();
    const v = await requestPhone();
    if (!v) { toast(t('Telegram не дал номер — введите вручную'), 'dan'); return; }
    st.phone = prettyPhone(v);
    draw();
    toast(t('Телефон получен'));
  });
  on('md.ok', () => {
    capture();
    const nm = (st.name || '').trim();
    if (!nm) { toast(t('Введите имя'), 'dan'); return; }
    const ph = normPhone(st.phone);
    if (!ph) { toast(t('Введите телефон — по нему с вами свяжутся'), 'dan'); return; }
    s.close();
    onSave({ name: nm, phone: prettyPhone(ph) });
    toast(t('Сохранено'));
  });

  draw();
  setTimeout(() => { const i = s.el.querySelector('#_mdn'); if (i) i.focus(); }, 240);
  return s;
}

/* =========================================================
   Карточка записи
   ========================================================= */
export function openApptSheet(id) {
  const a = appt(id); if (!a) return;
  const c = client(a.clientId), e = emp(a.employeeId);
  const st = new Date(a.start), en = apptEnd(a);
  const isPast = en < now();
  const S_ = { planned: ['p', 'Запланирована'], done: ['ok', 'Выполнена'], cancelled: ['dan', 'Отменена'] }[a.status];
  const ai = c && c.ai;
  // Оценку видит только владелец. Мастер открывает ту же карточку записи,
  // и без этой проверки он читал бы отзыв о себе прямо здесь — мимо
  // закрытого для него раздела «Отзывы».
  const review = a.status === 'done' && can('reviews') ? reviewFor(a.id) : null;
  const reviewBlock = a.status === 'done' && can('reviews') ? (review ? `
    <div class="appt-review received">
      <div class="appt-review-head">
        <div class="appt-review-icon">${icon('star', 18, 2)}</div>
        <div class="grow"><b>Отзыв получен</b><span>${review.rating} из 5${review.createdAt ? ' · ' + relPast(new Date(review.createdAt), now()) : ''}</span></div>
        <div class="appt-review-stars" aria-label="Оценка ${review.rating} из 5">
          ${Array.from({ length: 5 }, (_, i) => `<i class="${i < review.rating ? 'on' : ''}">${icon('star', 14, 2)}</i>`).join('')}
        </div>
      </div>
      ${review.text ? `<div class="appt-review-text">«${esc(review.text)}»</div>` : ''}
    </div>` : `
    <div class="appt-review pending">
      <div class="appt-review-icon">${icon('star', 18, 2)}</div>
      <div class="grow"><b>Отзыв пока не оставлен</b><span>Клиент ещё не оценил этот визит</span></div>
    </div>`) : '';

  const body = `
    <div class="row appt-person">
      ${avatar(c, 'l')}
      <div class="grow">
        <div class="appt-person-name">${esc(c ? c.name : 'Клиент')}</div>
        <div class="sm muted">${esc(c && c.phone || '')}</div>
      </div>
      <span class="bdg ${S_[0]}">${S_[1]}</span>
    </div>

    <div class="appt-info">
      <div class="appt-info-row"><span>Когда</span><b>${dateLabel(st, now())}, ${hhmm(st)}–${hhmm(en)}</b></div>
      <div class="appt-info-row"><span>Длительность</span><b>${nMin(a.duration)}</b></div>
      <div class="appt-info-row"><span>Услуга</span><b>${esc(apptTitle(a))}</b></div>
      <div class="appt-info-row"><span>Мастер</span><b>${esc(e ? e.name : '—')}</b></div>
      <div class="appt-info-row total"><span>Стоимость</span><b>${money(a.price)}</b></div>
    </div>

    ${reviewBlock}

    ${a.note ? `<div class="card flat" style="padding:12px 14px;margin-bottom:12px">
      <div class="tiny muted b" style="margin-bottom:3px">Заметка к записи</div>
      <div class="sm">${esc(a.note)}</div></div>` : ''}

    ${ai && (ai.prefs.length || ai.care.length || ai.next.length) ? `
    <div class="card" style="padding:13px 14px;margin-bottom:12px;border-color:var(--ai-soft);background:var(--ai-soft)">
      <div class="row" style="gap:7px;margin-bottom:6px;color:var(--ai)">${icon('sparkles', 16)}<b class="sm">AI-шпаргалка по клиенту</b></div>
      <div class="sm" style="line-height:1.6">
        ${ai.prefs.map(x => '• ' + esc(x)).join('<br>')}
        ${ai.care.length ? (ai.prefs.length ? '<br>' : '') + ai.care.map(x => '• ' + esc(x)).join('<br>') : ''}
        ${ai.next.length ? '<br>' + ai.next.map(x => '• ' + esc(x)).join('<br>') : ''}
      </div>
    </div>` : ''}

    <div class="acts appt-actions">
      <button class="act" data-a="ap.call" data-id="${a.id}">${icon('phone', 20)}Позвонить</button>
      <button class="act" data-a="ap.msg" data-id="${a.id}">${icon('msg', 20)}Написать</button>
      <button class="act" data-a="ap.open" data-id="${a.id}">${icon('user', 20)}Клиент</button>
      ${a.status === 'planned' && canTouchAppt(a) ? `<button class="act" data-a="ap.cancel" data-id="${a.id}" style="color:var(--dan)">${icon('xCircle', 20)}Отменить</button>` : ''}
    </div>`;

  // Чужая запись: мастер её видит — она стоит в общем календаре, — но
  // ничего с ней сделать не может. Кнопки не прячем молча, а заменяем
  // объяснением: иначе выглядит как поломка.
  const mayEdit = canTouchAppt(a);
  const footer = !mayEdit
    ? `<div class="card pad row" style="gap:10px;background:var(--sf-2);border-color:transparent">
         <span style="color:var(--tx-3)">${icon('lock', 18)}</span>
         <div class="sm" style="color:var(--tx-2)">Это запись другого мастера. Перенести или отменить её может он сам, администратор или владелец.</div>
       </div>`
    : a.status === 'planned'
      ? `<div class="btns">
           <button class="btn gh" data-a="ap.move" data-id="${a.id}">${icon('history', 18)}Перенести</button>
           <button class="btn ${isPast ? 'ok' : 'p'}" data-a="ap.done" data-id="${a.id}">${icon('check', 18)}Завершить</button>
         </div>`
      : a.status === 'done'
        ? `<div class="btns">
             <button class="btn gh" data-a="ap.voice" data-id="${a.id}">${icon('mic', 18)}Заметка</button>
             <button class="btn p" data-a="ap.repeat" data-id="${a.id}">${icon('refresh', 18)}Повторить запись</button>
           </div>`
        : `<button class="btn p" data-a="ap.repeat" data-id="${a.id}">${icon('refresh', 18)}Записать снова</button>`;

  const s = sheet({ title: 'Запись', body, footer });
  s.el.dataset.apptSheet = a.id;
  return s;
}

function closeApptSheet() {
  const el = document.querySelector('[data-appt-sheet]');
  if (el && el._api) el._api.close();
}

on('ap.open', ds => { const a = appt(ds.id); document.querySelectorAll('.sheet').forEach(s => s.querySelector('[data-sheet-close]').click()); if (a) go('o.client', { id: a.clientId }); });
on('ap.call', ds => { const a = appt(ds.id), c = client(a.clientId); if (c && c.phone) openLink('tel:' + c.phone.replace(/\s/g, '')); else toast('Нет номера', 'dan'); });
on('ap.msg', ds => { const a = appt(ds.id), c = client(a.clientId); openLink('https://t.me/' + String(c && c.tg || '').replace('@', '')); });

/* Проверяем не только в разметке: действие можно вызвать и не из карточки —
   из подсказки, из старого открытого экрана, из консоли. Право должно
   стоять там, где происходит изменение. */
function guard(id) {
  const a = appt(id);
  if (canTouchAppt(a)) return a;
  toast('Это запись другого мастера', 'dan');
  return null;
}

on('ap.done', async ds => {
  if (!guard(ds.id)) return;
  completeAppointment(ds.id);
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  await wait(320);
  toast('Запись выполнена');
  const a = appt(ds.id);
  const ok = await confirmSheet({
    title: 'Добавить заметку о клиенте?',
    text: 'Надиктуйте пару слов — AI сам разложит их по полочкам в карточке клиента.',
    ok: 'Записать голосом', cancel: 'Позже',
  });
  if (ok) voiceNoteSheet(a.clientId);
});

on('ap.cancel', async ds => {
  const a = guard(ds.id);
  if (!a) return;
  if (a.status !== 'planned') { toast('Выполненную запись нельзя отменить', 'dan'); return; }
  const ok = await confirmSheet({ title: 'Отменить запись?', text: isServer() ? 'Слот снова станет свободным, клиент получит сообщение от бота.' : 'Слот снова станет свободным. В демо уведомление клиенту не уходит.', ok: 'Отменить запись', cancel: 'Оставить', danger: true });
  if (!ok) return;
  if (!cancelAppointment(ds.id, S.session.role)) { toast('Эту запись уже нельзя отменить', 'dan'); return; }
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  toast('Запись отменена', 'dan');
});

on('ap.repeat', ds => {
  const a = appt(ds.id);
  document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click());
  setTimeout(() => newApptFlow({ clientId: a.clientId, serviceIds: a.serviceIds.slice(), employeeId: a.employeeId }), 300);
});

on('ap.voice', ds => { const a = guard(ds.id); if (!a) return; document.querySelectorAll('.sheet [data-sheet-close]').forEach(b => b.click()); setTimeout(() => voiceNoteSheet(a.clientId), 300); });

on('ap.move', ds => { if (guard(ds.id)) moveFlow(ds.id); });
on('ap.note', async ds => {
  const a = appt(ds.id);
  const v = await promptSheet({ title: 'Заметка к записи', label: 'Текст', value: a.note, multiline: true });
  if (v != null) { a.note = v; toast('Заметка сохранена'); }
});

/* =========================================================
   Выбор даты и времени — две шторки подряд
   ---------------------------------------------------------
   Сначала месяц, потом время выбранного дня. В одном окне это не
   помещается: человек листает шторку вверх-вниз, сводя дату со слотом,
   и промахивается. Два коротких шага влезают в экран целиком, а «назад»
   в шапке возвращает к календарю.

   Компонент общий: им пользуются перенос у клиента, перенос у бизнеса
   и новая запись. Действия называются ps.* — одновременно открытым
   таким выбором может быть только один.
   ========================================================= */
export function pickSlot({
  sheet: host = null,          // продолжить в уже открытой шторке
  title = 'Выберите дату',
  timeTitle = 'Выберите время',
  head = '',                   // строка или функция: контекст над календарём
  date = null,
  min = null,                  // время уже известно — открываемся сразу на нём
  months = 4,
  slotsOn,                     // (date) -> [{ min, t, free, empId }]
  showBusy = false,            // бизнесу полезно видеть, чем занят день
  okLabel = null,              // (min, date) -> подпись кнопки
  from = null,                 // время, которое меняем: показываем «было → станет»
  confirm = null,              // { title, ok, note } — спросить перед сохранением
  done = null,                 // { title, text, note } — показать итог после
  onPick,                      // ({ date, min, empId }) -> void
  onBack = null,               // «назад» с первого шага
} = {}) {
  const s = host || sheet({ title: t(title), body: '' });
  const st = {
    date: date && startOfDay(date) >= today() ? startOfDay(date) : today(),
    month: null, min: min != null ? min : null, empId: null,
  };
  st.month = startOfDay(st.date);
  // Время могли передать снаружи — владелец ткнул в свободный слот календаря.
  // Если к этому моменту оно занято, не делаем вид, что выбор уже сделан:
  // иначе кнопка зовёт сохранить то, чего нельзя, и человек упирается в отказ.
  if (st.min != null && !slotsOn(st.date).some(x => x.min === st.min && x.free)) st.min = null;
  const maxDate = addDays(today(), months * 30);
  const top = () => (typeof head === 'function' ? head() : head);
  // Текущее время записи — подсказка на шагах выбора. На подтверждении
  // его заменяет строка «Было», а на итоге оно уже неверно: запись уехала.
  const fromLine = () => (from
    ? `<div class="tiny dim" style="margin:-4px 2px 14px">${t('Сейчас')}: ${dateLabel(from, now())}, ${hhmm(from)}</div>`
    : '');

  const drawDate = () => s.set({
    title: t(title),
    back: onBack,
    body: `${top()}${fromLine()}
      ${monthGrid(st.month, {
        selected: st.date, action: 'ps.date', navAction: 'ps.month',
        avail: d => slotsOn(d).filter(x => x.free).length, minDate: today(), maxDate,
      })}
      <div class="mc-legend">
        <span><i></i>${t('есть свободное время')}</span>
        <span style="opacity:.6">${t('зачёркнуто — мест нет')}</span>
      </div>`,
  });

  // Своё же время выбрать можно (ignoreId держит его свободным), но
  // переносить запись на то место, где она и стоит, незачем.
  const isSame = () => !!from && st.min != null
    && dayKey(st.date) === dayKey(from) && st.min === from.getHours() * 60 + from.getMinutes();

  const drawTime = () => {
    const all = slotsOn(st.date);
    const free = all.filter(x => x.free);
    s.set({
      title: t(timeTitle),
      back: drawDate,
      body: `${top()}${fromLine()}
        <div class="b sm" style="margin-bottom:10px">${dateLabel(st.date, now())}, ${WD_FULL[st.date.getDay()]}</div>
        ${free.length ? slotGroups(showBusy ? all : free, 'ps.slot', st.min)
          : `<div class="empty" style="padding:18px 8px">
              <div class="t" style="font-size:15px">${t(all.length ? 'На этот день мест нет' : 'В этот день не работаем')}</div>
              <div class="s">${t('Выберите другую дату — свободное время найдётся.')}</div></div>`}`,
      footer: `<button class="btn p" data-a="ps.ok" ${st.min == null || isSame() ? 'disabled' : ''}>${
        st.min == null ? t('Выберите время')
          : isSame() ? t('Это текущее время')
            : (okLabel ? okLabel(st.min, st.date) : t('Готово'))}</button>`,
    });
  };

  /* Время выбрано — показываем, что именно поменяется. Перенос не
     спрашивают «точно?» ради формальности: человек мог промахнуться по
     соседнему слоту, и сверить старое с новым ему негде. */
  const at = () => {
    const d = new Date(st.date);
    d.setHours(Math.floor(st.min / 60), st.min % 60, 0, 0);
    return d;
  };
  const whenRow = (label, d, strong) => `<div class="row between" style="padding:9px 0">
      <span class="sm muted">${t(label)}</span>
      <b class="${strong ? '' : 'sm'}" style="${strong ? 'color:var(--p)' : 'color:var(--tx-3);text-decoration:line-through'}">${
        dateLabel(d, now())}, ${hhmm(d)}</b>
    </div>`;

  const drawConfirm = () => {
    const d = at();
    s.set({
      title: t((confirm && confirm.title) || 'Проверьте время'),
      back: drawTime,
      body: `${top()}
        <div class="card flat" style="padding:4px 14px">
          ${from ? whenRow('Было', from, false) + '<div class="hr"></div>' : ''}
          ${whenRow(from ? 'Станет' : 'Когда', d, true)}
        </div>
        ${confirm && confirm.note ? `<div class="tiny dim" style="margin-top:10px;padding:0 4px">${t(confirm.note)}</div>` : ''}`,
      footer: `<div class="btns">
        <button class="btn gh" data-a="ps.back">${t('Назад')}</button>
        <button class="btn p" data-a="ps.apply">${t((confirm && confirm.ok) || 'Подтвердить')}</button>
      </div>`,
    });
  };

  const drawDone = () => {
    const d = at();
    s.set({
      title: '',
      body: `<div class="succ" style="padding:14px 8px 18px">
          <div class="check">${icon('check', 44, 3)}</div>
          <div class="t" style="font-size:21px">${t((done && done.text) || 'Готово')}</div>
          <div class="s">${dateLabel(d, now())}, ${hhmm(d)}</div>
        </div>
        ${top()}
        ${done && done.note ? `<div class="tiny dim center" style="padding:0 4px 4px">${t(done.note)}</div>` : ''}`,
      footer: `<button class="btn p" data-a="ps.close">${t('Готово')}</button>`,
    });
  };

  on('ps.date', ds => { st.date = startOfDay(new Date(+ds.d)); st.min = null; drawTime(); });
  on('ps.month', ds => { st.month = startOfDay(new Date(+ds.d)); drawDate(); });
  on('ps.slot', ds => { st.min = +ds.m; st.empId = ds.e || null; haptic('select'); drawTime(); });
  // Пока шторка открыта, время мог занять кто-то другой — проверяем и
  // перед подтверждением, и перед самим сохранением.
  const stillFree = () => {
    const x = slotsOn(st.date).find(y => y.min === st.min && y.free);
    if (!x) { toast(t('Это время уже заняли'), 'dan'); st.min = null; drawTime(); }
    return x || null;
  };
  on('ps.ok', () => {
    if (st.min == null || !stillFree()) return;
    if (confirm) { drawConfirm(); return; }
    fire();
  });
  on('ps.back', () => drawTime());
  on('ps.apply', () => fire());
  on('ps.close', () => s.close());

  function fire() {
    const x = stillFree(); if (!x) return;
    onPick({ date: at(), min: st.min, empId: st.empId || x.empId || null });
    if (done) drawDone(); else s.close();
  }

  const redraw = () => (st.min == null ? drawDate() : drawTime());
  redraw();
  return { sheet: s, redraw };
}

/* =========================================================
   Перенос записи (бизнес)
   ========================================================= */
export function moveFlow(id) {
  const a = appt(id); if (!a) return;
  const c = client(a.clientId), e0 = emp(a.employeeId), cur = new Date(a.start);
  // Своё же время не считаем занятым: иначе вернуться на него, передумав,
  // было бы нельзя, а день выглядел бы плотнее, чем он есть.
  const slotsOn = d => slotsFor([a.employeeId], d, a.duration, { ignoreId: a.id });
  const head = `<div class="card flat" style="padding:11px 13px;margin-bottom:12px">
      <div class="b sm nowrap">${esc(c ? c.name : 'Клиент')} · ${esc(apptTitle(a))}</div>
      <div class="tiny muted">${esc(e0 ? e0.name : '')} · ${nMin(a.duration)}</div>
    </div>`;
  pickSlot({
    title: 'Перенести запись', head, date: cur, from: cur, slotsOn, showBusy: true,
    okLabel: min => t('Перенести на {t}', { t: toHM(min) }),
    confirm: { title: 'Перенести запись?', ok: 'Перенести', note: 'Старое время снова станет свободным.' },
    done: { text: 'Запись перенесена', note: isServer() ? 'Клиент получит сообщение от бота с новым временем.' : 'Клиента предупредите сами — в демо уведомление не уходит.' },
    onPick: ({ date }) => moveAppointment(id, date, null),
  });
}

/* =========================================================
   Быстрое добавление (FAB)
   ========================================================= */
export function quickAdd() {
  const items = [
    ['calendarPlus', 'Добавить запись', 'Клиент, услуга и время', 'qa.appt', '#4C6FFF'],
    ['lock', 'Заблокировать время', 'Перерыв, обед, личные дела', 'qa.block', '#F79009'],
    ['userPlus', 'Добавить клиента', 'В базу без записи', 'qa.client', '#12B76A'],
    ['briefcase', 'Добавить услугу', 'Название, цена, время', 'qa.svc', '#8B5CF6'],
  ];
  const s = sheet({
    title: 'Что добавим?',
    body: `<div class="stack s" style="padding-bottom:6px">${items.map(i => `
      <button class="lrow press" style="border-radius:16px;border:1px solid var(--bd)" data-a="${i[3]}">
        <div class="ic" style="background:${i[4]}1f;color:${i[4]}">${icon(i[0], 20)}</div>
        <div class="grow" style="text-align:left"><div class="tl">${i[1]}</div><div class="st">${i[2]}</div></div>
        ${icon('fwd', 18)}
      </button>`).join('')}</div>`,
  });
  window.__qa = s;
}
on('qa.appt', () => { window.__qa && window.__qa.close(); setTimeout(() => newApptFlow({}), 260); });
on('qa.block', () => { window.__qa && window.__qa.close(); setTimeout(() => blockFlow({}), 260); });
on('qa.client', () => { window.__qa && window.__qa.close(); setTimeout(() => addClientSheet(), 260); });
on('qa.svc', () => { window.__qa && window.__qa.close(); setTimeout(() => addServiceSheet(), 260); });
on('fab', () => quickAdd());

/* =========================================================
   Полоса дат
   ---------------------------------------------------------
   Осталась только у блокировки времени: там дата — одно поле формы
   рядом с мастером и интервалом, и ради неё разворачивать календарь
   не нужно. Выбор даты и времени для записи живёт в pickSlot.
   ========================================================= */
function dateStrip(selected, action, days = 14, from = null) {
  const base = from || today();
  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(base, i);
    const on = dayKey(d) === dayKey(selected);
    cells.push(`<button class="dcard ${on ? 'on' : ''}" data-a="${action}" data-d="${d.getTime()}">
      <div class="w">${WD[d.getDay()]}</div><div class="n">${d.getDate()}</div>
      <div class="m">${i === 0 ? t('сегодня') : MON_SHORT[d.getMonth()]}</div>
    </button>`);
  }
  return `<div class="hscroll">${cells.join('')}</div>`;
}

/* =========================================================
   Новая запись (мастер/владелец)
   ========================================================= */
export function newApptFlow(pre = {}) {
  const state = {
    step: pre.clientId ? (pre.serviceIds && pre.serviceIds.length ? 3 : 2) : 1,
    clientId: pre.clientId || null,
    serviceIds: pre.serviceIds ? pre.serviceIds.slice() : [],
    employeeId: pre.employeeId || null,
    date: pre.date ? startOfDay(pre.date) : today(),
    min: pre.startMin != null ? pre.startMin : null,
    q: '',
  };
  const s = sheet({ title: 'Новая запись', body: '' });
  window.__na = { s, state, draw: () => draw() };

  const duration = () => state.serviceIds.reduce((x, id) => x + ((svc(id) || {}).duration || 0), 0) || 60;
  const price = () => state.serviceIds.reduce((x, id) => x + ((svc(id) || {}).price || 0), 0);

  function stepClient() {
    const q = state.q.toLowerCase();
    const list = clients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .map(c => ({ c, st: clientStats(c.id) }))
      .sort((a, b) => (b.st.last ? new Date(b.st.last.start) : 0) - (a.st.last ? new Date(a.st.last.start) : 0))
      .slice(0, 40);
    return {
      title: 'Кто придёт?',
      body: `
        <div class="search" style="margin-bottom:12px">${icon('search', 18)}<input id="_q" placeholder="Имя или телефон" value="${esc(state.q)}"></div>
        <button class="lrow press" style="border-radius:14px;border:1px dashed var(--bd-2);background:transparent;width:100%;margin-bottom:12px" data-a="na.new">
          <div class="ic" style="background:var(--p-soft);color:var(--p)">${icon('userPlus', 19)}</div>
          <div class="grow" style="text-align:left"><div class="tl">Новый клиент</div><div class="st">Добавить в базу</div></div>
        </button>
        <div class="stack s">${list.map(({ c, st }) => `
          <button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="na.client" data-id="${c.id}">
            ${avatar(c, 's')}
            <div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
              <div class="st">${st.visits ? st.visits + ' виз. · ' + (st.last ? relPast(new Date(st.last.start), now()) : '') : 'Новый клиент'}</div></div>
          </button>`).join('') || '<div class="empty"><div class="t">Не найдено</div></div>'}</div>`,
      mount: el => {
        const i = el.querySelector('#_q');
        if (i) i.oninput = e => { state.q = e.target.value; drawSoft(); };
      },
    };
  }

  function stepService() {
    const list = svcs().filter(x => !state.employeeId || x.employeeIds.includes(state.employeeId));
    const byCat = {};
    list.forEach(x => { (byCat[x.cat] = byCat[x.cat] || []).push(x); });
    return {
      title: 'Какая услуга?',
      back: () => { state.step = 1; draw(); },
      body: `<div class="stack s">${list.map(x => `
        <button class="svc press" style="width:100%" data-a="na.svc" data-id="${x.id}">
          <div class="tint" style="background:${x.color}1f;color:${x.color}">${catIcon(x.cat, 18)}</div>
          <div class="grow" style="text-align:left">
            <div class="b" style="font-size:14.5px">${esc(x.name)}</div>
            <div class="tiny muted">${nMin(x.duration)}</div>
          </div>
          <div class="pr">${money(x.price)}</div>
          ${state.serviceIds.includes(x.id) ? `<span style="color:var(--p)">${icon('checkCircle', 20)}</span>` : ''}
        </button>`).join('')}</div>`,
      footer: state.serviceIds.length ? `<button class="btn p" data-a="na.next3">Далее · ${money(price())} · ${nMin(duration())}</button>` : '',
    };
  }

  /* Шаг «когда» — общий выбор даты и времени (pickSlot): сначала месяц,
     потом слоты. Мастер выбирается здесь же, чипсами над календарём:
     от него зависит, в какие дни вообще есть окна. */
  let picker = null;

  function cands() {
    return bookableStaff().filter(e => !state.serviceIds.length
      || state.serviceIds.every(id => (svc(id) || { employeeIds: [] }).employeeIds.includes(e.id)));
  }

  function whenHead() {
    const cl = client(state.clientId);
    return `
      <div class="row" style="gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--sf-2);border-radius:14px">
        ${avatar(cl, 's')}
        <div class="grow" style="min-width:0"><div class="b sm nowrap">${esc(cl ? cl.name : '')}</div>
        <div class="tiny muted nowrap">${esc(state.serviceIds.map(id => (svc(id) || {}).name).join(' + '))}</div></div>
        <div class="b sm">${money(price())}</div>
      </div>
      <div class="chips" style="padding-left:0;padding-right:0;margin-bottom:12px">
        <button class="chip p ${!state.employeeId ? 'on' : ''}" data-a="na.emp" data-id="">${t('Любой мастер')}</button>
        ${cands().map(e => `<button class="chip p ${state.employeeId === e.id ? 'on' : ''}" data-a="na.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}
      </div>`;
  }

  function stepWhen() {
    picker = pickSlot({
      sheet: s, head: whenHead, date: state.date, min: state.min, showBusy: true,
      title: 'Когда?', timeTitle: 'Выберите время',
      onBack: () => { picker = null; state.step = 2; draw(); },
      slotsOn: d => {
        const ids = state.employeeId ? [state.employeeId] : cands().map(e => e.id);
        return slotsFor(ids, d, duration());
      },
      okLabel: (min, d) => t('Создать запись · {d}', { d: dateLabel(d, now()).toLowerCase() + ', ' + toHM(min) }),
      onPick: ({ date, min, empId }) => {
        const id = state.employeeId || empId;
        if (!id) { toast(t('Нет свободного мастера'), 'dan'); return; }
        createAppointment({ clientId: state.clientId, employeeId: id, serviceIds: state.serviceIds, start: date, source: 'owner' });
        s.close();
        toast(t('Запись создана на {d}', { d: dateLabel(date, now()).toLowerCase() + ', ' + toHM(min) }));
      },
    });
  }

  function draw() {
    if (state.step === 3) { stepWhen(); return; }
    picker = null;
    s.set(state.step === 1 ? stepClient() : stepService());
  }
  function drawSoft() {
    // перерисовка списка клиентов без потери фокуса
    const b = s.el.querySelector('.sheet-b');
    const q = state.q.toLowerCase();
    const list = clients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 40);
    const host = b.querySelector('.stack');
    if (host) host.innerHTML = list.map(c => {
      const st = clientStats(c.id);
      return `<button class="lrow press" style="border-radius:14px;border:1px solid var(--bd);width:100%" data-a="na.client" data-id="${c.id}">
        ${avatar(c, 's')}<div class="grow" style="text-align:left"><div class="tl">${esc(c.name)}</div>
        <div class="st">${st.visits ? st.visits + ' виз.' : 'Новый клиент'}</div></div></button>`;
    }).join('') || '<div class="empty"><div class="t">Не найдено</div></div>';
  }

  on('na.client', ds => { state.clientId = ds.id; state.step = 2; draw(); });
  on('na.new', async () => {
    const v = await promptSheet({ title: 'Новый клиент', label: 'Имя', placeholder: 'Например, Алия' });
    if (!v) return;
    const c = createClient({ name: v });
    state.clientId = c.id; state.step = 2; draw(); toast('Клиент добавлен');
  });
  on('na.svc', ds => {
    const i = state.serviceIds.indexOf(ds.id);
    if (i >= 0) state.serviceIds.splice(i, 1); else state.serviceIds.push(ds.id);
    haptic('select'); draw();
  });
  on('na.next3', () => { state.step = 3; draw(); });
  on('na.emp', ds => {
    state.employeeId = ds.id || null;
    // мастер меняет и занятость дней, и список времени — перерисовываем шаг
    if (picker) picker.redraw(); else draw();
  });

  draw();
  return s;
}

/* =========================================================
   Блокировка времени
   ========================================================= */
/* =========================================================
   Отрезок времени барабанами
   ---------------------------------------------------------
   «Начало — Конец» плюс быстрые длительности. Один и тот же выбор
   нужен и в «Занять время», и в перерыве расписания, поэтому разметка
   и привязка барабанов живут здесь, а не копируются по экранам.

   Действия называются rw.* — одновременно открытым такой выбор бывает
   только один, и каждый вызывающий вешает свои обработчики.
   ========================================================= */
export const RANGE_MINS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad2 = n => String(n).padStart(2, '0');
// «1 ч 30 мин» в ряду кнопок переносило строку и добавляло окну прокрутку.
// В чипсе длительности хватает короткой записи: рядом всё равно стоит время.
export const shortLen = m => (m < 60 ? m + ' ' + t('мин')
  : Math.floor(m / 60) + ' ' + t('ч') + (m % 60 ? ' ' + (m % 60) : ''));

export function hoursBetween(fromMin, toMin_) {
  const out = [];
  for (let h = Math.floor(fromMin / 60); h <= Math.ceil(toMin_ / 60); h++) out.push(h);
  return out;
}

export function rangeWheels(st, hours, lens = [15, 30, 60, 90, 120]) {
  const cur = st.edit === 'from' ? st.from : st.to;
  return `
    <div class="tp-row">
      <button class="tp ${st.edit === 'from' ? 'on' : ''}" data-a="rw.edit" data-v="from">
        <span class="l">${t('Начало')}</span><span class="v" id="_rwf">${toHM(st.from)}</span></button>
      <button class="tp ${st.edit === 'to' ? 'on' : ''}" data-a="rw.edit" data-v="to">
        <span class="l">${t('Конец')}</span><span class="v" id="_rwt">${toHM(st.to)}</span></button>
    </div>
    <div class="wheel-box">
      ${wheel('_rwh', hours, Math.floor(cur / 60), pad2)}
      <div class="wheel-sep">:</div>
      ${wheel('_rwm', RANGE_MINS, cur % 60, pad2)}
    </div>
    ${lens.length ? `<div class="pick" style="margin-top:12px">
      ${lens.map(m => `<button class="o ${st.to - st.from === m ? 'on' : ''}" data-a="rw.len" data-m="${m}">${shortLen(m)}</button>`).join('')}
    </div>` : ''}`;
}

/** Обновить цифры и чипсы на месте: перерисовка сбросила бы барабан. */
export function syncRangeWheels(root, st) {
  const f = root.querySelector('#_rwf'), t2 = root.querySelector('#_rwt');
  if (f) f.textContent = toHM(st.from);
  if (t2) t2.textContent = toHM(st.to);
  root.querySelectorAll('[data-a="rw.len"]').forEach(x => x.classList.toggle('on', +x.dataset.m === st.to - st.from));
}

export function mountRangeWheels(root, st, after) {
  const cur = st.edit === 'from' ? st.from : st.to;
  const set = m => {
    if (st.edit === 'from') {
      // тянем конец за началом, сохраняя длительность: человек двигает
      // отрезок по дню, а не задаёт его каждый раз заново
      const dur = Math.max(5, st.to - st.from);
      st.from = m; st.to = m + dur;
    } else st.to = m;
    syncRangeWheels(root, st);
    if (after) after();
  };
  mountWheel(root, '_rwh', Math.floor(cur / 60),
    h => set(h * 60 + (st.edit === 'from' ? st.from : st.to) % 60));
  mountWheel(root, '_rwm', cur % 60, mi => {
    const base = st.edit === 'from' ? st.from : st.to;
    set(Math.floor(base / 60) * 60 + mi);
  });
}

/* Одно время, а не отрезок: начало и конец рабочего дня. */
export function timeSheet({ title = 'Выберите время', value = 12 * 60, hours = null, onOk } = {}) {
  const st = { v: value };
  const HH = hours || hoursBetween(0, 23 * 60);
  const s = sheet({ title: t(title), body: '' });
  s.set({
    title: t(title),
    body: `<div class="wheel-box">
      ${wheel('_th', HH, Math.floor(st.v / 60), pad2)}
      <div class="wheel-sep">:</div>
      ${wheel('_tm', RANGE_MINS, st.v % 60, pad2)}
    </div>`,
    footer: `<button class="btn p" data-a="tw.ok">${t('Готово')} · <span id="_tv">${toHM(st.v)}</span></button>`,
    mount: root => {
      const upd = () => { const el = root.querySelector('#_tv'); if (el) el.textContent = toHM(st.v); };
      mountWheel(root, '_th', Math.floor(st.v / 60), h => { st.v = h * 60 + st.v % 60; upd(); });
      mountWheel(root, '_tm', st.v % 60, mi => { st.v = Math.floor(st.v / 60) * 60 + mi; upd(); });
    },
  });
  window.__tw = { s, st, onOk };
  return s;
}
on('tw.ok', () => {
  const w = window.__tw; if (!w) return;
  window.__tw = null;
  w.s.close();
  w.onOk(w.st.v);
});

/* =========================================================
   Занятое время уже занято
   ---------------------------------------------------------
   Отпуск или блокировку нельзя поставить поверх записи: клиент придёт,
   а мастера нет. Но и просто запретить мало — человек тогда вручную
   ищет эти записи по календарю. Поэтому показываем их списком здесь же
   и даём перенести или отменить, не выходя из шторки. Список
   пересчитывается после каждого действия: как только он пуст, можно
   продолжать.
   ========================================================= */
export function conflictSheet({ title = 'На это время есть записи', text = '', list, onResolved } = {}) {
  const s = sheet({ title: t(title), body: '' });
  let off = null;
  const close = () => { if (off) { off(); off = null; } };

  const draw = () => {
    const cur = list();
    if (!cur.length) {
      s.set({
        title: t('Время свободно'),
        body: `<div class="succ" style="padding:10px 8px 16px">
            <div class="check">${icon('check', 44, 3)}</div>
            <div class="t" style="font-size:20px">${t('Записей на это время больше нет')}</div>
          </div>`,
        footer: `<button class="btn p" data-a="cf.ok">${t('Продолжить')}</button>`,
      });
      return;
    }
    s.set({
      title: t(title),
      body: `${text ? `<div class="sm" style="color:var(--tx-2);margin-bottom:12px">${t(text)}</div>` : ''}
        <div class="stack s">${cur.map(a => {
        const c = client(a.clientId), d = new Date(a.start);
        return `<div class="card" style="padding:0">
            <div class="row" style="gap:11px;padding:12px 14px;align-items:center">
              ${avatar(c, 'm')}
              <div class="grow" style="min-width:0">
                <div class="b sm nowrap">${esc(c ? c.name : 'Клиент')}</div>
                <div class="tiny muted nowrap">${dateLabel(d, now())}, ${hhmm(d)} · ${esc(apptTitle(a))}</div>
              </div>
            </div>
            <div class="upc-acts">
              <button class="press" data-a="cf.move" data-id="${a.id}">${icon('history', 16)}${t('Перенести')}</button>
              <button class="press dan" data-a="cf.cancel" data-id="${a.id}">${icon('xCircle', 16)}${t('Отменить')}</button>
            </div>
          </div>`;
      }).join('')}</div>`,
      footer: '',
    });
  };

  // Перенос и отмена меняют данные — список должен пересчитаться сам,
  // иначе после переноса здесь висела бы уже неактуальная запись.
  off = sub(() => { if (!s._closed) draw(); });
  const prevClose = s.close;
  s.close = () => { close(); prevClose(); };
  draw();
  window.__cf = { s, onResolved };
  return s;
}
on('cf.move', ds => moveFlow(ds.id));
on('cf.cancel', async ds => {
  const a = appt(ds.id); if (!a) return;
  const c = client(a.clientId), d = new Date(a.start);
  const ok = await confirmSheet({
    title: 'Отменить запись?',
    text: `${c ? c.name : 'Клиент'}\n${apptTitle(a)}\n${dateLabel(d, now())}, ${hhmm(d)}\n\n${isServer() ? 'Клиент получит сообщение об отмене от бота.' : 'Предупредите клиента — в демо уведомление не уходит.'}`,
    ok: 'Отменить запись', cancel: 'Оставить', danger: true,
  });
  if (!ok) return;
  cancelAppointment(ds.id, 'owner');
  toast('Запись отменена', 'dan');
});
on('cf.ok', () => {
  const w = window.__cf; if (!w) return;
  window.__cf = null;
  w.s.close();
  w.onResolved();
});

export function blockFlow(pre = {}) {
  // Мастер распоряжается только своим временем: выбор сотрудника —
  // это управление чужим расписанием, и оно есть только у тех,
  // кому открыт весь календарь.
  const canPickEmp = can('allCalendar');
  const meEmp = me();
  const start0 = pre.startMin != null ? pre.startMin : 13 * 60;
  const st = {
    empId: canPickEmp ? (pre.empId || staff()[0].id) : ((meEmp && meEmp.id) || staff()[0].id),
    date: pre.date ? startOfDay(pre.date) : today(),
    kind: pre.kind || 'break',
    allDay: false,
    from: start0,
    to: start0 + 60,
    edit: 'from',                 // какое из двух значений крутит барабан
  };
  const s = sheet({ title: 'Занять время', body: '' });
  const KINDS = ['break', 'busy', 'other'];

  const window_ = () => {
    const e = emp(st.empId);
    const w = e ? workWindow(e, st.date) : null;
    return { w, from: w ? toMin(w.from) : 9 * 60, to: w ? toMin(w.to) : 20 * 60 };
  };

  /* Перерисовывать всё окно на каждый поворот барабана нельзя: он
     сбросится к началу прямо под пальцем. Поэтому цифры и подписи
     обновляем на месте. */
  const sync = () => {
    const bad = !st.allDay && st.to <= st.from;
    syncRangeWheels(s.el, st);
    const ok = s.el.querySelector('[data-a="bl.ok"]');
    if (ok) {
      ok.disabled = bad;
      ok.textContent = bad ? t('Конец раньше начала')
        : st.allDay ? t('Занять весь день')
          : t('Занять {a}–{b}', { a: toHM(st.from), b: toHM(st.to) });
    }
  };

  const draw = () => {
    const { w, from: dayFrom, to: dayTo } = window_();
    if (st.allDay) { st.from = dayFrom; st.to = dayTo; }
    const HOURS = hoursBetween(dayFrom, dayTo);

    s.set({
      title: t('Занять время'),
      body: `
      <div class="field"><label>${t('Причина')}</label>
        <div class="pick">${KINDS.map(k => `<button class="o ${st.kind === k ? 'on' : ''}" data-a="bl.kind" data-k="${k}">${ABSENCE[k].t}</button>`).join('')}</div>
      </div>
      ${canPickEmp ? `<div class="field"><label>${t('Мастер')}</label>
        <div class="pick">${staff().map(x => `<button class="o ${st.empId === x.id ? 'on' : ''}" data-a="bl.emp" data-id="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}</div>
      </div>` : ''}
      <div class="field"><label>${t('Дата')}</label><div style="margin:0 -18px">${dateStrip(st.date, 'bl.date', 14)}</div></div>

      <div class="lrow" style="border-radius:14px;border:1px solid var(--bd);margin-bottom:14px">
        <div class="grow"><div class="tl">${t('Весь день')}</div>
          <div class="st">${w ? w.from + ' — ' + w.to : t('в этот день мастер не работает')}</div></div>
        <button class="sw ${st.allDay ? 'on' : ''}" data-a="bl.allday"></button>
      </div>

      ${st.allDay ? '' : rangeWheels(st, HOURS)}

      <div class="tiny dim" style="margin-top:14px">${t('В это время клиенты не смогут записаться.')}</div>`,
      footer: `<button class="btn p" data-a="bl.ok">${st.allDay ? t('Занять весь день') : t('Занять {a}–{b}', { a: toHM(st.from), b: toHM(st.to) })}</button>`,
      mount: root => { if (!st.allDay) mountRangeWheels(root, st, sync); },
    });
    sync();
  };

  on('bl.kind', ds => { st.kind = ds.k; draw(); });
  on('bl.emp', ds => { st.empId = ds.id; draw(); });
  on('bl.date', ds => { st.date = startOfDay(new Date(+ds.d)); draw(); });
  on('bl.allday', () => { st.allDay = !st.allDay; draw(); });
  on('rw.edit', ds => { st.edit = ds.v; draw(); });
  on('rw.len', ds => {
    st.to = st.from + +ds.m;
    // барабан крутит «конец» — его надо подвинуть, иначе цифры разойдутся
    if (st.edit === 'to') draw(); else sync();
  });
  on('bl.ok', () => {
    if (!st.allDay && st.to <= st.from) { toast(t('Конец должен быть позже начала'), 'dan'); return; }
    const a2 = new Date(st.date); a2.setHours(Math.floor(st.from / 60), st.from % 60, 0, 0);
    const b2 = new Date(st.date); b2.setHours(Math.floor(st.to / 60), st.to % 60, 0, 0);
    const save = () => {
      addBlock({ employeeId: st.empId, start: a2, end: b2, reason: ABSENCE[st.kind].t, kind: st.kind, allDay: st.allDay });
      s.close();
      toast(st.allDay ? t('День занят') : t('Время занято {a}–{b}', { a: toHM(st.from), b: toHM(st.to) }));
    };
    // Поверх живой записи время не занимаем: клиент придёт к закрытой двери.
    if (apptsInRange(st.empId, a2, b2).length) {
      conflictSheet({
        text: 'Пока на это время записан клиент, занять его нельзя. Перенесите запись или отмените — и возвращайтесь.',
        list: () => apptsInRange(st.empId, a2, b2),
        onResolved: save,
      });
      return;
    }
    save();
  });
  draw();
  return s;
}

/* =========================================================
   Отсутствие: отпуск, больничный, выходной (§53–§56)
   ========================================================= */
export function absenceFlow(pre = {}) {
  // Как и с блокировкой: отпуск себе мастер ставит сам, чужой — нет.
  const canPickEmp = can('allCalendar');
  const meEmp = me();
  const st = {
    empId: canPickEmp ? (pre.empId || staff()[0].id) : ((meEmp && meEmp.id) || staff()[0].id),
    kind: 'vacation',
    from: pre.date ? startOfDay(pre.date) : today(),
    to: pre.date ? startOfDay(pre.date) : today(),
    picking: null,          // 'from' | 'to' — какую границу выбираем
    month: pre.date ? startOfDay(pre.date) : today(),
  };
  const KINDS = ['vacation', 'sick', 'dayoff', 'busy', 'other'];
  const s = sheet({ title: 'Отметить отсутствие', body: '' });

  const days = Math.round((st.to - st.from) / 86400000) + 1;

  const draw = () => {
    const d = Math.round((st.to - st.from) / 86400000) + 1;
    s.set({
      title: st.picking ? (st.picking === 'from' ? 'С какого дня?' : 'По какой день?') : 'Отметить отсутствие',
      back: st.picking ? () => { st.picking = null; draw(); } : null,
      body: st.picking
        ? monthGrid(st.month, {
          selected: st.picking === 'from' ? st.from : st.to,
          action: 'ab.pick', navAction: 'ab.month',
          minDate: st.picking === 'to' ? st.from : null,
        })
        : `
        ${canPickEmp ? `<div class="field"><label>Кто отсутствует</label>
          <div class="pick">${staff().map(x => `<button class="o ${st.empId === x.id ? 'on' : ''}" data-a="ab.emp" data-id="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}</div>
        </div>` : ''}
        <div class="field"><label>Причина</label>
          <div class="pick">${KINDS.map(k => `<button class="o ${st.kind === k ? 'on' : ''}" data-a="ab.kind" data-k="${k}"
            style="${st.kind === k ? 'background:' + ABSENCE[k].color + '1f;color:' + ABSENCE[k].color + ';border-color:' + ABSENCE[k].color : ''}">${ABSENCE[k].t}</button>`).join('')}</div>
        </div>
        <div class="inp-row" style="margin-bottom:14px">
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left" data-a="ab.setFrom">
            <div class="tiny dim">С</div><div class="b">${dateFull(st.from)}</div></button>
          <button class="card flat press" style="flex:1;padding:12px 14px;text-align:left" data-a="ab.setTo">
            <div class="tiny dim">По</div><div class="b">${dateFull(st.to)}</div></button>
        </div>
        <div class="card pad row" style="gap:10px;background:${ABSENCE[st.kind].color}14;border-color:transparent">
          <span style="color:${ABSENCE[st.kind].color}">${icon(ABSENCE[st.kind].icon, 19)}</span>
          <div class="sm" style="color:var(--tx-2)">${d} ${plural(d, ['день', 'дня', 'дней'])} — записи на это время приниматься не будут.</div>
        </div>`,
      footer: st.picking ? '' : `<button class="btn p" data-a="ab.ok">Отметить</button>`,
    });
  };

  on('ab.emp', ds => { st.empId = ds.id; draw(); });
  on('ab.kind', ds => { st.kind = ds.k; draw(); });
  on('ab.setFrom', () => { st.picking = 'from'; st.month = startOfDay(st.from); draw(); });
  on('ab.setTo', () => { st.picking = 'to'; st.month = startOfDay(st.to); draw(); });
  on('ab.month', ds => { st.month = startOfDay(new Date(+ds.d)); draw(); });
  on('ab.pick', ds => {
    const v = startOfDay(new Date(+ds.d));
    if (st.picking === 'from') { st.from = v; if (st.to < v) st.to = v; }
    else st.to = v;
    st.picking = null; draw();
  });
  on('ab.ok', () => {
    const lo = startOfDay(st.from);
    const hi = new Date(startOfDay(st.to).getTime() + 86399999);
    const save = () => {
      const rows = addAbsence({ employeeId: st.empId, from: st.from, to: st.to, kind: st.kind });
      s.close();
      const e = emp(st.empId);
      toast(`${ABSENCE[st.kind].t}: ${e ? e.name.split(' ')[0] : ''}, ${rows.length} ${plural(rows.length, ['день', 'дня', 'дней'])}`);
    };
    // Отпуск поверх записей — та же беда, только на несколько дней сразу.
    if (apptsInRange(st.empId, lo, hi).length) {
      conflictSheet({
        title: 'На эти дни есть записи',
        text: 'Отметить отсутствие можно, когда день свободен. Перенесите эти записи или отмените — список обновится сам.',
        list: () => apptsInRange(st.empId, lo, hi),
        onResolved: save,
      });
      return;
    }
    save();
  });
  draw();
  return s;
}

/* =========================================================
   Новый клиент / услуга
   ========================================================= */
export function addClientSheet(after) {
  const s = sheet({
    title: 'Новый клиент',
    body: `
      <div class="field"><label>Имя</label><input class="inp" id="_n" placeholder="Например, Алия Смагулова"></div>
      <div class="field"><label>Телефон</label><input class="inp" id="_p" placeholder="+7 ___ ___ __ __" inputmode="tel"></div>
      <div class="field"><label>Telegram (необязательно)</label><input class="inp" id="_t" placeholder="@username"></div>
      <div class="tiny dim">Остальное — заметки, предпочтения — можно добавить позже в карточке.</div>`,
    footer: `<button class="btn p" data-a="ac.ok">Добавить клиента</button>`,
  });
  on('ac.ok', () => {
    const n = s.el.querySelector('#_n').value.trim();
    if (!n) { toast('Введите имя', 'dan'); return; }
    const c = createClient({ name: n, phone: s.el.querySelector('#_p').value.trim(), tg: s.el.querySelector('#_t').value.trim() });
    s.close(); toast('Клиент добавлен');
    if (after) after(c); else go('o.client', { id: c.id });
  });
  setTimeout(() => s.el.querySelector('#_n').focus(), 250);
  return s;
}

export function addServiceSheet(pre = {}) {
  const st = {
    // pre.only — услуга создаётся из карточки мастера и закрепляется за ним (§72)
    emps: pre.only && pre.only.length ? pre.only.slice() : staff().map(e => e.id),
    cat: pre.cat || Object.keys(cats())[0] || 'nails',
    dur: pre.duration || 60,
    custom: false,
    name: pre.name || '',
    price: pre.price || '',
    photo: null,
  };
  const s = sheet({ title: 'Новая услуга', body: '' });

  // §75 — снимаем введённое перед перерисовкой, иначе название пропадает
  const capture = () => {
    const n = s.el.querySelector('#_n'), p = s.el.querySelector('#_p'), d = s.el.querySelector('#_cd');
    if (n) st.name = n.value;
    if (p) st.price = p.value;
    if (d && /^\d+$/.test(d.value)) st.dur = +d.value;
  };

  const draw = () => {
    const list = cats();
    s.set({
      title: 'Новая услуга',
      body: `
      <div class="field"><label>Название</label><input class="inp" id="_n" value="${esc(st.name)}" placeholder="Например, Педикюр"></div>
      <div class="field"><label>Цена, ₸</label><input class="inp" id="_p" inputmode="numeric" value="${esc(st.price)}" placeholder="10000"></div>

      <div class="field"><label>Длительность</label>
        <div class="pick">
          ${[30, 45, 60, 90, 120, 150].map(m => `<button class="o ${!st.custom && st.dur === m ? 'on' : ''}" data-a="as.dur" data-m="${m}">${nMin(m)}</button>`).join('')}
          <button class="o ${st.custom ? 'on' : ''}" data-a="as.custom">Своё время</button>
        </div>
        ${st.custom ? `<div class="row" style="gap:10px;margin-top:10px">
          <input class="inp" id="_cd" inputmode="numeric" value="${st.dur}" style="flex:1" placeholder="75">
          <span class="sm muted" style="flex:none">минут = ${nMin(st.dur)}</span>
        </div>` : ''}
      </div>

      <div class="field"><label>Категория</label>
        <div class="pick">
          ${Object.entries(list).map(([k, v]) => `<button class="o ${st.cat === k ? 'on' : ''}" data-a="as.cat" data-c="${k}"
            style="${st.cat === k ? 'background:' + v.color + '1f;color:' + v.color + ';border-color:' + v.color : ''}">${esc(v.t)}</button>`).join('')}
          <button class="o" data-a="as.newCat" style="border-style:dashed">${icon('plus', 13)} Своя</button>
        </div>
      </div>

      <div class="field"><label>Кто выполняет</label>
        <div class="pick">${staff().map(e => `<button class="o ${st.emps.includes(e.id) ? 'on' : ''}" data-a="as.emp" data-id="${e.id}">${esc(e.name.split(' ')[0])}</button>`).join('')}</div>
      </div>

      ${photoField({
        src: st.photo, label: 'Фотография услуги', actPick: 'as.photo', actDel: 'as.photoDel',
        hint: 'Клиент увидит её при выборе услуги. Необязательно.',
      })}
      <div class="tiny dim">Описание и буферное время можно настроить после создания.</div>`,
      footer: `<button class="btn p" data-a="as.ok">Создать услугу</button>`,
    });
  };

  on('as.cat', ds => { capture(); st.cat = ds.c; draw(); });
  on('as.dur', ds => { capture(); st.dur = +ds.m; st.custom = false; draw(); });
  on('as.custom', () => { capture(); st.custom = true; draw(); });
  on('as.emp', ds => {
    capture();
    const i = st.emps.indexOf(ds.id);
    if (i >= 0) st.emps.splice(i, 1); else st.emps.push(ds.id);
    draw();
  });
  on('as.newCat', async () => {
    capture();
    const v = await promptSheet({ title: 'Новая категория', label: 'Название', placeholder: 'Например, Массаж' });
    if (!v) { draw(); return; }
    const key = addCat(v);
    if (key) st.cat = key;
    draw(); toast('Категория добавлена');
  });
  on('as.photo', async () => {
    capture();
    const v = await pickImage(IMG_MAX.photo);
    if (!v) { draw(); return; }
    st.photo = v; draw(); toast('Фотография добавлена');
  });
  on('as.photoDel', () => { capture(); st.photo = null; draw(); });
  on('as.ok', () => {
    capture();
    const n = (st.name || '').trim();
    const price = +st.price || 0;
    if (!n) { toast('Введите название', 'dan'); return; }
    if (st.dur < 5) { toast('Укажите длительность', 'dan'); return; }
    const sv = createService({ name: n, price, duration: st.dur, employeeIds: st.emps, cat: st.cat });
    if (st.photo) updateService(sv.id, { photo: st.photo });
    s.close(); toast('Услуга добавлена');
    if (pre.after) pre.after(sv);
  });

  draw();
  setTimeout(() => { const i = s.el.querySelector('#_n'); if (i) i.focus(); }, 250);
  return s;
}

/* =========================================================
   Оценка визита клиентом (§80, §81)
   Результат остаётся внутри системы: на страницу записи отзывы
   не выводятся, а внутри салона их открывает только владелец.
   Клиенту мы это прямо и обещаем — иначе честной оценки мастера,
   к которому человек придёт ещё раз, ждать не приходится.
   ========================================================= */
export function reviewSheet(apptId, opts = {}) {
  const a = appt(apptId); if (!a) return;
  if (reviewFor(apptId)) { toast(t('Вы уже оценили этот визит')); return; }
  const e = emp(a.employeeId);
  const st = { rating: 0, text: '' };
  const s = sheet({ title: t('Как всё прошло?'), body: '' });

  const LABELS = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'];
  // не t: теперь так называется переводчик из ui, и локальная переменная
  // с тем же именем перекрывала бы его на всю функцию
  const capture = () => { const ta = s.el.querySelector('#_rv'); if (ta) st.text = ta.value; };

  const draw = () => {
    s.set({
      title: t('Как всё прошло?'),
      body: `
        <div class="card flat" style="padding:12px 14px;margin-bottom:16px;display:flex;gap:12px;align-items:center">
          ${avatar(e, 'm')}
          <div class="grow"><div class="b sm">${esc(apptTitle(a))}</div>
            <div class="tiny muted">${esc(e ? e.name : '')} · ${dateLabel(new Date(a.start), now())}</div></div>
        </div>
        <div class="center" style="margin-bottom:6px">
          <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button class="star ${st.rating >= n ? 'on' : ''}" data-a="rv.set" data-n="${n}">${icon('star', 34, 1.6)}</button>`).join('')}</div>
          <div class="sm ${st.rating ? 'b' : 'dim'}" style="margin-top:8px;height:20px">${st.rating ? t(LABELS[st.rating]) : t('Нажмите на звёзды')}</div>
        </div>
        <div class="field"><label>${t('Комментарий (необязательно)')}</label>
          <textarea class="inp" id="_rv" placeholder="${esc(t('Что понравилось или что стоит улучшить'))}">${esc(st.text)}</textarea></div>
        <div class="tiny dim">${t('Оценку видит только владелец салона — ни мастер, ни другие клиенты её не увидят. Она очень важна и помогает улучшить сервис.')}</div>`,
      footer: `<button class="btn p" data-a="rv.ok" ${st.rating ? '' : 'disabled'}>${t('Отправить отзыв')}</button>`,
    });
  };
  on('rv.set', ds => { capture(); st.rating = +ds.n; haptic('select'); draw(); });
  on('rv.ok', () => {
    capture();
    if (!st.rating) { toast(t('Поставьте оценку'), 'dan'); return; }
    addReview({ apptId, rating: st.rating, text: st.text, companyId: a.companyId });
    s.close();
    toast(t('Спасибо за отзыв!'));
    if (opts.after) opts.after();
  });
  draw();
  return s;
}
on('rv.open', ds => reviewSheet(ds.id));

/* =========================================================
   Голосовая AI-заметка
   ========================================================= */
let voiceIdx = 0;
export function voiceNoteSheet(clientId) {
  const c = client(clientId); if (!c) return;
  const demo = demoVoice(voiceIdx++);
  let phase = 'idle', text = '', parsed = null;
  const s = sheet({ title: 'Заметка о клиенте', body: '' });

  const draw = () => {
    if (phase === 'idle') s.set({
      title: 'Заметка о клиенте',
      body: `<div class="center" style="padding:10px 0 18px">
          <div class="sm muted" style="margin-bottom:22px">Нажмите и надиктуйте, что важно помнить о клиенте<br>${esc(c.name)}</div>
          <button class="mic" data-a="vn.rec">${icon('mic', 34, 2)}</button>
          <div class="tiny dim" style="margin-top:16px">AI сам разложит текст по категориям</div>
        </div>
        <div class="hr"></div>
        <button class="btn gh sm" style="width:100%" data-a="vn.type">${icon('pencil', 16)}Ввести текстом</button>`,
    });
    else if (phase === 'rec') s.set({
      title: 'Записываю…',
      body: `<div class="center" style="padding:10px 0 18px">
          <button class="mic rec" data-a="vn.stop">${icon('mic', 34, 2)}</button>
          <div class="wave" style="margin-top:18px">${Array.from({ length: 22 }, (_, i) => `<i style="animation-delay:${(i % 7) * .08}s"></i>`).join('')}</div>
          <div class="sm muted" style="margin-top:8px">Говорите… нажмите, чтобы остановить</div>
        </div>`,
    });
    else if (phase === 'think') s.set({
      title: 'AI анализирует', body: `${loadingBlock('Анализирую заметку…')}
        <div class="card flat" style="padding:12px 14px"><div class="tiny muted b" style="margin-bottom:4px">Распознанный текст</div>
        <div class="sm">${esc(text)}</div></div>`,
    });
    else s.set({
      title: 'AI распознал',
      body: `
        <div class="card flat" style="padding:12px 14px;margin-bottom:14px">
          <div class="tiny muted b" style="margin-bottom:4px">Ваша заметка</div><div class="sm">${esc(text)}</div>
        </div>
        ${block('Предпочтения', parsed.prefs, 'star', 'var(--p)')}
        ${block('Важно', parsed.care, 'alert', 'var(--warn)')}
        ${block('Следующий визит', parsed.next, 'calendar', 'var(--ok)')}`,
      footer: `<div class="btns"><button class="btn gh" data-a="vn.edit">Изменить</button><button class="btn p" data-a="vn.save">Сохранить</button></div>`,
    });
  };
  const block = (title, items, ic, color) => !items.length ? '' : `
    <div class="card" style="padding:13px 14px;margin-bottom:10px">
      <div class="row" style="gap:7px;margin-bottom:6px;color:${color}">${icon(ic, 15)}<b class="tiny" style="text-transform:uppercase;letter-spacing:.05em">${title}</b></div>
      <div class="sm" style="line-height:1.6">${items.map(x => '• ' + esc(x)).join('<br>')}</div>
    </div>`;

  on('vn.rec', () => { phase = 'rec'; draw(); haptic('medium'); });
  on('vn.stop', async () => {
    text = demo.text; phase = 'think'; draw();
    await wait(1500);
    parsed = parseNote(text);
    if (!parsed.prefs.length && !parsed.care.length && !parsed.next.length) parsed = { ...demo.ai, updated: now().toISOString() };
    phase = 'done'; draw(); haptic('success');
  });
  on('vn.type', async () => {
    const v = await promptSheet({ title: 'Заметка', label: 'Что важно помнить?', multiline: true, placeholder: 'Например: предпочитает нюдовые оттенки, чувствительная кожа' });
    if (!v) return;
    text = v; phase = 'think'; draw();
    await wait(1200);
    parsed = parseNote(text); phase = 'done'; draw();
  });
  on('vn.edit', () => { phase = 'idle'; draw(); });
  on('vn.save', () => {
    const cur = c.ai || { prefs: [], care: [], next: [] };
    const merge = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
    updateClient(clientId, {
      ai: { prefs: merge(cur.prefs, parsed.prefs), care: merge(cur.care, parsed.care), next: merge(cur.next, parsed.next), updated: now().toISOString() },
    });
    s.close(); toast('Заметка сохранена в карточке клиента', 'ai');
  });
  draw();
  return s;
}
on('vn.open', ds => voiceNoteSheet(ds.id));
