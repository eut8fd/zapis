<#
  Показывает, что сейчас запущено и по какому адресу открывается демо.

    powershell -ExecutionPolicy Bypass -File scripts\status.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot

function Line($name, $ok, $detail) {
  $mark = if ($ok) { 'работает' } else { 'остановлен' }
  $color = if ($ok) { 'Green' } else { 'DarkGray' }
  Write-Host ('  {0,-10} {1,-11} {2}' -f $name, $mark, $detail) -ForegroundColor $color
}

$procs = Get-CimInstance Win32_Process -Filter "Name like '%python%'"
$serve = @($procs | Where-Object { $_.CommandLine -like '*serve.py*' })
$bot = @($procs | Where-Object { $_.CommandLine -like '*bot.py*' })
$tun = @(Get-Process cloudflared)

$url = (Select-String -Path "$root\.env" -Pattern '^WEBAPP_URL=(.*)$').Matches.Groups[1].Value

Write-Host ''
Write-Host '  Zapis demo — состояние' -ForegroundColor White
Write-Host '  ----------------------' -ForegroundColor DarkGray
Line 'сервер' ($serve.Count -gt 0) 'http://localhost:8080'
Line 'туннель' ($tun.Count -gt 0) $url
Line 'бот' ($bot.Count -gt 0) 'long polling'

if ($url) {
  Write-Host ''
  Write-Host '  Проверяю публичный адрес…' -ForegroundColor DarkGray
  try {
    $r = Invoke-WebRequest "$url/index.html" -UseBasicParsing -TimeoutSec 20
    Write-Host "  доступен: HTTP $($r.StatusCode)" -ForegroundColor Green
  }
  catch {
    Write-Host "  НЕ отвечает: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  перезапуск: scripts\start-demo.ps1' -ForegroundColor Yellow
  }
}

$db = "$root\.run\zapis.db"
if (Test-Path $db) {
  $mb = [math]::Round((Get-Item $db).Length / 1MB, 2)
  Write-Host ''
  Write-Host "  база сервера: .run\zapis.db ($mb МБ)" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  Ссылки для показа:' -ForegroundColor White
Write-Host '    t.me/Demotelaibot            — витрина, выбор роли'
Write-Host '    t.me/Demotelaibot?start=c1   — меню клиента Lumière'
Write-Host '    t.me/Demotelaibot?start=biz  — меню бизнеса'
Write-Host ''
