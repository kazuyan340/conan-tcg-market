(function(){
  const cards = (window.CARD_DATA||[]);
  const chars = cards.filter(c => c.card_type === 'キャラ' && c.level != null && c.level <= 3).slice(0, 14);
  const evs = cards.filter(c => c.card_type === 'イベント').slice(0, 6);
  const pool = [...chars, ...evs];
  const mk = (name, off) => {
    const list = []; let i = off;
    while (list.reduce((a,c)=>a+c.qty,0) < 40) { const c = pool[i % pool.length]; i++; const e = list.find(x=>x.id===c.id); if (e) { if (e.qty < 3) e.qty++; else continue; } else list.push({id:c.id, qty:1}); }
    return { name, cards: list, partnerCardId: (cards.find(c=>c.card_type==='パートナー')||{}).id, caseCardId: (cards.find(c=>c.card_type==='事件')||{}).id };
  };
  startMatchWith(mk('テストA', 0), mk('テストB', 5), 'self');
  return { cards: cards.length, hand: match.self.hand.length };
})()
