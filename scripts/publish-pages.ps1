<#
  Готовит репозиторий и публикует Mini App на GitHub Pages.

  Что делает:
    * инициализирует git, если его ещё нет;
    * коммитит проект (секреты в .env в коммит не попадают);
    * привязывает ваш GitHub-репозиторий и делает push;
    * дальше публикацию берёт на себя workflow .github/workflows/pages.yml.

  Запуск:
    powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1 -Repo https://github.com/USER/REPO.git
#>
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Branch = 'main',
  [string]$Message = 'Zapis demo'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# --- проверки -------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'git не найден. Установите: https://git-scm.com/download/win' -ForegroundColor Red; exit 1
}

Step 'Проверяю, что секреты не уйдут в репозиторий'
$ignored = Get-Content "$root\.gitignore" -Raw
foreach ($must in @('.env', 'bot/users.json', '.run/')) {
  if ($ignored -notmatch [regex]::Escape($must)) {
    Write-Host "  !! $must отсутствует в .gitignore — добавьте перед публикацией" -ForegroundColor Red; exit 1
  }
}
Write-Host '  ok: .env и данные пользователей не публикуются' -ForegroundColor Green

# --- git ------------------------------------------------------------------
if (-not (Test-Path "$root\.git")) {
  Step 'Инициализирую репозиторий'
  git init -b $Branch | Out-Null
}
else {
  git checkout -B $Branch | Out-Null
}

Step 'Добавляю файлы'
git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host '  нечего коммитить — изменений нет'
}
else {
  git -c user.name='Zapis' -c user.email='zapis@local' commit -m $Message | Out-Null
  Write-Host "  закоммичено файлов: $(($staged | Measure-Object).Count)" -ForegroundColor Green
}

Step 'Привязываю удалённый репозиторий'
$existing = git remote get-url origin 2>$null
if ($existing) { git remote set-url origin $Repo } else { git remote add origin $Repo }
Write-Host "  origin -> $Repo"

Step 'Отправляю на GitHub'
git push -u origin $Branch

# --- итог -----------------------------------------------------------------
$slug = $Repo -replace '^https://github\.com/', '' -replace '\.git$', ''
$user, $name = $slug -split '/', 2
$pagesUrl = "https://$user.github.io/$name/"

Write-Host "`n================ Что дальше ================" -ForegroundColor Yellow
Write-Host "1. Откройте https://github.com/$slug/settings/pages"
Write-Host "   Source -> GitHub Actions   (один раз)"
Write-Host "2. Дождитесь зелёной галочки на https://github.com/$slug/actions"
Write-Host "3. Приложение будет доступно всем по адресу:"
Write-Host "   $pagesUrl" -ForegroundColor Green
Write-Host "4. Пропишите его боту:"
Write-Host "   scripts\set-webapp-url.ps1 -Url $pagesUrl" -ForegroundColor Green
Write-Host "============================================`n"
