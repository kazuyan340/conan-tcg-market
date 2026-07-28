# 名探偵コナンTCG カード図鑑・相場ツール — 残タスク

この内容を全部実行して、と伝えれば続きが再開できるように、現在の状況と残作業をまとめてあります。

## これまでの状況(完了済み)

- `db.py` / `scraper_cards.py` / `gui.py`: tkinter版のカード図鑑(全2240件取得済み、グリッド表示・検索・モーダル詳細)は完成
- Web公開に向けて `web/` フォルダを作成し、以下が完成済み:
  - `web/scraper_prices_surugaya.py`: 駿河屋から高レアリティカードの価格を取得。対象は「C/CP/R/RP以外の全レアリティ」(現在832件、`EXCLUDED_RARITIES`で管理・DBの実値から自動算出)。実行済みで346件の価格取得に成功(`data/conan_tcg.db`の`price_history`に保存済み)
  - `web/export_static.py`: SQLite → `web/site/data/cards.json` / `prices.json` へのエクスポート。実行済み
  - `web/site/`: 静的フロントエンド。グリッド一覧・検索フィルタ(色/種類/レアリティ/レベルは複数選択可、外側クリックで閉じる)・モーダル詳細(スクロール不要のコンパクトレイアウト)・価格推移グラフ(Canvas自前実装、外部ライブラリ不使用)を実装済み。**お気に入り(☆)＝価格チェック**という1つの仕組みに統一済み(試行錯誤の末、ユーザーの意向で「お気に入り一覧ページ」は廃止し統合した)。一覧画面のヘッダーにある「★ お気に入り」リンクを押すと、そのまま`compare.html`(ファイル名は据え置き。実質「お気に入り(価格チェック)」画面)に飛び、☆をつけたカードの価格グラフがカード形式で一望できる。画像クリックで通常のモーダルも開ける。`favorites.html`/`favorites.js`は削除済み。共通ロジックは`common.js`に切り出し、`app.js`(一覧)/`compare.js`(お気に入り=価格チェック)がそれぞれ利用する構成。`python -m http.server` でローカル動作確認済み(Playwrightでの自動テストも実施済み)。**注意**: `web/export_static.py` はDBを更新するたびに再実行しないと`web/site/data/`のJSONが古いままになる(実際に一度これで古い価格データを表示していたので、DB更新後は必ず再エクスポートすること)
  - `.github/workflows/update.yml`: 毎日1回、カード差分更新→駿河屋価格取得→静的JSON再生成→コミットのワークフロー雛形(まだリポジトリ未作成のため無効化状態)
  - `run_daily_update.ps1` / `setup_scheduled_task.ps1`: GitHubを使わない方針(開発環境をUSB/クラウドストレージでのフォルダコピーで自宅PCに移行する予定のため)で、**Windowsタスクスケジューラによるローカル自動化**を用意した。`setup_scheduled_task.ps1` を1回実行すると、毎日AM3:00に `run_daily_update.ps1`(カード差分更新→駿河屋価格取得→静的JSON再生成を順に実行しログを`data/update_log.txt`に残す)を自動実行するタスク「ConanTCG_DailyUpdate」が登録される。$PSScriptRoot基準の相対パスなので、フォルダをどこにコピーしても動く。動作確認済み(このマシンでは登録→NextRunTime確認→解除まで検証済み)。**自宅PCに移行したら `setup_scheduled_task.ps1` を1回実行するのを忘れずに**(タスクスケジューラの設定はフォルダコピーだけでは付いてこない)

  - `web/site/trends.html` / `trends.js`: 「📊 価格の動き」「🔺値上がり」「🔻値下がり」を**1ページに統合**(最初は3ページに分けたり2ページに分けたりしたが、最終的にユーザーの指示で「ヘッダーの1つのボタンを押すたびに 価格の動き→値上がり→値下がり→(繰り返し) と切り替わる」形にまとめた)。`up.html`/`down.html`/`movers.js`は削除済み。ページ内に`view-trends`/`view-up`/`view-down`の3つの`<div>`を用意し、`#cycle-btn`クリックで表示中のdivを切り替える(データは初回に全部fetch済みで、切り替えはDOM表示/非表示のみ・再読み込みなし)。ボタンのラベルは「次に何が見られるか」を示す(例: 価格の動き画面では「🔺 値上がりを見る」)
  - `export_static.py`の`compute_trends()`が急上昇(直近2時点の変化率が5%以上)とじわじわ上昇(3時点以上あり下落がほぼ無く、最初→最新の変化率が3%以上、かつ1回のジャンプだけで説明できるもの=急上昇と同じものは除外)を`trends.json`に出力。実際に急上昇3件を検出済み(例: 服部平次 D06003が160円→500円等)。急上昇として検出された変動は「駿河屋の最安値出品が入れ替わっただけ」の見かけ上のジャンプの可能性がある点をユーザーに説明済み(バグではなく仕組み上の特性)
  - `compute_movers()`は「最新値点を除いた過去の平均価格 vs 最新価格」で値上がり/値下がりを判定(閾値なし)。**ユーザーの指示で、最安値だけでなく平均値でも上下判定できるよう拡張**: `scraper_prices_surugaya.py`が各カードの全出品価格を集めて最安値(site="駿河屋")と平均値(site="駿河屋(平均)")の両方を`price_history`に保存し、`movers.json`は`{"min":{"up":[],"down":[]}, "avg":{...}}`という構造で両系列を出力。ページ内では「最安値ベース」「平均値ベース」の2セクションとして表示。**同じ実行内では最安値・平均値を同一のタイムスタンプで保存するよう修正済み**(別々のタイムスタンプだとグラフ上で同じ日時なのに点がずれて見えるバグがあり、過去データも含めて修正済み)
  - ナビゲーションは 一覧⇄お気に入り(価格チェック)⇄価格の動き(統合版) の3画面を相互リンクする形に統一済み

## 現在の方針・今後の検討事項

- 「価格が急上昇/じわじわ上昇しているカード一覧」機能は実装済み(上記)。これをそこだけ有料化するアイデアが出ている。課金の是非はデータが十分溜まってから改めて判断する合意になっている(スクレイピング先データを直接収益化する形になるため、無料公開より一段リスクが上がる点は要注意)
- 急上昇として検出された価格変動は、実際の相場急騰ではなく「駿河屋の最安値出品が入れ替わったことによる見かけ上のジャンプ」の可能性がある点をユーザーに説明済み(バグではなく仕組み上の特性)

## 残タスク(上から順に実行)

### 1. カードラボ・カードボックス・その他候補サイトへの接続を再確認する

前回、この環境のネットワークからは以下がすべて「接続リセット」で失敗した(帰宅後など別ネットワークからの再試行を待っている状態)。信憑性を上げるため価格取得元を増やしたいという意向があり、同じ理由(おそらく共通のECカートシステムのWAF)でブロックされている候補が他にも見つかっている。

- カードラボ: `https://www.c-labo-online.jp/page/171`
- カードボックス(トレコロ): `https://www.torecolo.jp/shop/default.aspx`
- 竜のしっぽ: `https://www.ryuunoshippo.com/product-list/429` (単品1600件以上、有望)
- メルカード(名探偵コナンTCG専門通販): `https://www.mercardconan.jp/`

試したが失敗した方法: 通常のrequests/curl、Playwright(通常起動)、Playwright+playwright-stealth。すべて同じ結果で接続レベルで拒否された。

なお、この環境から**アクセスできた**候補もある(データの質は未検証):
- 楽天市場(`https://search.rakuten.co.jp/search/mall/名探偵コナン+tcg/`) - ヤフオクと同様、出品者ごとの自由記述でカード番号が入っていない可能性が高く、単品特定の精度は要検証
- ホビーサーチ(1999.co.jp) - アクセスは可能だが、名探偵コナンTCG単品を扱っているか・正しい検索URLがまだ未特定

**やること**:
```
curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" "https://www.c-labo-online.jp/page/171" -o /tmp/clabo_test.html -w "HTTP:%{http_code} SIZE:%{size_download}\n"
curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" "https://www.torecolo.jp/shop/default.aspx" -o /tmp/cardbox_test.html -w "HTTP:%{http_code} SIZE:%{size_download}\n"
```
アクセスできるようになっていたら次のステップへ。まだ失敗する場合はユーザーに報告し、それ以上の回避策(プロキシ・VPN等)には進まない。

### 2. ページ構造を調査し、価格取得スクリプトを実装する

アクセスできたら、`web/scraper_prices_surugaya.py` と同じ調査手順で行う。
- 商品一覧ページに「カード番号」や「レアリティ」が商品名に含まれているか確認(駿河屋は `B01005[SR]：江戸川コナン` という綺麗な形式だった)
- 含まれていない場合、カード名+レアリティでの検索がどの程度正確に単品カードを特定できるか確認する(ヤフオクのように複数枚セット販売が多いと使い物にならないので、その場合はユーザーに報告して判断を仰ぐ)
- 価格・商品名を抜き出す正規表現/BeautifulSoupセレクタを特定する
- robots.txtで `Crawl-delay` が指定されていればそれに従う(未指定なら駿河屋と同じ30秒を目安にする)

その後、`web/scraper_prices_surugaya.py` と同じ構成で以下を新規作成する:
- `web/scraper_prices_cardlabo.py`
- `web/scraper_prices_cardbox.py`

両方とも:
- 対象カードは `db.get_distinct_values(conn, "rarity")` から `EXCLUDED_RARITIES = ["C", "CP", "R", "RP"]` を除いたもの(scraper_prices_surugaya.pyと同じロジックを再利用)
- 1サイトの失敗が他に影響しない設計(try/exceptで個別に隔離)
- `db.insert_price(conn, card_id, "カードラボ", price)` / `db.insert_price(conn, card_id, "カードボックス", price)` で保存
- アクセスがPlaywright必須だった場合、ヘッドレスChromiumで1ページ取得するごとに適切なdelay(最低数秒〜、相手サイトの指示があればそれに従う)を空ける

### 3. 実際に実行して検証する

```
python web/scraper_prices_cardlabo.py
python web/scraper_prices_cardbox.py
```
`price_history` に新しいサイト名で価格が入っていることをsqlite3で確認する。

### 4. 静的サイトとワークフローを更新する

```
python web/export_static.py
```
`web/site/data/prices.json` に新サイトの価格が反映されることを確認。

`.github/workflows/update.yml` に以下を追記する:
- `playwright install --with-deps chromium` のインストールステップ(カードラボ/カードボックスがPlaywright必須の場合)
- `python web/scraper_prices_cardlabo.py` と `python web/scraper_prices_cardbox.py` の実行ステップ(既存のscraper_prices_surugaya.py実行の後)

### 5. ローカルプレビューで最終確認

```
cd web/site
python -m http.server 8765
```
ブラウザで `http://localhost:8765/` を開き、価格推移グラフに駿河屋・カードラボ・カードボックスが色分けされて表示されることを確認する(スクリーンショットで確認するとよい)。

## まだ決まっていないこと(ユーザーに確認が必要)

- 公開先のホスティング(GitHub Pagesが有力候補だが未確定。リポジトリもまだ作成していない)
- メルカリ・ヤフオクは価格データの信頼性の問題(セット売り・カード番号なし)で見送り済み。今後方針が変わる場合は要相談
