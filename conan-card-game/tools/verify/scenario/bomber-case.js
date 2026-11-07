const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
await scen('0777 白馬探: 登場時に裏向きでセットしたカードが、盤面で裏面表示になる', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { hand: ['0777'], file: 8 } });
  const h = match.self.hand[0];
  playCard('self', h.uid);
  await settle();
  const host = match.self.field.find(c => defOfInst(c).card_id === '0777');
  renderBoard(match);
  const els = [...document.querySelectorAll('.zone[data-side="self"] .under-card')];
  return { ok: !!host && host.under.length === 1 && host.under[0].faceDown === true && els.length === 1 && els[0].classList.contains('face-down') && !els[0].querySelector('img'), note: `under=${host && host.under.length} fd=${host && host.under[0] && host.under[0].faceDown} els=${els.length} cls=${els[0] && els[0].className}` };
});
