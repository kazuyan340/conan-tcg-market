const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const lv = n => CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === n && /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000 && !(c.ability_text || '').match(/アクションできない|ガード/)).card_id;
await scen('0823 ウォッカ: 名乗り状態でもLv4以下を指定してアクションできる', async () => {
  setup({ partner: partnerOf('黒'), case: '1262', self: { field: ['0823'] }, opp: { field: [{ no: lv(4), sleeping: true }, { no: lv(6), sleeping: true }] } });
  const v = match.self.field[0]; v.justEntered = true;
  const can = canUseAction('self', v.uid);
  const [lo, hi] = match.opponent.field;
  startAction('self', v.uid);
  const okLo = !!(actionState && actionState.step === 'target');
  const dLo = limitedChargeAllows(v, defOfInst(lo)), dHi = limitedChargeAllows(v, defOfInst(hi));
  return { ok: can.ok && okLo && dLo && !dHi, note: `can=${can.ok} lowOk=${dLo} highOk=${dHi}` };
});
await scen('0823 ウォッカ: 登場済み(名乗りでない)なら制限なし', async () => {
  setup({ partner: partnerOf('黒'), case: '1262', self: { field: ['0823'] }, opp: { field: [{ no: lv(6), sleeping: true }] } });
  const v = match.self.field[0]; v.justEntered = false;
  return { ok: limitedChargeAllows(v, defOfInst(match.opponent.field[0])) && canUseAction('self', v.uid).ok, note: '' };
});
