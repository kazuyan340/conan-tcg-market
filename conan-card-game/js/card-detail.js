// カード詳細の表示(効果の全文など)。画像が無い環境(スマホ版など)では、盤面のカードには
// レベル・APなどの数字しか出ないので、全文はここで見る。
//   ・カードを長押し(PCはマウスの長押し、または右クリック)すると詳細を開く
//   ・開いたあとは、もう一度どこかをタップすると閉じる
//   ・オンライン対戦のゲスト画面は盤面がホストの写しなので、詳細は必ず自分の画面だけで開く(ホストへは送らない)
(function(){
  const LONG_PRESS_MS = 450;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const byId = () => window.CARD_BY_ID_LOOKUP || (window.CARD_BY_ID_LOOKUP = new Map((window.CARD_DATA || []).map(c => [c.id, c])));

  const style = document.createElement('style');
  style.textContent = `
    img{ -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
    #cardDetail{ position:fixed; inset:0; z-index:500; background:rgba(8,6,20,.78); display:none; align-items:center; justify-content:center; padding:14px; }
    #cardDetail .cd-box{ position:relative; width:min(520px,100%); max-height:92vh; overflow:auto; background:#1e2330; color:#fff; border:2px solid #e0b34f; border-radius:14px; padding:16px; box-shadow:0 14px 40px rgba(0,0,0,.6); }
    #cardDetail .cd-close{ position:absolute; top:6px; right:8px; background:none; border:none; color:#fff; font-size:20px; cursor:pointer; padding:6px 10px; }
    #cardDetail .cd-head{ display:flex; gap:14px; align-items:flex-start; }
    #cardDetail .cd-head img{ width:min(38%,170px); border-radius:8px; flex:0 0 auto; }
    #cardDetail .cd-name{ font-size:17px; font-weight:800; margin:0 24px 8px 0; line-height:1.4; }
    #cardDetail .cd-row{ display:flex; justify-content:space-between; gap:10px; font-size:12.5px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.1); }
    #cardDetail .cd-row span{ color:#e0b34f; flex:0 0 auto; }
    #cardDetail .cd-row b{ font-weight:600; text-align:right; }
    #cardDetail .cd-text{ margin-top:12px; font-size:14px; line-height:1.75; white-space:pre-wrap; background:rgba(0,0,0,.25); border-radius:8px; padding:10px 12px; }
  `;
  document.head.appendChild(style);

  // ---- 詳細パネル ----
  let panel = null;
  function ensurePanel(){
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'cardDetail';
    panel.innerHTML = '<div class="cd-box"><button class="cd-close" aria-label="閉じる">✕</button><div class="cd-body"></div></div>';
    panel.addEventListener('click', close);   // どこをタップしても閉じる
    document.body.appendChild(panel);
    return panel;
  }
  function row(label, value){
    return value == null || value === '' ? '' : `<div class="cd-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }
  function open(cardId){
    const c = byId().get(cardId);
    if (!c) return;
    const art = (window.CardImages && window.CardImages.url(cardId)) || (window.CardArt && window.CardArt.url(cardId, true));
    const stats = [
      row('種類', [c.card_type, c.rarity].filter(Boolean).join(' / ')),
      row('色', c.color),
      row('レベル', c.level), row('AP', c.ap), row('LP', c.lp),
      row('事件レベル(先攻/後攻)', c.difficulty_first != null || c.difficulty_second != null ? `${c.difficulty_first ?? '-'} / ${c.difficulty_second ?? '-'}` : null),
      row('特徴', c.category),
      row('カードNo', c.card_num),
    ].join('');
    const text = (c.ability_text || '').replace(/\r\n/g, '\n');
    const p = ensurePanel();
    p.querySelector('.cd-body').innerHTML =
      `<div class="cd-head">${art ? `<img src="${art}" alt="">` : ''}<div><div class="cd-name">${esc(c.name)}</div>${stats}</div></div>` +
      `<div class="cd-text">${text ? esc(text) : '(効果テキストなし)'}</div>`;
    p.style.display = 'flex';
  }
  function close(){ if (panel) panel.style.display = 'none'; }
  window.CardDetail = { open, close };

  // ---- 要素 → カードID(画像のsrcからたどる。ホストでもゲストでも同じ方法で分かる) ----
  let srcToId = null;
  function buildIndex(){
    srcToId = new Map();
    const imgOf = id => (typeof cardImage === 'function' && cardImage(id))
      || (window.CardImages && window.CardImages.url(id)) || (window.CardArt && window.CardArt.url(id));
    (window.CARD_DATA || []).forEach(c => { const u = imgOf(c.id); if (u) srcToId.set(u, c.id); });
  }
  function cardIdFromElement(el){
    if (!srcToId) buildIndex();
    for (let n = el, depth = 0; n && n !== document.body && depth < 5; n = n.parentNode, depth++) {
      if (n.classList && n.classList.contains('hidden-card')) return null;      // 伏せている相手の手札は見せない
      const img = n.tagName === 'IMG' ? n : (n.querySelector && n.querySelector('img'));
      if (img) {
        const src = img.getAttribute('src');
        if (src && srcToId.has(src)) return srcToId.get(src);
        const cid = img.getAttribute('data-cid');
        if (cid && /^\d+$/.test(cid)) return Number(cid);
        if (depth > 0) return null;      // 上の階層のどれかの画像を誤って拾わないよう、最初に見つけた画像だけを見る
      }
    }
    return null;
  }

  // ---- 長押し / 右クリック ----
  let timer = null, startX = 0, startY = 0, swallowClickUntil = 0;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('#cardDetail')) return;
    clearTimeout(timer);
    startX = e.clientX; startY = e.clientY;
    const target = e.target;
    timer = setTimeout(() => {
      const id = cardIdFromElement(target);
      if (id == null) return;
      swallowClickUntil = Date.now() + 700;   // 指を離したときのクリックが、カードの操作として扱われないようにする
      open(id);
    }, LONG_PRESS_MS);
  }, true);
  const cancel = () => clearTimeout(timer);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); }, true);
  document.addEventListener('contextmenu', e => {
    if (e.target.closest && e.target.closest('#cardDetail')) return;
    const id = cardIdFromElement(e.target);
    if (id == null) return;
    e.preventDefault(); open(id);
  }, true);

  // 長押し直後のクリックを捨てる(指を離したときのクリックが、カードの操作として扱われないようにする)
  document.addEventListener('click', e => {
    if (Date.now() < swallowClickUntil) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }, true);
})();
