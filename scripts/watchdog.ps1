<#
  Сторож демо: держит сервер, туннель и бота живыми.

  Раз в минуту проверяет:
    * отвечает ли локальный сервер            -> перезапускает;
    * жив ли процесс cloudflared               -> поднимает заново;
    * отвечает ли публичный адрес              -> берёт новый и чинит .env;
    * жив ли бот                               -> перезапускает.

  Если адрес туннеля сменился, бот автоматически перенастраивается на новый.

  Запуск (оставить окно открытым):
    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1

  Остановка — Ctrl+C. Фоновые процессы при этом продолжат работать;
  чтобы остановить всё, используйте scripts\stop-demo.ps1
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

# пишем сразу в файл: Write-Host в перенаправленный поток буферизуется
# и лог не виден, пока процесс не завершится
function Say($msg, $color = 'Gray') {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
  try { Write-Host $line -ForegroundColor $color } catch { }
  try { Add-Content -Path $logFile -Value $line -Encoding utf8 } catch { }
}

function Get-Proc($needle) {
  Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$needle*" }
}

function Read-Url {
  $m = Select-String -Path "$root\.env" -Pattern '^WEBAPP_URL=(.*)$'
  if ($m) { return $m.Matches.Groups[1].Value.Trim() }
  return ''
}

function Write-Url($u) {
  $t = [IO.File]::ReadAllText("$root\.env")
  if ($t -match 'WEBAPP_URL=') { $t = [regex]::Replace($t, 'WEBAPP_URL=.*', "WEBAPP_URL=$u") }
  else { $t = "WEBAPP_URL=$u`n" + $t }
  [IO.File]::WriteAllText("$root\.env", $t, (New-Object Text.UTF8Encoding($false)))
}

function Test-Http($url, $sec = 20) {
  try { $null = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $sec; return $true }
  catch { return $false }
}

function Start-Server {
  Get-Proc 'serve.py' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:PYTHONUNBUFFERED = '1'; $env:PYTHONIOENCODING = 'utf-8'
  Start-Process -FilePath 'python' -ArgumentList "-u $root\server\serve.py $Port" -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

function Start-Bot {
  Get-Proc 'bot.py' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  $env:PYTHONUNBUFFERED = '1'; $env:PYTHONIOENCODING = 'utf-8'
  Start-Process -FilePath 'python' -ArgumentList "-u $root\bot\bot.py" `
    -RedirectStandardOutput "$logDir\bot.log" -RedirectStandardError "$logDir\bot.err" -WindowStyle Hidden
}

function Start-Tunnel {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item "$logDir\tunnel.log", "$logDir\tunnel.out" -ErrorAction SilentlyContinue
  Start-Process -FilePath "$root\tools\cloudflared.exe" `
    -ArgumentList "tunnel --no-autoupdate --url http://localhost:$Port" `
    -RedirectStandardError "$logDir\tunnel.log" -RedirectStandardOutput "$logDir\tunnel.out" -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    $t = Get-Content "$logDir\tunnel.log" -Raw -ErrorAction SilentlyContinue
    if ($t -match '(https://[a-z0-9-]+\.trycloudflare\.com)') { return $Matches[1] }
  }
  return $null
}

# PID-файл: по нему сторожа находят надёжно, без поиска по командной строке
# (подстрока может случайно совпасть с чужим процессом и убить не то)
$pidFile = Join-Path $logDir 'watchdog.pid'
try { [IO.File]::WriteAllText($pidFile, "$PID") } catch { }
$stopHandler = { try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { } }
Register-EngineEvent PowerShell.Exiting -Action $stopHandler | Out-Null

Say "сторож запущен (pid $PID), проверка каждые $IntervalSec сек" 'White'

$fails = 0
$tick = 0
while ($true) {
  $tick++
  $url = Read-Url

  # --- локальный сервер ---
  if (-not (Test-Http "http://localhost:$Port/index.html" 5)) {
    Say 'сервер не отвечает — поднимаю' 'Yellow'
    Start-Server
    if (Test-Http "http://localhost:$Port/index.html" 5) { Say 'сервер поднят' 'Green' }
  }

  # --- туннель ---
  $tunAlive = @(Get-Process cloudflared -ErrorAction SilentlyContinue).Count -gt 0
  $urlAlive = $url -and (Test-Http "$url/index.html" 20)

  if (-not $tunAlive -or -not $urlAlive) {
    $fails++
    # одиночный сбой сети — не дёргаем туннель, ждём следующей проверки
    if ($tunAlive -and $fails -lt 2) {
      Say 'публичный адрес не ответил — жду ещё цикл' 'Yellow'
    }
    else {
      Say 'туннель недоступен — поднимаю заново' 'Yellow'
      $new = Start-Tunnel
      if ($new) {
        Say "новый адрес: $new" 'Green'
        if ($new -ne $url) {
          Write-Url $new
          Say 'адрес записан в .env, перенастраиваю бота' 'Cyan'
          Start-Bot
        }
        $fails = 0
      }
      else {
        Say 'туннель не поднялся — повтор через цикл' 'Red'
      }
    }
  }
  else { $fails = 0 }

  # --- бот ---
  if (@(Get-Proc 'bot.py').Count -eq 0) {
    Say 'бот не запущен — поднимаю' 'Yellow'
    Start-Bot
    Start-Sleep -Seconds 8
    if (@(Get-Proc 'bot.py').Count -gt 0) { Say 'бот поднят' 'Green' } else { Say 'бот не поднялся' 'Red' }
  }

  # раз в 30 циклов — отметка, что сторож жив
  if ($tick % 30 -eq 1) { Say "цикл $tick · всё под контролем" 'DarkGray' }

  Start-Sleep -Seconds $IntervalSec
}
