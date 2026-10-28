// サーバーなしの直接通信(WebRTC DataChannel)。
// 接続の取り決め(シグナリング)は、「合言葉」の文字列をコピー&ペーストで交換して行う:
//   ホスト: createOffer() で合言葉Aを作る → ゲストに渡す
//   ゲスト: acceptOffer(合言葉A) で合言葉Bを作る → ホストに渡す
//   ホスト: acceptAnswer(合言葉B) で接続完了
// 接続後は send(obj) / onMessage(obj) でJSONのメッセージを送り合う(大きいメッセージは自動で分割する)。
(function(){
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const CHUNK = 12000;            // 1通あたりの最大文字数(DataChannelの上限より十分小さくする)
  const GATHER_TIMEOUT_MS = 4000; // 経路(ICE候補)の収集を待つ最大時間
  const PING_MS = 4000, DEAD_MS = 15000;

  async function toCode(obj){
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function fromCode(code){
    const b64 = String(code).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
    return JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer()));
  }

  function waitIceComplete(pc){
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => { pc.removeEventListener('icegatheringstatechange', onChange); clearTimeout(timer); resolve(); };
      const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  class P2PConnection {
    constructor(){
      this.pc = null; this.dc = null;
      this.state = 'idle'; // idle → waiting → connecting → open → closed
      this.onOpen = null; this.onMessage = null; this.onClose = null; this.onState = null;
      this._chunks = new Map(); this._seq = 0; this._lastRecv = 0; this._timers = [];
    }
    _setState(s){ this.state = s; if (this.onState) this.onState(s); }
    _newPc(){
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') this._closed('connection-' + pc.connectionState);
      });
      this.pc = pc;
      return pc;
    }
    _wire(dc){
      this.dc = dc;
      dc.addEventListener('open', () => {
        this._lastRecv = Date.now();
        this._timers.push(setInterval(() => {
          if (this.state !== 'open') return;
          if (Date.now() - this._lastRecv > DEAD_MS) { this._closed('timeout'); return; }
          try { dc.send(JSON.stringify({ t: 'ping' })); } catch (e) {}
        }, PING_MS));
        this._setState('open');
        if (this.onOpen) this.onOpen();
      });
      dc.addEventListener('close', () => this._closed('channel-closed'));
      dc.addEventListener('message', ev => {
        this._lastRecv = Date.now();
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'ping') return;
        if (m.t === 'msg') { this._deliver(m.d); return; }
        if (m.t === 'part') {
          const e = this._chunks.get(m.id) || { n: m.n, parts: [] };
          e.parts[m.i] = m.d; this._chunks.set(m.id, e);
          if (e.parts.filter(x => x !== undefined).length === e.n) {
            this._chunks.delete(m.id);
            let obj; try { obj = JSON.parse(e.parts.join('')); } catch (err) { return; }
            this._deliver(obj);
          }
        }
      });
    }
    _deliver(obj){ if (this.onMessage) this.onMessage(obj); }
    _closed(reason){
      if (this.state === 'closed') return;
      this._timers.forEach(clearInterval); this._timers = [];
      this._setState('closed');
      try { if (this.dc) this.dc.close(); } catch (e) {}
      try { if (this.pc) this.pc.close(); } catch (e) {}
      if (this.onClose) this.onClose(reason);
    }
    // ホスト: 合言葉A(申し込み)を作る
    async createOffer(){
      const pc = this._newPc();
      this._wire(pc.createDataChannel('game', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await waitIceComplete(pc);
      this._setState('waiting');
      return toCode({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    }
    // ゲスト: 合言葉Aを受け取り、合言葉B(返事)を作る
    async acceptOffer(code){
      const desc = await fromCode(code);
      if (!desc || desc.type !== 'offer') throw new Error('ホストの合言葉ではありません');
      const pc = this._newPc();
      pc.addEventListener('datachannel', ev => this._wire(ev.channel));
      await pc.setRemoteDescription(desc);
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIceComplete(pc);
      this._setState('connecting');
      return toCode({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    }
    // ホスト: 合言葉Bを受け取って接続を完了する
    async acceptAnswer(code){
      const desc = await fromCode(code);
      if (!desc || desc.type !== 'answer') throw new Error('ゲストの合言葉ではありません');
      await this.pc.setRemoteDescription(desc);
      this._setState('connecting');
    }
    send(obj){
      if (!this.dc || this.dc.readyState !== 'open') return false;
      const json = JSON.stringify(obj);
      if (json.length <= CHUNK) { this.dc.send(JSON.stringify({ t: 'msg', d: obj })); return true; }
      const id = ++this._seq, n = Math.ceil(json.length / CHUNK);
      for (let i = 0; i < n; i++) this.dc.send(JSON.stringify({ t: 'part', id, i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) }));
      return true;
    }
    close(){ this._closed('local'); }
  }
  window.P2PConnection = P2PConnection;
})();
