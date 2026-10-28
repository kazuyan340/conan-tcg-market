const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000).sort((a, b) => a.ap - b.ap)[0].card_id;
await scen('0224 世良真純 登場時: 付与先に自分自身が出ない・赤井秀一(0320)には突撃［事件］(突撃ではない)', async () => {
  setup({ partner: partnerOf('赤'), case: '0068', self: { hand: ['0224'], field: ['0320'], file: 8 }, opp: { field: [] } });
  const h = match.self.hand[0];
  playCard('self', h.uid);
  let offered = null;
  const log = await settle({ choose: (cs, items) => { const y = items.find(it => it.key === 'yes'); if (y) return ['yes']; offered = items.map(it => it.key); return [items[0].key]; } });
  const a = instOf('self', '0320');
  const okKw = charHasKeyword(a, '突撃［事件］') && !charHasKeyword(a, '突撃');
  return { ok: okKw && offered && !offered.includes(h.uid) && match.opponent.evidence.length === 1, log, note: 'offered=' + offered };
});
