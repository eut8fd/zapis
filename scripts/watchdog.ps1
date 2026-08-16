<#
  Сторож демо: держит статику, туннель и бота живыми.

  Запуск:
    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1

  Остановка — Ctrl+C или scripts\stop-demo.ps1
#>
param(
  [int]$Port = 8080,
  [int]$IntervalSec = 60
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root '.run'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'watchdog.txt'
$pidFile = Join-Path $logDir 'watchdog.pid'

# пишем сразу в файл: Write-Host в перенаправленный поток буферизуется
function Say($msg, $color = 'Gray') {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
  try { Write-Host $line -ForegroundColor $color } catch { }
  try { Add-Content -Path $logFile -Value $line -Encoding utf8 } catch { }
}
function Fail($msg) { Say $msg 'Red' }

# ===========================================================================
#  Проверки перед стартом
# ===========================================================================

# --- Python. Главная ловушка: в свежей Windows `python` ведёт на заглушку
#     Microsoft Store, которая молча завершается. Процесс «стартует» и умирает.
function Resolve-Python {
  foreach ($name in @('python', 'python3')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd -or -not $cmd.Source) { continue }
    if ($cmd.Source -like '*\WindowsApps\*') { continue }   # заглушка Store
    try {
      $v = & $cmd.Source --version 2>&1
      if ("$v" -match 'Python 3') { return @{ Path = $cmd.Source; Version = "$v".Trim() } }
    }
    catch { }
  }
  # launcher py.exe
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    try {
      $v = & $launcher.Source -3 --version 2>&1
      if ("$v" -match 'Python 3') { return @{ Path = $launcher.Source; Args = '-3'; Version = "$v".Trim() } }
    }
    catch { }
  }
  return $null
}

$pyInfo = Resolve-Python
if (-not $pyInfo) {
  Fail 'Python 3 не найден — демо запустить нечем.'
  Write-Host ''
  Write-Host '  Что сделать:' -ForegroundColor Yellow
  Write-Host '   1. Установите Python 3 с https://www.python.org/downloads/'
  Write-Host '   2. При установке ОБЯЗАТЕЛЬНО поставьте галочку' -ForegroundColor Yellow
  Write-Host '      "Add python.exe to PATH"' -ForegroundColor Yellow
  Write-Host '   3. Закройте это окно и запустите демо заново'
  Write-Host ''
  Write-Host '  Если Python вроде установлен, но не работает: откройте' -ForegroundColor DarkGray
  Write-Host '  "Параметры -> Приложения -> Псевдонимы выполнения приложения"' -ForegroundColor DarkGray
  Write-Host '  и выключите там python.exe и python3.exe (это заглушки Store).' -ForegroundColor DarkGray
  Write-Host ''
  Read-Host '  Enter — выход'
  exit 1
}
$pyExe = $pyInfo.Path
$pyArg = if ($pyInfo.Args) { $pyInfo.Args + ' ' } else { '' }

# --- один экземпляр: два сторожа будут глушить процессы друг друга
if (Test-Path $pidFile) {
  $old = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($old -match '^\d+$' -and [int]$old -ne $PID) {
    $p = Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'powershell') {
      Fail "Сторож уже запущен (pid $old). Второй не нужен — он будет мешать первому."
      Write-Host '  Состояние: scripts\status.ps1   Остановить: scripts\stop-demo.ps1' -ForegroundColor DarkGray
      Read-Host '  Enter — выход'
      exit 1
    }
  }
}
[IO.File]::WriteAllText($pidFile, "$PID")

# --- токен
$envPath = Join-Path $root '.env'
if (-not (Test-Path $envPath) -or -not (Select-String -Path $envPath -Pattern '^BOT_TOKEN=.+')) {
  Fail 'В .env не заполнен BOT_TOKEN — бот работать не будет.'
  Read-Host '  Enter — выход'
  exit 1
}

$cfPath = Join-Path $root 'tools\cloudflared.exe'

# ===========================================================================
#  Вспомогательные
# ===========================================================================
function Get-Proc($needle) {
  Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$needle*" }
}
function Read-Url {
  $m = Select-String -Path $envPath -Pattern '^WEBAPP_URL=(.*)$'
  if ($m) { return $m.Matches.Groups[1].Value.Trim() }
  return ''
}
function Write-Url($u) {
  $t = [IO.File]::ReadAllText($envPath)
  if ($t -match 'WEBAPP_URL=') { $t = [regex]::Replace($t, 'WEBAPP_URL=.*', "WEBAPP_URL=$u") }
  else { $t = "WEBAPP_URL=$u`n" + $t }
  [IO.File]::WriteAllText($envPath, $t, (New-Object Text.UTF8Encoding($false)))
}
function Test-Http($url, $sec = 15) {
  if (-not $url) { return $false }
  try { $null = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $sec; return $true } catch { return $false }
}
# две попытки: одиночный сетевой сбой не должен считаться падением
function Test-Http2($url, $sec = 15) {
  if (Test-Http $url $sec) { return $true }
  Start-Sleep -Seconds 3
  return (Test-Http $url $sec)
}

function Start-Server {
  Get-Proc 'serve.py' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # ждём освобождения порта, иначе новый процесс не сможет его занять
  for ($i = 0; $i -lt 10; $i++) {
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 500
  }
  $env:PYTHONUNBUFFERED = '1'; $env:PYTHONIOENCODING = 'utf-8'
  Start-Process -FilePath $pyExe -ArgumentList "$pyArg-u `"$root\server\serve.py`" $Port" `
    -RedirectStandardError "$logDir\server.err" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

function Start-Bot {
  Get-Proc 'bot.py' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  $env:PYTHONUNBUFFERED = '1'; $env:PYTHONIOENCODING = 'utf-8'
  Start-Process -FilePath $pyExe -ArgumentList "$pyArg-u `"$root\bot\bot.py`"" `
    -RedirectStandardOutput "$logDir\bot.log" -RedirectStandardError "$logDir\bot.err" -WindowStyle Hidden
}

function Start-Tunnel {
  if (-not (Test-Path $cfPath)) {
    Say 'скачиваю cloudflared (один раз, ~50 МБ)' 'Cyan'
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'tools') | Out-Null
    try {
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $cfPath -UseBasicParsing
    }
    catch { Fail "не удалось скачать cloudflared: $($_.Exception.Message)"; return $null }
  }
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item "$logDir\tunnel.log", "$logDir\tunnel.out" -ErrorAction SilentlyContinue
  Start-Process -FilePath $cfPath -ArgumentList "tunnel --no-autoupdate --url http://localhost:$Port" `
    -RedirectStandardError "$logDir\tunnel.log" -RedirectStandardOutput "$logDir\tunnel.out" -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    $t = Get-Content "$logDir\tunnel.log" -Raw -ErrorAction SilentlyContinue
    if ($t -match '(https://[a-z0-9-]+\.trycloudflare\.com)') { return $Matches[1] }
  }
  return $null
}

# ===========================================================================
#  Цикл
# ===========================================================================
Say "сторож запущен (pid $PID) · $($pyInfo.Version) · проверка каждые $IntervalSec сек" 'White'

$srvFails = 0      # подряд неудачных запусков сервера
$botFails = 0      # подряд неудачных запусков бота
$urlFails = 0      # подряд неответов публичного адреса
$tick = 0
$sleepFor = $IntervalSec

while ($true) {
  $tick++
  $sleepFor = $IntervalSec

  # ---------- 1. локальный сервер ----------
  $srvOk = Test-Http "http://localhost:$Port/index.html" 5
  if (-not $srvOk) {
    Say 'сервер не отвечает — поднимаю' 'Yellow'
    Start-Server
    $srvOk = Test-Http "http://localhost:$Port/index.html" 5
    if ($srvOk) { Say 'сервер поднят' 'Green'; $srvFails = 0 }
    else {
      $srvFails++
      $err = ''
      try { $err = (Get-Content "$logDir\server.err" -Tail 3 -ErrorAction SilentlyContinue) -join ' ' } catch { }
      Fail "сервер не поднялся (попытка $srvFails)$(if($err){': ' + $err})"
    }
  }
  else { $srvFails = 0 }

  # Если статики нет — трогать туннель бессмысленно и вредно:
  # публичный адрес всё равно не ответит, а мы сожжём рабочий туннель
  # и получим новый адрес. Сначала чиним причину.
  if (-not $srvOk) {
    if ($srvFails -ge 3) {
      Fail 'сервер не запускается три раза подряд — дальше жду 5 минут'
      Fail 'проверьте, что Python работает: python --version'
      $sleepFor = 300
    }
    Start-Sleep -Seconds $sleepFor
    continue
  }

  # ---------- 2. туннель ----------
  $url = Read-Url
  $tunAlive = @(Get-Process cloudflared -ErrorAction SilentlyContinue).Count -gt 0
  $needTunnel = $false

  if (-not $tunAlive) { $needTunnel = $true; Say 'туннель не запущен' 'Yellow' }
  elseif (-not $url) { $needTunnel = $true }
  else {
    if (Test-Http2 "$url/index.html" 15) { $urlFails = 0 }
    else {
      $urlFails++
      if ($urlFails -ge 2) { $needTunnel = $true; Say "публичный адрес не отвечает ($urlFails) — пересоздаю туннель" 'Yellow' }
      else { Say 'публичный адрес не ответил — жду ещё цикл' 'Yellow' }
    }
  }

  if ($needTunnel) {
    $new = Start-Tunnel
    if ($new) {
      $urlFails = 0
      if ($new -ne $url) {
        Write-Url $new
        Say "новый адрес: $new" 'Green'
        Say 'перенастраиваю бота' 'Cyan'
        Start-Bot
        Start-Sleep -Seconds 8
      }
      else { Say "адрес прежний: $new" 'Green' }
    }
    else { Fail 'туннель не поднялся — повтор в следующем цикле' }
  }

  # ---------- 3. бот ----------
  if (@(Get-Proc 'bot.py').Count -eq 0) {
    Say 'бот не запущен — поднимаю' 'Yellow'
    Start-Bot
    Start-Sleep -Seconds 10
    if (@(Get-Proc 'bot.py').Count -gt 0) { Say 'бот поднят' 'Green'; $botFails = 0 }
    else {
      $botFails++
      $err = ''
      try { $err = (Get-Content "$logDir\bot.err" -Tail 3 -ErrorAction SilentlyContinue) -join ' ' } catch { }
      Fail "бот не поднялся (попытка $botFails)$(if($err){': ' + $err})"
      if ($botFails -ge 3) {
        Fail 'бот не запускается три раза подряд — дальше жду 5 минут'
        Fail "смотрите .run\bot.err"
        $sleepFor = 300
      }
    }
  }
  else { $botFails = 0 }

  if ($tick % 30 -eq 1) { Say "цикл $tick · всё под контролем" 'DarkGray' }
  Start-Sleep -Seconds $sleepFor
}
