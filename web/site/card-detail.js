// カード個別ページ(card/{id}.html)用。ページ本体の主要な情報(名前・ステータス・
// 相場の数値)はビルド時(generate_card_pages.py)に静的HTMLへ直接埋め込み済みで、
//検索エンジンやJavaScript無効の環境でもそのまま読める。このスクリプトは読み込み後、
// 一覧ページのモーダルと同じ期間切り替えタブ付きのインタラクティブなグラフに
// 差し替える(値そのものは静的埋め込み分と一致する)。

async function init() {
  bindNavMenuToggle();

  const cards = await loadCardData();
  const card = cards.find((c) => c.id === window.CARD_DETAIL_ID);
  if (!card) return;

  renderPriceSection(card.id, card.card_num, card.name, card.rarity, card.card_id);
  renderLastUpdated();
}

init();
