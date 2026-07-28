# このフォルダを開いた状態で1回だけ実行すると、Windowsタスクスケジューラに
# 「毎日AM3:00にrun_daily_update.ps1を実行する」タスクを登録する。
# 家のPCに移行した後、こちらで改めて1回実行してください。
$scriptPath = Join-Path $PSScriptRoot "run_daily_update.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "ConanTCG_DailyUpdate" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "名探偵コナンTCG カード図鑑: 毎日カード・価格情報を自動更新" `
    -Force

Write-Output "登録しました。PCが起動していればAM3:00頃に自動実行されます(起動していなかった日は次回起動時に実行)。"
Write-Output "タスク名: ConanTCG_DailyUpdate (タスクスケジューラの画面からも確認・削除できます)"
