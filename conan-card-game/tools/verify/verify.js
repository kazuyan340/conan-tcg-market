// 試合状態を作って、今回追加した効果を自動で動かし、実行時エラーが出ないかを調べる
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.setPath('userData', process.argv[3]);
const targetIds = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));

const PAGE_SCRIPT = `
(async () => {
  const errors = [];
  window.addEventListener('error', e => errors.push('window.error: ' + e.message));
  window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.message)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ids = ${JSON.stringify(targetIds)};
  const origTagsOk = tagsOk, origPHC = partnerHasColor, origCIR = caseIsResolved, origHB = hasBond, origGEFC = getEffectiveFileCount, origITD = isTraceDiscovered;
  const forceAll = () => { window.tagsOk = () => true; window.partnerHasColor = () => true; window.caseIsResolved = () => true; window.hasBond = () => true; window.getEffectiveFileCount = () => 10; window.isTraceDiscovered = () => true; };
  const restoreAll = () => { window.tagsOk = origTagsOk; window.partnerHasColor = origPHC; window.caseIsResolved = origCIR; window.hasBond = origHB; window.getEffectiveFileCount = origGEFC; window.isTraceDiscovered = origITD; };
  const charPool = CARD_DATA.filter(c => c.card_type === 'キャラ');
  const eventPool = CARD_DATA.filter(c => c.card_type === 'イベント');
  const pick = (arr, n, seed) => { const out = []; for (let i = 0; i < n; i++) out.push(arr[(seed * 31 + i * 17) % arr.length]); return out; };
  const results = [];
  function mkConfig(seed){
    const deckOrder = [];
    pick(charPool, 28, seed).forEach(c => deckOrder.push(c.id));
    pick(eventPool, 12, seed + 3).forEach(c => deckOrder.push(c.id));
    const partner = CARD_DATA.find(c => c.card_type === 'パートナー');
    const kase = CARD_DATA.find(c => c.card_type === '事件');
    return { deckName: 'T' + seed, partnerCardId: partner.id, caseCardId: kase.id, deckOrder };
  }
  function inst(side, cardId, n){ return { cardId, uid: side + '-x' + n, sleeping: false, justEntered: false, under: [] }; }
  function setupMatch(seed){
    const cs = mkConfig(seed), co = mkConfig(seed + 5);
    window.match = {
      config: { self: cs, opponent: co },
      self: buildSideState('self', cs), opponent: buildSideState('opponent', co),
      events: [], turn: null, firstPlayer: 'self', gameOver: false,
    };
    match = window.match;
    ['self', 'opponent'].forEach((sk, si) => {
      const s = match[sk];
      const chars = pick(charPool, 14, seed + si * 7);
      s.field = chars.slice(0, 3).map((c, i) => inst(sk, c.id, i));
      s.field[1].sleeping = true; s.field[2].stunned = true;
      s.field[0].under = [{ cardId: eventPool[0].id, uid: sk + '-u1' }, { cardId: eventPool[1].id, uid: sk + '-u2' }];
      s.remove = chars.slice(3, 12).map((c, i) => ({ cardId: c.id, uid: sk + '-r' + i }));
      s.evidence = [{ cardId: eventPool[2].id, uid: sk + '-e1', faceUp: false }, { cardId: eventPool[3].id, uid: sk + '-e2', faceUp: true }, { cardId: eventPool[4].id, uid: sk + '-e3', faceUp: false }];
      s.file = [{ cardId: chars[12].id, uid: sk + '-f1' }, { cardId: chars[13].id, uid: sk + '-f2' }, { cardId: chars[12].id, uid: sk + '-f3' }, { cardId: chars[13].id, uid: sk + '-f4' }, { cardId: chars[12].id, uid: sk + '-f5' }];
    });
    match.turn = {
      activeSide: 'self', phase: 'main', number: 3,
      declaredAbilityUids: [], tempKeywords: [], tempLevelDebuffs: [], tempEndOfTurnBounceGrants: [], tempEndOfTurnRemoveGrants: [],
      tempActionDrawGrants: [], tempContactWipeGrants: [], tempContactReentryGrants: [], tempNextEvidenceRemovalStun: [],
      hayateFirstEntryUsed: { self: false, opponent: false }, hayateIgnoreNextEntry: { self: false, opponent: false },
      hayateTriggeredSide: { self: false, opponent: false }, tempApBuffs: [], tempLpBuffs: [], tempBaseLpZeroGrants: [], hayateTriggeredUids: [], chosenByMrUids: [], tempEndOfTurnBounceUnlessMr: [], tempEndOfTurnEvidenceGrants: [], tempBaseLpZero: [], tempBaseApZero: [], tempBaseApZeroGrants: [],
    };
    document.getElementById('board').style.display = 'block';
    try { renderBoard(match); } catch (e) { errors.push('renderBoard: ' + e.message); }
  }

  const sleep2 = ms => new Promise(r => setTimeout(r, ms));
  function uiBusy(){
    return !!(choiceState || handDiscardState || evidencePickState || deckPeekState || partnerRemoveState || hiramekiSleepState || switchState || oppHandPickState || contactState || hiramekiState || freePlayChoiceState || actionEndSwapState || kaitoActionEndState || keywordGrantChoiceState || bonusEvidenceState || sleepForOppDiscardState || sleepCostState || lpBuffChoiceState || apBuffState || mrReplaceState);
  }
  function clearUi(){
    choiceState = null; handDiscardState = null; evidencePickState = null; deckPeekState = null; partnerRemoveState = null;
    hiramekiSleepState = null; switchState = null; oppHandPickState = null; hiramekiState = null; freePlayChoiceState = null;
    actionEndSwapState = null; kaitoActionEndState = null; keywordGrantChoiceState = null; bonusEvidenceState = null;
    sleepForOppDiscardState = null; sleepCostState = null; lpBuffChoiceState = null; apBuffState = null; mrReplaceState = null; contactState = null;
    try { document.getElementById('choiceOverlay').style.display = 'none'; } catch (e) {}
  }
  let romanceHit = false;
  const origRomance = runRomanceEntryAbility;
  runRomanceEntryAbility = function(){ const r = origRomance.apply(null, arguments); if (r) romanceHit = true; return r; };
  const flagged = [];
  const lines = c => (c.ability_text || '').replace(/\\r/g, '').split('\\n').map(l => l.trim()).filter(Boolean);
  const prefixTags = l => (l.match(/^((?:【[^】]*】)*)/) || ['', ''])[1];
  for (const card of CARD_DATA) {
    if (!ids.includes(card.id)) continue;
    const ls = lines(card);
    const probs = [];
    // 1) 登場時／イベントの本文：本文あり／本文なしで挙動(イベント列・開いた画面)が同じなら、何も実装されていない疑い
    const sigOf = (evBefore) => match.events.slice(evBefore).map(e => e.type).join(',') + '|' + (choiceState ? 'choice:' + (choiceState.title || '') : '') + [handDiscardState && 'hd', evidencePickState && 'ev', deckPeekState && 'dp', partnerRemoveState && 'pr', hiramekiSleepState && 'hs', switchState && 'sw', oppHandPickState && 'oh', freePlayChoiceState && 'fp', bonusEvidenceState && 'be', sleepCostState && 'sc', lpBuffChoiceState && 'lb', apBuffState && 'ab', mrReplaceState && 'mr', contactState && 'ct'].filter(Boolean).join(',');
    const runEntrySig = async (variant, blank) => {
      const saved = card.ability_text;
      if (blank) card.ability_text = '';
      geeEntryCache.clear();
      setupMatch(10 + card.id % 7 + variant);
      if (variant === 1) forceAll();
      const evBefore = match.events.length;
      romanceHit = false;
      try {
        if (card.card_type === 'キャラ') { const f = inst('self', card.id, 99); match.self.field.push(f); runEntryAbility('self', f.uid, card.id, true, 5); }
        else { const ev = { cardId: card.id, uid: 'self-ev99' }; match.self.hand.push(ev); runEntryAbility('self', ev.uid, card.id, true, 5); }
      } catch (e) { probs.push('entry-error:' + e.message + ' @ ' + String(e.stack).split('|').slice(0,3).join(' / ')); }
      await sleep2(250);
      const sg = sigOf(evBefore);
      const hit = romanceHit;
      clearUi();
      restoreAll();
      card.ability_text = saved;
      geeEntryCache.clear();
      await sleep2(20);
      return { sg, hit };
    };
    const isSetLine = l => /^(このイベントを自分の現場にいる[^。]*にセットする。?$|このイベントがセット|このイベントが、|このイベントは|自分か相手のターン終了時)/.test(l.slice(prefixTags(l).length)) || prefixTags(l).includes('【宣言】') || /^【(ヒラメキ|カットイン)】/.test(prefixTags(l)) || l.startsWith('・');
    const hasEntry = card.card_type === 'キャラ' ? ls.some(l => prefixTags(l).includes('【登場時】')) : (card.card_type === 'イベント' && ls.some(l => !isSetLine(l)));
    if (hasEntry) {
      let different = false, hit = false;
      for (const variant of [0, 1]) {
        const withText = await runEntrySig(variant, false);
        const blank = await runEntrySig(variant, true);
        if (withText.sg !== blank.sg) different = true;
        if (withText.hit) hit = true;
      }
      if (!different && !hit) probs.push('entry-silent' + (geeEntryPlan(card.id) ? '+plan' : ''));
    }
    // 2) 宣言能力の数
    if (card.card_type === 'キャラ') {
      const declLines = ls.filter(l => prefixTags(l).includes('【宣言】') && !/手札からこの(キャラ|イベント)/.test(l));
      if (declLines.length) {
        setupMatch(10 + card.id % 7);
        const f = inst('self', card.id, 99); match.self.field.push(f);
        let html = '';
        try { html = cardActionMenuHtml('self', 'field', f.uid, 1); } catch (e) { probs.push('menu-error:' + e.message); }
        const btns = (html.match(/>宣言[：:][^<]*</g) || []).length;
        if (btns < declLines.length) probs.push('declare:' + btns + '/' + declLines.length);
      }
      // 3) 現場リムーブ時
      const frLines = ls.filter(l => prefixTags(l).includes('【現場リムーブ時】'));
      if (frLines.length) {
        const runFr = async (variant, blank) => {
          const saved = card.ability_text;
          if (blank) card.ability_text = '';
          setupMatch(10 + card.id % 7 + variant);
          if (variant === 1) forceAll();
          const f = inst('self', card.id, 99); match.self.field.push(f);
          match.turn.activeSide = 'opponent';
          const evBefore = match.events.length;
          try {
            const taken = takeFromField(match, 'self', f.uid); match.self.remove.push(taken.card);
            const outcome = getFieldRemovalOutcome('self', f.uid);
            triggerFieldRemoveAbility('self', outcome.card, 'opponent', false);
          } catch (e) { probs.push('fieldremove-error:' + e.message); }
          await sleep2(950);
          const sg = sigOf(evBefore);
          clearUi(); restoreAll(); card.ability_text = saved;
          await sleep2(20);
          return sg;
        };
        let different = false;
        for (const variant of [0, 1]) { if ((await runFr(variant, false)) !== (await runFr(variant, true))) different = true; }
        if (!different) { const frOk = frLines.every(l => !!geeCompile(l.slice(prefixTags(l).length).replace(/（[^）]*）/g, '').replace(/。$/, ''))); probs.push('fieldRemove-silent' + (frOk ? '+plan' : '')); }
      }
    }
    // 4) ヒラメキ
    if (ls.some(l => prefixTags(l).includes('【ヒラメキ】')) && !getHiramekiEffect(card.id)) probs.push('hirameki-unparsed');
    // 5) カットイン
    if (ls.some(l => prefixTags(l).includes('【カットイン】'))) {
      setupMatch(10 + card.id % 7);
      let ok = false;
      try { ok = hasCutInAbility(card.id, 'self') || hasCutInAbility(card.id, 'opponent'); } catch (e) {}
      if (!ok) {
        // 条件付き(状況依存)のものは状況を満たせば使える可能性があるため、タグを無視しても判定
        forceAll();
        try { ok = hasCutInAbility(card.id, 'self') || hasCutInAbility(card.id, 'opponent'); } catch (e) {}
      }
      if (!ok) probs.push('cutin-unparsed');
    }
    restoreAll();
    if (probs.length) flagged.push({ id: card.id, name: card.name, type: card.card_type, probs });
    setupMatch(1);
  }
  return { flagged, total: ids.length };
})()
`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  const logs = [];
  w.webContents.on('console-message', (e, level, message) => { if (level >= 3) logs.push(message.slice(0, 300)); });
  await w.loadFile(path.join(process.argv[2], 'battle.html'));
  await new Promise(r => setTimeout(r, 800));
  let out;
  try { out = await w.webContents.executeJavaScript(PAGE_SCRIPT); } catch (e) { out = { fatal: e.message }; }
  console.log('VERIFY_JSON ' + JSON.stringify({ out, logs: logs.slice(0, 10) }));
  app.quit();
});
