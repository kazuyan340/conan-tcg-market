// CPU対戦(仮実装): 手動対戦の盤面で、右側(opponent)をCPUが操作する。
// 考え方はオンライン対戦のホストと同じで、エンジンの「いま誰の操作待ちか」を見て、CPUの番ならエンジンの関数を直接呼ぶ。
// 戦い方は単純: 勝てるなら事件解決 → 出せるカードを出す → 起きているキャラでアクション(相手のスリープキャラか証拠)か推理 → ターン終了。
// ガード・カットイン・ミスリード・変装は使わない。選択画面は「する」を優先して先頭を選ぶ。
(function(){
  const isOnlinePage = document.body.classList.contains('online');   // スマホ(オンライン画面)では、ロビーの「CPUと対戦」から始める
  if (!isOnlinePage && !document.getElementById('startBtn')) return;

  let cpuOn = false;
  let aiType = (window.CPU_AI_TYPES || {}).control || {};
  let strategy = {};
  let openPattern = 0;                // 先攻の2ターン目に選んだパターン(1か2)
  let deckCardIds = [];               // CPUのデッキ40枚のカードID(確率の計算に使う)
                  // デッキごとの戦い方の指定(js/cpu-decks.js の strategy)
  let busyUntil = 0, lastPendingAt = 0;
  let stuckTicks = 0, stuckKey = '';
  const tried = new Set();            // このターンに試した操作(同じ操作を繰り返さない)
  let choiceOwnerCpu = null;

  // ---- 画面: 「相手をCPUにする」チェック ----
  const actions = isOnlinePage ? null : document.querySelector('#setupPanel .setup-actions');
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
    showDeckDate();
  }
  // CPUデッキの登録日を、選択の下に薄灰色で出す
  function showDeckDate(){
    const chk = document.getElementById('cpuModeChk');
    let el = document.getElementById('cpuDeckDate');
    if (!el) { el = document.createElement('div'); el.id = 'cpuDeckDate'; el.style.cssText = 'font-size:11px; color:#aaa; margin-top:3px;'; if (oppSel && oppSel.parentNode) oppSel.parentNode.appendChild(el); }
    const pick = chk && chk.checked ? cpuDeckList()[Number(oppSel.value)] : null;
    el.textContent = pick && pick.deck.registered ? '登録日: ' + pick.deck.registered : '';
  }
  if (oppSel) oppSel.addEventListener('change', showDeckDate);
  const chkEl = document.getElementById('cpuModeChk');
  if (chkEl) chkEl.addEventListener('change', syncOppDecks);
  // 開始ボタン: CPU対戦なら、AI用デッキを右側にして始める
  const startBtn = document.getElementById('startBtn');
  const engineStart = startBtn && startBtn.onclick;
  if (startBtn) startBtn.onclick = function(){
    const chk = document.getElementById('cpuModeChk');
    if (!(chk && chk.checked)) return engineStart && engineStart.apply(this, arguments);
    const mine = loadSavedDecks()[Number(document.getElementById('selfDeckSelect').value)];
    const pick = cpuDeckList()[Number(oppSel.value)];
    const ai = pick && pick.deck;
    if (!mine || !ai) { alert('左のデッキと、CPUのデッキの両方が必要です'); return; }
    startMatchWith(mine, ai, document.getElementById('firstPlayerSelect').value === 'opponent' ? 'opponent' : 'self');
  };
  if (startBtn) startBtn.addEventListener('click', () => {
    const chk = document.getElementById('cpuModeChk');
    cpuOn = !!(chk && chk.checked);
    const sel = document.getElementById('cpuTypeSelect');
    // デッキに aiType が決めてあれば(js/cpu-decks.js)それを使い、無ければ画面で選んだタイプ
    const pickedDeck = (typeof cpuDeckList === 'function' ? cpuDeckList() : [])[Number((document.getElementById('oppDeckSelect') || {}).value)];
    const types = window.CPU_AI_TYPES || {};
    aiType = (pickedDeck && pickedDeck.deck.aiType && types[pickedDeck.deck.aiType]) || types[sel && sel.value] || types.control || {};
    strategy = (pickedDeck && pickedDeck.deck.strategy) || {};
    deckCardIds = flattenDeck(pickedDeck && pickedDeck.deck);
    if (pickedDeck && pickedDeck.deck.mulligan) aiType = Object.assign({}, aiType, { mulligan: pickedDeck.deck.mulligan });   // デッキごとのマリガン指定を優先
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
    if (switchState && switchState.side === 'opponent') {   // 現場が埋まっているときのスイッチ: いちばんレベルの低いキャラをリムーブして入れ替える
      const c = [...match.opponent.field].sort((a, b) => lvOf(a.cardId) - lvOf(b.cardId))[0];
      if (c) { selectSwitchTarget(c.uid); return true; }
      switchState = null; return true;
    }
    if (mrReplaceState && mrReplaceState.side === 'opponent') { selectMrReplaceTarget(mrReplaceState.otherUid); return true; }   // MRが重なったときは、前からいた方をリムーブして新しい方を残す
    if (hiramekiState && hiramekiState.side === 'opponent') { activateHirameki(); return true; }   // ヒラメキは「発動する」
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
    if (contactState && contactState.queue && contactState.queue[0] === 'opponent') { cpuContactDecide(); return true; }
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

  // ---- コンタクト中(CPUの番): 攻撃側のとき、勝てなければ手札のカットイン・変装で勝てるか考える ----
  //   カードごとの判断は js/cpu-cards.js の contactCutIn(ctx) / contactDisguise(ctx)(true なら使う)。AP＋N だけのカットインは、勝てるようになるなら使う。
  function contactCtx(){
    const cs = contactState;
    if (!cs || cs.attackerSide !== 'opponent') return null;
    const actor = match.opponent.field.find(c => c.uid === cs.attackerUid);
    const tgt = match[cs.defenderSide].field.find(c => c.uid === cs.defenderUid);
    if (!actor || !tgt) return null;
    const bonus = sk => (cs.apBuffs || []).filter(b => b.side === sk).reduce((s, b) => s + b.amount, 0);
    return { me: match.opponent, foe: match.self, actor, tgt, targetType: cs.targetType,
      myAp: effectiveAp(match, actor, 'opponent') + bonus('opponent'), foeAp: effectiveAp(match, tgt, cs.defenderSide) + bonus(cs.defenderSide), used: !!(cs.usedCutIn && cs.usedCutIn.opponent) };
  }
  function cpuContactDecide(){
    const ctx = contactCtx();
    if (ctx && !ctx.used && ctx.targetType === 'char' && ctx.myAp < ctx.foeAp) {
      for (const c of match.opponent.hand) {
        const rule = ruleOf(c.cardId) || {};
        if (rule.contactCutIn && rule.contactCutIn(ctx) && contactState.cutinBlockedSide !== 'opponent' && hasCutInAbility(c.cardId, 'opponent')) { contactUseCutIn('opponent', c.uid); return; }
        if (rule.contactDisguise && rule.contactDisguise(ctx) && canUseDisguise('opponent', c.uid)) { contactUseDisguise('opponent', c.uid); return; }
        if (!rule.contactCutIn && contactState.cutinBlockedSide !== 'opponent') {   // AP＋N だけのカットイン
          const amt = getCutInEffects(c.cardId, 'opponent').reduce((m, a) => Math.max(m, a), 0);
          if (amt > 0 && ctx.myAp + amt >= ctx.foeAp) { contactUseCutIn('opponent', c.uid); return; }
        }
      }
    }
    contactPass();
  }
  // 変装の条件(FILE枚数・パートナーの色・事件の色)を、いま満たしているか(コンタクト中でなくても調べられる)
  function disguiseOkNow(cardId){
    const cond = getDisguiseCondition(cardId); if (!cond) return false;
    if (cond.fileMin != null && getEffectiveFileCount('opponent') < cond.fileMin) return false;
    if (cond.partnerColor && !partnerHasColor('opponent', cond.partnerColor)) return false;
    if (cond.caseColors && !(match.opponent.case && cond.caseColors.some(col => cardHasColor(CARD_BY_ID.get(match.opponent.case.cardId), col)))) return false;
    return true;
  }
  // アクション前の見積もり: 手札のカットイン・変装で、このターゲットを倒せるか
  function winnableByHand(actor, tgt){
    const cs = { me: match.opponent, foe: match.self, actor, tgt, targetType: 'char', myAp: effectiveAp(match, actor, 'opponent'), foeAp: effectiveAp(match, tgt, 'self'), used: false };
    return match.opponent.hand.some(c => { const r = ruleOf(c.cardId) || {}; return (r.contactCutIn && r.contactCutIn(cs)) || (r.contactDisguise && r.contactDisguise(cs) && disguiseOkNow(c.cardId)); });
  }

  // 手札を1枚選ぶ画面: いちばんレベルの低いカードを押す
  function clickLowestHand(side){
    const cards = [...document.querySelectorAll('.zone[data-side="' + side + '"] .hand-row .hcard[data-uid]')];
    cards.sort((x, y) => lvOf(uidToCardId(x.dataset.uid)) - lvOf(uidToCardId(y.dataset.uid)));
    if (!cards.length) return false;
    cards[0].click();
    return true;
  }
  const flattenDeck = d => { const out = []; ((d && d.cards) || []).forEach(c => { for (let i = 0; i < c.qty; i++) out.push(c.id); }); return out; };
  // 公開されている情報(手札・現場とその下のカード・リムーブエリア・表向きの証拠)を引いた、残りの未確認のカード(デッキ・FILE・裏向きの証拠のどこか)のうち、
  // 事件にアクションできる突撃を持つカード(rule.lethalCharge = 歩美・青子)の割合 = ネクストヒントで突撃が来る確率の見積もり
  function chargeProbability(){
    if (!deckCardIds.length) return { p: 0, n: 0, c: 0 };
    const me = match.opponent, left = deckCardIds.slice();
    const take = id => { const i = left.indexOf(id); if (i !== -1) left.splice(i, 1); };
    me.hand.forEach(c => take(c.cardId));
    me.field.forEach(c => { take(c.cardId); (c.under || []).forEach(u => take(u.cardId)); });
    me.remove.forEach(c => take(c.cardId));
    me.evidence.filter(e => e.faceUp).forEach(e => take(e.cardId));
    const c = left.filter(id => (ruleOf(id) || {}).lethalCharge).length;
    return { p: left.length ? c / left.length : 0, n: left.length, c };
  }

  // 公開情報から数えた「残りの未確認のカード」(デッキ・FILE・裏向きの証拠のどこか)
  function unknownPool(){
    const me = match.opponent, left = deckCardIds.slice();
    const take = id => { const i = left.indexOf(id); if (i !== -1) left.splice(i, 1); };
    me.hand.forEach(c => take(c.cardId));
    me.field.forEach(c => { take(c.cardId); (c.under || []).forEach(u => take(u.cardId)); });
    me.remove.forEach(c => take(c.cardId));
    me.evidence.filter(e => e.faceUp).forEach(e => take(e.cardId));
    return left;
  }
  // 未確認のカードからk枚(ネクストヒントでFILEの上から手札に来る枚数)引いたとき、条件(pred)に合うカードが1枚以上ある確率
  function drawChance(pred, k){
    const left = unknownPool(), n = left.length, c = left.filter(pred).length;
    if (!n || !c || k <= 0) return 0;
    let none = 1; for (let i = 0; i < Math.min(k, n); i++) none *= Math.max(0, (n - c - i)) / (n - i);
    return 1 - none;
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
    if (pri.length) { const i = pri.findIndex(list => list.includes(String(d.card_id))); return i === -1 ? 9 : i + 1; }   // card_id で指定した優先度
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

    // 先攻のときの序盤の方針(strategy.opening): CPUの何ターン目か(先攻のときだけ。後攻や、方針なしのデッキは 0)
    const open = strategy.opening && match.firstPlayer === 'opponent' ? (t.turnNumber + 1) / 2 : 0;
    // 2ターン目のパターン: 手札にレベル4の少年探偵団があれば②(アシストしてレベル4)、なければ①(レベル2を出して、パートナーで推理)。そのターンの最初に決める
    if (open === 2 && !tried.has(key('pattern', 'p'))) { tried.add(key('pattern', 'p')); openPattern = mine.hand.some(c => { const d = CARD_BY_ID.get(c.cardId); return d && d.card_type === 'キャラ' && d.level === 4 && cardHasTrait(d, '少年探偵団'); }) ? 2 : 1; }
    const score = c => { const r = ruleOf(c.cardId); const ctx = { card: c, hand: mine.hand, field: mine.field, foeField: theirs.field, turn: t, me: mine, foe: theirs, lethal: lethalFlag, open }; return r && r.playScore ? r.playScore(ctx) : lvOf(c.cardId); };
    let lethalFlag = false;   // 勝ち筋の判定の結果(下で決まる。出す優先度の計算に使う)
    // 1.2) 勝ち筋の判定(相手のキャラの処理より、勝つことを優先する)
    //   事件が解決編・パートナーが起きている状態で、「いまの証拠 + このターンに証拠を取れそうな数」が事件レベル以上なら、勝ちを狙う。
    //   取れそうな数 = アクションできるキャラ(名乗り状態でない起きているキャラ) + 手札の吉田歩美・中森青子(事件にもアクションできる突撃を持つので、ネクストヒントで出せる分。歩美はFILE5以上で出たとき) − 相手のアクティブなキャラの数(ガードで1回ずつ止められる)
    //   ブロックされるなどして足りなくなれば、この判定が外れて、ふつうの動き(キャラの処理など)に戻る
    let lethalPlan = [];
    let drawForAnchor = false;   // 灰原哀の宣言で出す突撃を引きにいく(FILEを0まで切る)   // 勝ち筋のターンに、順番に出すカード(手札)
    const lethal = (() => {
      if (!mine.case || !mine.case.resolved || !mine.partner || mine.partner.sleeping) return false;
      const lv = getCaseLevel(me); if (lv == null) return false;
      if (!(theirs.case && theirs.evidence.length > 0)) return mine.evidence.length >= lv;
      const actors = mine.field.filter(c => !c.sleeping && !c.justEntered && !tried.has(key('field', c.uid))).length;
      const keepL = strategy.nextHintKeepLethal != null ? strategy.nextHintKeepLethal : 5;
      drawForAnchor = false;
      const hintsAvail = Math.max(0, mine.file.length - keepL);
      const slots = ((!match.turn.playedCardThisTurn || match.turn.nextHintPending) ? 1 : 0) + hintsAvail;   // このターンに手札から出せる回数(ネクストヒントのたびにFILEが1枚減る)
      const fileNow = getEffectiveFileCount(me);
      const guards = theirs.field.filter(c => !c.sleeping).length;   // 相手のアクティブなキャラは、ガードでアクションを1回ずつ止められる
      // 手札に突撃が足りなくても、ネクストヒントで突撃が来る確率が基準以上なら、来る前提で走る(strategy.lethalGambleP)
      const gp = strategy.lethalGambleP != null ? chargeProbability() : null;
      const gambleAvail = gp && gp.p >= strategy.lethalGambleP ? gp.c : 0;
      // FILEが0でも宣言できる登場役(灰原哀Lv6)が起きて現場にいれば、手札に出せる突撃がなくても、FILEを0まで切る間に突撃(コナンLv5など)を引ければ、それを出してアクションできる
      const anchor = mine.field.find(c => !c.sleeping && (ruleOf(c.cardId) || {}).summonsAnyFile);
      const anchorRule = anchor && ruleOf(anchor.cardId);
      // 手札に突撃の登場候補があるか(歩美はFILE5以上のときだけ)と、FILEを0まで切って引く対象(FILE0では歩美は突撃を持たないので、コナンLv5など最低FILEの要らないカードだけ)
      const anchorTarget = (id, file) => { const d = CARD_BY_ID.get(id), r = ruleOf(id); return !!d && !!r && !!r.lethalCharge && d.card_type === 'キャラ' && anchorRule.summonTarget(d) && (!r.chargeMinFile || file >= r.chargeMinFile); };
      const anchorHasTarget = !!anchor && mine.hand.some(h => anchorTarget(h.cardId, getEffectiveFileCount(me)));
      const anchorChance = anchor && !anchorHasTarget && strategy.lethalGambleP != null ? drawChance(id => anchorTarget(id, 0), mine.file.length) : 0;
      const anchorGamble = anchorChance >= (strategy.lethalGambleP != null ? strategy.lethalGambleP : 2);
      const isLv4Shonen = c => { const d = defOfInst(c); return !!d && d.level === 4 && cardHasTrait(d, '少年探偵団'); };
      // 出す順番を組み合わせで探す。各枠のFILE枚数以下のレベルのカードしか出せない(高いレベルは早い枠でしか出せない)。
      // 事件にアクションできる突撃(歩美・青子)を並べるほど、アクションできる数が増える。除去役・黒羽快斗(リムーブエリアから青子を出す)も候補
      const cands = mine.hand.filter(c => { const r = ruleOf(c.cardId); return r && (r.lethalCharge || r.removesFoe || r.summonsCharger || r.stackCharge); });
      const evalPlan = plan => {
        let atk = actors, entered = 0, willLv4 = false, bonus = 0;   // bonus: 5枚重ねの結成 少年探偵団が、アクションしたときに得る証拠(ガードされても得られる)
        mine.field.forEach(c => {   // すでに現場にいる、下にカードが重なった結成(登場したターンでも、重なっていれば突撃でアクションできる)
          const r = ruleOf(c.cardId); if (!r || !r.stackCharge || c.sleeping || tried.has(key('field', c.uid))) return;
          const n = (c.under || []).length;
          if (c.justEntered && n >= 1) atk++;
          if (n >= 5) bonus++;
        });
        const used = new Set();   // 効果で手札から登場させるカード(同じカードを2回は使えない)
        if (anchor) {   // すでに現場にいる登場役の宣言(手札に突撃があれば、それを出す。なければ、引ける確率が基準以上なら引く前提)
          const got = anchorRule.summonsCharger({ me: mine, chars: mine.field, file: fileNow, others: mine.hand.filter(h => !plan.includes(h)) });
          if (got) { atk++; entered++; if (got.uid) used.add(got.uid); }
          else if (anchorGamble) { atk++; entered++; }
        }
        const chars = [...mine.field];
        for (let k = 0; k < plan.length; k++) {
          const c = plan[k], r = ruleOf(c.cardId) || {}, fileK = fileNow - k;
          entered++;
          if (r.lethalCharge && (!r.chargeMinFile || fileK >= r.chargeMinFile)) atk++;
          if (r.stackCharge) { const n = r.stackCharge(mine); if (n >= 1) atk++; if (n >= 5) bonus++; }   // 歩美はFILE5以上で出たときだけ突撃を持つ
          if (isLv4Shonen(c) || r.entersLv4) willLv4 = true;
          if (r.summonsCharger) {   // 効果で手札(または黒羽快斗のようにリムーブエリア)から突撃のキャラを登場させる
            const got = r.summonsCharger({ me: mine, chars, file: fileK, others: mine.hand.filter(h => !plan.includes(h) && !used.has(h.uid)) });
            if (got) { atk++; entered++; if (got.uid) used.add(got.uid); }
          }
          chars.push(c);
        }
        if (mine.field.length + entered > maxFieldFor(me)) return null;
        let removals = 0;
        const lv4Later = from => plan.slice(from).some(c => isLv4Shonen(c) || (ruleOf(c.cardId) || {}).entersLv4);   // 灰原哀の除去は、レベル4の少年探偵団が「そのあとに」登場したとき
        mine.field.forEach(c => { const r = ruleOf(c.cardId); if (r && r.removesFoe) removals += r.removesFoe({ me: mine, foe: theirs, willEnterLv4: lv4Later(0) }, false); });
        plan.forEach((c, k) => { const r = ruleOf(c.cardId); if (r && r.removesFoe) removals += r.removesFoe({ me: mine, foe: theirs, willEnterLv4: lv4Later(k + 1) }, true); });
        const gambleAtk = Math.min(Math.max(0, slots - plan.length), gambleAvail, fileNow - plan.length >= 5 ? 99 : 0);
        const hits = Math.min(theirs.evidence.length, Math.max(0, atk + gambleAtk - Math.max(0, guards - removals)));
        return mine.evidence.length + bonus + hits - lv;
      };
      let best = null;
      const dfs = (plan, left) => {
        const m = evalPlan(plan);
        if (m != null && (!best || m > best.m || (m === best.m && plan.length < best.plan.length))) best = { m, plan: plan.slice() };
        if (plan.length >= slots) return;
        left.forEach((c, i) => {
          if (lvOf(c.cardId) > fileNow - plan.length) return;
          dfs(plan.concat(c), left.filter((_, j) => j !== i));
        });
      };
      dfs([], cands);
      if (!best || best.m < 0) return false;
      lethalPlan = best.plan;
      drawForAnchor = !!anchor && !anchorHasTarget && anchorGamble;   // 勝ち筋が「引けたら」を前提にしているときは、引くためにFILEを0まで切る
      return true;
    })();

    lethalFlag = lethal;
    window.cpuPlayer && (window.cpuPlayer.lastLethal = lethal, window.cpuPlayer.lastPlan = lethalPlan.map(c => c.uid), window.cpuPlayer.drawing = lethal && drawForAnchor);
    // 1.5) 宣言能力(カード別ルールの declares)。例: デッキを5枚リムーブして肥やす
    for (const c of mine.field) {
      const rule = ruleOf(c.cardId); if (!rule || !rule.declares) continue;
      for (const dc of rule.declares) {
        if (tried.has(key('decl:' + dc.line, c.uid))) continue;
        if (dc.when && !dc.when({ me: mine, foe: theirs, turn: t, card: c })) continue;
        const e = getAllDeclaresFor(me, c.uid).find(x => ((x.def && x.def.lineText) || '').includes(dc.line) || (x.matched || '').includes(dc.line));   // 汎用の宣言も、カード個別の宣言も探す
        if (!e || e.def.check(me, c.uid, e.params)) continue;
        tried.add(key('decl:' + dc.line, c.uid));
        if (e.def.sleepCost) recordEvent({ type: 'declareSleepCost', side: me, uid: c.uid });
        e.def.run(me, c.uid, e.params);
        return true;
      }
    }

    // 2) 出せるカード(レベルの高い順に)
    // 2.0) アシストを先にする: アシスト(パートナーがFILEエリアに入って、FILE枚数が1枚増える)で、いま出せないカードが出せるようになるとき
    if (!lethal && !tried.has(key('assistFirst', 'p')) && canUseAssist(me).ok && !match.turn.playedCardThisTurn) {
      const fileNow = getEffectiveFileCount(me);
      const unlocks = mine.hand.some(c => { const lv = lvOf(c.cardId); return lv === fileNow + 1 && score(c) >= (mine.field.length >= maxFieldFor(me) ? 60 : 0); });
      // 先攻の序盤: 1ターン目は、アシストしてからレベル2を出す。2ターン目は、②ならアシストしてレベル4、①ならアシストしない
      const openAssist = open === 1 || (open === 2 && openPattern === 2);
      if ((open === 2 && openPattern === 1) ? false : (unlocks || openAssist)) { tried.add(key('assistFirst', 'p')); tried.add(key('partner', 'p')); performAssist(me); return true; }
    }
    const full = mine.field.length >= maxFieldFor(me);   // 現場が埋まっていると、1枚リムーブして入れ替えることになる。よほど強いカードだけ出す
    const playable = mine.hand.filter(c => canPlayHandCard(me, c.uid).ok && !tried.has(key('play', c.uid)) && !(isMRCard(c.cardId) && (mine.field.some(f => isMRCard(f.cardId)) || (mine.partnerMR && isMRCard(mine.partnerMR.cardId)))) && score(c) >= (full ? 60 : 0))
      .sort((a, b) => score(b) - score(a));
    if (lethal && lethalPlan.length) { const first = lethalPlan[0]; const mine1 = playable.filter(c => c.uid === first.uid); if (mine1.length) playable.splice(0, playable.length, ...mine1); }   // 勝ち筋のターンは、組んだ順番で出す
    if (playable.length) {
      const c = playable[0]; tried.add(key('play', c.uid));
      const before = mine.hand.length;
      playCard(me, c.uid);
      return true;
    }

    // 2.3) ネクストヒント: 1枚使ったあと、FILEエリアが strategy.nextHintKeep 枚より多く、次に出したいカードがあれば使う
    //      (FILEの一番上が手札に入り、FILEが1枚減ったレベルまでのカードをもう1枚使える)
    const hintKeep = lethal && drawForAnchor ? 0 : lethal && strategy.nextHintKeepLethal != null ? strategy.nextHintKeepLethal : strategy.nextHintKeep;   // 勝ち筋のターンは、FILEをもっと切る(5枚まで)
    if (hintKeep != null && match.turn.playedCardThisTurn && !match.turn.nextHintPending && mine.file.length > hintKeep && canUseNextHint(me).ok) {
      const fileAfter = mine.file.length - 1 + (mine.partner && mine.partner.assisting ? 1 : 0);
      const want = lethal && drawForAnchor ? true : lethal && lethalPlan.length ? lethalPlan.some(c => lvOf(c.cardId) <= fileAfter) : mine.hand.some(c => !tried.has(key('play', c.uid)) && lvOf(c.cardId) <= fileAfter && score(c) >= (full ? 60 : 0));
      if (want && once(key('hint', mine.file.length))) { startNextHint(me); return true; }
    }

    // 3) 起きているキャラで、アクションか推理
    for (const c of mine.field) {
      if (tried.has(key('field', c.uid))) continue;
      tried.add(key('field', c.uid));
      const rule = ruleOf(c.cardId) || {};
      let target = rule.noAction || (aiType.reasonFirst && canUseReason(me, 'field', c.uid).ok) ? null : pickActionTarget(c, lethal);
      // 先攻3ターン目: 相手が全部アクティブ(アクションできる相手がいない)なら、事件へ突撃するのは歩美だけ。ほかのキャラはアクティブのまま、元からいたキャラだけが推理する
      if (open === 3 && !lethal && target && theirs.case && target.uid === theirs.case.uid && (CARD_BY_ID.get(c.cardId) || {}).card_id !== '1175') target = null;
      if (target && canUseAction(me, c.uid).ok) {
        startAction(me, c.uid);
        if (actionState && actionState.step === 'target') { selectActionTarget(target.uid); if (actionState && actionState.step === 'target') { actionState = null; renderBoard(match); } }
        return true;
      }
      if (!rule.noReason && canUseReason(me, 'field', c.uid).ok) { performReason(me, 'field', c.uid); return true; }
    }

    // 3.5) 事件の宣言能力(解決編のとき)。キャラのアクション・推理が終わったあとに使う。使うかどうかは事件カードのルール(useCaseDeclare)で決める
    if (mine.case && mine.case.resolved && !lethal) {   // 勝ち筋のターンは、事件効果より勝つことを優先する
      const cr = ruleOf(mine.case.cardId);
      const entered = mine.field.filter(c => c.justEntered).length;   // このターンに登場した枚数
      if (cr && cr.useCaseDeclare && canDeclareGenericCase(me).ok && cr.useCaseDeclare({ me: mine, foe: theirs, turn: t, entered }) && once(key('caseDecl', 'c'))) { declareGenericCase(me); return true; }
    }

    // 4) パートナー: アシスト(解決編に近づける)か推理
    if (!tried.has(key('partner', 'p'))) {
      tried.add(key('partner', 'p'));
      const reasonFirst = open === 2 && openPattern === 1 && canUseReason(me, 'partner', mine.partner && mine.partner.uid).ok;   // 先攻2ターン目の①は、パートナー推理
      if (!reasonFirst && !lethal && canUseAssist(me).ok) { performAssist(me); return true; }
      if (canUseReason(me, 'partner', mine.partner && mine.partner.uid).ok) { performReason(me, 'partner', mine.partner.uid); return true; }
    }

    // 5) ターン終了
    endTurn();
    return true;
  }

  // 相手のスリープ状態のキャラのうち、こちらのAPが上回るものを優先。無ければ証拠のある事件
  function pickActionTarget(actor, lethal){
    const foe = match.self;
    if (lethal && foe.case && foe.evidence.length > 0) return { uid: foe.case.uid };   // 勝ち筋のターンは、証拠を取る(事件へのアクション)
    const ap = effectiveAp(match, actor, 'opponent');
    const ok = c => c.sleeping && !hasActionLockRestriction(defOfInst(c)) && !isProtectedByLowLevelGuard('self', defOfInst(c)) && limitedChargeAllows(actor, defOfInst(c));
    const cands = foe.field.filter(ok).map(c => ({ uid: c.uid, ap: effectiveAp(match, c, 'self') })).sort((a, b) => a.ap - b.ap);
    const winnable = cands.filter(x => x.ap <= ap);   // APが同じなら、アクションした側が勝つ
    if (winnable.length) return winnable[winnable.length - 1];
    const byHand = cands.filter(x => winnableByHand(actor, foe.field.find(f => f.uid === x.uid)));   // 手札のカットイン・変装で倒せる相手
    if (byHand.length) return byHand[byHand.length - 1];
    if (foe.case && foe.evidence.length > 0) return { uid: foe.case.uid };
    return aiType.attackUnwinnable ? (cands[0] || null) : null;   // 勝てないアクションは、アグロ以外はしない
  }

  function tick(){
    if (!cpuOn || typeof match === 'undefined' || !match || match.gameOver || replayMode) return;
    if (match.events && match.events.some(e => e.type === 'solveCase' || e.type === 'solveCaseEvidenceMill')) return;   // 事件が解決されて勝負がついたら、もう動かない
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
        lastPendingAt = Date.now();
        busyUntil = Date.now() + 600;
        return;
      }
      stuckTicks = 0;
      if (!match.turn || match.turn.activeSide !== 'opponent' || match.turn.phase !== 'main') return;
      if (Date.now() - lastPendingAt < 1500) return;   // 効果の処理が続いている途中(選択画面と選択画面のすきま)では、次の手に進まない
      myTurnMain();
      busyUntil = Date.now() + 900;
    } catch (e) { console.error('cpu', e); busyUntil = Date.now() + 1500; }
  }
  setInterval(tick, 500);
  // スマホ(オンライン画面)用: ロビーから呼ぶ。デッキに決めてある aiType を優先する
  function startOnline(deck, typeKey){
    const types = window.CPU_AI_TYPES || {};
    aiType = (deck && deck.aiType && types[deck.aiType]) || types[typeKey] || types.control || {};
    strategy = (deck && deck.strategy) || {};
    deckCardIds = flattenDeck(deck);
    if (deck && deck.mulligan) aiType = Object.assign({}, aiType, { mulligan: deck.mulligan });
    cpuOn = true; tried.clear();
    document.body.classList.add('cpu-mode');
  }
  window.cpuPlayer = { startOnline, chargeProbability, tick, mulliganReturnUids, get on(){ return cpuOn; } };
})();
