// Salon en mémoire qui imite la capacité `room` : événements, présence, pairs estampillés.
export class Hub {
  constructor() { this.rooms = new Map(); this.n = 0; this.delay = 0; this.drop = 0; this.log = []; }
  // Un « document ouvert » (un onglet) qui peut rejoindre des salons nommés.
  open() {
    const peer = 'peer' + ++this.n;
    const hub = this;
    return {
      peer,
      join: async (name) => hub.join(peer, name),
      claude: { use: async (cap) => (cap === 'room' ? { join: async (name) => hub.join(peer, name) } : null) },
    };
  }
  join(peer, name) {
    let r = this.rooms.get(name);
    if (!r) { r = { members: new Map(), listeners: [] }; this.rooms.set(name, r); }
    if (r.members.has(peer)) return r.members.get(peer).api;
    const m = { peer, presence: {}, updatedAt: Date.now(), topics: new Map(), peerHandlers: new Set(), api: null, last: null, left: false };
    const hub = this;
    const snapshot = () => [...r.members.values()].map((x) => ({ peer: x.peer, isMe: x.peer === m.peer, sameTab: x.peer === m.peer, kind: 'viewer', guest: false, by: null, presence: Object.freeze({ ...x.presence }), updatedAt: x.updatedAt }));
    const notify = (change) => r.members.forEach((x) => {
      const snap = [...r.members.values()].map((y) => ({ peer: y.peer, isMe: y.peer === x.peer, sameTab: y.peer === x.peer, kind: 'viewer', guest: false, by: null, presence: Object.freeze({ ...y.presence }), updatedAt: y.updatedAt }));
      const pick = (arr) => snap.filter((s) => arr.includes(s.peer));
      queueMicrotask(() => x.peerHandlers.forEach((h) => h({ peers: snap, joined: pick(change.joined || []), left: [], updated: pick(change.updated || []) })));
    });
    m.api = {
      name,
      emit: async (topic, data) => {
        const json = JSON.stringify(data);
        if (new TextEncoder().encode(json).length > 4096) throw Object.assign(new Error('data > 4 KiB'), { code: 'invalid_argument' });
        if (hub.drop && Math.random() < hub.drop) return;
        hub.log.push({ peer, topic, size: json.length });
        const send = () => r.members.forEach((x) => {
          const hs = x.topics.get(topic);
          if (!hs) return;
          const msg = { topic, data: JSON.parse(json), peer, by: null, isMe: x.peer === peer, sameTab: x.peer === peer, kind: 'viewer', guest: false };
          hs.forEach((h) => h(msg));
        });
        setTimeout(send, hub.delay);
      },
      on: (topic, h) => { if (!m.topics.has(topic)) m.topics.set(topic, new Set()); m.topics.get(topic).add(h); return () => m.topics.get(topic).delete(h); },
      presence: async (patch) => {
        Object.entries(patch).forEach(([k, v]) => { if (v === null) delete m.presence[k]; else m.presence[k] = JSON.parse(JSON.stringify(v)); });
        m.updatedAt = Date.now();
        notify({ updated: [peer] });
      },
      peers: () => snapshot(),
      onPeers: (h) => { m.peerHandlers.add(h); queueMicrotask(() => h({ peers: snapshot(), joined: snapshot(), left: [], updated: [] })); return () => m.peerHandlers.delete(h); },
      connected: () => true,
      onConnection: (h) => { queueMicrotask(() => h(true)); return () => {}; },
      leave: async () => { r.members.delete(peer); },
    };
    r.members.set(peer, m);
    notify({ joined: [peer] });
    return m.api;
  }
}
