// CPU対戦(仮実装): 手動対戦の盤面で、右側(opponent)をCPUが操作する。
// 考え方はオンライン対戦のホストと同じで、エンジンの「いま誰の操作待ちか」を見て、CPUの番ならエンジンの関数を直接呼ぶ。
// 戦い方は単純: 勝てるなら事件解決 → 出せるカードを出す → 起きているキャラでアクション(相手のスリープキャラか証拠)か推理 → ターン終了。
// ガード・カットイン・ミスリード・変装は使わない。選択画面は「する」を優先して先頭を選ぶ。
(function(){
  if (!document.getElementById('startBtn') || document.body.classList.contains('online')) return;

  let cpuOn = false;
  let aiType = (window.CPU_AI_TYPES || {}).control || {};
  let busyUntil = 0;
  let stuckTicks = 0, stuckKey = '';
  const tried = new Set();            // このターンに試した操作(同じ操作を繰り返さない)
  let choiceOwnerCpu = null;

  // ---- 画面: 「相手をCPUにする」チェック ----
  const actions = document.querySelector('#setupPanel .setup-actions');
  if (actions) {
    const row = document.createElement('div');
    row.className = 'setup-row';
    const types = window.CPU_AI_TYPES || {};
    row.innerHTML = '<label for="cpuModeChk">CPU対戦(仮)</label><label style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><input type="checkbox" id="cpuModeChk"> 右のデッキをCPUが操作する　AIタイプ:' +
      ' <select id="cpuTypeSelect">' + Object.keys(types).map(k => '<option value="' + k + '">' + types[k].label + '</option>').join('') + '</select></label>';
    actions.parentNode.insertBefore(row, actions);
  }
  // CPU対戦のときは、右のデッキの選択肢を「AI用デッキ作成」で作ったデッキにする
  const oppSel = document.getElementById('oppDeckSelect');
  // CPUが使えるデッキ: 同梱のもの(data/cpu-decks.js) + 自分の「AI用デッキ作成」で作ったもの
  function cpuDeckList(){
    const out = [];
    (window.CPU_PRESET_DECKS || []).forEach(d => out.push({ label: d.name, deck: d }));
    (typeof loadAiDecks === 'function' ? loadAiDecks() : []).forEach(d => out.push({ label: d.name + '(自作)', deck: d }));
    return out;
  }
  let normalOppOptions = null;
  function syncOppDecks(){
    const chk = document.getElementById('cpuModeChk');
    if (!oppSel) return;
    if (chk && chk.checked) {
      if (normalOppOptions === null) normalOppOptions = oppSel.innerHTML;
      const list = cpuDeckList();
      oppSel.innerHTML = list.length ? list.map((x, i) => '<option value="' + i + '">' + x.label + '</option>').join('') : '<option value="">CPU用のデッキがありません</option>';
    } else if (normalOppOptions !== null) { oppSel.innerHTML = normalOppOptions; normalOppOptions = null; }
  }
  const chkEl = document.getElementById('cpuModeChk');
  if (chkEl) chkEl.addEventListener('change', syncOppDecks);
  // 開始ボタン: CPU対戦なら、AI用デッキを右側にして始める
  const engineStart = document.getElementById('startBtn').onclick;
  document.getElementById('startBtn').onclick = function(){
    const chk = document.getElementById('cpuModeChk');
    if (!(chk && chk.checked)) return engineStart && engineStart.apply(this, arguments);
    const mine = loadSavedDecks()[Number(document.getElementById('selfDeckSelect').value)];
    const pick = cpuDeckList()[Number(oppSel.value)];
    const ai = pick && pick.deck;
    if (!mine || !ai) { alert('左のデッキと、CPUのデッキの両方が必要です'); return; }
    startMatchWith(mine, ai, document.getElementById('firstPlayerSelect').value === 'opponent' ? 'opponent' : 'self');
  };
  document.getElementById('startBtn').addEventListener('click', () => {
    const chk = document.getElementById('cpuModeChk');
    cpuOn = !!(chk && chk.checked);
    const sel = document.getElementById('cpuTypeSelect');
    aiType = (window.CPU_AI_TYPES || {})[sel && sel.value] || (window.CPU_AI_TYPES || {}).control || {};
    document.body.classList.toggle('cpu-mode', cpuOn);
    tried.clear();
  });

  // 選択画面を開いた時点の「効果の主」を覚える(オンライン対戦と同じ)
  (function wrapOpenChoice(){
    const orig = window.openChoice;
    if (typeof orig !== 'function') return;
    window.openChoice = function(){
      choiceOwnerCpu = (typeof currentActorSide === 'function' && currentActorSide()) || null;
      return orig.apply(this, arguments);
    };
  })();

  const SIDE_STATE_GETTERS = [
    () => evidencePickState, () => handDiscardState, () => deckPeekState, () => partnerRemoveState, () => oppHandPickState,
    () => freePlayChoiceState, () => actionEndSwapState, () => kaitoActionEndState, () => switchState, () => mrReplaceState,
    () => sleepCostState, () => (typeof removeEventState !== 'undefined' ? removeEventState : null), () => lpBuffChoiceState,
    () => keywordGrantChoiceState, () => hiramekiState, () => hiramekiSleepState, () => bonusEvidenceState,
    () => sleepForOppDiscardState, () => apBuffState,
  ];

  // いま操作するのはどちらか(js/online-layer.js の computeOwner と同じ見方)
  function ownerNow(){
    if (match.gameOver) return null;
    if (mulliganPhase) return mulliganPhase;
    if (disguiseReactState) return disguiseReactState.oppSide;
    if (misleadState) return misleadState.oppSide;
    for (const get of SIDE_STATE_GETTERS) { let st = null; try { st = get(); } catch (e) {} if (st && st.side) return st.actor || st.side; }
    if (choiceState) return choiceOwnerCpu || currentActorSide() || (match.turn && match.turn.activeSide) || 'self';
    if (contactState && contactState.queue && contactState.queue.length) return contactState.queue[0];
    if (actionState) return actionState.step === 'guard' ? actionState.oppSide : actionState.side;
    return (match.turn && match.turn.activeSide) || match.firstPlayer || 'self';
  }

  const visible = el => !!el && getComputedStyle(el).display !== 'none';
  const animating = () => !!document.querySelector('.card-fly-ghost, .contact-clash, .action-arrow-anim');

  // ---- CPUの番に出る選択画面を自動で進める ----
  function resolvePending(){
    if (mulliganPhase === 'opponent') { performMulligan('opponent', mulliganReturnUids()); return true; }
    if (disguiseReactState) { skipDisguiseReact(); return true; }
    if (misleadState) { skipMislead(); return true; }
    if (evidencePickState) {
      const st = evidencePickState;
      const pool = match[st.side].evidence.filter(e => st.mode === 'toFaceUp' ? !e.faceUp : st.mode === 'toFaceDown' ? e.faceUp : true);
      const n = Math.max(st.min || 0, Math.min(st.max, pool.length));
      pool.slice(0, n).forEach(e => toggleEvidencePick(e.uid));
      confirmEvidencePick();
      return true;
    }
    if (handDiscardState) {
      const h = [...match[handDiscardState.side].hand].sort((a, b) => lvOf(a.cardId) - lvOf(b.cardId))[0];
      if (h) selectHandDiscardTarget(h.uid); else handDiscardState = null;
      return true;
    }
    if (choiceState) {
      const cs = choiceState, items = cs.items.filter(it => !it.disabled);
      let keys;
      const rule = cs.sourceCardId != null ? ruleOf(cs.sourceCardId) : null;
      if (rule && rule.choose) keys = rule.choose({ sourceCardId: cs.sourceCardId, hint: cs.hint, min: cs.min, max: cs.max }, items);
      if (keys && keys.length) { /* カード別の指定を使う */ }
      else if (items.some(it => it.key === 'yes')) keys = ['yes'];
      else keys = items.slice(0, Math.min(cs.max || 1, Math.max(cs.min || 0, 1))).map(it => it.key);
      finishChoice(keys);
      return true;
    }
    if (actionState && actionState.step === 'guard' && actionState.oppSide === 'opponent') {
      renderActionGuardOverlay();
      const skip = document.getElementById('deckPeekSkipBtn');
      if (skip && visible(skip) && skip.style.display !== 'none') { finalizeAction(null); return true; }
      // 強制ガード: 守れるキャラを1枚選んでガードする
      const card = document.querySelector('#deckPeekCards .mulligan-card:not(.dim)');
      if (card) { card.click(); const yes = document.getElementById('deckPeekYesBtn'); if (yes) yes.click(); return true; }
      finalizeAction(null); return true;
    }
    if (contactState && contactState.queue && contactState.queue[0] === 'opponent') { contactPass(); return true; }
    if (deckPeekState) {
      const st = deckPeekState;
      if (st.step === 'reorder') { finalizeDeckPeek((st.remainingUids || []).slice()); return true; }
      if (st.step === 'remove') return clickLowestHand(st.side);
      const skip = document.getElementById('deckPeekSkipBtn');
      if (skip && skip.style.display !== 'none' && visible(skip)) { skip.click(); return true; }
      const card = document.querySelector('#deckPeekCards .mulligan-card:not(.dim)');
      if (card) { card.click(); const yes = document.getElementById('deckPeekYesBtn'); if (yes && visible(yes)) yes.click(); return true; }
    }
    if (partnerRemoveState && partnerRemoveState.step === 'hand') return clickLowestHand(partnerRemoveState.side);
    if (bonusEvidenceState) return clickLowestHand(bonusEvidenceState.side);
    if (oppHandPickState) return clickLowestHand(oppHandPickState.oppSide || oppHandPickState.side);
    // 上のどれでもない選択画面: 「しない」系のボタンを押す
    for (const b of document.querySelectorAll('.mulligan-overlay button, #choiceOverlay button, #deckPeekOverlay button')) {
      if (visible(b) && b.offsetParent && /しない|スキップ|キャンセル|閉じる|発動しない/.test(b.textContent)) { b.click(); return true; }
    }
    return false;
  }

  // 手札を1枚選ぶ画面: いちばんレベルの低いカードを押す
  function clickLowestHand(side){
    const cards = [...document.querySelectorAll('.zone[data-side="' + side + '"] .hand-row .hcard[data-uid]')];
    cards.sort((x, y) => lvOf(uidToCardId(x.dataset.uid)) - lvOf(uidToCardId(y.dataset.uid)));
    if (!cards.length) return false;
    cards[0].click();
    return true;
  }
  // ---- マリガン: 優先度①〜⑤のルール(js/cpu-cards.js の CPU_AI_TYPES) ----
  function mulliganTier(cardId){
    const d = CARD_BY_ID.get(cardId); if (!d) return 9;
    const mg = aiType.mulligan || {};
    const lvTiers = mg.levelTiers || [];
    if (lvTiers.length && !(mg.priorities || []).length) {
      if (d.card_type !== 'キャラ' || d.level == null) return 9;
      const i = lvTiers.findIndex(lvs => lvs.includes(d.level)); return i === -1 ? 9 : i + 1;
    }
    const pri = mg.priorities || [];
    // 優先度の指定が無いときは、レベルの低いキャラほど先に欲しいカードとみなす
    if (d.card_type === 'キャラ' && d.level != null) return d.level <= 2 ? 1 : d.level === 3 ? 2 : d.level === 4 ? 3 : d.level === 5 ? 4 : 9;
    return d.level != null && d.level <= 2 ? 3 : 9;
  }
  function mulliganReturnUids(){
    const hand = match.opponent.hand.map(c => ({ c, t: mulliganTier(c.cardId) }));
    const keepBy = list => { const seen = new Set(), keep = new Set(); list.forEach(x => { if (!seen.has(x.t)) { seen.add(x.t); keep.add(x.c.uid); } }); return keep; };
    const sorted = [...hand].sort((a, b) => a.t - b.t);
    const has = t => hand.some(x => x.t === t);
    const low = sorted.filter(x => x.t <= 5);
    let keep;
    if (has(1)) keep = keepBy(low);                                                    // ルール1: ①〜⑤を各1枚
    else if (has(2) && hand.some(x => x.t >= 3 && x.t <= 5)) { const tiers = [...new Set(low.map(x => x.t))].slice(0, 2); keep = keepBy(low.filter(x => tiers.includes(x.t))); } // ルール2: 優先度の高い2種類
    else if (!hand.some(x => x.t <= 3)) keep = new Set();                              // ルール3: ④以下だけなら全部引き直す
    else keep = new Set(low.length ? [low[0].c.uid] : []);                              // ルール4: 最も優先度の高い1枚
    return hand.filter(x => !keep.has(x.c.uid)).map(x => x.c.uid);
  }
  const ruleOf = cardId => { const d = CARD_BY_ID.get(cardId); return (d && (window.CPU_CARD_RULES || {})[String(d.card_id)]) || null; };
  const lvOf = cardId => { const d = CARD_BY_ID.get(cardId); return d && d.level != null ? d.level : 0; };

  // ---- メインフェイズの手 ----
  function myTurnMain(){
    const t = match.turn, me = 'opponent', foe = 'self';
    const mine = match[me], theirs = match[foe];
    const key = (kind, uid) => t.turnNumber + ':' + kind + ':' + uid;
    const once = k => { if (tried.has(k)) return false; tried.add(k); return true; };

    // 1) 勝てるなら事件解決
    if (canSolveCase(me).ok && once(key('solve', 'case'))) { performSolveCase(me); return true; }

    // 2) 出せるカード(レベルの高い順に)
    const score = c => { const r = ruleOf(c.cardId); const ctx = { card: c, hand: mine.hand, field: mine.field, foeField: theirs.field, turn: t }; return r && r.playScore ? r.playScore(ctx) : lvOf(c.cardId); };
    const playable = mine.hand.filter(c => canPlayHandCard(me, c.uid).ok && !tried.has(key('play', c.uid)) && score(c) >= 0)
      .sort((a, b) => score(b) - score(a));
    if (playable.length) {
      const c = playable[0]; tried.add(key('play', c.uid));
      const before = mine.hand.length;
      playCard(me, c.uid);
      return true;
    }

    // 3) 起きているキャラで、アクションか推理
    for (const c of mine.field) {
      if (tried.has(key('field', c.uid))) continue;
      tried.add(key('field', c.uid));
      const rule = ruleOf(c.cardId) || {};
      const target = rule.noAction || (aiType.reasonFirst && canUseReason(me, 'field', c.uid).ok) ? null : pickActionTarget(c);
      if (target && canUseAction(me, c.uid).ok) {
        startAction(me, c.uid);
        if (actionState && actionState.step === 'target') { selectActionTarget(target.uid); if (actionState && actionState.step === 'target') { actionState = null; renderBoard(match); } }
        return true;
      }
      if (!rule.noReason && canUseReason(me, 'field', c.uid).ok) { performReason(me, 'field', c.uid); return true; }
    }

    // 4) パートナー: アシスト(解決編に近づける)か推理
    if (!tried.has(key('partner', 'p'))) {
      tried.add(key('partner', 'p'));
      if (canUseAssist(me).ok) { performAssist(me); return true; }
      if (canUseReason(me, 'partner', mine.partner && mine.partner.uid).ok) { performReason(me, 'partner', mine.partner.uid); return true; }
    }

    // 5) ターン終了
    endTurn();
    return true;
  }

  // 相手のスリープ状態のキャラのうち、こちらのAPが上回るものを優先。無ければ証拠のある事件
  function pickActionTarget(actor){
    const foe = match.self;
    const ap = effectiveAp(match, actor, 'opponent');
    const ok = c => c.sleeping && !hasActionLockRestriction(defOfInst(c)) && !isProtectedByLowLevelGuard('self', defOfInst(c)) && limitedChargeAllows(actor, defOfInst(c));
    const cands = foe.field.filter(ok).map(c => ({ uid: c.uid, ap: effectiveAp(match, c, 'self') })).sort((a, b) => a.ap - b.ap);
    const winnable = cands.filter(x => x.ap < ap);
    if (winnable.length) return winnable[winnable.length - 1];
    if (foe.case && foe.evidence.length > 0) return { uid: foe.case.uid };
    return aiType.attackUnwinnable ? (cands[0] || null) : null;   // 勝てないアクションは、アグロ以外はしない
  }

  function tick(){
    if (!cpuOn || typeof match === 'undefined' || !match || match.gameOver || replayMode) return;
    if (Date.now() < busyUntil || animating()) return;
    let who;
    try { who = ownerNow(); } catch (e) { return; }
    if (who !== 'opponent') { stuckTicks = 0; return; }
    try {
      const pendingAny = mulliganPhase || disguiseReactState || misleadState || choiceState || actionState || contactState || SIDE_STATE_GETTERS.some(g => { try { return !!g(); } catch (e) { return false; } });
      if (pendingAny) {
        const k = JSON.stringify([!!mulliganPhase, !!choiceState, !!actionState, !!contactState]) + (choiceState ? choiceState.title : '');
        stuckTicks = k === stuckKey ? stuckTicks + 1 : 0; stuckKey = k;
        if (actionState && actionState.step === 'target' && actionState.side === 'opponent') {
          // startAction の続き(通常は同じ呼び出しで選び終えるので、ここに来たら詰まっている)
          if (stuckTicks > 3) { actionState = null; renderBoard(match); }
          busyUntil = Date.now() + 500; return;
        }
        resolvePending();
        busyUntil = Date.now() + 600;
        return;
      }
      stuckTicks = 0;
      if (!match.turn || match.turn.activeSide !== 'opponent' || match.turn.phase !== 'main') return;
      myTurnMain();
      busyUntil = Date.now() + 900;
    } catch (e) { console.error('cpu', e); busyUntil = Date.now() + 1500; }
  }
  setInterval(tick, 500);
  window.cpuPlayer = { tick, mulliganReturnUids, get on(){ return cpuOn; } };
})();
