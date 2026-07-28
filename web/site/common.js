// index.html / compare.html(お気に入り=価格チェック画面) で共有するロジック(データ取得・カードタイル描画・モーダル・お気に入り管理)
// お気に入り=価格チェック対象。星をつけたカードがそのまま「お気に入り一覧」にも「価格チェック」にも並ぶ。
const FAVORITES_KEY = "conanTcgFavorites";
const CHART_COLORS = ["#2f6fed", "#e0592a", "#2fa84f", "#a83fd1", "#d4a72c", "#1d9e9e"];

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

  renderPriceSection(card.id);

  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
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

// サイトごとの最新価格(平均系列は除く)を返す。{ site: {price, recorded_at} }
function latestPricesBySite(history) {
  const bySite = {};
  for (const h of history) {
    if (h.site.endsWith("(平均)")) continue;
    if (!bySite[h.site] || h.recorded_at > bySite[h.site].recorded_at) {
      bySite[h.site] = h;
    }
  }
  return bySite;
}

// 「今どのサイトが一番安いか」が一目で分かる行(安い順、最安値に🏆)。HTML文字列を返す。
function siteSummaryHtml(history) {
  const entries = Object.entries(latestPricesBySite(history)).sort((a, b) => a[1].price - b[1].price);
  if (entries.length === 0) return "";
  return entries
    .map(([site, h], i) => `${i === 0 ? "🏆" : "・"}${escapeHtml(site)} ${h.price}円`)
    .join("　");
}

// カード1件分の価格統計(全体の最安値/最高値/平均 + サイト別の現在価格)をHTML文字列で返す。
function buildPriceStatsHtml(history) {
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const latestDate = [...history].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1)).at(-1).recorded_at;
  const overall = `最安値: ${min}円  最高値: ${max}円  平均: ${avg}円 (最新取得日時: ${formatDateTimeFull(latestDate)})`;
  const siteSummary = siteSummaryHtml(history);
  return siteSummary ? `${overall}<br>${siteSummary}` : overall;
}

function renderPriceSection(cardId) {
  const history = commonPrices[String(cardId)] || [];
  const statsEl = document.getElementById("modal-price-stats");
  const canvas = document.getElementById("price-chart");
  const emptyEl = document.getElementById("price-empty");

  if (history.length === 0) {
    statsEl.textContent = "";
    canvas.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }

  canvas.classList.remove("hidden");
  emptyEl.classList.add("hidden");

  statsEl.innerHTML = buildPriceStatsHtml(history);

  drawPriceChart(canvas, history);
}

// ISO日時文字列を "7/21 14:27" のような短い日付時刻表示に変換する(グラフの軸ラベル用)
function formatDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// ISO日時文字列を "2026/7/21 14:27" のような年まで含む表示に変換する(統計テキスト用)
function formatDateTimeFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function drawPriceChart(canvas, history) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bySite = {};
  for (const point of history) {
    (bySite[point.site] = bySite[point.site] || []).push(point);
  }

  const dates = [...new Set(history.map((h) => h.recorded_at))].sort();
  const prices = history.map((h) => h.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = Math.max(10, Math.round((maxPrice - minPrice) * 0.1));
  const yMin = Math.max(0, minPrice - pad);
  const yMax = maxPrice + pad;

  const margin = { left: 60, right: 60, top: 10, bottom: 40 };
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
  ctx.fillText(String(yMax), margin.left - 6, margin.top + 8);
  ctx.fillText(String(yMin), margin.left - 6, margin.top + plotH);

  let colorIndex = 0;
  const legendItems = [];
  for (const [site, points] of Object.entries(bySite)) {
    const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
    colorIndex++;
    legendItems.push({ site, color });

    const sorted = [...points].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    sorted.forEach((p, i) => {
      const x = xPos(p.recorded_at);
      const y = yPos(p.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    for (const p of sorted) {
      ctx.beginPath();
      ctx.arc(xPos(p.recorded_at), yPos(p.price), 3, 0, Math.PI * 2);
      ctx.fill();
    }
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
}
