// Interface. Aucune règle ici : tout vient de Engine.available / targetsFor / apply.
// Trois modes : « local » (un seul écran), « host » (écran du plateau) et « client » (téléphone).
(function () {
  'use strict';
  const E = window.Engine;
  const N = window.Net;
  const RES = E.RES;
  const ARTIFACT_URL = 'https://claude.ai/artifact/5joQ3H2dnKkyBn6zjJ5NMj';
  const NAME = { wood: 'Bois', brick: 'Argile', sheep: 'Laine', wheat: 'Blé', ore: 'Minerai' };
  const COLOR_VAR = ['--p-red', '--p-blue', '--p-orange', '--p-white'];
  const COLOR_FR = ['rouge', 'bleu', 'orange', 'blanc'];
  const GLYPH = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore', desert: 'desert' };
  const DEV_HELP = {
    knight: 'Déplace le voleur et vole une carte.',
    vp: 'Compte 1 point, reste caché.',
    roadBuilding: 'Pose 2 routes gratuites.',
    yearOfPlenty: 'Prends 2 cartes de ton choix à la banque.',
    monopoly: 'Tous les autres te donnent une ressource choisie.',
  };
  const SAVE_KEY = 'colons-de-lile-v1';
  const HOST_KEY = 'colons-de-lile-host-v1';
  const CLIENT_KEY = 'colons-de-lile-client-v1';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const S = 100;

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zero = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const sum = (b) => RES.reduce((n, r) => n + b[r], 0);
  const icon = (r, cls) => '<svg class="' + (cls || 'ico') + '" aria-hidden="true"><use href="#g-' + r + '"/></svg>';
  const bundle = (b) => '<span class="bundle">' + RES.filter((r) => b[r]).map((r) => b[r] + icon(r, 'mini')).join(' ') + '</span>';
  const costIcons = (c) => RES.filter((r) => c[r]).map((r) => icon(r, 'mini').repeat(c[r])).join('');
  const pcolor = (i) => 'var(' + COLOR_VAR[i] + ')';
  const cardsOf = (p) => (p.hand ? E.total(p.hand) : p.handCount);
  const devOf = (p) => (p.dev ? p.dev.length : p.devCount);
  const deckOf = (s) => (s.devDeck ? s.devDeck.length : s.devDeckCount);
  const finalPts = (s, i) => (s.players[i].dev ? E.points(s, i, true) : s.players[i].vp);

  let mode = 'menu';       // menu | local | host | client
  let game = null;         // état complet (local, host) ou vue du joueur + plateau (client)
  let hostNet = null, clientNet = null, activeRoom = null;
  const ui = {
    screen: 'menu', pin: null, mode: null, tradeOpen: false, tab: 'bank', bankGive: null, bankGet: null,
    give: zero(), want: zero(), discard: zero(), pick: null, yop: [], toast: '', confirmNew: false,
    count: 3, names: ['Alice', 'Bruno', 'Chloé', 'David'], diceKey: '', lastTurn: -1,
    code: '', joinCode: '', myName: '', error: '', busy: false,
    seat: -1, boardSeed: null, board: null, conn: 'searching', lobby: [], pending: 0, phoneTab: 'hand', needBoard: false, wasNeed: false, wasMine: false,
  };
  let toastTimer = 0;

  // ---------- Stockage local ----------
  const store = {
    get(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const slim = (g) => Object.assign({}, g, { board: undefined });
  const fat = (g) => { if (g && !g.board) g.board = E.boardFromSeed(g.seed); return g; };
  const validGame = (g) => g && g.players && (g.board || g.seed != null);
  function save() {
    if (mode === 'local') store.set(SAVE_KEY, slim(game));
    else if (mode === 'host') store.set(HOST_KEY, { game: slim(game), seats: hostNet.seats(), code: ui.code });
  }

  // ---------- Actions ----------
  function dispatch(action) {
    if (mode === 'client') return sendFromPhone(action);
    const r = E.apply(game, action);
    if (!r.ok) { say(r.error); return false; }
    game = r.state;
    afterAction(action);
    save();
    render();
    return true;
  }
  function afterAction(action) {
    ui.mode = null;
    ui.pick = null;
    ui.yop = [];
    ui.discard = zero();
    if (action.type === 'bankTrade') { ui.bankGive = null; ui.bankGet = null; }
    else if (action.type === 'offerTrade') { ui.give = zero(); ui.want = zero(); }
    else if (!/Trade$/.test(action.type)) ui.tradeOpen = false;
  }
  function say(msg) {
    ui.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast = ''; renderHand(); }, 3500);
    renderHand();
  }
  // Actions que le téléphone peut montrer tout de suite : elles ne dépendent d'aucun secret (dés, pioche, main des autres).
  // L'hôte tranche ; sa vue remplace de toute façon l'affichage anticipé.
  const ANTICIPATED = new Set(['placeSettlement', 'placeRoad', 'placeCity', 'endTurn', 'bankTrade', 'discard', 'offerTrade', 'cancelTrade', 'respondTrade']);
  function anticipate(action) {
    if (!ANTICIPATED.has(action.type)) return;
    try {
      const r = E.apply(game, Object.assign({}, action, { player: ui.seat }));
      if (r.ok) { r.state.board = ui.board; game = r.state; }
    } catch (e) { /* vue incomplète : on attend l'hôte */ }
  }
  function sendFromPhone(action) {
    if (!clientNet || !game) return false;
    const id = ++ui.pending;
    afterAction(action);
    anticipate(action);
    clientNet.send(Object.assign({}, action, { player: ui.seat })).catch(() => { ui.pending = 0; say('Écran hors ligne.'); });
    setTimeout(() => { if (ui.pending === id) { ui.pending = 0; clientNet.resync(); say('L\'écran n\'a pas répondu, resynchronisation…'); } }, 4000);
    render();
    return true;
  }

  const myPid = () => (mode === 'client' ? ui.seat : game.turn);
  function viewer() {
    if (mode === 'client') return ui.seat;
    if (ui.pin != null && ui.pin < game.players.length) return ui.pin;
    const a = E.actors(game);
    return a.length ? a[0] : game.turn;
  }

  // ---------- Plateau ----------
  const X = (v) => Math.round(v * S * 10) / 10;

  function boardHTML() {
    const s = game, b = s.board;
    const pid = myPid();
    const av = E.available(s, pid);
    let tg = av.targets;
    if (ui.mode && av.myTurn) tg = Object.assign({ vertices: [], edges: [], hexes: [] }, E.targetsFor(s, pid, ui.mode));
    tg = Object.assign({ vertices: [], edges: [], hexes: [] }, tg);
    ui.needBoard = !!(tg.vertices.length || tg.edges.length || tg.hexes.length);
    const out = [];
    out.push('<ellipse cx="0" cy="0" rx="530" ry="490" fill="var(--sea)" stroke="var(--sea-edge)" stroke-width="6"/><ellipse cx="0" cy="0" rx="530" ry="490" fill="url(#waves)"/><ellipse cx="0" cy="0" rx="530" ry="490" fill="url(#seagrad)"/>');

    b.ports.forEach((p) => {
      const bx = X(p.x + p.nx * 0.62), by = X(p.y + p.ny * 0.62);
      [p.a, p.b].forEach((v) => {
        out.push('<line x1="' + bx + '" y1="' + by + '" x2="' + X(b.vertices[v].x) + '" y2="' + X(b.vertices[v].y) + '" stroke="var(--pier)" stroke-width="7" stroke-linecap="round"/>');
      });
      const generic = p.type === 'any';
      out.push('<g transform="translate(' + bx + ' ' + by + ')"><circle r="29" fill="var(--surface)" stroke="var(--pier)" stroke-width="4"/>' +
        (generic
          ? '<text y="7" text-anchor="middle" font-size="19" font-weight="800" fill="var(--ink)" font-family="var(--f-display)">3:1</text>'
          : '<use href="#g-' + p.type + '" x="-13" y="-25" width="26" height="26"/><text y="20" text-anchor="middle" font-size="14" font-weight="800" fill="var(--ink)" font-family="var(--f-display)">2:1</text>') +
        '</g>');
    });

    b.hexes.forEach((h) => {
      const pts = h.vertices.map((v) => X(b.vertices[v].x) + ',' + X(b.vertices[v].y)).join(' ');
      const cx = X(h.x), cy = X(h.y);
      const g = GLYPH[h.terrain];
      const flip = (h.id * 7 + h.q * 3 + h.r) % 2 ? ' scale(-1 1)' : '';
      out.push('<g transform="translate(' + cx + ' ' + cy + ')"><g clip-path="url(#hexclip)"><g transform="scale(1)' + flip + '"><use href="#t-' + h.terrain + '"/></g><rect x="-100" y="-100" width="200" height="200" fill="url(#hexshade)"/></g>' +
        '<polygon points="86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50 0,-100" transform="scale(.94)" fill="none" stroke="#1b2a30" stroke-opacity=".18" stroke-width="2.4" stroke-linejoin="round"/></g>');
      out.push('<polygon points="' + pts + '" fill="none" stroke="#fffaf0" stroke-width="5.5" stroke-linejoin="round"/>');
      if (h.number) {
        out.push('<circle cx="' + cx + '" cy="' + (cy - 46) + '" r="21" fill="#fffaf0" fill-opacity=".92"/><use href="#g-' + g + '" x="' + (cx - 18) + '" y="' + (cy - 64) + '" width="36" height="36"/>');
        const hot = h.number === 6 || h.number === 8;
        const pips = 6 - Math.abs(7 - h.number);
        out.push('<g transform="translate(' + cx + ' ' + (cy + 20) + ')"><circle cx="2" cy="3" r="30" fill="#1b2a30" fill-opacity=".28"/><circle r="30" fill="url(#tokengrad)" stroke="#1b1b1b" stroke-opacity=".3" stroke-width="2"/>' +
          '<text y="5" text-anchor="middle" font-size="28" font-weight="800" font-family="var(--f-display)" fill="' + (hot ? '#c2281a' : '#1b1b1b') + '">' + h.number + '</text>' +
          '<g fill="' + (hot ? '#c2281a' : '#1b1b1b') + '">' +
          Array.from({ length: pips }, (_, i) => '<circle cx="' + ((i - (pips - 1) / 2) * 6.4) + '" cy="17" r="2.3"/>').join('') +
          '</g></g>');
      } else {
        out.push('<circle cx="' + cx + '" cy="' + (cy - 4) + '" r="26" fill="#fffaf0" fill-opacity=".9"/><use href="#g-' + g + '" x="' + (cx - 22) + '" y="' + (cy - 26) + '" width="44" height="44"/>');
      }
    });

    Object.keys(s.roads).forEach((k) => {
      const e = b.edges[+k], A = b.vertices[e.a], B = b.vertices[e.b];
      const ax = X(A.x + (B.x - A.x) * 0.14), ay = X(A.y + (B.y - A.y) * 0.14);
      const bx = X(A.x + (B.x - A.x) * 0.86), by = X(A.y + (B.y - A.y) * 0.86);
      out.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '" stroke="#1b1b1b" stroke-width="15" stroke-linecap="round"/>');
      out.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '" stroke="' + pcolor(s.roads[k]) + '" stroke-width="9" stroke-linecap="round"/>');
    });

    tg.hexes.forEach((id) => {
      const h = b.hexes[id];
      const pts = h.vertices.map((v) => X(b.vertices[v].x) + ',' + X(b.vertices[v].y)).join(' ');
      out.push('<polygon class="tgt-h" data-h="' + id + '" points="' + pts + '"/>');
    });
    tg.edges.forEach((id) => {
      const e = b.edges[id], A = b.vertices[e.a], B = b.vertices[e.b];
      const c = ' x1="' + X(A.x + (B.x - A.x) * 0.16) + '" y1="' + X(A.y + (B.y - A.y) * 0.16) + '" x2="' + X(A.x + (B.x - A.x) * 0.84) + '" y2="' + X(A.y + (B.y - A.y) * 0.84) + '"';
      out.push('<line class="tgt-e"' + c + '/><line class="hit hit-e" data-e="' + id + '"' + c + '/>');
    });

    Object.keys(s.buildings).forEach((k) => {
      const v = b.vertices[+k], bd = s.buildings[k];
      const d = bd.type === 'city'
        ? 'M-15 10V-2H-6V-12L2-19 10-12V-2H15V10Z'
        : 'M-11 10V-2L0-13 11-2V10Z';
      out.push('<g transform="translate(' + X(v.x) + ' ' + X(v.y) + ') scale(1.25)"><path class="piece" d="' + d + '" fill="' + pcolor(bd.owner) + '"/></g>');
    });

    tg.vertices.forEach((id) => {
      const v = b.vertices[id];
      out.push('<circle class="tgt" cx="' + X(v.x) + '" cy="' + X(v.y) + '" r="26"/><circle class="hit" data-v="' + id + '" cx="' + X(v.x) + '" cy="' + X(v.y) + '" r="58"/>');
    });

    const rh = b.hexes[s.robber];
    out.push('<g transform="translate(' + (X(rh.x) + 44) + ' ' + (X(rh.y) + 4) + ')" pointer-events="none"><path d="M-14 22Q-14-6 0-9Q14-6 14 22Z" fill="#23262b" stroke="#fffaf0" stroke-width="3"/><circle cy="-22" r="11" fill="#23262b" stroke="#fffaf0" stroke-width="3"/></g>');
    return out.join('');
  }

  function bannerHTML() {
    const s = game;
    const who = s.players[s.turn];
    let txt;
    if (mode === 'client') {
      txt = hintText(s, ui.seat, E.available(s, ui.seat)).t;
    } else if (s.phase === 'ended') txt = who.name + ' a gagné';
    else if (s.phase === 'setup') txt = who.name + ' · ' + (s.step === 'settlement' ? 'pose une colonie' : 'pose une route');
    else {
      const map = { roll: 'lance les dés', discard: 'attend les défausses', robber: 'déplace le voleur', steal: 'choisit qui voler', actions: 'joue son tour', roadBuilding: 'pose ses routes' };
      txt = who.name + ' · ' + (map[s.step] || '');
    }
    let dice = '';
    if (s.dice) {
      const key = s.turnNo + ':' + s.dice.join(',');
      const fresh = key !== ui.diceKey;
      ui.diceKey = key;
      dice = '<div class="dice' + (fresh ? ' rolled' : '') + '" aria-label="Dés"><span class="die">' + s.dice[0] + '</span><span class="die">' + s.dice[1] + '</span><span class="sum">' + (s.dice[0] + s.dice[1]) + '</span></div>';
    }
    const cancel = mode === 'client' && ui.mode ? '<button class="btn small" data-act="mode" data-k="' + ui.mode + '">Annuler</button>' : '';
    return '<div class="say"><span class="dot" style="--pc:' + pcolor(s.turn) + '"></span>' + esc(txt) + '</div>' + cancel + dice;
  }

  // ---------- Scores ----------
  function onlineSeats() {
    const on = new Set();
    if (mode === 'host' && hostNet) hostNet.lobby().forEach((p) => { if (p.seat !== undefined) on.add(p.seat); });
    return on;
  }
  function scoresHTML() {
    const s = game, v = mode === 'host' ? -1 : viewer();
    const on = onlineSeats();
    const rows = s.players.map((p, i) => {
      const badges = (s.longestRoad.holder === i ? '<span class="badge">Plus longue route</span>' : '') +
        (s.largestArmy.holder === i ? '<span class="badge">Plus grande armée</span>' : '') +
        (mode === 'host' && !on.has(i) ? '<span class="badge off">Hors ligne</span>' : '');
      const tag = mode === 'local' && i === v ? ' <small>(affiché)</small>' : (mode === 'client' && i === v ? ' <small>(toi)</small>' : '');
      return '<li class="pl' + (i === s.turn && s.phase !== 'ended' ? ' turn' : '') + '" style="--pc:' + pcolor(i) + '">' +
        '<span class="dot"></span><b>' + esc(p.name) + tag + '</b><span class="pts" title="Points visibles">' + E.points(s, i, false) + '</span>' +
        '<span class="meta"><span>' + cardsOf(p) + ' cartes</span><span>' + devOf(p) + ' dév.</span><span>' + p.knights + ' chevalier' + (p.knights > 1 ? 's' : '') + '</span><span>route ' + (p.roadLen || 0) + '</span>' + badges + '</span></li>';
    }).join('');
    const bank = RES.map((r) => '<span title="' + NAME[r] + '">' + icon(r, 'mini') + s.bank[r] + '</span>').join('');
    return '<h2>Joueurs · objectif ' + E.WIN_POINTS + ' points</h2><ul class="players">' + rows + '</ul>' +
      '<div class="bank"><b>Banque</b>' + bank + '<span>cartes dév. ' + deckOf(s) + '</span></div>';
  }

  // ---------- Main du joueur ----------
  function hintText(s, v, av) {
    const turnName = s.players[s.turn].name;
    if (s.phase === 'ended') return { t: s.players[s.winner].name + ' remporte la partie.', go: false };
    if (s.phase === 'setup') {
      if (s.turn !== v) return { t: 'Mise en place : au tour de ' + turnName + '.', go: false };
      return av.setupSettlement
        ? { t: 'Pose ta colonie sur un point lumineux du plateau.', go: true }
        : { t: 'Pose une route à côté de ta colonie.', go: true };
    }
    if (s.step === 'discard') {
      if (av.discard) return { t: 'Un 7 ! Défausse ' + av.discard + ' cartes.', go: true };
      const who = Object.keys(s.discard).map((k) => s.players[+k].name).join(', ');
      return { t: 'Un 7 : ' + who + ' défausse.', go: false };
    }
    if (s.step === 'robber') return s.turn === v ? { t: 'Déplace le voleur : touche un hexagone.', go: true } : { t: turnName + ' déplace le voleur.', go: false };
    if (s.step === 'steal') return s.turn === v ? { t: 'Choisis à qui voler une carte.', go: true } : { t: turnName + ' choisit sa victime.', go: false };
    if (s.step === 'roadBuilding') return s.turn === v ? { t: 'Pose encore ' + s.freeRoads + ' route' + (s.freeRoads > 1 ? 's' : '') + ' gratuite' + (s.freeRoads > 1 ? 's' : '') + '.', go: true } : { t: turnName + ' pose des routes.', go: false };
    if (s.turn !== v) return { t: 'Au tour de ' + turnName + '.', go: false };
    if (s.step === 'roll') return { t: 'À toi de jouer : lance les dés.', go: true };
    if (ui.mode) return { t: 'Touche un emplacement lumineux sur le plateau.', go: true };
    return { t: s.players[v].name + ', construis, échange ou termine ton tour.', go: false };
  }

  function tradeHTML(s, v, av) {
    const t = s.trade;
    const me = s.players[v];
    const tab = t && t.from === v ? 'players' : ui.tab;
    let html = '<div class="sheet"><div class="tabs">' +
      '<button class="btn" data-act="tab" data-k="bank" aria-pressed="' + (tab === 'bank') + '">Banque</button>' +
      '<button class="btn" data-act="tab" data-k="players" aria-pressed="' + (tab === 'players') + '">Joueurs</button></div>';
    if (tab === 'bank') {
      html += '<div class="section-title">Je donne</div><div class="picks">' + RES.map((r) =>
        '<button class="pick" data-act="bank-give" data-r="' + r + '" aria-pressed="' + (ui.bankGive === r) + '"' + (me.hand[r] >= av.ratios[r] ? '' : ' disabled') + '>' +
        icon(r) + av.ratios[r] + ' pour 1<small>' + me.hand[r] + ' en main</small></button>').join('') + '</div>';
      html += '<div class="section-title">Je reçois</div><div class="picks">' + RES.map((r) =>
        '<button class="pick" data-act="bank-get" data-r="' + r + '" aria-pressed="' + (ui.bankGet === r) + '"' + (s.bank[r] > 0 && r !== ui.bankGive ? '' : ' disabled') + '>' +
        icon(r) + NAME[r] + '<small>banque ' + s.bank[r] + '</small></button>').join('') + '</div>';
      html += '<button class="btn primary" data-act="bank-do"' + (ui.bankGive && ui.bankGet ? '' : ' disabled') + '>Échanger avec la banque</button>';
    } else if (t && t.from === v) {
      html += '<div class="offer"><div class="line">Tu proposes ' + bundle(t.give) + ' contre ' + bundle(t.want) + '</div>';
      s.players.forEach((p) => {
        if (p.id === v) return;
        const r = t.responses[p.id];
        html += '<div class="resp"><span><span class="dot" style="--pc:' + pcolor(p.id) + '"></span> ' + esc(p.name) + '</span>' +
          (r === true ? '<span class="st yes">Accepte</span><button class="btn small primary" data-act="confirm" data-with="' + p.id + '">Conclure</button>'
            : r === false ? '<span class="st no">Refuse</span>' : '<span class="st">En attente…</span>') + '</div>';
      });
      html += '<button class="btn small" data-act="cancel-offer">Retirer l\'offre</button></div>';
    } else {
      const block = (key, title, max) => '<div class="section-title">' + title + '</div><div class="stepper-grid">' + RES.map((r) =>
        '<div class="stepper">' + icon(r) + '<span class="nm">' + NAME[r] + '</span>' +
        '<button class="btn" data-act="step" data-set="' + key + '" data-r="' + r + '" data-d="-1" aria-label="Moins de ' + NAME[r] + '"' + (ui[key][r] > 0 ? '' : ' disabled') + '>−</button>' +
        '<b>' + ui[key][r] + '</b>' +
        '<button class="btn" data-act="step" data-set="' + key + '" data-r="' + r + '" data-d="1" aria-label="Plus de ' + NAME[r] + '"' + (ui[key][r] < max(r) ? '' : ' disabled') + '>+</button></div>').join('') + '</div>';
      html += block('give', 'Je donne', (r) => me.hand[r]) + block('want', 'Je demande', () => 9);
      const ok = sum(ui.give) > 0 && sum(ui.want) > 0 && !RES.some((r) => ui.give[r] > 0 && ui.want[r] > 0);
      html += '<button class="btn primary" data-act="offer"' + (ok ? '' : ' disabled') + '>Proposer aux autres joueurs</button>';
    }
    return html + '</div>';
  }

  function incomingOffer(s, v) {
    const t = s.trade;
    if (!t || t.from === v || s.phase !== 'main') return '';
    const me = s.players[v];
    const can = RES.every((r) => me.hand[r] >= t.want[r]);
    const r = t.responses[v];
    return '<div class="offer"><div class="line"><span class="dot" style="--pc:' + pcolor(t.from) + '"></span>' + esc(s.players[t.from].name) + ' donne ' + bundle(t.give) + ' contre ' + bundle(t.want) + '</div>' +
      (r === undefined ? '' : '<div class="resp"><span class="st ' + (r ? 'yes' : 'no') + '">Tu as ' + (r ? 'accepté' : 'refusé') + '</span></div>') +
      '<div class="row"><button class="btn primary" data-act="respond" data-a="1"' + (can ? '' : ' disabled') + '>Accepter</button><button class="btn" data-act="respond" data-a="0">Refuser</button></div>' +
      (can ? '' : '<div class="st">Il te manque des cartes pour accepter.</div>') + '</div>';
  }

  function needsMe(s, v) {
    if (!s || s.phase === 'ended' || v < 0) return false;
    const av = E.available(s, v);
    return !!(av.roll || av.discard || av.setupSettlement || av.setupRoad || av.moveRobber || av.steal || av.freeRoad ||
      (s.trade && s.trade.from !== v && s.trade.responses[v] === undefined && s.phase === 'main'));
  }

  function handHTML() {
    const s = game, v = viewer();
    const me = s.players[v];
    const av = E.available(s, v);
    const hint = hintText(s, v, av);
    const chips = mode === 'local' ? '<div class="chips" role="group" aria-label="Changer de joueur affiché">' + s.players.map((p, i) => {
      const alert = (s.step === 'discard' && s.discard[i]) || (s.trade && s.trade.from !== i && s.trade.responses[i] === undefined && s.phase === 'main');
      return '<button class="chip" data-act="view" data-i="' + i + '" aria-pressed="' + (i === v) + '"><span class="dot" style="--pc:' + pcolor(i) + '"></span>' + esc(p.name) + (alert ? '<span class="alert" title="Doit agir"></span>' : '') + '</button>';
    }).join('') + '</div>' : '';
    let html = '<div class="hand-head"><span class="dot" style="--pc:' + pcolor(v) + '"></span><h2>' + (mode === 'client' ? esc(me.name) : 'Main de ' + esc(me.name)) + '</h2>' +
      (ui.pending ? '<span class="sending" aria-label="Envoi en cours">…</span>' : '') +
      '<span class="vp">' + E.points(s, v, true) + '<small>pts</small></span></div>' + chips +
      '<p class="hint' + (hint.go ? ' go' : '') + '" role="status">' + esc(hint.t) + '</p>';

    html += incomingOffer(s, v);

    html += '<div class="tiles" aria-label="Ressources">' + RES.map((r) =>
      '<div class="tile' + (me.hand[r] ? '' : ' zero') + '">' + icon(r) + '<b>' + me.hand[r] + '</b><span>' + NAME[r] + '</span></div>').join('') + '</div>';

    if (av.roll) html += '<button class="btn primary big" data-act="roll">Lancer les dés</button>';
    if (av.discard) {
      const n = sum(ui.discard);
      html += '<div class="sheet"><div class="section-title">Défausse ' + av.discard + ' cartes (' + n + ' choisies)</div><div class="stepper-grid">' + RES.map((r) =>
        '<div class="stepper">' + icon(r) + '<span class="nm">' + NAME[r] + '</span>' +
        '<button class="btn" data-act="step" data-set="discard" data-r="' + r + '" data-d="-1"' + (ui.discard[r] > 0 ? '' : ' disabled') + '>−</button><b>' + ui.discard[r] + '</b>' +
        '<button class="btn" data-act="step" data-set="discard" data-r="' + r + '" data-d="1"' + (ui.discard[r] < me.hand[r] && n < av.discard ? '' : ' disabled') + '>+</button></div>').join('') +
        '</div><button class="btn primary" data-act="discard"' + (n === av.discard ? '' : ' disabled') + '>Défausser</button></div>';
    }
    if (av.steal) {
      html += '<div class="row">' + av.steal.map((i) => '<button class="btn" data-act="steal" data-i="' + i + '"><span class="dot" style="--pc:' + pcolor(i) + '"></span>Voler à ' + esc(s.players[i].name) + '</button>').join('') + '</div>';
    }

    const kinds = {};
    me.dev.forEach((c) => {
      const k = kinds[c.k] || (kinds[c.k] = { n: 0, ready: 0 });
      k.n++;
      if (c.t < s.turnNo) k.ready++;
    });
    const kindKeys = Object.keys(kinds);
    if (kindKeys.length) {
      html += '<div class="section-title">Cartes de développement</div><div class="devs">' + kindKeys.map((k) => {
        const info = kinds[k];
        const playable = k !== 'vp' && av.dev[k];
        const note = k === 'vp' ? DEV_HELP.vp : (info.ready < info.n ? 'Achetée ce tour, jouable au prochain. ' : '') + DEV_HELP[k];
        return '<div class="dev"><span class="cnt">' + info.n + '</span><span class="nm">' + E.DEV_FR[k] + '<small>' + note + '</small></span>' +
          (k === 'vp' ? '' : '<button class="btn small" data-act="dev" data-k="' + k + '"' + (playable ? '' : ' disabled') + '>Jouer</button>') + '</div>';
      }).join('') + '</div>';
    }
    if (ui.pick === 'yop' || ui.pick === 'mono') {
      const left = Object.assign({}, s.bank);
      ui.yop.forEach((r) => { left[r]--; });
      html += '<div class="sheet"><div class="section-title">' + (ui.pick === 'yop' ? 'Invention : choisis ' + (2 - ui.yop.length) + ' carte(s)' : 'Monopole : quelle ressource ?') + '</div><div class="picks">' +
        RES.map((r) => '<button class="pick" data-act="pick-res" data-r="' + r + '"' + (ui.pick === 'yop' && left[r] < 1 ? ' disabled' : '') + '>' + icon(r) + NAME[r] + '</button>').join('') +
        '</div><button class="btn small" data-act="pick-cancel">Annuler</button></div>';
    }

    if (av.myTurn && s.phase === 'main' && s.step === 'actions') {
      const b = (k, label, cost, on) => '<button class="btn build" data-act="mode" data-k="' + k + '" aria-pressed="' + (ui.mode === k) + '"' + (on ? '' : ' disabled') + '><span>' + label + '</span><span class="cost">' + costIcons(cost) + '</span></button>';
      html += '<div class="section-title">Construire</div><div class="builds">' +
        b('road', 'Route', E.COST.road, av.road) + b('settlement', 'Colonie', E.COST.settlement, av.settlement) +
        b('city', 'Ville', E.COST.city, av.city) +
        '<button class="btn build" data-act="buy"' + (av.buyDev ? '' : ' disabled') + '><span>Carte dév.</span><span class="cost">' + costIcons(E.COST.dev) + '</span></button></div>';
      if (ui.mode) html += '<button class="btn small" data-act="mode" data-k="' + ui.mode + '">Annuler la construction</button>';
      html += '<button class="btn" data-act="trade-toggle" aria-expanded="' + ui.tradeOpen + '">' + (ui.tradeOpen ? 'Fermer le commerce' : 'Commerce') + '</button>';
      if (ui.tradeOpen) html += tradeHTML(s, v, av);
      html += '<button class="btn primary" data-act="end">Terminer mon tour</button>';
    } else if (s.phase === 'main' && s.trade && s.trade.from === v) {
      html += tradeHTML(s, v, av);
    }

    if (ui.toast) html += '<div class="toast" role="alert">' + esc(ui.toast) + '</div>';
    return html;
  }

  function logHTML() {
    const lines = game.log.slice(-60).map((l) => '<li>' + esc(l) + '</li>').join('');
    return '<h2>Journal</h2><ol>' + lines + '</ol>';
  }

  function overHTML() {
    const s = game;
    if (s.phase !== 'ended') return '';
    const order = s.players.map((p, i) => ({ p, i, pts: finalPts(s, i) })).sort((a, b) => b.pts - a.pts);
    const again = mode === 'client' ? '<button class="btn big" data-act="leave">Quitter la partie</button>' : '<button class="btn primary big" data-act="new-go">Nouvelle partie</button>';
    return '<div class="over"><div class="card"><h2>' + esc(s.players[s.winner].name) + ' gagne !</h2><ol>' +
      order.map((o) => '<li><span class="dot" style="--pc:' + pcolor(o.i) + '"></span><b>' + esc(o.p.name) + '</b><span>' + o.pts + ' pts</span></li>').join('') +
      '</ol>' + again + '</div></div>';
  }

  // ---------- Accueil, salon, jonction ----------
  function qrSvg(text) {
    try {
      if (!window.qrcode) return '';
      const q = window.qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) { return ''; }
  }
  // Le QR code ouvre le bon lien : le site lui-même, avec le code de la salle déjà rempli.
  const joinUrl = () => (inArtifact() ? ARTIFACT_URL + '#joueur' : location.href.split('#')[0] + '#j=' + ui.code);
  const shortUrl = () => (inArtifact() ? ARTIFACT_URL : location.href.split('#')[0].replace(/^https?:\/\//, '').replace(/\/$/, ''));

  function menuHTML() {
    const saved = store.get(SAVE_KEY);
    const savedHost = store.get(HOST_KEY);
    let html = '<h2>Une île, cinq ressources, dix points</h2><p>Construis des routes, des colonies et des villes. Le premier à ' + E.WIN_POINTS + ' points gagne.</p><div class="modes">';
    if (savedHost && savedHost.game && savedHost.game.phase !== 'ended') {
      html += '<button class="mode-card resume" data-act="host-resume"><b>Reprendre la partie en ligne</b><span>Salle ' + esc(savedHost.code) + ' · ' + savedHost.game.players.map((p) => esc(p.name)).join(', ') + '</span></button>';
    }
    if (saved && saved.players && saved.phase !== 'ended') {
      html += '<button class="mode-card resume" data-act="resume"><b>Reprendre la partie sur un écran</b><span>' + saved.players.map((p) => esc(p.name)).join(', ') + '</span></button>';
    }
    html += '<button class="mode-card" data-act="goto" data-s="host"><b>Plateau sur cet écran</b><span>Ordinateur ou télé. Chaque joueur voit sa main sur son téléphone.</span></button>' +
      '<button class="mode-card" data-act="goto" data-s="join"><b>Rejoindre depuis mon téléphone</b><span>Entre le code affiché sur l\'écran du plateau.</span></button>' +
      '<button class="mode-card" data-act="goto" data-s="setup"><b>Un seul écran pour tous</b><span>On se passe l\'appareil, sans téléphones.</span></button></div>';
    return html;
  }

  function setupHTML() {
    return '<button class="btn small back" data-act="goto" data-s="menu">← Retour</button><h2>Partie sur un seul écran</h2>' +
      '<div><div class="section-title">Nombre de joueurs</div><div class="seg" role="group">' +
      [2, 3, 4].map((n) => '<button class="btn" data-act="count" data-n="' + n + '" aria-pressed="' + (ui.count === n) + '">' + n + '</button>').join('') + '</div></div>' +
      '<div class="names">' + Array.from({ length: ui.count }, (_, i) =>
        '<label class="name-row" style="--pc:' + pcolor(i) + '"><span class="dot"></span><span class="sr">Nom du joueur ' + (i + 1) + '</span>' +
        '<input id="name' + i + '" type="text" maxlength="14" value="' + esc(ui.names[i]) + '" autocomplete="off"><small>' + COLOR_FR[i] + '</small></label>').join('') + '</div>' +
      '<button class="btn primary big" data-act="start">Lancer la partie</button>';
  }

  function hostLobbyHTML() {
    const players = hostNet ? hostNet.lobby() : [];
    const qr = qrSvg(joinUrl());
    let html = '<button class="btn small back" data-act="host-cancel">← Annuler</button><h2>Salle de jeu</h2>';
    if (ui.error) return html + '<p class="hint err">' + esc(ui.error) + '</p>';
    html += '<div class="lobby"><div class="codebox"><span class="section-title">Code de la partie</span><b class="code" aria-label="Code">' + esc(ui.code) + '</b></div>' +
      (qr ? '<div class="qr" role="img" aria-label="QR code pour rejoindre">' + qr + '</div>' : '') + '</div>' +
      '<ol class="steps"><li>Scanne le QR code avec l\'appareil photo du téléphone, ou ouvre <span class="mono">' + esc(shortUrl()) + '</span></li><li>Si le code n\'est pas déjà rempli, choisis « Rejoindre depuis mon téléphone » et entre <b>' + esc(ui.code) + '</b></li><li>Entre ton prénom et touche « Rejoindre »</li></ol>';
    html += '<div><div class="section-title">Joueurs connectés (' + players.length + '/4)</div><ul class="players">' + (players.length ? players.slice(0, 4).map((p, i) =>
      '<li class="pl" style="--pc:' + pcolor(i) + '"><span class="dot"></span><b>' + esc(p.name) + '</b><span class="meta">' + COLOR_FR[i] + '</span></li>').join('') : '<li class="pl empty">En attente des téléphones…</li>') + '</ul>' +
      (players.length > 4 ? '<p class="note">Seuls les 4 premiers arrivés joueront.</p>' : '') + '</div>';
    html += '<button class="btn primary big" data-act="host-start"' + (players.length >= 2 ? '' : ' disabled') + '>Lancer la partie</button>' +
      (inArtifact() ? '<p class="note">Les joueurs doivent avoir accès à l\'artefact (partage avec droit de contribution). Ne republie pas la page pendant une partie : cela déconnecte tout le monde.</p>' : '<p class="note">Aucun compte à créer. Les échanges entre appareils sont chiffrés : le serveur de salle ne voit passer que des messages illisibles.</p>');
    return html;
  }

  function joinHTML() {
    const w = ui.conn;
    if (mode === 'client') {
      let msg = '';
      if (w === 'searching') msg = 'Recherche de l\'écran du plateau, salle ' + esc(ui.joinCode) + '…';
      else if (w === 'found') msg = 'Écran trouvé, connexion sécurisée…';
      else if (w === 'lobby') msg = 'Tu es dans la salle. La partie va bientôt commencer.';
      else if (w === 'full') msg = 'Cette partie a déjà commencé et n\'a pas de place pour toi.';
      return '<h2>Salle ' + esc(ui.joinCode) + '</h2><p class="hint go" role="status">' + msg + '</p>' +
        (ui.lobby.length ? '<div><div class="section-title">Dans la salle</div><ul class="players">' + ui.lobby.map((n, i) => '<li class="pl" style="--pc:' + pcolor(i % 4) + '"><span class="dot"></span><b>' + esc(n) + '</b></li>').join('') + '</ul></div>' : '') +
        '<button class="btn" data-act="leave">Changer de salle</button>';
    }
    return '<button class="btn small back" data-act="goto" data-s="menu">← Retour</button><h2>Rejoindre une partie</h2>' +
      (ui.error ? '<p class="hint err">' + esc(ui.error) + '</p>' : '') +
      '<label class="field"><span class="section-title">Code de la partie</span><input id="joinCode" class="code-input" type="text" maxlength="4" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" value="' + esc(ui.joinCode) + '" placeholder="K7QM"></label>' +
      '<label class="field"><span class="section-title">Ton prénom</span><input id="joinName" type="text" maxlength="14" autocomplete="off" value="' + esc(ui.myName) + '" placeholder="Prénom"></label>' +
      '<button class="btn primary big" data-act="join"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Connexion…' : 'Rejoindre') + '</button>';
  }

  function welcomeHTML() {
    if (ui.screen === 'setup') return setupHTML();
    if (ui.screen === 'host') return hostLobbyHTML();
    if (ui.screen === 'join') return joinHTML();
    return menuHTML();
  }

  // ---------- Rendu ----------
  function renderTop() {
    let h = '';
    if (game && mode === 'client') h = '<span class="conn' + (ui.conn === 'playing' ? ' on' : '') + '" title="' + (ui.conn === 'playing' ? 'Connecté' : 'Connexion perdue') + '">' + (ui.conn === 'playing' ? 'En ligne' : 'Hors ligne') + '</span><button class="btn small" data-act="leave">Quitter</button>';
    else if (game && ui.confirmNew) h = '<button class="btn small danger" data-act="new-go">Abandonner la partie</button><button class="btn small" data-act="new-cancel">Continuer</button>';
    else if (game) h = '<button class="btn small" data-act="new">Nouvelle partie</button>';
    $('topActions').innerHTML = h;
  }
  function renderHand() {
    if (game && mode !== 'host') $('hand').innerHTML = handHTML();
  }
  function renderWelcome() {
    if (!game) $('welcome').innerHTML = welcomeHTML();
  }
  function renderNav() {
    const nav = $('nav');
    nav.hidden = !(game && mode === 'client');
    if (nav.hidden) return;
    const mine = needsMe(game, ui.seat);
    nav.innerHTML = [['hand', 'Ma main', mine], ['board', 'Plateau', false], ['info', 'Joueurs', false]].map((t) =>
      '<button class="nav-btn" data-act="phone-tab" data-k="' + t[0] + '" aria-pressed="' + (ui.phoneTab === t[0]) + '">' + t[1] + (t[2] ? '<span class="alert"></span>' : '') + '</button>').join('');
  }
  function render() {
    renderTop();
    $('welcome').hidden = !!game;
    $('game').hidden = !game;
    document.body.classList.toggle('is-client', !!game && mode === 'client');
    if (!game) { renderWelcome(); renderNav(); return; }
    const g = $('game');
    g.className = 'layout ' + mode;
    if (mode === 'local' && game.turn !== ui.lastTurn) { ui.pin = null; ui.lastTurn = game.turn; }
    $('board').innerHTML = boardHTML();
    if (mode === 'client') {
      const mine = needsMe(game, ui.seat);
      if (ui.needBoard && !ui.wasNeed) ui.phoneTab = 'board';
      if (!ui.needBoard && ui.wasNeed && ui.phoneTab === 'board') ui.phoneTab = 'hand';
      ui.wasNeed = ui.needBoard;
      if (mine && !ui.wasMine) { try { if (navigator.vibrate) navigator.vibrate(180); } catch (e) { /* non pris en charge */ } }
      ui.wasMine = mine;
      g.dataset.tab = ui.phoneTab;
    }
    $('banner').innerHTML = bannerHTML();
    if (mode !== 'host') {
      $('hand').style.setProperty('--pc', pcolor(viewer()));
      renderHand();
    }
    $('scores').innerHTML = scoresHTML();
    $('log').innerHTML = logHTML();
    const over = $('over');
    over.innerHTML = overHTML();
    over.hidden = game.phase !== 'ended';
    renderNav();
  }

  // ---------- Parties locales ----------
  const newSeed = () => (Date.now() ^ Math.floor(performance.now() * 1000) ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
  function startLocal() {
    const names = [];
    for (let i = 0; i < ui.count; i++) {
      const el = $('name' + i);
      const v = (el ? el.value : ui.names[i]).trim() || ui.names[i];
      ui.names[i] = v;
      names.push(v);
    }
    game = E.newGame({ names, seed: newSeed() });
    mode = 'local';
    ui.pin = null; ui.mode = null; ui.lastTurn = -1; ui.diceKey = ''; ui.tradeOpen = false; ui.confirmNew = false;
    save();
    render();
  }

  // ---------- Salle en ligne ----------
  // Dans un artefact : capacité `room`. Sur un site : courtier MQTT public (src/mqtt-room.js).
  const inArtifact = () => !!(window.claude && window.claude.use);
  async function openRoom(code) {
    const cap = inArtifact() ? await window.claude.use('room') : null;
    if (cap) return cap.join('colons-' + code.toLowerCase());
    if (window.MqttRoom) {
      try { return await window.MqttRoom.join(code); } catch (e) {
        throw new Error('Impossible de joindre le serveur de salle. Vérifie ta connexion et réessaie.');
      }
    }
    throw new Error('Le mode en ligne n\'est pas disponible ici.');
  }
  const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

  async function hostOpen(resume) {
    ui.error = '';
    ui.screen = 'host';
    const saved = resume ? store.get(HOST_KEY) : null;
    ui.code = saved ? saved.code : makeCode();
    render();
    try {
      if (!N.available()) throw new Error('Ce navigateur ne permet pas le chiffrement nécessaire au mode en ligne.');
      activeRoom = await openRoom(ui.code);
      const identity = await N.newIdentity();
      hostNet = N.createHost({
        room: activeRoom, identity, seats: saved ? saved.seats : {},
        viewOf: (seat) => E.viewFor(game, seat, { board: false, log: 14 }),
        onAct: hostAct,
        onLobby: () => { if (!game) renderWelcome(); else $('scores').innerHTML = scoresHTML(); },
      });
      if (saved) {
        game = fat(saved.game);
        mode = 'host';
        hostNet.setStatus('play');
        ui.lastTurn = -1;
        render();
      } else renderWelcome();
    } catch (e) {
      ui.error = e && e.message ? e.message : 'Impossible d\'ouvrir la salle.';
      renderWelcome();
    }
  }
  function hostAct(seat, action) {
    if (!game || mode !== 'host' || !action || typeof action.type !== 'string') return 'Pas de partie en cours.';
    const r = E.apply(game, Object.assign({}, action, { player: seat }));
    if (!r.ok) return r.error;
    game = r.state;
    hostNet.publish();                       // d'abord répondre aux téléphones…
    setTimeout(() => { save(); render(); }, 0); // …puis redessiner l'écran
    return null;
  }
  function hostStart() {
    const players = hostNet.lobby().slice(0, 4);
    if (players.length < 2) return;
    game = E.newGame({ names: players.map((p) => p.name), seed: newSeed() });
    const seats = {};
    players.forEach((p, i) => { seats[p.pub] = i; });
    hostNet.setSeats(seats);
    mode = 'host';
    ui.lastTurn = -1; ui.diceKey = '';
    save();
    hostNet.setStatus('play');
    render();
  }
  function hostClose(clear) {
    if (hostNet) { hostNet.close(); hostNet = null; }
    if (activeRoom) { activeRoom.leave().catch(() => {}); activeRoom = null; }
    if (clear) store.del(HOST_KEY);
    game = null; mode = 'menu'; ui.screen = 'menu'; ui.error = '';
    render();
  }
  function hostNewGame() {
    store.del(HOST_KEY);
    game = null; mode = 'menu';
    ui.screen = 'host'; ui.confirmNew = false;
    hostNet.setSeats({});
    hostNet.setStatus('lobby');
    render();
  }

  async function joinGame() {
    const code = ($('joinCode').value || '').trim().toUpperCase();
    const name = ($('joinName').value || '').trim();
    ui.joinCode = code; ui.myName = name; ui.error = '';
    if (code.length !== 4) { ui.error = 'Le code a 4 caractères.'; renderWelcome(); return; }
    if (!name) { ui.error = 'Entre ton prénom.'; renderWelcome(); return; }
    ui.busy = true; renderWelcome();
    try {
      if (!N.available()) throw new Error('Ce navigateur ne permet pas le chiffrement nécessaire au mode en ligne.');
      const room = await openRoom(code);
      const saved = store.get(CLIENT_KEY);
      let identity = null;
      if (saved && saved.identity) { try { identity = await N.restoreIdentity(saved.identity); } catch (e) { identity = null; } }
      if (!identity) identity = await N.newIdentity();
      store.set(CLIENT_KEY, { identity: { pub: identity.pub, jwk: identity.jwk }, name, code });
      activeRoom = room;
      mode = 'client';
      ui.conn = 'searching'; ui.lobby = []; ui.seat = -1; ui.boardSeed = null;
      clientNet = N.createClient({
        room, identity, name,
        onView: onPhoneView,
        onStatus: (s) => {
          ui.conn = s;
          if (s === 'lobby' || s === 'full') { game = null; ui.seat = -1; }
          if (game) { renderTop(); $('banner').innerHTML = bannerHTML(); } else render();
        },
        onLobby: (names) => { ui.lobby = names; if (!game) renderWelcome(); },
        onError: (text) => { ui.pending = 0; say(text); },
      });
      ui.busy = false;
      render();
    } catch (e) {
      ui.busy = false; mode = 'menu';
      ui.error = e && e.message ? e.message : 'Impossible de rejoindre la salle.';
      renderWelcome();
    }
  }
  function onPhoneView(p) {
    const view = p.view;
    if (ui.boardSeed !== view.seed || !ui.board) { ui.board = E.boardFromSeed(view.seed); ui.boardSeed = view.seed; }
    view.board = ui.board;
    game = view;
    ui.seat = p.seat;
    ui.pending = 0;
    render();
  }
  function leaveGame() {
    if (clientNet) { clientNet.close(); clientNet = null; }
    if (activeRoom) { activeRoom.leave().catch(() => {}); activeRoom = null; }
    game = null; mode = 'menu'; ui.screen = 'menu'; ui.seat = -1; ui.phoneTab = 'hand'; ui.wasNeed = false; ui.wasMine = false;
    render();
  }

  // ---------- Événements ----------
  const handlers = {
    goto: (t) => { ui.screen = t.dataset.s; ui.error = ''; if (ui.screen === 'host') return hostOpen(false); renderWelcome(); },
    'host-resume': () => hostOpen(true),
    'host-cancel': () => hostClose(false),
    'host-start': hostStart,
    join: joinGame,
    leave: leaveGame,
    start: startLocal,
    resume: () => { const g = store.get(SAVE_KEY); if (validGame(g)) { game = fat(g); mode = 'local'; ui.lastTurn = -1; render(); } },
    count: (t) => { ui.names.forEach((n, i) => { const el = $('name' + i); if (el) ui.names[i] = el.value; }); ui.count = +t.dataset.n; renderWelcome(); },
    new: () => { ui.confirmNew = true; renderTop(); },
    'new-cancel': () => { ui.confirmNew = false; renderTop(); },
    'new-go': () => {
      ui.confirmNew = false;
      if (mode === 'host') return hostNewGame();
      store.del(SAVE_KEY); game = null; mode = 'menu'; ui.screen = 'menu'; render();
    },
    'phone-tab': (t) => { ui.phoneTab = t.dataset.k; render(); },
    view: (t) => { ui.pin = +t.dataset.i; ui.mode = null; render(); },
    roll: () => dispatch({ type: 'roll', player: viewer() }),
    end: () => dispatch({ type: 'endTurn', player: viewer() }),
    buy: () => dispatch({ type: 'buyDev', player: viewer() }),
    mode: (t) => { ui.mode = ui.mode === t.dataset.k ? null : t.dataset.k; ui.tradeOpen = false; render(); },
    'trade-toggle': () => { ui.tradeOpen = !ui.tradeOpen; ui.mode = null; renderHand(); },
    tab: (t) => { ui.tab = t.dataset.k; renderHand(); },
    'bank-give': (t) => { ui.bankGive = t.dataset.r; if (ui.bankGet === ui.bankGive) ui.bankGet = null; renderHand(); },
    'bank-get': (t) => { ui.bankGet = t.dataset.r; renderHand(); },
    'bank-do': () => dispatch({ type: 'bankTrade', player: viewer(), give: ui.bankGive, get: ui.bankGet }),
    step: (t) => {
      const set = ui[t.dataset.set];
      set[t.dataset.r] = Math.max(0, set[t.dataset.r] + +t.dataset.d);
      renderHand();
    },
    offer: () => dispatch({ type: 'offerTrade', player: viewer(), give: ui.give, want: ui.want }),
    'cancel-offer': () => dispatch({ type: 'cancelTrade', player: viewer() }),
    respond: (t) => dispatch({ type: 'respondTrade', player: viewer(), accept: t.dataset.a === '1' }),
    confirm: (t) => dispatch({ type: 'confirmTrade', player: viewer(), with: +t.dataset.with }),
    discard: () => dispatch({ type: 'discard', player: viewer(), cards: ui.discard }),
    steal: (t) => dispatch({ type: 'steal', player: viewer(), victim: +t.dataset.i }),
    dev: (t) => {
      const k = t.dataset.k, player = viewer();
      if (k === 'knight') dispatch({ type: 'playKnight', player });
      else if (k === 'roadBuilding') dispatch({ type: 'playRoadBuilding', player });
      else { ui.pick = k === 'yearOfPlenty' ? 'yop' : 'mono'; ui.yop = []; renderHand(); }
    },
    'pick-res': (t) => {
      const r = t.dataset.r;
      if (ui.pick === 'mono') return dispatch({ type: 'playMonopoly', player: viewer(), res: r });
      ui.yop.push(r);
      if (ui.yop.length === 2) return dispatch({ type: 'playYearOfPlenty', player: viewer(), a: ui.yop[0], b: ui.yop[1] });
      renderHand();
    },
    'pick-cancel': () => { ui.pick = null; ui.yop = []; renderHand(); },
  };

  function onBoardClick(t) {
    if (mode === 'host') return;
    const pid = myPid();
    if (t.dataset.v !== undefined) dispatch({ type: ui.mode === 'city' ? 'placeCity' : 'placeSettlement', player: pid, vertex: +t.dataset.v });
    else if (t.dataset.e !== undefined) dispatch({ type: 'placeRoad', player: pid, edge: +t.dataset.e });
    else if (t.dataset.h !== undefined) dispatch({ type: 'moveRobber', player: pid, hex: +t.dataset.h });
  }

  // Un doigt tombe rarement pile sur un point : on prend toujours l'emplacement valide le plus proche du toucher
  // (jusqu'à ~100 unités, soit environ 30 px sur un téléphone), même quand deux zones se chevauchent.
  function snapTap(e) {
    const svg = $('board');
    if (!game || mode === 'host' || !svg.createSVGPoint || !svg.getScreenCTM || !svg.getScreenCTM()) return false;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let best = null, bestD = 100;
    svg.querySelectorAll('[data-v],[data-e]').forEach((el) => {
      const x = el.dataset.v !== undefined ? +el.getAttribute('cx') : (+el.getAttribute('x1') + +el.getAttribute('x2')) / 2;
      const y = el.dataset.v !== undefined ? +el.getAttribute('cy') : (+el.getAttribute('y1') + +el.getAttribute('y2')) / 2;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = el; }
    });
    if (!best) return false;
    onBoardClick(best);
    return true;
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-v],[data-e],[data-h]');
    if (e.target.closest && e.target.closest('#board') && (!t || t.dataset.v !== undefined || t.dataset.e !== undefined) && snapTap(e)) return;
    if (!t) return;
    if (t.dataset.act) {
      const h = handlers[t.dataset.act];
      if (h) h(t);
    } else if (game) onBoardClick(t);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'joinCode') { e.target.value = e.target.value.toUpperCase(); ui.joinCode = e.target.value; }
    else if (e.target.id === 'joinName') ui.myName = e.target.value;
  });

  // ---------- Démarrage ----------
  const savedClient = store.get(CLIENT_KEY);
  if (savedClient) { ui.myName = savedClient.name || ''; ui.joinCode = savedClient.code || ''; }
  const hash = (location.hash || '').replace('#', '');
  const hashCode = /^j=([A-Za-z0-9]{4})$/.exec(hash);
  if (hashCode) { ui.joinCode = hashCode[1].toUpperCase(); ui.screen = 'join'; }
  else if (hash === 'joueur') ui.screen = 'join';
  render();
  if (hash === 'plateau') hostOpen(false);
})();
