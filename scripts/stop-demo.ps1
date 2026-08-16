# Останавливает демо целиком: сторожа, бота, сервер и туннель.
# Сторож глушится первым — иначе он поднимет всё обратно через минуту.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.run\watchdog.pid'

# 1. сторож — строго по PID-файлу.
#    Искать по подстроке в командной строке нельзя: она совпадает с любым
#    процессом, где это имя просто упомянуто, включая текущую консоль.
$killed = 0
if (Test-Path $pidFile) {
  $wpid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($wpid -match '^\d+$' -and [int]$wpid -ne $PID) {
    $p = Get-Process -Id ([int]$wpid) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'powershell') {
      Stop-Process -Id ([int]$wpid) -Force -ErrorAction SilentlyContinue
      $killed++
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Write-Host ("  сторож: остановлено $killed") -ForegroundColor Gray

# 2. бот и статика
$py = @(Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*serve.py*' -or $_.CommandLine -like '*bot.py*' })
$py | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host ("  бот и сервер: остановлено " + $py.Count) -ForegroundColor Gray

# 3. туннель
$cf = @(Get-Process cloudflared -ErrorAction SilentlyContinue)
$cf | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Write-Host ("  туннель: остановлено " + $cf.Count) -ForegroundColor Gray

Start-Sleep -Seconds 2
$left = @(Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*serve.py*' -or $_.CommandLine -like '*bot.py*' }).Count +
        @(Get-Process cloudflared -ErrorAction SilentlyContinue).Count

if ($left -eq 0) { Write-Host "`n  всё остановлено" -ForegroundColor Green }
else { Write-Host "`n  осталось процессов: $left — запустите скрипт ещё раз" -ForegroundColor Yellow }

Write-Host '  автозапуск не снят: scripts\install-autostart.ps1 -Remove' -ForegroundColor DarkGray
