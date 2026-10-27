const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const kidsLv4 = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.level === 4 && (c.category || '').includes('少年探偵団')).reduce((a, c) => { if (!a.some(x => x.name === c.name)) a.push(c); return a; }, []);
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
for (const [no, lvPred, label] of [['1176', c => c.level >= 8, 'レベル8以上'], ['1177', c => c.level <= 7, 'レベル7以下']]) {
  await scen(`${no} カットイン: 少年探偵団Lv4が2枚→コンタクト中の${label}をリムーブ＋ドロー`, async () => {
    const tgt = CARD_DATA.find(c => c.card_type === 'キャラ' && lvPred(c) && c.ap != null && numeric(c) && !/選ばれない|カットイン|変装/.test(c.ability_text || ''));
    const mine = kidsLv4.filter(c => c.card_id !== no).slice(0, 2).map(c => c.card_id);
    setup({ partner: partnerOf('青'), case: '1261', self: { field: mine, hand: [no] }, opp: { field: [{ no: tgt.card_id, sleeping: true }] } });
    const atk = match.self.field[0], dfn = match.opponent.field[0];
    startContact('self', atk.uid, 'opponent', dfn.uid, 'char', null);
    await settle({ choose: () => ['no'] });
    if (!contactState) return { ok: false, note: 'no contact' };
    const hand = match.self.hand[0];
    const usable = hasCutInAbility(hand.cardId, 'self');
    if (!usable) { clearUi(); return { ok: false, note: 'cutin not usable' }; }
    const h0 = match.self.hand.length - 1;
    contactState.queue = ['self'];
    contactUseCutIn('self', hand.uid);
    const log = await settle();
    const removed = !match.opponent.field.some(c => c.uid === dfn.uid);
    return { ok: removed && match.self.hand.length === h0 + 1, log, note: `removed=${removed} hand ${h0}->${match.self.hand.length}` };
  });
}
await scen('1185 五人囃子(再): 登場/スリープ登場/残り手札', async () => {
  const four = kidsLv4.slice(0, 3);
  setup({ partner: partnerOf('青'), case: '1261', self: { remove: four.map(c => c.card_id) } });
  const h0 = match.self.hand.length;
  const e = { cardId: CID('1185'), uid: 'self-evg' }; match.self.hand.push(e);
  executePlay('self', e.uid, {});
  const log = await settle();
  return { ok: match.self.field.length === 2 && match.self.hand.length === h0 + 1 && match.self.field.filter(c => c.sleeping).length === 1, log, note: snap() };
});
