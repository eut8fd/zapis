<#
  Настройка доступа к панели Super Admin.

  Примеры:
    # сменить секретный код
    powershell -File scripts/set-admin-code.ps1 -Code "мой-новый-код"

    # добавить свой Telegram ID (тогда код спрашивать не будут)
    powershell -File scripts/set-admin-code.ps1 -TelegramId 123456789

    # и то, и другое сразу
    powershell -File scripts/set-admin-code.ps1 -Code "секрет" -TelegramId 123456789

  Свой Telegram ID можно узнать в боте: команда /admin покажет его в ответе.
#>
[CmdletBinding()]
param(
  [string]$Code = '',
  [long[]]$TelegramId = @(),
  [switch]$ReplaceIds        # заменить список ID, а не дополнить
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Cfg = Join-Path $Root 'webapp\js\config.js'
$EnvFile = Join-Path $Root '.env'

if (-not (Test-Path $Cfg)) { throw "Не найден $Cfg" }
$text = Get-Content $Cfg -Raw

# --- секретный код -> SHA-256 ------------------------------------------------
if ($Code) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Code))
  $hash = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $text = [regex]::Replace($text, "ADMIN_CODE_SHA256\s*=\s*'[^']*'", "ADMIN_CODE_SHA256 = '$hash'")
  Write-Host "  код       : обновлён (sha256 $($hash.Substring(0,12))…)" -ForegroundColor Green

  # тот же код нужен боту, чтобы отдавать ссылку своим
  $lines = @()
  if (Test-Path $EnvFile) { $lines = Get-Content $EnvFile }
  $has = $false
  $out = foreach ($l in $lines) {
    if ($l -match '^\s*ADMIN_CODE\s*=') { $has = $true; "ADMIN_CODE=$Code" } else { $l }
  }
  if (-not $has) { $out = @($out) + "ADMIN_CODE=$Code" }
  Set-Content -Path $EnvFile -Value $out -Encoding utf8
}

# --- белый список Telegram ID -----------------------------------------------
if ($TelegramId.Count) {
  $cur = @()
  $m = [regex]::Match($text, 'ADMIN_TG_IDS\s*=\s*\[([^\]]*)\]')
  if ($m.Success -and $m.Groups[1].Value.Trim()) {
    $cur = $m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' }
  }
  $ids = if ($ReplaceIds) { $TelegramId } else { @($cur) + @($TelegramId) }
  $ids = $ids | ForEach-Object { [long]$_ } | Sort-Object -Unique
  $text = [regex]::Replace($text, 'ADMIN_TG_IDS\s*=\s*\[[^\]]*\]', "ADMIN_TG_IDS = [$($ids -join ', ')]")
  Write-Host "  Telegram ID: $($ids -join ', ')" -ForegroundColor Green

  $lines = @()
  if (Test-Path $EnvFile) { $lines = Get-Content $EnvFile }
  $has = $false
  $out = foreach ($l in $lines) {
    if ($l -match '^\s*ADMIN_TG_IDS\s*=') { $has = $true; "ADMIN_TG_IDS=$($ids -join ',')" } else { $l }
  }
  if (-not $has) { $out = @($out) + "ADMIN_TG_IDS=$($ids -join ',')" }
  Set-Content -Path $EnvFile -Value $out -Encoding utf8
}

if (-not $Code -and -not $TelegramId.Count) {
  Write-Host '  Ничего не изменено. Укажите -Code и/или -TelegramId.' -ForegroundColor Yellow
  Write-Host '  Текущая настройка:' -ForegroundColor DarkGray
  ([regex]::Match($text, 'ADMIN_TG_IDS\s*=\s*\[[^\]]*\]')).Value
  exit
}

Set-Content -Path $Cfg -Value $text -Encoding utf8
Write-Host '  сохранено: webapp/js/config.js и .env' -ForegroundColor Green
Write-Host '  перезапустите бота, чтобы он подхватил новые значения' -ForegroundColor DarkGray
