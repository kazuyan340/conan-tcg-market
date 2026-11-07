const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
await scen('証拠を得るとき、デッキのカードに残った表向きの印を引きずらない(裏向きで入る)', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', self: {}, opp: {} });
  match.self.deckPile[0].faceUp = true;
  recordEvent({ type: 'addEvidence', side: 'self' });
  const e = match.self.evidence[match.self.evidence.length - 1];
  return { ok: e.faceUp === false, note: 'faceUp=' + e.faceUp };
});
