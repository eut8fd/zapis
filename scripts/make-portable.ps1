<#
  Собирает переносимую папку демо для другого компьютера.

    powershell -ExecutionPolicy Bypass -File scripts\make-portable.ps1

  На выходе — папка (и zip) со всем необходимым:
  проект, cloudflared, токен и ярлыки-запускалки.
  Переносится флешкой, ничего никуда не выгружается.

  Параметры:
    -Out  куда положить (по умолчанию на рабочий стол)
    -NoZip  не паковать в архив
#>
param(
  [string]$Out = '',
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Zapis-Demo' }

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }

# --- 1. чистая папка --------------------------------------------------------
Step 'Готовлю папку'
if (Test-Path $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
New-Item -ItemType Directory -Path $Out -Force | Out-Null
Ok $Out

# --- 2. проект --------------------------------------------------------------
Step 'Копирую проект'
foreach ($d in @('webapp', 'bot', 'server', 'scripts')) {
  Copy-Item -LiteralPath (Join-Path $root $d) -Destination (Join-Path $Out $d) -Recurse -Force
}
# локальные данные тестов на новую машину не тащим
foreach ($f in @('bot\users.json', 'bot\bookings.json')) {
  $p = Join-Path $Out $f
  if (Test-Path $p) { Remove-Item -LiteralPath $p -Force }
}
Get-ChildItem $Out -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$n = (Get-ChildItem $Out -Recurse -File | Measure-Object).Count
Ok "$n файлов"

# --- 3. cloudflared ---------------------------------------------------------
Step 'Добавляю cloudflared'
$cfSrc = Join-Path $root 'tools\cloudflared.exe'
New-Item -ItemType Directory -Path (Join-Path $Out 'tools') -Force | Out-Null
if (Test-Path $cfSrc) {
  Copy-Item -LiteralPath $cfSrc -Destination (Join-Path $Out 'tools\cloudflared.exe') -Force
  Ok ('вложен, ' + [math]::Round((Get-Item $cfSrc).Length / 1MB) + ' МБ — на новой машине качать не придётся')
}
else {
  Warn 'не найден — на новой машине скачается автоматически при первом запуске'
}

# --- 4. .env ----------------------------------------------------------------
Step 'Переношу настройки'
$envSrc = Join-Path $root '.env'
if (Test-Path $envSrc) {
  $t = [IO.File]::ReadAllText($envSrc)
  # адрес туннеля на новой машине будет свой
  $t = [regex]::Replace($t, 'WEBAPP_URL=.*', 'WEBAPP_URL=')
  [IO.File]::WriteAllText((Join-Path $Out '.env'), $t, (New-Object Text.UTF8Encoding($false)))
  Ok 'токен бота перенесён, адрес очищен (определится на новой машине)'
}
else { Warn '.env не найден — заполните на новой машине' }

# --- 5. запускалки ----------------------------------------------------------
Step 'Создаю ярлыки'
$launchers = @{
  '1 ЗАПУСТИТЬ ДЕМО.cmd'      = 'watchdog.ps1'
  '2 АВТОЗАПУСК ВКЛЮЧИТЬ.cmd' = 'install-autostart.ps1'
  '3 СОСТОЯНИЕ.cmd'           = 'status.ps1'
  '4 ОСТАНОВИТЬ.cmd'          = 'stop-demo.ps1'
}
foreach ($k in $launchers.Keys) {
  $body = @"
@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\$($launchers[$k])" %*
echo.
pause
"@
  [IO.File]::WriteAllText((Join-Path $Out $k), $body, (New-Object Text.UTF8Encoding($false)))
}
Ok ($launchers.Count.ToString() + ' запускалки')

# --- 6. инструкция ----------------------------------------------------------
$readme = @"
ZAPIS — ДЕМО ОНЛАЙН-ЗАПИСИ
===========================

Всё работает локально на этом компьютере.
Проект никуда не выгружается: туннель только пропускает
трафик к вашей машине, файлы и данные остаются здесь.


ЧТО НУЖНО ОДИН РАЗ: PYTHON
--------------------------
Откройте командную строку и наберите:

    python --version

Должно ответить "Python 3.xx.x".

Если открылся Microsoft Store или написало, что команда не найдена —
Python не установлен. Скачайте с python.org/downloads и при установке
ОБЯЗАТЕЛЬНО поставьте галочку "Add python.exe to PATH".

Отдельная ловушка Windows: даже без Python команда python может вести
на пустую заглушку Microsoft Store. Тогда демо будет запускаться
и сразу падать. Лечится так:
  Параметры -> Приложения -> Дополнительные параметры приложений
  -> Псевдонимы выполнения приложения
  -> выключить python.exe и python3.exe

Больше ничего ставить не надо: ни библиотек, ни Node, ни Docker.
Демо само проверит Python при запуске и скажет, если что-то не так.


КАК ЗАПУСТИТЬ
-------------
Двойной клик по "1 ЗАПУСТИТЬ ДЕМО.cmd".

Окно должно остаться открытым — это сторож, он держит демо живым
и сам поднимает всё, если отвалится интернет.

Чтобы демо стартовало само при включении компьютера, один раз
запустите "2 АВТОЗАПУСК ВКЛЮЧИТЬ.cmd".


КАК ДАВАТЬ ЛЮДЯМ ТЕСТИРОВАТЬ
----------------------------
Ссылки постоянные, их можно рассылать:

    t.me/Demotelaibot              — витрина, выбор роли
    t.me/Demotelaibot?start=c1     — клиент салона красоты
    t.me/Demotelaibot?start=c2     — клиент барбершопа
    t.me/Demotelaibot?start=biz    — кабинет бизнеса

Адрес туннеля меняется при перезапусках, но тестировщикам это
не важно: бот перенастраивается сам, а они ходят по ссылкам выше.


ПРОВЕРИТЬ, ЧТО ВСЁ ЖИВО
-----------------------
"3 СОСТОЯНИЕ.cmd" — покажет сервер, туннель, бота и живой адрес.


ВАЖНО
-----
* Компьютер должен быть включён и в розетке.
* Не давайте ему засыпать — "2 АВТОЗАПУСК ВКЛЮЧИТЬ.cmd" это настраивает.
* Файл .env содержит токен бота — не выкладывайте его никуда.

Остановить всё — "4 ОСТАНОВИТЬ.cmd".
"@
[IO.File]::WriteAllText((Join-Path $Out 'ЧИТАЙ МЕНЯ.txt'), $readme, (New-Object Text.UTF8Encoding($false)))
Ok 'инструкция'

# --- 7. архив ---------------------------------------------------------------
$zip = "$Out.zip"
if (-not $NoZip) {
  Step 'Пакую в архив'
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zip -CompressionLevel Optimal
  Ok ("$zip — " + [math]::Round((Get-Item $zip).Length / 1MB, 1) + ' МБ')
}

Write-Host "`n================ Готово ================" -ForegroundColor Yellow
Write-Host "  Папка : $Out"
if (-not $NoZip) { Write-Host "  Архив : $zip" }
Write-Host ''
Write-Host '  Перенесите на второй ноутбук флешкой,'
Write-Host '  распакуйте и запустите "1 ЗАПУСТИТЬ ДЕМО.cmd".'
Write-Host "========================================`n"
