// index.html / compare.html(お気に入り=価格チェック画面) で共有するロジック(データ取得・カードタイル描画・モーダル・お気に入り管理)
// お気に入り=価格チェック対象。星をつけたカードがそのまま「お気に入り一覧」にも「価格チェック」にも並ぶ。
const FAVORITES_KEY = "conanTcgFavorites";

// 一覧・相場ランキング・デッキ作成の3画面で共有する、絞り込みチェックボックスの
// 3状態切り替え(未選択→含める→除外→未選択)。除外中は checkbox.dataset.exclude="1"
// を立て、見た目(チェックボックスの色・ラベルの赤字取り消し線)はCSS側で表現する。
//
// 注意: チェックボックスは"click"イベントが発火する前に既にネイティブの
// checked切り替えが適用済み(pre-click activation)なので、ハンドラ内で読む
// checkbox.checkedは「クリック後の新しい値」。preventDefault()でこれを打ち消すと、
// click後に"canceled activation steps"が走ってJS側でcheckedに入れた値ごと
// クリック前の値へ巻き戻されてしまい、含める(チェック)状態に一切到達できなくなる
// バグがあった(実際に発生していたのはこれ)。そのためpreventDefaultは使わず、
// ネイティブのcheckedトグルをそのまま3状態の一部として利用する形に直している。
function bindTriStateFilterCheckbox(checkbox, onChange) {
  checkbox.addEventListener("click", () => {
    if (checkbox.dataset.exclude === "1") {
      // 除外 -> 未選択(ネイティブ側で既にchecked=falseになっている)
      checkbox.dataset.exclude = "";
    } else if (checkbox.checked) {
      // 未選択 -> 含める(ネイティブ側で既にchecked=trueになっている)
      checkbox.dataset.exclude = "";
    } else {
      // 含める -> 除外(ネイティブ側でchecked=falseに戻ってしまうため、trueに戻す)
      checkbox.checked = true;
      checkbox.dataset.exclude = "1";
    }
    const label = checkbox.closest("label");
    if (label) label.classList.toggle("filter-exclude", checkbox.dataset.exclude === "1");
    onChange();
  });
}

// 指定した絞り込みリスト(listId)内のチェックボックスから、含める値/除外する値を集める。
function getFilterSelection(listId) {
  const include = [];
  const exclude = [];
  for (const el of document.querySelectorAll(`#${listId} input`)) {
    if (el.dataset.exclude === "1") exclude.push(el.value);
    else if (el.checked) include.push(el.value);
  }
  return { include, exclude };
}

// カードの値一覧(例: レアリティなら["SR"])が、絞り込み条件(含める/除外)を満たすか。
// 除外指定した値が1つでも含まれていれば不採用。含める指定がある場合はそのいずれかを
// 持っている必要がある(何も指定が無ければ素通り)。
function matchesFilterSelection(cardValues, selection) {
  if (selection.exclude.some((v) => cardValues.includes(v))) return false;
  if (selection.include.length > 0 && !selection.include.some((v) => cardValues.includes(v))) return false;
  return true;
}

// バッジに表示する選択数(含める+除外の合計)。
function filterSelectionCount(listId) {
  const { include, exclude } = getFilterSelection(listId);
  return include.length + exclude.length;
}

// リセット時に3状態の状態(exclude属性・ラベルの赤字クラス)もまとめて解除する。
function resetTriStateCheckbox(checkbox) {
  checkbox.checked = false;
  checkbox.dataset.exclude = "";
  const label = checkbox.closest("label");
  if (label) label.classList.remove("filter-exclude");
}

// サイト名(平均系列を除いた素の名前)ごとに色を固定する。
// 以前はカード内での出現順で色を割り当てていたため、同じサイトでもカードによって
// 別の色になってしまい見分けにくかった。既知のサイトは固定色、未知のサイトが
// 出てきた場合はページ内で最初に割り当てた色を使い回す。
const SITE_COLOR_MAP = {
  "駿河屋": "#2f6fed",
  "カードラボ": "#e0592a",
  "竜のしっぽ": "#2fa84f",
  "メルカード": "#d6337a",
  "フルアヘッド": "#7a5cd6",
};
const FALLBACK_SITE_COLORS = ["#a83fd1", "#d4a72c", "#1d9e9e"];
const fallbackSiteColorAssignments = {};

function baseSiteName(site) {
  return site.endsWith("(平均)") ? site.slice(0, -"(平均)".length) : site;
}

// 駿河屋アフィリエイト(Smart Biz Affiliate)のリンク生成。
// user_id=固定のアフィリエイターID、goods_url=転送先URLをエンコードしたもの、という
// 仕組みなので、カードごとの検索結果URLを組み立てて渡せば全カード分を自動生成できる。
const SURUGAYA_AFFILIATE_USER_ID = "5367";

function surugaSearchUrl(cardNum) {
  const query = `名探偵コナンTCG ${cardNum}`;
  return `https://www.suruga-ya.jp/search?category=&search_word=${encodeURIComponent(query)}`;
}

function surugaAffiliateUrl(cardNum) {
  const target = surugaSearchUrl(cardNum);
  return `https://affiliate.suruga-ya.jp/modules/af/af_jump.php?user_id=${SURUGAYA_AFFILIATE_USER_ID}&goods_url=${encodeURIComponent(target)}`;
}

// 駿河屋以外はアフィリエイト提携が無いため、素の検索ページへのリンクのみ設置する
// (「PR」表記は付けない=金銭的な結びつきが無いことを景表法上も正しく反映する)。
// カードラボ・竜のしっぽはカード番号そのままでサイト内検索がヒットすることを確認済み。
// メルカードは内部管理番号が独自体系のため、カード番号ではなくカード名で検索する。
// フルアヘッド(MakeShop)はページ内の検索フォーム自体はPOST専用だが、隠しフィールド名
// (name="search")と同じ名前でGETパラメータを渡せば同じ検索結果が得られることを確認済み。
function cardLaboSearchUrl(cardNum) {
  return `https://www.c-labo-online.jp/product-list/?keyword=${encodeURIComponent(cardNum)}`;
}

function ryuunoshippoSearchUrl(cardNum) {
  return `https://www.ryuunoshippo.com/product-list?keyword=${encodeURIComponent(cardNum)}`;
}

function mercardSearchUrl(cardName) {
  return `https://www.mercardconan.jp/product-list?keyword=${encodeURIComponent(cardName)}`;
}

function fullaheadSearchUrl(cardNum) {
  return `https://www.full-conan.com/shop/shopbrand.html?search=${encodeURIComponent(cardNum)}`;
}

// メルカリアンバサダーのリンク生成。検索結果URLに afid= を足すだけで
// アフィリエイトリンクになる仕組み(実際にメルカリアンバサダーの管理画面で
// 生成して確認済み)。メルカリは単品のカード番号での検索ができず、他サイトのように
// 「最安値○○円」という自動比較はできないため、サイト別最安値の表には載せず、
// 別枠の「🔍メルカリで価格を確認する」ボタンとして独立させる(mercariButtonHtml参照)。
const MERCARI_AFFILIATE_ID = "8969530097";

function mercariAffiliateUrl(query) {
  return `https://jp.mercari.com/search?afid=${MERCARI_AFFILIATE_ID}&keyword=${encodeURIComponent(query)}`;
}

// カードのpack列(例: "CT-P10 Case-Booster 10 追憶の盟友")から、収録弾名だけを
// 抜き出す(例: "追憶の盟友")。先頭から英数字/ハイフンだけのトークン(型番・製品種別・
// 通し番号)を読み飛ばし、日本語が混ざったトークンが出てきたらそこから最後まで採用する。
// "探偵マスターズ2026"のようにそもそも型番が付かないパック名は、最初のトークンの
// 時点で日本語混じりなので何も削られず、そのまま使われる。
const ASCII_TOKEN_PATTERN = /^[A-Za-z0-9-]+$/;

function packDisplayName(pack) {
  if (!pack) return "";
  const tokens = pack.split(/\s+/);
  let start = 0;
  while (start < tokens.length - 1 && ASCII_TOKEN_PATTERN.test(tokens[start])) {
    start++;
  }
  return tokens.slice(start).join(" ");
}

// メルカリの「🔍価格を確認する」ボタン(HTML文字列)を返す。サイト別最安値の表とは
// 別枠の要素として、呼び出し側で表のすぐ下などに追加してもらう想定。
function mercariButtonHtml(cardName, cardRarity, cardPack) {
  if (!cardName) return "";
  const query = `${cardName} ${cardRarity || ""} ${packDisplayName(cardPack)}`.replace(/\s+/g, " ").trim();
  return `<a class="mercari-check-btn" href="${mercariAffiliateUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 メルカリで価格を確認する <span class="pr-label">PR</span></a>`;
}

// Amazonアソシエイトのトラッキングタグ。登録が済んでタグが分かったらここに入れる
// (未設定の間は素の検索リンク=アフィリエイトなし)。
const AMAZON_ASSOCIATE_TAG = null; // 例: "yourname-22"

function amazonCardSearchUrl(query) {
  const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}`;
  return AMAZON_ASSOCIATE_TAG ? `${url}&tag=${AMAZON_ASSOCIATE_TAG}` : url;
}

// Amazonの「🔍価格を確認する」ボタン(HTML文字列)。メルカリと違い検索ワードは
// カード名+レアリティのみ(収録パックは含めない)。
function amazonButtonHtml(cardName, cardRarity) {
  if (!cardName) return "";
  const query = `${cardName} ${cardRarity || ""}`.replace(/\s+/g, " ").trim();
  return `<a class="amazon-check-btn" href="${amazonCardSearchUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 Amazonで価格を確認する <span class="pr-label">PR</span></a>`;
}

// 楽天アフィリエイトのID。登録が済んで分かったら、楽天アフィリエイトツールで
// 実際のリンク形式(hb.afl.rakuten.co.jp経由のリダイレクト等)を確認した上で
// rakutenCardSearchUrlに組み込む(未設定の間は素の検索リンク=アフィリエイトなし)。
const RAKUTEN_AFFILIATE_ID = null; // 例: "1234567.abcdefgh"

function rakutenCardSearchUrl(query) {
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`;
}

// 楽天市場の「🔍価格を確認する」ボタン(HTML文字列)。Amazonと同じくカード名+
// レアリティのみで検索する。
function rakutenButtonHtml(cardName, cardRarity) {
  if (!cardName) return "";
  const query = `${cardName} ${cardRarity || ""}`.replace(/\s+/g, " ").trim();
  return `<a class="rakuten-check-btn" href="${rakutenCardSearchUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 楽天市場で価格を確認する <span class="pr-label">PR</span></a>`;
}

// メルカリ・Amazon・楽天市場の確認ボタンをまとめて返す(呼び出し側は1箇所差し込むだけで済む)。
function purchaseButtonsHtml(cardName, cardRarity, cardPack) {
  return `<div class="purchase-buttons">${mercariButtonHtml(cardName, cardRarity, cardPack)}${amazonButtonHtml(cardName, cardRarity)}${rakutenButtonHtml(cardName, cardRarity)}</div>`;
}

// サイト名 -> (cardNum, cardName) => 検索/アフィリエイトURL、の対応表。
// 駿河屋のみアフィリエイトリンク+「PR」表記、他はアフィリエイト無しの素の検索リンク。
const SITE_LINK_BUILDERS = {
  "駿河屋": { url: (cardNum) => surugaAffiliateUrl(cardNum), pr: true },
  "カードラボ": { url: (cardNum) => cardLaboSearchUrl(cardNum), pr: false },
  "竜のしっぽ": { url: (cardNum) => ryuunoshippoSearchUrl(cardNum), pr: false },
  "メルカード": { url: (cardNum, cardName) => mercardSearchUrl(cardName), pr: false, requiresName: true },
  "フルアヘッド": { url: (cardNum) => fullaheadSearchUrl(cardNum), pr: false },
};

function colorForSite(site) {
  const base = baseSiteName(site);
  if (SITE_COLOR_MAP[base]) return SITE_COLOR_MAP[base];
  if (!fallbackSiteColorAssignments[base]) {
    const idx = Object.keys(fallbackSiteColorAssignments).length % FALLBACK_SITE_COLORS.length;
    fallbackSiteColorAssignments[base] = FALLBACK_SITE_COLORS[idx];
  }
  return fallbackSiteColorAssignments[base];
}

let commonPrices = {};
let siteLatestDay = {};

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(set) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

function isFavorite(cardId) {
  return loadFavorites().has(cardId);
}

function toggleFavorite(cardId) {
  const favs = loadFavorites();
  if (favs.has(cardId)) {
    favs.delete(cardId);
  } else {
    favs.add(cardId);
  }
  saveFavorites(favs);
  return favs.has(cardId);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function difficultyText(card) {
  const parts = [];
  if (card.difficulty_first !== null) parts.push(`先攻${card.difficulty_first}`);
  if (card.difficulty_second !== null) parts.push(`後攻${card.difficulty_second}`);
  return parts.join(" ");
}

async function loadCardData() {
  const [cardsRes, pricesRes] = await Promise.all([
    fetch("data/cards.json"),
    fetch("data/prices.json"),
  ]);
  const cards = await cardsRes.json();
  commonPrices = await pricesRes.json();
  siteLatestDay = computeSiteLatestDay(commonPrices);
  return cards;
}

// サイトごとに「直近正常に巡回できたのはいつか」を、全カード横断で集計する。
// カード単位ではなくサイト単位の基準にすることで、他サイトに一度もデータが無い
// カードでも「このサイトの最新巡回でこのカードが見つからなかった(売り切れ等)」を
// 正しく判定できる(以前はカード自身の履歴だけを見ていたため、他サイトの比較対象が
// 無いカードで古いデータがそのまま「最新」扱いされてしまっていた)。
function computeSiteLatestDay(prices) {
  const result = {};
  for (const points of Object.values(prices)) {
    for (const p of points) {
      const base = baseSiteName(p.site);
      const day = dayKey(p.recorded_at);
      if (!result[base] || day > result[base]) result[base] = day;
    }
  }
  return result;
}

// ヘッダーに「最終更新: 2026/7/29 3:05」を表示する(自動更新がいつ効いたか一目で分かるように)。
// 対応する要素(#last-updated)が無いページでは何もしない。
async function renderLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) return;
  try {
    const res = await fetch("data/meta.json");
    const meta = await res.json();
    el.textContent = `最終更新: ${formatDateTimeFull(meta.generated_at)}`;
  } catch {
    // meta.jsonが無い/読めない場合は何も表示しない
  }
}

// カードタイルのDOM要素を作る。お気に入り星をクリックしても詳細モーダルは開かない。
function createCardTile(card, onFavoriteToggle) {
  const tile = document.createElement("div");
  tile.className = "card-tile";

  const star = document.createElement("button");
  star.type = "button";
  star.className = "favorite-star" + (isFavorite(card.id) ? " active" : "");
  star.textContent = isFavorite(card.id) ? "★" : "☆";
  star.title = "お気に入り(価格チェック対象)に登録/解除";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    const nowFav = toggleFavorite(card.id);
    star.textContent = nowFav ? "★" : "☆";
    star.classList.toggle("active", nowFav);
    if (onFavoriteToggle) onFavoriteToggle(card, nowFav);
  });

  const img = document.createElement("img");
  img.src = card.image_url || "";
  img.alt = card.name;
  img.loading = "lazy";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = card.name;

  const sub = document.createElement("div");
  sub.className = "sub";
  const price = pooledAveragePrice(commonPrices[String(card.id)] || []);
  const priceText = price !== null ? `${price.toLocaleString()}円` : "-";
  sub.textContent = `${card.rarity || ""} / ${card.color || ""}　${priceText}`;

  tile.append(star, img, name, sub);
  tile.addEventListener("click", () => openModal(card));
  return tile;
}

function openModal(card) {
  document.getElementById("modal-image").src = card.image_url || "";
  document.getElementById("modal-image").alt = card.name;

  const fields = [
    ["カードID", card.card_id],
    ["カード番号", card.card_num],
    ["種類", card.card_type],
    ["色", card.color],
    ["レアリティ", card.rarity],
    ["特徴", card.category],
    ["レベル", card.level],
    ["AP", card.ap],
    ["LP", card.lp],
    ["事件レベル", difficultyText(card)],
    ["収録パック", card.pack],
    ["イラストレーター", card.illustrator],
  ];

  const infoEl = document.getElementById("modal-info");
  infoEl.innerHTML = fields
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([label, v]) => `<div class="field"><span class="label">${label}:</span><span>${escapeHtml(String(v))}</span></div>`)
    .join("");

  const abilityParts = [card.ability_text, card.hirameki, card.cut_in, card.henso].filter(Boolean);
  const abilityBox = document.createElement("div");
  abilityBox.className = "ability";
  abilityBox.textContent = abilityParts.length ? abilityParts.join("\n\n") : "(なし)";
  infoEl.appendChild(abilityBox);

  if (card.flavor_text) {
    const flavor = document.createElement("div");
    flavor.className = "field";
    flavor.style.marginTop = "6px";
    flavor.innerHTML = `<span>${escapeHtml(card.flavor_text)}</span>`;
    infoEl.appendChild(flavor);
  }

  // モーダルを先に表示してからグラフを描く(非表示中はcanvasのclientWidthが0になり、
  // 解像度を正しく測れないため)。
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.body.classList.add("modal-open");

  renderPriceSection(card.id, card.card_num, card.name, card.rarity, card.pack);

  // モーダル右上のお気に入り星。カード一覧タイルの星と同じ登録先(localStorage)を使う。
  // お気に入り一覧(compare.html)側では、モーダルから解除したら一覧にも反映したいので、
  // ページ側が任意で window.onModalFavoriteToggle を定義していれば呼び出す。
  const favBtn = document.getElementById("modal-favorite");
  if (favBtn) {
    const syncFavBtn = () => {
      const fav = isFavorite(card.id);
      favBtn.textContent = fav ? "★" : "☆";
      favBtn.classList.toggle("active", fav);
    };
    syncFavBtn();
    favBtn.onclick = (e) => {
      e.stopPropagation();
      toggleFavorite(card.id);
      syncFavBtn();
      if (typeof window.onModalFavoriteToggle === "function") window.onModalFavoriteToggle(card);
    };
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindModalEvents() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// サイトごとの最新の最安値を返す。{ site: {price, recorded_at, sample_count}|null }
// そのサイト自身の直近の巡回日(siteLatestDay、全カード横断で集計済み)に、この
// カードの記録が無ければ、売り切れ等でその回は対象から外れたとみなし結果から除く
// (-表示になる)。サイト単位の基準なので、他サイトに一度もデータが無いカードでも
// 正しく判定できる(cf. computeSiteLatestDay)。
function latestPriceBySite(history) {
  const bySite = {};
  for (const h of history) {
    const base = baseSiteName(h.site);
    if (!bySite[base] || h.recorded_at > bySite[base].recorded_at) {
      bySite[base] = { price: h.price, recorded_at: h.recorded_at, sample_count: h.sample_count };
    }
  }
  for (const base of Object.keys(bySite)) {
    const latestDay = siteLatestDay[base];
    if (latestDay && dayKey(bySite[base].recorded_at) !== latestDay) {
      delete bySite[base];
    }
  }
  return bySite;
}

// サイト別の最安値を表形式(HTML文字列)で返す。最安値が一番安いサイトを🏆で強調する。
// データが無いサイトも(-表示で)必ず一覧に出す。「載っていない」のか「未取得」なのかを
// 区別できるようにするため。
// cardNum/cardNameを渡すと、SITE_LINK_BUILDERSにあるサイト名をそのカードの検索
// ページへのリンクにする。駿河屋のみアフィリエイトリンク+「PR」表記、他は素の
// 検索リンク(アフィリエイト提携が無いサイトに「PR」を付けると景表法上不正確なため)。
// メルカリは価格の自動取得ができないため、この表には含めない(mercariButtonHtml参照)。
function siteSummaryTableHtml(history, cardNum, cardName) {
  const bySite = latestPriceBySite(history);
  const allSites = new Set([...Object.keys(SITE_COLOR_MAP), ...Object.keys(bySite)]);
  const entries = [...allSites].map((site) => [site, bySite[site] || null]);
  if (entries.length === 0) return "";

  entries.sort((a, b) => {
    const pa = a[1] ? a[1].price : Infinity;
    const pb = b[1] ? b[1].price : Infinity;
    return pa - pb;
  });

  const rows = entries
    .map(([site, stats], i) => {
      const color = colorForSite(site);
      const crown = i === 0 && stats ? "🏆" : "";
      const minText = stats ? `${stats.price}円` : "-";
      const linkBuilder = SITE_LINK_BUILDERS[site];
      const canLink = linkBuilder && (linkBuilder.requiresName ? cardName : cardNum);
      const nameHtml = canLink
        ? `<a href="${linkBuilder.url(cardNum, cardName)}" target="_blank" rel="nofollow noopener${linkBuilder.pr ? " sponsored" : ""}">${escapeHtml(site)}</a>${linkBuilder.pr ? ' <span class="pr-label">PR</span>' : ""}`
        : escapeHtml(site);
      return `<tr>
        <td><span class="site-swatch" style="background:${color}"></span>${nameHtml}${crown}</td>
        <td>${minText}</td>
      </tr>`;
    })
    .join("");

  return `<table class="price-site-table">
    <thead><tr><th>サイト</th><th>最安値</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 「相場」として全ページ共通で使う数値: 各サイトの現在の最安値を単純平均する。
// 例: 駿河屋の最安値700円・カードラボの最安値750円・竜のしっぽの最安値720円なら、
//     (700+750+720)/3 = 723円。出品数による重み付けはしない。
function pooledAveragePrice(history) {
  const bySite = latestPriceBySite(history);
  const prices = Object.values(bySite).map((s) => s.price).filter((p) => p != null);
  if (prices.length === 0) return null;
  return Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length);
}

// 「このカードの相場」を大きく強調表示するHTML文字列を返す(各サイト最安値の単純平均)。
function avgHighlightHtml(history) {
  const avg = pooledAveragePrice(history);
  if (avg === null) return "";

  const mins = Object.values(latestPriceBySite(history)).map((s) => s.price).filter((p) => p != null);
  const range = mins.length > 1
    ? `<span class="price-avg-range">(最安 ${Math.min(...mins)}円 〜 ${Math.max(...mins)}円)</span>`
    : "";

  return `<div class="price-avg-highlight">相場 <span class="price-avg-value">${avg}円</span>${range}</div>`;
}

// 「最新取得日時」の行(HTML文字列)を返す。サイト別テーブルとひとまとめにして表示するため
// avgHighlightHtmlとは分けている。
function latestDateHtml(history) {
  const latestDate = [...history].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1)).at(-1).recorded_at;
  return `<div class="price-avg-date">最新取得日時: ${formatDateTimeFull(latestDate)}</div>`;
}

// カード1件分の価格統計(相場の強調表示 + 最新取得日時 + サイト別最安値の表)を
// まとめてHTML文字列で返す(表とグラフを分けて配置できないページ向け)。
function buildPriceStatsHtml(history, cardNum, cardName, cardRarity, cardPack) {
  const table = siteSummaryTableHtml(history, cardNum, cardName);
  const buttons = purchaseButtonsHtml(cardName, cardRarity, cardPack);
  return `${avgHighlightHtml(history)}${latestDateHtml(history)}${table}${buttons}`;
}

function renderPriceSection(cardId, cardNum, cardName, cardRarity, cardPack) {
  const history = commonPrices[String(cardId)] || [];
  const statsEl = document.getElementById("modal-price-stats");
  const tableEl = document.getElementById("modal-price-table");
  const canvas = document.getElementById("price-chart");
  const emptyEl = document.getElementById("price-empty");
  const periodTabs = document.getElementById("period-tabs");

  if (history.length === 0) {
    statsEl.textContent = "";
    if (tableEl) tableEl.innerHTML = "";
    canvas.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    if (periodTabs) periodTabs.classList.add("hidden");
    return;
  }

  canvas.classList.remove("hidden");
  emptyEl.classList.add("hidden");

  if (tableEl) {
    statsEl.innerHTML = `${avgHighlightHtml(history)}${latestDateHtml(history)}`;
    tableEl.innerHTML = `${siteSummaryTableHtml(history, cardNum, cardName)}${purchaseButtonsHtml(cardName, cardRarity, cardPack)}`;
  } else {
    statsEl.innerHTML = buildPriceStatsHtml(history, cardNum, cardName, cardRarity, cardPack);
  }

  // モーダル内は既定で全期間表示。7日/30日タブでその場で絞り込める。
  if (periodTabs) {
    periodTabs.classList.remove("hidden");
    const tabs = periodTabs.querySelectorAll(".period-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.days === "0");
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        drawPriceChart(canvas, history, Number(tab.dataset.days) || null);
      };
    });
  }

  drawPriceChart(canvas, history);
}

// ISO日時文字列を "7/21" のような日付のみの表示に変換する(グラフの軸ラベル用。
// 日単位でまとめて表示するため時刻までは出さない)
function formatDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 実行時刻(recorded_at)を「実行日」単位のキーに丸める。駿河屋・カードラボ・竜のしっぽの
// スクレイパーは同じ日次バッチでも数分〜十数分ずれた時刻に完了するため、そのままだと
// グラフのX軸上で「同じ日の更新」のはずの点がずれて表示されてしまう。日単位のキーに
// まとめることで、同じ日に取得した点は同じX位置に揃うようにする。
function dayKey(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

// ISO日時文字列を "2026/7/21 14:27" のような年まで含む表示に変換する(統計テキスト用)
function formatDateTimeFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// historyを直近days日分だけに絞り込む(daysが無ければ全期間そのまま)。
// 「直近」は現在時刻ではなく、そのカードの最新データ時点を基準にする
// (自動更新が数日止まっていても「データが無い」と表示されるのを防ぐため)。
function filterHistoryByDays(history, days) {
  if (!days || history.length === 0) return history;
  const latest = Math.max(...history.map((p) => new Date(p.recorded_at).getTime()));
  const cutoff = latest - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
}

// 同じサイト・同じ日に複数の取得ポイントがある場合(手動での再実行など)、
// 同じX位置(日)に2点存在してグラフの線がジグザグに折れて見えてしまうため、
// サイトごとに1日1点(その日の最新値)だけになるよう間引く。
function dedupeLatestPerSiteDay(points) {
  const latestByKey = new Map();
  for (const p of points) {
    const key = `${baseSiteName(p.site)}|${dayKey(p.recorded_at)}`;
    const existing = latestByKey.get(key);
    if (!existing || p.recorded_at > existing.recorded_at) latestByKey.set(key, p);
  }
  return [...latestByKey.values()];
}

// 「相場」(各サイト最安値の単純平均)の日次推移を返す。各サイトの最安値系列を日ごとに
// 1点にまとめたうえで、その日にデータがある全サイトの最安値を単純平均する
// (pooledAveragePriceの「最新1点だけ」版を、日ごとに算出したもの)。
function pooledAverageSeries(history) {
  const minPoints = dedupeLatestPerSiteDay(history.filter((p) => !p.site.endsWith("(平均)")));
  const byDay = new Map();
  for (const p of minPoints) {
    const day = dayKey(p.recorded_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(p);
  }
  const series = [];
  for (const points of byDay.values()) {
    const avg = points.reduce((sum, p) => sum + p.price, 0) / points.length;
    series.push({ recorded_at: points[0].recorded_at, price: Math.round(avg) });
  }
  return series.sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));
}

const MARKET_LINE_COLOR = "#222";

function drawPriceChart(canvas, history, days) {
  // canvasの描画バッファ解像度をCSS表示サイズ(+devicePixelRatio)に合わせる。
  // これをしないと、CSSで拡大表示されたぶん線がぼやけて薄く見えてしまう
  // (canvas要素はwidth/height属性=描画解像度と、CSSサイズ=表示サイズが別物のため)。
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const limited = filterHistoryByDays(history, days);

  // グラフには各サイトの最安値の推移に加えて、各サイト最安値を単純平均した「相場」の
  // 推移も重ねて描く(数値としては avgHighlightHtml で強調表示済みだが、グラフでも
  // 推移を追えるようにしてほしいという要望に対応)。
  const shown = dedupeLatestPerSiteDay(limited.filter((p) => !p.site.endsWith("(平均)")));
  const pooledSeries = pooledAverageSeries(limited);

  const bySite = {};
  for (const point of shown) {
    const base = baseSiteName(point.site);
    bySite[base] = bySite[base] || [];
    bySite[base].push(point);
  }

  const dates = [...new Set([...shown, ...pooledSeries].map((p) => dayKey(p.recorded_at)))].sort();
  const prices = [...shown, ...pooledSeries].map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = Math.max(10, Math.round((maxPrice - minPrice) * 0.1));
  const yMin = Math.max(0, minPrice - pad);
  const yMax = maxPrice + pad;

  const marginLeft = 45;
  const marginRight = 20;
  const marginBottom = 40;

  // サイトが増えて凡例が1行に収まらなくなった場合(サイト名が右端で切れて見えなくなる
  // 問題があった)、折り返して複数行にする。行数ぶんグラフ本体の開始位置を下にずらす
  // 必要があるため、軸やグラフ本体を描く前に凡例の行数を確定させておく。
  const legendItems = [];
  for (const base of Object.keys(bySite)) {
    legendItems.push({ site: base, color: colorForSite(base) });
  }
  if (pooledSeries.length > 0) {
    legendItems.push({ site: "相場", color: MARKET_LINE_COLOR });
  }

  ctx.font = "11px sans-serif";
  const legendGap = 30;
  const legendRowHeight = 16;
  const legendFirstRowY = 10;
  const legendRows = [[]];
  let legendX = marginLeft + 4;
  for (const item of legendItems) {
    const itemWidth = 11 + ctx.measureText(item.site).width;
    const currentRow = legendRows[legendRows.length - 1];
    if (legendX + itemWidth > w - marginRight && currentRow.length > 0) {
      legendRows.push([]);
      legendX = marginLeft + 4;
    }
    legendRows[legendRows.length - 1].push({ ...item, x: legendX });
    legendX += itemWidth + legendGap;
  }

  const margin = {
    left: marginLeft,
    right: marginRight,
    top: legendRows.length <= 1 ? legendFirstRowY : legendFirstRowY + legendRows.length * legendRowHeight - 6,
    bottom: marginBottom,
  };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  const xPos = (date) => margin.left + (dates.length <= 1 ? plotW / 2 : (dates.indexOf(date) / (dates.length - 1)) * plotW);
  const yPos = (price) => margin.top + plotH - ((price - yMin) / (yMax - yMin || 1)) * plotH;

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  ctx.fillStyle = "#888";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(String(yMax), margin.left - 6, margin.top);
  ctx.fillText(String(yMin), margin.left - 6, margin.top + plotH);
  ctx.textBaseline = "alphabetic";

  // ホバー時にツールチップで値を出すため、描画した各点の座標と内容を控えておく。
  const hitPoints = [];

  function drawSeries(points, color, label, { dashed = false, lineWidth = 2 } = {}) {
    if (points.length === 0) return;
    const sorted = [...points].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath();
    sorted.forEach((p, i) => {
      const x = xPos(dayKey(p.recorded_at));
      const y = yPos(p.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of sorted) {
      const x = xPos(dayKey(p.recorded_at));
      const y = yPos(p.price);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      hitPoints.push({ x, y, label, price: p.price, date: formatDateLabel(p.recorded_at) });
    }
  }

  for (const [base, points] of Object.entries(bySite)) {
    drawSeries(points, colorForSite(base), base);
  }

  // 相場(各サイト最安値の単純平均)は、サイト別の実勢価格と区別しやすいよう
  // 太めの点線で目立たせて重ねて描く。
  if (pooledSeries.length > 0) {
    drawSeries(pooledSeries, MARKET_LINE_COLOR, "相場", { dashed: true, lineWidth: 3 });
  }

  ctx.font = "11px sans-serif";
  legendRows.forEach((row, rowIndex) => {
    const y = legendFirstRowY + rowIndex * legendRowHeight;
    for (const { site, color, x } of row) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 2, 8, 8);
      ctx.fillStyle = "#555";
      ctx.textAlign = "left";
      ctx.fillText(site, x + 11, y + 6);
    }
  });

  // x軸に日付ラベル(取得日)を表示。重ならないよう間引く。
  const maxLabels = Math.max(2, Math.floor(plotW / 80));
  let labelIndices;
  if (dates.length <= maxLabels) {
    labelIndices = dates.map((_, i) => i);
  } else {
    labelIndices = [...new Set(
      Array.from({ length: maxLabels }, (_, i) => Math.round((i * (dates.length - 1)) / (maxLabels - 1)))
    )];
  }
  // ラベルを斜め(30度)に傾けて表示する。目盛りの少し右下から右肩下がりに伸ばす
  // (Excel等でよく見る向き)。左のY軸ラベルと重ならないよう、始点はメモリ位置。
  ctx.fillStyle = "#888";
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "middle";
  for (const idx of labelIndices) {
    const date = dates[idx];
    const x = xPos(date);
    const y = margin.top + plotH + 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((30 * Math.PI) / 180);
    ctx.textAlign = "left";
    ctx.fillText(formatDateLabel(date), 0, 0);
    ctx.restore();
  }

  setupChartHover(canvas, hitPoints);
}

// 全グラフで使い回す単一のツールチップ要素(初回呼び出し時に1つだけ作る)。
let chartTooltipEl = null;
function getChartTooltip() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "chart-tooltip";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}

// canvas上のマウス位置に一番近い点(一定距離以内)を探し、ツールチップで
// 「サイト名: 価格円(日付)」を表示する。drawPriceChartが呼ばれるたびに
// hitPoints(点の座標一覧)は最新化されるが、イベントリスナー自体は
// canvasごとに1回だけ登録する(再登録による多重発火を防ぐため)。
function setupChartHover(canvas, hitPoints) {
  canvas._chartHitPoints = hitPoints;
  if (canvas._chartHoverBound) return;
  canvas._chartHoverBound = true;

  const tooltip = getChartTooltip();
  const HIT_RADIUS = 10;

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let nearest = null;
    let nearestDist = HIT_RADIUS;
    for (const p of canvas._chartHitPoints || []) {
      const dist = Math.hypot(p.x - mx, p.y - my);
      if (dist <= nearestDist) {
        nearest = p;
        nearestDist = dist;
      }
    }

    if (nearest) {
      tooltip.textContent = `${nearest.label}: ${nearest.price}円 (${nearest.date})`;
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
      tooltip.style.display = "block";
      canvas.style.cursor = "pointer";
    } else {
      tooltip.style.display = "none";
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}
