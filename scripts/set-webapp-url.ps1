<#
  Переключает бота на постоянный адрес приложения.

    powershell -ExecutionPolicy Bypass -File scripts\set-webapp-url.ps1 -Url https://user.github.io/repo/

  Записывает WEBAPP_URL в .env, перезапускает бота и проверяет, что адрес отвечает.
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$Url = $Url.TrimEnd('/')

if ($Url -notmatch '^https://') {
  Write-Host 'Адрес должен начинаться с https:// — Telegram не открывает Mini App по http.' -ForegroundColor Red
  exit 1
}

Write-Host "== Проверяю доступность $Url" -ForegroundColor Cyan
try {
  $r = Invoke-WebRequest "$Url/index.html" -UseBasicParsing -TimeoutSec 25
  Write-Host "  ok: HTTP $($r.StatusCode), $($r.Content.Length) байт" -ForegroundColor Green
}
catch {
  Write-Host "  !! адрес не отвечает: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host '     (если Pages ещё публикуется — подождите минуту и запустите снова)'
}

Write-Host '== Обновляю .env' -ForegroundColor Cyan
$envPath = "$root\.env"
$txt = [IO.File]::ReadAllText($envPath)
if ($txt -match 'WEBAPP_URL=') { $txt = [regex]::Replace($txt, 'WEBAPP_URL=.*', "WEBAPP_URL=$Url") }
else { $txt = "WEBAPP_URL=$Url`n" + $txt }
[IO.File]::WriteAllText($envPath, $txt, (New-Object Text.UTF8Encoding($false)))
Write-Host "  WEBAPP_URL=$Url" -ForegroundColor Green

if (-not $NoRestart) {
  Write-Host '== Перезапускаю бота' -ForegroundColor Cyan
  Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*bot.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  New-Item -ItemType Directory -Force -Path "$root\.run" | Out-Null
  $env:PYTHONUNBUFFERED = '1'; $env:PYTHONIOENCODING = 'utf-8'
  Start-Process -FilePath 'python' -ArgumentList "-u $root\bot\bot.py" `
    -RedirectStandardOutput "$root\.run\bot.log" -RedirectStandardError "$root\.run\bot.err" -WindowStyle Hidden
  Start-Sleep -Seconds 10
  Get-Content "$root\.run\bot.log" -Encoding utf8 -Tail 12
}

Write-Host "`nГотово. Кнопка меню в боте теперь ведёт на $Url" -ForegroundColor Green
