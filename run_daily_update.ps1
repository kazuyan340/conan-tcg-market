# 毎日の自動更新本体。タスクスケジューラから呼び出される想定。
# カード差分更新 → 各サイトの価格取得(駿河屋/カードラボ/竜のしっぽ) → 静的サイト用JSON再生成 の順に実行し、ログを残す。
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$logFile = Join-Path $PSScriptRoot "data\update_log.txt"
if (-not (Test-Path (Split-Path $logFile))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null
}

$start = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "===== $start 更新開始 ====="

python scraper_cards.py *>> $logFile
python web\scraper_prices_surugaya.py *>> $logFile
python web\scraper_prices_cardlabo.py *>> $logFile
python web\scraper_prices_ryuunoshippo.py *>> $logFile
python web\export_static.py *>> $logFile

$end = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "===== $end 更新完了 ====="
