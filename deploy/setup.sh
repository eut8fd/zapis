#!/usr/bin/env bash
# Разворачивает Zapis на чистом Ubuntu/Debian: статика + бот + HTTPS.
# Идемпотентен — можно запускать повторно для обновления.
#
# Запуск на сервере (из каталога с проектом):
#   sudo BOT_TOKEN=... bash deploy/setup.sh
#
# Домен не обязателен: если не задан, берётся <ip>.sslip.io — он резолвится
# в этот же IP, и Let's Encrypt спокойно выдаёт на него сертификат.

set -euo pipefail

APP_DIR=/opt/zapis
DATA_DIR=/var/lib/zapis
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m==\033[0m %s\n' "$1"; }
ok() { printf '   \033[0;32m%s\033[0m\n' "$1"; }
die() { printf '\n\033[0;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die 'Запускать под root: sudo bash deploy/setup.sh'
[ -n "${BOT_TOKEN:-}" ] || die 'Не задан BOT_TOKEN. Пример: sudo BOT_TOKEN=123:abc bash deploy/setup.sh'

# --- пакеты (ставим первыми: дальше нужны curl и gpg) -----------------------
say 'Устанавливаю пакеты'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 curl ca-certificates gnupg \
  debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# --- домен ------------------------------------------------------------------
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$IP" ] || IP="$(curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)"
  [ -n "$IP" ] || IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$IP" ] || die 'Не удалось определить внешний IP — задайте DOMAIN вручную'
  DOMAIN="${IP//./-}.sslip.io"
  say "Домен не задан — использую $DOMAIN"
  ok "sslip.io резолвит это имя в $IP, сертификат выпустится автоматически"
fi
URL="https://${DOMAIN}"

if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
ok "python3 $(python3 -V 2>&1 | awk '{print $2}') · caddy $(caddy version | head -1)"

# --- пользователь и файлы ---------------------------------------------------
say 'Раскладываю файлы'
id -u zapis >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin zapis
mkdir -p "$APP_DIR" "$DATA_DIR"

# исходники: всё кроме локального мусора
for d in webapp bot server deploy; do
  rm -rf "${APP_DIR:?}/$d"
  cp -r "$SRC/$d" "$APP_DIR/$d"
done

cat > "$APP_DIR/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
WEBAPP_URL=${URL}
BRAND_NAME=${BRAND_NAME:-Zapis}
BOT_NAME=${BOT_NAME:-}
SUPPORT_USERNAME=${SUPPORT_USERNAME:-}
ADMIN_TG_IDS=${ADMIN_TG_IDS:-}
ADMIN_CODE=${ADMIN_CODE:-}
DATA_DIR=${DATA_DIR}
EOF
chmod 600 "$APP_DIR/.env"
chown -R zapis:zapis "$APP_DIR" "$DATA_DIR"
ok "проект в $APP_DIR, данные в $DATA_DIR"

# --- systemd ----------------------------------------------------------------
say 'Настраиваю сервисы'
cat > /etc/systemd/system/zapis-web.service <<'EOF'
[Unit]
Description=Zapis — Mini App static server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=zapis
WorkingDirectory=/opt/zapis
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 -u /opt/zapis/server/serve.py 8080
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/zapis-bot.service <<'EOF'
[Unit]
Description=Zapis — Telegram bot
After=network-online.target zapis-web.service
Wants=network-online.target

[Service]
Type=simple
User=zapis
WorkingDirectory=/opt/zapis
EnvironmentFile=/opt/zapis/.env
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONIOENCODING=utf-8
ExecStart=/usr/bin/python3 -u /opt/zapis/bot/bot.py
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ReadWritePaths=/var/lib/zapis

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode zstd gzip
	header -Server
	reverse_proxy 127.0.0.1:8080
}
EOF

systemctl daemon-reload
systemctl enable --now zapis-web zapis-bot >/dev/null 2>&1 || true
systemctl restart zapis-web zapis-bot
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ok 'zapis-web, zapis-bot, caddy запущены'

# --- проверка ---------------------------------------------------------------
say 'Проверяю'
sleep 3
code_local="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/index.html || true)"
[ "$code_local" = "200" ] && ok "локальная статика: 200" || die "статика не отвечает (код $code_local). journalctl -u zapis-web -n 30"

printf '   жду сертификат'
code_pub=000
for _ in $(seq 1 30); do
  printf '.'
  code_pub="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${URL}/index.html" || true)"
  [ "$code_pub" = "200" ] && break
  sleep 4
done
printf '\n'
[ "$code_pub" = "200" ] && ok "публичный адрес: 200" || echo "   !! публичный адрес пока отдаёт $code_pub — проверьте, что порты 80/443 открыты"

for _ in $(seq 1 10); do
  systemctl is-active --quiet zapis-bot && break
  sleep 2
done
systemctl is-active --quiet zapis-bot && ok 'бот работает' || echo '   !! бот не поднялся: journalctl -u zapis-bot -n 30'

cat <<EOF

  ────────────────────────────────────────────────
  Готово.

  Приложение : ${URL}
  Бот        : откройте в Telegram и нажмите /start

  Логи       : journalctl -u zapis-bot -f
  Перезапуск : systemctl restart zapis-bot zapis-web
  Остановить : systemctl disable --now zapis-bot zapis-web
  ────────────────────────────────────────────────

EOF
