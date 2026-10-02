"""
Хранилище сервера: SQLite из стандартной библиотеки.

Почему не JSON-файл, как раньше. Общий склад `.run/shared.json` был
демо-решением: один файл перезаписывался целиком, а приложение выкладывало
справочник целиком с любого устройства — клиент, открывший страницу салона,
затирал правки владельца своим сидом. Для боевого режима нужна база, где
каждая сущность лежит отдельно, у каждой есть владелец (компания), а
изменения можно забирать «с такого-то момента».

Почему SQLite. Зависимостей у проекта нет и не будет: `sqlite3` входит
в стандартную библиотеку, даёт транзакции, переживает падение процесса и
спокойно держит нагрузку одного салона на десятки компаний. Бот и
приложение общаются с базой только через серверный HTTP, поэтому топология
(один контейнер, два, Fly, VPS) значения не имеет.

Модель данных — та же, что в `webapp/js/store.js`: коллекции `companies`,
`employees`, `services`, `appointments` и т. д. Сервер хранит сущность
целиком как JSON (`body`), а в колонки выносит только то, по чему ищет:
коллекцию, id, компанию, порядковый номер изменения `seq` и отметку
удаления. Благодаря этому экраны Mini App не переписываются: они получают
ровно те объекты, с которыми работали в localStorage.
"""
import json
import os
import sqlite3
import threading
import time

# Коллекции, которые синхронизируются с приложением. Всё, чего здесь нет,
# сервер не примет: защита от того, чтобы клиент положил в базу что угодно.
COLLECTIONS = (
    'companies', 'employees', 'services', 'clients', 'appointments', 'blocks',
    'incomes', 'expenses', 'recurring', 'reviews', 'broadcasts', 'invites',
    'inbox', 'tickets', 'logs', 'errors',
    # платформенные: у них нет компании
    'plans', 'notices', 'saBroadcasts', 'bans',
)
PLATFORM = {'plans', 'notices', 'saBroadcasts', 'bans'}
# Журнал и ошибки могут приходить без компании (старт приложения, Super Admin)
OPTIONAL_COMPANY = {'logs', 'errors', 'tickets'}

SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
  col        TEXT NOT NULL,
  id         TEXT NOT NULL,
  company_id TEXT NOT NULL DEFAULT '',
  tg_id      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  updated_at REAL NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (col, id)
);
CREATE INDEX IF NOT EXISTS entities_company ON entities(company_id, col);
CREATE INDEX IF NOT EXISTS entities_seq ON entities(seq);
CREATE INDEX IF NOT EXISTS entities_tg ON entities(tg_id, col);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS users (
  tg_id      TEXT PRIMARY KEY,
  name       TEXT,
  username   TEXT,
  phone      TEXT,
  lang       TEXT,
  home       TEXT,
  bound      TEXT NOT NULL DEFAULT '[]',
  last_company TEXT,
  first_seen REAL,
  last_seen  REAL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT UNIQUE,
  tg_id      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  ref        TEXT,
  company_id TEXT,
  text       TEXT NOT NULL,
  buttons    TEXT,
  due_at     REAL NOT NULL,
  sent_at    REAL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  cancelled  INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_due ON notifications(sent_at, cancelled, due_at);
CREATE INDEX IF NOT EXISTS notifications_ref ON notifications(ref);
"""


def company_of(col, body):
    """Компания сущности. У самой компании это её id, у платформенных — пусто."""
    if col == 'companies':
        return str(body.get('id') or '')
    if col in PLATFORM:
        return ''
    return str(body.get('companyId') or '')


class Store:
    """
    Одна база на процесс. Соединение на поток (sqlite не любит делить
    соединение между потоками), запись под общим замком: так `seq` растёт
    строго монотонно, и «изменения с момента N» никогда не теряют строку,
    записанную параллельным потоком.
    """

    def __init__(self, path):
        self.path = path
        if path != ':memory:':
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._local = threading.local()
        self._wlock = threading.RLock()
        # В памяти база одна на все потоки — иначе каждый поток получил бы
        # свою пустую. Это нужно только тестам.
        self._shared = None
        if path == ':memory:':
            self._shared = sqlite3.connect(':memory:', check_same_thread=False)
            self._shared.row_factory = sqlite3.Row
        with self.conn() as c:
            self._migrate(c)
            c.executescript(SCHEMA)
            c.execute("INSERT OR IGNORE INTO meta(k, v) VALUES ('seq', '0')")

    def _migrate(self, c):
        """База из первых сборок без колонки tg_id: добавляем и заполняем."""
        cols = [r[1] for r in c.execute('PRAGMA table_info(entities)')]
        if cols and 'tg_id' not in cols:
            c.execute("ALTER TABLE entities ADD COLUMN tg_id TEXT NOT NULL DEFAULT ''")
            for r in c.execute("SELECT col, id, body FROM entities WHERE col IN ('employees','clients')").fetchall():
                try:
                    tg = str(json.loads(r[2]).get('tgId') or '')
                except ValueError:
                    tg = ''
                c.execute('UPDATE entities SET tg_id=? WHERE col=? AND id=?', (tg, r[0], r[1]))
            c.commit()

    # ------------------------------------------------------------ соединение
    def conn(self):
        if self._shared is not None:
            return self._shared
        c = getattr(self._local, 'conn', None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=15, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA synchronous=NORMAL')
            c.execute('PRAGMA busy_timeout=15000')
            self._local.conn = c
        return c

    def close(self):
        c = getattr(self._local, 'conn', None)
        if c is not None:
            c.close()
            self._local.conn = None

    # ------------------------------------------------------------ seq
    def seq(self):
        row = self.conn().execute("SELECT v FROM meta WHERE k='seq'").fetchone()
        return int(row[0]) if row else 0

    def _next_seq(self, c):
        c.execute("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k='seq'")
        return int(c.execute("SELECT v FROM meta WHERE k='seq'").fetchone()[0])

    # ------------------------------------------------------------ чтение
    @staticmethod
    def _row(r):
        body = json.loads(r['body'])
        return {
            'col': r['col'], 'id': r['id'], 'companyId': r['company_id'],
            'body': body, 'deleted': bool(r['deleted']), 'seq': r['seq'],
            'updatedAt': r['updated_at'], 'updatedBy': r['updated_by'],
        }

    def get(self, col, eid):
        r = self.conn().execute('SELECT * FROM entities WHERE col=? AND id=?', (col, eid)).fetchone()
        return self._row(r) if r else None

    def body(self, col, eid):
        """Сущность как объект или None — для удалённых тоже None."""
        r = self.get(col, eid)
        return r['body'] if r and not r['deleted'] else None

    def list(self, col, company_id=None, include_deleted=False):
        sql = 'SELECT * FROM entities WHERE col=?'
        args = [col]
        if company_id is not None:
            sql += ' AND company_id=?'
            args.append(company_id)
        if not include_deleted:
            sql += ' AND deleted=0'
        sql += ' ORDER BY seq'
        return [self._row(r) for r in self.conn().execute(sql, args)]

    def bodies(self, col, company_id=None):
        return [r['body'] for r in self.list(col, company_id)]

    def company_rows(self, company_id, cols=None, include_deleted=False):
        """Все сущности компании разом — для выдачи состояния приложению."""
        sql = 'SELECT * FROM entities WHERE company_id=?'
        args = [company_id]
        if cols:
            sql += ' AND col IN (%s)' % ','.join('?' * len(cols))
            args.extend(cols)
        if not include_deleted:
            sql += ' AND deleted=0'
        sql += ' ORDER BY seq'
        return [self._row(r) for r in self.conn().execute(sql, args)]

    def since(self, seq, company_ids=None, platform=True):
        """
        Изменения после seq, включая удаления: приложение забирает их
        периодически и вливает в свою копию. company_ids=None — все компании
        (для Super Admin).
        """
        sql = 'SELECT * FROM entities WHERE seq>?'
        args = [seq]
        if company_ids is not None:
            parts = []
            if company_ids:
                parts.append('company_id IN (%s)' % ','.join('?' * len(company_ids)))
                args.extend(company_ids)
            if platform:
                parts.append("company_id=''")
            if not parts:
                return []
            sql += ' AND (%s)' % ' OR '.join(parts)
        sql += ' ORDER BY seq'
        return [self._row(r) for r in self.conn().execute(sql, args)]

    def all_companies(self):
        return self.bodies('companies')

    # ------------------------------------------------------------ запись
    def put(self, col, body, by=None, company_id=None):
        """Положить или заменить сущность. Возвращает seq записи."""
        if col not in COLLECTIONS:
            raise ValueError('unknown collection: %s' % col)
        eid = str(body.get('id') or '')
        if not eid:
            raise ValueError('entity without id')
        cid = company_id if company_id is not None else company_of(col, body)
        tg = str(body.get('tgId') or '') if col in ('employees', 'clients') else ''
        with self._wlock:
            c = self.conn()
            seq = self._next_seq(c)
            c.execute(
                'INSERT INTO entities(col,id,company_id,tg_id,body,deleted,seq,updated_at,updated_by) '
                'VALUES (?,?,?,?,?,0,?,?,?) '
                'ON CONFLICT(col,id) DO UPDATE SET company_id=excluded.company_id, tg_id=excluded.tg_id, '
                'body=excluded.body, deleted=0, seq=excluded.seq, updated_at=excluded.updated_at, '
                'updated_by=excluded.updated_by',
                (col, eid, cid, tg, json.dumps(body, ensure_ascii=False), seq, time.time(), by))
            c.commit()
            return seq

    def by_tg(self, col, tg_id):
        """Живые карточки с этим telegram-id — членство и карточки клиента."""
        if not tg_id:
            return []
        return [self._row(r) for r in self.conn().execute(
            'SELECT * FROM entities WHERE tg_id=? AND col=? AND deleted=0', (str(tg_id), col))]

    def delete(self, col, eid, by=None):
        """Удаление — это надгробие: строка остаётся, чтобы другие устройства узнали."""
        with self._wlock:
            c = self.conn()
            row = c.execute('SELECT deleted FROM entities WHERE col=? AND id=?', (col, eid)).fetchone()
            if row is None:
                return None
            seq = self._next_seq(c)
            c.execute('UPDATE entities SET deleted=1, seq=?, updated_at=?, updated_by=? WHERE col=? AND id=?',
                      (seq, time.time(), by, col, eid))
            c.commit()
            return seq

    def transaction(self):
        """Замок на серию записей: push из приложения должен лечь целиком."""
        return self._wlock

    # ------------------------------------------------------------ пользователи
    def user(self, tg_id):
        r = self.conn().execute('SELECT * FROM users WHERE tg_id=?', (str(tg_id),)).fetchone()
        if not r:
            return None
        u = dict(r)
        u['bound'] = json.loads(u.get('bound') or '[]')
        return u

    def touch_user(self, tg_id, name=None, username=None, lang=None, home=None, bind=None,
                   last_company=None, phone=None):
        """Завести или обновить человека. Пустые значения не затирают известные."""
        tg_id = str(tg_id)
        now = time.time()
        with self._wlock:
            c = self.conn()
            cur = self.user(tg_id)
            if cur is None:
                cur = {'tg_id': tg_id, 'name': '', 'username': '', 'phone': '', 'lang': '',
                       'home': '', 'bound': [], 'last_company': '', 'first_seen': now, 'last_seen': now}
            if name:
                cur['name'] = name
            if username is not None:
                cur['username'] = username or ''
            if lang:
                cur['lang'] = lang
            if phone:
                cur['phone'] = phone
            if home:
                cur['home'] = home
            if last_company is not None:
                cur['last_company'] = last_company
            if bind and bind not in cur['bound']:
                cur['bound'].append(bind)
            cur['last_seen'] = now
            c.execute(
                'INSERT INTO users(tg_id,name,username,phone,lang,home,bound,last_company,first_seen,last_seen) '
                'VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET name=excluded.name, '
                'username=excluded.username, phone=excluded.phone, lang=excluded.lang, home=excluded.home, '
                'bound=excluded.bound, last_company=excluded.last_company, last_seen=excluded.last_seen',
                (tg_id, cur['name'], cur['username'], cur['phone'], cur['lang'], cur['home'],
                 json.dumps(cur['bound']), cur['last_company'], cur['first_seen'], cur['last_seen']))
            c.commit()
            return cur

    def users(self):
        return [dict(r) for r in self.conn().execute('SELECT * FROM users ORDER BY last_seen DESC')]

    # ------------------------------------------------------------ уведомления
    def schedule(self, key, tg_id, kind, text, due_at, ref=None, company_id=None, buttons=None):
        """
        Поставить уведомление в очередь. key уникален: повторная постановка
        (например, после переноса записи) заменяет ещё не отправленное и
        не трогает отправленное — второго напоминания человек не получит.
        """
        with self._wlock:
            c = self.conn()
            row = c.execute('SELECT id, sent_at FROM notifications WHERE key=?', (key,)).fetchone()
            if row and row['sent_at']:
                return None
            if row:
                c.execute('UPDATE notifications SET tg_id=?, text=?, buttons=?, due_at=?, cancelled=0, '
                          'attempts=0, error=NULL, ref=?, company_id=? WHERE id=?',
                          (str(tg_id), text, json.dumps(buttons or []), due_at, ref, company_id, row['id']))
                c.commit()
                return row['id']
            c.execute('INSERT INTO notifications(key,tg_id,kind,ref,company_id,text,buttons,due_at,created_at) '
                      'VALUES (?,?,?,?,?,?,?,?,?)',
                      (key, str(tg_id), kind, ref, company_id, text, json.dumps(buttons or []), due_at, time.time()))
            c.commit()
            return c.execute('SELECT last_insert_rowid()').fetchone()[0]

    def cancel_notifications(self, ref, kinds=None):
        """Снять неотправленные уведомления по записи (отмена, перенос)."""
        with self._wlock:
            c = self.conn()
            sql = 'UPDATE notifications SET cancelled=1 WHERE ref=? AND sent_at IS NULL'
            args = [ref]
            if kinds:
                sql += ' AND kind IN (%s)' % ','.join('?' * len(kinds))
                args.extend(kinds)
            c.execute(sql, args)
            c.commit()

    def due_notifications(self, now, limit=50):
        rows = self.conn().execute(
            'SELECT * FROM notifications WHERE sent_at IS NULL AND cancelled=0 AND due_at<=? AND attempts<6 '
            'ORDER BY due_at LIMIT ?', (now, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d['buttons'] = json.loads(d.get('buttons') or '[]')
            out.append(d)
        return out

    def mark_sent(self, nid, ok, error=None):
        with self._wlock:
            c = self.conn()
            if ok:
                # error при ok — пометка «доставить нельзя» (человек заблокировал бота):
                # очередь закрывается, причина остаётся видна в панели
                c.execute('UPDATE notifications SET sent_at=?, attempts=attempts+1, error=? WHERE id=?',
                          (time.time(), str(error)[:300] if error else None, nid))
            else:
                c.execute('UPDATE notifications SET attempts=attempts+1, error=? WHERE id=?',
                          (str(error or '')[:300], nid))
            c.commit()

    def notifications_for(self, ref=None, tg_id=None, company_id=None, limit=100):
        sql = 'SELECT * FROM notifications WHERE 1=1'
        args = []
        if ref:
            sql += ' AND ref=?'
            args.append(ref)
        if tg_id:
            sql += ' AND tg_id=?'
            args.append(str(tg_id))
        if company_id:
            sql += ' AND company_id=?'
            args.append(company_id)
        sql += ' ORDER BY due_at DESC LIMIT ?'
        args.append(limit)
        out = []
        for r in self.conn().execute(sql, args):
            d = dict(r)
            d['buttons'] = json.loads(d.get('buttons') or '[]')
            out.append(d)
        return out

    def stats(self):
        c = self.conn()
        ent = c.execute('SELECT col, COUNT(*) n FROM entities WHERE deleted=0 GROUP BY col').fetchall()
        q = c.execute('SELECT COUNT(*) FROM notifications WHERE sent_at IS NULL AND cancelled=0').fetchone()[0]
        f = c.execute('SELECT COUNT(*) FROM notifications WHERE sent_at IS NULL AND cancelled=0 AND attempts>=6').fetchone()[0]
        return {
            'entities': {r['col']: r['n'] for r in ent},
            'users': c.execute('SELECT COUNT(*) FROM users').fetchone()[0],
            'queued': q, 'failed': f, 'seq': self.seq(),
            'sizeBytes': os.path.getsize(self.path) if self.path != ':memory:' and os.path.exists(self.path) else 0,
        }
