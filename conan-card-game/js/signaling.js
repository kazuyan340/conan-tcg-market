// 「同じパス(合言葉)を入れた2人を引き合わせる」ための仲介。
// 公開の無料サービス ntfy.sh を、接続情報(WebRTCのoffer/answer)を渡すためだけに使う。
// 対戦中のデータはこれを通らず、2人のPCが直接(P2P)やり取りする。
//
//   パス → SHA-256 → 部屋名(topic)。同じパスを入れた人だけが同じtopicを見る。
//   双方が hello を流す → idが小さい方がホスト(offerを作る)、大きい方がゲスト(answerを返す)
//
// 自前のntfyサーバーに切り替えるときは SIGNAL_BASE を書き換える。
(function(){
  const SIGNAL_BASE = 'https://ntfy.sh';
  const HELLO_MS = 6000;       // helloを流す間隔(ntfyの無料枠のレート制限に収まるよう間引く)
  const TIMEOUT_MS = 120000;   // 相手が現れない/つながらない場合に諦めるまで
  const MAX_PART = 3000;       // ntfyは1通4096バイトまでなので、合言葉コードはこの長さで分割する

  async function sha256Hex(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('');

  // pass で相手を探してつなぐ。成功すると { conn, role: 'host'|'guest' } を返す。
  // opts.onStatus(text) に進行状況が届く。opts.signal(AbortSignal) で中断できる。
  async function findOpponent(pass, opts){
    opts = opts || {};
    const status = opts.onStatus || (() => {});
    const topic = 'conantcg-' + (await sha256Hex('conan-tcg-online:' + pass)).slice(0, 40);
    const me = randomId();
    const wsUrl = SIGNAL_BASE.replace(/^http/, 'ws') + '/' + topic + '/ws';
    const postUrl = SIGNAL_BASE + '/' + topic;

    return new Promise((resolve, reject) => {
      let ws = null, helloTimer = null, giveUpTimer = null, finished = false, closedByUs = false;
      let peerId = null;               // 組む相手(最初にhelloが届いた人に固定する)
      let conn = null;
      const partsIn = new Map();       // 分割メッセージの組み立て用 key=`${from}:${k}`
      const knownPeers = new Set();

      const publish = obj => fetch(postUrl, { method: 'POST', body: JSON.stringify(obj) }).catch(() => {});
      function publishLong(kind, to, code){
        const n = Math.ceil(code.length / MAX_PART);
        for (let i = 0; i < n; i++) publish({ k: kind, from: me, to, i, n, d: code.slice(i * MAX_PART, (i + 1) * MAX_PART) });
      }
      function cleanup(){
        finished = true; closedByUs = true;
        clearInterval(helloTimer); clearTimeout(giveUpTimer);
        try { if (ws) ws.close(); } catch (e) {}
      }
      function fail(err){ if (finished) return; cleanup(); try { if (conn) conn.close(); } catch (e) {} reject(err); }
      function succeed(role){ if (finished) return; cleanup(); resolve({ conn, role }); }

      if (opts.signal) opts.signal.addEventListener('abort', () => fail(new Error('キャンセルしました')));
      giveUpTimer = setTimeout(() => fail(new Error('相手が見つかりませんでした(時間切れ)。パスが同じか確認してください')), TIMEOUT_MS);

      function sendHello(){ publish({ k: 'hello', from: me }); }

      async function onMessage(m){
        if (!m || m.from === me || finished) return;
        if (m.k === 'hello') {
          // idの小さい方がホスト。新しい相手のhelloには、すぐ自分のhelloも返して発見を早める
          if (!knownPeers.has(m.from)) { knownPeers.add(m.from); sendHello(); }
          if (peerId && peerId !== m.from) return;                 // もう別の人と組んでいる
          if (me < m.from && !peerId) {
            peerId = m.from;
            status('相手が見つかりました。接続しています…');
            try {
              conn = new P2PConnection();
              const code = await conn.createOffer();
              publishLong('offer', peerId, code);
              conn.onOpen = () => succeed('host');
              conn.onClose = r => fail(new Error('接続できませんでした(' + r + ')。回線によっては直接つながらないことがあります'));
            } catch (e) { fail(e); }
          }
          return;
        }
        if (m.to !== me) return;
        // 分割された合言葉コードを組み立てる
        const key = m.from + ':' + m.k;
        const e = partsIn.get(key) || { n: m.n, parts: [] };
        e.parts[m.i] = m.d; partsIn.set(key, e);
        if (e.parts.filter(x => x !== undefined).length !== e.n) return;
        partsIn.delete(key);
        const code = e.parts.join('');
        try {
          if (m.k === 'offer' && !peerId) {
            peerId = m.from;
            status('相手が見つかりました。接続しています…');
            conn = new P2PConnection();
            conn.onOpen = () => succeed('guest');
            conn.onClose = r => fail(new Error('接続できませんでした(' + r + ')。回線によっては直接つながらないことがあります'));
            publishLong('answer', peerId, await conn.acceptOffer(code));
          } else if (m.k === 'answer' && conn && m.from === peerId) {
            await conn.acceptAnswer(code);
          }
        } catch (err) { fail(err); }
      }

      status('相手を待っています…');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { sendHello(); helloTimer = setInterval(() => { if (!peerId) sendHello(); }, HELLO_MS); };
      ws.onmessage = ev => {
        let n; try { n = JSON.parse(ev.data); } catch (e) { return; }
        if (n.event !== 'message') return;
        let m; try { m = JSON.parse(n.message); } catch (e) { return; }
        onMessage(m);
      };
      ws.onerror = () => fail(new Error('仲介サーバー(ntfy.sh)に接続できません。ネット接続を確認してください'));
      ws.onclose = () => { if (!closedByUs) fail(new Error('仲介サーバーとの接続が切れました')); };
    });
  }

  window.OnlineMatch = { findOpponent };
})();
