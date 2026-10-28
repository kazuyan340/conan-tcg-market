// カード画像の探索。
// 画像はアプリに同梱せず、ユーザーが公式サイトからダウンロードして置いたフォルダ(画像設定で指定)から読み込む。
// 探すファイル名は、公式サイトの画像のファイル名(data/image-names.js)。
// 手元でカードID名(1.jpg など)にしている場合もそのまま読めるよう、「カードID.jpg」も探す。
(function(){
  const cfg = (window.electronAPI && window.electronAPI.imageConfig) || { dir: null, files: [] };
  const stem = f => f.replace(/\.[^.]+$/, '').toLowerCase();
  const byStem = new Map();
  (cfg.files || []).forEach(f => { if (!byStem.has(stem(f))) byStem.set(stem(f), f); });
  const NAMES = window.CARD_IMAGE_NAMES || {};

  function fileUrl(file){
    const base = String(cfg.dir).replace(/\\/g, '/').replace(/\/+$/, '');
    return encodeURI('file:///' + base + '/' + file).replace(/#/g, '%23');
  }
  // sub=true で裏面の画像
  function find(cardId, sub){
    if (!cfg.dir || cardId == null) return null;
    const names = NAMES[String(cardId)];
    const official = names && names[sub ? 1 : 0];
    let f = official ? byStem.get(stem(official)) : null;
    if (!f) f = byStem.get(String(cardId) + (sub ? '_sub' : ''));
    return f ? fileUrl(f) : null;
  }
  // 画像をアプリに同梱している版(js/image-mode.js が true): data/images の画像をそのまま使う
  const BUNDLED = !!window.BUNDLED_IMAGES;
  const cardById = id => (window.CARD_DATA || []).find(c => c.id === id || String(c.id) === String(id));
  function bundledUrl(cardId, sub){
    const c = cardById(cardId); const f = c && (sub ? c.sub_image_url : c.image_url);
    return f ? 'data/images/' + f : null;
  }
  window.CardImages = {
    dir: BUNDLED ? 'bundled' : cfg.dir,
    bundled: BUNDLED,
    fileCount: BUNDLED ? (window.CARD_DATA || []).length : (cfg.files || []).length,
    // 画像のURL。無ければ null (呼び出し側が名前表示に切り替える)
    url: (cardId) => BUNDLED ? bundledUrl(cardId, false) : find(cardId, false),
    subUrl: (cardId) => BUNDLED ? bundledUrl(cardId, true) : find(cardId, true),
    // カードの裏面(伏せ札)の画像。画像フォルダに cardback.jpg / cardback.png があれば使う
    backUrl: () => {
      const f = byStem.get('cardback');
      return f ? fileUrl(f) : null;
    },
    // 画像設定の画面用: 全カードの有無
    status: (cardIds) => cardIds.map(id => ({ id, found: BUNDLED ? !!bundledUrl(id, false) : !!find(id, false), name: (NAMES[String(id)] || [])[0] || null })),
  };
  // 伏せ札の背景(画像がなければ、CSS側の既定の模様になる)
  const back = window.CardImages.backUrl();
  if (back) document.documentElement.style.setProperty('--cardback-url', `url("${back}")`);
})();
