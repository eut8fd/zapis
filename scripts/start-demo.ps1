<#
  Запуск демо одной командой:
    1) поднимает статический сервер с Mini App;
    2) открывает https-туннель Cloudflare (quick tunnel, без аккаунта);
    3) прописывает полученный адрес боту и включает кнопку меню;
    4) запускает бота.

  Остановка — Ctrl+C (фоновые процессы закрываются автоматически).
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [switch]$NoTunnel,          # только локальный сервер, без туннеля и бота
  [string]$Url = ''           # использовать готовый https-адрес вместо туннеля
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root 'tools'
$LogDir = Join-Path $Root '.run'
New-Item -ItemType Directory -Force -Path $Tools, $LogDir | Out-Null

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

Write-Host ''
Write-Host '  Zapis demo' -ForegroundColor White
Write-Host '  ----------' -ForegroundColor DarkGray

# --- python -----------------------------------------------------------------
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { throw 'Python не найден. Установите Python 3 и повторите.' }

# --- 1. статический сервер --------------------------------------------------
Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*serve.py*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$serveLog = Join-Path $LogDir 'server.log'
$server = Start-Process -FilePath $py.Source `
  -ArgumentList "-u `"$Root\server\serve.py`" $Port" `
  -RedirectStandardOutput $serveLog -RedirectStandardError "$serveLog.err" `
  -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 900
try {
  $code = (Invoke-WebRequest "http://localhost:$Port/index.html" -UseBasicParsing -TimeoutSec 5).StatusCode
  Ok "сервер   : http://localhost:$Port  (HTTP $code)"
} catch {
  throw "Сервер не поднялся на порту $Port. Лог: $serveLog.err"
}

if ($NoTunnel) {
  Ok 'режим    : только локальный сервер'
  Write-Host ''
  Write-Host "  Откройте http://localhost:$Port в браузере. Ctrl+C — выход." -ForegroundColor DarkGray
  try { while ($true) { Start-Sleep -Seconds 3600 } } finally { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  return
}

# --- 2. cloudflared ---------------------------------------------------------
$public = $Url
$tunnel = $null

if (-not $public) {
  $cf = Join-Path $Tools 'cloudflared.exe'
  if (-not (Test-Path $cf)) {
    Info 'скачиваю cloudflared (≈50 МБ, один раз)…'
    $src = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    try {
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $src -OutFile $cf -UseBasicParsing
    } catch {
      Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
      throw "Не удалось скачать cloudflared: $($_.Exception.Message)"
    }
  }

  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $tunLog = Join-Path $LogDir 'tunnel.log'
  if (Test-Path $tunLog) { Remove-Item $tunLog -Force }
  $tunnel = Start-Process -FilePath $cf `
    -ArgumentList "tunnel --no-autoupdate --url http://localhost:$Port" `
    -RedirectStandardOutput "$tunLog.out" -RedirectStandardError $tunLog `
    -WindowStyle Hidden -PassThru

  Info 'поднимаю https-туннель…'
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not $public) {
    Start-Sleep -Milliseconds 700
    foreach ($f in @($tunLog, "$tunLog.out")) {
      if (-not (Test-Path $f)) { continue }
      $raw = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if ([string]::IsNullOrEmpty($raw)) { continue }
      $m = [regex]::Match($raw, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Success) { $public = $m.Value; break }
    }
  }
  if (-not $public) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    if ($tunnel) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    throw "Туннель не поднялся за 60 сек. Лог: $tunLog"
  }
}
Ok "публичный: $public"

# --- 3. .env ----------------------------------------------------------------
$envPath = Join-Path $Root '.env'
$lines = @()
# Get-Content в PS 5.1 читает файл как ANSI и уродует кириллицу:
# .env перезаписывался mojibake, а бот выставлял себе имя из мусора.
if (Test-Path $envPath) { $lines = [IO.File]::ReadAllText($envPath) -split "`r?`n" }
$out = @()
$hasUrl = $false
foreach ($l in $lines) {
  if ($l -match '^\s*WEBAPP_URL\s*=') { $out += "WEBAPP_URL=$public"; $hasUrl = $true }
  else { $out += $l }
}
if (-not $hasUrl) { $out += "WEBAPP_URL=$public" }
# без BOM: иначе docker compose env_file и подобные читалки ломаются на первой строке
[IO.File]::WriteAllText($envPath, ($out -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))

# --- 4. бот -----------------------------------------------------------------
Write-Host ''
Write-Host '  Готово. В Telegram откройте бота и нажмите /start' -ForegroundColor White
Write-Host '  Кнопка «Открыть» появится рядом с полем ввода.' -ForegroundColor DarkGray
Write-Host ''

$env:WEBAPP_URL = $public
$env:PYTHONUNBUFFERED = '1'
try {
  & $py.Source -u "$Root\bot\bot.py"
} finally {
  Write-Host ''
  Info 'останавливаю фоновые процессы…'
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  if ($tunnel) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  Ok 'демо остановлено'
}
