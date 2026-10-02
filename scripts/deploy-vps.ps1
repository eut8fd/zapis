<#
  Разворачивает демо на сервере одной командой.

    scripts\deploy-vps.ps1 -Server root@203.0.113.10
    scripts\deploy-vps.ps1 -Server root@203.0.113.10 -Domain demo.example.com

  Домен не обязателен: без него используется <ip>.sslip.io — это имя резолвится
  в тот же IP, и Let's Encrypt выдаёт на него настоящий сертификат.
  Покупать домен ради показа не нужно.

  Что делает:
    1. проверяет доступность сервера по SSH;
    2. копирует webapp/, bot/, server/, deploy/ (без .env и локальных данных);
    3. запускает deploy/setup.sh — ставит python, caddy, systemd-сервисы, HTTPS;
    4. проверяет, что публичный адрес отвечает, и переключает бота на него.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,   # user@host
  [string]$Domain = '',
  [string]$Token = '',
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Write-Host 'Не найден ssh. Установите OpenSSH Client в «Дополнительных компонентах» Windows.' -ForegroundColor Red
  exit 1
}

# --- токен ------------------------------------------------------------------
if (-not $Token) {
  $m = Select-String -Path "$root\.env" -Pattern '^BOT_TOKEN=(.*)$'
  if ($m) { $Token = $m.Matches.Groups[1].Value.Trim() }
}
if (-not $Token) { Write-Host 'Не найден BOT_TOKEN — укажите -Token' -ForegroundColor Red; exit 1 }

# --- связь ------------------------------------------------------------------
Step "Проверяю связь с $Server"
$probe = ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new $Server 'echo ok; . /etc/os-release 2>/dev/null && echo $PRETTY_NAME' 2>&1
if ($LASTEXITCODE -ne 0 -or "$probe" -notmatch 'ok') {
  Write-Host "   не подключиться: $probe" -ForegroundColor Red
  Write-Host '   нужен ключ без пароля: ssh-keygen, затем скопировать ~/.ssh/id_rsa.pub на сервер' -ForegroundColor Yellow
  exit 1
}
Ok (($probe -split "`n" | Select-Object -Last 1).Trim())

# --- загрузка ---------------------------------------------------------------
if (-not $SkipUpload) {
  Step 'Копирую проект'
  ssh $Server 'rm -rf /tmp/zapis-src && mkdir -p /tmp/zapis-src' | Out-Null

  $tar = Join-Path $env:TEMP 'zapis-src.tar'
  if (Test-Path $tar) { Remove-Item $tar -Force }
  # tar есть в Windows 10+; .env, локальные данные и кэш не берём
  & tar -C $root -cf $tar `
    --exclude='bot/users.json' --exclude='bot/tests/.run-tests' --exclude='server/tests/.run-tests' `
    --exclude='__pycache__' --exclude='*.pyc' `
    webapp bot server deploy
  if ($LASTEXITCODE -ne 0) { Write-Host '   не удалось упаковать проект' -ForegroundColor Red; exit 1 }
  $mb = [math]::Round((Get-Item $tar).Length / 1MB, 2)

  & scp -q $tar "${Server}:/tmp/zapis-src.tar"
  if ($LASTEXITCODE -ne 0) { Write-Host '   не удалось скопировать' -ForegroundColor Red; exit 1 }
  ssh $Server 'tar -xf /tmp/zapis-src.tar -C /tmp/zapis-src && rm -f /tmp/zapis-src.tar' | Out-Null
  Remove-Item $tar -Force
  Ok "загружено $mb МБ"
}

# --- установка --------------------------------------------------------------
Step 'Ставлю и запускаю на сервере'
Write-Host '   (первый раз занимает 1–3 минуты: пакеты и сертификат)' -ForegroundColor DarkGray

$envs = "BOT_TOKEN='$Token'"
if ($Domain) { $envs += " DOMAIN='$Domain'" }
$brand = (Select-String -Path "$root\.env" -Pattern '^BRAND_NAME=(.*)$')
if ($brand) { $envs += " BRAND_NAME='$($brand.Matches.Groups[1].Value.Trim())'" }
$botname = (Select-String -Path "$root\.env" -Pattern '^BOT_NAME=(.*)$')
if ($botname -and $botname.Matches.Groups[1].Value.Trim()) { $envs += " BOT_NAME='$($botname.Matches.Groups[1].Value.Trim())'" }

ssh $Server "cd /tmp/zapis-src && sudo $envs bash deploy/setup.sh"
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n   установка завершилась с ошибкой. Логи: ssh $Server 'journalctl -u zapis-bot -n 40'" -ForegroundColor Red
  exit 1
}

# --- итоговый адрес ---------------------------------------------------------
$url = ssh $Server "grep '^WEBAPP_URL=' /opt/zapis/.env | cut -d= -f2-"
$url = "$url".Trim()

Step 'Проверяю снаружи'
try {
  $code = (Invoke-WebRequest "$url/index.html" -UseBasicParsing -TimeoutSec 30).StatusCode
  Ok "$url -> HTTP $code"
}
catch {
  Warn "$url пока не отвечает: $($_.Exception.Message)"
  Warn 'если только что выпускался сертификат — подождите минуту и откройте в браузере'
}

Write-Host "`n================ Готово ================" -ForegroundColor Yellow
Write-Host "  Приложение : $url"
Write-Host "  Бот        : t.me/Demotelaibot -> /start"
Write-Host ""
Write-Host "  Логи бота  : ssh $Server 'journalctl -u zapis-bot -f'"
Write-Host "  Обновить   : scripts\deploy-vps.ps1 -Server $Server"
Write-Host "  Выключить  : ssh $Server 'sudo systemctl disable --now zapis-bot zapis-web'"
Write-Host "========================================`n"

Write-Host 'Локальные туннель и сторож больше не нужны — остановить: scripts\stop-demo.ps1' -ForegroundColor DarkGray
