// カード画像が無いときの代わりに表示する「文字のカード」(SVGの画像データ)を作る。
// スマホ版や、画像フォルダを指定していないときに使う。レベルとAPなどの数字だけを大きく出し、
// 効果などの全文は、カードをタップしたときの詳細表示(js/card-detail.js)で見る。
(function(){
  const COLORS = { '青': '#3d6fd8', '赤': '#d8453d', '黄': '#e0b93a', '緑': '#3aa55a', '紫': '#8a4fc0', '黒': '#3a3a48', '白': '#d9d9d9' };
  const cache = new Map();
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const colorsOf = c => String(c.color || '').split(',').map(s => s.trim()).filter(s => COLORS[s]);

  // 名前を数行に折り返す(全角中心。長いものは3行で省略)
  function wrapName(name){
    const chars = Array.from(String(name).replace(/\s+/g, ''));
    const per = 8, lines = [];
    for (let i = 0; i < chars.length && lines.length < 3; i += per) lines.push(chars.slice(i, i + per).join(''));
    if (chars.length > per * 3) lines[2] = lines[2].slice(0, per - 1) + '…';
    return lines;
  }

  // 画面が狭い(スマホ)ときは、盤面のカードが小さくなるので、数字を大きくした表示にする
  const COMPACT = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);

  // 小さく表示する用: 色の帯・名前の頭文字・Lv/APを大きく
  function buildCompact(c){
    const cols = colorsOf(c);
    const main = cols.length ? COLORS[cols[0]] : '#666';
    const dark = cols[0] === '白' || cols[0] === '黄' ? '#222' : '#fff';
    const nums = [];
    if (c.card_type === '事件') { nums.push(['先', c.difficulty_first], ['後', c.difficulty_second]); }
    else {
      if (c.level != null) nums.push(['Lv', c.level]);
      if (c.ap != null) nums.push(['AP', c.ap]);
      if (c.card_type === 'パートナー' && c.lp != null) nums.push(['LP', c.lp]);
    }
    const shown = nums.filter(n => n[1] != null);
    const h = shown.length ? 250 / shown.length : 0;
    const body = shown.map((n, i) => {
      const y = 78 + i * (h - 4);
      const big = String(n[1]).length > 3 ? 56 : 96;
      return `<text x="16" y="${y + h * 0.62}" font-size="34" font-weight="800" fill="#e0b34f">${esc(n[0])}</text>` +
        `<text x="236" y="${y + h * 0.7}" font-size="${shown.length > 2 ? 64 : big}" font-weight="900" text-anchor="end" fill="#fff">${esc(n[1])}</text>`;
    }).join('');
    const head = Array.from(String(c.name)).slice(0, 5).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" width="250" height="350">` +
      `<rect x="2" y="2" width="246" height="346" rx="18" fill="#1d2340" stroke="${main}" stroke-width="5"/>` +
      `<rect x="0" y="0" width="250" height="64" rx="18" fill="${main}"/>` +
      `<text x="125" y="46" font-size="${head.length > 3 ? 40 : 46}" font-weight="800" text-anchor="middle" fill="${dark}">${esc(head)}</text>` +
      body + `</svg>`;
  }

  function build(c){
    const cols = colorsOf(c);
    const main = cols.length ? COLORS[cols[0]] : '#666';
    const band = cols.length > 1
      ? `<defs><linearGradient id="g"><stop offset="0" stop-color="${cols.map(x => COLORS[x])[0]}"/><stop offset="1" stop-color="${cols.map(x => COLORS[x]).slice(-1)[0]}"/></linearGradient></defs><rect x="0" y="0" width="250" height="40" rx="14" fill="url(#g)"/>`
      : `<rect x="0" y="0" width="250" height="40" rx="14" fill="${main}"/>`;
    const dark = cols[0] === '白' || cols[0] === '黄' ? '#222' : '#fff';
    const lines = wrapName(c.name).map((t, i) => `<text x="125" y="${86 + i * 30}" font-size="24" font-weight="700" text-anchor="middle" fill="#f4f1ff">${esc(t)}</text>`).join('');
    // 数字の欄: [ラベル, 値] を並べる
    const stats = [];
    if (c.card_type === '事件') {
      stats.push(['先攻', c.difficulty_first], ['後攻', c.difficulty_second]);
    } else {
      if (c.level != null) stats.push(['Lv', c.level]);
      if (c.ap != null) stats.push(['AP', c.ap]);
      if (c.card_type === 'パートナー' && c.lp != null) stats.push(['LP', c.lp]);
    }
    const shown = stats.filter(s => s[1] != null);
    const rowH = 64, top = 180;
    const statSvg = shown.map((s, i) => {
      const y = top + i * rowH;
      return `<rect x="22" y="${y}" width="206" height="54" rx="12" fill="rgba(255,255,255,.12)"/>` +
        `<text x="40" y="${y + 36}" font-size="22" font-weight="700" fill="#e0b34f">${esc(s[0])}</text>` +
        `<text x="214" y="${y + 40}" font-size="${String(s[1]).length > 4 ? 30 : 36}" font-weight="800" text-anchor="end" fill="#fff">${esc(s[1])}</text>`;
    }).join('');
    const lpLine = (c.card_type === 'キャラ' && c.lp != null)
      ? `<text x="125" y="${top + shown.length * rowH + 22}" font-size="18" text-anchor="middle" fill="#bbb">LP ${esc(c.lp)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" width="250" height="350">` +
      `<rect x="1" y="1" width="248" height="348" rx="15" fill="#1d2340" stroke="${main}" stroke-width="2"/>` +
      band +
      `<text x="125" y="27" font-size="18" font-weight="700" text-anchor="middle" fill="${dark}">${esc(c.card_type || '')}</text>` +
      lines + statSvg + lpLine + `</svg>`;
  }

  // full=true: 詳細パネル用の、情報がそろった大きめの表示
  function url(cardId, full){
    const key = full ? 'f' + cardId : cardId;
    if (cache.has(key)) return cache.get(key);
    const c = (window.CARD_DATA || []).find(x => x.id === cardId);
    if (!c) return null;
    const u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent((COMPACT && !full) ? buildCompact(c) : build(c)).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27');
    cache.set(key, u);
    return u;
  }
  window.CardArt = { url };
})();
