#!/bin/bash
# 盤面を指定してカード効果を実際に動かし、結果を判定するシナリオ試験(CT-P11分)。
# usage: bash tools/verify/scenario/run.sh [ケースファイル...]   (省略時は ct-p11-cases-*.js をすべて実行)
# 結果は scenario/out.txt。PASS/FAIL の行と、実行時エラー(ERRORS)を見る。
cd "$(dirname "$0")/../../.."
D="tools/verify/scenario"
FILES=("$@"); [ ${#FILES[@]} -eq 0 ] && FILES=($D/ct-p11-cases-*.js)
rm -rf "$D/.ud"
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe "$D/scen_main.js" "$(pwd)" "$(pwd)/$D/.ud" "$(pwd)/$D/out.txt" "${FILES[@]}"
grep -c "^PASS" "$D/out.txt"; grep "^FAIL\|^ERRORS\|fatal" "$D/out.txt" | cut -c1-600
