// index.html / compare.html(お気に入り=価格チェック画面) で共有するロジック(データ取得・カードタイル描画・モーダル・お気に入り管理)
// お気に入り=価格チェック対象。星をつけたカードがそのまま「お気に入り一覧」にも「価格チェック」にも並ぶ。
const FAVORITES_KEY = "conanTcgFavorites";

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
// フルアヘッド(MakeShop)は検索フォームがPOST専用でGETリンクを組み立てられなかったため、
// Googleのsite:検索で代用する。
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
  return `https://www.google.com/search?q=${encodeURIComponent(`site:full-conan.com ${cardNum}`)}`;
}

// サイト名 -> (cardNum, cardName) => 検索/アフィリエイトURL、の対応表。
// 駿河屋だけアフィリエイトリンク+「PR」表記、他はアフィリエイト無しの素の検索リンク。
const SITE_LINK_BUILDERS = {
  "駿河屋": { url: (cardNum) => surugaAffiliateUrl(cardNum), pr: true },
  "カードラボ": { url: (cardNum) => cardLaboSearchUrl(cardNum), pr: false },
  "竜のしっぽ": { url: (cardNum) => ryuunoshippoSearchUrl(cardNum), pr: false },
  "メルカード": { url: (cardNum, cardName) => mercardSearchUrl(cardName), pr: false },
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
  return cards;
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
  sub.textContent = `${card.rarity || ""} / ${card.color || ""}`;

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

  renderPriceSection(card.id, card.card_num, card.name);
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
function latestPriceBySite(history) {
  const bySite = {};
  for (const h of history) {
    const base = baseSiteName(h.site);
    if (!bySite[base] || h.recorded_at > bySite[base].recorded_at) {
      bySite[base] = { price: h.price, recorded_at: h.recorded_at, sample_count: h.sample_count };
    }
  }
  return bySite;
}

// サイト別の最安値を表形式(HTML文字列)で返す。最安値が一番安いサイトを🏆で強調する。
// データが無いサイトも(-表示で)必ず一覧に出す。「載っていない」のか「未取得」なのかを
// 区別できるようにするため。
// cardNum/cardNameを渡すと、SITE_LINK_BUILDERSにあるサイト名をそのカードの検索
// ページへのリンクにする。駿河屋のみアフィリエイトリンク+「PR」表記、他は素の検索
// リンク(アフィリエイト提携が無いサイトに「PR」を付けると景表法上不正確なため)。
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
      const canLink = linkBuilder && (site === "メルカード" ? cardName : cardNum);
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
function buildPriceStatsHtml(history, cardNum, cardName) {
  const table = siteSummaryTableHtml(history, cardNum, cardName);
  return `${avgHighlightHtml(history)}${latestDateHtml(history)}${table}`;
}

function renderPriceSection(cardId, cardNum, cardName) {
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
    tableEl.innerHTML = siteSummaryTableHtml(history, cardNum, cardName);
  } else {
    statsEl.innerHTML = buildPriceStatsHtml(history, cardNum, cardName);
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

  const margin = { left: 45, right: 20, top: 10, bottom: 40 };
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

  const legendItems = [];
  for (const [base, points] of Object.entries(bySite)) {
    const color = colorForSite(base);
    legendItems.push({ site: base, color });
    drawSeries(points, color, base);
  }

  // 相場(各サイト最安値の単純平均)は、サイト別の実勢価格と区別しやすいよう
  // 太めの点線で目立たせて重ねて描く。
  if (pooledSeries.length > 0) {
    legendItems.push({ site: "相場", color: MARKET_LINE_COLOR });
    drawSeries(pooledSeries, MARKET_LINE_COLOR, "相場", { dashed: true, lineWidth: 3 });
  }

  let legendX = margin.left + 4;
  ctx.font = "11px sans-serif";
  for (const { site, color } of legendItems) {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, margin.top - 2, 8, 8);
    ctx.fillStyle = "#555";
    ctx.textAlign = "left";
    ctx.fillText(site, legendX + 11, margin.top + 6);
    legendX += ctx.measureText(site).width + 30;
  }

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
