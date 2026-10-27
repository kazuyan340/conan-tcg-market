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
      hayateTriggeredSide: { self: false, opponent: false }, tempApBuffs: [], tempLpBuffs: [], tempBaseLpZeroGrants: [], tempBaseApZeroGrants: [], hayateTriggeredUids: [], chosenByMrUids: [], tempEndOfTurnBounceUnlessMr: [], tempEndOfTurnEvidenceGrants: [],
    };
    document.getElementById('board').style.display = 'block';
    try { renderBoard(match); } catch (e) { errors.push('renderBoard: ' + e.message); }
  }
  async function autoResolve(label){
    let idle = 0;
    for (let step = 0; step < 80 && idle < 3; step++) {
      let acted = false;
      try {
        if (choiceState) {
          const cs = choiceState;
          const enabled = (cs.items || []).filter(i => !i.disabled);
          const max = cs.max || 1;
          let keys = [];
          if (cs.min > 0 || enabled.length) keys = enabled.slice(0, Math.max(cs.min || 0, 1)).map(i => i.key);
          if ((cs.min || 0) === 0 && step % 2 === 0) keys = []; // 交互に「選ばない」も試す
          if (cs.min > 0 && keys.length < cs.min) keys = enabled.slice(0, cs.min).map(i => i.key);
          finishChoice(keys.slice(0, max)); acted = true;
        } else if (handDiscardState) {
          const h = match[handDiscardState.side].hand;
          if (h.length) selectHandDiscardTarget(h[0].uid); else handDiscardState = null;
          acted = true;
        } else if (evidencePickState) {
          const st = evidencePickState;
          const ev = match[st.side].evidence;
          if (st.min > 0 || step % 2) { if (ev.length) toggleEvidencePick(ev[0].uid); confirmEvidencePick(); } else skipEvidencePick();
          acted = true;
        } else if (deckPeekState) {
          const st = deckPeekState;
          // 最初の候補を選んで確定、または全てデッキに戻す
          try { if (typeof confirmDeckPeekFinish === 'function') confirmDeckPeekFinish(); } catch (e) {}
          if (deckPeekState && deckPeekState === st) { deckPeekState = null; renderDeckPeekOverlay(); }
          acted = true;
        } else if (partnerRemoveState) { partnerRemoveState = null; acted = true; }
        else if (hiramekiSleepState) { hiramekiSleepState = null; acted = true; }
        else if (switchState) { switchState = null; acted = true; }
        else if (oppHandPickState) { oppHandPickState = null; acted = true; }
      } catch (e) { errors.push(label + ' / 自動操作中: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); acted = true; choiceState = null; }
      if (acted) { idle = 0; await sleep(60); } else { idle++; await sleep(250); }
    }
    choiceState = null; handDiscardState = null; evidencePickState = null; deckPeekState = null;
    partnerRemoveState = null; hiramekiSleepState = null; switchState = null; oppHandPickState = null;
  }
  const origRandom = Math.random;
  // 条件タグ・パートナー色・解決編を常に満たすようにして、効果本体まで到達させる
  const forceTrue = (name, fn) => { try { window[name] = fn; } catch (e) {} };
  for (const id of ids) {
    const card = CARD_BY_ID.get(id);
    if (!card) continue;
    for (const variant of [0, 1]) {
      setupMatch(10 + id % 7 + variant);
      if (variant === 1) { forceTrue('tagsOk', () => true); }
      const label = id + ' ' + card.name + ' v' + variant;
      const before = errors.length;
      try {
        // 登場時／イベント：現場に出して登場時処理を実行
        if (card.card_type === 'キャラ') {
          const f = inst('self', id, 99); match.self.field.push(f);
          try { runEntryAbility('self', f.uid, id, true, 5); } catch (e) { errors.push(label + ' / 登場時: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
          await autoResolve(label + ' 登場時');
        } else if (card.card_type === 'イベント') {
          const ev = { cardId: id, uid: 'self-ev99' }; match.self.hand.push(ev);
          try { runEntryAbility('self', ev.uid, id, true, 5); } catch (e) { errors.push(label + ' / イベント: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
          await autoResolve(label + ' イベント');
        }
        // 宣言(キャラ)
        if (card.card_type === 'キャラ') {
          const f = match.self.field.find(c => c.uid === 'self-x99');
          if (f) {
            const decls = getRomanceDeclares(id);
            for (const d of decls) {
              try {
                const why = d.def.check ? d.def.check('self', f.uid, d.params) : '';
                match.turn.declaredAbilityUids = [];
                f.sleeping = false;
                d.def.run('self', f.uid, d.params);
              } catch (e) { errors.push(label + ' / 宣言 ' + d.def.id + ': ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
              await autoResolve(label + ' 宣言 ' + d.def.id);
            }
          }
        }
        // 事件の宣言
        if (card.card_type === '事件') {
          match.self.case = { cardId: id, uid: 'self-case', resolved: true };
          const g = getGenericCaseDeclare(id);
          if (g) {
            try { g.def.run('self', 'self-case', g.params, []); } catch (e) { errors.push(label + ' / 事件宣言: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
            await autoResolve(label + ' 事件宣言');
          }
        }
        // カットイン使用の判定関数
        try { hasCutInAbility(id, 'self'); getInteractiveCutIn(id); getGenericCutIn(id); } catch (e) { errors.push(label + ' / カットイン判定: ' + e.message); }
        // 描画
        try { renderBoard(match); } catch (e) { errors.push(label + ' / 描画: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
      } catch (e) { errors.push(label + ' / 想定外: ' + e.message); }
      results.push({ label, errors: errors.length - before });
    }
  }
  return { errors, tested: results.length };
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
  console.log('FUZZ_JSON ' + JSON.stringify({ out, logs: logs.slice(0, 10) }));
  app.quit();
});
