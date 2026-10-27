// ページ側(renderer)で実行するシナリオ試験の共通部品
const errors = [];
window.addEventListener('error', e => errors.push('window.error: ' + e.message + ' @ ' + String(e.error && e.error.stack).split(String.fromCharCode(10)).slice(1, 4).join(' | ')));
window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.message)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const C = n => { const c = CARD_DATA.find(x => String(x.card_id) === String(n)); if (!c) throw new Error('no card ' + n); return c; };
const CID = n => C(n).id;
let uidSeq = 0;
const mkInst = (side, cardId, extra) => Object.assign({ cardId, uid: side + '-t' + (++uidSeq), sleeping: false, justEntered: false, under: [] }, extra || {});
const filler = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.level != null && c.level <= 3 && /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000);
function cfgFor(partnerNo, caseNo){
  const deckOrder = []; for (let i = 0; i < 40; i++) deckOrder.push(filler[i % filler.length].id);
  return { deckName: 'T', partnerCardId: CID(partnerNo), caseCardId: CID(caseNo), deckOrder };
}
function pendingNames(){
  const names = { choiceState, handDiscardState, evidencePickState, deckPeekState, partnerRemoveState, hiramekiSleepState, switchState, oppHandPickState, contactState, hiramekiState, freePlayChoiceState, actionEndSwapState, kaitoActionEndState, keywordGrantChoiceState, bonusEvidenceState, sleepForOppDiscardState, sleepCostState, lpBuffChoiceState, apBuffState, mrReplaceState };
  return Object.keys(names).filter(k => !!names[k]);
}
// 盤面を作る。o: { partner, case, self:{field:[no|{no,sleeping,stunned,under}], hand:[no], remove:[no], evidence:[{faceUp}|bool], file:n, deck:[no] }, opp:{...}, active:'self', resolved:bool }
function setup(o){
  o = o || {};
  const cs = cfgFor(o.partner || 'P001', o.case || '1254'), co = cfgFor(o.oppPartner || 'P001', o.oppCase || '1254');
  window.match = { config: { self: cs, opponent: co }, self: buildSideState('self', cs), opponent: buildSideState('opponent', co), events: [], turn: null, firstPlayer: 'self', gameOver: false };
  match = window.match;
  const fill = (sk, d) => {
    const s = match[sk]; d = d || {};
    const ent = e => (typeof e === 'object' ? e : { no: e });
    s.field = (d.field || []).map(e => { e = ent(e); return mkInst(sk, CID(e.no), { sleeping: !!e.sleeping, stunned: !!e.stunned, under: e.under || [] }); });
    if (d.hand) s.hand = d.hand.map(n => ({ cardId: CID(n), uid: sk + '-h' + (++uidSeq) }));
    if (d.remove) s.remove = d.remove.map(n => ({ cardId: CID(n), uid: sk + '-r' + (++uidSeq) }));
    if (d.evidence) s.evidence = d.evidence.map(e => ({ cardId: filler[0].id, uid: sk + '-e' + (++uidSeq), faceUp: typeof e === 'object' ? !!e.faceUp : !!e }));
    if (d.file != null) s.file = Array.from({ length: d.file }, () => ({ cardId: filler[1].id, uid: sk + '-f' + (++uidSeq) }));
    if (d.deckTop) s.deckPile = d.deckTop.map(n => ({ cardId: CID(n), uid: sk + '-d' + (++uidSeq) })).concat(s.deckPile);
    if (d.partnerSleeping != null && s.partner) s.partner.sleeping = d.partnerSleeping;
  };
  fill('self', o.self); fill('opponent', o.opp);
  if (o.resolved) match.self.case.resolved = true;
  if (o.oppResolved) match.opponent.case.resolved = true;
  match.turn = {
    activeSide: o.active || 'self', phase: 'main', turnNumber: 3,
    declaredAbilityUids: [], tempKeywords: [], tempLevelDebuffs: [], tempEndOfTurnBounceGrants: [], tempEndOfTurnRemoveGrants: [],
    tempActionDrawGrants: [], tempContactWipeGrants: [], tempContactReentryGrants: [], tempNextEvidenceRemovalStun: [],
    hayateFirstEntryUsed: { self: false, opponent: false }, hayateIgnoreNextEntry: { self: false, opponent: false },
    hayateTriggeredSide: { self: false, opponent: false }, tempApBuffs: [], tempLpBuffs: [], tempBaseLpZeroGrants: [], hayateTriggeredUids: [], chosenByMrUids: [], tempEndOfTurnBounceUnlessMr: [], tempEndOfTurnEvidenceGrants: [], tempBaseLpZero: [], tempBaseApZero: [], tempBaseApZeroGrants: [], actedCharUids: [], guardedActorUids: [], contactRemovalCreditUids: [], tempDeclareGrants: [], tempContactDeckDigGrants: [], lockedCardNames: [], playedCardThisTurn: false, nextHintUsedThisTurn: false, nextHintPending: false, nextHintBlocked: false,
  };
  document.getElementById('board').style.display = 'block';
  try { renderBoard(match); } catch (e) { errors.push('renderBoard: ' + e.message); }
  geeEntryCache.clear();
}
function clearUi(){
  choiceState = null; handDiscardState = null; evidencePickState = null; deckPeekState = null; partnerRemoveState = null;
  hiramekiSleepState = null; switchState = null; oppHandPickState = null; hiramekiState = null; freePlayChoiceState = null;
  actionEndSwapState = null; kaitoActionEndState = null; keywordGrantChoiceState = null; bonusEvidenceState = null;
  sleepForOppDiscardState = null; sleepCostState = null; lpBuffChoiceState = null; apBuffState = null; mrReplaceState = null; contactState = null;
  try { document.getElementById('choiceOverlay').style.display = 'none'; } catch (e) {}
}
// 選択画面を自動で進める。policy.choose(cs, items) があればそれで選ぶ(未指定なら yes を優先、無ければ先頭の選べるもの)
async function settle(policy){
  policy = policy || {};
  const log = [];
  let quiet = 0;
  for (let i = 0; i < 80 && quiet < 16; i++) {
    await sleep(220);
    if (choiceState) {
      quiet = 0;
      const cs = choiceState, items = cs.items.filter(it => !it.disabled).sort((a, b) => (String(b.key).startsWith('opponent-') ? 1 : 0) - (String(a.key).startsWith('opponent-') ? 1 : 0));
      let keys;
      if (policy.choose) keys = policy.choose(cs, items);
      if (!keys) {
        if (items.some(it => it.key === 'yes')) keys = ['yes'];
        else { const want = Math.max(cs.min || 0, 1); keys = items.slice(0, Math.min(cs.max || 1, want)).map(it => it.key); }
      }
      log.push(`[${cs.title || ''}] ${String(cs.hint || '').slice(0, 50)} {${cs.items.map(it => it.key + ':' + (it.cardId != null ? (CARD_BY_ID.get(it.cardId) || {}).card_id : '') + (it.disabled ? 'X' : '')).join(' ')}} -> ${keys.join(',') || '(none)'}`);
      finishChoice(keys);
      continue;
    }
    if (handDiscardState) { quiet = 0; const h = match[handDiscardState.side].hand[0]; log.push('handDiscard'); if (!h) { handDiscardState = null; } else { selectHandDiscardTarget(h.uid); await sleep(600); } continue; }
    if (evidencePickState) {
      quiet = 0; const st = evidencePickState;
      const pool = match[st.side].evidence.filter(e => st.mode === 'toFaceUp' ? !e.faceUp : st.mode === 'toFaceDown' ? e.faceUp : true);
      const n = Math.max(st.min || 0, Math.min(st.max, pool.length));
      pool.slice(0, n).forEach(e => toggleEvidencePick(e.uid));
      log.push('evidencePick ' + st.mode + ' x' + n);
      confirmEvidencePick();
      continue;
    }
    if (deckPeekState) { quiet = 0; log.push('deckPeek(stuck)'); clearUi(); continue; }
    const pend = pendingNames();
    if (pend.length) { quiet = 0; log.push('pending:' + pend.join(',')); if (i > 40) break; continue; }
    quiet++;
  }
  return log;
}
const snap = () => JSON.stringify(['self', 'opponent'].map(sk => ({
  field: match[sk].field.map(c => c.cardId + (c.sleeping ? 's' : '') + (c.stunned ? 'x' : '') + '[' + (c.under || []).length + ']'),
  hand: match[sk].hand.length, remove: match[sk].remove.length, deck: match[sk].deckPile.length, ev: match[sk].evidence.map(e => e.faceUp ? 'U' : 'D').join(''), file: match[sk].file.length,
  jewels: (match[sk].partnerJewels || []).length,
})));
const results = [];
async function scen(name, fn){
  const t0 = errors.length;
  let r;
  try { clearUi(); r = await fn(); } catch (e) { r = { ok: false, note: 'EXC ' + e.message + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | ') }; }
  clearUi();
  const newErr = errors.slice(t0);
  results.push(`${r && r.ok ? 'PASS' : 'FAIL'} ${name}${r && r.note ? ' :: ' + r.note : ''}${newErr.length ? ' !!ERR ' + newErr.join(' ; ') : ''}${r && r.log && !r.ok ? ' LOG ' + r.log.join(' / ') : ''}`);
}
const fieldNos = sk => match[sk].field.map(c => defOfInst(c).card_id);
const has = (sk, zone, no) => match[sk][zone].some(c => defOfInst(c).card_id === String(no));
