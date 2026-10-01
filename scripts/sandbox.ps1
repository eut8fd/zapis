# Локальная песочница production-backend.
#
# Отдельный контур: своя база (.run/sandbox.db), свой порт (8000), вход без
# Telegram и уведомления на экран. Демо-бот и demo-сервер не участвуют и не
# останавливаются — их можно держать запущенными одновременно.
#
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox.ps1 -Fresh   (с нуля)

param(
    [switch]$Stop,
    [switch]$Fresh,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Run = Join-Path $Root '.run'
$ApiPid = Join-Path $Run 'sandbox-api.pid'
$WorkerPid = Join-Path $Run 'sandbox-worker.pid'
$SecretFile = Join-Path $Run 'sandbox-secret.txt'
$DbFile = Join-Path $Run 'sandbox.db'
$InboxFile = Join-Path $Run 'sandbox-inbox.jsonl'

New-Item -ItemType Directory -Force -Path $Run | Out-Null

# --------------------------------------------------------------- остановка
function Stop-ByPidFile($file, $label) {
    # Ищем по PID-файлу, а не по подстроке командной строки: подстрока
    # попадает в командную строку самого этого скрипта, и он убивает себя.
    if (-not (Test-Path $file)) { return }
    $id = (Get-Content $file -Raw).Trim()
    if ($id -match '^\d+$') {
        $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
            Write-Host "  остановлен $label (PID $id)"
        }
    }
    Remove-Item $file -Force -ErrorAction SilentlyContinue
}

if ($Stop) {
    Write-Host 'Останавливаю песочницу…'
    Stop-ByPidFile $WorkerPid 'worker'
    Stop-ByPidFile $ApiPid 'api'
    Write-Host 'Готово. Демо не тронуто.'
    exit 0
}

# ------------------------------------------------------------------ python
function Find-Python {
    # python3 на Windows часто ведёт на заглушку Microsoft Store: она молча
    # завершается, и всё выглядит как «ничего не произошло».
    foreach ($name in @('python', 'py', 'python3')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        $path = $cmd.Source
        if ($path -and $path -like '*\WindowsApps\*') { continue }
        return $path
    }
    return $null
}

$Python = Find-Python
if (-not $Python) {
    Write-Host 'Не нашёл Python. Установите Python 3.12 с python.org и повторите.' -ForegroundColor Red
    exit 1
}
Write-Host "python      : $Python"

# ------------------------------------------------------------- зависимости
& $Python -c "import fastapi, sqlalchemy, alembic, aiosqlite, tzdata" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Ставлю зависимости backend (один раз)…'
    & $Python -m pip install --disable-pip-version-check -q -r (Join-Path $Backend 'requirements.txt')
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Не удалось поставить зависимости.' -ForegroundColor Red
        exit 1
    }
}

# ------------------------------------------------------------------ секрет
if (-not (Test-Path $SecretFile)) {
    $secret = & $Python -c "import secrets; print(secrets.token_urlsafe(48))"
    # Без BOM: файл читают и Python, и этот скрипт.
    [System.IO.File]::WriteAllText($SecretFile, $secret.Trim(), (New-Object System.Text.UTF8Encoding($false)))
}
$Secret = (Get-Content $SecretFile -Raw).Trim()

# --------------------------------------------------------------- с чистого
if ($Fresh) {
    Stop-ByPidFile $WorkerPid 'worker'
    Stop-ByPidFile $ApiPid 'api'
    Start-Sleep -Milliseconds 500
    Remove-Item $DbFile -Force -ErrorAction SilentlyContinue
    Remove-Item $InboxFile -Force -ErrorAction SilentlyContinue
    Write-Host 'База песочницы удалена — начинаем с нуля.'
}

# --------------------------------------------------------------- окружение
$DbUrl = 'sqlite+aiosqlite:///' + ($DbFile -replace '\\', '/')

$env:APP_ENV = 'local'
$env:DEBUG = 'true'
$env:RELEASE = 'sandbox'
$env:DATABASE_URL = $DbUrl
$env:SESSION_SECRET = $Secret
$env:DEV_AUTH_ENABLED = 'true'
$env:NOTIFY_TRANSPORT = 'local'
$env:SANDBOX_INBOX_PATH = $InboxFile
$env:PUBLIC_BASE_URL = "http://localhost:$Port"
$env:EXPOSE_API_DOCS = 'true'
# Токен бота не нужен: в этом контуре Telegram не участвует вовсе.
$env:BOT_TOKEN = ''
$env:REDIS_URL = ''
# Ждать час до записи в тесте незачем; конкретные значения компания
# всё равно задаёт сама на вкладке «Правила записи».
$env:BOOKING_LEAD_TIME_MINUTES = '0'
$env:SLOT_STEP_MINUTES = '30'

# ------------------------------------------------------------------ миграции
Write-Host 'база       : ' -NoNewline
Write-Host $DbFile
Push-Location $Backend
try {
    & $Python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Миграции не прошли.' -ForegroundColor Red
        exit 1
    }
} finally { Pop-Location }

# --------------------------------------------------------------------- старт
Stop-ByPidFile $WorkerPid 'worker'
Stop-ByPidFile $ApiPid 'api'

$apiLog = Join-Path $Run 'sandbox-api.log'
$workerLog = Join-Path $Run 'sandbox-worker.log'

$api = Start-Process -FilePath $Python `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port") `
    -WorkingDirectory $Backend -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err"
Set-Content -Path $ApiPid -Value $api.Id -Encoding ascii

$worker = Start-Process -FilePath $Python `
    -ArgumentList @('-m', 'app.workers.run') `
    -WorkingDirectory $Backend -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $workerLog -RedirectStandardError "$workerLog.err"
Set-Content -Path $WorkerPid -Value $worker.Id -Encoding ascii

# Ждём, пока API поднимется: без этого браузер откроется на пустой странице.
$url = "http://localhost:$Port/sandbox/"
$ready = $false
foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 400
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/live" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}

Write-Host ''
if ($ready) {
    Write-Host 'Песочница запущена.' -ForegroundColor Green
} else {
    Write-Host 'API не ответил за 12 секунд — смотрите лог:' -ForegroundColor Yellow
    Write-Host "  $apiLog.err"
}
Write-Host "  консоль   : $url"
Write-Host "  API-доки  : http://localhost:$Port/api/v1/docs"
Write-Host "  логи      : $apiLog / $workerLog"
Write-Host "  остановить: powershell -ExecutionPolicy Bypass -File scripts\sandbox.ps1 -Stop"
Write-Host ''

if ($ready) { Start-Process $url }
