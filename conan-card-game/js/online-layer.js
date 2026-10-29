// オンライン対戦(縦向き画面)。js/battle-engine.js(2人用の対戦エンジン)の上に載せる層。
//
// 方式:ホストのエンジンだけが本物の対戦を進める(正)。ゲストの画面は、ホストの盤面の
//   HTMLを鏡写しに受け取って表示し、ゲストのクリックだけをホストに送って、ホスト側で
//   「そのクリックをした」ことにして動かす。どちらの画面でも相手の手札は伏せて見せる。
//   ・ホスト = エンジン上の 'self' 側 / ゲスト = 'opponent' 側
//   ・「いまどちらの操作待ちか」(computeOwner)の側だけがクリックできる
//   ・カード画像は各自のPCの画像フォルダから読み込む(通信ではカードIDだけを送る)
(function(){
  'use strict';
  const $ = id => document.getElementById(id);

  // 鏡写しにする画面部品。ゲストの画面は、これらの中身をホストのものに丸ごと置き換える
  const MIRROR_IDS = ['board', 'turnBar', 'actionHintBar', 'mulliganPanel', 'gameOverOverlay', 'deckPeekOverlay', 'choiceOverlay'];
  // 持ち主にしか見せないダイアログ(手札や山札の中身が出る)
  const PRIVATE_IDS = ['mulliganPanel', 'deckPeekOverlay', 'choiceOverlay'];

  let role = null;          // 'host' | 'guest'
  let conn = null;
  let mySide = null;        // 'self'(ホスト) | 'opponent'(ゲスト)
  let rev = 0;              // ホストが送った盤面の版。ゲストのクリックがどの版を見て押されたかの照合に使う
  let dirty = false;        // ホストの盤面が、最後に送った版から変わっている
  let owner = null;         // いま操作できる側: 'self' | 'opponent' | 'both' | null
  let forceBoth = false;    // 操作待ちの判定が外れて止まったときの非常口(ホストが入れる)
  let replayingRemote = false;
  let choiceOwner = null;

  // ============ カード画像:URL ⇄ カードID(画像の場所は各自のPCで違うので、通信にはIDだけを載せる) ============
  const urlToToken = new Map();
  function buildImageTokens(){
    urlToToken.clear();
    const CI = window.CardImages;
    (window.CARD_DATA || []).forEach(c => {
      const u = cardImage(c.id);          // 画像フォルダの画像、無ければ文字のカード
      if (u) urlToToken.set(u, String(c.id));
    });
    const b = CI && CI.backUrl && CI.backUrl();
    if (b) urlToToken.set(b, 'back');
  }
  function tokenToUrl(tok){
    const CI = window.CardImages;
    if (tok === 'back') return CI && CI.backUrl ? CI.backUrl() : null;
    return cardImage(Number(tok.replace(/s$/, '')));
  }
  // HTML文字列の中の自分のPCの画像URLを cid:トークン に置き換える(送信前)
  function urlsToTokens(html){
    return html.replace(/(?:file:\/\/\/|data:image\/svg\+xml;charset=utf-8,|data\/images\/)[^"')\s<>]+/g, u => urlToToken.has(u) ? 'cid:' + urlToToken.get(u) : u);
  }
  // 受信したHTMLの cid:トークン を、自分のPCの画像URLに戻す(画像が無ければ空にして名前表示に任せる)
  function tokensToUrls(html){
    return html.replace(/cid:(\d+s?|back)/g, (m, tok) => tokenToUrl(tok) || 'data:,');
  }

  // ============ 「いまどちらの操作待ちか」 ============
  // エンジンの各選択状態(let変数)は、選ぶ側を .side などに持っている。
  const SIDE_STATES = [
    () => typeof evidencePickState !== 'undefined' && evidencePickState,
    () => typeof handDiscardState !== 'undefined' && handDiscardState,
    () => typeof deckPeekState !== 'undefined' && deckPeekState,
    () => typeof partnerRemoveState !== 'undefined' && partnerRemoveState,
    () => typeof oppHandPickState !== 'undefined' && oppHandPickState,
    () => typeof freePlayChoiceState !== 'undefined' && freePlayChoiceState,
    () => typeof actionEndSwapState !== 'undefined' && actionEndSwapState,
    () => typeof kaitoActionEndState !== 'undefined' && kaitoActionEndState,
    () => typeof switchState !== 'undefined' && switchState,
    () => typeof mrReplaceState !== 'undefined' && mrReplaceState,
    () => typeof sleepCostState !== 'undefined' && sleepCostState,
    () => typeof removeEventState !== 'undefined' && removeEventState,
    () => typeof lpBuffChoiceState !== 'undefined' && lpBuffChoiceState,
    () => typeof keywordGrantChoiceState !== 'undefined' && keywordGrantChoiceState,
    () => typeof hiramekiState !== 'undefined' && hiramekiState,
    () => typeof hiramekiSleepState !== 'undefined' && hiramekiSleepState,
    () => typeof bonusEvidenceState !== 'undefined' && bonusEvidenceState,
    () => typeof sleepForOppDiscardState !== 'undefined' && sleepForOppDiscardState,
    () => typeof apBuffState !== 'undefined' && apBuffState,
  ];
  function computeOwner(){
    try {
      if (typeof match === 'undefined' || !match) return null;
      if (match.gameOver) return 'both';
      if (mulliganPhase) return mulliganPhase;
      if (disguiseReactState) return disguiseReactState.oppSide;
      if (misleadState) return misleadState.oppSide;
      for (const get of SIDE_STATES) { const st = get(); if (st && st.side) return st.actor || st.side; }
      if (choiceState) return choiceOwner || currentActorSide() || (match.turn && match.turn.activeSide) || 'self';
      if (contactState && contactState.queue && contactState.queue.length) return contactState.queue[0];
      if (actionState) return actionState.step === 'guard' ? actionState.oppSide : actionState.side;
      return (match.turn && match.turn.activeSide) || match.firstPlayer || 'self';
    } catch (e) { return match && match.turn ? match.turn.activeSide : 'self'; }
  }
  const canAct = (who, side) => forceBoth || who === 'both' || who === side;

  // 汎用選択ダイアログは選ぶ側を持たないので、開いた時点の「効果の主」を覚えておく
  (function wrapEngine(){
    const origOpenChoice = window.openChoice;
    if (typeof origOpenChoice === 'function') {
      window.openChoice = function(cfg){
        choiceOwner = (typeof currentActorSide === 'function' && currentActorSide()) || null;
        return origOpenChoice.apply(this, arguments);
      };
    }
    // 「カード名を指定」の入力は盤面の外に出る専用ダイアログなので、ゲストの番ならゲストの画面に出す
    const origPrompt = window.promptCardName;
    if (typeof origPrompt === 'function') {
      let seq = 0;
      window.promptCardName = function(sourceUid, hint, onDone, optional){
        const who = (typeof currentActorSide === 'function' && currentActorSide()) || (match && match.turn && match.turn.activeSide);
        if (role === 'host' && who === 'opponent' && conn) {
          const id = ++seq;
          const title = sourceUid ? '「' + cardName(uidToCardId(sourceUid)) + '」' : 'カード名を指定';
          pendingNames.set(id, onDone);
          conn.send({ t: 'askName', id, hint: title + ' ' + (hint || ''), optional: !!optional });
          return;
        }
        return origPrompt.apply(this, arguments);
      };
    }
  })();
  const pendingNames = new Map();

  // ============ 縦向きの盤面フィット(元の fitRotatedTable は90度回して横画面に収める) ============
  window.fitRotatedTable = function fitPortraitTable(retry){
    const table = document.querySelector('.table');
    const wrap = document.querySelector('.table-rotate-wrap');
    const board = $('board');
    const header = document.querySelector('header');
    if (!table || !wrap || !board || getComputedStyle(board).display === 'none') return;
    const rot = role === 'guest' ? 180 : 0;   // ゲストは盤面を180度回して、自分の陣地を手前にする
    wrap.style.width = 'auto'; wrap.style.height = 'auto';
    table.style.transform = 'translate(-50%, -50%) scale(1)';
    const rect = table.getBoundingClientRect();
    const availW = board.clientWidth - 8;
    const availH = document.documentElement.clientHeight - (header ? header.getBoundingClientRect().height : 0) - 14 - 40;
    const s = Math.max(0.1, Math.min(availW / rect.width, availH / rect.height, 1));
    table.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(${s})`;
    wrap.style.width = (rect.width * s) + 'px';
    wrap.style.height = (rect.height * s) + 'px';
    if (!retry) setTimeout(() => window.fitRotatedTable(true), 200);
  };

  // ============ 画面下の「操作待ち」表示 ============
  let bannerTimer = null;
  function updateBanner(){
    const b = $('onlineBanner');
    if (!conn || conn.state !== 'open') return;
    const mine = canAct(owner, mySide);
    document.body.classList.toggle('wait-overlays', role === 'host' && !mine);
    b.className = mine ? 'mine' : '';
    b.textContent = owner == null ? '' : mine ? '▶ あなたの操作です' : '⏳ 相手の操作待ちです';
  }
  function flash(text){
    const b = $('onlineBanner');
    b.className = ''; b.textContent = text;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(updateBanner, 1400);
  }

  // ============ ロビー ============
  const lobbyStatus = (t, cls) => { const el = $('lobbyStatus'); el.textContent = t; el.className = 'status ' + (cls || ''); };
  let abortCtl = null;
  let myDeck = null, myName = '';

  function initLobby(){
    const sel = $('lobbyDeck');
    const decks = (typeof loadSavedDecks === 'function') ? loadSavedDecks() : [];
    sel.innerHTML = '';
    decks.forEach((d, i) => {
      const n = (d.cards || []).reduce((a, c) => a + c.qty, 0);
      const o = document.createElement('option'); o.value = i; o.textContent = `${d.name || '無題'}(${n}枚)`; sel.appendChild(o);
    });
    $('deckNote').textContent = decks.length ? '' : 'デッキがありません。メニューの「デッキ作成」で先にデッキを作ってください。';
    $('lobbyStart').disabled = !decks.length;
    const CI = window.CardImages;
    if (!window.electronAPI) { const n = $('imgNote'); if (n) n.style.display = 'none'; }   // ブラウザ版には画像フォルダの設定が無い
    else if (CI && !CI.dir) $('deckNote').textContent += ' ※カード画像のフォルダが未設定です(メニューの「画像設定」)。文字のカード(レベル・AP)で表示されます。';
    const savedPass = (() => { try { return localStorage.getItem('conanTcgOnlinePass') || ''; } catch (e) { return ''; } })();
    $('lobbyPass').value = savedPass;
    try { $('lobbyName').value = localStorage.getItem('conanTcgOnlineName') || ''; } catch (e) {}

    $('lobbyStart').onclick = async () => {
      const pass = $('lobbyPass').value.trim();
      if (!pass) { lobbyStatus('パスを入力してください', 'ng'); return; }
      myDeck = decks[Number(sel.value)];
      if (!myDeck) { lobbyStatus('デッキを選んでください', 'ng'); return; }
      myName = $('lobbyName').value.trim().slice(0, 12);
      if (!myName) { lobbyStatus('名前を入力してください', 'ng'); return; }
      try { localStorage.setItem('conanTcgOnlinePass', pass); localStorage.setItem('conanTcgOnlineName', myName); } catch (e) {}
      $('lobbyStart').disabled = true; $('lobbyCancel').style.display = '';
      abortCtl = new AbortController();
      try {
        const r = await OnlineMatch.findOpponent(pass, { onStatus: t => lobbyStatus(t), signal: abortCtl.signal });
        onConnected(r.conn, r.role);
      } catch (e) {
        lobbyStatus(e.message, 'ng');
        $('lobbyStart').disabled = false; $('lobbyCancel').style.display = 'none';
      }
    };
    $('lobbyCancel').onclick = () => { if (abortCtl) abortCtl.abort(); };
  }

  // ============ 接続後 ============
  let guestDeck = null, guestName = '', hostStarted = false;
  function onConnected(c, r){
    conn = c; role = r;
    mySide = role === 'host' ? 'self' : 'opponent';
    document.body.classList.add(role);
    lobbyStatus('接続しました。デッキを交換しています…', 'ok');
    buildImageTokens();
    conn.onMessage = onMessage;
    conn.onClose = reason => {
      const b = $('onlineBanner'); b.className = ''; b.textContent = '⚠ 通信が切れました(' + reason + ')';
      if (!$('lobby').classList.contains('hidden')) { lobbyStatus('通信が切れました', 'ng'); $('lobbyStart').disabled = false; }
    };
    conn.send({ t: 'deck', deck: myDeck, name: myName });
    window.addEventListener('resize', () => { if (role === 'guest') window.fitRotatedTable(); });
  }

  function onMessage(m){
    if (!m || !m.t) return;
    if (m.t === 'deck' && role === 'host') { guestDeck = m.deck; guestName = String(m.name || '').slice(0, 12) || 'ゲスト'; startAsHost(); }
    else if (m.t === 'snap' && role === 'guest') enqueueSnap(m);
    else if (m.t === 'fx' && role === 'guest') enqueueFx(m);
    else if (m.t === 'click' && role === 'host') onGuestClick(m);
    else if (m.t === 'input' && role === 'host') onGuestInput(m);
    else if (m.t === 'askName' && role === 'guest') askNameOnGuest(m);
    else if (m.t === 'name' && role === 'host') { const cb = pendingNames.get(m.id); pendingNames.delete(m.id); if (cb) cb(m.v); }
  }

  // ============ ホスト ============
  function startAsHost(){
    if (hostStarted || !guestDeck) return;
    hostStarted = true;
    $('lobby').classList.add('hidden');
    const first = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) ? 'self' : 'opponent';
    startMatchWith({ ...myDeck, name: myName }, { ...guestDeck, name: guestName }, first);
    installHostMirroring();
    installHostFx();
    owner = computeOwner();
    updateBanner();
    scheduleSnap(0);
  }

  let snapTimer = null;
  const lastSent = {};   // 各部品について、最後にゲストへ送った内容
  function scheduleSnap(delay){
    dirty = true;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(sendSnapshot, delay == null ? 60 : delay);
  }
  function installHostMirroring(){
    const mo = new MutationObserver(() => { owner = computeOwner(); updateBanner(); scheduleSnap(); });
    MIRROR_IDS.forEach(id => { const el = $(id); if (el) mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-hand-focus'] });
    // DOMが動かない状態変化(選択状態の切り替えだけ等)の取りこぼし対策
    setInterval(() => { const o = computeOwner(); if (o !== owner) { owner = o; updateBanner(); scheduleSnap(0); } }, 400);

    // ホスト自身のクリック:相手の操作待ちのときは押せない
    document.addEventListener('click', e => {
      if (replayingRemote || !e.isTrusted) return;
      if (!rootOf(e.target)) return;
      if (!canAct(computeOwner(), 'self')) { e.preventDefault(); e.stopPropagation(); flash('相手の操作待ちです'); }
    }, true);

    // 非常口:操作待ちの判定が外れて誰も押せなくなったとき用(ヘッダーのボタン)
    const act = $('headerActions');
    const btn = document.createElement('button');
    btn.className = 'btn ghost small'; btn.textContent = '🔓 どちらも操作可';
    btn.title = '操作が止まったときだけ使う(お互いの操作制限を外す)';
    btn.onclick = () => { forceBoth = !forceBoth; btn.textContent = forceBoth ? '🔒 操作を元に戻す' : '🔓 どちらも操作可'; owner = computeOwner(); updateBanner(); scheduleSnap(0); };
    new MutationObserver(() => { if (!btn.isConnected) act.appendChild(btn); }).observe(act, { childList: true });
    act.appendChild(btn);
  }

  function rootOf(node){
    for (let n = node; n && n !== document.body; n = n.parentNode) if (n.id && MIRROR_IDS.includes(n.id)) return n;
    return null;
  }

  // ゲストへ送る用に盤面をコピーして、見せてはいけないものを隠す(要素の数・並びは変えない=クリック位置の照合のため)
  function sanitizeForGuest(clone, id){
    if (id === 'board') {
      clone.querySelectorAll('.zone[data-side="self"] .hand-row .hcard').forEach(h => {
        h.classList.add('hidden-card');
        h.removeAttribute('title');
        const img = h.querySelector('img');
        if (img) { img.removeAttribute('src'); img.removeAttribute('alt'); }
      });
      // ホストの手札のメニューが開いていても、カードの正体(詳細ボタンのID)は送らない
      clone.querySelectorAll('.zone[data-side="self"] .hand-row .detail-btn').forEach(b => { b.removeAttribute('data-cid'); b.style.display = 'none'; });
      // ホストがカードにマウスを乗せたときの拡大表示(手札の中身が出うる)は送らない
      const sp = clone.querySelector('#cardSpotlight');
      if (sp) { sp.style.display = 'none'; sp.innerHTML = ''; }
    }
    clone.querySelectorAll('img').forEach(img => {
      const raw = img.getAttribute('src');
      const tok = raw && urlToToken.get(raw);
      if (tok) { img.setAttribute('data-cid', tok); img.removeAttribute('src'); }
    });
  }

  function sendSnapshot(){
    if (!conn || conn.state !== 'open' || typeof match === 'undefined' || !match) return;
    owner = computeOwner();
    const roots = {};
    let changed = false;
    MIRROR_IDS.forEach(id => {
      const el = $(id); if (!el) return;
      let h = '';
      const publicChoice = id === 'choiceOverlay' && typeof choiceState !== 'undefined' && !!choiceState && !!choiceState.public;   // 手札の公開は両方に見せる
      const hideForGuest = PRIVATE_IDS.includes(id) && !canAct(owner, 'opponent') && !publicChoice;
      if (!hideForGuest) {
        const clone = el.cloneNode(true);
        sanitizeForGuest(clone, id);
        h = urlsToTokens(clone.innerHTML);
      }
      let s = el.getAttribute('style') || '';
      if (hideForGuest) s = 'display:none;';
      const cls = el.className || '';
      const key = h + '\u0000' + s + '\u0000' + cls;
      if (lastSent[id] === key) return;
      lastSent[id] = key; changed = true;
      roots[id] = { h, s, c: cls };
    });
    const hf = document.body.dataset.handFocus || '';
    const meta = { owner, hf, forceBoth };
    const metaKey = JSON.stringify(meta);
    if (!changed && lastSent.__meta === metaKey) { dirty = false; return; }
    lastSent.__meta = metaKey;
    rev++; dirty = false;
    sendCompressed({ t: 'snap', rev, roots, meta });
  }

  // ホスト:ゲストのクリックを、ホストの盤面の同じ位置の要素に対して行ったことにする
  function resolvePath(root, path){
    let n = root;
    for (const i of path) { n = n && n.children && n.children[i]; if (!n) return null; }
    return n;
  }
  function onGuestClick(m){
    if (!canAct(computeOwner(), 'opponent')) { sendSnapshot(); return; }
    if (m.rev !== rev || dirty) { scheduleSnap(0); return; }   // 古い画面を見て押したクリックは捨てる(画面を最新にして再度押してもらう)
    const root = $(m.root); const el = root && resolvePath(root, m.path);
    if (!el) return;
    replayingRemote = true;
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); }
    finally { replayingRemote = false; }
    scheduleSnap(0);
  }
  function onGuestInput(m){
    if (m.rev !== rev || dirty) return;
    const root = $(m.root); const el = root && resolvePath(root, m.path);
    if (!el) return;
    if ('checked' in m && m.checked != null) el.checked = m.checked; else el.value = m.value;
    el.dispatchEvent(new Event(m.ev || 'input', { bubbles: true }));
  }

  // ============ 演出(カットイン・カードが飛ぶ動き・ぶつかり合い)を両方の画面に出す ============
  // ホストのエンジンが演出の関数を呼んだら、同じ内容をゲストへ送って、ゲストの画面でも同じ関数を動かす。
  // 場所は「盤面の中の位置(子要素の番号の列)」で伝える(ゲストの盤面はホストの鏡写しで構造が同じ)。
  // 手札や山札の中身が見えてしまわないよう、カードの絵は公開されている場所に着くときだけ送る。
  function locate(el){
    if (!(el instanceof Element)) return null;
    const root = rootOf(el); if (!root || root.id !== 'board') return null;
    const path = [];
    for (let n = el; n && n !== root; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.children, n));
    return path;
  }
  function fxSend(obj){
    if (role !== 'host' || !conn) return;
    sendChain = sendChain.then(() => { if (conn && conn.state === 'open') conn.send({ t: 'fx', ...obj }); }).catch(() => {});
  }
  function faceToken(url, toEl){
    if (!url || !(toEl instanceof Element)) return null;
    if (!toEl.closest('.remove-top, .partner-slot, .assist-file-card, .char-card, .case-slot')) return null;
    return urlToToken.get(url) || null;
  }
  function installHostFx(){
    const wrap = (name, make) => {
      const orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function(){ try { make.apply(null, arguments); } catch (e) { console.error('fx', name, e); } return orig.apply(this, arguments); };
    };
    const origSnap = window.snapshotCardPosition;
    if (typeof origSnap === 'function') window.snapshotCardPosition = function(el){ const r = origSnap.apply(this, arguments); try { if (r && typeof r === 'object') r.__path = locate(el); } catch (e) {} return r; };
    const pathOfFrom = f => f instanceof Element ? locate(f) : (f && f.__path) || null;
    wrap('flyGhostCard', (from, to, face) => { const fp = pathOfFrom(from), tp = locate(to); if (fp && tp) fxSend({ k: 'fly', from: fp, to: tp, face: faceToken(face, to) }); });
    wrap('fadeDrawCard', (from, to) => { const fp = pathOfFrom(from); if (fp) fxSend({ k: 'fade', from: fp, to: locate(to) }); });
    wrap('animateCardEntry', fieldEl => { const p = locate(fieldEl); if (p) fxSend({ k: 'entry', to: p }); });
    wrap('playCutInEffect', (cardId, onDone, amountText) => fxSend({ k: 'cutin', cardId, amount: amountText || null }));
    wrap('playClashEffect', (l, r, removed, onDone, lb, rb) => fxSend({ k: 'clash', l, r, removed, lb: lb || [], rb: rb || [] }));
    wrap('flashCaseCard', side => fxSend({ k: 'flashCase', side }));
    // 対戦ログ: エンジンが出来事を記録するたびに1行作る(自分の画面と、ゲストの画面向けの2通り)
    const origRec = window.recordEvent;
    if (typeof origRec === 'function') window.recordEvent = function(ev){
      const n0 = match && match.events ? match.events.length : 0;
      const r = origRec.apply(this, arguments);
      try { if (match && match.events && match.events.length > n0) pushLog(match.events[match.events.length - 1]); } catch (e) { console.error('log', e); }
      return r;
    };
  }

  // ---- 対戦ログ ----
  // 相手に見えてはいけない出来事(伏せてセットする・山札の中を見る等)は、相手の画面ではカード名を「？」にする
  const HIDDEN_LOG_TYPES = new Set(['handToUnder', 'stackUnder', 'setEvent', 'handToDeckTop', 'handToFileBottom', 'deckPeekChoose', 'deckPeekReorder', 'deckPeekMill', 'deckPeekRemove', 'deckBottomToHand', 'deckSearchUntil', 'jewelToHand', 'evidenceToDeckBottom', 'fileToHand', 'removeToDeckTop', 'underToEvidenceFaceUp', 'fieldToEvidenceFaceUp', 'deckTopToEvidenceFaceUp', 'fileTopFaceUp', 'millSelf']);
  const NO_LOG_TYPES = new Set(['markHayateFirstEntryUsed', 'markEnteredByCutin', 'markContactRemovalCredit', 'markContactKill', 'markChosenByMR', 'deckShuffle']);
  function redactFor(ev, text, viewerSide){
    if (ev.side != null && ev.side !== viewerSide && HIDDEN_LOG_TYPES.has(ev.type)) return text.replace(/「[^」]*」/g, '「？」');
    return text;
  }
  function pushLog(ev){
    if (!ev || NO_LOG_TYPES.has(ev.type)) return;
    const text = describeEvent(ev);
    if (!text || text.charAt(0) === '{') return;   // 説明の無い内部の出来事は出さない
    addLogLine(redactFor(ev, text, 'self'), ev.type === 'turnStart', ev.side === 'self');
    fxSend({ k: 'log', text: redactFor(ev, text, 'opponent'), turn: ev.type === 'turnStart', mine: ev.side === 'opponent' });
  }
  const LOG_MAX = 300;
  function addLogLine(text, isTurn, mine){
    const box = $('onlineLog'); if (!box) return;
    const d = document.createElement('div');
    d.className = 'ln' + (isTurn ? ' turn' : '') + (mine ? ' mine' : '');
    d.textContent = text;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    box.appendChild(d);
    while (box.children.length > LOG_MAX) box.removeChild(box.firstChild);
    box.classList.remove('hidden');
    layoutLog();
    if (atEnd) box.scrollTop = box.scrollHeight;
  }
  // 盤面の下に残った余白の高さに合わせてログ欄の大きさを決める(余白が小さすぎるときは隠す)
  function layoutLog(){
    const box = $('onlineLog'); if (!box || box.classList.contains('hidden')) return;
    const wrap = document.querySelector('.table-rotate-wrap');
    if (!wrap || !$('board') || getComputedStyle($('board')).display === 'none') return;
    const bottomUsed = wrap.getBoundingClientRect().bottom + 6;
    const avail = document.documentElement.clientHeight - bottomUsed - 62;
    if (avail < 44) { box.style.height = '0'; box.style.visibility = 'hidden'; return; }
    box.style.visibility = ''; box.style.height = Math.min(avail, 260) + 'px';
  }
  window.addEventListener('resize', () => setTimeout(layoutLog, 250));

  // ---- ゲスト側で演出を再生する ----
  // 「飛ぶ」系は、出発点を今の(変更前の)画面で測り、盤面を最新に置き換えたあとで着地点へ飛ばす。
  const pendingFly = [];
  let flyTimer = null;
  const boardEl = () => $('board');
  function snapAt(path){ const el = path && resolvePath(boardEl(), path); return el ? snapshotCardPosition(el) : null; }
  function withStubMatch(fn){
    // 演出の関数は盤面の状態(match)を少しだけ参照する。ゲストには無いので空の入れ物を一瞬だけ渡す
    const prev = match;
    match = { self: { remove: [] }, opponent: { remove: [] } };
    try { return fn(); } finally { match = prev; }
  }
  function runPendingFly(){
    clearTimeout(flyTimer); flyTimer = null;
    pendingFly.splice(0).forEach(f => {
      try {
        const to = f.to ? resolvePath(boardEl(), f.to) : null;
        if (f.k === 'fly' && f.from && to) withStubMatch(() => flyGhostCard(f.from, to, f.face ? tokenToUrl(f.face) : null));
        else if (f.k === 'fade' && f.from) withStubMatch(() => fadeDrawCard(f.from, to));
        else if (f.k === 'entry' && to) {
          const zone = to.closest('.zone'); const hand = zone && zone.querySelector('.hand-row');
          const tr = to.getBoundingClientRect(), hr = hand ? hand.getBoundingClientRect() : null;
          if (hr) animateCardEntry(to, { left: hr.left + hr.width / 2 - tr.width / 2, top: hr.top + hr.height / 2 - tr.height / 2, width: tr.width, height: tr.height }, null);
        }
      } catch (e) { console.error('fx play', e); }
    });
  }
  function onFx(m){
    switch (m.k) {
      case 'fly': case 'fade': pendingFly.push({ k: m.k, from: snapAt(m.from), to: m.to, face: m.face }); clearTimeout(flyTimer); flyTimer = setTimeout(runPendingFly, 450); break;
      case 'entry': pendingFly.push({ k: 'entry', to: m.to }); clearTimeout(flyTimer); flyTimer = setTimeout(runPendingFly, 450); break;
      case 'cutin': playCutInEffect(m.cardId, null, m.amount || undefined); break;
      case 'clash': playClashEffect(m.l, m.r, m.removed, null, m.lb, m.rb); break;
      case 'flashCase': { const el = document.querySelector(`.zone[data-side="${m.side}"] .case-slot`); if (el) { el.classList.add('landing-flash'); setTimeout(() => el.classList.remove('landing-flash'), 1000); } break; }
      case 'log': addLogLine(m.text, !!m.turn, !!m.mine); break;
    }
  }

  // ============ 圧縮して送る/受ける(盤面のHTMLは大きいので) ============
  async function deflate(str){
    const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('deflate'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function inflate(b64){
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  let sendChain = Promise.resolve();
  function sendCompressed(obj){
    // 圧縮は非同期なので、送る順番が入れ替わらないよう1本の列に並べる
    sendChain = sendChain.then(async () => {
      if (!conn || conn.state !== 'open') return;
      conn.send({ t: 'snap', z: await deflate(JSON.stringify(obj)) });
    }).catch(() => {});
  }

  // ============ ゲスト ============
  let recvChain = Promise.resolve();
  function enqueueSnap(m){
    recvChain = recvChain.then(async () => {
      let s = m;
      if (m.z) s = JSON.parse(await inflate(m.z));
      applySnap(s);
    }).catch(e => console.error('snapshot error', e));
  }

  function enqueueFx(m){ recvChain = recvChain.then(() => { onFx(m); }).catch(e => console.error('fx error', e)); }

  function applySnap(s){
    if (!installedGuest) installGuest();
    $('lobby').classList.add('hidden');
    rev = s.rev;
    Object.keys(s.roots).forEach(id => {
      const el = $(id); if (!el) return;
      const r = s.roots[id];
      el.className = r.c;
      el.setAttribute('style', r.s);
      el.innerHTML = tokensToUrls(r.h);
      el.querySelectorAll('img[data-cid]').forEach(img => { const u = tokenToUrl(img.getAttribute('data-cid')); if (u) img.src = u; });
    });
    const meta = s.meta || {};
    owner = meta.owner; forceBoth = !!meta.forceBoth;
    if (meta.hf) document.body.dataset.handFocus = meta.hf; else delete document.body.dataset.handFocus;
    updateBanner();
    window.fitRotatedTable();
    layoutLog();
    if (pendingFly.length) requestAnimationFrame(runPendingFly);
  }

  let installedGuest = false;
  function installGuest(){
    installedGuest = true;
    // ゲストのクリックはホストへ送る(ゲストの画面にはエンジンのボタン処理が無いので、ここで全部受ける)
    document.addEventListener('click', e => {
      const root = rootOf(e.target);
      if (!root) return;
      e.preventDefault(); e.stopPropagation();
      if (root.id === 'gameOverOverlay') { root.style.display = 'none'; return; }   // 結果画面を閉じるだけ(保存などはホスト側)
      if (!canAct(owner, 'opponent')) { flash('相手の操作待ちです'); return; }
      const path = [];
      for (let n = e.target; n && n !== root; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.children, n));
      conn.send({ t: 'click', rev, root: root.id, path });
    }, true);
    const onField = ev => e => {
      const root = rootOf(e.target); if (!root || !canAct(owner, 'opponent')) return;
      const path = [];
      for (let n = e.target; n && n !== root; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.children, n));
      const t = e.target;
      conn.send({ t: 'input', rev, root: root.id, path, ev, value: t.value, checked: t.type === 'checkbox' || t.type === 'radio' ? t.checked : null });
    };
    document.addEventListener('input', onField('input'), true);
    document.addEventListener('change', onField('change'), true);

    const hb = $('headerActions');
    if (hb) hb.innerHTML = '<button class="btn ghost" onclick="location.href=\'index.html\'">← メニューに戻る</button>';
  }

  function askNameOnGuest(m){
    // ゲストではwrapした関数も元のダイアログをそのまま出す(roleがhostのときだけ遠隔に回すため)。
    // sourceUidは渡さず、タイトルは文面(hint)に含めて送られてくる
    window.promptCardName(null, m.hint, v => conn.send({ t: 'name', id: m.id, v }), m.optional);
  }

  // ============ 起動 ============
  initLobby();
})();
