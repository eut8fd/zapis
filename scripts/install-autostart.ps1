<#
  Превращает ноутбук в сервер для демо.

    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

  Что делает:
    1. региструет задачу «Zapis Demo» — сторож стартует при входе в систему
       и сам поднимает сервер, туннель и бота;
    2. запрещает ноутбуку засыпать и гасить сеть от питания;
    3. если запущено от администратора — добавляет запуск при старте системы
       и убирает засыпание при закрытии крышки.

  Снять: scripts\install-autostart.ps1 -Remove
#>
param(
  [switch]$Remove,
  [switch]$KeepSleep      # не трогать настройки питания
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
$taskName = 'Zapis Demo'

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$startupDir = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startupDir 'Zapis Demo.vbs'

# --- снятие ----------------------------------------------------------------
if ($Remove) {
  Step 'Убираю автозапуск'
  $gone = $false
  try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop; Ok 'задача планировщика удалена'; $gone = $true } catch { }
  if (Test-Path $vbsPath) { Remove-Item -LiteralPath $vbsPath -Force; Ok 'ярлык автозагрузки удалён'; $gone = $true }
  if (-not $gone) { Warn 'автозапуск не был настроен' }
  if ($isAdmin -and -not $KeepSleep) {
    powercfg /change standby-timeout-ac 30 | Out-Null
    Ok 'засыпание от сети возвращено на 30 минут'
  }
  Write-Host "`nГотово. Демо больше не стартует само.`n"
  return
}

# --- 1. автозапуск ---------------------------------------------------------
Step 'Настраиваю автозапуск'
$method = ''

# Способ А — планировщик: стартует даже до входа в систему, но часто закрыт политикой
try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\watchdog.ps1`"" `
    -WorkingDirectory $root
  $triggers = @(New-ScheduledTaskTrigger -AtLogOn)
  if ($isAdmin) { $triggers += New-ScheduledTaskTrigger -AtStartup }
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = if ($isAdmin) { New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest }
  else { New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive }
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal `
    -Description 'Держит демо Zapis запущенным: статика, туннель, бот' -Force -ErrorAction Stop | Out-Null
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    $method = 'task'
    Ok "задача планировщика «$taskName» создана"
    if ($isAdmin) { Ok 'стартует при загрузке системы и при входе' }
    else { Ok 'стартует при входе в систему' }
  }
}
catch { Warn 'планировщик недоступен (политика системы) — перехожу к автозагрузке' }

# Способ Б — папка автозагрузки: работает без прав администратора
if (-not $method) {
  # только ASCII: WScript читает .vbs в системной кодировке, кириллица в нём ломается
  $vbs = @"
' Zapis demo watchdog - starts hidden, no console window.
Dim sh: Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$root\scripts\watchdog.ps1""", 0, False
"@
  try {
    [IO.File]::WriteAllText($vbsPath, $vbs, [Text.Encoding]::ASCII)
    if (Test-Path $vbsPath) {
      $method = 'startup'
      Ok 'ярлык добавлен в автозагрузку'
      Ok 'стартует при входе в систему, окон не появляется'
    }
  }
  catch { Write-Host "   не удалось записать в автозагрузку: $($_.Exception.Message)" -ForegroundColor Red }
}

if (-not $method) {
  Write-Host '   автозапуск настроить не удалось' -ForegroundColor Red
  Write-Host '   запускайте вручную: scripts\watchdog.ps1' -ForegroundColor Yellow
  exit 1
}

# --- 2. питание ------------------------------------------------------------
if (-not $KeepSleep) {
  Step 'Запрещаю ноутбуку засыпать'
  powercfg /change standby-timeout-ac 0 2>$null | Out-Null
  powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null
  powercfg /change monitor-timeout-ac 15 2>$null | Out-Null
  Ok 'от сети: не засыпает, экран гаснет через 15 мин'

  if ($isAdmin) {
    # действие при закрытии крышки от сети -> ничего не делать
    $sub = '4f971e89-eebd-4455-a8de-9e59040e7347'
    $lid = '5ca83367-6e45-459f-a27b-476b1d01c936'
    powercfg /setacvalueindex SCHEME_CURRENT $sub $lid 0 2>$null | Out-Null
    powercfg /setactive SCHEME_CURRENT 2>$null | Out-Null
    Ok 'закрытая крышка больше не усыпляет (от сети)'
  }
  else {
    Warn 'крышку не трогаю — нужны права администратора'
    Warn 'иначе просто не закрывайте крышку'
  }
  Warn 'важно: держите ноутбук в розетке — на батарее настройки другие'
}

# --- 3. запуск сейчас ------------------------------------------------------
Step 'Запускаю прямо сейчас'
$alive = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*watchdog.ps1*' })
if ($alive.Count -gt 0) { Ok 'сторож уже работает' }
else {
  if ($method -eq 'task') { Start-ScheduledTask -TaskName $taskName }
  else {
    Start-Process -FilePath 'powershell' `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\watchdog.ps1`"" `
      -WindowStyle Hidden
  }
  Start-Sleep -Seconds 10
  $now = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*watchdog.ps1*' })
  if ($now.Count -gt 0) { Ok 'сторож запущен' } else { Warn 'сторож не поднялся — проверьте .run\watchdog.txt' }
}

Write-Host "`n================ Готово ================" -ForegroundColor Yellow
Write-Host '  Ноутбук работает как сервер демо.'
Write-Host ''
Write-Host '  Состояние : scripts\status.ps1'
Write-Host '  Лог       : .run\watchdog.txt'
Write-Host '  Отключить : scripts\install-autostart.ps1 -Remove'
Write-Host ''
Write-Host '  Чтобы адрес не менялся при перезапусках —' -ForegroundColor DarkGray
Write-Host '  опубликуйте приложение: scripts\publish-pages.ps1' -ForegroundColor DarkGray
Write-Host "========================================`n"
