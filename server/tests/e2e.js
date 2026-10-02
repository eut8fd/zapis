/* Сквозной сценарий: сервер + Mini App в Chromium. Нужен Playwright: node server/tests/e2e.js */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = path.join(require('os').tmpdir(), 'zapis-e2e');
fs.mkdirSync(SCRATCH, { recursive: true });
const PORT = 8091;
const DATA_DIR = path.join(SCRATCH, 'e2e-run');
const SHOTS = path.join(SCRATCH, 'shots');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
function check(cond, msg) { if (cond) console.log('  ok   ' + msg); else { console.log('  FAIL ' + msg); fails.push(msg); } }

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/v2/ping'); if (r.ok) return; } catch (e) { }
    await sleep(250);
  }
  throw new Error('server did not start');
}

const SCREEN_LOOP = `(async () => {
  const R = await import('/js/router.js');
  for (let i = 0; i < 40 && !R.routes['cl.company']; i++) await new Promise(r => setTimeout(r, 100));
  const St = await import('/js/store.js');
  const dev = await import('/js/dev.js');
  const errs = [];
  const roles = ROLES;
  for (const lg of LANGS) {
    St.setLang(lg);
    for (const role of roles) {
      if (role) dev.switchRole(role);
      for (const n of Object.keys(R.routes)) {
        const d = R.routes[n];
        try {
          if (d.perm && !St.can(d.perm)) continue;
          if (typeof d.render({ id: (St.staff()[0] || {}).id || '' }) !== 'string') errs.push([lg, role, n, 'не строка']);
        } catch (e) { errs.push([lg, role, n, e.message]); }
      }
    }
  }
  St.setLang('ru');
  return errs;
})()`;

async function main() {
  const server = spawn('python3', [path.join(ROOT, 'server/serve.py'), String(PORT)], {
    env: { ...process.env, DEV_AUTH: '1', BOT_TOKEN: '', ADMIN_TG_IDS: '999', DATA_DIR, WEBAPP_URL: BASE, PAYMENT_NOTE: 'Kaspi: +7 777 000 00 00, в комментарии — название салона.' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', d => log.push(String(d)));
  server.stderr.on('data', d => log.push(String(d)));
  try {
    await waitReady();
    const browser = await chromium.launch();
    const errors = [];
    const newPage = async (url) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('#boot') && document.querySelector('#screen'), null, { timeout: 15000 });
      return { ctx, page };
    };

    // ---------------------------------------------------------------- 1. демо-режим
    console.log('\n[1] демо-режим без авторизации');
    {
      const { ctx, page } = await newPage(BASE + '/index.html?start=c1');
      const mode = await page.evaluate(() => window.__zapis.isServer());
      check(mode === false, 'без initData приложение в демо-режиме');
      const errs = await page.evaluate(SCREEN_LOOP.replace('ROLES', JSON.stringify(['client', 'employee', 'manager', 'owner', 'admin'])).replace('LANGS', JSON.stringify(['ru', 'kk', 'en'])));
      check(errs.length === 0, 'все экраны во всех ролях и языках отрисовались: ' + JSON.stringify(errs).slice(0, 300));
      await page.screenshot({ path: path.join(SHOTS, 'demo-client.png') });
      await ctx.close();
    }

    // ---------------------------------------------------------------- 2. владелец создаёт компанию
    console.log('\n[2] серверный режим: онбординг владельца');
    let companyId = null;
    {
      const { ctx, page } = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('1001:Асель Владелец') + '&start=onboarding');
      check(await page.evaluate(() => window.__zapis.isServer()), 'вход по dev-идентити — серверный режим');
      await page.click('[data-a="ob.begin"]');
      await page.fill('#_n', 'Студия Асель');
      await page.click('[data-a="ob.dir"][data-v="Салон красоты"]');
      await page.click('[data-a="ob.s2"]');
      await page.click('[data-a="ob.s3"]');
      await page.fill('#_sn', 'Маникюр');
      await page.fill('#_sp', '7000');
      await page.click('[data-a="ob.finish"]');
      await page.waitForSelector('[data-a="ob.openAdmin"]', { timeout: 15000 });
      await page.screenshot({ path: path.join(SHOTS, 'onb-done.png') });
      companyId = await page.evaluate(() => window.__zapis.S.session.companyId);
      check(/^co_/.test(companyId || ''), 'компания создана: ' + companyId);
      const ses = await page.evaluate(() => (window.__zapis.S.session.role));
      check(ses === 'owner', 'роль после онбординга — владелец');
      await page.click('[data-a="ob.openAdmin"]');
      await page.waitForSelector('.tabbar');
      await page.screenshot({ path: path.join(SHOTS, 'owner-home.png') });
      // адрес и телефон — через настройки
      await page.click('[data-a="tab"][data-r="o.more"]');
      await page.click('[data-a="nav"][data-r="o.settings"]');
      await page.click('[data-a="set.company"]');
      await page.fill('#_a', 'ул. Абая 10');
      await page.fill('#_p', '+7 701 123 45 67');
      await page.click('[data-a="set.companySave"]');
      await sleep(1200);
      const srv = await fetch(BASE + '/api/v2/boot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent('1001:Асель Владелец') }, body: '{"start":"owner"}' }).then(r => r.json());
      const co = srv.data.companies.find(c => c.id === companyId);
      check(co && co.addr === 'ул. Абая 10', 'адрес дошёл до сервера');
      check(srv.data.employees.find(e => e.isOwner).name === 'Асель Владелец', 'владелец назван именем из Telegram');
      check(srv.memberships.length === 1 && srv.memberships[0].isOwner, 'членство владельца на сервере');
      await page.screenshot({ path: path.join(SHOTS, 'owner-settings.png') });
      await ctx.close();
    }

    // ---------------------------------------------------------------- 3. клиент записывается
    console.log('\n[3] клиент записывается по ссылке салона');
    let apptId = null;
    {
      const { ctx, page } = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('2002:Дана Клиент') + '&start=' + companyId);
      const role = await page.evaluate(() => window.__zapis.S.session.role);
      check(role === 'client', 'по ссылке салона человек — клиент');
      const seen = await page.evaluate(() => ({ cos: window.__zapis.S.data.companies.length, cls: window.__zapis.S.data.clients.length, emps: window.__zapis.S.data.employees.map(e => Object.keys(e).includes('phone')) }));
      check(seen.cos === 1 && seen.cls === 0, 'клиент видит только свой салон и ни одного чужого клиента');
      check(seen.emps.every(x => !x), 'телефоны мастеров клиенту не отданы');
      await page.screenshot({ path: path.join(SHOTS, 'client-company.png') });
      await page.click('[data-a="cl.start"]');
      await page.click('[data-a="bk.svc"]');
      await page.click('[data-a="bk.emp"][data-id=""]');
      await page.waitForSelector('[data-a="bk.date"]:not([disabled])');
      await page.screenshot({ path: path.join(SHOTS, 'client-month.png') });
      const days = await page.$$('[data-a="bk.date"]:not([disabled])');
      // первый день с местами, но не сегодня (сегодня может не быть окон)
      let clicked = false;
      for (const d of days) {
        const txt = (await d.getAttribute('class')) || '';
        if (txt.includes('off') || txt.includes('past')) continue;
        await d.click(); clicked = true; break;
      }
      check(clicked, 'выбран день в календаре');
      await page.waitForSelector('[data-a="bk.slot"]', { timeout: 8000 });
      await page.click('[data-a="bk.slot"]');
      await page.screenshot({ path: path.join(SHOTS, 'client-slots.png') });
      await page.click('[data-a="bk.confirm"]');
      await page.waitForSelector('[data-a="cl.goMy"]', { timeout: 15000 });
      await page.screenshot({ path: path.join(SHOTS, 'client-success.png') });
      apptId = await page.evaluate(() => window.__zapis.S.data.appointments.find(a => !a.anon).id);
      check(!!apptId, 'запись создана: ' + apptId);
      const srv = await fetch(BASE + '/api/v2/boot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent('2002:Дана Клиент') }, body: JSON.stringify({ start: companyId }) }).then(r => r.json());
      const a = srv.data.appointments.find(x => x.id === apptId);
      check(a && a.status === 'planned' && a.price === 7000, 'запись на сервере с ценой из прайса');
      const cl = srv.data.clients[0];
      check(cl && cl.tgId === '2002', 'карточка клиента привязана к telegram-id');
      await page.click('[data-a="cl.goMy"]');
      await page.waitForSelector('.upc');
      await page.screenshot({ path: path.join(SHOTS, 'client-my.png') });
      await ctx.close();
    }

    // ---------------------------------------------------------------- 4. владелец видит запись и уведомление
    console.log('\n[4] владелец видит запись');
    {
      const { ctx, page } = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('1001:Асель Владелец') + '&start=owner');
      const got = await page.evaluate(() => {
        const S = window.__zapis.S;
        return { appts: S.data.appointments.length, clients: S.data.clients.map(c => c.name), inbox: (S.data.inbox || []).map(m => m.kind), role: S.session.role };
      });
      check(got.role === 'owner', 'владелец вошёл в кабинет без параметров');
      check(got.appts === 1, 'владелец видит запись клиента');
      check(got.clients.includes('Дана Клиент'), 'клиент появился в базе владельца');
      check(got.inbox.includes('booking'), 'в уведомлениях владельца есть «новая запись»');
      await page.screenshot({ path: path.join(SHOTS, 'owner-home-booked.png') });
      await page.click('[data-a="tab"][data-r="o.cal"]');
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, 'owner-cal.png') });
      await page.click('[data-a="tab"][data-r="o.home"]');
      await page.click('[data-a="nav"][data-r="o.notifications"]');
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, 'owner-notifications.png') });
      // полный прогон экранов владельца
      const errs = await page.evaluate(SCREEN_LOOP.replace('ROLES', JSON.stringify([null])).replace('LANGS', JSON.stringify(['ru', 'kk', 'en'])));
      check(errs.length === 0, 'экраны владельца в серверном режиме: ' + JSON.stringify(errs).slice(0, 300));
      // перенос записи владельцем → уведомление клиенту
      await page.evaluate(id => { const S = window.__zapis.S; const a = S.data.appointments.find(x => x.id === id); a.start = new Date(new Date(a.start).getTime() + 3600000).toISOString(); window.__zapis.emit(); }, apptId);
      await sleep(1500);
      await ctx.close();
    }

    // ---------------------------------------------------------------- 5. очередь уведомлений
    console.log('\n[5] очередь уведомлений на сервере');
    {
      const tok = fs.readFileSync(path.join(DATA_DIR, 'internal.token'), 'utf-8').trim();
      const q = await fetch(BASE + '/api/v2/internal/queue', { headers: { 'X-Internal-Token': tok } }).then(r => r.json());
      const kinds = q.queue.filter(n => !n.cancelled).map(n => n.kind + '→' + n.tg_id).sort();
      console.log('  очередь:', kinds.join(', '));
      check(kinds.some(k => k.startsWith('new→1001')), 'владельцу поставлено «новая запись»');
      check(kinds.some(k => k.startsWith('moved→2002')), 'клиенту поставлено «запись перенесена»');
      check(kinds.some(k => k.startsWith('review→2002')), 'клиенту поставлена просьба об отзыве');
      const cat = await fetch(BASE + '/api/v2/internal/catalog', { headers: { 'X-Internal-Token': tok } }).then(r => r.json());
      check(cat.companies.some(c => c.id === companyId && c.ready), 'салон готов в справочнике бота');
    }

    // ---------------------------------------------------------------- 6. мастер по приглашению
    console.log('\n[6] приглашение мастера');
    {
      const { ctx, page } = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('1001:Асель Владелец') + '&start=owner');
      await page.click('[data-a="tab"][data-r="o.team"]');
      await page.click('[data-a="tm.invite"]');
      await page.click('[data-a="tm.invMake"]');
      await page.waitForSelector('[data-a="tm.invSend"]');
      const link = await page.getAttribute('[data-a="tm.invSend"]', 'data-link');
      const invId = link.split('start=')[1];
      await sleep(1200);
      await ctx.close();
      const m = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('3003:Иван Мастер') + '&start=' + invId);
      await m.page.waitForSelector('[data-a="inv.accept"]', { timeout: 10000 });
      await m.page.screenshot({ path: path.join(SHOTS, 'invite.png') });
      check((await m.page.inputValue('#_in')) === 'Иван Мастер', 'имя подставлено из личности');
      await m.page.click('[data-a="inv.accept"]');
      await m.page.waitForFunction(() => location.hash.includes('e.home'), null, { timeout: 15000 });
      const st = await m.page.evaluate(() => ({ role: window.__zapis.S.session.role, fin: window.__zapis.S.data.incomes.length, appts: window.__zapis.S.data.appointments.map(a => !!a.anon) }));
      check(st.role === 'employee', 'мастер вошёл в команду');
      check(st.fin === 0, 'мастер не видит финансов');
      await m.page.screenshot({ path: path.join(SHOTS, 'employee-home.png') });
      const errs = await m.page.evaluate(SCREEN_LOOP.replace('ROLES', JSON.stringify([null])).replace('LANGS', JSON.stringify(['ru'])));
      check(errs.length === 0, 'экраны мастера: ' + JSON.stringify(errs).slice(0, 300));
      await m.ctx.close();
    }

    // ---------------------------------------------------------------- 7. админ
    console.log('\n[7] администратор платформы');
    {
      const { ctx, page } = await newPage(BASE + '/index.html?dev=' + encodeURIComponent('999:Админ') + '&start=admin');
      check(await page.evaluate(() => window.__zapis.S.session.role) === 'admin', 'админ в панели');
      await page.screenshot({ path: path.join(SHOTS, 'admin-home.png') });
      const errs = await page.evaluate(SCREEN_LOOP.replace('ROLES', JSON.stringify([null])).replace('LANGS', JSON.stringify(['ru'])));
      check(errs.length === 0, 'экраны админа: ' + JSON.stringify(errs).slice(0, 300));
      await ctx.close();
    }

    const realErrors = errors.filter(e => !/favicon|telegram-web-app|net::ERR|Failed to load resource/.test(e));
    check(realErrors.length === 0, 'ошибок в консоли нет: ' + realErrors.slice(0, 5).join(' | '));
    await browser.close();
  } finally {
    server.kill();
    if (fails.length) { console.log('\nПРОВАЛЫ:', fails.length); console.log(log.join('').split('\n').filter(l => !/" 200 -/.test(l)).slice(-30).join('\n')); process.exit(1); }
    console.log('\nВСЁ ПРОШЛО');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
