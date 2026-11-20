// Roman Town — its life: the people of the town and the country about it,
// their beasts and their things, and what they do from moment to moment as
// the day goes by the visitor's clock, on and on.
//
// Like the view, it knows only what the model (roman-town.js) says is
// there: the houses and how their rooms go, the beds, hearths and tables in
// them, the doors, the streets, the forum, the fields and the pastures. From
// that, once, it peoples the town: a household in every house, a family and
// its slaves in every atrium house (one to keep the door, one to cook, one
// to walk behind the master, maids), more upstairs in the apartment blocks,
// farm folk at the farms, each with a Roman name; every shop keeper at its
// trade (a tavern, a bakery, a smithy, a fullery, a pottery, a butcher's, a
// greengrocer's, a wine-shop, a weaver's, a cobbler's, a carpenter's, a
// barber's) and hands working in the workshops; the town's servants (gate
// guards, sentries, lookouts, the night watch, priests, a schoolmaster, bath
// attendants, lictors before the magistrates), a doctor, scribes, a
// money-changer, stonemasons, woodcutters, water-carriers, pipers, actors,
// gladiators; farmers, fishermen, porters, craftsmen at their doors;
// shepherds and herdsmen with their flocks and herds, most with a dog,
// moving them from pasture to pasture; dogs, hens,
// travellers on the roads, carts bringing in firewood, hay, vegetables,
// fruit and grain, unloaded by night into the storehouse's rooms or at the
// market's stalls, boats on the river. Then, moment by moment, each
// grows hungry and tired as the hours go by and the work is hard, and eats
// when hungry and sleeps when too tired to go on, far sooner at night; and
// otherwise does what is done at that hour of the Roman day, the hours counted from
// sunrise as the Romans counted them, twelve to the day and twelve to the
// night whatever their length: up before dawn, water from the fountain, the
// fields, the shop, the forum, school under a portico; a meal at noon and a
// rest; the baths in the afternoon, or the neighbours' talk about a
// fountain; dinner on couches; the tavern after
// it; home before dark, the watch going round with torches, sleep; on a
// feast day the whole town on the theatre's steps for the play or the
// amphitheatre's for the games, gladiators two by two on the sand (where
// they train on the other days) and a pair at a time against the bulls and
// the lions, the bear, the hunters after the beasts, the crowd
// applauding, on its feet; and day and night sentries on the
// walls and a lookout on every other tower. Each goes where it is going as one
// would walk: out through the doors of its house, along the streets, the
// roads and the tracks, round whatever stands in the way.
//
//   const life = RomanTownLife.create(town, { seed, date })
//   life.step(dt, date)  on by dt seconds, at the hour date is
//   life.figures         what is to be seen: { kind, x, y, z, a, pose, ... } each, kind a person,
//                        a beast (sheep, goat, cow, ox, horse, donkey, dog, hen), a rider, a cart, a boat,
//                        a basket, and what is being worked (a stone, a log, a little table); a its heading, pose what it is doing (stand, walk, run, sit, lie,
//                        recline, bend, kneel, squat, swim, graze), ph how far through its stride or its
//                        work, anim the work, carry what it carries, seat how high it sits
//   life.lights          the torches carried at night, { x, y, z, power }
//   life.describe(f)     who a figure is and what it is about, in words: { name, title, doing, needs }
//   (create's options: maxDt, the longest step taken at once, for running it faster than it is drawn)
const RomanTownLife = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const turn = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - a[1] * b[0]; } return s / 2; };
  function insideConvex(poly, x, y) {
    const sg = Math.sign(area(poly));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (sg * ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) < -1e-6) return false;
    }
    return true;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  // a box's own frame: s along w, t along d, from its corner
  const toWorld = (b, s, t) => {
    const c = Math.cos(b.angle), sn = Math.sin(b.angle);
    return [b.x + (s - b.w / 2) * c - (t - b.d / 2) * sn, b.y + (s - b.w / 2) * sn + (t - b.d / 2) * c];
  };
  const inBox = (b, x, y, m = 0) => {
    const dx = x - b.x, dy = y - b.y, c = Math.cos(b.angle), s = Math.sin(b.angle);
    return Math.abs(dx * c + dy * s) < b.w / 2 + m && Math.abs(-dx * s + dy * c) < b.d / 2 + m;
  };
  const reach = b => b.shape === 'box' ? Math.hypot(b.w, b.d) / 2 : b.shape === 'round' ? b.r : b.shape === 'cavea' ? b.r1 + 2.5 : Math.max(b.a, b.b);
  // what can be walked over or through: steps, a gate's arch, a bridge, a
  // colonnade with no walls, the basilica's nave
  const WALK = new Set(['steps', 'gate', 'bridge']);
  const walkable = b => WALK.has(b.use) || (b.use === 'portico' && !b.hole) || (b.use === 'basilica' && b.roof === 'gable');
  // a fountain whole, its basin of water too: not to be walked into
  const basin = b => b.use === 'fountain' ? { ...b, hole: null } : b;

  // ================= names, and what each is and does =================
  // A citizen his first name, his family's and his own; a woman her
  // father's family's name, and one of her own; a slave one name, most
  // often Greek.
  const PRAENOMINA = ['Gaius', 'Gaius', 'Lucius', 'Lucius', 'Marcus', 'Marcus', 'Publius', 'Quintus', 'Titus', 'Aulus', 'Gnaeus', 'Sextus', 'Decimus', 'Tiberius', 'Manius', 'Servius', 'Numerius', 'Vibius', 'Spurius'];
  const NOMINA = ['Iulius', 'Cornelius', 'Valerius', 'Claudius', 'Aemilius', 'Fabius', 'Caecilius', 'Sempronius', 'Tullius', 'Helvius', 'Popidius', 'Vettius', 'Lucretius', 'Umbricius', 'Cuspius', 'Holconius', 'Terentius', 'Sallustius', 'Fannius', 'Licinius', 'Plautius', 'Calpurnius', 'Pompeius', 'Annius', 'Livius', 'Octavius', 'Statius', 'Veranius', 'Naevius', 'Ofellius', 'Sittius', 'Lollius', 'Marius', 'Petronius', 'Vibius', 'Appuleius', 'Herennius', 'Minucius', 'Novius', 'Satrius', 'Epidius', 'Gavius', 'Insteius', 'Trebius', 'Cascellius', 'Alleius', 'Arrius', 'Caesius'];
  const COGNOMINA = ['Felix', 'Rufus', 'Secundus', 'Celer', 'Saturninus', 'Primus', 'Faustus', 'Severus', 'Crispus', 'Niger', 'Longus', 'Pulcher', 'Sabinus', 'Verus', 'Modestus', 'Fronto', 'Maximus', 'Proculus', 'Priscus', 'Paullus', 'Gallus', 'Bassus', 'Varus', 'Capito', 'Naso', 'Cerialis', 'Fortunatus', 'Hilarus', 'Iucundus', 'Ampliatus', 'Successus', 'Vitalis', 'Communis', 'Restitutus', 'Ianuarius', 'Optatus', 'Celsus', 'Marcellus', 'Albinus', 'Aper', 'Lupus', 'Corvus', 'Sura', 'Macer', 'Pollio', 'Tertius', 'Quartus'];
  const FEM_COGNOMINA = ['Prima', 'Secunda', 'Tertia', 'Maxima', 'Paulla', 'Rufa', 'Faustilla', 'Prisca', 'Severa', 'Marcella', 'Iusta', 'Lucilla', 'Sabina', 'Vera', 'Modesta', 'Fortunata', 'Restituta', 'Ianuaria', 'Procula', 'Felicula', 'Optata', 'Albina', 'Celsa', 'Pulchra', 'Saturnina', 'Vitalia', 'Quarta', 'Minor'];
  const SLAVE_M = ['Eros', 'Hermes', 'Philippus', 'Syrus', 'Narcissus', 'Pamphilus', 'Anteros', 'Stephanus', 'Onesimus', 'Daphnus', 'Chrestus', 'Epaphroditus', 'Phileros', 'Eutychus', 'Zosimus', 'Iason', 'Primigenius', 'Hyacinthus', 'Thallus', 'Dionysius', 'Antiochus', 'Philetus', 'Atticus', 'Corinthus'];
  const SLAVE_F = ['Doris', 'Chloe', 'Phoebe', 'Daphne', 'Helpis', 'Thais', 'Lyde', 'Iris', 'Nice', 'Myrtale', 'Glyke', 'Psyche', 'Tyche', 'Callista', 'Euphrosyne', 'Hedone', 'Philematio', 'Syra', 'Rhodope', 'Zoe', 'Cyrene', 'Melissa'];
  const femOf = nomen => nomen.replace(/ius$/, 'ia');

  // what each is, as one would say it
  const TITLE = {
    farmer: 'a farmer', shepherd: 'a shepherd', herdsman: 'a herdsman', fisher: 'a fisherman', porter: 'a porter', artisan: 'a craftsman',
    innkeeper: 'keeps a tavern', foricarius: 'keeps the public latrine', baker: 'a baker', smith: 'a smith', fuller: 'a fuller', potter: 'a potter', butcher: 'a butcher', grocer: 'a greengrocer',
    vintner: 'a wine-seller', weaver: 'a weaver', cobbler: 'a cobbler', carpenter: 'a carpenter', barber: 'a barber',
    patron: 'a patron of the town', domina: 'mistress of her house', wife: 'keeps the house', slave: 'a slave', child: 'a child', old: 'getting on in years',
    priest: 'a priest', teacher: 'a schoolmaster', attendant: 'a bath attendant', guard: 'guards a gate', sentry: 'a sentry on the walls', lookout: 'a lookout on the walls',
    watch: 'of the night watch', traveller: 'a traveller', rider: 'a traveller', doctor: 'a doctor', scribe: 'a scribe', banker: 'a money-changer', mason: 'a stonemason',
    woodcutter: 'a woodcutter', water: 'a water-carrier', lictor: 'a lictor', musician: 'a piper', actor: 'an actor', gladiator: 'a gladiator', venator: 'a beast-hunter of the arena', hand: 'works in a shop',
  };
  // what one is doing, by the work in one's hands
  const DOING = {
    hoe: 'hoeing', dig: 'digging', reap: 'reaping', scythe: 'mowing', sow: 'sowing', plough: 'ploughing', pick: 'picking grapes', prune: 'pruning the vines',
    beat: 'beating down olives', gather: 'gathering the fallen fruit', fish: 'fishing', wash: 'washing clothes at the river', fill: 'drawing water', cook: 'cooking',
    eat: 'eating', pray: 'praying', talk: 'talking', watch: 'keeping watch', sell: 'serving a customer', craft: 'at work', sweep: 'sweeping', scatter: 'feeding the hens',
    shoo: 'turning back a stray', exercise: 'running round the court', ball: 'playing ball', pet: 'making a fuss of an animal', hammer: 'hammering at the anvil',
    stoke: 'working the bellows', bake: 'baking bread', knead: 'kneading dough', push: 'turning the mill', tread: 'treading cloth in a vat', throw: 'throwing pots at the wheel',
    chop: 'cutting meat', weave: 'weaving at the loom', saw: 'sawing timber', shave: 'shaving a customer', stitch: 'stitching shoes', spin: 'spinning wool',
    ladle: 'serving at the counter', write: 'writing', count: 'counting coins', chisel: 'cutting stone', axe: 'felling wood', pipe: 'playing the pipes',
    fight: 'fighting', drink: 'drinking', cheer: 'cheering', clap: 'applauding', declaim: 'declaiming', fasces: 'attending the magistrate', heal: 'seeing a patient', basket: 'weaving a basket',
  };

  // what one is about, as words: there, and on the way there
  const ABOUT = {
    night: ['at home for the evening', 'home'], home: ['at home', 'home'], meal: ['eating', 'to eat'], eat: ['eating', 'home to eat'], sleep: ['asleep', 'home to bed'],
    siesta: ['resting in the heat of the day', 'to lie down a while'], rest: ['resting', 'to rest'], shop: ['at work in the shop', 'to work'], craft: ['at work at the door', 'to work'],
    field: ['working in the fields', 'out to the fields'], pasture: ['watching the flock', 'out to the flock'], drove: ['moving the flock to fresh grass', 'with the flock to fresh grass'],
    baths: ['at the baths', 'to the baths'], fountain: ['at the fountain', 'to the fountain'], forum: ['in the forum', 'to the forum'], stroll: ['out and about', 'for a walk'], temple: ['at the temple', 'to the temple'],
    market: ['shopping', 'to the shops'], show: ['at the show', 'to the show'], perform: ['on the stage', 'to the theatre'], fight: ['fighting in the arena', 'to the arena'],
    tavern: ['at the tavern', 'to the tavern'], barber: ['at the barber’s', 'to the barber’s'], water: ['fetching water', 'for water'], chores: ['about the house', 'home'],
    cook: ['cooking', 'to the kitchen'], spin: ['spinning wool', 'home to spin'], porter: ['carrying a load', 'for a load'], carrywater: ['carrying water', 'with a jar of water'],
    masonry: ['cutting stone for a tomb', 'out to the tombs'], woodcut: ['cutting wood', 'out to the trees'], visit: ['seeing a patient', 'to a patient'], desk: ['at his table in the forum', 'to the forum'],
    lictor: ['attending the magistrate', 'to the basilica'], pipe: ['playing the pipes', 'to play'], rehearse: ['rehearsing on the stage', 'to the theatre'], train: ['training', 'to train'], menagerie: ['tending the beasts in their cages', 'to the beasts'], hunt: ['hunting beasts on the sand', 'to the arena'],
    doorkeep: ['keeping the door', 'to the door'], escort: ['behind his master', 'after his master'], help: ['helping his father', 'to his father'], school: ['at school', 'to school'],
    teach: ['teaching', 'to school'], play: ['playing', 'out to play'], door: ['sitting by the door', 'out to the door'], receive: ['receiving his clients', 'home'],
    salutatio: ['calling on his patron', 'to call on his patron'], tribunal: ['sitting in judgement', 'to the basilica'], cena: ['at dinner', 'to dinner'], serve: ['serving at dinner', 'to serve'],
    feed: ['feeding the hens', 'to the hens'], sell: ['selling at the market', 'to the market'], river: ['by the river', 'down to the river'], sacrifice: ['at the altar', 'to the altar'],
    precinct: ['about the temple', 'to the temple'], attend: ['tending the baths', 'to the baths'], guard: ['guarding the gate', 'to the gate'], sentry: ['walking the walls', 'up onto the walls'],
    lookout: ['keeping a lookout from a tower', 'up to his tower'], swim: ['swimming lengths', 'for a swim'], drink: ['having a drink', 'for a drink'], inn: ['staying the night at an inn', 'to an inn for the night'], nature: ['at the latrine', 'to the latrine'], patrol: ['on his rounds with the watch', 'on his rounds'], interlude: ['taking a break', 'for a break'], travel: ['on a journey', 'on the road'],
  };

  // ================= the hour, as the Romans told it =================
  // sunrise and sunset on a day, from the sky (the sun's top on the horizon)
  const H0 = -0.833 * Math.PI / 180, days = new Map();
  function sunDay(y, m, d) {
    const key = y * 400 + m * 32 + d;
    if (days.has(key)) return days.get(key);
    const t0 = new Date(y, m, d).getTime(), step = 600e3, el = t => RomanTownSky.local(new Date(t)).sun.el;
    let rise = t0 + 6 * 3600e3, set = t0 + 18 * 3600e3, prev = el(t0), up = false, down = false;
    for (let t = t0 + step; t <= t0 + 24 * 3600e3 + 1; t += step) {
      const e = el(t);
      if (!up && prev < H0 && e >= H0) { rise = t - step * (e - H0) / (e - prev); up = true; }
      else if (up && !down && prev >= H0 && e < H0) { set = t - step * (e - H0) / (e - prev); down = true; }
      prev = e;
    }
    const v = { rise, set };
    days.set(key, v);
    return v;
  }
  // The hour: 0 at sunrise, 6 at noon, 12 at sunset, the night's hours on
  // from 12 to 24 at the next sunrise. A day's plans run from the middle of
  // one night to the middle of the next: R from −6 (the night's sixth hour)
  // to 18. And how long an hour of the day and of the night is, in seconds;
  // the day (a number, one more each day), and the month.
  function hour(date) {
    const t = date.getTime(), y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const today = sunDay(y, m, d), ds = (a, k) => { const q = new Date(a.getFullYear(), a.getMonth(), a.getDate() + k); return sunDay(q.getFullYear(), q.getMonth(), q.getDate()); };
    let R, dayH = (today.set - today.rise) / 12e3, nightH, day = Math.floor(Date.UTC(y, m, d) / 86400e3);
    if (t < today.rise) {
      const prev = ds(date, -1), nh = (today.rise - prev.set) / 12;
      R = 12 + (t - prev.set) / nh; nightH = nh / 1e3;
      if (R < 18) day--;
    } else {
      const next = ds(date, 1), nh = (next.rise - today.set) / 12;
      nightH = nh / 1e3;
      R = t < today.set ? (t - today.rise) / (dayH * 1e3) : 12 + (t - today.set) / nh;
      if (R >= 18) day++;
    }
    return { R: R >= 18 ? R - 24 : R, dayH, nightH, day, month: m };
  }
  // seconds from one hour of a day's plan to a later one
  function secs(h, from, to) {
    if (to <= from) return 0;
    let s = 0;
    const seg = (a, b, len) => { const lo = Math.max(a, from), hi = Math.min(b, to); if (hi > lo) s += (hi - lo) * len; };
    seg(-6, 0, h.nightH); seg(0, 12, h.dayH); seg(12, 18, h.nightH);
    return s;
  }

  // ================= the ways: where one can walk, and how =================
  // The world a metre a cell, what each costs to cross (Infinity where it
  // can't be): the streets and the roads cheapest, a yard or a garden dearer,
  // the rough country dearer still and the steeper the dearer, a field of
  // crops dearest (it is walked round, not over); buildings, the river, the
  // pools, the walls not at all.
  function ways(town) {
    const W = town.W, H = town.H, nx = Math.ceil(W), ny = Math.ceil(H), N = nx * ny;
    const cost = new Float32Array(N);
    const hAt = (x, y) => RomanTown.heightAt(town.terrain, x, y);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i + 0.5, y = j + 0.5;
      const sl = Math.hypot(hAt(x + 2, y) - hAt(x - 2, y), hAt(x, y + 2) - hAt(x, y - 2)) / 4;
      cost[j * nx + i] = 1.4 + Math.min(6, 8 * sl);
    }
    const cells = (x0, y0, x1, y1, f) => {
      const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(nx - 1, Math.floor(x1)), j0 = Math.max(0, Math.floor(y0)), j1 = Math.min(ny - 1, Math.floor(y1));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i, i + 0.5, j + 0.5);
    };
    const fillPoly = (poly, v) => {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      cells(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (k, x, y) => { if (insideConvex(poly, x, y)) cost[k] = v; });
    };
    const fillLine = (pts, half, v) => {
      for (let q = 0; q + 1 < pts.length; q++) {
        const [a, b] = [pts[q], pts[q + 1]];
        cells(Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half,
          (k, x, y) => { if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= half) cost[k] = Math.min(cost[k] === Infinity ? v : cost[k], v); });
      }
    };
    const FC = { pasture: 2.4, olives: 2.6, orchard: 2.6, vines: 4.5, wheat: 6, hay: 3.5, meadow: 3.5, stubble: 2.8, fallow: 3.2 };
    for (const f of town.fields) fillPoly(f.poly, FC[f.crop] || 3);
    for (const r of town.roads) fillLine(r.points, r.width / 2, r.kind === 'via' ? 1 : 1.05);
    const GC = { street: 1, 'main-street': 1, paving: 1, yard: 1.3, garden: 1.7, sand: 1.2, floor: 1.1, vines: 4, pool: Infinity, well: Infinity, mud: 2.6, trodden: 2.4 };
    for (const g of town.grounds) fillPoly(g.poly, GC[g.kind] ?? 1.3);
    if (town.river) fillLine(town.river.points, town.river.width / 2 + 0.4, Infinity);
    // (the ground as it is without what is built on it, to look at closer)
    const base = cost.slice();
    for (const b of town.buildings) {
      if (walkable(b)) continue;
      const R = reach(b) + 1;
      const c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
      cells(b.x - R, b.y - R, b.x + R, b.y + R, (k, x, y) => {
        const dx = x - b.x, dy = y - b.y, a = dx * c + dy * s, d = -dx * s + dy * c;
        if (b.shape === 'arena') {
          // the sand, and the four ways in under the seats
          const rho = Math.hypot(a / b.a, d / b.b);
          if (rho < 1 + 0.4 / b.a && !(rho < b.a0 / b.a - 0.02 || Math.abs(d) < 1.6 || Math.abs(a) < 1.6)) cost[k] = Infinity;
        } else if (b.shape === 'cavea') {
          // the seats, not the orchestra, nor the ways in at either end (the parodoi)
          const r = Math.hypot(a, d);
          if (a > 1.8 && r < b.r1 + 2.8 && r > b.r0 - 0.3) cost[k] = Infinity;
        } else if (RomanTown.onBuilding(basin(b), x, y, 0.3)) cost[k] = Infinity;
      });
    }
    for (const b of town.buildings) if (b.use === 'bridge') { const R = reach(b); cells(b.x - R, b.y - R, b.x + R, b.y + R, (k, x, y) => { if (inBox(b, x, y)) cost[k] = 1; }); }
    for (const r of town.rocks || []) cells(r.x - r.r, r.y - r.r, r.x + r.r, r.y + r.r, (k, x, y) => { if (Math.hypot(x - r.x, y - r.y) < r.r * 0.75) cost[k] = Infinity; });
    for (let i = 0; i < nx; i++) cost[i] = cost[(ny - 1) * nx + i] = Infinity;
    for (let j = 0; j < ny; j++) cost[j * nx] = cost[j * nx + nx - 1] = Infinity;

    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    const DK = DI.map((di, q) => di + DJ[q] * nx);
    const pass = (k, q) => q < 4 || (cost[k + DI[q]] !== Infinity && cost[k + DJ[q] * nx] !== Infinity);
    // which ground joins which: the parts that can be walked between
    const comp = new Int32Array(N).fill(-1);
    {
      const queue = new Int32Array(N);
      let label = 0;
      for (let k0 = 0; k0 < N; k0++) {
        if (comp[k0] >= 0 || cost[k0] === Infinity) continue;
        let h = 0, t = 0;
        queue[t++] = k0; comp[k0] = label;
        while (h < t) {
          const k = queue[h++];
          for (let q = 0; q < 8; q++) {
            const k2 = k + DK[q];
            if (comp[k2] >= 0 || cost[k2] === Infinity || !pass(k, q)) continue;
            comp[k2] = label; queue[t++] = k2;
          }
        }
        label++;
      }
    }
    const cellOf = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1 ? -1 : j * nx + i; };
    const costAt = (x, y) => { const k = cellOf(x, y); return k < 0 ? Infinity : cost[k]; };
    // the nearest cell that can be walked on, within r metres (and on the
    // same ground as another, if given)
    function snap(x, y, r = 3, on = -1) {
      const k0 = cellOf(x, y);
      if (k0 >= 0 && cost[k0] !== Infinity && (on < 0 || comp[k0] === on)) return k0;
      const i0 = Math.floor(x), j0 = Math.floor(y);
      let best = -1, bd = Infinity;
      for (let rr = 1; rr <= r && best < 0; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue;
        const k = cellOf(i0 + di + 0.5, j0 + dj + 0.5);
        if (k < 0 || cost[k] === Infinity || (on >= 0 && comp[k] !== on)) continue;
        const d = Math.hypot(i0 + di + 0.5 - x, j0 + dj + 0.5 - y);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    // whether a straight line can be walked, no dearer anywhere than its ends
    function los(p, q) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.ceil(L / 0.4);
      const top = Math.max(costAt(...p) === Infinity ? 1 : costAt(...p), costAt(...q) === Infinity ? 1 : costAt(...q)) * 1.12 + 0.12;
      for (let m = 1; m < n; m++) {
        const c = costAt(lerp(p[0], q[0], m / n), lerp(p[1], q[1], m / n));
        if (!(c <= top)) return false;
      }
      return true;
    }
    // a line through the cells pulled straight wherever it can be
    function pull(pts, ok) {
      const out = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = Math.min(pts.length - 1, i + 48);
        while (j > i + 1 && !ok(pts[i], pts[j])) j--;
        out.push(pts[j]);
        i = j;
      }
      return out;
    }
    // the cheapest way from a to b, near enough (a weighted A*)
    const g = new Float32Array(N), seen = new Uint32Array(N), done = new Uint32Array(N), from = new Int32Array(N);
    let stamp = 0, hk = new Int32Array(4096), hf = new Float64Array(4096), hn = 0;
    const hpush = (k, f) => {
      if (hn === hk.length) { const k2 = new Int32Array(hn * 2), f2 = new Float64Array(hn * 2); k2.set(hk); f2.set(hf); hk = k2; hf = f2; }
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; }
      hk[i] = k; hf[i] = f;
    };
    const hpop = () => {
      const top = hk[0], k = hk[--hn], f = hf[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hk[i] = hk[c]; hf[i] = hf[c]; i = c;
      }
      hk[i] = k; hf[i] = f;
      return top;
    };
    function path(ax, ay, bx, by) {
      const t = snap(bx, by), s = t < 0 ? -1 : snap(ax, ay, 3, comp[t]);
      if (s < 0 || t < 0) return null;
      if (s === t) return [[ax, ay], costAt(bx, by) < Infinity ? [bx, by] : [t % nx + 0.5, ((t / nx) | 0) + 0.5]];
      stamp++; hn = 0;
      const ti = t % nx, tj = (t / nx) | 0;
      const h = k => { const dx = Math.abs(k % nx - ti), dy = Math.abs(((k / nx) | 0) - tj); return 1.45 * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)); };
      g[s] = 0; seen[s] = stamp; from[s] = -1; hpush(s, h(s));
      let n = 0;
      while (hn) {
        const k = hpop();
        if (done[k] === stamp) continue;
        done[k] = stamp;
        if (k === t || ++n > 250000) break;
        const gk = g[k], ck = cost[k];
        for (let q = 0; q < 8; q++) {
          const k2 = k + DK[q], c = cost[k2];
          if (c === Infinity || done[k2] === stamp || !pass(k, q)) continue;
          const g2 = gk + DL[q] * (ck + c) / 2;
          if (seen[k2] !== stamp || g2 < g[k2]) { seen[k2] = stamp; g[k2] = g2; from[k2] = k; hpush(k2, g2 + h(k2)); }
        }
      }
      if (done[t] !== stamp) return null;
      const cs = [];
      for (let k = t; k >= 0; k = from[k]) cs.push(k);
      cs.reverse();
      const pts = cs.map(k => [k % nx + 0.5, ((k / nx) | 0) + 0.5]);
      // (from where one is and to where one goes, unless that is somewhere that can't be stood: then the nearest that can)
      if (costAt(ax, ay) < Infinity) pts[0] = [ax, ay];
      if (costAt(bx, by) < Infinity) pts[pts.length - 1] = [bx, by];
      return pull(pts, los);
    }
    const baseAt = (x, y) => { const k = cellOf(x, y); return k < 0 ? Infinity : base[k]; };
    return { nx, ny, cost, comp, cellOf, costAt, baseAt, snap, path, los, pull, hAt, cells };
  }

  // ---- a building or a house of several, close up: a quarter of a metre a
  // cell, its rooms, the walls between them, the doorways through them, what
  // stands in the rooms, and the ground just about it as the world is ----
  function room(town, way, near) {
    return function build(C) {
      const b0 = C.bs[0], c = Math.cos(b0.angle), s = Math.sin(b0.angle), M = 2.5, R = 0.25;
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const b of C.bs) for (const [p, q] of [[0, 0], [b.w, 0], [b.w, b.d], [0, b.d]]) {
        const [x, y] = toWorld(b, p, q), u = x * c + y * s, v = -x * s + y * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      u0 -= M; v0 -= M; u1 += M; v1 += M;
      const gx = Math.ceil((u1 - u0) / R), gy = Math.ceil((v1 - v0) / R), free = new Uint8Array(gx * gy);
      const wx = (i, j) => { const u = u0 + (i + 0.5) * R, v = v0 + (j + 0.5) * R; return [u * c - v * s, u * s + v * c]; };
      const loc = (x, y) => [(x * c + y * s - u0) / R - 0.5, (-x * s + y * c - v0) / R - 0.5];
      const inside = new Uint8Array(gx * gy), walled = new Uint8Array(gx * gy), doorways = [];
      // what else stands about, close enough to matter (not what is up on a roof: a dome)
      const others = [...near(b0.x, b0.y, Math.max(u1 - u0, v1 - v0))].filter(o => !C.bs.includes(o) && !walkable(o) && o.z0 <= b0.z0 + 2);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const [x, y] = wx(i, j), k = j * gx + i;
        if (C.bs.some(b => inBox(b, x, y))) { inside[k] = 1; free[k] = 1; }
        // outside, the ground close up: clear of anything built by a hand's breadth
        else free[k] = way.baseAt(x, y) < Infinity && !others.some(o => Math.abs(o.x - x) < reach(o) + 0.5 && Math.abs(o.y - y) < reach(o) + 0.5 && RomanTown.onBuilding(basin(o), x, y, 0.15)) ? 1 : 0;
      }
      // a shape's cells, by a test in the world, over its box in the world
      const mark = (x0, y0, x1, y1, test, v) => {
        let a0 = Infinity, b0_ = Infinity, a1 = -Infinity, b1 = -Infinity;
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const [i, j] = loc(x, y); a0 = Math.min(a0, i); a1 = Math.max(a1, i); b0_ = Math.min(b0_, j); b1 = Math.max(b1, j); }
        for (let j = Math.max(0, Math.floor(b0_) - 1); j <= Math.min(gy - 1, Math.ceil(b1) + 1); j++)
          for (let i = Math.max(0, Math.floor(a0) - 1); i <= Math.min(gx - 1, Math.ceil(a1) + 1); i++) {
            const [x, y] = wx(i, j);
            if (test(x, y, j * gx + i)) free[j * gx + i] = v;
          }
      };
      // whatever else stands inside: a temple in its precinct, a pavilion, a well
      for (const o of others) {
        const r = reach(o) + 0.5;
        mark(o.x - r, o.y - r, o.x + r, o.y + r, (x, y, k) => inside[k] && RomanTown.onBuilding(basin(o), x, y, 0.15), 0);
      }
      for (const g of town.grounds) {
        if (g.kind !== 'pool') continue;
        const [gx0, gy0] = g.poly[0];
        if (Math.hypot(gx0 - b0.x, gy0 - b0.y) > Math.max(u1 - u0, v1 - v0)) continue;
        const xs = g.poly.map(p => p[0]), ys = g.poly.map(p => p[1]);
        mark(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => insideConvex(g.poly, x, y), 0);
      }
      for (const b of C.bs) {
        const I = b.interior;
        if (!I) continue;
        const box = (a1, c1, a2, c2, m, v) => {
          const corners = [toWorld(b, a1 - m, c1 - m), toWorld(b, a2 + m, c2 + m), toWorld(b, a1 - m, c2 + m), toWorld(b, a2 + m, c1 - m)];
          const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
          const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
          mark(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y, k) => {
            if (v === 2 && free[k] !== 1) return false;
            const dx = x - b.x, dy = y - b.y, p = dx * cb + dy * sb + b.w / 2, q = -dx * sb + dy * cb + b.d / 2;
            return p > a1 - m && p < a2 + m && q > c1 - m && q < c2 + m;
          }, v);
        };
        for (const f of I.floors) if (f[4] === 'pool') box(f[0], f[1], f[2], f[3], 0.05, 0);
        for (const [a, cc, r] of I.columns) box(a - r, cc - r, a + r, cc + r, 0.1, 0);
        for (const f of I.furniture) {
          if (f.r !== undefined) box(f.a - f.r, f.c - f.r, f.a + f.r, f.c + f.r, 0.05, 2);
          else box(f.a - f.w / 2, f.c - f.d / 2, f.a + f.w / 2, f.c + f.d / 2, 0.05, 2);
        }
        for (const [a1, c1, a2, c2] of I.walls.concat(I.windows || [])) {
          const p = toWorld(b, a1, c1), q = toWorld(b, a2, c2), m = 0.36;
          mark(Math.min(p[0], q[0]) - m, Math.min(p[1], q[1]) - m, Math.max(p[0], q[0]) + m, Math.max(p[1], q[1]) + m,
            (x, y, k) => distSeg(x, y, p[0], p[1], q[0], q[1]) < m && (walled[k] = 1), 0);
        }
        // the doorways cleared again, and outside the doors
        const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
        // (as narrow as the opening is drawn, its jambs a quarter metre into it, a body's half-breadth clear of them)
        const carve = (a, cc, ux, uy, w, back, out) => {
          const [x0, y0] = toWorld(b, a, cc), wx_ = ux * cb - uy * sb, wy_ = ux * sb + uy * cb, nx_ = -wy_, ny_ = wx_, hw = Math.max(0.16, w / 2 - 0.4);
          doorways.push({ x: x0, y: y0, ux: wx_, uy: wy_, nx: nx_, ny: ny_, hw: w / 2 });
          const r = hw + Math.max(back, out) + 0.5;
          mark(x0 - r, y0 - r, x0 + r, y0 + r, (x, y) => {
            const al = (x - x0) * wx_ + (y - y0) * wy_, ac = (x - x0) * nx_ + (y - y0) * ny_;
            return Math.abs(al) < hw && ac > -back && ac < out;
          }, 1);
        };
        for (const [a, cc, w, ux, uy] of I.gaps || []) carve(a, cc, ux, uy, w, 0.6, 0.6);
        for (const e of b.entrances || []) carve(e.s, e.t, -e.ny, e.nx, e.w, 0.7, 1.8);
      }
      // free: 1 open floor; 2 furniture, squeezed past only if there is no other way
      for (let k = 0; k < walled.length; k++) if (free[k]) walled[k] = 0;
      return { gx, gy, free, walled, wx, loc, R, doorways };
    };
  }

  // ================= the people and the beasts =================
  function create(town, { seed = 1, date = new Date(), maxDt = 0.5 } = {}) {
    const rng = mulberry32((seed ^ 0x5eed1e) >>> 0);
    const range = (a, b) => a + (b - a) * rng();
    const chance = p => rng() < p;
    const choice = a => a[rng() * a.length | 0];
    const gauss = () => { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng()); };
    const wpick = w => { let s = 0; for (const k in w) s += w[k]; let r = rng() * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
    const way = ways(town), hAt = way.hAt;
    const B = town.buildings;
    let now = 0, clock = hour(date), deadline = Infinity;
    const timeNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // what stands where, 16 m a cell
    const index = new Map(), ikey = (i, j) => i * 8192 + j;
    for (const b of B) {
      const r = reach(b);
      for (let i = Math.floor((b.x - r) / 16); i <= Math.floor((b.x + r) / 16); i++)
        for (let j = Math.floor((b.y - r) / 16); j <= Math.floor((b.y + r) / 16); j++) {
          const k = ikey(i, j);
          if (!index.has(k)) index.set(k, []);
          index.get(k).push(b);
        }
    }
    function near(x, y, r) {
      const out = new Set();
      for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++)
        for (let j = Math.floor((y - r) / 16); j <= Math.floor((y + r) / 16); j++) for (const b of index.get(ikey(i, j)) || []) out.add(b);
      return out;
    }

    // ---- houses and halls close up: one for each building with rooms, or
    // for all the parts of a house together ----
    const buildRoom = room(town, way, near);
    const clusters = new Map(), parts = new Map();
    const mainComp = (() => { const g = town.gates[0]; const k = g ? way.snap(g.x, g.y, 6) : -1; return k >= 0 ? way.comp[k] : 0; })();
    for (const b of B) if (b.interior && b.entrances && b.part) { if (!parts.has(b.part)) parts.set(b.part, []); parts.get(b.part).push(b); }
    function clusterOf(b) {
      if (!b || !b.interior || !b.entrances) return null;
      if (clusters.has(b)) return clusters.get(b);
      const bs = b.part ? parts.get(b.part) : [b];
      const C = { bs, grid: null, ents: [] };
      for (const o of bs) for (const e of o.entrances) {
        // a step outside the door, or to one side if something stands there (a fountain)
        let out = toWorld(o, e.s + e.nx * 1.4, e.t + e.ny * 1.4);
        const inn = toWorld(o, e.s - e.nx * 0.7, e.t - e.ny * 0.7);
        search: for (const d of [1.4, 2.2, 3]) for (const l of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
          const p = toWorld(o, e.s + e.nx * d - e.ny * l, e.t + e.ny * d + e.nx * l), kc = way.cellOf(...p);
          if (kc >= 0 && way.cost[kc] < Infinity && way.comp[kc] === mainComp) { out = p; break search; }
        }
        const k = way.snap(...out, 2);
        C.ents.push({ b: o, kind: e.kind, out, inn, ok: k >= 0 && way.comp[k] === mainComp });
      }
      for (const o of bs) clusters.set(o, C);
      return C;
    }
    // a house's plan close up, made when first wanted; and each door's step
    // outside found from the door itself: the nearest open ground of the
    // streets that can be walked to out through it
    function gridOf(C) {
      const G = C.grid = buildRoom(C), { gx, gy, free } = G;
      for (const e of C.ents) {
        const [fi, fj] = G.loc(...e.inn), s0 = Math.round(fj) * gx + Math.round(fi);
        if (s0 < 0 || s0 >= free.length || !free[s0]) continue;
        const seen = new Map([[s0, 0]]), q = [s0];
        let best = null, bd = Infinity;
        for (let h = 0; h < q.length && q.length < 3000; h++) {
          const k = q[h], i = k % gx, j = (k / gx) | 0, [x, y] = G.wx(i, j), steps = seen.get(k);
          if (!C.bs.some(b => inBox(b, x, y, 0.3))) {
            const kc = way.cellOf(x, y);
            if (kc >= 0 && way.cost[kc] < Infinity && way.comp[kc] === mainComp) {
              const d = Math.hypot(x - e.out[0], y - e.out[1]) + steps * 0.05;
              if (d < bd) { bd = d; best = [x, y]; }
            }
          }
          if (steps > 24) continue;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const i2 = i + di, j2 = j + dj, k2 = j2 * gx + i2;
            if (i2 < 0 || j2 < 0 || i2 >= gx || j2 >= gy || seen.has(k2) || free[k2] !== 1) continue;
            seen.set(k2, steps + 1); q.push(k2);
          }
        }
        if (best) { e.out = best; e.ok = true; } else e.ok = false;
      }
      return G;
    }
    // the building with rooms at a point, if there is one
    // whether a point of open ground can be walked to from the gates
    const reachable = (x, y) => { const k = way.snap(x, y, 2); return k >= 0 && way.comp[k] === mainComp; };
    const clusterAt = (x, y) => { for (const b of near(x, y, 1)) if (b.shape === 'box' && b.interior && b.entrances && inBox(b, x, y)) return clusterOf(b); return null; };
    const floorAt = (C, x, y) => { for (const b of C.bs) if (inBox(b, x, y)) return b.z0 + 0.08; return NaN; };
    // the way from a to b in it, through its doors
    let bfsSeen = new Uint32Array(1), bfsPrev = new Int32Array(1), bfsQ = new Int32Array(1), bfsStamp = 0;
    function inside(C, A, Bp) {
      if (!C.grid) gridOf(C);
      return search(C.grid, A, Bp, 1) || search(C.grid, A, Bp, 2);
    }
    function search(G, A, Bp, worst) {
      const { gx, gy } = G, free = G.view || (G.view = new Uint8Array(gx * gy)), F = G.free;
      for (let k = 0; k < F.length; k++) free[k] = F[k] && F[k] <= worst ? 1 : 0;
      // the nearest free cell to a point, on its side of any wall (what
      // stands between, the bed or the bench it is on, no matter)
      const seesIt = (i, j, fi, fj) => {
        const L = Math.hypot(i - fi, j - fj), m = Math.ceil(L * 2.5);
        for (let k = 1; k < m; k++) {
          const f = k / m;
          if ((1 - f) * L * G.R < 0.15) break;
          const a = Math.round(lerp(i, fi, f)), b = Math.round(lerp(j, fj, f));
          if (a < 0 || b < 0 || a >= gx || b >= gy || G.walled[b * gx + a]) return false;
        }
        return true;
      };
      const snapC = (x, y) => {
        const [fi, fj] = G.loc(x, y), i0 = Math.round(fi), j0 = Math.round(fj);
        let any = -1;
        for (let r = 0; r <= 28; r++) {
          let best = -1, bd = Infinity;
          for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            const i = i0 + di, j = j0 + dj;
            if (i < 0 || j < 0 || i >= gx || j >= gy || !free[j * gx + i]) continue;
            const d = Math.hypot(i - fi, j - fj);
            if (any < 0) any = j * gx + i;
            if (d < bd && seesIt(i, j, fi, fj)) { bd = d; best = j * gx + i; }
          }
          if (best >= 0) return best;
        }
        return any;
      };
      const s = snapC(...A), t = snapC(...Bp);
      if (s < 0 || t < 0) return null;
      const n = gx * gy;
      if (bfsSeen.length < n) { bfsSeen = new Uint32Array(n); bfsPrev = new Int32Array(n); bfsQ = new Int32Array(n); }
      const st = ++bfsStamp;
      let h = 0, tl = 0;
      bfsQ[tl++] = s; bfsSeen[s] = st; bfsPrev[s] = -1;
      const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
      while (h < tl && bfsSeen[t] !== st) {
        const k = bfsQ[h++], i = k % gx, j = (k / gx) | 0;
        for (let q = 0; q < 8; q++) {
          const i2 = i + DI[q], j2 = j + DJ[q];
          if (i2 < 0 || j2 < 0 || i2 >= gx || j2 >= gy) continue;
          const k2 = j2 * gx + i2;
          if (bfsSeen[k2] === st || !free[k2]) continue;
          if (q >= 4 && (!free[j * gx + i2] || !free[j2 * gx + i])) continue;
          bfsSeen[k2] = st; bfsPrev[k2] = k; bfsQ[tl++] = k2;
        }
      }
      if (bfsSeen[t] !== st) return null;
      const cs = [];
      for (let k = t; k >= 0; k = bfsPrev[k]) cs.push(k);
      cs.reverse();
      const pts = cs.map(k => G.wx(k % gx, (k / gx) | 0));
      pts[0] = A.slice(); pts[pts.length - 1] = Bp.slice();
      const ok = (p, q) => {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(L / 0.1);
        for (let k = 0; k <= m; k++) {
          const f = k / m;
          if (f * L < 0.3 || (1 - f) * L < 0.3) continue;
          const [fi, fj] = G.loc(lerp(p[0], q[0], f), lerp(p[1], q[1], f)), i = Math.round(fi), j = Math.round(fj);
          if (i < 0 || j < 0 || i >= gx || j >= gy || !free[j * gx + i]) return false;
        }
        return true;
      };
      return thread(G, way.pull(pts, ok));
    }
    // through every doorway on the way squarely, by its middle (or, a wide
    // one, away from its sides): a step before it, a step after
    function thread(G, pts) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = out[out.length - 1], b = pts[i], hits = [];
        for (const D of G.doorways) {
          const da = (a[0] - D.x) * D.nx + (a[1] - D.y) * D.ny, db = (b[0] - D.x) * D.nx + (b[1] - D.y) * D.ny;
          if (da * db >= 0 || Math.abs(da) < 0.05 && Math.abs(db) < 0.05) continue;
          const t = da / (da - db), px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, al = (px - D.x) * D.ux + (py - D.y) * D.uy;
          if (Math.abs(al) > D.hw + 0.35) continue;
          hits.push([t, D, Math.sign(db - da), al]);
        }
        hits.sort((p, q) => p[0] - q[0]);
        for (const [, D, sg, al] of hits) {
          const keep = D.hw > 0.9 ? clamp(al, -(D.hw - 0.55), D.hw - 0.55) : 0, cx = D.x + D.ux * keep, cy = D.y + D.uy * keep;
          out.push([cx - D.nx * sg * 0.45, cy - D.ny * sg * 0.45], [cx + D.nx * sg * 0.45, cy + D.ny * sg * 0.45]);
        }
        out.push(b);
      }
      return out;
    }
    // the doors of a house to go out by, towards somewhere, the likeliest
    // first (the front door, the nearest; none that has led nowhere)
    function doors(C, to) {
      return C.ents.filter(e => e.ok && (e.bad || 0) < 3).map(e => [e, Math.hypot(e.out[0] - to[0], e.out[1] - to[1]) - (e.kind === 'front' ? 8 : 0)]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
    }
    const door = (C, to) => doors(C, to)[0] || null;
    // out of a house (or in, backwards), through the first door that goes anywhere
    // (a door is blamed only if another goes where it did not)
    function through(C, at, to, out) {
      const failed = [];
      for (const e of doors(C, to)) {
        const p = out ? inside(C, at, e.out) : inside(C, e.out, at);
        if (p) { e.bad = 0; for (const f of failed) f.bad = (f.bad || 0) + 1; return { e, p }; }
        failed.push(e);
      }
      return null;
    }
    // the whole way from where one is to a spot: out of the house one is in,
    // through the streets, into the one the spot is in; each point [x, y, z],
    // z NaN on the open ground
    function route(x, y, cl, sp) {
      const zs = (C, pts) => pts.map(p => [p[0], p[1], C ? floorAt(C, p[0], p[1]) : NaN, C]);
      if (cl && cl === sp.cl) { const p = inside(cl, [x, y], [sp.x, sp.y]); return p && zs(cl, p); }
      let A = [x, y], Bp = [sp.x, sp.y], pre = [], post = [];
      if (cl) { const t = through(cl, A, Bp, true); if (t) { pre = zs(cl, t.p); A = t.e.out; } }
      if (sp.cl) { const t = through(sp.cl, Bp, A, false); if (t) { post = zs(sp.cl, t.p); Bp = t.e.out; } }
      const mid = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) < 0.5 ? [A, Bp] : way.path(A[0], A[1], Bp[0], Bp[1]);
      if (!mid) return null;
      return pre.slice(0, -1).concat(zs(null, mid), post.slice(1));
    }

    // ---- spots: where one is to be, and how ----
    const spot = (x, y, z, a, pose, o = {}) => ({ x, y, z, a, pose, cl: o.cl !== undefined ? o.cl : clusterAt(x, y), ...o });
    const fz = b => b.z0 + 0.08;
    const ang = (b, la) => b.angle + la;
    // a point of a room, clear of what is in it
    function roomPoint(b, r) {
      for (let k = 0; k < 12; k++) {
        const a = range(r[0] + 0.6, r[2] - 0.6), c = range(r[1] + 0.6, r[3] - 0.6);
        if (r[2] - r[0] < 1.3 || r[3] - r[1] < 1.3) return null;
        if (b.interior.furniture.some(f => f.r !== undefined ? Math.hypot(f.a - a, f.c - c) < f.r + 0.5 : Math.abs(f.a - a) < f.w / 2 + 0.45 && Math.abs(f.c - c) < f.d / 2 + 0.45)) continue;
        if (b.interior.columns.some(([p, q, rr]) => Math.hypot(p - a, q - c) < rr + 0.5)) continue;
        if (b.interior.floors.some(f => f[4] === 'pool' && a > f[0] - 0.4 && a < f[2] + 0.4 && c > f[1] - 0.4 && c < f[3] + 0.4)) continue;
        return [a, c];
      }
      return null;
    }
    // a table, as the view is to lay it: where, how big, its top's height; laid, till when
    const tables = new Map();
    function tableOf(b, f, x, y) {
      const key = b.x * 1e4 + b.y + f.a * 7 + f.c * 13;
      if (!tables.has(key)) tables.set(key, { kind: 'meal', id: tables.size + 1, x, y, z: b.z0 + (f.round ? 0.72 : 0.75), a: b.angle, w: f.w, d: f.d, round: !!f.round, rich: b.use === 'domus', vis: true, laid: 0, n: 0 });
      return tables.get(key);
    }
    // where to stand, sit or lie at a piece of furniture
    // a side of a piece in the middle of a room to stand at, d out from it:
    // in the room, clear of anything else in it; the nearest the room's
    // middle, or the first of the sides given
    function sideOf(b, f, d, prefer) {
      const I = b.interior, room = I.floors.find(r => r[4] !== 'pool' && f.a > r[0] && f.a < r[2] && f.c > r[1] && f.c < r[3]);
      if (!room) return null;
      const mx = (room[0] + room[2]) / 2, mc = (room[1] + room[3]) / 2, out = [];
      for (const [ux, uc] of prefer || [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const half = Math.abs(ux) ? (f.w || 0) / 2 : (f.d || 0) / 2, a = f.a + ux * (half + d), c = f.c + uc * (half + d);
        if (a < room[0] + 0.3 || a > room[2] - 0.3 || c < room[1] + 0.3 || c > room[3] - 0.3) continue;
        if (I.furniture.some(g => g !== f && (g.r !== undefined ? Math.hypot(g.a - a, g.c - c) < g.r + 0.25 : Math.abs(g.a - a) < g.w / 2 + 0.2 && Math.abs(g.c - c) < g.d / 2 + 0.2))) continue;
        out.push([a, c, Math.atan2(-uc, -ux), Math.hypot(a - mx, c - mc)]);
      }
      if (!out.length) return null;
      if (!prefer) out.sort((p, q) => p[3] - q[3]);
      return out[0];
    }
    function furnitureSpots(b) {
      const S = { beds: [], couches: [], seats: [], benches: [], hearths: [], counters: [], stalls: [], stores: [], tribunal: null, rooms: [], tables: [], work: [], latrines: [] };
      const I = b.interior, z = fz(b);
      // where a trade's work is done: standing, sitting or walking at a piece, its work in hand
      const work = (f, k, x, y, a, pose, anim, o = {}) => S.work.push({ b, f, k, x, y, z, a, pose, anim, ...o });
      for (const f of I.furniture) {
        const face = { 0: Math.PI / 2, 2: -Math.PI / 2, 1: Math.PI, 3: 0 }[f.side];
        // before a piece against a wall, facing it
        const before = (out, k, pose, anim, o) => {
          const ux = Math.cos(face), uy = Math.sin(face), half = Math.abs(ux) > 0.5 ? f.w / 2 : f.d / 2, [x, y] = toWorld(b, f.a + ux * (half + out), f.c + uy * (half + out));
          work(f, k, x, y, ang(b, face + Math.PI), pose, anim, o);
        };
        // at a piece in the middle, from a side of it
        const beside = (d, k, pose, anim, o, prefer) => { const p = sideOf(b, f, d, prefer); if (p) { const [x, y] = toWorld(b, p[0], p[1]); work(f, k, x, y, ang(b, p[2]), pose, anim, o); } };
        const lw = (f.w || 0) >= (f.d || 0);
        switch (f.k) {
          case 'oven': if (face !== undefined) before(0.75, 'oven', 'stand', 'bake'); continue;
          case 'forge': if (face !== undefined) before(0.5, 'forge', 'stand', 'stoke'); continue;
          case 'kiln': if (face !== undefined) before(0.55, 'kiln', 'bend', 'stoke'); continue;
          case 'loom': if (face !== undefined) before(0.45, 'loom', 'stand', 'weave'); continue;
          case 'vat': { const [x, y] = toWorld(b, f.a, f.c); work(f, 'vat', x, y, ang(b, rng() * TAU), 'stand', 'tread', { z: b.z0 + 0.35 }); continue; }
          // round the mill, pushing its bar
          case 'mill': { const [x, y] = toWorld(b, f.a, f.c); work(f, 'mill', x, y, 0, 'walk', 'push', { circle: { x, y, r: 0.98 } }); continue; }
          case 'anvil': beside(0.45, 'anvil', 'stand', 'hammer', {}, lw ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]); continue;
          case 'wheel': beside(0.3, 'wheel', 'sit', 'throw', { seat: 0.45, stool: true }); continue;
          case 'block': beside(0.45, 'block', 'stand', 'chop'); continue;
          case 'workbench': beside(0.45, 'workbench', 'stand', 'saw', {}, lw ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]); continue;
          // the barber standing at the chair, the one shaved sitting in it
          case 'chair': { const [x, y] = toWorld(b, f.a, f.c); beside(0.42, 'chair', 'stand', 'shave', { chair: { x, y, z, seat: 0.47 } }); continue; }
          case 'table': if (f.board) { if (face !== undefined) before(0.4, 'board', 'stand', 'knead'); continue; } break;
          // a latrine's seats, one at each hole, facing out from the wall
          case 'latrine': {
            const L = lw ? f.w : f.d, n = f.holes || 1;
            if (face !== undefined) for (let k = 0; k < n; k++) { const o = -L / 2 + (k + 0.5) * L / n, [x, y] = toWorld(b, f.a + (lw ? o : 0), f.c + (lw ? 0 : o)); S.latrines.push({ b, x, y, z, a: ang(b, face) }); }
            continue;
          }
        }
        const longW = (f.w || 0) >= (f.d || 0);
        const facing = { 0: Math.PI / 2, 2: -Math.PI / 2, 1: Math.PI, 3: 0 }[f.side];
        if (f.k === 'bed' || f.k === 'couch') {
          // lying the length of it, the head on the pillow
          const la = longW ? 0 : Math.PI / 2, [x, y] = toWorld(b, f.a, f.c), lat = longW ? f.d : f.w;
          const list = f.k === 'bed' ? S.beds : S.couches;
          list.push({ b, x, y, z: b.z0 + 0.58, a: ang(b, la), lat, side: f.side, used: 0 });
        } else if (f.k === 'table') {
          // the table, to be laid when someone eats at it
          const [x0, y0] = toWorld(b, f.a, f.c), T = tableOf(b, f, x0, y0);
          S.tables.push(T);
          for (const [da, dc, la] of [[f.w / 2 + 0.38, 0, Math.PI], [-f.w / 2 - 0.38, 0, 0], [0, f.d / 2 + 0.38, -Math.PI / 2], [0, -f.d / 2 - 0.38, Math.PI / 2]]) {
            const [x, y] = toWorld(b, f.a + da, f.c + dc);
            S.seats.push({ b, x, y, z, a: ang(b, la), table: T });
          }
        } else if (f.k === 'bench' && facing !== undefined) {
          const L = longW ? f.w : f.d, n = Math.max(1, Math.floor(L / 0.65));
          for (let q = 0; q < n; q++) {
            const o = (q + 0.5) / n * L - L / 2, [x, y] = toWorld(b, f.a + (longW ? o : 0), f.c + (longW ? 0 : o));
            S.benches.push({ b, x, y, z, a: ang(b, facing), seat: 0.37 });
          }
        } else if ((f.k === 'hearth' || f.k === 'counter' || f.k === 'stall' || f.k === 'chest') && facing !== undefined) {
          // standing before it, facing it (away from the wall it is against)
          const out = f.k === 'counter' ? 0.5 : 0.55, ux = Math.cos(facing), uy = Math.sin(facing);
          const half = Math.abs(ux) > 0.5 ? f.w / 2 : f.d / 2;
          const [x, y] = toWorld(b, f.a + ux * (half + out), f.c + uy * (half + out));
          const sp = { b, x, y, z, a: ang(b, facing + Math.PI) };
          if (f.k === 'hearth') S.hearths.push(sp);
          else if (f.k === 'counter' || f.k === 'stall') {
            // the one who sells by its end, the one who buys before it
            const L = Math.abs(ux) > 0.5 ? f.d : f.w, ex = Math.abs(ux) > 0.5 ? 0 : 1, ey = 1 - ex;
            const [sx, sy] = toWorld(b, f.a + ex * (L / 2 + 0.45) + ux * 0.1, f.c + ey * (L / 2 + 0.45) + uy * 0.1);
            const [bx2, by2] = toWorld(b, f.a + ux * (half + 1.1), f.c + uy * (half + 1.1));
            (f.k === 'counter' ? S.counters : S.stalls).push({ b, sell: { x: sx, y: sy, z, a: ang(b, facing) }, buy: { x: bx2, y: by2, z, a: ang(b, facing + Math.PI) } });
          } else S.stores.push(sp);
        } else if (f.k === 'tribunal') {
          const [x, y] = toWorld(b, f.a, f.c), toward = Math.atan2(b.y - y, b.x - x);
          S.tribunal = { b, x, y, z: b.z0 + 1.1, a: toward };
        }
      }
      for (const f of I.floors) if (f[4] !== 'pool') S.rooms.push(f);
      // the couches round the table they are about
      for (const c of S.couches) { let best = null, bd = 4; for (const T of S.tables) { const d = Math.hypot(T.x - c.x, T.y - c.y); if (d < bd) { bd = d; best = T; } } c.table = best; }
      return S;
    }
    const roomSpot = (b, r, pose = 'stand') => { const p = roomPoint(b, r); if (!p) return null; const [x, y] = toWorld(b, ...p); return spot(x, y, fz(b), range(0, TAU), pose, { cl: clusterOf(b) }); };

    // ================= the town's places =================
    const places = {};
    for (const p of town.places || []) (places[p.kind] || (places[p.kind] = [])).push(p);
    const byUse = u => B.filter(b => b.use === u);
    // points of open ground in a polygon that can be stood on, clear about
    function groundPoints(poly, n, maxCost = 1.25, clear = 1) {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), out = [];
      for (let k = 0; k < n * 12 && out.length < n; k++) {
        const x = range(Math.min(...xs), Math.max(...xs)), y = range(Math.min(...ys), Math.max(...ys));
        if (!insideConvex(poly, x, y)) continue;
        let ok = true;
        for (let dy = -clear; dy <= clear && ok; dy += clear) for (let dx = -clear; dx <= clear; dx += clear) if (!(way.costAt(x + dx, y + dy) <= maxCost)) { ok = false; break; }
        if (ok && way.comp[way.cellOf(x, y)] === mainComp) out.push([x, y]);
      }
      return out;
    }
    const forum = (places.forum || [])[0];
    const forumPts = forum ? groundPoints(forum.poly, 160) : [];
    const nymph = (places.nymphaeum || [])[0];
    const nymphPts = nymph ? groundPoints(nymph.poly, 30) : [];
    // the basilica's nave, its crowd facing the magistrates' platform
    const nave = B.find(b => b.use === 'basilica' && b.roof === 'gable');
    const naveSpots = nave ? furnitureSpots(nave) : null;
    // shops and stalls: their counters
    const counters = [], stalls = [];
    for (const b of B) if (b.interior && b.entrances && (b.use === 'shop' || b.use === 'market')) {
      const S = furnitureSpots(b);
      for (const c of S.counters) counters.push(c);
      for (const c of S.stalls) stalls.push(c);
    }
    // the fountains: room to stand at each side of the basin
    const fountains = byUse('fountain').map(b => ({ b, spots: [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([u, v]) => {
      const o = 0.55, [x, y] = toWorld(b, b.w / 2 + u * (b.w / 2 + o), b.d / 2 + v * (b.d / 2 + o));
      return way.costAt(x, y) < Infinity ? { x, y, a: Math.atan2(b.y - y, b.x - x) } : null;
    }).filter(Boolean) })).filter(f => f.spots.length);
    // and round each, a ring of open street a step or two out from the
    // basin to stand and talk in (the grand one's, its whole little square)
    fountains.forEach((f, i) => {
      const b = f.b, pts = [];
      f.key = 'fountain' + i;
      f.grand = !!nymph && insideConvex(nymph.poly, b.x, b.y);
      if (f.grand) { f.ring = nymphPts; f.key = 'nymph'; return; }
      for (let k = 0; k < 40 && pts.length < 10; k++) {
        const m = range(1.3, 2.4), s = range(-m, b.w + m), t = range(-m, b.d + m);
        if (s > -1.1 && s < b.w + 1.1 && t > -1.1 && t < b.d + 1.1) continue;
        const [x, y] = toWorld(b, s, t);
        let ok = way.comp[way.cellOf(x, y)] === mainComp;
        for (let dy = -0.7; dy <= 0.7 && ok; dy += 0.7) for (let dx = -0.7; dx <= 0.7; dx += 0.7) if (!(way.costAt(x + dx, y + dy) <= 1.25)) { ok = false; break; }
        if (ok) pts.push([x, y]);
      }
      f.ring = pts;
    });
    // the altars: the priest beyond, the worshippers before, all facing the temple
    const altars = byUse('altar').map(al => {
      let t = null, td = Infinity;
      for (const o of near(al.x, al.y, 30)) if (o.use === 'temple' && Math.hypot(o.x - al.x, o.y - al.y) < td) { td = Math.hypot(o.x - al.x, o.y - al.y); t = o; }
      const out = t ? Math.atan2(al.y - t.y, al.x - t.x) : al.angle, ux = Math.cos(out), uy = Math.sin(out);
      return { b: al, out, priest: { x: al.x + ux * 1.4, y: al.y + uy * 1.4, a: out + Math.PI }, ux, uy };
    });
    // the water one may get into: the open pools, and the warm pools in the
    // baths' halls; whoever's way in or out goes through it swims it
    const waters = [];
    for (const g of town.grounds) if (g.kind === 'pool') waters.push(g.poly);
    for (const h of byUse('baths')) if (h.interior) for (const f of h.interior.floors) if (f[4] === 'pool') waters.push([toWorld(h, f[0], f[1]), toWorld(h, f[2], f[1]), toWorld(h, f[2], f[3]), toWorld(h, f[0], f[3])]);
    const waterBox = waters.map(q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))]);
    const wet = (x, y) => { for (let k = 0; k < waters.length; k++) { const B = waterBox[k]; if (x > B[0] && x < B[2] && y > B[1] && y < B[3] && insideConvex(waters[k], x, y)) return true; } return false; };
    // the baths: the exercise court, its pool, the halls' benches and warm pools
    const bath = (() => {
      const pal = byUse('palaestra')[0];
      if (!pal) return null;
      const C = clusterOf(pal), [s1, t1, s2, t2] = pal.hole, court = [];
      for (let k = 0; k < 60; k++) {
        const s = range(s1 + 1, s2 - 1), t = range(t1 + 1, t2 - 1), [x, y] = toWorld(pal, s, t);
        // (a couple of metres clear of the pool all round)
        if (wet(x, y) || Array.from({ length: 8 }, (_, k) => k * TAU / 8).some(a => wet(x + Math.cos(a) * 2, y + Math.sin(a) * 2))) continue;
        court.push([x, y]);
      }
      const pool = town.grounds.find(g => g.kind === 'pool' && insideConvex([toWorld(pal, s1, t1), toWorld(pal, s2, t1), toWorld(pal, s2, t2), toWorld(pal, s1, t2)], ...g.poly[0]));
      const halls = byUse('baths').filter(b => b.shape === 'box' && b.interior), benches = [], pools = [];
      for (const h of halls) {
        const S = furnitureSpots(h);
        benches.push(...S.benches.map(s => spot(s.x, s.y, s.z, s.a, 'sit', { seat: s.seat, cl: clusterOf(h) })));
        for (const f of h.interior.floors) if (f[4] === 'pool') for (let k = 0; k < 6; k++) {
          const [x, y] = toWorld(h, range(f[0] + 0.5, f[2] - 0.5), range(f[1] + 0.5, f[3] - 0.5));
          pools.push(spot(x, y, h.z0 + 0.1, range(0, TAU), 'swim', { cl: clusterOf(h) }));
        }
      }
      // (the open pool's long way, and how wide it is to swim in)
      let lanes = null;
      if (pool) {
        const q = pool.poly, cx = q.reduce((a, p) => a + p[0], 0) / q.length, cy = q.reduce((a, p) => a + p[1], 0) / q.length;
        let best = null, bl = 0;
        for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } }
        let w = Infinity;
        for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < w) w = l; }
        if (best && bl > 4 && w > 2) lanes = { cx, cy, ux: best[0], uy: best[1], hl: bl / 2 - 0.8, hw: w / 2 - 0.6 };
      }
      return { pal, C, court, pool, benches, pools, lanes };
    })();
    // the market: its court, about the pavilion
    const market = (() => {
      const m = byUse('market')[0];
      if (!m) return null;
      const [s1, t1, s2, t2] = m.hole, pts = [];
      for (let k = 0; k < 40; k++) {
        const [x, y] = toWorld(m, range(s1 + 0.8, s2 - 0.8), range(t1 + 0.8, t2 - 0.8));
        if (![...near(x, y, 8)].some(o => o.use === 'tholos' && Math.hypot(o.x - x, o.y - y) < o.r + 1.2)) pts.push([x, y]);
      }
      return { b: m, C: clusterOf(m), pts };
    })();
    // where the carts' loads are put away: the storehouse's rooms, by what
    // each keeps, each with the step outside its door on the court and a
    // spot just inside it; the market's stalls, for the produce
    const stores = {};
    for (const b of byUse('horreum')) {
      const C = clusterOf(b), e = b.entrances && b.entrances[0], ent = C && C.ents.find(q => q.b === b);
      if (!e || !ent || !ent.ok) continue;
      const [ix, iy] = toWorld(b, e.s - e.nx * 1.1, e.t - e.ny * 1.1);
      (stores[b.goods] || (stores[b.goods] = [])).push({ b, out: ent.out, drop: () => spot(ix, iy, NaN, Math.atan2(iy - ent.out[1], ix - ent.out[0]), 'bend', { cl: C }) });
    }
    if (market) {
      const ent = market.C && market.C.ents.find(q => q.ok), mine = stalls.filter(c => c.b === market.b);
      if (ent && mine.length) stores.market = [{ b: market.b, out: ent.out, drop: () => { const c = choice(mine); return spot(c.sell.x, c.sell.y, c.sell.z, c.sell.a, 'bend', { cl: market.C }); } }];
    }
    const storeFor = load => {
      const produce = load === 'vegetables' || load === 'fruit';
      const list = (produce && stores.market) || stores[produce ? 'produce' : load] || Object.values(stores).flat();
      return list.length ? choice(list) : null;
    };
    // the theatre's seats and stage, the amphitheatre's seats and sand
    const cavea = byUse('theatre').find(b => b.shape === 'cavea');
    const stage = byUse('stage')[0], scaena = byUse('scaena')[0];
    const amph = B.find(b => b.shape === 'arena');
    // the gates: a guard either side, outside; and where each is on the wall
    const gates = town.gates.map(g => {
      const ux = Math.cos(g.angle), uy = Math.sin(g.angle), wt = town.town.wall.thickness;
      const gb = [...near(g.x, g.y, 4)].find(b => b.use === 'gate');
      const half = gb ? Math.min(gb.w, gb.d) / 2 : 6, lat = gb ? Math.max(gb.w, gb.d) / 2 - 1.2 : 5;
      const at = d => [g.x + ux * d, g.y + uy * d];
      return {
        g, ux, uy, inner: at(-wt / 2 - 4), outer: at(wt / 2 + 4),
        guards: [-1, 1].map(sg => { const [x, y] = at(half + 1.5); return { x: x - uy * sg * lat, y: y + ux * sg * lat, a: g.angle }; }),
      };
    });
    // the walk along the top of the wall, and how high it is there (over a
    // tower's flat top, up on it; through a roofed one, inside)
    const wallWalk = (() => {
      const flatTop = b => b.use === 'tower' && b.roof === 'flat';
      const pts = town.town.outline.map(([x, y]) => {
        let z = -Infinity;
        for (const b of near(x, y, 2)) if ((b.use === 'wall' || b.use === 'gate') && RomanTown.onBuilding(b, x, y, 0.6) || flatTop(b) && RomanTown.onBuilding(b, x, y, -0.4)) z = Math.max(z, b.z0 + b.h);
        return [x, y, z];
      });
      for (let i = 0; i < pts.length; i++) if (pts[i][2] === -Infinity) { const p = pts[(i + pts.length - 1) % pts.length]; pts[i][2] = p[2] === -Infinity ? hAt(pts[i][0], pts[i][1]) + town.town.wall.height : p[2]; }
      const atGate = gates.map(G => { let best = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p[0] - G.g.x, p[1] - G.g.y); if (d < bd) { bd = d; best = i; } }); return best; });
      // the towers along it (a point of the walk in each)
      const towerAt = new Set();
      for (const t of byUse('tower')) {
        let best = -1, bd = 7;
        pts.forEach((p, i) => { const d = Math.hypot(p[0] - t.x, p[1] - t.y); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) towerAt.add(best);
      }
      // the lookouts' posts, every other tower: up on its top, at the
      // parapet on the country's side; by a roofed one, on the walk beside
      // it; each with the way up to it from the nearest gate, along the walk
      const n = pts.length, ring = (a, b) => Math.min((a - b + n) % n, (b - a + n) % n);
      const posts = [];
      if (n && gates.length) byUse('tower').forEach((t, k) => {
        if (k % 2) return;
        let q = -1, bd = 7;
        pts.forEach((p, i) => { const d = Math.hypot(p[0] - t.x, p[1] - t.y); if (d < bd) { bd = d; q = i; } });
        if (q < 0) return;
        const ol = Math.hypot(t.x - town.town.x, t.y - town.town.y) || 1, ox = (t.x - town.town.x) / ol, oy = (t.y - town.town.y) / ol;
        const size = t.shape === 'round' ? 2 * t.r : Math.min(t.w, t.d);
        let x, y, z;
        if (t.roof === 'flat') { x = t.x + ox * size * 0.22; y = t.y + oy * size * 0.22; z = t.z0 + t.h; }
        else {
          // (the first point of the walk clear of the tower, a little to the outer side)
          let p = q;
          for (let s = 1; s < 12; s++) { const r = (q + s) % n; if (Math.hypot(pts[r][0] - t.x, pts[r][1] - t.y) > size / 2 + 1.2) { p = r; break; } }
          if (p === q) return;
          q = p; x = pts[q][0] + ox * 0.5; y = pts[q][1] + oy * 0.5; z = pts[q][2];
        }
        let gi = 0;
        atGate.forEach((g, i) => { if (ring(g, q) < ring(atGate[gi], q)) gi = i; });
        const g = atGate[gi], dir = (q - g + n) % n <= n / 2 ? 1 : -1, up = [];
        for (let i = g, s = 0; s < n; s++, i = (i + dir + n) % n) { up.push(pts[i]); if (i === q) break; }
        up.push([x, y, z]);
        posts.push({ x, y, z, out: Math.atan2(oy, ox), gate: gi, up });
      });
      return { pts, atGate, towerAt, posts };
    })();
    // the river's banks, a step from the water
    const banks = [];
    if (town.river) {
      const R = town.river, P = R.points;
      for (let k = 2; k + 2 < P.length; k += 2) {
        const [a, b] = [P[k], P[k + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        for (const sg of [-1, 1]) {
          const o = R.width / 2 + 0.9, x = a[0] + nx * sg * o, y = a[1] + ny * sg * o;
          const kc = way.cellOf(x, y);
          if (kc < 0 || way.cost[kc] === Infinity || way.comp[kc] !== mainComp) continue;
          banks.push({ x, y, z: R.level[k] + 0.4, a: Math.atan2(-ny * sg, -nx * sg), k });
        }
      }
    }
    const tombs = byUse('tomb').map(t => {
      let best = null, bd = Infinity;
      for (const r of town.roads) if (r.kind === 'via') for (const p of r.points) { const d = Math.hypot(p[0] - t.x, p[1] - t.y); if (d < bd) { bd = d; best = p; } }
      const a = best ? Math.atan2(best[1] - t.y, best[0] - t.x) : 0, o = reach(t) * 0.75 + 1.4;
      return { b: t, x: t.x + Math.cos(a) * o, y: t.y + Math.sin(a) * o, a: a + Math.PI };
    }).filter(t => way.costAt(t.x, t.y) < Infinity);
    // a tree's shade, the side away from the sun
    const shadeTrees = town.trees.filter(t => t.kind !== 'shrub' && t.r > 2);
    const treeIndex = new Map();
    for (const t of shadeTrees) { const k = ikey(Math.floor(t.x / 16), Math.floor(t.y / 16)); if (!treeIndex.has(k)) treeIndex.set(k, []); treeIndex.get(k).push(t); }
    function shadeNear(x, y, r) {
      let best = null, bd = r;
      for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) for (let j = Math.floor((y - r) / 16); j <= Math.floor((y + r) / 16); j++)
        for (const t of treeIndex.get(ikey(i, j)) || []) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    let sunAz = Math.PI;
    const shadeOf = (t, k = 0) => {
      const a = sunAz + Math.PI + range(-0.6, 0.6), d = t.r * range(0.3, 0.75);
      // (north up, y down: the sun's azimuth from north clockwise)
      const x = t.x + Math.sin(a) * d, y = t.y - Math.cos(a) * d;
      return way.costAt(x, y) < Infinity ? [x, y] : null;
    };

    // ================= the households =================
    const homes = [];
    const centre = [town.town.x, town.town.y], townR = Math.hypot(town.town.hu, town.town.hv);
    {
      const seen = new Set();
      for (const b of B) {
        if (!b.interior || seen.has(b) || !['house', 'domus', 'insula', 'shop', 'villa'].includes(b.use)) continue;
        const C = clusterOf(b);
        if (!C) continue;
        for (const o of C.bs) seen.add(o);
        const S = { beds: [], couches: [], seats: [], benches: [], hearths: [], counters: [], stalls: [], stores: [], rooms: [], tables: [], work: [], latrines: [] };
        for (const o of C.bs) {
          const s = furnitureSpots(o);
          for (const k in S) S[k].push(...s[k].map(v => Array.isArray(v) ? { b: o, r: v } : v));
        }
        const front = C.ents.find(e => e.kind === 'front' && e.ok) || C.ents.find(e => e.ok) || C.ents[0];
        if (!front) continue;
        const kind = b.use === 'domus' ? 'domus' : b.use;
        const outer = Math.hypot(b.x - centre[0], b.y - centre[1]) / townR;
        homes.push({ kind, C, S, front, outer, people: [], b });
      }
    }
    // the farms' barns, by their farm
    const barns = byUse('barn').map(b => ({ b, C: clusterOf(b), S: b.interior ? furnitureSpots(b) : null }));
    for (const h of homes) if (h.kind === 'villa') {
      let best = null, bd = 60;
      for (const br of barns) { const d = Math.hypot(br.b.x - h.b.x, br.b.y - h.b.y); if (d < bd) { bd = d; best = br; } }
      h.barn = best;
    }

    // ================= everyone =================
    const all = [];
    let ids = 1;
    function being(kind, o = {}) {
      const ag = { id: ids++, kind, x: 0, y: 0, z: 0, a: rng() * TAU, pose: 'stand', anim: null, ph: rng(), seat: 0, carry: null, vis: true, torch: false,
        legs: [], leg: null, cl: null, speed: 1.25, ...o };
      all.push(ag);
      return ag;
    }
    const person = (home, sex, age, o = {}) => {
      const ag = being('person', { home, sex, age, dress: o.dress || (sex === 'f' ? 'stola' : 'tunic'), speed: age === 'old' ? range(0.8, 1) : age === 'child' ? range(1.05, 1.25) : range(1.15, 1.4), plan: null, planDay: -1, torchy: chance(0.65), ...o });
      if (home) home.people.push(ag);
      return ag;
    };
    // whom the jobs go to
    const men = [];
    for (const h of homes.slice()) {
      // more families upstairs: in an apartment block two to four, over a house now and then
      const upstairs = h.kind === 'insula' ? 2 + (rng() * 3 | 0) : h.kind === 'house' && chance(0.4) ? 1 : 0;
      const fams = [h, ...Array.from({ length: upstairs }, () => ({ ...h, upstairs: true, people: [], shop: null }))];
      if (h.kind === 'shop') h.upstairs = true;
      for (const f of fams) {
        if (f !== h) homes.push(f);
        if (f.kind === 'villa') {
          // the farmer and his wife, and the slaves who work the farm with him
          const m = person(f, 'm', 'adult', { job: 'farmer' }), w = person(f, 'f', 'adult', { job: 'wife' });
          for (let k = 0, n = 2 + (rng() * 3 | 0); k < n; k++) person(f, 'm', 'adult', { job: 'farmer', dress: 'work', bond: true });
          for (let k = 0, n = rng() * 3 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
          f.master = m; f.mistress = w;
          continue;
        }
        if (f.kind === 'domus') {
          // the patron and his lady, their children, and their household's
          // slaves: one keeping the door, one to cook, one to walk behind
          // the master when he goes out, and maids
          const m = person(f, 'm', 'adult', { job: 'patron', dress: 'toga' }), w = person(f, 'f', 'adult', { job: 'domina' });
          f.master = m; f.mistress = w;
          for (let k = 0, n = rng() * 4 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
          const roles = ['doorkeeper', 'cook', 'escort', 'maid', 'maid', 'maid', 'cook'];
          for (let k = 0, n = 2 + (rng() * 4 | 0); k < n; k++) {
            const role = roles[k], sex = role === 'doorkeeper' || role === 'escort' ? 'm' : role === 'maid' ? 'f' : chance(0.5) ? 'm' : 'f';
            person(f, sex, 'adult', { job: 'slave', role, dress: 'slave', bond: true });
          }
          if (chance(0.25)) person(f, chance(0.5) ? 'm' : 'f', 'old', { job: 'old' });
          continue;
        }
        // a house, a shop, an apartment
        const single = chance(0.15);
        const m = !single || chance(0.6) ? person(f, 'm', 'adult', { job: null }) : null;
        const w = !single || !m ? person(f, 'f', 'adult', { job: f.kind === 'shop' && !m ? 'keeper' : 'wife' }) : null;
        if (m) men.push(m);
        f.master = m; f.mistress = w;
        if (!single) for (let k = 0, n = rng() * 3.4 | 0; k < n; k++) person(f, chance(0.5) ? 'm' : 'f', 'child', { job: 'child' });
        if (chance(0.2)) person(f, chance(0.5) ? 'm' : 'f', 'old', { job: 'old' });
      }
    }
    // the shops and their trades: what is done in each and where, the
    // counter it sells over, who keeps it and who works in it
    const SHOPJOB = { forica: 'foricarius', caupona: 'innkeeper', bakery: 'baker', smithy: 'smith', fullery: 'fuller', pottery: 'potter', butcher: 'butcher', grocer: 'grocer', wine: 'vintner', weaver: 'weaver', cobbler: 'cobbler', carpenter: 'carpenter', barber: 'barber' };
    const FOOD = new Set(['caupona', 'bakery', 'butcher', 'grocer', 'wine']);
    const shops = [];
    for (const h of homes) if (h.kind === 'shop' && h.b.trade && !shops.some(W => W.C === h.C)) {
      const trade = h.b.trade || 'grocer', mine = counters.filter(c => h.C.bs.includes(c.b));
      for (const c of mine) c.trade = trade;
      const W = { h, b: h.b, C: h.C, trade, work: h.S.work, counters: mine, benches: h.S.benches, hands: [], keeper: null };
      h.shop = W;
      shops.push(W);
    }
    const shopsOf = trade => shops.filter(W => W.trade === trade);
    const foricae = shopsOf('forica').filter(W => W.h.S.latrines.length);
    // the trades: the shopkeepers by their shops; the town's servants; the
    // workshops' hands; farmers more the further out they live; and the
    // rest a trade at home, or carrying for hire
    const pastures = town.fields.filter(f => f.crop === 'pasture' && f.gate && f.gateway && f.poly.every(([x, y]) => x > 2 && y > 2 && x < town.W - 2 && y < town.H - 2));
    const crops = town.fields.filter(f => f.crop !== 'pasture' && f.poly.every(([x, y]) => x > 1 && y > 1 && x < town.W - 1 && y < town.H - 1));
    const patrons = all.filter(a => a.job === 'patron');
    const amphTown = !!B.find(b => b.shape === 'arena'), theatreTown = !!(byUse('theatre').find(b => b.shape === 'cavea') && byUse('stage')[0]);
    {
      for (const h of homes) if (h.shop) {
        const W = h.shop, k = h.master || h.mistress;
        if (!k) continue;
        k.job = SHOPJOB[W.trade] || 'grocer'; k.shop = W; W.keeper = k;
        // the wife at the counter a while each morning
        if (h.master && h.mistress) h.mistress.shopwife = W;
      }
      const free = men.filter(m => !m.job).sort(() => rng() - 0.5);
      const take = (n, job, pref, o = {}) => {
        const pool = pref ? free.slice().sort((a, b) => pref(b) - pref(a)) : free.slice(), got = pool.slice(0, Math.max(0, n));
        for (const m of got) { m.job = job; Object.assign(m, o); free.splice(free.indexOf(m), 1); }
        return got;
      };
      take(gates.length * 2, 'guard');
      take(wallWalk.pts.length ? gates.length * 4 : 0, 'sentry');
      take(Math.min(16, wallWalk.posts.length) * 2, 'lookout');
      take(4, 'watch');
      for (const al of altars.slice(0, 3)) take(1, 'priest', m => -m.home.outer);
      if (forum) take(1, 'teacher');
      if (bath) take(2, 'attendant');
      if (town.river && banks.length) take(1 + (rng() * 2 | 0), 'fisher', m => m.home.outer);
      take(all.length > 900 ? 2 : 1, 'doctor', m => -m.home.outer);
      if (forum) { take(2, 'scribe', m => -m.home.outer); take(1, 'banker', m => -m.home.outer); }
      if (patrons.length) take(Math.min(2, patrons.length) * 2, 'lictor', m => -m.home.outer);
      take(2, 'musician');
      if (theatreTown) take(4, 'actor');
      if (amphTown) { take(6, 'gladiator'); take(2, 'venator'); }
      take(tombs.length ? 3 : 2, 'mason');
      take(all.length > 900 ? 4 : 2, 'woodcutter', m => m.home.outer);
      if (fountains.length) take(2, 'water');
      // hands for the workshops: the bakeries' millers and oven-men, a
      // smith's striker, the fullers' treaders, a potter's, a carpenter's
      const HANDS = { bakery: 2, smithy: 1, fullery: 2, pottery: 1, carpenter: 1, weaver: 0, butcher: 1, caupona: 0 };
      for (const W of shops) for (const m of take(HANDS[W.trade] || 0, 'hand', m => -Math.hypot(m.home.b.x - W.b.x, m.home.b.y - W.b.y))) { m.shop = W; W.hands.push(m); }
      take(Math.round(free.length * 0.4), 'farmer', m => m.home.outer + rng() * 0.3);
      const CRAFTS = [['a cobbler', 'stitch'], ['a basket-maker', 'basket'], ['a carver', 'craft'], ['a lamp-maker', 'craft'], ['a tailor', 'stitch'], ['a rope-maker', 'craft'], ['a carpenter', 'saw']];
      for (const m of free) if (chance(0.55)) { const [t, a] = choice(CRAFTS); m.job = 'artisan'; m.title = t; m.craft = a; } else m.job = 'porter';
    }
    // the patrons: two of them magistrates, each with his lictors; and
    // the patrons' clients, who call on them at dawn
    patrons.slice(0, 2).forEach(p => p.magistrate = true);
    all.filter(a => a.job === 'lictor').forEach((l, k) => { l.magistrate = patrons[(k >> 1) % Math.max(1, Math.min(2, patrons.length))]; });
    for (const a of all) if (a.kind === 'person' && a.age === 'adult' && a.sex === 'm' && a.job !== 'patron' && !a.bond && patrons.length && chance(0.3)) a.patron = choice(patrons);
    // the gladiators two by two
    all.filter(a => a.job === 'gladiator').forEach((g, k, G) => { g.pair = G[k ^ 1] || null; g.armed = k % 2 ? 'net' : 'sword'; });
    // the children: the boys at school, mostly; an older one now and then
    // at his father's work beside him
    for (const a of all) if (a.job === 'child') {
      a.pupil = a.sex === 'm' && chance(0.6);
      const dad = a.home.master;
      if (!a.pupil && a.sex === 'm' && dad && chance(0.4) && ['smith', 'potter', 'carpenter', 'cobbler', 'fuller', 'artisan', 'baker', 'butcher', 'farmer', 'fisher', 'shepherd'].includes(dad.job)) a.helps = dad;
    }
    // the farmers' fields
    const farmers = all.filter(a => a.job === 'farmer');
    for (const f of farmers) {
      // a field near home, or near the farm
      const hx = f.home.b.x, hy = f.home.b.y, list = f.home.kind === 'villa' ? crops.slice().sort((p, q) => Math.hypot(p.poly[0][0] - hx, p.poly[0][1] - hy) - Math.hypot(q.poly[0][0] - hx, q.poly[0][1] - hy)).slice(0, 6) : crops;
      f.field = list.length ? choice(list) : null;
      if (!f.field) { f.job = 'porter'; }
    }

    // ================= the beasts =================
    const herds = [];
    // ---- the grass on the pastures: some lush, some grazed bare; eaten down
    // by what grazes there, the more the more of it and the bigger, growing
    // back slowly where nothing does ----
    const grass = new Float32Array(town.fields.length).fill(1);
    let grassV = 0, grassT = 0;
    town.fields.forEach((f, i) => { f.idx = i; f.area = Math.abs(f.poly.reduce((a, p, k) => { const q = f.poly[(k + 1) % f.poly.length]; return a + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2; if (f.crop === 'pasture') grass[i] = range(0.3, 1); });
    const BITE = { sheep: 1, goat: 1, pig: 1.6, cow: 4, horse: 4 }, EATG = 0.0011, GROW = 1 / (18 * 3600);
    function grow(dt) {
      for (const f of pastures) { const i = f.idx; if (!f.herd || f.herd.mode !== 'graze') grass[i] = Math.min(1, grass[i] + GROW * dt * (heat() > 1.3 ? 0.5 : 1)); }
      for (const Hd of herds) if (Hd.mode === 'graze') { const i = Hd.f.idx; grass[i] = Math.max(0, grass[i] - EATG * Hd.beasts.length * (BITE[Hd.kind] || 1) * dt / Math.max(200, Hd.f.area)); }
      grassV++;
    }
    // a herd's pasture: its middle, its frame along the field's rows, how
    // far it reaches each way (a step in from its wall), its shade tree
    function frameOf(f) {
      const xs = f.poly.map(p => p[0]), ys = f.poly.map(p => p[1]), c = Math.cos(f.angle), s = Math.sin(f.angle);
      const cx = xs.reduce((a, b) => a + b) / xs.length, cy = ys.reduce((a, b) => a + b) / ys.length;
      const loc = f.poly.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
      const hu = Math.max(...loc.map(p => Math.abs(p[0]))) - 1.6, hv = Math.max(...loc.map(p => Math.abs(p[1]))) - 1.6;
      return { f, cx, cy, c, s, hu, hv };
    }
    function settle(H, f) {
      const F = frameOf(f);
      if (H.f && H.f.herd === H) H.f.herd = null;
      Object.assign(H, F);
      f.herd = H;
      H.shade = shadeNear(F.cx, F.cy, Math.max(F.hu, F.hv));
      if (H.shade && Math.abs((H.shade.x - F.cx) * F.c + (H.shade.y - F.cy) * F.s) > F.hu + 3) H.shade = null;
      H.pt = (u, v) => [F.cx + u * F.c - v * F.s, F.cy + u * F.s + v * F.c];
      H.local = (x, y) => [(x - F.cx) * F.c + (y - F.cy) * F.s, -(x - F.cx) * F.s + (y - F.cy) * F.c];
      H.clampU = (u, v) => [clamp(u, -F.hu, F.hu), clamp(v, -F.hv, F.hv)];
      H.mx = range(-F.hu, F.hu) * 0.4; H.my = range(-F.hv, F.hv) * 0.4;
      // (moved on when the grass is grazed down, or after a long while anyway)
      H.until = now + range(8, 14) * 3600;
      // its water: a trough by the pasture's well, if it has one, or just
      // inside its gate, to one side of it
      H.trough = null;
      for (const b of near(F.cx, F.cy, Math.max(F.hu, F.hv) + 2)) if (b.use === 'well') {
        const [u, v] = H.local(b.x, b.y);
        if (Math.abs(u) < F.hu && Math.abs(v) < F.hv) { const a = Math.atan2(F.cy - b.y, F.cx - b.x), x = b.x + Math.cos(a) * (b.r + 1), y = b.y + Math.sin(a) * (b.r + 1); if (way.costAt(x, y) < Infinity) H.trough = { x, y, a: a + Math.PI / 2 }; break; }
      }
      const g = !H.trough && gateOf(f);
      if (g) for (const sg of [1, -1]) { const x = g.inn[0] + g.ny * sg * 2.6 + g.nx * 0.6, y = g.inn[1] - g.nx * sg * 2.6 + g.ny * 0.6, [u, v] = H.local(x, y); if (Math.abs(u) < F.hu + 0.5 && Math.abs(v) < F.hv + 0.5 && way.costAt(x, y) < Infinity) { H.trough = { x, y, a: Math.atan2(g.ny, g.nx) + Math.PI / 2 }; break; } }
      if (H.trough) H.trough.kind = 'trough';
    }
    {
      let budget = 520;
      for (const f of pastures.slice().sort((p, q) => (q.pigs ? 1 : 0) - (p.pigs ? 1 : 0) || rng() - 0.5)) {
        if (budget <= 0 || (!f.pigs && chance(0.45))) continue;
        const F = frameOf(f);
        if (F.hu < 4 || F.hv < 4) continue;
        const kind = f.pigs ? 'pig' : wpick({ sheep: 4, goat: 1.6, cow: 2, horse: 0.8 });
        const n = Math.min(budget, kind === 'sheep' ? 8 + (rng() * 22 | 0) : kind === 'goat' ? 5 + (rng() * 10 | 0) : kind === 'cow' ? 3 + (rng() * 7 | 0) : kind === 'pig' ? 4 + (rng() * 8 | 0) : 2 + (rng() * 5 | 0));
        const H = { kind, spread: kind === 'sheep' ? range(3, 6) : kind === 'pig' ? range(4, 7) : range(5, 10), beasts: [], mode: 'graze' };
        settle(H, f);
        // (its grass as it is: some herds on a pasture about grazed down, some on fresh)
        grass[f.idx] = range(0.12, 0.9);
        for (let k = 0; k < n; k++) {
          const [u, v] = H.clampU(H.mx + gauss() * H.spread, H.my + gauss() * H.spread * 0.7), [x, y] = H.pt(u, v);
          H.beasts.push(being(kind, { herd: H, u, v, x, y, z: hAt(x, y), speed: kind === 'horse' ? 1.3 : kind === 'cow' ? 0.7 : kind === 'pig' ? 0.5 : 0.6, look: rng(), muddy: kind === 'pig' ? rng() : 0 }));
        }
        budget -= n;
        herds.push(H);
      }
      // a shepherd for a flock, if there is anyone to spare, mostly with a
      // dog; a herdsman for some of the cattle and the horses, a dog now and then
      const spare = all.filter(a => a.job === 'artisan' || a.job === 'porter').sort(() => rng() - 0.5);
      spare.length = Math.min(spare.length, Math.max(Math.round(spare.length * 0.4), herds.length));
      for (const H of herds.slice().sort((p, q) => (q.kind === 'sheep' || q.kind === 'goat') - (p.kind === 'sheep' || p.kind === 'goat'))) {
        const flock = H.kind === 'sheep' || H.kind === 'goat';
        if (!spare.length || (H.kind === 'pig' && chance(0.4))) continue;
        const m = spare.pop();
        m.job = flock ? 'shepherd' : 'herdsman'; m.herd = H; H.shepherd = m; m.title = H.kind === 'pig' ? 'a swineherd' : null; m.craft = null;
        if (chance(flock ? 0.75 : 0.4)) H.dog = being('dog', { master: m, speed: 1.8, look: rng() });
      }
    }
    // the arena's beasts, from the far ends of the empire: a lion and a
    // lioness, a bear, an elephant, two ostriches; and two black bulls from
    // the pastures; each in its cage by the amphitheatre, let out onto the
    // sand on a games day for the hunt and for the gladiators
    const zoo = [], cages = [];
    if (amph) {
      const b = amph, ca = Math.cos(b.angle), sa = Math.sin(b.angle), at = (rho, t) => { const x = rho * b.a * Math.cos(t), y = rho * b.b * Math.sin(t); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca]; };
      const kinds = [['lion', true], ['lion', false], ['bear'], ['elephant'], ['ostrich'], ['ostrich'], ['bull', true], ['bull', true]];
      // (a row of them along the wall outside, beside a way in, where there is ground for them)
      for (const t0 of [0.22, Math.PI + 0.22, Math.PI / 2 + 0.25, -Math.PI / 2 + 0.25]) {
        for (let k = 0, t = t0; k < 40 && cages.length < kinds.length; k++, t += 0.045) {
          const big = kinds[cages.length][0] === 'elephant', rho = 1 + (big ? 5 : 3.2) / b.a, [x, y] = at(rho, t);
          if (cages.some(c => Math.hypot(c.x - x, c.y - y) < (big || c.big ? 6.5 : 4.2))) continue;
          if (![[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]].every(([dx, dy]) => way.costAt(x + dx, y + dy) < 4)) continue;
          cages.push({ kind: 'cage', x, y, z: hAt(x, y), a: Math.atan2(y - b.y, x - b.x) + Math.PI / 2, big, id: 9000 + cages.length });
        }
        if (cages.length >= kinds.length) break;
      }
      cages.forEach((c, k) => { const [kind, male] = kinds[k]; zoo.push(being(kind, { cage: c, male, exotic: true, x: c.x, y: c.y, z: c.z, speed: kind === 'ostrich' ? 1.6 : kind === 'elephant' ? 0.8 : kind === 'bear' ? 0.9 : kind === 'bull' ? 1.1 : 1.2, look: rng() })); });
    }
    // the farms' beasts: a yoke of oxen, a donkey, a dog or two, hens
    for (const h of homes) if (h.kind === 'villa') {
      const b = h.b, [s1, t1, s2, t2] = b.hole;
      h.yard = [s1 + 1, t1 + 1, s2 - 1, t2 - 1];
      const [fx, fy] = h.front.out, at = { x: fx, y: fy, z: hAt(fx, fy) };
      h.oxen = [being('ox', { farm: h, speed: 0.85, look: rng(), ...at }), being('ox', { farm: h, speed: 0.85, look: rng(), ...at })];
      if (chance(0.7)) being('donkey', { farm: h, speed: 1, look: rng(), ...at });
      for (let k = 0, n = 1 + (rng() * 2 | 0); k < n; k++) being('dog', { farm: h, speed: 1.8, look: rng(), ...at });
      for (let k = 0, n = 5 + (rng() * 8 | 0); k < n; k++) being('hen', { farm: h, speed: 0.4, look: rng(), ...at });
      const ploughers = h.people.filter(p => p.job === 'farmer');
      if (ploughers.length) h.oxen.forEach(o => o.driver = ploughers[0]);
      ploughers[0] && (ploughers[0].team = h.oxen);
    }
    // hens behind some houses, in the yard by the back door
    for (const h of homes) if ((h.kind === 'house') && chance(0.25)) {
      const e = h.C.ents.find(e => e.kind === 'back');
      if (!e) continue;
      h.coop = e;
      for (let k = 0, n = 2 + (rng() * 4 | 0); k < n; k++) being('hen', { coop: e, speed: 0.4, look: rng() });
    }
    // dogs and cats about the streets
    const streetPts = (() => {
      const out = [], p = town.town, poly = town.town.outline;
      for (let k = 0; k < 4000 && out.length < 400; k++) {
        const x = range(p.x - p.hu * 1.2, p.x + p.hu * 1.2), y = range(p.y - p.hu * 1.2, p.y + p.hu * 1.2), kc = way.cellOf(x, y);
        if (kc < 0 || way.cost[kc] > 1.01 || way.comp[kc] !== mainComp) continue;
        // (inside the walls)
        let inn = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y) !== (poly[j][1] > y) && x < (poly[j][0] - poly[i][0]) * (y - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) inn = !inn;
        if (inn) out.push([x, y]);
      }
      return out;
    })();
    if (streetPts.length) {
      for (let k = 0, n = 5 + (rng() * 8 | 0); k < n; k++) { const [x, y] = choice(streetPts); being('dog', { stray: true, x, y, z: hAt(x, y), speed: 1.6, look: rng() }); }
      for (let k = 0, n = 3 + (rng() * 5 | 0); k < n; k++) { const [x, y] = choice(streetPts); being('cat', { stray: true, x, y, z: hAt(x, y), speed: 1.1, look: rng() }); }
    }
    // the roads' far ends, where travellers come from and go
    const ends = [];
    for (const r of town.roads) if (r.kind === 'via') {
      for (let q = r.points.length - 1; q > 0; q--) {
        const [x, y] = r.points[q];
        if (x > 4 && y > 4 && x < town.W - 4 && y < town.H - 4) {
          const k = way.snap(x, y, 4);
          if (k >= 0 && way.comp[k] === mainComp) { ends.push({ x, y, road: r, q }); break; }
        }
      }
    }
    // travellers: on foot, on horseback, with donkeys, with carts; a cart
    // laden with what the country sends the town, and what the one
    // unloading it carries in at a time
    const LOADS = ['firewood', 'hay', 'vegetables', 'fruit', 'grain'];
    const ITEM = { firewood: 'wood', hay: 'hay', vegetables: 'basket', fruit: 'basket', grain: 'sack' };
    const travellers = [];
    // (country folk come in by day to the market, the forum, the shops, the temples)
    if (ends.length) for (let k = 0, n = 34 + (rng() * 16 | 0); k < n; k++) {
      const type = wpick({ walker: 9, rider: 2, donkeys: 2.5, cart: 1.6 });
      const t = type === 'rider' ? being('rider', { speed: range(1.5, 1.9), look: rng(), dress: 'tunic', sex: 'm', age: 'adult' })
        : person(null, chance(0.85) ? 'm' : 'f', 'adult', { job: 'traveller', dress: chance(0.3) ? 'cloak' : 'tunic' });
      t.traveller = type; t.vis = false; t.torchy = true;
      if (type === 'rider') t.man = person(null, 'm', 'adult', { ride: t, dress: chance(0.4) ? 'cloak' : 'tunic', vis: false, job: 'rider' });
      if (type === 'donkeys') t.train = Array.from({ length: 1 + (rng() * 3 | 0) }, () => being('donkey', { follow: t, speed: 1.1, look: rng(), laden: true, vis: false }));
      if (type === 'cart') {
        t.train = [being('ox', { follow: t, speed: 0.9, look: rng(), yoke: -1, vis: false }), being('ox', { follow: t, speed: 0.9, look: rng(), yoke: 1, vis: false })];
        t.cart = being('cart', { follow: t, look: rng(), load: choice(LOADS), left: 1, vis: false });
        t.speed = 0.85;
      }
      if (type === 'walker') t.carry = chance(0.6) ? 'bundle' : null;
      travellers.push(t);
    }
    // boats on the river
    const boats = [];
    if (town.river && town.river.points.length > 10) {
      const R = town.river, L = [0];
      for (let k = 1; k < R.points.length; k++) L.push(L[k - 1] + Math.hypot(R.points[k][0] - R.points[k - 1][0], R.points[k][1] - R.points[k - 1][1]));
      R.len = L;
      for (let k = 0, n = 1 + (rng() * 3 | 0); k < n; k++) boats.push(being('boat', { s: range(0.15, 0.85) * L[L.length - 1], dir: chance(0.5) ? 1 : -1, lane: range(0.15, 0.32) * R.width, speed: range(0.6, 1.1), look: rng(), load: choice(['amphorae', 'sacks', null]) }));
    }

    // ---- each one's own: the hours one sleeps, one's appetite and strength ----
    {
      const byJob = j => all.filter(a => a.job === j);
      for (const j of ['sentry', 'lookout']) byJob(j).forEach((a, k) => { a.night = k % 2 === 1; });
      for (const ag of all) {
        if (ag.kind !== 'person') continue;
        const old = ag.age === 'old', child = ag.age === 'child';
        ag.appetite = range(0.85, 1.15) * (child ? 1.15 : old ? 0.85 : 1);
        ag.weary = range(0.88, 1.12) * (child ? 1.1 : old ? 1.25 : 1);
        ag.wakeR = range(-0.9, -0.3) - (old ? 0.3 : 0); ag.bedR = range(13, 14.6) - (child ? 1.2 : old ? 1 : 0);
        if (ag.job === 'baker' || (ag.job === 'hand' && ag.shop && ag.shop.trade === 'bakery')) { ag.wakeR = range(-5.3, -4.5); ag.bedR = range(6, 7); }
        else if (ag.job === 'innkeeper') { ag.wakeR = range(-0.4, 0.2); ag.bedR = range(14.8, 15.6); }
        else if (ag.job === 'watch' || ag.night) { ag.wakeR = range(7, 7.8); ag.bedR = range(0, 0.6); }
        else if (ag.job === 'slave' || ag.job === 'farmer' || ag.job === 'shepherd' || ag.job === 'herdsman') { ag.wakeR -= 0.3; }
        else if (ag.job === 'patron' || ag.job === 'domina') { ag.bedR += 0.4; }
      }
    }
    // ---- and their names: a family's name for all of it, a slave his own ----
    {
      const used = new Set(), pickN = (l, f) => { for (let k = 0; k < 6; k++) { const n = f(choice(l)); if (!used.has(n)) { used.add(n); return n; } } return f(choice(l)); };
      const free = (sex, nomen) => sex === 'm' ? `${choice(PRAENOMINA)} ${nomen} ${choice(COGNOMINA)}` : `${femOf(nomen)} ${choice(FEM_COGNOMINA)}`;
      for (const h of homes) {
        const nomen = choice(NOMINA), ps = h.people, slaves = new Set();
        let girls = 0;
        for (const a of ps) {
          if (a.bond) { a.name = pickN(a.sex === 'm' ? SLAVE_M : SLAVE_F, n => n); slaves.add(a.name); continue; }
          if (a === h.master) a.name = pickN([0], () => free('m', nomen));
          else if (a === h.mistress) a.name = free('f', h.master ? choice(NOMINA) : nomen);
          else if (a.age === 'child') a.name = a.sex === 'm' ? `${h.master && chance(0.5) ? h.master.name.split(' ')[0] : choice(PRAENOMINA)} ${nomen} ${choice(COGNOMINA)}` : `${femOf(nomen)} ${['Prima', 'Secunda', 'Tertia', 'Minor', 'Quarta'][girls++] || choice(FEM_COGNOMINA)}`;
          else if (a.age === 'old') a.name = a.sex === 'm' ? free('m', nomen) : free('f', choice(NOMINA));
          else a.name = free(a.sex, nomen);
        }
      }
      for (const a of all) if (a.kind === 'person' && !a.name) a.name = free(a.sex || 'm', choice(NOMINA));
      for (const a of all) if (a.kind === 'rider' && a.man) a.name = a.man.name;
    }

    // ================= hunger and weariness =================
    // Everyone grows hungry as the hours go by, the more for hard work and
    // hardly at all asleep; and wearier the longer awake, the more for hard
    // work, less sitting or lying down; and far readier for sleep in the
    // hours one sleeps in (by night, most; a baker, by day; the watch, by
    // day) than at any other. A meal takes the hunger away (dinner all of
    // it), sleep the weariness, a rest at noon a little of it. So each eats
    // when hungry and sleeps when too tired to go on, at night most of all;
    // and the rest of the time works, or goes to the baths, the forum, the
    // tavern, or with the whole town to the theatre or the games.
    const HUNGRY = 1 / (8 * 3600), WEARY = 1 / (16 * 3600), REST = 1 / (7.5 * 3600), EAT = 1 / (18 * 60);
    // and the call of nature: rising through the day, the more after eating,
    // slowly in the night (so first thing in the morning, mostly); eased in a
    // minute or few at a latrine, at home, the town's, or behind a bush
    const NATURE = 1 / (6 * 3600), EASE = 1 / 100;
    // and thirst: rising the faster the hotter the day and the harder the
    // work, hardly at all asleep; a meal's wine and water slake some of it,
    // a drink all of it
    const THIRSTY = 1 / (5 * 3600), DRINK = 1 / 30;
    const heat = () => { const m = clock.month, summer = m >= 5 && m <= 7 ? 1.6 : m === 4 || m === 8 ? 1.25 : m <= 1 || m === 11 ? 0.75 : 1; return summer * (clock.R > 3 && clock.R < 9 ? 1.3 : clock.R > 12 || clock.R < 0 ? 0.6 : 1); };
    const HARD = new Set(['hoe', 'dig', 'reap', 'scythe', 'plough', 'beat', 'hammer', 'push', 'tread', 'saw', 'chop', 'axe', 'chisel', 'fight', 'exercise', 'knead', 'bake', 'stoke', 'ball']);
    const LOADED = new Set(['amphora', 'sack', 'wood', 'hay', 'jar-full', 'stone']);
    const cyc = x => ((x % 24) + 24) % 24;
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // how ready one is for sleep at an hour: 1 in the hours one sleeps,
    // easing off as one's time to wake comes, rising in the two before bed
    function drowsy(ag, R = clock.R) {
      const len = cyc(ag.wakeR - ag.bedR), p = cyc(R - ag.bedR);
      if (p < len) return 1 - 0.6 * smooth(len - 0.5, len, p);
      return Math.max(0.4 * (1 - smooth(0, 0.7, p - len)), 0.75 * smooth(22, 24, p));
    }
    // as tired as one must be to sleep now; and awake again, rested or the day come
    const sleepAt = (ag, R) => lerp(0.97, 0.3, drowsy(ag, R));
    const woken = (ag, R) => { const d = drowsy(ag, R); return (d < 0.5 && ag.fatigue < 0.55) || (ag.fatigue < 0.02 && d < 0.99); };
    // the meals: a bite on waking, a light one at noon, dinner towards evening
    function mealtime(ag, R = clock.R) {
      if (cyc(R - ag.wakeR) < 1.3) return 'breakfast';
      if (R > 5.4 && R < 7) return 'lunch';
      if (R > 9.3 && R < 12) return 'dinner';
      return null;
    }
    const MEAL = { breakfast: 0.5, lunch: 0.55, dinner: 1, snack: 0.4 };
    const wantsDrink = ag => ag.thirst > 0.8;
    const wantsNature = ag => ag.nature > 0.8 || (ag.nature > 0.45 && cyc(clock.R - ag.wakeR) < 0.8);
    const wantsFood = ag => { const m = mealtime(ag); return ag.hunger > 0.8 || (!!m && ag.hunger > (m === 'dinner' ? 0.3 : 0.4)); };
    // a rest in the heat of the day, if one is tired enough, once
    const wantsSiesta = ag => clock.R > 5.8 && clock.R < 7.6 && ag.fatigue > 0.42 && ag.napped !== clock.day && ag.age !== 'child';
    // where one is at the start: as hungry and as tired as the hours since
    // one woke and since one ate would have one
    function presume(ag) {
      let f = 0.35 + range(-0.1, 0.1), h = 0.25 + range(-0.1, 0.1), asleep = drowsy(ag, -6) > 0.9, was = null;
      for (let R = -6; R < clock.R; R += 0.25) {
        const dt = secs(clock, R, Math.min(R + 0.25, clock.R)), d = drowsy(ag, R);
        if (asleep) { f = Math.max(0, f - REST * dt); h += HUNGRY * 0.25 * dt; if ((d < 0.5 && f < 0.55) || (f < 0.02 && d < 0.99)) asleep = false; }
        else {
          f += WEARY * dt * ag.weary; h += HUNGRY * dt * ag.appetite;
          const m = mealtime(ag, R);
          if (m && m !== was && h > 0.2) h = Math.max(0, h - MEAL[m]);
          was = m;
          if (f > lerp(0.97, 0.3, d)) asleep = true;
        }
      }
      ag.fatigue = clamp(f + range(-0.06, 0.06), 0, 1.1); ag.hunger = clamp(h + range(-0.1, 0.1), 0, 1);
      // (gone at waking, and now and then since)
      ag.nature = asleep ? range(0.3, 0.6) : range(0, 0.7);
      ag.thirst = asleep ? range(0.2, 0.45) : range(0, 0.7);
      ag.asleep = asleep;
    }
    // each moment: hungrier, wearier, or eating, or asleep
    function needs(ag, dt) {
      const L = ag.leg, here = L && (L.k === 'hide' || (L.k === 'stay' && (!L.sp || Math.hypot(L.sp.x - ag.x, L.sp.y - ag.y) < 1.5)));
      if (here && L.sleep) {
        ag.asleep = true;
        ag.fatigue = Math.max(0, ag.fatigue - REST * dt);
        ag.hunger = Math.min(1.3, ag.hunger + HUNGRY * 0.25 * ag.appetite * dt);
        ag.nature = Math.min(1.3, ag.nature + NATURE * 0.3 * dt);
        ag.thirst = Math.min(1.3, ag.thirst + THIRSTY * 0.2 * dt);
        return;
      }
      let e = 1;
      if (!L || L.k === 'hide') e = 0.8;
      else if (L.k === 'go' || L.k === 'climb' || L.k === 'trot' || L.k === 'chase' || L.k === 'lead') e = LOADED.has(ag.carry) ? 1.6 : ag.pose === 'run' ? 1.8 : 1.15;
      else if (L.k === 'stay') e = HARD.has(ag.anim) ? 1.6 : SETTLED.has(ag.pose) ? 0.55 : 0.9;
      if (here && L.rest) ag.fatigue = Math.max(0, ag.fatigue - REST * 0.6 * dt);
      else ag.fatigue = Math.min(1.3, ag.fatigue + WEARY * ag.weary * e * dt);
      ag.hunger = Math.min(1.3, ag.hunger + HUNGRY * ag.appetite * (0.7 + 0.3 * e) * dt);
      if (here && L.food !== undefined) { const h0 = ag.hunger; ag.hunger = Math.max(L.food, ag.hunger - EAT * dt); ag.nature += (h0 - ag.hunger) * 0.3; }
      ag.nature = Math.min(1.3, ag.nature + NATURE * dt);
      if (here && L.ease) ag.nature = Math.max(0, ag.nature - EASE * dt);
      ag.thirst = Math.min(1.3, ag.thirst + THIRSTY * heat() * (0.6 + 0.4 * Math.max(e, 0.5)) * dt);
      if (here && L.food !== undefined) ag.thirst = Math.max(0.15, ag.thirst - DRINK * 0.15 * dt);
      if (here && L.drink) ag.thirst = Math.max(0, ag.thirst - DRINK * dt);
    }

    // ================= what each does at each hour =================
    // A day's plan, hour by hour: when each thing begins, from the night's
    // sixth hour before to the sixth after; the last thing goes on to the
    // next. Meals, the night and the noon's rest are only the hours they are
    // usually had in: whether one eats or sleeps is one's hunger's and one's
    // weariness's to say.
    const isMarket = day => (day + seed) % 8 === 0;             // the nundinae, every eighth day
    const isShow = day => ((day * 7 + seed) % 4) === 0;            // a play at the theatre
    const isGames = day => ((day * 11 + seed) % 6) === 0;          // games at the amphitheatre
    // the day's show, if any, and its hours: the whole town goes, all who
    // can, the shops shut for it
    const showOf = day => isShow(day) && cavea && stage ? 'theatre' : isGames(day) && amph ? 'arena' : null;
    const SHOW = [7.3, 10.6];
    const STAYS = new Set(['guard', 'sentry', 'lookout', 'watch', 'attendant', 'traveller', 'rider']);
    function goes(ag) {
      if (STAYS.has(ag.job) || ag.night) return 0;
      if (ag.job === 'baker' || (ag.job === 'hand' && ag.shop && ag.shop.trade === 'bakery')) return 0.25;
      if (ag.job === 'shepherd' || ag.job === 'herdsman') return 0.3;
      if (ag.job === 'slave') return ag.role === 'doorkeeper' ? 0.1 : ag.role === 'cook' ? 0.35 : 0.6;
      return ag.age === 'old' ? 0.6 : ag.age === 'child' ? 0.85 : 0.92;
    }
    function plan(ag) {
      const P = [], at = (h, act, o = {}) => P.push({ at: h, act, ...o });
      const wake = ag.wakeR, day = clock.day, m = clock.month, winter = m === 11 || m === 0 || m === 1;
      ag.showGoer = !!showOf(day) && chance(goes(ag));
      at(-6, 'night');
      // the end of a working day: the baths, most often; or a while at a
      // fountain with the neighbours
      const unwind = (o = {}) => wpick({ baths: 3, fountain: 2, ...o });
      // a working day: an errand mid-morning now and then, the noon's rest,
      // back to it, the baths, home; for a man, the tavern after dinner now and then
      const workday = (work, o = {}) => {
        if (ag.patron && chance(0.6)) at(wake, 'salutatio'); else at(wake, 'meal');
        at(o.from ?? 0.6, work);
        if (chance(0.5)) { at(range(2.2, 3.4), wpick({ forum: 2, temple: 1, market: ag.sex === 'f' ? 2 : 0.5, barber: ag.sex === 'm' ? 2 : 0, stroll: 1, fountain: 1 })); at(4.2, work); }
        at(5.7, chance(o.out ?? 0.3) ? 'eatout' : 'meal'); at(6.5, 'siesta');
        at(7.4, work); if (chance(0.7)) at(o.baths ?? 8.8, unwind());
        at(10, 'home'); at(10.3, 'meal');
        if (ag.sex === 'm' && chance(0.3)) at(range(11, 11.6), 'tavern');
        at(12.4, 'night');
      };
      switch (ag.job) {
        case 'farmer': {
          at(wake, 'meal');
          if (isMarket(day) && !ag.bond && chance(0.4)) { at(wake + 0.4, 'sell'); at(5.5, 'home'); at(6, 'meal'); at(6.5, 'siesta'); at(8, unwind()); at(9.8, 'home'); }
          else { at(wake + 0.3, 'field'); at(winter ? 9 : 10.6, 'home'); }
          at(11, 'meal'); at(12.2, 'night');
          break;
        }
        case 'shepherd': case 'herdsman': at(wake, 'meal'); at(wake + 0.3, 'pasture'); at(11, 'home'); at(11.3, 'meal'); at(12.2, 'night'); break;
        case 'fisher': at(wake - 0.3, 'river', { how: 'fish' }); at(3.5, 'sell'); at(6, 'meal'); at(6.5, 'siesta'); at(8, 'river', { how: 'fish' }); at(10.6, 'home'); at(11.2, 'meal'); at(12.2, 'night'); break;
        // a tavern open from first light into the night; a bakery's bread
        // made before dawn and sold from it; the shops open from first light,
        // shut for the heat of noon, open again till evening
        case 'innkeeper': at(wake, 'shop'); at(14.3, 'night'); break;
        case 'baker': at(wake, 'shop'); at(4, 'home'); at(4.4, 'meal'); at(5, 'night'); break;
        case 'butcher': case 'grocer': case 'vintner': case 'foricarius':
          at(wake, 'meal'); at(wake + 0.3, 'shop'); at(5.8, 'meal'); at(6.4, 'siesta'); at(7.4, 'shop'); at(10.2, 'home'); at(10.5, 'meal'); at(12.2, 'night'); break;
        case 'smith': case 'potter': case 'fuller': case 'carpenter': case 'cobbler': case 'weaver': case 'barber': workday('shop', { out: 0.25 }); break;
        case 'hand':
          if (ag.shop.trade === 'bakery') { at(wake, 'shop'); at(4, 'home'); at(4.4, 'meal'); at(5, 'night'); }
          else workday('shop', { out: 0.4 });
          break;
        case 'artisan': workday('craft'); break;
        case 'porter': workday('porter', { out: 0.5 }); break;
        case 'water': workday('carrywater', { from: 0.2, out: 0.5 }); break;
        case 'mason': workday('masonry', { out: 0.6 }); break;
        case 'woodcutter': at(wake, 'meal'); at(wake + 0.3, 'woodcut'); at(8.4, unwind()); at(10, 'home'); at(10.3, 'meal'); at(12.2, 'night'); break;
        case 'doctor': at(wake, 'meal'); at(0.8, 'visit'); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, 'visit'); at(9, unwind()); at(10.2, 'home'); at(10.5, 'meal'); at(12.4, 'night'); break;
        case 'scribe': case 'banker': at(wake, 'meal'); at(1, 'desk'); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, 'desk'); at(9.4, unwind()); at(10.4, 'home'); at(10.6, 'meal'); at(12.4, 'night'); break;
        // the lictors before their magistrate at his platform, the fasces on their shoulders
        case 'lictor': at(wake, 'meal'); at(1.2, 'lictor'); at(5.8, 'meal'); at(6.4, 'siesta'); at(7.6, unwind({ forum: 3 })); at(10, 'home'); at(10.3, 'meal'); at(12.4, 'night'); break;
        // the piper: at the morning's sacrifices, practising at his door, at a rich man's dinner
        case 'musician': at(wake - 0.1, 'meal'); at(wake + 0.15, 'pipe', { where: 'altar' }); at(2.2, 'home'); at(3, 'pipe', { where: 'door' }); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, 'forum'); at(9.4, 'pipe', { where: 'cena' }); at(12.6, 'night'); break;
        case 'actor': at(wake, 'meal'); at(1, 'rehearse'); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, unwind()); at(9.5, 'home'); at(10, 'meal'); if (chance(0.5)) at(11, 'tavern'); at(12.6, 'night'); break;
        case 'venator': at(wake, 'meal'); at(1, 'menagerie'); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, 'menagerie'); at(9.6, unwind()); at(10.6, 'home'); at(10.8, 'meal'); at(12.4, 'night'); break;
        case 'gladiator': at(wake, 'meal'); at(0.5, 'train'); at(5.6, 'meal'); at(6.4, 'siesta'); at(7.6, 'train'); at(9.2, unwind({ home: 2 })); at(10.4, 'home'); at(10.6, 'meal'); at(12.2, 'night'); break;
        case 'patron': {
          at(wake, 'receive'); at(1.4, ag.magistrate ? 'tribunal' : 'forum'); at(5.8, 'meal'); at(6.4, 'siesta');
          at(7.6, 'baths'); at(9.6, 'cena', { guest: chance(0.3) ? choice(patrons.filter(p => p !== ag)) : null }); at(12.6, 'home'); at(13.2, 'night');
          break;
        }
        case 'domina': at(wake, 'home'); at(0.8, chance(0.5) ? 'spin' : 'home'); at(1.6, wpick({ temple: 1, baths: 1, market: 1, home: 1, fountain: 0.6 })); at(4, 'spin'); at(5.8, 'meal'); at(6.4, 'siesta'); at(7.6, 'home'); at(9.6, 'cena'); at(12.6, 'home'); at(13.2, 'night'); break;
        case 'slave':
          switch (ag.role) {
            // the doorkeeper on his stool inside the door, all day
            case 'doorkeeper': at(wake - 0.3, 'meal'); at(wake, 'doorkeep'); at(5.6, 'meal'); at(6, 'doorkeep'); at(11, 'meal'); at(11.5, 'doorkeep'); at(13.4, 'night'); break;
            case 'cook': at(wake - 0.4, 'cook'); at(wake + 0.3, 'market'); at(1.6, 'cook'); at(3, 'chores'); at(5, 'cook'); at(6.4, 'meal'); at(7, 'chores'); at(8.4, 'cook'); at(11.5, 'meal'); at(12, 'chores'); at(13.6, 'night'); break;
            // behind his master wherever he goes
            case 'escort': at(wake, 'meal'); at(wake + 0.3, 'escort'); at(9.4, 'serve'); at(11.5, 'meal'); at(12, 'chores'); at(13.4, 'night'); break;
            default: at(wake - 0.3, 'cook'); at(wake + 0.3, 'water'); at(1, 'chores'); at(2, chance(0.5) ? 'market' : 'water'); at(3.5, chance(0.5) ? 'spin' : 'chores');
              at(5.2, 'cook'); at(6, 'meal'); at(6.6, 'chores'); at(7, 'water'); at(8, 'chores'); at(8.8, 'cook'); at(9.6, 'serve'); at(11.6, 'meal'); at(12, 'chores'); at(13.6, 'night');
          }
          break;
        case 'wife': {
          at(wake - 0.2, 'cook'); at(wake + 0.4, 'water');
          if (ag.home.coop || ag.home.kind === 'villa') { at(0.9, 'feed'); at(1.3, 'chores'); } else at(1.2, 'chores');
          if (ag.shopwife) at(1.4, 'shop');
          at(2.4, wpick({ market: 2, temple: 0.7, river: town.river && banks.length ? 0.8 : 0, home: 1.2, forum: 0.4, spin: 1.5, fountain: 1.2 }), { how: 'wash' });
          at(4.4, chance(0.6) ? 'spin' : 'chores'); at(5.2, 'cook'); at(6, 'meal'); at(6.6, 'siesta');
          at(7.5, wpick({ baths: 0.3, fountain: 0.25, [ag.shopwife ? 'shop' : 'spin']: 0.45 }));
          at(8.8, 'cook'); at(9.6, 'meal'); if (ag.home.coop || ag.home.kind === 'villa') at(10.4, 'feed'); else if (chance(0.5)) at(10.5, 'water'); at(11.2, 'spin'); at(12.4, 'night');
          break;
        }
        case 'child': {
          at(wake + 0.2, 'meal');
          if (ag.pupil && forum) at(0.4, 'school'); else at(0.4, ag.helps ? 'help' : 'play');
          at(5.8, 'meal'); at(6.5, ag.pupil ? 'play' : 'siesta'); at(7.6, ag.helps && chance(0.5) ? 'help' : 'play');
          at(10.4, 'home'); at(10.8, 'meal'); at(11.6, 'night');
          break;
        }
        case 'old': at(wake + 0.2, 'meal'); at(1, ag.sex === 'm' && chance(0.3) ? 'barber' : 'door'); at(1.6, 'door'); at(3.5, wpick({ temple: 0.4, forum: 0.25, fountain: 0.15, door: 0.2 })); at(5.6, 'meal'); at(6.2, 'siesta'); at(8, chance(0.3) ? 'fountain' : 'door'); at(10.2, 'home'); at(10.6, 'meal'); at(11.2, 'night'); break;
        case 'priest': at(wake, 'meal'); at(wake + 0.2, 'sacrifice'); at(2.2, 'precinct'); at(5.6, 'meal'); at(6.4, 'siesta'); at(8, 'precinct'); at(10.5, 'home'); at(11, 'meal'); at(12.2, 'night'); break;
        case 'teacher': at(wake, 'meal'); at(0.3, 'teach'); at(5.8, 'meal'); at(6.4, 'siesta'); at(7.8, unwind()); at(10.2, 'home'); at(10.5, 'meal'); at(12.2, 'night'); break;
        case 'attendant': at(wake, 'meal'); at(0.2, 'attend'); at(11, 'home'); at(11.3, 'meal'); at(12.2, 'night'); break;
        case 'guard': at(wake, 'meal'); at(0, 'guard'); at(12, 'home'); at(12.3, 'meal'); at(12.8, 'night'); break;
        case 'sentry': case 'lookout':
          if (!ag.night) { at(wake, 'meal'); at(0, ag.job); at(12, 'home'); at(12.3, 'meal'); at(12.8, 'night'); break; }
          // falls through
        case 'watch': {
          // by night: on duty from dusk to dawn, home and to bed, up in the afternoon
          P.length = 0;
          const duty = ag.job === 'watch' ? 'patrol' : ag.job;
          at(-6, duty); at(-0.3, 'home'); at(0.2, 'night'); at(wake, 'meal'); at(wake + 0.4, chance(0.5) ? 'forum' : 'home'); at(10.5, 'meal'); at(11.5, 'home');
          at(12.3, duty);
          break;
        }
        case 'traveller': at(-6, 'travel'); break;
        default: at(wake, 'meal'); at(1, 'chores'); at(5.8, 'meal'); at(6.4, 'siesta'); at(7.6, 'chores'); at(10, 'meal'); at(12.4, 'night');
      }
      return P.sort((p, q) => p.at - q.at);
    }

    // ---- the legs of what one does: going, staying, out of sight ----
    let warm = false;
    const place = (ag, sp) => { ag.x = sp.x; ag.y = sp.y; ag.z = Number.isFinite(sp.z) ? sp.z : groundZ(sp.x, sp.y); ag.a = sp.a ?? ag.a; ag.cl = sp.cl || null; };
    // there: walking (on a warm start, already there; nor a step, if one is there now)
    function go(ag, sp, o = {}) {
      if (warm && !ag.placed) { place(ag, sp); ag.placed = true; if (o.carry !== undefined) ag.carry = o.carry; return; }
      if (!ag.legs.length && !ag.leg && Math.hypot(sp.x - ag.x, sp.y - ag.y) < 0.3 && (sp.cl || null) === (ag.cl || null)) { if (o.carry !== undefined) ag.carry = o.carry; return; }
      ag.legs.push({ k: 'go', sp, ...o });
    }
    // the stays and the times out of sight from the n-th leg on: eating,
    // asleep, resting (and at table, the work in hand eating)
    function mark(ag, n, o) {
      for (let i = n; i < ag.legs.length; i++) {
        const L = ag.legs[i];
        if (L.k !== 'stay' && L.k !== 'hide') continue;
        Object.assign(L, o);
        if (o.food !== undefined && L.sp && !L.sp.anim) L.sp = { ...L.sp, anim: L.sp.pose === 'lie' ? null : 'eat' };
      }
    }
    function stay(ag, sp, until, o = {}) {
      if (warm && !ag.placed) { place(ag, sp); ag.placed = true; }
      ag.legs.push({ k: 'stay', sp, until, ...o });
    }
    const hide = (ag, until) => ag.legs.push({ k: 'hide', until });
    const call = (ag, fn) => ag.legs.push({ k: 'call', fn });
    const short = (until, a, b) => Math.min(until, now + range(a, b));

    // ---- the home: its spots ----
    const H = ag => ag.home;
    const homeIn = h => spot(...h.front.inn, NaN, 0, 'stand', { cl: h.C });
    // (the beds of a house given out all at once, by who is who in it: the
    // master and his wife first, the old, the children; the slaves last)
    const RANK = a => a === H(a).master ? 0 : a === H(a).mistress ? 1 : a.age === 'old' ? 2 : a.age === 'child' ? 3 : a.bond ? 5 : 4;
    const bedOf = ag => {
      const h = H(ag);
      if (!ag.bed && !h.bedded) { h.bedded = true; for (const o of h.people.slice().sort((p, q) => RANK(p) - RANK(q))) bedOf(o); }
      if (!ag.bed) {
        if (h.upstairs || !h.S) ag.bed = 'up';
        else {
          // (two grown to a bed, or three children; the rest on straw pallets on the floor, as the poor and the slaves slept)
          const free = h.S.beds.filter(b => b.used < (ag.age === 'adult' || ag.age === 'old' ? 2 : 3));
          const bb = ag.job !== 'slave' && free.length ? free[0] : null;
          if (bb) {
            const o = bb.used++ ? 0.22 : bb.lat > 1.1 ? -0.22 : 0;
            ag.bed = spot(bb.x - Math.sin(bb.a) * o, bb.y + Math.cos(bb.a) * o, bb.z, bb.a, 'lie', { cl: h.C });
          } else {
            const r = h.S.rooms.length ? choice(h.S.rooms) : null, s = r && roomSpot(r.b, r.r, 'lie');
            ag.bed = s ? { ...s, z: s.z + 0.08, mat: true } : 'up';
          }
        }
      }
      return ag.bed;
    };
    // a place nobody else has taken (for as long as one is to be there)
    function take(list, ag, till = now + 900) {
      const ok = list.filter(s => !s.by || s.by === ag || now > s.till);
      if (!ok.length) return null;
      const s = choice(ok);
      s.by = ag; s.till = till;
      return s;
    }
    const homeSpot = (ag, what, till) => {
      const h = H(ag), S = h.S;
      if (h.upstairs || !S) return null;
      const C = h.C;
      if (what === 'seat') { const s = take(S.seats, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'sit', { seat: 0.42, stool: true, cl: C, table: s.table }); }
      if (what === 'bench') { const s = take(S.benches, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'sit', { seat: s.seat, cl: C }); }
      if (what === 'hearth') { const s = take(S.hearths, ag, till); return s && spot(s.x, s.y, s.z, s.a, 'stand', { anim: 'cook', cl: C }); }
      if (what === 'room' && S.rooms.length) { const r = choice(S.rooms); return roomSpot(r.b, r.r); }
      if (what === 'store' && S.stores.length) { const s = choice(S.stores); return spot(s.x, s.y, s.z, s.a, 'stand', { cl: C }); }
      return null;
    };
    // by the front door, outside, on a stool
    const doorSpot = h => {
      const e = h.front, [ox, oy] = e.out, [ix, iy] = e.inn, a = Math.atan2(oy - iy, ox - ix), side = chance(0.5) ? 1 : -1;
      // (either side of the door, whichever is free)
      for (const sg of [side, -side, side * 2, -side * 2]) {
        const x = ox - Math.cos(a) * 0.5 - Math.sin(a) * sg * 1.1, y = oy - Math.sin(a) * 0.5 + Math.cos(a) * sg * 1.1;
        let busy = false;
        around(x, y, 1, o => { if (o.kind === 'person' && Math.hypot(o.x - x, o.y - y) < 0.7) busy = true; });
        if (!busy && way.costAt(x, y) < Infinity) return spot(x, y, NaN, a, 'sit', { seat: 0.4, stool: true, cl: null });
      }
      return spot(ox, oy, NaN, a, 'stand', { cl: null });
    };
    function atHome(ag, until, what) {
      const h = H(ag);
      if (h.upstairs || !h.S) { go(ag, homeIn(h)); hide(ag, until); return; }
      const sp = homeSpot(ag, what, until) || homeSpot(ag, 'room') || homeSpot(ag, 'seat', until) || homeSpot(ag, 'bench', until);
      if (!sp) { go(ag, homeIn(h)); hide(ag, until); return; }
      go(ag, sp); stay(ag, sp, until);
    }
    // a place's spot: a group to talk in, at the forum, the nymphaeum, the market
    const groups = new Map();
    function talkSpot(key, pts, maxN = 5) {
      if (!pts.length) return null;
      let list = groups.get(key);
      if (!list) groups.set(key, list = []);
      const open = list.filter(g => g.n < maxN);
      let G = open.length && chance(0.75) ? choice(open) : null;
      if (!G) { const [x, y] = choice(pts); G = { x, y, n: 0, key }; list.push(G); }
      G.n++;
      const t = rng() * TAU, r = range(0.55, 0.85), x = G.x + Math.cos(t) * r, y = G.y + Math.sin(t) * r;
      return spot(x, y, NaN, t + Math.PI + range(-0.3, 0.3), 'stand', { anim: 'talk', group: G, cl: null });
    }
    const leaveGroup = ag => { const G = ag.group; if (G) { G.n--; if (G.n <= 0) { const l = groups.get(G.key); l.splice(l.indexOf(G), 1); } ag.group = null; } };

    // ---- the acts ----
    // the long things people do that they break off from now and then
    const BREAKS = new Set(['craft', 'shopkeep', 'shop', 'field', 'chores', 'home', 'attend', 'precinct', 'door', 'porter', 'river', 'carrywater', 'masonry', 'desk', 'spin']);
    // over to someone, to talk a while; they turn to whoever comes
    function meet(ag, o, dur, then = []) {
      const C = ag.cl;
      const ch = o.chat && now < o.chat.until && o.chat.n < 5 ? o.chat : null;
      let x, y;
      if (ch) { const a = rng() * TAU; x = ch.x + Math.cos(a) * 0.8; y = ch.y + Math.sin(a) * 0.8; }
      else { const d = Math.hypot(ag.x - o.x, ag.y - o.y) || 1, r = o.pose === 'sit' ? 0.95 : 0.8; x = o.x + (ag.x - o.x) / d * r; y = o.y + (ag.y - o.y) / d * r; }
      const OC = o.cl || null;
      if (!(OC ? standable({ cl: OC }, x, y) : way.costAt(x, y) < Infinity)) return false;
      const until = now + dur, chat = ch || { x: (x + o.x) / 2, y: (y + o.y) / 2, n: 1, until };
      chat.n++;
      ag.chat = o.chat = chat;
      const t = spot(x, y, OC ? floorAt(OC, x, y) : NaN, Math.atan2(o.y - y, o.x - x), 'stand', { cl: OC });
      if (o.leg && o.leg.k === 'stay') { o.leg.talk = { until: Math.max(o.leg.talk && o.leg.talk.until || 0, until + 60), with: ag }; o.leg.idle = 0; o.leg.until = Math.max(o.leg.until, now + 30); }
      drop(ag);
      ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until, talk: { until, with: o } }, ...then);
      void C;
      return true;
    }
    const ACT = {
      interlude(ag, e, until) {
        // a break: a word with someone about, a bite at a counter, a drink at
        // the fountain, a turn about; in the fields, a rest in the shade
        const dur = until - now;
        if (e.act === 'field' && ag.field) return ACT.lunch(ag, e, until);
        const r = rng();
        if (r < 0.45) {
          const o = personNear(ag, 40, o => o.vis && o.leg && o.leg.k === 'stay' && o.leg.sp && (o.pose === 'stand' || o.pose === 'sit') && (!o.anim || o.anim === 'craft' || o.anim === 'talk')
            && !o.leg.drift && !o.leg.run && !o.leg.play && (o.age === 'child') === (ag.age === 'child') && Math.abs(o.z - ag.z) < 1.5 && (!o.cl || o.cl === ag.cl || (o.home && o.cl === o.home.C && chance(0.5))));
          if (o && meet(ag, o, dur)) return;
        }
        if (r < 0.7 && counters.length) {
          const near = counters.filter(c => (c.trade === 'caupona' || c.trade === 'bakery') && Math.hypot(c.buy.x - ag.x, c.buy.y - ag.y) < 150), c = near.length ? choice(near) : null;
          if (c) { const sp = spot(c.buy.x + range(-0.4, 0.4), c.buy.y + range(-0.4, 0.4), c.buy.z, c.buy.a, 'stand', { anim: 'eat', cl: clusterOf(c.b) }); go(ag, sp); stay(ag, sp, until, { atCounter: c, food: Math.max(0, ag.hunger - 0.25) }); return; }
        }
        if (r < 0.85 && fountains.length) {
          const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y))[0], s = choice(f.spots);
          const sp = spot(s.x, s.y, NaN, s.a, 'bend', { anim: 'fill', cl: null });
          go(ag, sp); stay(ag, sp, now + range(20, 50));
          const a = rng() * TAU, x = s.x + Math.cos(a) * 1.5, y = s.y + Math.sin(a) * 1.5;
          if (way.costAt(x, y) < Infinity) { const t = spot(x, y, NaN, Math.atan2(s.y - y, s.x - x), 'stand', { cl: null }); go(ag, t); stay(ag, t, until); }
          return;
        }
        ACT.stroll(ag, e, until);
      },
      sleep(ag, e, until) {
        const b = bedOf(ag);
        if (b === 'up') { if (ag.vis || Math.hypot(ag.x - H(ag).front.inn[0], ag.y - H(ag).front.inn[1]) > 0.5) go(ag, homeIn(H(ag))); hide(ag, until); return; }
        go(ag, b); stay(ag, b, until);
      },
      home(ag, e, until) { atHome(ag, short(until, 300, 1500), choice(['seat', 'bench', 'room', 'room', 'seat'])); },
      chores(ag, e, until) {
        const what = ag.sex === 'f' ? choice(['hearth', 'room', 'room', 'store', 'bench', 'seat']) : choice(['room', 'store', 'room', 'seat']);
        // (sweeping, now and then)
        const sw = ag.age !== 'child' && chance(0.25) && homeSpot(ag, 'room');
        if (sw) { sw.pose = 'bend'; sw.anim = 'sweep'; go(ag, sw); stay(ag, sw, short(until, 60, 240)); return; }
        atHome(ag, short(until, 120, 700), what);
      },
      eat(ag, e, until) { atHome(ag, until, H(ag).S && H(ag).S.seats.length ? 'seat' : 'bench'); },
      cook(ag, e, until) { atHome(ag, until, 'hearth'); },
      rest(ag, e, until) {
        const b = bedOf(ag);
        if (b !== 'up' && chance(0.7)) { go(ag, b); stay(ag, b, until); return; }
        atHome(ag, until, 'bench');
      },
      door(ag, e, until) { const sp = doorSpot(H(ag)); go(ag, sp); stay(ag, sp, until); },
      water(ag, e, until) {
        if (ag.watered === e || !fountains.length) return atHome(ag, until, 'room');
        ag.watered = e;
        const h = H(ag), [hx, hy] = h.front.out;
        const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - hx, p.b.y - hy) - Math.hypot(q.b.x - hx, q.b.y - hy))[rng() < 0.8 ? 0 : 1] || fountains[0];
        const s = choice(f.spots), sp = spot(s.x, s.y, NaN, s.a, 'bend', { anim: 'fill', cl: null });
        go(ag, sp, { carry: 'jar' }); stay(ag, sp, now + range(40, 120));
        call(ag, () => { ag.carry = 'jar-full'; });
        // a word with the neighbours at the fountain, now and then
        if (chance(0.55)) { const a = rng() * TAU, x = s.x + Math.cos(a) * 1.4, y = s.y + Math.sin(a) * 1.4; if (way.costAt(x, y) < Infinity) { const t = spot(x, y, NaN, a + Math.PI, 'stand', { anim: 'talk', cl: null }); stay(ag, t, now + range(120, 600)); } }
        const back = homeSpot(ag, 'hearth') || homeSpot(ag, 'store') || homeIn(h);
        go(ag, back); stay(ag, back, now + 20);
        call(ag, () => { ag.carry = null; });
      },
      market(ag, e, until) {
        if (ag.shopped === e) return atHome(ag, short(until, 300, 900), 'room');
        ag.shopped = e;
        // the bread first in the morning; then the butcher's, the greengrocer's, the wine-seller's, the market's stalls
        const n = 1 + (rng() * 3 | 0), sells = t => counters.filter(c => c.trade === t), near = l => l.slice().sort((p, q) => Math.hypot(p.buy.x - ag.x, p.buy.y - ag.y) - Math.hypot(q.buy.x - ag.x, q.buy.y - ag.y)).slice(0, 3);
        ag.carry = 'basket';
        for (let k = 0; k < n; k++) {
          const bread = k === 0 && clock.R < 3 && sells('bakery').length, other = counters.filter(c => c.trade !== 'caupona');
          const c = bread ? choice(near(sells('bakery'))) : market && stalls.length && chance(0.5) ? choice(stalls) : other.length ? choice(near(other).concat([choice(other)])) : counters.length ? choice(counters) : null;
          if (!c) break;
          const sp = spot(c.buy.x + range(-0.3, 0.3), c.buy.y + range(-0.3, 0.3), c.buy.z, c.buy.a, 'stand', { anim: 'talk', cl: clusterOf(c.b) });
          go(ag, sp); stay(ag, sp, now + range(60, 240), { atCounter: c });
        }
        const back = homeSpot(ag, 'store') || homeIn(H(ag));
        go(ag, back); stay(ag, back, now + 15); call(ag, () => { ag.carry = null; });
      },
      forum(ag, e, until) {
        leaveGroup(ag);
        const r = rng();
        if (r < 0.2 && naveSpots && naveSpots.tribunal) {
          const t = naveSpots.tribunal, d = range(4, 10), o = range(-4, 4);
          const x = t.x + Math.cos(t.a) * d - Math.sin(t.a) * o, y = t.y + Math.sin(t.a) * d + Math.cos(t.a) * o;
          if (way.costAt(x, y) < Infinity) { const sp = spot(x, y, NaN, t.a + Math.PI + range(-0.3, 0.3), 'stand', { cl: null }); go(ag, sp); stay(ag, sp, short(until, 300, 1200)); return; }
        }
        if (r < 0.3 && counters.length) { const c = choice(counters), sp = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { anim: 'talk', cl: clusterOf(c.b) }); go(ag, sp); stay(ag, sp, short(until, 60, 300), { atCounter: c }); return; }
        const sp = talkSpot('forum', forumPts);
        if (!sp) return atHome(ag, until, 'seat');
        ag.group = sp.group;
        go(ag, sp); stay(ag, sp, short(until, 300, 1500)); call(ag, () => leaveGroup(ag));
      },
      fountain(ag, e, until) {
        // at a fountain of an afternoon: the town's grand one now and then,
        // or one in the streets near home; a drink from the spout, and the
        // talk with whoever else is there
        leaveGroup(ag);
        const [hx, hy] = ag.home ? H(ag).front.out : [ag.x, ag.y];
        const street = fountains.filter(f => !f.grand && f.ring.length).sort((p, q) => Math.hypot(p.b.x - hx, p.b.y - hy) - Math.hypot(q.b.x - hx, q.b.y - hy)).slice(0, 3);
        const grand = fountains.find(f => f.grand && f.ring.length);
        const f = grand && (chance(0.45) || !street.length) ? grand : street.length ? choice(street) : null;
        if (!f) return ACT.stroll(ag, e, until);
        if (chance(0.6)) { const q = choice(f.spots), sp = spot(q.x, q.y, NaN, q.a, 'bend', { anim: 'drink', cl: null }); go(ag, sp); stay(ag, sp, now + range(15, 35), { drink: true }); }
        const sp = talkSpot(f.key, f.ring, f.grand ? 5 : 4);
        if (!sp) return;
        ag.group = sp.group;
        go(ag, sp); stay(ag, sp, short(until, 900, 2400)); call(ag, () => leaveGroup(ag));
      },
      stroll(ag, e, until) {
        const sp = nymph && chance(0.5) ? talkSpot('nymph', nymphPts, 4) : talkSpot('forum', forumPts);
        if (!sp) return atHome(ag, until, 'seat');
        ag.group = sp.group;
        go(ag, sp); stay(ag, sp, short(until, 600, 1800)); call(ag, () => leaveGroup(ag));
      },
      tribunal(ag, e, until) {
        if (!naveSpots || !naveSpots.tribunal) return ACT.forum(ag, e, until);
        const t = naveSpots.tribunal, o = (ag.id % 2 ? -0.7 : 0.7);
        const sp = spot(t.x - Math.sin(t.a) * o, t.y + Math.cos(t.a) * o, t.z, t.a, 'sit', { seat: 0.45, cl: null });
        go(ag, sp); stay(ag, sp, until);
      },
      receive(ag, e, until) {
        // in his chair in his atrium, beyond the pool, facing the door the clients come in by
        const sp = atriumSpot(H(ag), true);
        if (!sp) return atHome(ag, until, 'seat');
        sp.pose = 'sit'; sp.seat = 0.45; sp.stool = true;
        go(ag, sp); stay(ag, sp, until);
      },
      salutatio(ag, e, until) {
        const sp = atriumSpot(ag.patron.home, false);
        if (!sp) return ACT.eat(ag, e, until);
        go(ag, sp); stay(ag, sp, short(until, 600, 1800));
      },
      cena(ag, e, until) {
        const host = e.guest || ag, h = host.home;
        const couches = h.S ? h.S.couches : [];
        if (!couches.length) return ACT.eat(ag, e, until);
        // three to a couch, side by side, all lying the same way along it,
        // slanting, the heads towards the table; the host first
        let c = null, slot = -1;
        for (const q of couches) {
          q.slots = q.slots || [null, null, null];
          for (let k = 0; k < 3 && slot < 0; k++) { const o = q.slots[k]; if (!o || o.by === ag || now > o.till) { c = q; slot = k; } }
          if (c) break;
        }
        if (!c) return ACT.eat(ag, e, until);
        c.slots[slot] = { by: ag, till: until };
        if (c.end === undefined) c.end = chance(0.5) ? 0 : Math.PI;
        const o = (slot - 1) * 0.58, toward = c.a + Math.PI / 2 * (c.side === 0 || c.side === 1 ? 1 : -1);
        const sp = spot(c.x + Math.cos(c.a) * o, c.y + Math.sin(c.a) * o, c.z, c.a + c.end + turn(c.a + c.end, toward) * 0.42, 'recline', { cl: h.C, table: c.table });
        go(ag, sp); stay(ag, sp, until, ag.hunger > 0.15 ? { food: 0 } : {});
        ag.meal = ag.meal || ag.hunger > 0.15;
      },
      serve(ag, e, until) {
        const S = H(ag).S, c = S && S.couches[0];
        if (!c) return ACT.chores(ag, e, until);
        const x = c.x + Math.cos(c.a + Math.PI / 2) * 1.2, y = c.y + Math.sin(c.a + Math.PI / 2) * 1.2;
        const sp = spot(x, y, c.z - 0.5, c.a - Math.PI / 2, 'stand', { cl: H(ag).C });
        go(ag, sp); stay(ag, sp, short(until, 200, 600));
        const k = homeSpot(ag, 'hearth');
        if (k) { go(ag, k); stay(ag, k, now + range(60, 200)); }
      },
      craft(ag, e, until) {
        // at his door in the street, on a stool, at his trade (a carpenter
        // standing at his sawing), or at home
        const h = H(ag), a = ag.craft || 'craft';
        if (chance(0.7) || h.upstairs) { const sp = doorSpot(h); sp.anim = a; if (a === 'saw') { sp.pose = 'stand'; sp.seat = 0; sp.stool = false; } go(ag, sp); stay(ag, sp, until); }
        else atHome(ag, until, 'seat');
        const L = ag.legs[ag.legs.length - 1];
        if (L && L.sp) L.sp = { ...L.sp, anim: a };
      },
      shopkeep(ag, e, until) {
        // on a stool by the counter, up to serve whoever comes to it
        const h = H(ag), c = counters.find(c => c.b === h.b);
        if (!c) return ACT.craft(ag, e, until);
        const sp = spot(c.sell.x, c.sell.y, c.sell.z, c.sell.a, 'sit', { seat: 0.42, stool: true, cl: h.C });
        c.keeper = ag;
        go(ag, sp); stay(ag, sp, until, { counter: c });
      },
      eatout(ag, e, until) {
        // at a tavern's counter, or a bakery's: the nearest, mostly
        const list = counters.filter(c => c.trade === 'caupona' || c.trade === 'bakery');
        if (!list.length) return ACT.eat(ag, e, until);
        const c = list.slice().sort((p, q) => Math.hypot(p.buy.x - ag.x, p.buy.y - ag.y) - Math.hypot(q.buy.x - ag.x, q.buy.y - ag.y))[chance(0.7) ? 0 : rng() * Math.min(4, list.length) | 0];
        const sp = spot(c.buy.x + range(-0.4, 0.4), c.buy.y + range(-0.4, 0.4), c.buy.z, c.buy.a, 'stand', { anim: 'eat', cl: clusterOf(c.b) });
        go(ag, sp); stay(ag, sp, short(until, 600, 1500), { atCounter: c });
      },
      porter(ag, e, until) {
        // from a gate to a shop, the market or the forum, a jar on his shoulder, and back
        if (!gates.length || !counters.length) return ACT.craft(ag, e, until);
        const G = choice(gates), [ix, iy] = G.inner;
        const pick = spot(ix + range(-2, 2), iy + range(-2, 2), NaN, Math.atan2(G.uy, G.ux), 'bend', { cl: null });
        go(ag, pick, { carry: null }); stay(ag, pick, now + range(30, 90));
        call(ag, () => { ag.carry = 'amphora'; ag.slow = 0.85; });
        const c = choice(counters), drop = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'bend', { cl: clusterOf(c.b) });
        go(ag, drop); stay(ag, drop, now + range(15, 40));
        call(ag, () => { ag.carry = null; ag.slow = 1; });
      },
      field(ag, e, until) {
        const f = ag.field;
        if (!f) return ACT.craft(ag, e, until);
        const W = fieldWork(f, ag);
        if (W.sp.anim === 'plough') {
          // the oxen led out to the field, and home again after
          call(ag, () => { ag.train = ag.team; ag.team.forEach((o, k) => { o.follow = ag; o.yoke = k ? 1 : -1; o.legs.length = 0; o.leg = null; }); });
          if (warm && !ag.placed) ag.train = ag.team, ag.team.forEach((o, k) => { o.follow = ag; o.yoke = k ? 1 : -1; });
        }
        go(ag, W.sp, { carry: W.tool }); stay(ag, W.sp, until, { drift: W });
        if (W.sp.anim === 'plough') call(ag, () => { ag.train = null; ag.trail = null; ag.team.forEach(o => { o.follow = null; o.ploughing = false; o.yoke = 0; }); });
      },
      lunch(ag, e, until) {
        // in the shade of a tree near where one works, on the grass; a
        // shepherd where he is, by his flock
        const f = ag.field;
        if (!f && !ag.herd && !ag.tree) return ACT.eat(ag, e, until);
        const [cx, cy] = f ? f.poly.reduce((a, p) => [a[0] + p[0] / f.poly.length, a[1] + p[1] / f.poly.length], [0, 0]) : [ag.x, ag.y];
        const t = !ag.herd && shadeNear(cx, cy, 70), p = t && shadeOf(t);
        const [x, y] = p || [ag.x, ag.y];
        const sp = spot(x, y, NaN, range(0, TAU), chance(0.3) ? 'lie' : 'sit', { seat: 0, cl: null });
        go(ag, sp); stay(ag, sp, until);
      },
      pasture(ag, e, until) {
        // out to the flock; then sitting by it, or in the shade, watching it,
        // and now and then round to a stray, from beyond it, to turn it back
        const Hd = ag.herd;
        if (!Hd) return ACT.craft(ag, e, until);
        const [cx, cy] = Hd.pt(Hd.mx, Hd.my), local = (x, y) => [(x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c];
        const [au, av] = local(ag.x, ag.y), there = !ag.cl && Math.abs(au) < Hd.hu + 1 && Math.abs(av) < Hd.hv + 1;
        const seat = () => {
          const t = clock.R > 5 && clock.R < 8 && Hd.shade && shadeOf(Hd.shade);
          let p = t && Math.abs(local(...t)[0]) < Hd.hu && Math.abs(local(...t)[1]) < Hd.hv ? t : null;
          if (!p) { const a = rng() * TAU, r = Hd.spread * 1.6 + 2; p = Hd.pt(...Hd.clampU(...local(cx + Math.cos(a) * r, cy + Math.sin(a) * r))); }
          return spot(p[0], p[1], NaN, Math.atan2(cy - p[1], cx - p[0]), 'sit', { seat: 0, cl: null });
        };
        ag.carry = 'staff';
        if (!there || warm) { const sp = seat(); go(ag, sp, { carry: 'staff' }); stay(ag, sp, short(until, 300, 900)); return; }
        // the grass here grazed down: on to fresh, if there is time before evening
        const sh = showOf(clock.day);
        if (Hd.mode === 'graze' && Hd.kind !== 'pig' && (grass[Hd.f.idx] < 0.22 || now > Hd.until) && clock.R > 0.5 && clock.R < 10 && !(ag.showGoer && sh && clock.R > SHOW[0] - 2.5)) {
          ag.doing = 'drove';
          if (moveFlock(ag, Hd)) return;
          Hd.until = now + range(900, 2400);
        }
        let far = null, fd = 0;
        for (const b of Hd.beasts) { const d = Math.hypot(b.x - cx, b.y - cy); if (d > fd) { fd = d; far = b; } }
        if (far && fd > Hd.spread * 1.4 && chance(0.6)) {
          const [x, y] = Hd.pt(...Hd.clampU(...local(far.x + (far.x - cx) / fd * 2, far.y + (far.y - cy) / fd * 2)));
          ag.legs.push({ k: 'trot', x, y, speed: 1.15, pose: 'walk' });
          ag.legs.push({ k: 'stay', sp: spot(x, y, NaN, Math.atan2(cy - y, cx - x), 'stand', { anim: 'shoo', cl: null }), until: now + range(6, 15) });
          return;
        }
        const sp = seat();
        ag.legs.push({ k: 'trot', x: sp.x, y: sp.y, speed: 1, pose: 'walk' });
        stay(ag, sp, short(until, 240, 900));
      },
      feed(ag, e, until) {
        // the hens fed, grain scattered from a basket; they come running
        const h = H(ag);
        let sp;
        if (h.kind === 'villa' && h.yard) { const [s1, t1, s2, t2] = h.yard, [x, y] = toWorld(h.b, (s1 + s2) / 2 + range(-2, 2), (t1 + t2) / 2 + range(-2, 2)); sp = spot(x, y, fz(h.b), range(0, TAU), 'stand', { anim: 'scatter', cl: h.C }); }
        else if (h.coop) { const [x, y] = h.coop.out; sp = spot(x, y, NaN, range(0, TAU), 'stand', { anim: 'scatter', cl: null }); }
        else return ACT.chores(ag, e, until);
        go(ag, sp, { carry: 'basket' }); stay(ag, sp, short(until, 150, 360)); call(ag, () => { ag.carry = null; });
      },
      sell(ag, e, until) {
        // at a stall of the market, if one is free; or sitting on the ground
        // with a basket of what he grew or caught
        const st = stalls.find(c => !c.keeper);
        if (st) {
          st.keeper = ag;
          const sp = spot(st.sell.x, st.sell.y, st.sell.z, st.sell.a, 'sit', { seat: 0.42, stool: true, cl: clusterOf(st.b) });
          go(ag, sp, { carry: 'basket' }); call(ag, () => { ag.carry = null; }); stay(ag, sp, until, { counter: st });
          return;
        }
        const pts = market ? market.pts : forumPts;
        if (!pts.length) return ACT.craft(ag, e, until);
        const [x, y] = choice(pts), C = market ? market.C : null;
        const sp = spot(x, y, C ? fz(market.b) : NaN, range(0, TAU), 'sit', { seat: 0, cl: C, anim: 'sell' });
        go(ag, sp, { carry: 'basket' }); call(ag, () => { ag.carry = null; ag.prop = { kind: 'basket', x: ag.x + Math.cos(ag.a) * 0.6, y: ag.y + Math.sin(ag.a) * 0.6, z: ag.z }; });
        stay(ag, sp, until); call(ag, () => { ag.prop = null; });
      },
      school(ag, e, until) {
        const s = schoolSpot(false);
        if (!s) return ACT.play(ag, e, until);
        go(ag, s); stay(ag, s, until);
      },
      teach(ag, e, until) {
        const s = schoolSpot(true);
        if (!s) return ACT.forum(ag, e, until);
        go(ag, s); stay(ag, s, until);
      },
      play(ag, e, until) {
        // with the other children of the street: chasing one another, crouched together over a game
        const h = H(ag), [hx, hy] = h.front.out;
        let P = plays.find(p => p.kids.size < 7 && Math.hypot(p.x - hx, p.y - hy) < 35 && way.los([p.x, p.y], [hx, hy]));
        if (!P) { P = { x: hx, y: hy, kids: new Set() }; plays.push(P); }
        const sp = spot(P.x + range(-2, 2), P.y + range(-2, 2), NaN, 0, 'stand', { cl: null });
        go(ag, sp); stay(ag, sp, short(until, 600, 2400), { play: { x: P.x, y: P.y, r: 9, next: 0, P } });
      },
      baths(ag, e, until) {
        if (!bath) return ACT.home(ag, e, until);
        if (ag.bathed === e) return ACT.stroll(ag, e, until);
        ag.bathed = e;
        const r = rng(), [x, y] = choice(bath.court.length ? bath.court : [[bath.pal.x, bath.pal.y]]);
        // (running round, on a ring that keeps clear of the pool)
        let rr = r < 0.4 ? range(2.2, 3.5) : 0;
        while (rr > 1.5 && Array.from({ length: 16 }, (_, k) => k * TAU / 16).some(t => wet(x + Math.cos(t) * rr, y + Math.sin(t) * rr))) rr -= 0.4;
        if (rr <= 1.5) rr = 0;
        const ex = spot(x, y, fz(bath.pal), range(0, TAU), 'stand', { cl: bath.C, anim: rr ? 'exercise' : r < 0.7 ? 'ball' : 'talk' });
        go(ag, ex); stay(ag, ex, now + range(600, 1500), rr ? { run: { x, y, r: rr } } : {});
        const bench = take(bath.benches, ag, now + 1800);
        if (bench) { go(ag, bench); stay(ag, bench, now + range(300, 700)); }
        if (bath.pools.length) { const p = choice(bath.pools); go(ag, p); stay(ag, p, now + range(400, 900), { wade: { x: p.x, y: p.y, r: 0.8, t: rng() * TAU } }); }
        // the open pool: lengths, up and down a lane of it, turning at each end
        if (bath.lanes && chance(0.7)) {
          const P = bath.lanes, o = range(-P.hw, P.hw), A = [P.cx - P.ux * P.hl - P.uy * o, P.cy - P.uy * P.hl + P.ux * o], Bq = [P.cx + P.ux * P.hl - P.uy * o, P.cy + P.uy * P.hl + P.ux * o];
          const sp = spot(A[0], A[1], fz(bath.pal) - 0.05, Math.atan2(P.uy, P.ux), 'swim', { cl: bath.C });
          go(ag, sp); stay(ag, sp, now + range(300, 900), { lap: { A, B: Bq, s: rng(), v: range(0.5, 0.9) / (2 * P.hl) } });
        }
      },
      attend(ag, e, until) {
        if (!bath) return ACT.craft(ag, e, until);
        const sp = (bath.pools.length && chance(0.6)) ? (() => { const p = choice(bath.pools); let [x, y] = [p.x + 1.4, p.y]; for (let k = 0; k < 12 && wet(x, y); k++) { const a = rng() * TAU, d = range(1.5, 4); x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; } return wet(x, y) ? spot(...choice(bath.court), fz(bath.pal), range(0, TAU), 'bend', { anim: 'sweep', cl: bath.C }) : spot(x, y, p.z, range(0, TAU), 'stand', { cl: p.cl }); })() : spot(...choice(bath.court), fz(bath.pal), range(0, TAU), 'bend', { anim: 'sweep', cl: bath.C });
        go(ag, sp); stay(ag, sp, short(until, 600, 1800));
      },
      temple(ag, e, until) {
        if (!altars.length) return ACT.home(ag, e, until);
        if (ag.prayed === e) return atHome(ag, until, 'seat');
        ag.prayed = e;
        const A = choice(altars), d = range(2.5, 6), o = range(-3, 3);
        const x = A.b.x + A.ux * d - A.uy * o, y = A.b.y + A.uy * d + A.ux * o;
        const sp = spot(x, y, NaN, A.out + Math.PI + range(-0.2, 0.2), 'stand', { anim: 'pray' });
        go(ag, sp, { carry: chance(0.4) ? 'basket' : null }); stay(ag, sp, now + range(200, 700)); call(ag, () => { ag.carry = null; });
      },
      sacrifice(ag, e, until) {
        const A = altars[all.filter(a => a.job === 'priest').indexOf(ag) % Math.max(1, altars.length)];
        if (!A) return ACT.forum(ag, e, until);
        const sp = spot(A.priest.x, A.priest.y, NaN, A.priest.a, 'stand', { anim: 'pray' });
        go(ag, sp); stay(ag, sp, until);
      },
      precinct(ag, e, until) {
        const A = altars[all.filter(a => a.job === 'priest').indexOf(ag) % Math.max(1, altars.length)];
        if (!A) return ACT.forum(ag, e, until);
        const x = A.b.x + A.ux * range(1, 4) - A.uy * range(-5, 5), y = A.b.y + A.uy * range(1, 4) + A.ux * range(-5, 5);
        const sp = way.costAt(x, y) < Infinity || clusterAt(x, y) ? spot(x, y, NaN, range(0, TAU), 'stand') : spot(A.priest.x, A.priest.y, NaN, A.priest.a, 'stand');
        go(ag, sp); stay(ag, sp, short(until, 300, 1200));
      },
      guard(ag, e, until) {
        // two to a gate, by one side of it: talking as they watch the road, or sitting a while
        const idx = all.filter(a => a.job === 'guard').indexOf(ag), gi = (idx >> 1) % Math.max(1, gates.length), G = gates[gi];
        if (!G) return ACT.craft(ag, e, until);
        const g = G.guards[gi % 2], o = idx % 2 ? 0.45 : -0.45, x = g.x + G.ux * o, y = g.y + G.uy * o;
        ag.sitting = !ag.sitting;
        const sp = spot(x, y, NaN, g.a + (idx % 2 ? -0.9 : 0.9), ag.sitting ? 'sit' : 'stand', ag.sitting ? { seat: 0.42, stool: true, cl: null } : { anim: 'talk', cl: null });
        go(ag, sp, { carry: 'spear' }); stay(ag, sp, short(until, 480, 1200));
      },
      patrol(ag, e, until) {
        // the watch, two by two, from place to place with their torches
        const targets = [...gates.map(G => G.inner), ...fountains.map(f => [f.spots[0].x, f.spots[0].y]), ...forumPts.slice(0, 6)];
        if (!targets.length) return atHome(ag, until, 'room');
        const [x0, y0] = choice(targets), ox = range(-1, 1), oy = range(-1, 1), ok = way.costAt(x0 + ox, y0 + oy) < Infinity, sp = spot(ok ? x0 + ox : x0, ok ? y0 + oy : y0, NaN, range(0, TAU), 'stand', { cl: null });
        go(ag, sp, { torch: true, carry: 'torch' }); stay(ag, sp, now + range(60, 240), { torch: true });
      },
      sentry(ag, e, until) {
        // up at a gate and along the wall walk to the next gate and back, a
        // spear on the shoulder (a torch by night), stopping at the towers to look out
        const idx = all.filter(a => a.job === 'sentry').indexOf(ag), n = gates.length;
        if (!n || !wallWalk.pts.length) return ACT.patrol(ag, e, until);
        // (two to each stretch by day and two by night, from either end)
        const night = clock.R > 11.8 || clock.R < 0, k = idx >> 1, i = k % n, j = (i + 1) % n, back = (k / n | 0) % 2 === 1;
        const [ix, iy] = gates[back ? j : i].inner;
        go(ag, spot(ix, iy, NaN, 0, 'stand', { cl: null }), night ? { torch: true, carry: 'torch' } : { carry: 'spear' });
        ag.legs.push({ k: 'wall', from: wallWalk.atGate[back ? j : i], to: wallWalk.atGate[back ? i : j], until, night });
      },
      lookout(ag, e, until) {
        // posted on a tower: up by the nearest gate's stairs and along the
        // wall walk to it; there looking out over the country, now this way,
        // now that, a while at a time, a spear on the shoulder (a torch by
        // night); at the end of the watch back along the walk and down
        const posts = wallWalk.posts, idx = all.filter(a => a.job === 'lookout').indexOf(ag);
        if (!posts.length) return ACT.sentry(ag, e, until);
        const night = clock.R > 11.8 || clock.R < 0, Pt = posts[(idx >> 1) % posts.length], G = gates[Pt.gate];
        const kit = night ? { torch: true, carry: 'torch' } : { carry: 'spear' }, lit = night ? { torch: true } : {};
        const there = Math.hypot(ag.x - Pt.x, ag.y - Pt.y) < 1.2 && Math.abs(ag.z - Pt.z) < 0.5;
        // (the day's and the night's each his own place at it, side by side, so the watch is handed over)
        const side = ag.night ? 0.4 : -0.4, px = Pt.x - Math.sin(Pt.out) * side, py = Pt.y + Math.cos(Pt.out) * side;
        const look = a => spot(px, py, Pt.z, a, 'stand', { anim: 'watch', cl: null });
        const glance = () => Pt.out + (chance(0.3) ? (chance(0.5) ? 1 : -1) * range(1, 1.6) : range(-0.5, 0.5));
        const below = spot(...G.inner, NaN, 0, 'stand', { cl: null });
        const way = Pt.up.map(p => [p[0], p[1], p[2]]), ground = [G.inner[0], G.inner[1], groundZ(...G.inner)];
        way[way.length - 1] = [px, py, Pt.z];
        if (until - now < 400) {
          // (the watch over: down, and a word with the guards at the gate)
          if (!there) { go(ag, below); stay(ag, spot(...G.inner, NaN, G.g.angle, 'stand', { anim: 'talk', cl: null }), until); return; }
          stay(ag, look(glance()), Math.max(now + 5, until - 300), lit);
          ag.legs.push({ k: 'climb', pts: [...way.slice().reverse(), ground], torch: night });
          return;
        }
        if (!there && !(warm && !ag.placed)) {
          go(ag, below, kit);
          ag.legs.push({ k: 'climb', pts: [ground, ...way], torch: night });
        } else if (warm && !ag.placed) ag.carry = kit.carry;
        stay(ag, look(glance()), short(until, 90, 360), lit);
      },
      river(ag, e, until) {
        if (!banks.length) return ACT.chores(ag, e, until);
        const [hx, hy] = H(ag).front.out, list = banks.slice().sort((p, q) => Math.hypot(p.x - hx, p.y - hy) - Math.hypot(q.x - hx, q.y - hy)).slice(0, 12);
        const b = choice(list), fish = e.how === 'fish' || ag.job === 'fisher';
        const sp = spot(b.x, b.y, NaN, b.a, fish ? 'stand' : 'kneel', { anim: fish ? 'fish' : 'wash', cl: null });
        go(ag, sp, { carry: fish ? 'rod' : 'bundle' }); stay(ag, sp, fish ? until : short(until, 1800, 3600));
        call(ag, () => { ag.carry = null; });
      },
      show(ag, e, until) {
        // a seat of one's own, by one's family's if they are there already; up the steps to it, and down after
        const L = seatList(e.where), ok = q => !q.by || q.by === ag || now > q.till;
        let q = null;
        const kin = ag.home && ag.home.people.find(p => p !== ag && p.seatQ && p.seatQ.where === e.where && p.seatQ.by === p);
        if (kin) { let bd = 0.08; for (const c of L) if (ok(c) && Math.abs(c.s - kin.seatQ.s) <= 1) { const d = Math.abs(turn(c.t, kin.seatQ.t)) + Math.abs(c.s - kin.seatQ.s) * 0.01; if (d < bd) { bd = d; q = c; } } }
        // (the front rows filling first, each a little way from the next one in)
        if (!q) { const free = []; for (const c of L) { if (ok(c)) free.push(c); if (free.length >= 60) break; } if (free.length) q = choice(free); }
        if (!q) return ACT.stroll(ag, e, short(until, 600, 1800));
        q.by = ag; q.till = until + 900; q.where = e.where; ag.seatQ = q;
        const s = e.where === 'theatre' ? theatreSeat(q) : arenaSeat(q);
        go(ag, s.foot); ag.legs.push({ k: 'climb', pts: s.climb });
        stay(ag, s.sp, until, { watch: e.where });
        ag.legs.push({ k: 'climb', pts: s.climb.slice().reverse() });
        call(ag, () => { if (q.by === ag) q.by = null; ag.seatQ = null; });
      },
      perform(ag, e, until) {
        // up from the orchestra onto the stage, and about it, declaiming
        const st = stage, c = cavea, top = st.z0 + st.h;
        const [x, y] = toWorld(st, range(1.5, st.w - 1.5), range(1, st.d - 1)), face = Math.atan2(c.y - y + Math.sin(c.angle) * 10, c.x - x + Math.cos(c.angle) * 10);
        const sp = spot(x, y, top, face, 'stand', { anim: 'declaim', cl: null });
        if (ag.onStage === clock.day && Math.abs(ag.z - top) < 0.3) ag.legs.push({ k: 'climb', pts: [[ag.x, ag.y, top], [x, y, top]] });
        else {
          const fx = c.x + Math.cos(c.angle) * 1.5, fy = c.y + Math.sin(c.angle) * 1.5;
          go(ag, spot(fx, fy, NaN, 0, 'stand', { cl: null }));
          ag.legs.push({ k: 'climb', pts: [[fx, fy, hAt(fx, fy)], [c.x - Math.cos(c.angle) * 0.6, c.y - Math.sin(c.angle) * 0.6, top], [x, y, top]] });
          ag.onStage = clock.day;
        }
        stay(ag, sp, short(until, 40, 160));
      },
      // ---- the hours one's own, and the needs' ----
      meal(ag, e, until) { if (ag.hunger > 0.25) return eatNow(ag, e); ACT.home(ag, e, until); },
      night(ag, e, until) {
        // the evening at home by the lamp, not sleepy yet: sitting, a last job, the women at their spinning
        if (ag.sex === 'f' && ag.age === 'adult' && chance(0.4)) return ACT.spin(ag, e, short(until, 900, 2400), true);
        atHome(ag, short(until, 600, 1800), choice(['seat', 'bench', 'seat', 'room']));
      },
      siesta(ag, e, until) { if (ag.fatigue > 0.3 && ag.napped !== clock.day) return siestaNow(ag, e); ACT.home(ag, e, until); },
      spin(ag, e, until, indoors) {
        // spinning wool, the distaff under one arm, the spindle turning below: at the door, or indoors
        const h = H(ag);
        if (!indoors && chance(0.55) && !h.upstairs) { const sp = { ...doorSpot(h), anim: 'spin', pose: 'sit', seat: 0.4, stool: true }; go(ag, sp); stay(ag, sp, short(until, 900, 2400)); return; }
        const n = ag.legs.length;
        atHome(ag, short(until, 900, 2400), chance(0.6) ? 'bench' : 'seat');
        for (let i = n; i < ag.legs.length; i++) if (ag.legs[i].k === 'stay' && ag.legs[i].sp) ag.legs[i].sp = { ...ag.legs[i].sp, anim: 'spin' };
      },
      // ---- the shops: each at the work of its trade ----
      shop(ag, e, until) {
        const W = ag.shop || ag.shopwife;
        if (!W) return ACT.craft(ag, e, until);
        const R = clock.R, keeper = W.keeper === ag, wife = !ag.shop && ag.shopwife === W, dur = Math.max(30, Math.min(until - now, range(600, 1800)));
        ag.workAt = W;
        // a place at the work taken a while: before the oven, at the anvil, in a vat, round the mill
        const at = (s, d) => {
          s.by = ag; s.till = now + d + 60;
          const sp = spot(s.x, s.y, s.z, s.a, s.pose, { anim: s.anim, seat: s.seat || 0, stool: !!s.stool, cl: W.C });
          go(ag, sp); stay(ag, sp, now + d, s.circle ? { circle: { ...s.circle, t: rng() * TAU } } : {});
          return true;
        };
        const work = (kinds, d) => { for (const k of kinds) { const l = W.work.filter(s => s.k === k && (!s.by || s.by === ag || now > s.till)); if (l.length) return at(choice(l), d); } return false; };
        // by the counter on a stool, up to serve whoever comes to it
        const sell = d => {
          const c = W.counters.find(c => !c.keeper || c.keeper === ag || !c.keeper.leg || c.keeper.leg.counter !== c);
          if (!c) return false;
          c.keeper = ag;
          const sp = spot(c.sell.x, c.sell.y, c.sell.z, c.sell.a, 'sit', { seat: 0.42, stool: true, cl: W.C });
          go(ag, sp); stay(ag, sp, now + d, { counter: c });
          return true;
        };
        switch (W.trade) {
          case 'bakery':
            // before dawn the bread is made: the corn ground, the dough
            // kneaded, the loaves baked; from dawn it is sold, and taken round
            // in baskets to the big houses
            if (R < 0.3 || R > 14) { if (work(keeper ? ['oven', 'board', 'mill'] : chance(0.6) ? ['mill', 'board', 'oven'] : ['board', 'mill', 'oven'], Math.min(dur, range(400, 1200)))) return; }
            else if (keeper || wife) { if (sell(dur)) return; }
            else if (R < 3.5 && homes.some(h => h.kind === 'domus')) return deliver(ag, 'loaves');
            else if (work(['mill', 'board'], Math.min(dur, range(400, 1000)))) return;
            break;
          // the iron heated at the forge, the bellows worked, beaten out on the anvil, and back to the fire
          case 'smithy': if (work(keeper ? (chance(0.6) ? ['anvil', 'forge'] : ['forge', 'anvil']) : ['forge', 'anvil'], Math.min(dur, range(60, 240)))) return; break;
          case 'fullery': if (work(['vat'], Math.min(dur, range(300, 900)))) return; if (keeper && sell(dur)) return; break;
          case 'pottery': if (work(chance(0.75) ? ['wheel', 'kiln'] : ['kiln', 'wheel'], Math.min(dur, range(300, 1200)))) return; break;
          case 'carpenter': if (work(['workbench'], Math.min(dur, range(300, 1200)))) return; break;
          case 'weaver': if (work(['loom'], dur)) return; break;
          case 'cobbler': {
            const b = W.benches.length && take(W.benches, ag, now + dur);
            if (b) { const sp = spot(b.x, b.y, b.z, b.a, 'sit', { seat: b.seat, anim: 'stitch', cl: W.C }); go(ag, sp); stay(ag, sp, now + dur); return; }
            break;
          }
          case 'barber': {
            // standing by his chair, shaving whoever sits in it
            const s = W.work.find(s => s.k === 'chair');
            if (s) { const sp = spot(s.x, s.y, s.z, s.a, 'stand', { cl: W.C }); go(ag, sp); stay(ag, sp, now + dur, { barber: s.chair }); return; }
            break;
          }
          case 'butcher': if ((!keeper || chance(0.4)) && work(['block'], Math.min(dur, range(200, 600)))) return; break;
          // the latrine's keeper on his stool at the door, taking the coins
          case 'forica': { const sp = { ...doorSpot(W.h), anim: 'count', pose: 'sit', seat: 0.42, stool: true }; go(ag, sp); stay(ag, sp, now + dur); return; }
        }
        // nothing else: at the counter, or at the door at something
        if (sell(dur)) return;
        const sp = { ...doorSpot(W.h), anim: 'craft' };
        go(ag, sp); stay(ag, sp, now + dur);
      },
      tavern(ag, e, until) {
        // an evening at a tavern: at its table, or standing at its counter, a cup of wine, talk, the dice
        const T = shopsOf('caupona').slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y)).slice(0, 3);
        if (!T.length) return ACT.home(ag, e, until);
        const W = choice(T), dur = short(until, 1200, 3600);
        const seat = W.h.S.seats.length ? take(W.h.S.seats, ag, dur) : null;
        if (seat) { const sp = spot(seat.x, seat.y, seat.z, seat.a, 'sit', { seat: 0.42, stool: true, cl: W.C, anim: chance(0.45) ? 'dice' : 'talk' }); go(ag, sp); stay(ag, sp, dur); return; }
        const c = W.counters[0];
        if (!c) return ACT.home(ag, e, until);
        const sp = spot(c.buy.x + range(-0.6, 0.6), c.buy.y + range(-0.6, 0.6), c.buy.z, c.buy.a, 'stand', { anim: 'talk', cl: W.C });
        go(ag, sp); stay(ag, sp, dur, { atCounter: c });
      },
      barber(ag, e, until) {
        // to the barber's to be shaved, and to hear the news: in his chair
        // if it is free, or on the bench to wait a while
        const list = shopsOf('barber').filter(W => W.work.some(s => s.k === 'chair'));
        if (!list.length || ag.sex !== 'm') return ACT.forum(ag, e, until);
        const W = list.slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y))[chance(0.7) ? 0 : rng() * list.length | 0];
        const s = W.work.find(s => s.k === 'chair'), ch = s.chair, dur = range(360, 720);
        if (!ch.by || ch.by === ag || now > ch.till) {
          ch.by = ag; ch.till = now + dur + 180;
          const sp = spot(ch.x, ch.y, ch.z, s.a + Math.PI / 2, 'sit', { seat: ch.seat, cl: W.C });
          go(ag, sp); stay(ag, sp, now + dur, { chairOf: ch }); call(ag, () => { if (ch.by === ag) ch.by = null; });
          return;
        }
        const b = W.benches.length ? take(W.benches, ag, now + 600) : null;
        if (b) { const sp = spot(b.x, b.y, b.z, b.a, 'sit', { seat: b.seat, anim: 'talk', cl: W.C }); go(ag, sp); stay(ag, sp, now + range(200, 500)); return; }
        ACT.forum(ag, e, until);
      },
      // ---- the town's other trades ----
      carrywater(ag, e, until) {
        // from a fountain to a big house or the baths, a full jar on the shoulder; and back for another
        if (!fountains.length) return ACT.porter(ag, e, until);
        const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y))[rng() * Math.min(3, fountains.length) | 0], s = choice(f.spots);
        const fill = spot(s.x, s.y, NaN, s.a, 'bend', { anim: 'fill', cl: null });
        go(ag, fill, { carry: 'jar' }); stay(ag, fill, now + range(30, 70));
        call(ag, () => { ag.carry = 'jar-full'; ag.slow = 0.85; });
        const big = homes.filter(h => h.kind === 'domus' && !h.upstairs);
        let to = null;
        if (big.length && (chance(0.75) || !bath)) { const h = choice(big), [x, y] = h.front.inn; to = spot(x, y, NaN, 0, 'bend', { cl: h.C }); }
        else if (bath && bath.court.length) { const [x, y] = choice(bath.court); to = spot(x, y, fz(bath.pal), 0, 'bend', { cl: bath.C }); }
        if (to) { go(ag, to); stay(ag, to, now + range(10, 25)); }
        call(ag, () => { ag.carry = null; ag.slow = 1; });
      },
      masonry(ag, e, until) {
        // a tomb being made by the road out: a block cut, dressed and lettered, kneeling at it
        const T = ag.tomb || (ag.tomb = tombs.length ? choice(tombs) : null);
        if (!T) return ACT.craft(ag, e, until);
        const o = (ag.id % 3 - 1) * 0.9, x = T.x - Math.sin(T.a) * o, y = T.y + Math.cos(T.a) * o;
        const sp = spot(x, y, NaN, T.a, chance(0.6) ? 'kneel' : 'stand', { anim: 'chisel', cl: null });
        go(ag, sp, { carry: 'tools' });
        call(ag, () => { ag.carry = null; ag.prop = { kind: 'stone', x: x + Math.cos(T.a) * 0.75, y: y + Math.sin(T.a) * 0.75, z: groundZ(x, y), a: T.a, id: ag.id }; });
        stay(ag, sp, until);
        call(ag, () => { ag.prop = null; });
      },
      woodcut(ag, e, until) {
        // out to the trees beyond the fields two by two, to the same tree for
        // the day: one cutting a fallen trunk into lengths with the axe, the
        // other at it with the saw, the split wood stacked beside them; then
        // a load carried in: firewood on the back to a bakery's oven, a
        // smithy, the baths' furnaces or a house, or a long timber on the
        // shoulder to a carpenter's
        const crew = all.filter(a => a.job === 'woodcutter'), k = crew.indexOf(ag), mate = crew[k ^ 1], key = clock.day + ':' + (k >> 1);
        if (ag.treeDay !== clock.day) { ag.tree = (mate && mate.treeDay === clock.day && mate.treeKey === key && mate.tree) || woodTree(ag); ag.treeDay = clock.day; ag.treeKey = key; }
        const t = ag.tree;
        if (!t) return ACT.porter(ag, e, until);
        // (the trunk lying a little way from the tree, each at an end of it)
        const a0 = Math.atan2(t.y0 - t.y, t.x0 - t.x), lx = t.x0 + Math.cos(a0) * 0.8, ly = t.y0 + Math.sin(a0) * 0.8, side = k % 2 ? 1 : -1;
        let x = lx + Math.cos(a0 + Math.PI / 2) * 0.9 * side, y = ly + Math.sin(a0 + Math.PI / 2) * 0.9 * side;
        if (!(way.costAt(x, y) < Infinity)) { x = t.x0; y = t.y0; }
        const face = Math.atan2(ly - y, lx - x), saw = k % 2 === 1;
        const sp = spot(x, y, NaN, face, saw ? 'bend' : 'stand', { anim: saw ? 'saw' : 'axe', cl: null });
        go(ag, sp, { carry: 'axe' });
        call(ag, () => {
          ag.carry = null;
          ag.prop = { kind: 'log', x: lx, y: ly, z: groundZ(lx, ly), a: a0 + Math.PI / 2, id: ag.id };
          // (the stack of split wood, the day's, growing)
          t.pile = t.pile || { kind: 'woodpile', x: lx + Math.cos(a0) * 1.8, y: ly + Math.sin(a0) * 1.8, z: groundZ(lx, ly), a: a0, id: ag.id + 7, n: 2 };
          if (!saw) ag.pile = t.pile;
        });
        stay(ag, sp, short(until, 1800, 3600));
        call(ag, () => {
          ag.prop = null; if (t.pile) t.pile.n = Math.min(12, t.pile.n + 2);
          const timber = shopsOf('carpenter').length && chance(0.3);
          ag.carry = timber ? 'timber' : 'wood'; ag.slow = 0.8; ag.load = timber ? 'carpenter' : 'fire';
        });
        call(ag, () => {
          // where it goes
          let W = null, to = null;
          if (ag.load === 'carpenter') W = choice(shopsOf('carpenter'));
          else { const r = rng(), list = r < 0.4 ? shopsOf('bakery') : r < 0.6 ? shopsOf('smithy') : r < 0.75 ? [] : homes.filter(h => !h.upstairs && h.kind !== 'villa'); W = list.length ? choice(list) : null; }
          if (W) { const h = W.h || W, [ox, oy] = h.front.out; to = spot(ox, oy, NaN, 0, 'bend', { cl: null }); }
          else if (bath) { const ent = bath.C && bath.C.ents.find(q => q.ok); if (ent) to = spot(ent.out[0], ent.out[1], NaN, 0, 'bend', { cl: null }); }
          if (to) { ag.legs.unshift({ k: 'go', sp: to }, { k: 'stay', sp: to, until: now + range(15, 30) }, { k: 'call', fn: () => { ag.carry = null; ag.slow = 1; } }); }
          else { ag.carry = null; ag.slow = 1; }
        });
      },
      visit(ag, e, until) {
        // to a house where someone lies sick, his bag in his hand; at the bedside a while; on to the next
        const h = choice(homes.filter(o => o !== H(ag) && o.front && o.front.ok && !o.shop));
        if (!h) return ACT.forum(ag, e, until);
        const d = short(until, 600, 1500);
        if (h.upstairs || !h.S || !h.S.beds.length) { go(ag, homeIn(h), { carry: 'bag' }); hide(ag, d); return; }
        const bd = choice(h.S.beds), o = 0.75, x = bd.x - Math.sin(bd.a) * o * (bd.side % 2 ? 1 : -1), y = bd.y + Math.cos(bd.a) * o * (bd.side % 2 ? 1 : -1);
        const sp = standable({ cl: h.C }, x, y) ? spot(x, y, fz(bd.b), Math.atan2(bd.y - y, bd.x - x), 'bend', { anim: 'heal', cl: h.C }) : homeIn(h);
        go(ag, sp, { carry: 'bag' }); stay(ag, sp, d);
      },
      desk(ag, e, until) {
        // at a little table in the forum: letters written for those who
        // can't, money changed and lent; whoever needs him comes to him
        if (!ag.deskAt) { const p = forumPts.length ? choice(forumPts) : null; if (!p) return ACT.forum(ag, e, until); ag.deskAt = [p[0], p[1], forum ? Math.atan2(forum.y - p[1], forum.x - p[0]) : 0]; }
        const [x, y, a] = ag.deskAt, sp = spot(x, y, NaN, a, 'sit', { seat: 0.42, stool: true, anim: ag.job === 'banker' ? 'count' : 'write', cl: null });
        go(ag, sp);
        call(ag, () => { ag.prop = { kind: 'desk', x: x + Math.cos(a) * 0.5, y: y + Math.sin(a) * 0.5, z: groundZ(x, y), a, id: ag.id }; });
        stay(ag, sp, until); call(ag, () => { ag.prop = null; });
      },
      lictor(ag, e, until) {
        // before his magistrate's platform, the fasces on his shoulder
        const M = ag.magistrate, t = naveSpots && naveSpots.tribunal;
        if (!M || !t) return ACT.forum(ag, e, until);
        const k = all.filter(a => a.job === 'lictor' && a.magistrate === M).indexOf(ag), side = k % 2 ? 1 : -1, mi = M.id % 2 ? -0.7 : 0.7;
        const d = 2.5, x = t.x + Math.cos(t.a) * d - Math.sin(t.a) * (mi + side * 1.1), y = t.y + Math.sin(t.a) * d + Math.cos(t.a) * (mi + side * 1.1);
        const sp = way.costAt(x, y) < Infinity ? spot(x, y, NaN, t.a, 'stand', { anim: 'watch', cl: null }) : talkSpot('forum', forumPts);
        if (!sp) return ACT.forum(ag, e, until);
        go(ag, sp, { carry: 'fasces' }); stay(ag, sp, until); call(ag, () => { ag.carry = null; });
      },
      pipe(ag, e, until) {
        // the pipes: at the morning's sacrifice, beside the priest; at a rich man's dinner; at the play or the games; or at his door, practising
        const w = e.where;
        let sp = null;
        if (w === 'altar' && altars.length) { const A = altars[ag.id % Math.min(altars.length, 3)]; const x = A.priest.x - A.uy * 1.3, y = A.priest.y + A.ux * 1.3; if (way.costAt(x, y) < Infinity) sp = spot(x, y, NaN, A.priest.a, 'stand', { anim: 'pipe' }); }
        else if (w === 'cena') {
          const hs = homes.filter(h => h.kind === 'domus' && h.S && h.S.couches.length && h.master && h.master.vis);
          if (hs.length) { const h = choice(hs), c = h.S.couches[0], x = c.x + Math.cos(c.a - Math.PI / 2) * 1.4, y = c.y + Math.sin(c.a - Math.PI / 2) * 1.4; if (standable({ cl: h.C }, x, y)) sp = spot(x, y, c.z - 0.5, c.a + Math.PI / 2, 'stand', { anim: 'pipe', cl: h.C }); }
        } else if (w === 'theatre' && cavea) { const x = cavea.x + Math.cos(cavea.angle) * 2.2 + Math.sin(cavea.angle) * (ag.id % 2 ? 2 : -2), y = cavea.y + Math.sin(cavea.angle) * 2.2 - Math.cos(cavea.angle) * (ag.id % 2 ? 2 : -2); sp = spot(x, y, NaN, cavea.angle + Math.PI, 'stand', { anim: 'pipe', cl: null }); }
        else if (w === 'arena' && amph) { const r = amph.a0 * 0.85, t = ag.id % 2 ? 0 : Math.PI, x = amph.x + Math.cos(amph.angle + t) * r, y = amph.y + Math.sin(amph.angle + t) * r; sp = spot(x, y, NaN, Math.atan2(amph.y - y, amph.x - x), 'stand', { anim: 'pipe', cl: null }); }
        if (!sp) { sp = { ...doorSpot(H(ag)), anim: 'pipe' }; until = short(until, 600, 1800); }
        go(ag, sp); stay(ag, sp, until);
      },
      rehearse(ag, e, until) { if (!stage || !cavea) return ACT.forum(ag, e, until); ACT.perform(ag, e, short(until, 300, 900)); },
      train(ag, e, until) {
        // two by two on the amphitheatre's sand, with wooden swords and wicker
        // shields; with no amphitheatre, in the baths' exercise court
        const where = amph ? 'sand' : bath && bath.court.length ? 'court' : null;
        if (!where) return ACT.baths(ag, e, until);
        duel(ag, where, short(until, 900, 2400), true);
      },
      fight(ag, e, until) {
        if (!amph) return ACT.show(ag, e, until);
        // a pair at a time, in turn, out into the middle against a bull, a
        // lion or the bear, sword and net; the rest at their bouts round the edge
        const G = all.filter(a => a.job === 'gladiator'), k = G.indexOf(ag) >> 1, n = Math.ceil(G.length / 2) + 1, turnT = 420, slot = Math.floor(now / turnT);
        const fierce = zoo.filter(b => b.kind === 'bull' || b.kind === 'lion' || b.kind === 'bear');
        const end = Math.min(until, (slot + 1) * turnT);
        if (fierce.length && slot % n === k + 1) {
          const prey = fierce[(slot / n | 0) % fierce.length];
          if (!onSand(ag)) { const [x, y] = sandAt(0.35); go(ag, spot(x, y, NaN, 0, 'stand', { anim: 'fight', cl: null }), { carry: null }); return; }
          ag.legs.push({ k: 'chase', who: prey, until: now + range(4, 10), near: prey.kind === 'bull' ? 3.5 : 2.4 });
          ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: Math.min(end, now + range(4, 10)), face: prey, hunt: true });
          return;
        }
        duel(ag, 'sand', Math.max(now + 30, end), false);
      },
      doorkeep(ag, e, until) {
        // on his stool a step inside the door, watching who comes
        const h = H(ag), [ix, iy] = h.front.inn, [ox, oy] = h.front.out, a = Math.atan2(iy - oy, ix - ox);
        const x = ix + Math.cos(a) * 0.6 - Math.sin(a) * 0.8, y = iy + Math.sin(a) * 0.6 + Math.cos(a) * 0.8;
        const sp = standable({ cl: h.C }, x, y) ? spot(x, y, NaN, a + Math.PI, 'sit', { seat: 0.42, stool: true, cl: h.C }) : homeIn(h);
        go(ag, sp); stay(ag, sp, short(until, 1200, 3600));
      },
      escort(ag, e, until) {
        // behind his master wherever he goes in the town; at home, about the house
        const M = H(ag).master;
        if (M && M.vis && !M.asleep && M.cl !== M.home.C && ESCORTED.has(M.doing) && !M.follow) {
          go(ag, spot(M.x, M.y, NaN, M.a, 'stand', { cl: M.cl || null }));
          call(ag, () => { if (M.vis && M.cl !== M.home.C && Math.hypot(M.x - ag.x, M.y - ag.y) < 8) attach(ag, M); });
          return;
        }
        ACT.chores(ag, e, short(until, 120, 300));
      },
      help(ag, e, until) {
        // beside his father at his work, handing him things, working the bellows, learning it
        const d = ag.helps, L = d && d.leg;
        if (!d || !d.vis || !L || L.k !== 'stay' || !L.sp || L.circle || L.duel || L.sleep) return ACT.play(ag, e, short(until, 300, 900));
        const s = L.sp, a = s.a + Math.PI / 2, x = s.x + Math.cos(a) * 0.8, y = s.y + Math.sin(a) * 0.8;
        if (!(d.cl ? standable({ cl: d.cl }, x, y) : way.costAt(x, y) < Infinity)) return ACT.play(ag, e, short(until, 300, 900));
        const sp = spot(x, y, d.cl ? floorAt(d.cl, x, y) : NaN, s.a, 'squat', { anim: 'craft', cl: d.cl || null });
        go(ag, sp); stay(ag, sp, short(until, 600, 1500));
      },
      travel(ag) { travel(ag); },
      hunt: (...a) => ACT_HUNT.hunt(...a), menagerie: (...a) => ACT_HUNT.menagerie(...a),
    };
    // ---- what one's body says: a meal, sleep, a rest at noon ----
    const farFromHome = ag => { const h = H(ag); return !h || Math.hypot(ag.x - h.front.out[0], ag.y - h.front.out[1]) > 220; };
    const OUTDOOR = new Set(['field', 'pasture', 'woodcut']);
    function eatNow(ag, e) {
      const m = mealtime(ag) || 'snack', target = Math.max(0, ag.hunger - MEAL[m]), n = ag.legs.length, w = ag.work ? ag.work.act : null;
      const until = now + Math.max(240, (ag.hunger - target) / EAT) * range(1, 1.3), far = farFromHome(ag);
      ag.meal = true;
      if ((e && DUTY.has(e.act)) || (w === 'shop' && ag.workAt && ag.cl === ag.workAt.C) || ag.job === 'innkeeper' && ag.cl && ag.shop && ag.cl === ag.shop.C) {
        // where one is: a guard at his gate, a lookout on his tower, a shopkeeper in his shop
        const sp = spot(ag.x, ag.y, ag.z, ag.a, ag.pose === 'sit' ? 'sit' : 'stand', { anim: 'eat', seat: ag.seat, stool: ag.stool, cl: ag.cl });
        stay(ag, sp, now + range(400, 900));
      } else if (OUTDOOR.has(w) && !ag.cl && far) ACT.lunch(ag, e, until);
      else if ((ag.job === 'patron' || ag.job === 'domina') && m === 'dinner') ACT.cena(ag, ag.plan.find(p => p.act === 'cena') || { act: 'cena' }, now + range(5400, 9000));
      else if (ag.job === 'slave') atHome(ag, until, chance(0.5) ? 'bench' : 'seat');
      else if (m !== 'dinner' && (far || chance(m === 'lunch' ? 0.25 : 0.08)) && counters.some(c => c.trade === 'caupona' || c.trade === 'bakery')) ACT.eatout(ag, e, until);
      else ACT.eat(ag, e, until);
      mark(ag, n, { food: target });
    }
    function sleepNow(ag, e) {
      const until = now + range(600, 1200), n = ag.legs.length, w = ag.work ? ag.work.act : null;
      // worn out far out in the country by day: asleep on the grass, in the shade
      if (!ag.asleep && OUTDOOR.has(w) && !ag.cl && farFromHome(ag) && clock.R > 0 && clock.R < 11) ACT.lunch(ag, e, until);
      else ACT.sleep(ag, e, until);
      mark(ag, n, { sleep: true });
      for (let i = n; i < ag.legs.length; i++) { const L = ag.legs[i]; if (L.k === 'stay' && L.sp && L.sp.pose !== 'lie') L.sp = { ...L.sp, pose: 'lie', anim: null, seat: 0 }; }
    }
    function siestaNow(ag, e) {
      ag.napped = clock.day;
      const until = now + range(1800, 4000), n = ag.legs.length, w = ag.work ? ag.work.act : null;
      if (OUTDOOR.has(w) && !ag.cl && farFromHome(ag)) { ACT.lunch(ag, e, until); for (let i = n; i < ag.legs.length; i++) { const L = ag.legs[i]; if (L.k === 'stay' && L.sp) L.sp = { ...L.sp, pose: 'lie', seat: 0 }; } }
      else if (w === 'shop' && ag.workAt && !H(ag).S) { const sp = { ...doorSpot(ag.workAt.h), anim: null }; go(ag, sp); stay(ag, sp, until); }
      else ACT.rest(ag, e, until);
      mark(ag, n, { rest: true });
    }
    // the call of nature: in the town, the nearest of its public latrines, a
    // seat on the bench beside whoever is there, a word with them; out in the
    // country, behind a bush
    function easeNow(ag) {
      const h = H(ag), n = ag.legs.length, dur = chance(0.6) ? range(30, 80) : range(100, 220), atHome = h && !farFromHome(ag);
      const seat = (list, C, talk) => { const q = take(list, ag, now + dur + 20); if (!q) return false; const sp = spot(q.x, q.y, q.z, q.a, 'sit', { seat: 0.45, cl: C, anim: talk && chance(0.5) ? 'talk' : null }); go(ag, sp, { carry: ag.carry === 'staff' ? 'staff' : null }); stay(ag, sp, now + dur); return true; };
      const near = foricae.filter(W => Math.hypot(W.b.x - ag.x, W.b.y - ag.y) < 400).sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y)), fo = near[0];
      let ok = false;
      void atHome;
      // (the nearest with a seat free; all full, a wait at the nearest's door, and again)
      if (fo && (ag.cl || inTown(ag.x, ag.y))) {
        for (const W of near.slice(0, 3)) if (!ok) ok = seat(W.h.S.latrines, W.C, true);
        if (!ok && (ag.waited || 0) < 5) {
          ag.waited = (ag.waited || 0) + 1;
          const sp = { ...doorSpot(fo.h), anim: null, pose: 'stand', seat: 0, stool: false };
          go(ag, sp); stay(ag, sp, now + range(30, 90)); call(ag, () => { ag.legs.length = 0; easeNow(ag); });
          return;
        }
      }
      if (ok) ag.waited = 0;
      if (!ok && !ag.cl && !inTown(ag.x, ag.y)) {
        // (behind a bush or a tree near by, out of the way)
        let best = null, bd = 45;
        for (const t of town.trees) { const d = Math.hypot(t.x - ag.x, t.y - ag.y); if (d < bd && t.r < 4) { const a = Math.atan2(ag.y - t.y, ag.x - t.x) + Math.PI, x = t.x + Math.cos(a) * (t.r * 0.8 + 0.4), y = t.y + Math.sin(a) * (t.r * 0.8 + 0.4); if (way.costAt(x, y) < 4 && (!ag.herd || standable({ herd: null }, x, y))) { bd = d; best = [x, y, a + Math.PI]; } } }
        const [x, y, a] = best || [ag.x + range(-4, 4), ag.y + range(-4, 4), rng() * TAU];
        if (way.costAt(x, y) < Infinity) { const sp = spot(x, y, NaN, a, 'squat', { cl: null }); go(ag, sp); stay(ag, sp, now + range(50, 150)); ok = true; }
      }
      if (!ok && h) { go(ag, homeIn(h)); hide(ag, now + dur); ok = true; }
      if (ok) mark(ag, n, { ease: true });
    }
    // a drink: on duty or out at the work in the country, from the flask he
    // carries; at home, from the water jar; in the town, cupped hands at the
    // nearest fountain, or a cup at a tavern's counter; by the river, kneeling at it
    function drinkNow(ag, duty) {
      const n = ag.legs.length, w = ag.work ? ag.work.act : null, h = H(ag);
      const here = () => { const sp = spot(ag.x, ag.y, ag.z, ag.a, ag.pose === 'sit' ? 'sit' : 'stand', { anim: 'drink', seat: ag.seat, stool: ag.stool, cl: ag.cl }); stay(ag, sp, now + range(10, 25)); };
      if (duty || (OUTDOOR.has(w) && !ag.cl && farFromHome(ag) && !(banks.length && banks.some(b => Math.hypot(b.x - ag.x, b.y - ag.y) < 60)))) here();
      else if (!farFromHome(ag) && h && h.S && !h.upstairs && (ag.cl === h.C || chance(0.5))) { const sp = homeSpot(ag, 'store') || homeSpot(ag, 'hearth'); if (sp) { sp.anim = 'drink'; sp.pose = 'stand'; go(ag, sp); stay(ag, sp, now + range(20, 40)); } else here(); }
      else if (!ag.cl && banks.length && !inTown(ag.x, ag.y) && banks.some(b => Math.hypot(b.x - ag.x, b.y - ag.y) < 150)) { const b = banks.slice().sort((p, q) => Math.hypot(p.x - ag.x, p.y - ag.y) - Math.hypot(q.x - ag.x, q.y - ag.y))[0], sp = spot(b.x, b.y, NaN, b.a, 'kneel', { anim: 'fill', cl: null }); go(ag, sp); stay(ag, sp, now + range(25, 45)); }
      else {
        const f = fountains.slice().sort((p, q) => Math.hypot(p.b.x - ag.x, p.b.y - ag.y) - Math.hypot(q.b.x - ag.x, q.b.y - ag.y))[0], c = counters.filter(c => c.trade === 'caupona').sort((p, q) => Math.hypot(p.buy.x - ag.x, p.buy.y - ag.y) - Math.hypot(q.buy.x - ag.x, q.buy.y - ag.y))[0];
        const df = f ? Math.hypot(f.b.x - ag.x, f.b.y - ag.y) : Infinity, dc = c ? Math.hypot(c.buy.x - ag.x, c.buy.y - ag.y) : Infinity;
        if (c && dc < df * 0.6 && ag.age === 'adult') { const sp = spot(c.buy.x + range(-0.4, 0.4), c.buy.y + range(-0.4, 0.4), c.buy.z, c.buy.a, 'stand', { anim: 'drink', cl: clusterOf(c.b) }); go(ag, sp); stay(ag, sp, now + range(60, 240), { atCounter: c }); }
        else if (f && df < 250) { const q = choice(f.spots), sp = spot(q.x, q.y, NaN, q.a, 'bend', { anim: 'drink', cl: null }); go(ag, sp); stay(ag, sp, now + range(15, 35)); }
        else here();
      }
      mark(ag, n, { drink: true });
    }
    // a basket of loaves taken round to a big house's door, and back
    function deliver(ag, item) {
      const h = choice(homes.filter(h => h.kind === 'domus' && !h.upstairs)), [x, y] = h.front.inn, sp = spot(x, y, NaN, 0, 'bend', { cl: h.C });
      go(ag, sp, { carry: 'basket' }); stay(ag, sp, now + range(15, 40)); call(ag, () => { ag.carry = null; });
      void item;
    }
    // inside the walls?
    const outline = town.town.outline;
    function inTown(x, y) {
      let inn = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) if ((outline[i][1] > y) !== (outline[j][1] > y) && x < (outline[j][0] - outline[i][0]) * (y - outline[i][1]) / (outline[j][1] - outline[i][1]) + outline[i][0]) inn = !inn;
      return inn;
    }
    // a woodcutter's tree: a big one out in the country, beyond the
    // fields, not too far from a gate, that can be walked to
    function woodTree(ag) {
      const [hx, hy] = H(ag).front.out, list = [];
      for (const t of town.trees) {
        if (t.kind === 'shrub' || t.kind === 'olive' || t.kind === 'fruit' || t.r < 2.2) continue;
        const d = Math.hypot(t.x - hx, t.y - hy);
        if (d < 80 || d > 330 || inTown(t.x, t.y)) continue;
        const a = rng() * TAU, x0 = t.x + Math.cos(a) * (t.r + 0.8), y0 = t.y + Math.sin(a) * (t.r + 0.8);
        if (!reachable(x0, y0) || way.costAt(x0, y0) > 3.5) continue;
        list.push({ x: t.x, y: t.y, r: t.r, x0, y0 });
        if (list.length > 30) break;
      }
      return list.length ? choice(list) : null;
    }
    // ---- gladiators, two by two: circling, closing, the blows; till one
    // goes down on his knee and the other stands over him, the crowd up;
    // a breather, and at it again. In training, with wooden swords, none
    // goes down ----
    const duels = new Map(), cheers = { theatre: { until: 0, next: 0 }, arena: { until: 0, next: 0 } };
    function duel(ag, where, until, practice) {
      // (a practice bout and a games-day one each its own, on the same sand)
      const o = ag.pair, key = Math.min(ag.id, o ? o.id : ag.id) + where + (practice ? '-practice' : '');
      let D = duels.get(key);
      if (!D) {
        let c = null;
        const G = all.filter(a => a.job === 'gladiator'), k = G.indexOf(ag) >> 1;
        if (where === 'court' && bath.court.length) c = bath.court[(k * 7) % bath.court.length];
        // (out toward the edge of the sand, round it, the beasts' hunt in the middle)
        else if (amph) { const t = k * TAU / 3 + 0.4, u = Math.cos(t) * amph.a0 * 0.68, v = Math.sin(t) * amph.b0 * 0.68, ca = Math.cos(amph.angle), sa = Math.sin(amph.angle); c = [amph.x + u * ca - v * sa, amph.y + u * sa + v * ca]; }
        if (!c) return ACT.forum(ag, { act: 'forum' }, until);
        D = { c, cl: where === 'court' ? bath.C : null, z: where === 'court' ? fz(bath.pal) : NaN, th: rng() * TAU, k: rng() * 9, practice, end: 0, fall: null, rest: 0 };
        duels.set(key, D);
      }
      const side = !o || ag.id < o.id ? 1 : -1, x = D.c[0] + Math.cos(D.th) * side, y = D.c[1] + Math.sin(D.th) * side;
      const sp = spot(x, y, D.z, D.th + (side > 0 ? Math.PI : 0), 'stand', { anim: 'fight', cl: D.cl });
      go(ag, sp, { carry: null }); stay(ag, sp, until, { duel: D, side });
    }
    function duelStep(ag, L, dt) {
      const D = L.duel, o = ag.pair, there = p => p && p.leg && p.leg.duel === D && Math.hypot(p.x - D.c[0], p.y - D.c[1]) < 4;
      if (!there(o) || !there(ag)) { ag.anim = o ? 'watch' : 'fight'; if (!o) ag.a += dt * 0.5; return; }
      if (!D.end) D.end = now + range(150, 330);
      if (!D.fall && now > D.end && !D.practice) { D.fall = chance(0.5) ? ag : o; D.rest = now + range(25, 45); cheers.arena.until = now + range(8, 14); }
      if (D.practice && now > D.end) { D.rest = now + range(40, 90); D.end = D.rest + range(150, 330); }
      if (D.fall) {
        if (now > D.rest) { D.fall = null; D.end = now + range(180, 360); D.rest = now + range(30, 60); }
        else { ag.pose = D.fall === ag ? 'kneel' : 'stand'; ag.anim = D.fall === ag ? null : 'cheer'; return; }
      }
      // (a breather between bouts, stood apart)
      const apart = now < D.rest, th = D.th + 0.35 * Math.sin(now * 0.23 + D.k) + 0.6 * Math.sin(now * 0.071 + D.k * 2);
      const r = apart ? 2.4 : 0.85 + 0.3 * Math.sin(now * 1.9 + D.k * 1.7) * Math.sin(now * 0.37 + D.k);
      const x = D.c[0] + Math.cos(th) * r * L.side, y = D.c[1] + Math.sin(th) * r * L.side;
      if (standable(ag, x, y)) { ag.x = x; ag.y = y; }
      ag.a = th + (L.side > 0 ? Math.PI : 0);
      ag.pose = 'stand'; ag.anim = apart ? null : 'fight';
      ag.ph += dt * (apart ? 0.2 : 1.1);
    }
    // ---- a slave behind his master in the streets: walking where he
    // walked, a couple of steps back; waiting a little way off where he stops ----
    const ESCORTED = new Set(['forum', 'tribunal', 'salutatio', 'stroll', 'temple', 'market', 'barber']);
    function attach(ag, M) {
      if (M.follow) return;
      M.train = (M.train || []).filter(f => f !== ag).concat([ag]);
      ag.follow = M; ag.legs.length = 0; ag.leg = null; ag.cl = null;
    }
    function detach(ag) {
      const M = ag.follow;
      if (!M) return;
      M.train = (M.train || []).filter(f => f !== ag);
      if (!M.train.length) { M.train = null; if (!M.cart) M.trail = null; }
      ag.follow = null; ag.legs.length = 0; ag.leg = null; ag.cl = M.cl && Math.hypot(M.x - ag.x, M.y - ag.y) < 3 ? M.cl : null;
      ag.pose = 'stand';
    }
    // in an atrium: the master beyond its pool, the callers between it and the door
    function atriumSpot(h, master) {
      const atrium = h.C.bs.find(b => b.hole && b.use === 'domus');
      if (!atrium) return null;
      const [s1, t1, s2, t2] = atrium.hole, [hx, hy] = toWorld(atrium, (s1 + s2) / 2, (t1 + t2) / 2);
      const [ex, ey] = h.front.inn, d = Math.hypot(ex - hx, ey - hy) || 1, ux = (ex - hx) / d, uy = (ey - hy) / d;
      const r = Math.max(s2 - s1, t2 - t1) / 2 + 1.1, a = Math.atan2(uy, ux);
      if (master) return spot(hx - ux * r, hy - uy * r, fz(atrium), a, 'stand', { anim: 'talk', cl: h.C });
      const q = range(r, Math.max(r + 0.5, d - 1.5)), o = range(-1.6, 1.6);
      return spot(hx + ux * q - uy * o, hy + uy * q + ux * o, NaN, a + Math.PI + range(-0.3, 0.3), 'stand', { cl: h.C });
    }
    // the school: under a portico of the forum, the boys in rows on the
    // ground before the master
    let school = null;
    function schoolSpot(master) {
      if (!school) {
        const pc = B.find(b => b.use === 'portico' && !b.hole && forum && insideConvex(forum.poly, b.x, b.y));
        if (!pc) return null;
        const L = Math.max(pc.w, pc.d), along = pc.w >= pc.d, s0 = L * range(0.2, 0.6);
        school = { pc, along, s0, n: 0 };
      }
      const { pc, along, s0 } = school;
      const D = Math.min(pc.w, pc.d), at = (s, t) => toWorld(pc, along ? s : t, along ? t : s);
      if (master) { const [x, y] = at(s0 - 1.2, D * 0.5), [x2, y2] = at(s0 + 1, D * 0.5); return spot(x, y, NaN, Math.atan2(y2 - y, x2 - x), 'stand', { anim: 'talk', cl: null }); }
      const k = school.n++ % 15, row = k / 5 | 0, col = k % 5;
      const [x, y] = at(s0 + 0.6 + row * 0.85, D * 0.5 + (col - 2) * 0.75), [x2, y2] = at(s0 - 1.2, D * 0.5);
      return spot(x, y, NaN, Math.atan2(y2 - y, x2 - x), 'sit', { seat: 0, cl: null });
    }
    // a seat at the theatre: on a step of the half ring, facing the stage
    // every seat of the theatre's half ring, of the amphitheatre's ring, a
    // body's breadth apart: which step, and how far round
    const SEATS = {};
    function seatList(where) {
      if (SEATS[where]) return SEATS[where];
      const out = [];
      if (where === 'theatre' && cavea) {
        const c = cavea, steps = Math.round((c.r1 - c.r0) / 0.8), span = Math.PI - 0.24;
        for (let s = 1; s <= steps - 2; s++) { const n = Math.floor((c.r0 + s * 0.8 + 0.5) * span / 0.62); for (let k = 0; k < n; k++) out.push({ s, t: -span / 2 + (k + 0.5) * span / n }); }
      } else if (where === 'arena' && amph) {
        const b = amph, steps = Math.round((b.a - b.a0) / 0.8), r0 = b.a0 / b.a;
        // (none in the four ways in, cut through the seats as the view draws
        // them: whole slices of the ring, a ninety-sixth each, widening outward)
        const gap = (t, rho) => { const a = (Math.floor(t / TAU * 96) + 0.5) / 96 * TAU; return Math.abs(rho * b.b * Math.sin(a)) < 2.2 || Math.abs(rho * b.a * Math.cos(a)) < 2.2; };
        for (let s = 1; s <= steps - 2; s++) {
          const rho = r0 + (1 - r0) * (s + 0.5) / steps, A = b.a * rho, Bb = b.b * rho, per = Math.PI * (3 * (A + Bb) - Math.sqrt((3 * A + Bb) * (A + 3 * Bb))), n = Math.floor(per / 0.62);
          for (let k = 0; k < n; k++) { const t = (k + 0.5) / n * TAU; if (!gap(t, rho)) out.push({ s, t }); }
        }
      }
      return (SEATS[where] = out.sort((p, q) => p.s - q.s || rng() - 0.5));
    }
    function theatreSeat(q) {
      const c = cavea, steps = Math.round((c.r1 - c.r0) / 0.8), rise = c.h / steps;
      const s = q.s, r = c.r0 + s * 0.8 + 0.5, t = q.t;
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle), P = (rr, tt) => { const x = rr * Math.cos(tt), y = rr * Math.sin(tt); return [c.x + x * ca - y * sa, c.y + x * sa + y * ca]; };
      const [x, y] = P(r, t), z = c.z0 + 1 + s * rise, face = Math.atan2(c.y - y, c.x - x);
      // up from the orchestra, step by step
      const climb = [];
      for (let q = 0; q <= s; q++) { const [px, py] = P(c.r0 + q * 0.8 + 0.4, t); climb.push([px, py, c.z0 + 1 + q * rise]); }
      const [fx, fy] = P(c.r0 - 1.2, t);
      return { foot: spot(fx, fy, NaN, face, 'stand', { cl: null }), climb, sp: spot(x + Math.cos(face) * 0.25, y + Math.sin(face) * 0.25, z - rise, face, 'sit', { seat: rise, cl: null }) };
    }
    function arenaSeat(q) {
      const b = amph, steps = Math.round((b.a - b.a0) / 0.8), r0 = b.a0 / b.a;
      const s = q.s, rho = r0 + (1 - r0) * (s + 0.5) / steps, t = q.t;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), P = (rr, tt) => { const x = rr * b.a * Math.cos(tt), y = rr * b.b * Math.sin(tt); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca]; };
      const [x, y] = P(rho, t), z = b.z0 + 3.5 + s * b.h / steps, face = Math.atan2(b.y - y, b.x - x);
      // in under the seats by the nearest way, and up
      const g = Math.round(t / (Math.PI / 2)) * Math.PI / 2, climb = [];
      const [gx, gy] = P(r0 + (1 - r0) * 0.6, g);
      climb.push([gx, gy, b.z0]);
      for (let q = 0; q <= s; q++) { const [px, py] = P(r0 + (1 - r0) * (q + 0.5) / steps, t); climb.push([px, py, b.z0 + 3.5 + q * b.h / steps]); }
      const [fx, fy] = P(1 + 2 / b.a, g);
      return { foot: spot(fx, fy, NaN, face, 'stand', { cl: null }), climb, sp: spot(x, y, z - 0.4, face, 'sit', { seat: 0.4, cl: null }) };
    }
    // the work in a field, as the crop and the month have it: down its rows
    // and back, a step at a time
    function fieldWork(f, ag) {
      const m = clock.month, c = Math.cos(f.angle), s = Math.sin(f.angle);
      const cx = f.poly.reduce((a, p) => a + p[0], 0) / 4, cy = f.poly.reduce((a, p) => a + p[1], 0) / 4;
      const loc = f.poly.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
      const hu = Math.max(...loc.map(p => Math.abs(p[0]))) - 1.2, hv = Math.max(...loc.map(p => Math.abs(p[1]))) - 1.2;
      const crop = f.crop;
      let anim = 'hoe', pose = 'bend', tool = 'hoe', rate = 0.04;
      if (crop === 'wheat') { if (m >= 5 && m <= 6) { anim = 'reap'; tool = 'sickle'; rate = 0.08; } else if (m >= 9 && m <= 10) { anim = 'sow'; pose = 'walk'; tool = 'bag'; rate = 0.7; } }
      else if (crop === 'hay' || crop === 'meadow') { if (m >= 4 && m <= 6) { anim = 'scythe'; pose = 'stand'; tool = 'scythe'; rate = 0.12; } }
      else if (crop === 'vines') { if (m >= 8 && m <= 9) { anim = 'pick'; tool = 'basket'; } else if (m <= 2) { anim = 'prune'; pose = 'stand'; tool = 'knife'; } }
      else if (crop === 'olives' || crop === 'orchard') { if ((crop === 'olives' && (m >= 9 || m <= 0)) || (crop === 'orchard' && m >= 5 && m <= 8)) { anim = chance(0.5) ? 'beat' : 'gather'; pose = anim === 'beat' ? 'stand' : 'squat'; tool = anim === 'beat' ? 'pole' : 'basket'; rate = 0.02; } }
      else if (crop === 'fallow' || crop === 'stubble') { anim = 'dig'; tool = 'mattock'; if (ag.team && ((m >= 9 && m <= 10) || (m >= 1 && m <= 3))) { anim = 'plough'; pose = 'walk'; tool = null; rate = 0.75; } }
      const u = range(-hu, hu), v = range(-hv, hv), pt = (uu, vv) => [cx + uu * c - vv * s, cy + uu * s + vv * c];
      const [x, y] = pt(u, v);
      const sp = spot(x, y, NaN, f.angle, pose, { anim, cl: null });
      return { sp, tool, rate, u, v, dir: chance(0.5) ? 1 : -1, hu, hv, pt, a: f.angle, step: anim === 'plough' ? 2.2 : 1.6 };
    }

    // ---- the travellers: in from the end of a road, to the town, about
    // it a while, and away by another road ----
    // the seconds till first light
    const toDawn = () => { const R = clock.R; return R < 0.3 ? secs(clock, R, 0.3) : secs(clock, R, 18) + secs(clock, -6, 0.3); };
    // a tavern for the night: the nearest to where one is; at its table or
    // counter of an evening, then up to its rooms till first light
    function inn(ag, at) {
      const T = shopsOf('caupona');
      if (!T.length) return false;
      const W = T.slice().sort((p, q) => Math.hypot(p.b.x - at[0], p.b.y - at[1]) - Math.hypot(q.b.x - at[0], q.b.y - at[1]))[0];
      const sup = clock.R > 10 && clock.R < 13.6, dawn = now + toDawn() + range(0, 1800);
      const evening = (who) => {
        if (!sup) return;
        const seat = W.h.S.seats.length ? take(W.h.S.seats, who, now + 3600) : null, c = W.counters[0];
        const sp = seat ? spot(seat.x, seat.y, seat.z, seat.a, 'sit', { seat: 0.42, stool: true, cl: W.C, anim: 'eat' }) : c ? spot(c.buy.x + range(-0.5, 0.5), c.buy.y + range(-0.5, 0.5), c.buy.z, c.buy.a, 'stand', { cl: W.C, anim: 'talk' }) : null;
        if (sp) { who.legs.push({ k: 'go', sp }, { k: 'stay', sp, until: now + range(1500, 3000) }); }
      };
      if (ag.man) {
        // the horse tied at the door all night, the rider in to his supper and his bed
        const [ox, oy] = W.h.front.out, dest = spot(ox + range(-1.5, 1.5), oy + range(-1.5, 1.5), NaN, 0, 'stand', { cl: null });
        go(ag, dest);
        call(ag, () => {
          ag.kind = 'horse'; ag.tied = true;
          const m = ag.man, a = ag.a;
          m.x = ag.x - Math.sin(a) * 0.9; m.y = ag.y + Math.cos(a) * 0.9; m.z = groundZ(m.x, m.y); m.a = a; m.cl = null; m.vis = true; m.legs.length = 0; m.leg = null;
          m.doing = 'inn'; evening(m);
          m.legs.push({ k: 'go', sp: homeIn(W.h) }, { k: 'hide', until: dawn }, { k: 'go', sp: spot(m.x, m.y, NaN, a, 'stand', { cl: null }) }, { k: 'call', fn: () => { m.vis = false; ag.kind = 'rider'; ag.tied = false; if (ag.leg && ag.leg.k === 'stay') ag.leg.until = now; } });
        });
        ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: dawn + 7200, tether: true });
      } else {
        evening(ag);
        go(ag, homeIn(W.h)); hide(ag, dawn);
      }
      ag.doing = 'inn';
      return true;
    }
    function travel(ag) {
      const R = clock.R, night = R > 12.3 || R < -0.4, late = R > 10.8 || R < -0.4;
      const show = v => { ag.vis = v; for (const f of ag.train || []) f.vis = v; if (ag.cart) ag.cart.vis = v; };
      const T = ag.trip || (ag.trip = { stage: 'away' });
      // (on the road by night only the carts: the rest wait for the morning, or put up at an inn)
      if (T.stage === 'away' && night && ag.traveller !== 'cart' && !T.waited) {
        T.waited = true; show(false);
        hide(ag, now + toDawn() + range(0, 5400));
        return;
      }
      if (T.stage !== 'away' && late && ag.traveller !== 'cart' && !T.inned && T.from) {
        T.inned = true; leaveGroup(ag);
        const G = gates.length ? gates.slice().sort((p, q) => Math.hypot(p.g.x - ag.x, p.g.y - ag.y) - Math.hypot(q.g.x - ag.x, q.g.y - ag.y))[0] : null;
        if (inn(ag, inTown(ag.x, ag.y) || !G ? [ag.x, ag.y] : G.inner)) { T.stage = 'leave'; return; }
      }
      if (T.stage === 'away') {
        T.waited = false; T.inned = false;
        T.from = choice(ends); T.to = choice(ends);
        if (ag.cart) { ag.cart.load = choice(LOADS); ag.cart.left = 1; }
        if (warm && rng() < 0.6 && (!night || ag.traveller === 'cart')) {
          // already on the road in
          const pts = T.from.road.points, p = pts[Math.min(T.from.q, 3 + (rng() * Math.max(1, T.from.q - 3) | 0))];
          ag.x = p[0]; ag.y = p[1]; ag.z = groundZ(...p); ag.cl = null; ag.placed = true; show(true);
        } else {
          // a while before coming (fewer by night; a cart comes to wait for the dark)
          hide(ag, now + (warm ? range(0, 1500) : night && ag.traveller !== 'cart' ? range(900, 3600) : range(60, 900)));
          call(ag, () => { ag.x = T.from.x; ag.y = T.from.y; ag.z = groundZ(ag.x, ag.y); ag.cl = null; ag.trail = null; show(true); });
          T.stage = 'come';
          return;
        }
        T.stage = 'come';
      }
      if (T.stage === 'come') {
        const G = gates.length ? gates.slice().sort((p, q) => Math.hypot(p.g.x - T.from.x, p.g.y - T.from.y) - Math.hypot(q.g.x - T.from.x, q.g.y - T.from.y))[0] : null;
        if (G && ag.traveller === 'cart' && !night) {
          // carts wait outside by day: none may go through the streets till dark
          const [ox, oy] = G.outer, d = range(8, 16), o = (ag.id % 2 ? 1 : -1) * range(5.5, 8);
          let sp = spot(ox + G.ux * d - G.uy * o, oy + G.uy * d + G.ux * o, NaN, G.g.angle + Math.PI, 'sit', { seat: 0, cl: null });
          if (!reachable(sp.x, sp.y)) sp = spot(ox + G.ux * d, oy + G.uy * d, NaN, G.g.angle + Math.PI, 'sit', { seat: 0, cl: null });
          go(ag, sp); stay(ag, sp, now + range(900, 2400));
          return;
        }
        // a cart to the storehouse, or with produce to the market, to be unloaded
        const U = ag.cart && ag.cart.left > 0 ? storeFor(ag.cart.load) : null;
        if (U) { go(ag, spot(U.out[0], U.out[1], NaN, 0, 'stand', { cl: null })); call(ag, () => unload(ag, U)); T.stage = 'leave'; return; }
        let dest = null;
        if (G && (ag.traveller === 'cart' || ag.traveller === 'donkeys' || ag.traveller === 'rider')) {
          // up the main street a way, to unload at the shops
          const [ix, iy] = G.inner;
          for (let k = 0; k < 6 && !dest; k++) { const d = range(10, 50); if (reachable(ix - G.ux * d, iy - G.uy * d)) dest = spot(ix - G.ux * d, iy - G.uy * d, NaN, G.g.angle + Math.PI, 'stand', { cl: null }); }
        } else if (G) {
          if (chance(0.5) && forumPts.length) { dest = talkSpot('forum', forumPts); ag.group = dest && dest.group; }
          else if (chance(0.3) && altars.length) { const A = choice(altars), d = range(2.5, 6), o = range(-3, 3); dest = spot(A.b.x + A.ux * d - A.uy * o, A.b.y + A.uy * d + A.ux * o, NaN, A.out + Math.PI, 'stand', { anim: 'pray' }); }
          else if ((counters.length || stalls.length)) { const c = stalls.length && chance(0.5) ? choice(stalls) : choice(counters.length ? counters : stalls); dest = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { cl: clusterOf(c.b), anim: 'talk' }); dest.counter = c; }
        }
        if (dest && ag.man) {
          // the horse tied up; the rider on foot to the forum, a shop or a stall, and back to it
          go(ag, dest);
          call(ag, () => {
            ag.kind = 'horse'; ag.tied = true;
            const m = ag.man, a = ag.a;
            m.x = ag.x - Math.sin(a) * 0.9; m.y = ag.y + Math.cos(a) * 0.9; m.z = groundZ(m.x, m.y); m.a = a; m.cl = null; m.vis = true; m.legs.length = 0; m.leg = null;
            const there = forumPts.length && chance(0.5) ? talkSpot('forum', forumPts) : counters.length ? (() => { const c = choice(counters); const s = spot(c.buy.x, c.buy.y, c.buy.z, c.buy.a, 'stand', { cl: clusterOf(c.b), anim: 'talk' }); s.counter = c; return s; })() : null;
            if (there) { m.legs.push({ k: 'go', sp: there }, { k: 'stay', sp: there, until: now + range(400, 1500), atCounter: there.counter }); m.group = there.group; }
            const back = spot(m.x, m.y, NaN, a, 'stand', { cl: null });
            m.legs.push({ k: 'call', fn: () => leaveGroup(m) }, { k: 'go', sp: back }, { k: 'call', fn: () => { m.vis = false; ag.kind = 'rider'; ag.tied = false; if (ag.leg && ag.leg.k === 'stay') ag.leg.until = now; } });
          });
          ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 7200, tether: true });
        } else if (dest) { go(ag, dest); stay(ag, dest, now + range(400, 1800), dest.counter ? { atCounter: dest.counter } : {}); }
        // and maybe somewhere else before going
        if (dest && !dest.cl && forumPts.length && chance(0.4) && ag.traveller === 'walker') { const d2 = talkSpot('forum', forumPts); go(ag, d2); stay(ag, d2, now + range(300, 1200)); call(ag, () => { ag.group = d2.group; leaveGroup(ag); }); }
        T.stage = 'leave';
        return;
      }
      // away by another road, out of sight at its end
      leaveGroup(ag);
      go(ag, spot(T.to.x, T.to.y, NaN, 0, 'walk', { cl: null }));
      call(ag, () => show(false));
      T.stage = 'away';
    }

    // a cart unloaded: the oxen and the cart left standing, the carter to
    // its side and back and forth to the door with a load at a time,
    // bending to take it up and to set it down, till the cart is empty;
    // then back to his oxen
    function unload(ag, U) {
      const cart = ag.cart, item = ITEM[cart.load] || 'sack', x0 = ag.x, y0 = ag.y, a0 = ag.a, trail = ag.trail ? ag.trail.slice() : null, torchy = ag.torchy;
      ag.parked = true; ag.torchy = false;
      const px = -Math.sin(cart.a), py = Math.cos(cart.a);
      const side = [1, -1].map(sg => [cart.x + px * sg * 1.3, cart.y + py * sg * 1.3]).filter(p => way.costAt(...p) < Infinity)
        .sort((p, q) => Math.hypot(p[0] - U.out[0], p[1] - U.out[1]) - Math.hypot(q[0] - U.out[0], q[1] - U.out[1]))[0] || [x0, y0];
      const at = spot(side[0], side[1], NaN, Math.atan2(cart.y - side[1], cart.x - side[0]), 'bend', { cl: null });
      const n = 5 + (rng() * 4 | 0);
      // (a while bent there, then on)
      const pause = (sp, secs, next) => call(ag, () => { stay(ag, sp, now + secs); call(ag, next); });
      const trip = k => {
        if (k >= n) {
          go(ag, spot(x0, y0, NaN, a0, 'stand', { cl: null }));
          call(ag, () => { ag.x = x0; ag.y = y0; ag.a = a0; ag.trail = trail; ag.parked = false; ag.torchy = torchy; ag.carry = null; });
          return;
        }
        go(ag, at, { carry: null });
        pause(at, range(3, 6), () => {
          ag.carry = item; cart.left = 1 - (k + 1) / n;
          const d = U.drop();
          go(ag, d);
          pause(d, range(2, 4), () => { ag.carry = null; trip(k + 1); });
        });
      };
      trip(0);
    }

    // ================= the beasts, each its own way =================
    function beast(ag) {
      const R = clock.R, night = R > 12.6 || R < -0.3, noon = R > 5.2 && R < 7.8;
      if (ag.follow) return;
      if (ag.herd && ag.herd.mode === 'drove') { ag.leg = { k: 'drove' }; return; }
      if (ag.exotic) return exotic(ag);
      if (ag.herd && ag.herd.mode === 'gather') {
        // to the shepherd at the gate, the others there already
        const Hd = ag.herd, [gx, gy] = Hd.gather, r = 1 + Math.sqrt(Hd.beasts.length) * (Hd.kind === 'cow' || Hd.kind === 'horse' ? 1.2 : 0.55);
        let tx = ag.x, ty = ag.y;
        for (let k = 0; k < 6; k++) { const a = rng() * TAU, d = r * Math.sqrt(rng()), x = gx + Math.cos(a) * d, y = gy + Math.sin(a) * d; if (standable(ag, x, y) && way.los([ag.x, ag.y], [x, y])) { tx = x; ty = y; break; } }
        const d = Math.hypot(tx - ag.x, ty - ag.y);
        if (d > 0.4) ag.legs.push({ k: 'trot', x: tx, y: ty, speed: d > 12 ? ag.speed * 2.2 : ag.speed * 1.2, pose: d > 12 ? 'run' : 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: chance(0.5) ? 'stand' : 'graze', until: now + range(3, 10) });
        return;
      }
      if (ag.herd && ag.herd.mode === 'graze' && ag.herd.trough && !night && !warm && now > (ag.drinkAt ?? (ag.drinkAt = now + range(0, 4) * 3600))) {
        // thirsty: to the trough, a drink, head down at it, and back to the grass
        const W = ag.herd.trough, a = W.a + (chance(0.5) ? Math.PI / 2 : -Math.PI / 2), o = range(-0.7, 0.7), x = W.x + Math.cos(W.a) * o + Math.cos(a) * 0.75, y = W.y + Math.sin(W.a) * o + Math.sin(a) * 0.75;
        ag.drinkAt = now + range(2.5, 4.5) * 3600 / (clock.month >= 5 && clock.month <= 7 ? 1.5 : 1);
        if (way.costAt(x, y) < Infinity) {
          ag.dest = [x, y];
          if (way.los([ag.x, ag.y], [x, y])) ag.legs.push({ k: 'trot', x, y, speed: ag.speed * 1.1, pose: 'walk' }); else ag.legs.push({ k: 'go', sp: spot(x, y, NaN, a + Math.PI, 'stand', { cl: null }) });
          ag.legs.push({ k: 'stay', sp: null, pose: 'graze', until: now + range(20, 45), face: { x: W.x, y: W.y, vis: true }, drinking: true });
          return;
        }
      }
      if (ag.herd && ag.herd.kind === 'pig') {
        // pigs: rooting about the pasture, snouts down; to the wallow, to
        // stand in it, to roll and lie in it, the more in the heat of the day;
        // lying down at night, close together, some in the mud
        const Hd = ag.herd, M = Hd.f.mud, hot = R > 4 && R < 9;
        const wallow = M && (night ? chance(0.3) : chance(hot ? 0.65 : 0.25));
        // (caked with it after a wallow, drying and flaking off over the hours)
        ag.muddy = clamp((ag.muddy || 0) - (now - (ag.mudT ?? now)) / 7200 + (wallow ? 0.45 : 0), 0, 1); ag.mudT = now;
        let tx, ty;
        for (let k = 0; k < 6 && tx === undefined; k++) {
          let x, y;
          if (wallow) { const t = rng() * TAU, q = Math.sqrt(rng()) * 0.8; x = M.x + Math.cos(M.a) * M.rx * q * Math.cos(t) - Math.sin(M.a) * M.ry * q * Math.sin(t); y = M.y + Math.sin(M.a) * M.rx * q * Math.cos(t) + Math.cos(M.a) * M.ry * q * Math.sin(t); }
          else { const [u, v] = Hd.clampU(Hd.mx + gauss() * Hd.spread, Hd.my + gauss() * Hd.spread * 0.8); [x, y] = Hd.pt(u, v); }
          if (standable(ag, x, y) && way.los([ag.x, ag.y], [x, y]) && (k > 4 || !Hd.beasts.some(b => b !== ag && Math.hypot((b.dest || [b.x])[0] - x, (b.dest || [0, b.y])[1] - y) < 0.9))) [tx, ty] = [x, y];
        }
        if (rng() < 0.05) { Hd.mx = clamp(Hd.mx + gauss() * 3, -Hd.hu * 0.8, Hd.hu * 0.8); Hd.my = clamp(Hd.my + gauss() * 3, -Hd.hv * 0.8, Hd.hv * 0.8); }
        if (tx === undefined) [tx, ty] = [ag.x, ag.y];
        ag.dest = [tx, ty];
        const d = Math.hypot(tx - ag.x, ty - ag.y), lie = night || (wallow && chance(hot ? 0.7 : 0.4));
        if (warm && !ag.placed) { ag.x = tx; ag.y = ty; ag.z = groundZ(tx, ty); ag.placed = true; }
        else if (d > 0.3) ag.legs.push({ k: 'trot', x: tx, y: ty, speed: ag.speed * (d > 10 ? 1.6 : 0.8), pose: 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: lie ? 'lie' : wallow && chance(0.5) ? 'stand' : 'graze', until: now + (lie ? range(300, night ? 2400 : 1500) : range(6, 40)), wallow });
        return;
      }
      if (ag.herd) {
        // grazing near the herd's middle, the middle drifting; lying down
        // in the heat of noon (in a tree's shade, if there is one) and at night
        const Hd = ag.herd;
        if (rng() < 0.04) { Hd.mx = clamp(Hd.mx + gauss() * 3, -Hd.hu * 0.8, Hd.hu * 0.8); Hd.my = clamp(Hd.my + gauss() * 3, -Hd.hv * 0.8, Hd.hv * 0.8); }
        let tx, ty;
        const lie = (night || (noon && chance(0.6))) && ag.kind !== 'horse';
        // (a place in the shade nobody else has, if there is one left)
        if (noon && Hd.shade && chance(0.7)) for (let k = 0; k < 6 && tx === undefined; k++) {
          const p = shadeOf(Hd.shade);
          if (!p) continue;
          const u = (p[0] - Hd.cx) * Hd.c + (p[1] - Hd.cy) * Hd.s, v = -(p[0] - Hd.cx) * Hd.s + (p[1] - Hd.cy) * Hd.c, room = ag.kind === 'sheep' || ag.kind === 'goat' ? 1.1 : 2.2;
          if (Math.abs(u) < Hd.hu && Math.abs(v) < Hd.hv && !Hd.beasts.some(b => b !== ag && Math.hypot((b.dest || [b.x, b.y])[0] - p[0], (b.dest || [b.x, b.y])[1] - p[1]) < room)) [tx, ty] = p;
        }
        // (somewhere not taken by another of them, nor where another is going;
        // if nowhere is, the least crowded)
        const room = ag.kind === 'sheep' || ag.kind === 'goat' ? 1.1 : 2.2, at = b => b.dest || [b.x, b.y];
        let best = -1;
        for (let k = 0; k < 8 && tx === undefined; k++) {
          const wide = night ? 0.6 : 1 + 0.9 * (1 - grass[Hd.f.idx]);
          const [u, v] = Hd.clampU(Hd.mx + gauss() * Hd.spread * wide, Hd.my + gauss() * Hd.spread * (night ? 0.4 : 0.7 * wide)), [x, y] = Hd.pt(u, v);
          // (open ground, got to straight, round a haystack, a tree, a well rather than through them)
          const ok = way.costAt(x, y) < Infinity && way.costAt(x + 0.7, y) < Infinity && way.costAt(x - 0.7, y) < Infinity && way.costAt(x, y + 0.7) < Infinity && way.costAt(x, y - 0.7) < Infinity && way.los([ag.x, ag.y], [x, y]);
          if (!ok) continue;
          let near = Infinity;
          for (const b of Hd.beasts) if (b !== ag) { const [bx, by] = at(b); near = Math.min(near, Math.hypot(bx - x, by - y)); }
          if (near >= room) [tx, ty] = [x, y];
          else if (near > best) { best = near; ag.alt = [x, y]; }
        }
        if (tx === undefined && ag.alt) [tx, ty] = ag.alt;
        ag.alt = null;
        if (tx === undefined) [tx, ty] = [ag.x, ag.y];
        ag.dest = [tx, ty];
        const d = Math.hypot(tx - ag.x, ty - ag.y);
        if (warm && !ag.placed) { ag.x = tx; ag.y = ty; ag.z = groundZ(tx, ty); ag.placed = true; }
        else if (d > 0.4) ag.legs.push({ k: 'trot', x: tx, y: ty, speed: d > 15 ? ag.speed * 1.6 : ag.speed * 0.6, pose: 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: lie ? 'lie' : (ag.kind === 'horse' && chance(0.3) ? 'stand' : 'graze'), until: now + (lie ? range(600, 2400) : range(8, 60)) });
        return;
      }
      if (ag.kind === 'dog' && ag.master && ag.master.herd && ag.master.herd.mode !== 'graze') { ag.leg = { k: 'drove' }; return; }
      if (ag.kind === 'dog' && ag.master) {
        // the shepherd's: lying by him, now and then running round the flock
        const m = ag.master;
        if (!m.vis) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + 30, pose: 'lie' }); return; }
        ag.vis = true;
        if (m.cl) {
          const [ox, oy] = m.home.front.out, sp = spot(ox + range(-1, 1), oy + range(-1, 1), NaN, range(0, TAU), 'lie', { cl: null });
          if (warm && !ag.placed) { place(ag, sp); ag.placed = true; } else if (Math.hypot(sp.x - ag.x, sp.y - ag.y) > 3) ag.legs.push({ k: 'go', sp });
          ag.legs.push({ k: 'stay', sp: null, pose: 'lie', until: now + range(20, 90) });
          return;
        }
        const Hd = m.herd, by = m.leg && m.leg.k === 'stay' && Hd && Math.hypot(m.x - Hd.pt(Hd.mx, Hd.my)[0], m.y - Hd.pt(Hd.mx, Hd.my)[1]) < 60;
        if (by && chance(0.15)) {
          const [cx, cy] = Hd.pt(Hd.mx, Hd.my), r = Hd.spread * 2 + 4, a0 = Math.atan2(ag.y - cy, ag.x - cx);
          for (let k = 1; k <= 8; k++) { const [u, v] = Hd.clampU(...(() => { const a = a0 + k * TAU / 8, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; return [(x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c]; })()); const [x, y] = Hd.pt(u, v); ag.legs.push({ k: 'trot', x, y, speed: 4, pose: 'run' }); }
        }
        const x = m.x + range(-2, 2), y = m.y + range(-2, 2);
        if (warm && !ag.placed) { ag.x = x; ag.y = y; ag.z = groundZ(x, y); ag.placed = true; }
        if (m.leg && m.leg.k !== 'stay') ag.legs.push({ k: 'chase', who: m, until: now + 6 });
        else { if (Math.hypot(x - ag.x, y - ag.y) > 1) ag.legs.push({ k: 'trot', x, y, speed: 1.8, pose: 'walk' }); ag.legs.push({ k: 'stay', sp: null, pose: chance(0.6) ? 'lie' : 'sit', until: now + range(10, 60) }); }
        return;
      }
      if (ag.farm) {
        // about the farm: hens in the yard, scratching, in for the night; the
        // dog at the gate; the oxen and the donkey in the barn by night
        const h = ag.farm, V = h.b;
        if (ag.kind === 'ox' && ag.ploughing) { ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 5 }); return; }
        const inBarn = ag.kind !== 'hen' && ag.kind !== 'dog' && h.barn && (night || ag.kind === 'ox');
        if (ag.kind === 'hen' && night) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + range(300, 900), pose: 'stand' }); return; }
        ag.vis = true;
        let x, y, z = NaN, cl = null;
        if (inBarn && h.barn.S && h.barn.S.rooms.length) { const r = choice(h.barn.S.rooms); const s = roomSpot(h.barn.b, r); if (s) { x = s.x; y = s.y; z = s.z; cl = s.cl; } }
        if (x === undefined) {
          if (ag.kind === 'dog' && chance(0.6)) { [x, y] = h.front.out; x += range(-1.5, 1.5); y += range(-1.5, 1.5); }
          else { const [s1, t1, s2, t2] = h.yard;[x, y] = toWorld(V, range(s1, s2), range(t1, t2)); z = fz(V); cl = h.C; }
        }
        // (the hens to whoever is scattering grain for them)
        if (ag.kind === 'hen' && !warm) { const f = feederNear(ag, 30); if (f) { const a = rng() * TAU, r = range(0.6, 2); x = f.x + Math.cos(a) * r; y = f.y + Math.sin(a) * r; z = f.cl ? fz(V) : NaN; cl = f.cl; } }
        // (the dog to anyone coming by)
        if (ag.kind === 'dog' && !warm && chance(0.5)) { const p = personNear(ag, 18, o => o.pose === 'walk' && !o.cl); if (p) { ag.legs.push({ k: 'chase', who: p, until: now + range(6, 14) }); ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(5, 20) }); return; } }
        const sp = spot(x, y, z, range(0, TAU), 'stand', { cl });
        if (warm && !ag.placed) { place(ag, sp); ag.placed = true; }
        else if (Math.hypot(x - ag.x, y - ag.y) > 0.5) {
          if (ag.kind === 'hen' && ag.cl === cl) ag.legs.push({ k: 'trot', x, y, speed: 0.5, pose: 'walk' });
          else ag.legs.push({ k: 'go', sp });
        }
        const pose = ag.kind === 'hen' ? 'graze' : ag.kind === 'dog' ? (chance(0.7) ? 'lie' : 'sit') : night || chance(0.4) ? 'lie' : 'stand';
        ag.legs.push({ k: 'stay', sp: null, pose, until: now + (ag.kind === 'hen' ? range(3, 20) : range(120, 900)) });
        return;
      }
      if (ag.coop) {
        // hens in a yard behind a house
        const e = ag.coop, [ox, oy] = e.out;
        if (night) { ag.vis = false; ag.legs.push({ k: 'stay', sp: null, until: now + 600, pose: 'stand' }); return; }
        ag.vis = true;
        let x = ox + range(-3, 3), y = oy + range(-3, 3), speed = 0.5;
        const f = !warm && feederNear(ag, 12);
        if (f) { const a = rng() * TAU, r = range(0.6, 1.8); x = f.x + Math.cos(a) * r; y = f.y + Math.sin(a) * r; speed = 1.3; }
        if (warm && !ag.placed) { ag.x = ox; ag.y = oy; ag.z = groundZ(ox, oy); ag.placed = true; }
        if (way.costAt(x, y) < Infinity && way.los([ag.x, ag.y], [x, y])) ag.legs.push({ k: 'trot', x, y, speed, pose: 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: 'graze', until: now + range(3, 20) });
        return;
      }
      if (ag.stray) {
        // a dog or a cat about the streets: off somewhere, then lying down a while
        const sleepy = ag.kind === 'dog' ? night : !night && chance(0.7);
        if (!sleepy && !warm && ag.kind === 'dog') {
          // up to someone about in the street, to be made a fuss of or to beg; or to another dog, to sniff
          if (chance(0.35)) { const p = personNear(ag, 22, o => !o.cl && o.pose !== 'lie'); if (p) { ag.legs.push({ k: 'chase', who: p, until: now + range(8, 25) }); ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(10, 40), face: p }); return; } }
          if (chance(0.25)) {
            let o = null, od = 25;
            around(ag.x, ag.y, 25, b => { if (b !== ag && b.kind === 'dog' && b.vis && !b.cl) { const d = Math.hypot(b.x - ag.x, b.y - ag.y); if (d < od) { od = d; o = b; } } });
            if (o) {
              ag.legs.push({ k: 'chase', who: o, until: now + 12, near: 0.9 });
              ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + range(6, 14), face: o });
              if (o.leg && o.leg.k === 'stay') { o.leg.pose = 'stand'; o.leg.face = ag; o.leg.until = Math.max(o.leg.until, now + 16); }
              return;
            }
          }
        }
        if (sleepy || chance(0.4)) { ag.legs.push({ k: 'stay', sp: null, pose: ag.kind === 'cat' ? (chance(0.5) ? 'sit' : 'lie') : 'lie', until: now + range(120, 1200) }); return; }
        const [x, y] = choice(streetPts.filter(p => Math.hypot(p[0] - ag.x, p[1] - ag.y) < 80).concat([choice(streetPts)]));
        ag.legs.push({ k: 'go', sp: spot(x, y, NaN, 0, 'stand', { cl: null }) });
        ag.legs.push({ k: 'stay', sp: null, pose: 'sit', until: now + range(5, 40) });
        return;
      }
      ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + 60 });
    }

    // ================= the arena's beasts =================
    // a point of the sand, so far out from its middle (0…1)
    const sandAt = q => { const b = amph, t = rng() * TAU, r = Math.sqrt(rng()) * q, x = r * b.a0 * Math.cos(t), y = r * b.b0 * Math.sin(t), ca = Math.cos(b.angle), sa = Math.sin(b.angle); return [b.x + x * ca - y * sa, b.y + x * sa + y * ca]; };
    const onSand = ag => { const b = amph; if (!b) return false; const dx = ag.x - b.x, dy = ag.y - b.y, ca = Math.cos(b.angle), sa = Math.sin(b.angle), u = (dx * ca + dy * sa) / b.a0, v = (-dx * sa + dy * ca) / b.b0; return u * u + v * v < 1; };
    const huntOn = () => showOf(clock.day) === 'arena' && clock.R > SHOW[0] - 0.4 && clock.R < SHOW[1] - 0.2;
    function exotic(ag) {
      const C = ag.cage, k = ag.kind;
      if (huntOn()) {
        // on the sand: the lion prowling and turning on the hunters, the bear
        // up on its hind legs at them, the elephant ambling, the ostriches running
        if (!onSand(ag)) { const [x, y] = sandAt(0.3); ag.legs.push({ k: 'go', sp: spot(x, y, NaN, 0, 'stand', { cl: null }) }); return; }
        const nearest = (list, R) => { let b = null, bd = R; for (const o of list) { const d = Math.hypot(o.x - ag.x, o.y - ag.y); if (d < bd) { bd = d; b = o; } } return b; };
        const near = nearest(all.filter(a => (a.job === 'venator' || a.job === 'gladiator' && !(a.leg && a.leg.duel)) && a.vis && onSand(a)), k === 'bull' || k === 'lion' ? 14 : 9);
        // set on: the ostrich off and away from it; the bull, a lion, the bear, turning on it
        const A = ag.attacked && now - ag.attacked.at < 12 && ag.attacked.by.vis ? ag.attacked.by : null;
        if (A) {
          ag.attacked = null;
          if (k === 'ostrich') { const d = Math.hypot(ag.x - A.x, ag.y - A.y) || 1; let [x, y] = [ag.x + (ag.x - A.x) / d * 14, ag.y + (ag.y - A.y) / d * 14]; if (!onSand({ x, y })) [x, y] = sandAt(0.6); ag.legs.push({ k: 'trot', x, y, speed: 5, pose: 'run' }); return; }
          if (k !== 'elephant') {
            ag.legs.push({ k: 'chase', who: A, until: now + range(2, 4), near: 1, speed: k === 'bull' ? 5.5 : k === 'lion' ? 5 : 3 });
            ag.legs.push({ k: 'stay', sp: null, pose: k === 'bear' ? 'rear' : 'stand', until: now + range(3, 6), face: A, maul: A });
            return;
          }
        }
        // the lion and the bear: on whoever is out against them, or on
        // another of the beasts: watching it, then the rush, and at it
        if ((k === 'lion' || k === 'bear') && chance(k === 'lion' ? 0.65 : 0.45)) {
          const other = nearest(zoo.filter(b => b !== ag && b.kind !== k && b.kind !== 'elephant' && b.vis && onSand(b)), k === 'lion' ? 30 : 14);
          const foe = near && (!other || chance(0.6)) ? near : other;
          if (foe) {
            ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + range(1.5, 4), face: foe });
            ag.legs.push({ k: 'chase', who: foe, until: now + range(3, 6), near: 1, speed: k === 'lion' ? 5.5 : 3, then: () => { if (foe.exotic) { foe.attacked = { by: ag, at: now }; foe.legs.length = 0; foe.leg = null; } } });
            ag.legs.push({ k: 'stay', sp: null, pose: k === 'bear' ? 'rear' : 'stand', until: now + range(3, 7), face: foe, maul: foe });
            return;
          }
        }
        // the bull: head down, pawing the sand, and then at him, full tilt
        if (k === 'bull' && near && chance(0.45)) {
          ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: now + range(3, 8), face: near });
          ag.legs.push({ k: 'chase', who: near, until: now + range(2, 4), near: 0.8, speed: 5.5 });
          ag.legs.push({ k: 'trot', ...(([x, y]) => ({ x, y }))(sandAt(0.4)), speed: 1.8, pose: 'walk' });
          return;
        }
        // (in the middle of the sand, where all the seats can see them)
        const [x, y] = sandAt(0.42), run = k === 'ostrich' ? chance(0.6) : k === 'lion' && chance(0.3);
        ag.legs.push({ k: 'trot', x, y, speed: run ? (k === 'ostrich' ? 4.5 : 3.5) : ag.speed * 0.8, pose: run ? 'run' : 'walk' });
        ag.legs.push({ k: 'stay', sp: null, pose: k === 'bear' && near ? 'rear' : k === 'lion' && chance(0.3) ? 'lie' : 'stand', until: now + range(5, 25), face: near || null });
        return;
      }
      // in its cage: pacing to and fro, lying, standing; brought back to it after the games
      if (Math.hypot(ag.x - C.x, ag.y - C.y) > 3) { ag.legs.push({ k: 'go', sp: spot(C.x, C.y, NaN, C.a, 'stand', { cl: null }) }); return; }
      if (warm && !ag.placed) { ag.x = C.x; ag.y = C.y; ag.placed = true; }
      if ((k === 'lion' || k === 'bear') && chance(0.5) && !(clock.R > 12.5 || clock.R < -0.3)) {
        const o = (C.big ? 1.6 : 1.0) * (chance(0.5) ? 1 : -1), x = C.x + Math.cos(C.a) * o, y = C.y + Math.sin(C.a) * o;
        ag.legs.push({ k: 'trot', x, y, speed: 0.9, pose: 'walk' }, { k: 'stay', sp: null, pose: 'stand', until: now + range(1, 4) });
        return;
      }
      ag.legs.push({ k: 'stay', sp: null, pose: k === 'ostrich' || k === 'elephant' ? 'stand' : chance(0.6) ? 'lie' : 'stand', until: now + range(60, 400) });
    }
    // the hunters: on the sand after the beasts, spear levelled, closing in
    // and backing off; on other days at the cages, seeing to the beasts
    const ACT_HUNT = {
      hunt(ag, e, until) {
        if (!amph || !zoo.length) return ACT.show(ag, e, until);
        const prey = zoo[(all.filter(a => a.job === 'venator').indexOf(ag) + Math.floor(now / 90)) % zoo.length];
        if (!onSand(ag)) { const [x, y] = sandAt(0.35); go(ag, spot(x, y, NaN, 0, 'stand', { anim: 'fight', cl: null }), { carry: null }); return; }
        ag.legs.push({ k: 'chase', who: prey, until: now + range(6, 14), near: 3.2 });
        ag.legs.push({ k: 'stay', sp: null, pose: 'stand', until: Math.min(until, now + range(5, 12)), face: prey, hunt: true });
      },
      menagerie(ag, e, until) {
        if (!cages.length) return ACT.forum(ag, e, until);
        const C = choice(cages), a = C.a + Math.PI / 2, x = C.x + Math.cos(a) * 2.2, y = C.y + Math.sin(a) * 2.2;
        const sp = way.costAt(x, y) < Infinity ? spot(x, y, NaN, a + Math.PI, 'stand', { anim: chance(0.5) ? 'watch' : 'scatter', cl: null }) : spot(C.x, C.y, NaN, 0, 'stand', { cl: null });
        go(ag, sp, { carry: chance(0.5) ? 'basket' : null }); stay(ag, sp, short(until, 300, 900)); call(ag, () => { ag.carry = null; });
      },
    };
    // ================= the flocks moved on =================
    // When a pasture is grazed down the shepherd moves his flock to fresh
    // grass: over to its gate, holding it open, the dog sent round behind to
    // bring them in to it; out through it, the flock first, and away along
    // the tracks at their pace in a loose column, he walking behind them
    // with his staff, driving them on, the dog out along their sides keeping
    // them to the way and together, round behind any that hang back (and
    // the leaders stopping to graze when the rest straggle or he falls
    // behind); in at the other's gate, he after the last of them, and they
    // spread out over it.
    // A herdsman his cattle or his horses the same, a dog with him or not.
    // a pasture's gate: the gap, a point a couple of metres inside it, one outside
    function gateOf(f) {
      if (!f.gate || !f.gateway) return null;
      const [gx, gy] = f.gate, [ix, iy] = f.gateway.inside, l = Math.hypot(ix - gx, iy - gy) || 1, nx = (ix - gx) / l, ny = (iy - gy) / l;
      const inn = [gx + nx * 2.2, gy + ny * 2.2], out = [gx - nx * 2.4, gy - ny * 2.4];
      if (!(way.costAt(...inn) < Infinity) || !(way.costAt(...out) < Infinity)) return null;
      return { inn, out, nx, ny, g: [gx, gy] };
    }
    // a line's points with the distance along it at each
    const along = pts => { const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])); return { pts, cum, L: cum[cum.length - 1] }; };
    function atS(R, s) {
      const { pts, cum } = R;
      if (s <= 0) return [pts[0][0], pts[0][1], Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])];
      let k = 0;
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const l = cum[k + 1] - cum[k] || 1, f = clamp((s - cum[k]) / l, 0, 1), a = pts[k], b = pts[k + 1];
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), Math.atan2(b[1] - a[1], b[0] - a[0])];
    }
    // where to: a pasture with nobody in it, not too far, the way to its gate by the tracks, round the town
    function moveFlock(ag, H) {
      const from = gateOf(H.f);
      if (!from) return false;
      // (the best grown of the near ones, a little at random)
      const cands = pastures.filter(f => f !== H.f && !f.herd && !f.bound && !f.pigs && grass[f.idx] > 0.5).map(f => [f, Math.hypot(f.poly[0][0] - H.cx, f.poly[0][1] - H.cy)]).filter(([, d]) => d > 35 && d < 420).map(([f, d]) => [f, grass[f.idx] - d / 700 + rng() * 0.15]).sort((p, q) => q[1] - p[1]).slice(0, 6);
      for (const [f] of cands.slice(0, 4)) {
        const F = frameOf(f), to = gateOf(f);
        if (!to || F.hu < 4 || F.hv < 4) continue;
        const mid = way.path(from.out[0], from.out[1], to.out[0], to.out[1]);
        if (!mid || mid.some(p => inTown(p[0], p[1]))) continue;
        // (in from its gate to its middle, or as near it as is open)
        let end = [F.cx, F.cy];
        if (!way.los(to.inn, end)) { end = [to.inn[0] + to.nx * 6, to.inn[1] + to.ny * 6]; if (!(way.costAt(...end) < Infinity)) end = [to.inn[0] + to.nx * 2, to.inn[1] + to.ny * 2]; }
        const g0 = [from.inn[0] + from.nx * 3, from.inn[1] + from.ny * 3];
        const pts = [way.costAt(...g0) < Infinity ? g0 : from.inn.slice(), from.inn, from.out, ...mid.slice(1, -1), to.out, to.inn, end];
        H.route = along(pts); H.sIn = H.route.cum[pts.length - 2]; H.to = f; f.bound = H;
        H.gather = H.route.pts[0];
        startGather(ag, H, from);
        return true;
      }
      return false;
    }
    function startGather(ag, H, from) {
      H.mode = 'gather'; H.lead = ag; H.t0 = now; H.arrived = false;
      // the flock to him by the gate, the nearest first in the column
      const [gx, gy] = H.gather;
      H.beasts.sort((p, q) => Math.hypot(p.x - gx, p.y - gy) - Math.hypot(q.x - gx, q.y - gy)).forEach((b, k) => { b.rank = k; b.ds = 0; b.drove = true; b.legs.length = 0; b.leg = null; });
      if (H.dog) { H.dog.legs.length = 0; H.dog.leg = { k: 'drove' }; }
      // (he by the gate, to one side, holding it open for them)
      let [hx, hy] = from.inn;
      for (const sd of [1, -1]) { const x = from.inn[0] - from.ny * 1.8 * sd, y = from.inn[1] + from.nx * 1.8 * sd; if (way.costAt(x, y) < Infinity && way.los(from.inn, [x, y])) { hx = x; hy = y; break; } }
      const sp = spot(hx, hy, NaN, Math.atan2(gy - hy, gx - hx), 'stand', { anim: 'shoo', cl: null });
      go(ag, sp, { carry: 'staff' });
      stay(ag, sp, now + 200, { gather: H });
      call(ag, () => startDrove(ag, H));
    }
    function startDrove(ag, H) {
      H.mode = 'drove';
      for (const b of H.beasts) { b.legs.length = 0; b.leg = { k: 'drove' }; }
      const R = H.route, pace = H.kind === 'horse' ? 1.05 : H.kind === 'cow' ? 0.8 : 0.75;
      // (the head of the column at the start of the way, he at the gate)
      H.sHead = 0; H.sBack = R.cum[1]; H.pace = pace; H.arrived = false;
      // he after them, as far as the new one's gate, and there till they are all in
      const n = R.pts.length, [ex, ey] = R.pts[n - 2], endSp = spot(ex, ey, NaN, 0, 'stand', { cl: null });
      ag.legs.push({ k: 'go', sp: endSp, pre: R.pts.slice(1, -1), pace, drove: H, carry: 'staff' });
      stay(ag, spot(ex, ey, NaN, Math.atan2(R.pts[n - 1][1] - ey, R.pts[n - 1][0] - ex), 'stand', { anim: 'shoo', cl: null }), now + 150, { settle: H });
      call(ag, () => endDrove(H));
    }
    // all in: the flock at home in its new pasture
    function endDrove(H) {
      if (H.mode === 'graze') return;
      const f = H.to;
      f.bound = null;
      settle(H, f);
      H.mode = 'graze'; H.route = null; H.to = null;
      for (const b of H.beasts) {
        b.drove = false; b.leg = null; b.legs.length = 0;
        const [u, v] = H.local(b.x, b.y);
        if (Math.abs(u) > H.hu || Math.abs(v) > H.hv) { const [x, y] = H.pt(...H.clampU(u * 0.5, v * 0.5)); b.legs.push({ k: 'go', sp: spot(x, y, NaN, 0, 'stand', { cl: null }) }); }
      }
      if (H.dog) { H.dog.leg = null; H.dog.legs.length = 0; }
    }
    // the flock gathered by the gate, most of it
    const gathered = H => { const [gx, gy] = H.gather, r = 3 + Math.sqrt(H.beasts.length) * (H.kind === 'cow' || H.kind === 'horse' ? 1.6 : 0.8); return H.beasts.filter(b => Math.hypot(b.x - gx, b.y - gy) < r).length >= H.beasts.length * 0.85; };
    // how far along the way the last of them has got
    const lastS = H => H.beasts.reduce((m, b) => Math.min(m, b.ds ?? 0), Infinity);
    // the head of the column on along the way, at their pace, as long as he
    // is close behind them driving them on and they are not strung out
    function pushOn(H, dt) {
      if (H.tHead === now) return;
      H.tHead = now;
      const R = H.route, big = H.kind === 'cow' || H.kind === 'horse', per = big ? 2 : 3;
      const tail = lastS(H), most = 2.6 + ((H.beasts.length - 1) / per | 0) * (big ? 2.5 : 0.95);
      const driven = tail - H.sBack < (big ? 10 : 7), together = H.sHead - tail < most + (big ? 10 : 6);
      if (driven && together) H.sHead = Math.min(R.L, H.sHead + H.pace * dt);
      if (H.sHead >= R.L) H.arrived = true;
    }
    // a beast of the drove: to its place in the column, a little way behind
    // the head of it, a little to one side, and on along the way with it
    function droveStep(ag, dt) {
      const H = ag.herd, R = H.route;
      if (!R) { ag.leg = null; return; }
      pushOn(H, dt);
      const big = H.kind === 'cow' || H.kind === 'horse', per = big ? 2 : 3, row = (ag.rank / per) | 0, col = ag.rank % per - (per - 1) / 2;
      let back = 2.6 + row * (big ? 2.5 : 0.95) + (ag.id % 5) * 0.08;
      if (H.arrived) { const room = R.L - H.sIn - 1.5, most = 2.6 + ((H.beasts.length - 1) / per | 0) * (big ? 2.5 : 0.95); back *= Math.min(1, room / most); }
      const want = clamp(H.sHead - back, 0, R.L);
      // (on along the way only as it gets there)
      const [px, py] = atS(R, ag.ds), close = Math.hypot(px - ag.x, py - ag.y) < (big ? 2.2 : 1.4);
      if (close && ag.ds < want) ag.ds = Math.min(want, ag.ds + (big ? 1.5 : 1.6) * dt);
      const [qx, qy, qa] = atS(R, ag.ds);
      let lat = col * (big ? 1.5 : 0.85) + 0.35 * Math.sin(now * 0.3 + ag.id), x = qx - Math.sin(qa) * lat, y = qy + Math.cos(qa) * lat;
      if (!(way.costAt(x, y) < Infinity) || !way.los([qx, qy], [x, y])) { lat *= 0.3; x = qx - Math.sin(qa) * lat; y = qy + Math.cos(qa) * lat; if (!(way.costAt(x, y) < Infinity)) { x = qx; y = qy; } }
      const d = Math.hypot(x - ag.x, y - ag.y), vmax = (big ? 1.3 : 1.5) * (d > 6 ? 1.6 : 1), v = Math.min(d, vmax * dt, d * 1.5 * dt + 0.02 * dt);
      if (d > 0.05) { ag.x += (x - ag.x) / d * v; ag.y += (y - ag.y) / d * v; ag.a += clamp(turn(ag.a, Math.atan2(y - ag.y, x - ag.x)), -4 * dt, 4 * dt); }
      ag.z = groundZ(ag.x, ag.y);
      const sp = v / Math.max(dt, 1e-3);
      ag.pose = sp > 1.25 ? 'run' : sp > 0.08 ? 'walk' : (ag.id + Math.floor(now / 9)) % 3 ? 'stand' : 'graze';
      ag.ph += v / (STRIDE[ag.kind] || 1);
    }
    // the dog: round behind the flock to bring it in to the gate; on the
    // way out along its sides, up towards the head and back, now one side
    // and now the other, keeping them to the way, and round behind any that
    // hang back
    function dogStep(ag, dt) {
      const M = ag.master, H = M && M.herd;
      if (!H || H.mode === 'graze') { ag.leg = null; return; }
      let tx, ty;
      if (H.mode === 'gather') {
        let cx = 0, cy = 0;
        for (const b of H.beasts) { cx += b.x; cy += b.y; }
        cx /= H.beasts.length; cy /= H.beasts.length;
        const [gx, gy] = H.gather, a0 = Math.atan2(cy - gy, cx - gx) + Math.sin(now * 0.7 + ag.id) * 1.1, r = Math.hypot(cx - gx, cy - gy) + H.spread + 3;
        [tx, ty] = H.pt(...H.clampU(...H.local(gx + Math.cos(a0) * r, gy + Math.sin(a0) * r)));
      } else {
        // (the one furthest behind its place, if any is: round behind it)
        let worst = null, wd = 5;
        for (const b of H.beasts) { const [px, py] = atS(H.route, b.ds); const d = Math.hypot(px - b.x, py - b.y); if (d > wd) { wd = d; worst = b; } }
        if (worst) { const [px, py] = atS(H.route, worst.ds); tx = worst.x + (worst.x - px) / wd * 2; ty = worst.y + (worst.y - py) / wd * 2; }
        else {
          const big = H.kind === 'cow' || H.kind === 'horse', tail = lastS(H), head = Math.max(tail, H.sHead - 2.6);
          const side = Math.floor((now + ag.id * 7) / 25) % 2 ? 1 : -1, w = (big ? 2.2 : 1.6) + 1 + 0.6 * Math.sin(now * 0.9 + ag.id);
          const [qx, qy, qa] = atS(H.route, lerp(tail, head, 0.5 + 0.45 * Math.sin(now * 0.22 + ag.id)));
          for (const sd of [side, -side]) { const x = qx - Math.sin(qa) * w * sd, y = qy + Math.cos(qa) * w * sd; if (way.costAt(x, y) < Infinity) { tx = x; ty = y; break; } }
          if (tx === undefined) { tx = qx; ty = qy; }
        }
        if (!(way.costAt(tx, ty) < Infinity)) { const [qx, qy] = atS(H.route, Math.max(0, lastS(H) - 1)); tx = qx; ty = qy; }
      }
      const d = Math.hypot(tx - ag.x, ty - ag.y), v = Math.min(d, (d > 3 ? 4.2 : 1.8) * dt), nx = ag.x + (tx - ag.x) / (d || 1) * v, ny = ag.y + (ty - ag.y) / (d || 1) * v;
      if (d > 0.3 && (way.costAt(nx, ny) < Infinity)) { ag.x = nx; ag.y = ny; ag.a += clamp(turn(ag.a, Math.atan2(ty - ag.y, tx - ag.x)), -7 * dt, 7 * dt); }
      ag.z = groundZ(ag.x, ag.y); ag.vis = true;
      ag.pose = v / Math.max(dt, 1e-3) > 2 ? 'run' : d > 0.3 ? 'walk' : 'stand';
      ag.ph += v / (STRIDE.dog || 1);
    }

    // ================= each moment =================
    const groundZ = (x, y) => {
      for (const b of bridges) if (inBox(b, x, y)) return b.z0 + b.h;
      return hAt(x, y);
    };
    const bridges = byUse('bridge');
    // what one does next: what one's body says first, sleep or food; then
    // the show, if the town has gone to one; then a rest in the heat of the
    // day; and then what the day's plan has one about at this hour
    const DUTY = new Set(['guard', 'sentry', 'lookout', 'patrol']);
    function think(ag) {
      if (ag.ride) { ag.legs.push({ k: 'hide', until: now + 60 }); return; }
      if (ag.kind === 'person' || ag.kind === 'rider' || ag.traveller === 'rider') {
        if (ag.job === 'traveller' || ag.traveller) { ag.doing = 'travel'; travel(ag); return; }
        if (ag.planDay !== clock.day) { ag.plan = plan(ag); ag.planDay = clock.day; }
        const P = ag.plan, R = clock.R;
        let e = P[0], next = P[1];
        for (let q = 0; q < P.length; q++) if (P[q].at <= R) { e = P[q]; next = P[q + 1]; }
        let until = now + Math.max(20, secs(clock, R, next ? next.at : 18));
        leaveGroup(ag);
        ag.meal = false; ag.slow = 1;
        const done = () => { if (!ag.legs.length) ag.legs.push({ k: 'stay', sp: null, until: now + 30 }); };
        // (on duty, one keeps awake and fed till one can't)
        const duty = DUTY.has(e.act);
        if (ag.asleep ? !woken(ag) : ag.fatigue > (duty ? Math.max(1.12, sleepAt(ag)) : sleepAt(ag))) { ag.doing = 'sleep'; sleepNow(ag, e); return done(); }
        ag.asleep = false;
        if (wantsNature(ag) && (!duty || ag.nature > 1)) { ag.doing = 'nature'; easeNow(ag); return done(); }
        if (wantsDrink(ag)) { ag.doing = 'drink'; drinkNow(ag, duty); return done(); }
        if (wantsFood(ag) && (!duty || ag.hunger > 0.75)) { ag.doing = 'meal'; eatNow(ag, duty ? e : null); return done(); }
        const sh = showAct(ag);
        if (sh) { ag.doing = sh.act; ag.work = sh; ACT[sh.act](ag, sh, now + Math.max(60, secs(clock, R, SHOW[1]))); return done(); }
        if (!duty && wantsSiesta(ag) && ag.job !== 'shepherd' && ag.job !== 'herdsman' && ag.job !== 'innkeeper') { ag.doing = 'siesta'; siestaNow(ag, e); return done(); }
        // long work a stretch at a time, and between, now and then, a break
        if (BREAKS.has(e.act) && !warm) {
          if (until - now > 1500 && now - (ag.rested || -Infinity) > range(1500, 3600) && ag.work === e && chance(0.6)) {
            ag.rested = now; ag.doing = 'interlude';
            ACT.interlude(ag, e, Math.min(until, now + range(300, 1000)));
            return done();
          }
          until = Math.min(until, now + range(900, 2700));
        }
        ag.work = e; ag.doing = e.act;
        (ACT[e.act] || ACT.home)(ag, e, until);
        return done();
      }
      if (ag.kind === 'boat') return;
      beast(ag);
    }
    // the show on now, if one has a part in it or is going to it
    function showAct(ag) {
      const w = showOf(clock.day), R = clock.R;
      if (!w || R < SHOW[0] - 0.6 || R >= SHOW[1] - 0.15 || ag.age === 'child' && !ag.showGoer) return null;
      if (w === 'theatre' && ag.job === 'actor') return { act: 'perform', where: w };
      if (w === 'arena' && ag.job === 'gladiator') return { act: 'fight', where: w };
      if (w === 'arena' && ag.job === 'venator') return { act: 'hunt', where: w };
      if (ag.job === 'musician') return { act: 'pipe', where: w };
      if (ag.showGoer) return { act: 'show', where: w };
      return null;
    }
    // the way to a spot, and on along it
    function begin(ag, L) {
      if (L.k === 'go' && L.pre) {
        // (a way already found: a drove's)
        L.pts = [[ag.x, ag.y, NaN, null], ...L.pre.map(p => [p[0], p[1], NaN, null])]; L.i = 0; L.d = 0;
        if (L.carry !== undefined) ag.carry = L.carry;
        ag.cl = null;
      } else if (L.k === 'go') {
        const sp = L.sp;
        let pts = route(ag.x, ag.y, ag.cl, sp);
        if (!pts) {
          // no way found: off out of sight a while, then there
          L.k = 'hide'; L.until = now + Math.min(300, Math.hypot(sp.x - ag.x, sp.y - ag.y) / ag.speed); L.then = sp;
          return;
        }
        if (Number.isFinite(sp.z)) pts[pts.length - 1][2] = sp.z;
        L.pts = pts; L.i = 0; L.d = 0;
        if (L.carry !== undefined) ag.carry = L.carry;
        ag.cl = null;
      } else if (L.k === 'climb') {
        L.pts = L.pts.map(p => [p[0], p[1], p[2]]); L.i = 0; L.d = 0;
      } else if (L.k === 'stay' && L.sp) place(ag, L.sp);
      else if (L.k === 'wall') {
        // up the stairs of a gate's tower and along the wall to the next and back
        const P = wallWalk.pts, n = P.length, pts = [];
        let i = L.from;
        const dir = ((L.to - L.from + n) % n) <= n / 2 ? 1 : -1;
        const cp = q => { const p = P[q].slice(); p.key = q; return p; };
        for (let k = 0; k < n && i !== L.to; k++, i = (i + dir + n) % n) pts.push(cp(i));
        pts.push(cp(L.to));
        // (there and back, each way on the right of the walk, so that two meeting pass)
        const right = list => list.map((p, q) => { const a = list[Math.max(0, q - 1)], b = list[Math.min(list.length - 1, q + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, o = 0.45; const r = [p[0] - (b[1] - a[1]) / l * o, p[1] + (b[0] - a[0]) / l * o, p[2]]; r.key = p.key; return r; });
        L.pts = right(pts).concat(right(pts.slice().reverse())); L.i = 0; L.d = 0; L.k = 'climb'; L.loop = L.until; L.torch = L.night;
        // (where the towers are along it, to stop at)
        L.stops = new Set(L.pts.map((p, q) => wallWalk.towerAt.has(p.key) ? q : -1).filter(q => q >= 0));
      }
    }
    function walkAlong(ag, L, dt, speed) {
      let rem = speed * dt;
      const P = L.pts;
      while (rem > 0 && L.i < P.length - 1) {
        const a = P[L.i], b = P[L.i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L.d + rem < len) { L.d += rem; rem = 0; }
        else { rem -= len - L.d; L.i++; L.d = 0; }
      }
      if (L.i >= P.length - 1) { const p = P[P.length - 1]; ag.x = p[0]; ag.y = p[1]; ag.z = Number.isFinite(p[2]) ? p[2] : groundZ(p[0], p[1]); return true; }
      const a = P[L.i], b = P[L.i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, f = L.d / len;
      ag.x = lerp(a[0], b[0], f); ag.y = lerp(a[1], b[1], f);
      ag.inCl = Number.isFinite(a[2]) && Number.isFinite(b[2]) ? a[3] || b[3] || null : null;
      // (stepped aside for someone, back onto the line little by little)
      if (L.off) {
        const o = L.off, k = Math.exp(-dt * 0.7);
        o[0] *= k; o[1] *= k;
        if (standable(ag, ag.x + o[0], ag.y + o[1])) { ag.x += o[0]; ag.y += o[1]; } else o[0] = o[1] = 0;
      }
      ag.z = Number.isFinite(a[2]) && Number.isFinite(b[2]) ? lerp(a[2], b[2], f) : Number.isFinite(a[2]) && len < 2.6 ? a[2] : Number.isFinite(b[2]) && len < 2.6 ? b[2] : groundZ(ag.x, ag.y);
      const want = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ag.a += clamp(turn(ag.a, want), -7 * dt, 7 * dt);
      return false;
    }
    const STRIDE = { lion: 1.6, bear: 1.2, elephant: 2.4, ostrich: 1.8, pig: 0.7, person: 1.4, rider: 2.2, sheep: 0.8, goat: 0.8, cow: 1.5, ox: 1.5, bull: 1.5, horse: 2, donkey: 1.2, dog: 1, cat: 0.7, hen: 0.25, cart: 3 };
    function update(ag, dt) {
      if (ag.follow) return;
      if (!ag.leg) {
        ag.leg = ag.legs.shift() || null;
        if (!ag.leg) {
          if (timeNow() > deadline) return;
          think(ag);
          ag.leg = ag.legs.shift() || null;
          if (!ag.leg) return;
        }
        begin(ag, ag.leg);
      }
      const L = ag.leg, night = clock.R > 12.4 || clock.R < -0.5;
      const stride = (STRIDE[ag.kind] || 1.4) * (ag.age === 'child' ? 0.75 : 1);
      switch (L.k) {
        case 'go': case 'climb': {
          ag.vis = true;
          // a sentry stopped at a tower, looking out over the country
          if (L.stops) {
            if (L.pause && now < L.pause) { ag.pose = 'stand'; ag.anim = 'watch'; ag.torch = !!L.torch; ag.a += clamp(turn(ag.a, Math.atan2(ag.y - town.town.y, ag.x - town.town.x)), -2 * dt, 2 * dt); break; }
            if (L.stops.has(L.i) && L.stopped !== L.i) { L.stopped = L.i; L.pause = now + range(20, 70); break; }
          }
          let pace = L.pace;
          if (L.drove && L.drove.route) {
            // behind the last of them, a few paces back, driving them on: he
            // waits, staff out, while they go out past him through the gate,
            // and when they stop; a little quicker when he has dropped back
            const H = L.drove, big = H.kind === 'cow' || H.kind === 'horse';
            H.sBack = H.route.cum[1] + (L.pts ? along(L.pts.slice(0, L.i + 1)).L + L.d : 0);
            const gap = lastS(H) - H.sBack, keep = big ? 3.5 : 2.5;
            if (gap < keep && lastS(H) < H.sIn + 0.5) {
              ag.pose = 'stand'; ag.anim = 'shoo';
              const [bx, by] = atS(H.route, Math.min(H.route.L, lastS(H) + 1));
              ag.a += clamp(turn(ag.a, Math.atan2(by - ag.y, bx - ag.x)), -3 * dt, 3 * dt);
              break;
            }
            if (gap > keep + 4) pace *= 1.5;
          }
          const swim = ag.kind === 'person' && L.k === 'go' && wet(ag.x, ag.y);
          const sp = L.k === 'climb' ? 0.6 : swim ? 0.55 : pace || ag.speed * (ag.slow || 1) * (ag.kind === 'person' ? 1 - 0.25 * clamp((ag.fatigue || 0) - 0.7, 0, 0.6) : 1);
          ag.pose = L.k === 'climb' ? 'walk' : (ag.speed > 2 ? 'run' : 'walk'); ag.anim = null; ag.seat = 0;
          ag.torch = (L.torch || (night && ag.torchy && !ag.cl)) && ag.kind === 'person';
          if (ag.torch && !ag.carry) ag.carry = 'torch';
          if (!ag.torch && ag.carry === 'torch') ag.carry = null;
          const done = walkAlong(ag, L, dt, sp);
          ag.ph += sp * dt / stride;
          // (in the water: swimming, not walking, the stroke slower)
          if (swim && wet(ag.x, ag.y)) { ag.pose = 'swim'; ag.torch = false; if (ag.carry === 'torch') ag.carry = null; ag.ph -= sp * dt / stride * 0.6; }
          if (done) {
            if (L.loop && now < L.loop) { L.i = 0; L.d = 0; break; }
            if (L.k === 'go') ag.cl = L.sp.cl || null;
            ag.inCl = null;
            if (ag.carry === 'torch' && !L.torch) ag.carry = null;
            ag.torch = !!L.torch && ag.torch;
            ag.leg = null;
          }
          break;
        }
        case 'trot': {
          const d = Math.hypot(L.x - ag.x, L.y - ag.y), v = L.speed * dt;
          ag.pose = L.pose || 'walk';
          if (d > v && !standable(ag, ag.x + (L.x - ag.x) / d * v, ag.y + (L.y - ag.y) / d * v)) { ag.leg = null; break; }
          if (d <= v) { ag.x = L.x; ag.y = L.y; ag.leg = null; }
          else { ag.x += (L.x - ag.x) / d * v; ag.y += (L.y - ag.y) / d * v; ag.a += clamp(turn(ag.a, Math.atan2(L.y - ag.y, L.x - ag.x)), -(L.flee ? 9 : 5) * dt, (L.flee ? 9 : 5) * dt); }
          if (L.until && now > L.until) ag.leg = null;
          ag.z = ag.cl ? floorAt(ag.cl, ag.x, ag.y) : NaN;
          if (!Number.isFinite(ag.z)) ag.z = groundZ(ag.x, ag.y);
          ag.ph += v / stride;
          break;
        }
        case 'chase': {
          // after someone, straight, as long as the way is open
          const m = L.who, d = Math.hypot(m.x - ag.x, m.y - ag.y), near = L.near || 1.6;
          if (!m.vis || m.cl) { ag.leg = null; break; }
          if (d > near + 0.6) {
            const v = Math.min(d - near, (L.speed || (d > 8 ? 3.5 : Math.max(1.2, m.speed * 1.1))) * dt), nx = ag.x + (m.x - ag.x) / d * v, ny = ag.y + (m.y - ag.y) / d * v;
            if (!standable(ag, nx, ny)) { ag.leg = null; break; }
            ag.x = nx; ag.y = ny; ag.ph += v / stride; ag.pose = d > 8 || L.speed > 2 ? 'run' : 'walk';
          } else ag.pose = 'stand';
          ag.a += clamp(turn(ag.a, Math.atan2(m.y - ag.y, m.x - ag.x)), -6 * dt, 6 * dt);
          ag.z = groundZ(ag.x, ag.y);
          if (now > L.until || (L.then && d <= near + 0.6)) { if (L.then) { L.then(); L.then = null; } ag.leg = null; }
          break;
        }
        case 'stay': {
          const sp = L.sp;
          ag.vis = true;
          if (sp) { ag.pose = sp.pose; ag.anim = sp.anim || null; ag.seat = sp.seat || 0; ag.stool = !!sp.stool; ag.mat = !!sp.mat; }
          else { ag.pose = L.pose || 'stand'; ag.anim = null; ag.stool = false; ag.mat = false; }
          if (L.tether) ag.pose = Math.sin(now / 37 + ag.id) > 0.3 ? 'graze' : 'stand';
          if (sp && sp.table && ag.meal) { const T = sp.table; if (T.laid < now) T.n = 0; T.laid = now + 2; T.n = Math.min(6, Math.max(T.n, 1) + (L.atTable ? 0 : 1)); L.atTable = true; }
          // a customer at the counter: up from the stool to serve
          if (L.atCounter && !L.counted) { L.atCounter.busy = (L.atCounter.busy || 0) + 1; L.counted = true; }
          if (L.counter) {
            if (L.counter.busy > 0) { ag.pose = 'stand'; ag.anim = 'sell'; ag.seat = 0; ag.stool = false; }
            L.counter.keeper = ag;
          }
          if (L.play && !L.joined) { L.play.P.kids.add(ag); L.joined = true; }
          // talking with someone, turned to them
          if (L.talk && now < L.talk.until) {
            ag.anim = 'talk';
            const w = L.talk.with;
            if (w && w.vis && Math.hypot(w.x - ag.x, w.y - ag.y) < 4) ag.a += clamp(turn(ag.a, Math.atan2(w.y - ag.y, w.x - ag.x)), -3 * dt, 3 * dt);
          }
          if (L.face && L.face.vis) ag.a += clamp(turn(ag.a, Math.atan2(L.face.y - ag.y, L.face.x - ag.x)), -3 * dt, 3 * dt);
          // at it: a hunter or a gladiator darting in at his beast and back
          // out of its reach; a beast mauling, lunging in at what it is on
          if ((L.hunt || L.maul) && L.face && L.face.vis && !warm) {
            const f = L.face, dx = f.x - ag.x, dy = f.y - ag.y, d = Math.hypot(dx, dy), reach = (sizeOf(f)[0] || 0.2) + (sizeOf(ag)[0] || 0.2);
            const want = L.maul ? reach + 0.2 + 0.35 * Math.sin(now * 3.1 + ag.id) : reach + 1.3 + 0.9 * Math.sin(now * 1.7 + ag.id);
            if (d > 0.01 && d < 12) {
              const step = clamp(d - want, -2 * dt, 3 * dt), nx = ag.x + dx / d * step, ny = ag.y + dy / d * step;
              if (standable(ag, nx, ny)) { ag.x = nx; ag.y = ny; ag.z = groundZ(nx, ny); ag.ph += Math.abs(step) / 1.4; }
            }
            // (the beast it is on set on in its turn)
            if (L.maul && f.exotic && !f.attacked && d < reach + 1.5 && chance(dt * 0.5)) { f.attacked = { by: ag, at: now }; f.legs.length = 0; f.leg = null; }
          }
          // nobody stands about long alone
          if (ag.kind === 'person' && sp && ag.pose === 'stand' && !ag.anim && !ag.group && !L.run && !L.play && !L.drift && !L.counter && !warm) {
            L.idle = (L.idle || 0) + dt;
            if (L.idle > (L.patience || (L.patience = range(25, 60)))) { L.idle = 0; L.patience = range(40, 90); if (restless(ag, L)) break; }
          }
          ag.torch = !!L.torch;
          if (!ag.torch && ag.carry === 'torch') ag.carry = null;
          ag.ph += dt * (ag.anim ? 0.9 : 0.25);
          if (L.drift) drift(ag, L.drift, dt);
          if (L.play) play(ag, L.play, dt);
          if (L.run) { const r = L.run; r.t = (r.t || 0) + dt * ag.speed * 1.6 / r.r; ag.x = r.x + Math.cos(r.t) * r.r; ag.y = r.y + Math.sin(r.t) * r.r; ag.a = r.t + Math.PI / 2; ag.pose = 'run'; ag.ph += dt * ag.speed * 1.6 / 2.2; }
          // round a mill, pushing its bar
          if (L.circle) { const r = L.circle; r.t += dt * 0.42 / r.r; ag.x = r.x + Math.cos(r.t) * r.r; ag.y = r.y + Math.sin(r.t) * r.r; ag.a = r.t + Math.PI / 2; ag.pose = 'walk'; ag.anim = 'push'; ag.ph += dt * 0.42 / 1.1; }
          if (L.duel) duelStep(ag, L, dt);
          // swimming lengths: along the lane, turning at the end
          if (L.lap) { const Q = L.lap; Q.s += dt * Q.v; const f = Q.s % 2, g = f < 1 ? f : 2 - f; ag.x = lerp(Q.A[0], Q.B[0], g); ag.y = lerp(Q.A[1], Q.B[1], g); ag.a = Math.atan2(Q.B[1] - Q.A[1], Q.B[0] - Q.A[0]) + (f < 1 ? 0 : Math.PI); ag.pose = 'swim'; ag.ph += dt * 0.8; }
          // wading about a warm pool, slowly
          if (L.wade) { const W = L.wade; W.t += dt * 0.08; const x = W.x + Math.cos(W.t) * W.r, y = W.y + Math.sin(W.t * 1.3) * W.r * 0.7; if (standable(ag, x, y) || ag.cl) { ag.x = x; ag.y = y; } ag.ph += dt * 0.3; }
          if (L.hunt) {
            ag.anim = 'fight'; if (ag.job === 'venator') ag.armed = 'spear';
            const f = L.face;
            if (f && f.exotic && !f.attacked && Math.hypot(f.x - ag.x, f.y - ag.y) < 3.5 && chance(dt * 0.25)) { f.attacked = { by: ag, at: now }; f.legs.length = 0; f.leg = null; }
          }
          // the flock come in to the gate; the flock all in at the new one
          if (L.gather && (gathered(L.gather) || now - L.gather.t0 > 180)) L.until = now;
          if (L.settle && L.settle.beasts.every(b => b.ds >= L.settle.sIn + 0.8)) L.until = Math.min(L.until, now + 3);
          // a barber at work while someone sits in his chair
          if (L.barber) { const ch = L.barber, c = ch.by; ag.anim = c && c.leg && c.leg.chairOf === ch && Math.hypot(c.x - ch.x, c.y - ch.y) < 0.6 ? 'shave' : null; if (ag.anim) ag.a += clamp(turn(ag.a, Math.atan2(ch.y - ag.y, ch.x - ag.x)), -3 * dt, 3 * dt); }
          // the crowd at the play or the games: applauding, up on its feet and cheering
          if (L.watch) { const A = cheers[L.watch]; ag.anim = A && now < A.until && (ag.id % 6) ? (L.watch === 'arena' ? 'cheer' : 'clap') : null; }
          if (now >= L.until) { if ((L.run || L.play || L.circle || L.duel || L.lap || L.wade) && sp) place(ag, sp); drop(ag); }
          break;
        }
        case 'drove': if (ag.kind === 'dog') dogStep(ag, dt); else droveStep(ag, dt); break;
        case 'hide':
          ag.vis = false; ag.torch = false;
          if (now >= L.until) { if (L.then) place(ag, L.then); ag.leg = null; }
          break;
        case 'call': L.fn(); ag.leg = null; break;
        default: ag.leg = null;
      }
    }
    // whether what one is about must give way: to sleep, or waking; to
    // hunger; to the show
    function urgent(ag) {
      const L = ag.leg;
      if (!L || ag.job === 'traveller' || ag.traveller || ag.ride || (L.k !== 'stay' && L.k !== 'hide')) return false;
      if (L.sleep) return woken(ag);
      if (L.food !== undefined || L.ease || L.drink || L.duel || (ag.herd && ag.herd.mode !== 'graze')) return false;
      if (L.watch) return ag.hunger > 1.15 || ag.fatigue > 1.15 || ag.nature > 1.15 || ag.thirst > 1.2;
      if (ag.nature > 1.0 && !L.rest) return true;
      if (ag.thirst > 1.0 && !L.rest && !L.drink) return true;
      const duty = ag.work && DUTY.has(ag.work.act);
      if (ag.fatigue > (duty ? Math.max(1.12, sleepAt(ag)) : sleepAt(ag)) + (L.rest ? 0.1 : 0)) return true;
      if (ag.hunger > (duty ? 1.0 : 0.9) && !L.rest) return true;
      const sh = showAct(ag);
      return !!sh && clock.R < SHOW[1] - 0.3 && !(ag.work && ag.work.act === sh.act && ag.work.where === sh.where);
    }
    function interrupt(ag) {
      const L = ag.leg;
      // (from the show's seats, down the steps first)
      if (L && L.watch) { L.until = now; return; }
      drop(ag); ag.legs.length = 0; leaveGroup(ag);
      if (ag.carry && ag.carry !== 'staff') ag.carry = null;
      ag.prop = null; ag.slow = 1;
      if (ag.seatQ && ag.seatQ.by === ag) ag.seatQ.by = null;
      ag.seatQ = null;
    }
    // work down a field's rows: along a row a step at a time, at its end over to the next and back
    function drift(ag, D, dt) {
      if (warm) return;
      D.u += D.dir * D.rate * dt;
      if (Math.abs(D.u) > D.hu) { D.u = Math.sign(D.u) * D.hu; D.dir = -D.dir; D.v += D.step * (D.v > 0 ? -1 : 1) * (Math.abs(D.v) + D.step > D.hv ? 1 : -1); D.v = clamp(D.v, -D.hv, D.hv); }
      const [x, y] = D.pt(D.u, D.v);
      ag.x = x; ag.y = y; ag.z = groundZ(x, y);
      const want = D.a + (D.dir < 0 ? Math.PI : 0);
      ag.a += clamp(turn(ag.a, want), -2 * dt, 2 * dt);
      if (ag.pose === 'walk') ag.ph += D.rate * dt / 1.2;
      if (ag.anim === 'plough' && ag.team) ag.team.forEach((o, k) => { o.ploughing = true; o.vis = true; o.x = x + Math.cos(ag.a) * 3.4 - Math.sin(ag.a) * (k ? 0.65 : -0.65); o.y = y + Math.sin(ag.a) * 3.4 + Math.cos(ag.a) * (k ? 0.65 : -0.65); o.z = groundZ(o.x, o.y); o.a = ag.a; o.pose = 'walk'; o.ph = ag.ph; o.leg = null; o.legs.length = 0; });
    }
    // children at play in the street before their door: running to a spot,
    // crouching there a while over their game, off again
    function play(ag, P, dt) {
      if (warm) return;
      if (P.to) {
        const d = Math.hypot(P.to[0] - ag.x, P.to[1] - ag.y), v = 2.6 * dt;
        if (!standable(ag, ag.x + (P.to[0] - ag.x) / (d || 1) * v, ag.y + (P.to[1] - ag.y) / (d || 1) * v)) { P.to = null; P.next = now + 2; return; }
        if (d <= v) { P.to = null; P.next = now + range(4, 30); ag.pose = 'squat'; }
        else { ag.x += (P.to[0] - ag.x) / d * v; ag.y += (P.to[1] - ag.y) / d * v; ag.a = Math.atan2(P.to[1] - ag.y, P.to[0] - ag.x); ag.pose = 'run'; ag.ph += v / 1.6; }
        ag.z = groundZ(ag.x, ag.y);
      } else {
        ag.pose = P.pose || 'squat';
        // (crouched, turned to whoever is crouched by)
        const mate = [...P.P.kids].find(k => k !== ag && k.vis && Math.hypot(k.x - ag.x, k.y - ag.y) < 2);
        if (mate) ag.a += clamp(turn(ag.a, Math.atan2(mate.y - ag.y, mate.x - ag.x)), -3 * dt, 3 * dt);
        if (now > P.next) {
          // off after another of them, or somewhere about
          const kids = [...P.P.kids].filter(k => k !== ag && k.vis);
          let x, y;
          if (kids.length && chance(0.45)) { const k = choice(kids); x = k.x + range(-0.6, 0.6); y = k.y + range(-0.6, 0.6); }
          else { x = P.x + range(-P.r, P.r); y = P.y + range(-P.r, P.r); }
          if (way.costAt(x, y) <= 1.35 && way.los([ag.x, ag.y], [x, y])) P.to = [x, y];
          else P.next = now + 1;
          P.pose = chance(0.5) ? 'squat' : 'stand';
        }
      }
    }
    // a follower: where its leader was, a little way back (a cart's oxen
    // before it, side by side, the cart behind; a donkey on its rope)
    function follow(ag) {
      const m = ag.follow, T = m.trail;
      ag.vis = m.vis;
      if (ag.ploughing) return;
      // (left standing while the cart is unloaded)
      if (m.parked) { ag.vis = true; ag.pose = 'stand'; return; }
      const back = ag.kind === 'cart' ? 4.6 : ag.yoke ? 1.2 : 1.8 + 1.7 * Math.max(0, (m.train || []).indexOf(ag));
      const lat = ag.yoke ? ag.yoke * 0.65 - 1.1 : ag.kind === 'cart' ? -1.1 : 0;
      // back along the leader's trail
      let px = m.x, py = m.y, d = 0, k = T ? T.length - 1 : -1, head = m.a;
      while (k >= 0) {
        const q = T[k], l = Math.hypot(px - q[0], py - q[1]);
        if (l > 0.01) head = Math.atan2(py - q[1], px - q[0]);
        if (d + l >= back) { const f = (back - d) / l; px = lerp(px, q[0], f); py = lerp(py, q[1], f); break; }
        d += l; px = q[0]; py = q[1]; k--;
      }
      if (k < 0) { px = m.x - Math.cos(m.a) * back; py = m.y - Math.sin(m.a) * back; head = m.a; }
      const nx = px - Math.sin(head) * lat, ny = py + Math.cos(head) * lat;
      const moved = Math.hypot(nx - ag.x, ny - ag.y);
      ag.x = nx; ag.y = ny; ag.z = groundZ(nx, ny);
      ag.a += turn(ag.a, head) * 0.3;
      ag.pose = moved > 0.002 ? 'walk' : 'stand';
      ag.ph += moved / (STRIDE[ag.kind] || 1.4);
    }
    // a boat down the river and up again, moored at the bank by night
    function boat(ag, dt) {
      const R = town.river, L = R.len, total = L[L.length - 1], night = clock.R > 11.8 || clock.R < -0.2;
      if (!night) { ag.s += ag.dir * ag.speed * dt; if (ag.s > total - 20 || ag.s < 20) { ag.dir = -ag.dir; ag.s = clamp(ag.s, 20, total - 20); } }
      let k = 0;
      while (k < L.length - 2 && L[k + 1] < ag.s) k++;
      const f = (ag.s - L[k]) / (L[k + 1] - L[k] || 1), a = R.points[k], b = R.points[k + 1];
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0]), off = night ? R.width / 2 - 1.4 : ag.lane;
      const side = ag.dir > 0 ? 1 : -1;
      ag.x = lerp(a[0], b[0], f) - Math.sin(dir) * off * side; ag.y = lerp(a[1], b[1], f) + Math.cos(dir) * off * side;
      ag.z = lerp(R.level[k], R.level[k + 1], f);
      ag.a = dir + (ag.dir < 0 ? Math.PI : 0); ag.pose = night ? 'moored' : 'row'; ag.ph += night ? dt * 0.1 : dt * 0.5;
      ag.vis = true;
    }

    // ================= together =================
    // who is where, 2.5 m a cell, each moment
    const HC = 2.5, hash = new Map();
    function reindex() {
      hash.clear();
      for (const ag of all) {
        if (!ag.vis || ag.kind === 'boat') continue;
        const k = Math.floor(ag.x / HC) * 8192 + Math.floor(ag.y / HC);
        let l = hash.get(k);
        if (!l) hash.set(k, l = []);
        l.push(ag);
      }
    }
    function around(x, y, r, fn) {
      for (let i = Math.floor((x - r) / HC); i <= Math.floor((x + r) / HC); i++)
        for (let j = Math.floor((y - r) / HC); j <= Math.floor((y + r) / HC); j++) for (const o of hash.get(i * 8192 + j) || []) fn(o);
    }
    const spaceOf = ag => ag.cl || ag.inCl || null;
    function personNear(ag, r, ok) {
      let best = null, bd = r;
      around(ag.x, ag.y, r, o => { if (o.kind !== 'person' || !o.vis || o === ag || !ok(o)) return; const d = Math.hypot(o.x - ag.x, o.y - ag.y); if (d < bd) { bd = d; best = o; } });
      return best;
    }
    let feeders = [];
    const feederNear = (ag, r) => { let best = null, bd = r; for (const f of feeders) { const d = Math.hypot(f.x - ag.x, f.y - ag.y); if (d < bd) { bd = d; best = f; } } return best; };
    const plays = [];
    // whether one can stand at a point: on open ground, or on the floor of the house one is in
    function standable(ag, x, y) {
      const C = ag.cl || ag.inCl;
      if (C) {
        if (!C.grid) gridOf(C);
        const G = C.grid, [fi, fj] = G.loc(x, y), i = Math.round(fi), j = Math.round(fj);
        return i >= 0 && j >= 0 && i < G.gx && j < G.gy && G.free[j * G.gx + i] === 1;
      }
      if (ag.herd && ag.kind !== 'person' && ag.herd.mode === 'graze') {
        const Hd = ag.herd, u = (x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, v = -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c;
        if (Math.abs(u) > Hd.hu + 0.8 || Math.abs(v) > Hd.hv + 0.8) return false;
      }
      return way.costAt(x, y) < Infinity;
    }
    // the end of what one was about (a customer gone from the counter, a child from the game)
    function drop(ag) {
      const L = ag.leg;
      if (L) {
        if (L.counted) { L.atCounter.busy--; L.counted = false; }
        if (L.counter && L.counter.keeper === ag) L.counter.keeper = null;
        if (L.joined) { const P = L.play.P; P.kids.delete(ag); if (!P.kids.size && plays.includes(P)) plays.splice(plays.indexOf(P), 1); L.joined = false; }
      }
      ag.leg = null;
    }

    // ---- standing about alone a while: over to someone to talk to; or to
    // a dog or a cat to make a fuss of; or, at home, a seat or a job;
    // or a few steps elsewhere ----
    function restless(ag, L) {
      const rem = L.until - now;
      // (somewhere one can get to from here: in a house, through its rooms)
      const reach = (x, y) => standable(ag, x, y) && (ag.cl ? !!inside(ag.cl, [ag.x, ag.y], [x, y]) : true);
      if (rem < 25) return false;
      const sp = L.sp, back = [{ k: 'go', sp }, { k: 'stay', sp, until: L.until }];
      const C = ag.cl;
      // someone free to talk: standing about, or sitting at nothing in particular
      const o = personNear(ag, 10, o => spaceOf(o) === C && Math.abs(o.z - ag.z) < 1 && o.leg && o.leg.k === 'stay' && o.leg.sp && !o.leg.counter && !o.leg.drift && !o.leg.run && !o.leg.play
        && (o.pose === 'stand' || o.pose === 'sit') && (!o.anim || o.anim === 'talk' || o.anim === 'craft') && (o.age === 'child') === (ag.age === 'child'));
      if (o) {
        const dur = Math.min(rem - 10, o.leg.until - now - 5, range(60, 300));
        if (dur > 20) {
          // beside them, facing them; or into their circle, if they are talking already
          const ch = o.chat && now < o.chat.until && o.chat.n < 5 ? o.chat : null;
          let x, y;
          if (ch) { const a = rng() * TAU; x = ch.x + Math.cos(a) * 0.8; y = ch.y + Math.sin(a) * 0.8; }
          else { const d = Math.hypot(ag.x - o.x, ag.y - o.y) || 1, r = o.pose === 'sit' ? 0.95 : 0.8; x = o.x + (ag.x - o.x) / d * r; y = o.y + (ag.y - o.y) / d * r; }
          if (reach(x, y) && meet(ag, o, dur, back)) return true;
        }
      }
      // a dog or a cat close by
      let pet = null, pd = 7;
      around(ag.x, ag.y, 7, b => { if ((b.kind === 'dog' || b.kind === 'cat') && b.vis && b.leg && b.leg.k === 'stay' && spaceOf(b) === C) { const d = Math.hypot(b.x - ag.x, b.y - ag.y); if (d < pd) { pd = d; pet = b; } } });
      if (pet && chance(0.6) && ag.age !== 'old') {
        const d = pd || 1, x = pet.x + (ag.x - pet.x) / d * 0.55, y = pet.y + (ag.y - pet.y) / d * 0.55, dur = Math.min(rem - 10, range(15, 45));
        if (dur > 8 && reach(x, y)) {
          const t = spot(x, y, C ? floorAt(C, x, y) : NaN, Math.atan2(pet.y - y, pet.x - x), 'squat', { anim: 'pet', cl: C });
          pet.leg.pose = 'sit'; pet.leg.face = ag; pet.leg.until = Math.max(pet.leg.until, now + dur + 8);
          drop(ag);
          ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until: now + dur }, ...back);
          return true;
        }
      }
      // at home: sit down, or find something to do
      if (C && ag.home && C === ag.home.C) {
        const s = homeSpot(ag, chance(0.5) ? 'seat' : 'bench') || homeSpot(ag, 'hearth');
        if (s) { drop(ag); ag.legs.unshift({ k: 'go', sp: s }, { k: 'stay', sp: s, until: L.until }); return true; }
      }
      // a few steps elsewhere, and a look about
      for (let k = 0; k < 6; k++) {
        const a = rng() * TAU, r = range(3, 10), x = ag.x + Math.cos(a) * r, y = ag.y + Math.sin(a) * r;
        if (!standable(ag, x, y) || (!C && !way.los([ag.x, ag.y], [x, y])) || !reach(x, y)) continue;
        const t = spot(x, y, C ? floorAt(C, x, y) : NaN, a + range(-1, 1), 'stand', { cl: C });
        drop(ag);
        ag.legs.unshift({ k: 'go', sp: t }, { k: 'stay', sp: t, until: L.until });
        return true;
      }
      return false;
    }

    // ---- bodies keep out of one another: each a capsule along its
    // heading; where two overlap they are pushed apart, the lighter more,
    // what is sitting, lying or yoked not at all; walkers meeting step
    // aside to the right; and the timid get out of the way ----
    const SIZE = { lion: [0.5, 0.3], bear: [0.45, 0.4], elephant: [1.2, 0.9], ostrich: [0.15, 0.3], pig: [0.3, 0.26], sheep: [0.28, 0.3], goat: [0.28, 0.24], cow: [0.62, 0.42], ox: [0.62, 0.42], bull: [0.66, 0.46], horse: [0.6, 0.36], donkey: [0.45, 0.28], dog: [0.2, 0.16], cat: [0.1, 0.1], hen: [0, 0.12], rider: [0.6, 0.4], cart: [1.3, 0.75] };
    const HEAVY = { person: 1, lion: 3, bear: 4, elephant: 30, ostrich: 1.5, pig: 1.2, sheep: 0.8, goat: 0.7, dog: 0.5, cat: 0.3, hen: 0.2, cow: 4, ox: 4, bull: 5, horse: 4, donkey: 2.5, rider: 5 };
    const SETTLED = new Set(['sit', 'lie', 'recline', 'kneel', 'squat', 'swim']);
    const sizeOf = ag => ag.kind === 'person' ? (ag.pose === 'lie' || ag.pose === 'recline' ? [0.55, 0.25] : [0, ag.age === 'child' ? 0.17 : ag.pose === 'sit' ? 0.3 : 0.23]) : SIZE[ag.kind] || [0, 0.3];
    function weight(ag) {
      const L = ag.leg;
      if (ag.follow || ag.ploughing || ag.kind === 'cart' || ag.kind === 'boat') return Infinity;
      if (L && (L.k === 'climb' || L.drift || L.run || L.k === 'hide')) return Infinity;
      if (ag.kind === 'person' && L && L.k === 'stay' && SETTLED.has(ag.pose)) return Infinity;
      return (HEAVY[ag.kind] || 1) * (ag.pose === 'lie' ? 3 : 1);
    }
    function nudge(ag, dx, dy) {
      const x = ag.x + dx, y = ag.y + dy;
      if (!standable(ag, x, y)) return;
      ag.x = x; ag.y = y;
      const L = ag.leg;
      if (L && L.k === 'go' && L.pts) {
        const o = L.off || (L.off = [0, 0]);
        o[0] += dx; o[1] += dy;
        const m = Math.hypot(o[0], o[1]);
        if (m > 1.3) { o[0] *= 1.3 / m; o[1] *= 1.3 / m; }
      }
    }
    // pushed by a body met: one walking is never pushed back, only aside,
    // and held up long enough squeezes past
    function shove(ag, nx, ny, m, dt) {
      const L = ag.leg;
      if (L && L.k === 'go' && L.pts) {
        const ca = Math.cos(ag.a), sa = Math.sin(ag.a), back = nx * ca + ny * sa;
        if (back < 0) {
          const side = -nx * sa + ny * ca, sg = Math.abs(side) < 0.1 ? 1 : Math.sign(side);
          nx = -sa * sg; ny = ca * sg;
          ag.blockT = (ag.blockT || 0) + dt;
          if (ag.blockT > 1.8) { ag.ghost = now + 3; ag.blockT = 0; }
        }
      }
      nudge(ag, nx * m, ny * m);
    }
    // looking ahead as one walks: whatever is in the way, a step aside from it
    // in good time (meeting someone head on, each to the right)
    function steer(dt) {
      for (const ag of all) {
        const L = ag.leg;
        if (!ag.vis || !L || L.k !== 'go' || !L.pts || now < (ag.ghost || 0)) continue;
        const ca = Math.cos(ag.a), sa = Math.sin(ag.a), [, ra] = sizeOf(ag), sp = spaceOf(ag);
        let sx = 0, sy = 0;
        around(ag.x, ag.y, 2.8, o => {
          if (o === ag || !o.vis || o.kind === 'boat' || spaceOf(o) !== sp || Math.abs(o.z - ag.z) > 1.2 || together(ag, o)) return;
          const dx = o.x - ag.x, dy = o.y - ag.y, ahead = dx * ca + dy * sa, side = -dx * sa + dy * ca, [hb, rb] = sizeOf(o), r = ra + rb + hb * 0.5 + 0.15;
          if (ahead <= 0 || ahead > 2.6 || Math.abs(side) > r) return;
          const oncoming = o.leg && o.leg.k === 'go' && Math.cos(o.a) * ca + Math.sin(o.a) * sa < -0.3;
          const sg = oncoming || Math.abs(side) < 0.08 ? 1 : -Math.sign(side), k = (1 - ahead / 2.6) * (r - Math.abs(side) * (oncoming ? 0 : 1)) / r;
          sx += -sa * sg * k; sy += ca * sg * k;
        });
        if (sx || sy) { const m = Math.hypot(sx, sy), v = Math.min(1, m) * 0.9 * dt; nudge(ag, sx / m * v, sy / m * v); }
        else if (ag.blockT) ag.blockT = Math.max(0, ag.blockT - dt);
      }
    }
    // the nearest points of two segments
    function closest(ax, ay, bx, by, cx, cy, dx, dy) {
      const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy, rx = ax - cx, ry = ay - cy;
      const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
      let s = 0, t = 0;
      if (a < 1e-9 && e < 1e-9) { s = t = 0; }
      else if (a < 1e-9) t = clamp(f / e, 0, 1);
      else {
        const c = d1x * rx + d1y * ry;
        if (e < 1e-9) s = clamp(-c / a, 0, 1);
        else {
          const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
          s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
      }
      return [ax + d1x * s, ay + d1y * s, cx + d2x * t, cy + d2y * t];
    }
    const together = (a, b) => a.follow === b || b.follow === a || (a.follow && a.follow === b.follow) || (a.team && a.team.includes(b)) || (b.team && b.team.includes(a));
    function apart(dt) {
      // (only about what has moved: what stands still has been kept apart already)
      for (const ag of all) {
        if (!ag.vis || !ag.mv || ag.kind === 'boat') continue;
        const [ha, ra] = sizeOf(ag), wa = weight(ag), ca = Math.cos(ag.a), sa = Math.sin(ag.a), sp = spaceOf(ag);
        const walking = ag.leg && ag.leg.k === 'go' && ag.pose !== 'stand';
        around(ag.x, ag.y, walking ? 3.5 : 2.2, o => {
          if (o === ag || (o.mv && o.id < ag.id) || o.kind === 'boat' || Math.abs(o.z - ag.z) > 1.2 || spaceOf(o) !== sp || together(ag, o) || now < (o.ghost || 0) || now < (ag.ghost || 0)) return;
          const [hb, rb] = sizeOf(o), wb = weight(o);
          if (wa === Infinity && wb === Infinity) return;
          const cb = Math.cos(o.a), sb = Math.sin(o.a);
          const [px, py, qx, qy] = closest(ag.x - ca * ha, ag.y - sa * ha, ag.x + ca * ha, ag.y + sa * ha, o.x - cb * hb, o.y - sb * hb, o.x + cb * hb, o.y + sb * hb);
          let nx = px - qx, ny = py - qy, d = Math.hypot(nx, ny);
          const over = ra + rb - d;
          if (over <= 0) return;
          if (d < 1e-4) { const t = rng() * TAU; nx = Math.cos(t); ny = Math.sin(t); d = 1; }
          nx /= d; ny /= d;
          const fa = wa === Infinity ? 0 : wb === Infinity ? 1 : wb / (wa + wb), push = Math.min(over, 0.5) * 0.7;
          if (fa > 0) shove(ag, nx, ny, push * fa, dt);
          if (fa < 1) shove(o, -nx, -ny, push * (1 - fa), dt);
        });
      }
    }
    // the timid out of the way: sheep and goats of people on their feet and
    // of dogs, hens of everyone but whoever feeds them, cats of dogs; the
    // big beasts only of what comes right up to them
    const FLEE = { pig: [1.5, 4, 1.8], sheep: [2.6, 6, 2.4], goat: [2.2, 5, 2.8], hen: [1.6, 3.5, 1.8], cat: [1.8, 5, 3.4], cow: [1.2, 3, 1.4], ox: [1, 2.5, 1.2], horse: [1.3, 3, 2.6], donkey: [1.2, 3, 1.6] };
    function shy() {
      // what frightens, gathered from its side (a dog, someone on foot, a rider, a cart)
      const fear = new Map();
      for (const o of all) {
        if (!o.vis) continue;
        const k = o.kind, foot = k === 'person' && !SETTLED.has(o.pose) && o.anim !== 'scatter' && o.anim !== 'pet';
        if (!(k === 'dog' || k === 'cat' || k === 'rider' || k === 'cart' || foot)) continue;
        around(o.x, o.y, k === 'dog' ? 6 : k === 'cat' ? 3.5 : 4, ag => {
          const F = FLEE[ag.kind];
          if (!F || ag === o || !ag.vis || ag.follow || ag.ploughing || ag.tied || ag.drove || now < (ag.fleeT || 0) || spaceOf(o) !== spaceOf(ag)) return;
          const L = ag.leg;
          if (L && (L.flee || L.k === 'go' || L.k === 'hide')) return;
          let r = 0;
          if (k === 'dog') r = ag.kind === 'dog' ? 0 : F[1];
          else if (k === 'cat') r = ag.kind === 'hen' ? F[1] : 0;
          else if (k === 'person') r = ag.kind === 'cat' ? (o.pose === 'walk' || o.pose === 'run' ? F[0] : 0) : F[0];
          else r = F[0] * 1.5;
          const dx = ag.x - o.x, dy = ag.y - o.y, d = Math.hypot(dx, dy);
          if (!r || d > r || d < 1e-3) return;
          const f = fear.get(ag) || [0, 0];
          f[0] += dx / d * (r - d) / r; f[1] += dy / d * (r - d) / r;
          fear.set(ag, f);
        });
      }
      for (const [ag, [fx, fy]] of fear) {
        let ax = fx, ay = fy;
        // (a flock away to its middle as much as from what came)
        const Hd = ag.herd;
        if (Hd) { const [cx, cy] = Hd.pt(Hd.mx, Hd.my), d = Math.hypot(cx - ag.x, cy - ag.y) || 1; ax += (cx - ag.x) / d * 0.5; ay += (cy - ag.y) / d * 0.5; }
        const m = Math.hypot(ax, ay) || 1, dist = range(2, 4.5);
        let x = ag.x + ax / m * dist, y = ag.y + ay / m * dist;
        if (Hd) [x, y] = Hd.pt(...Hd.clampU((x - Hd.cx) * Hd.c + (y - Hd.cy) * Hd.s, -(x - Hd.cx) * Hd.s + (y - Hd.cy) * Hd.c));
        if (!standable(ag, x, y) || (!ag.cl && !Hd && !way.los([ag.x, ag.y], [x, y]))) { ag.fleeT = now + 1; continue; }
        ag.legs.length = 0;
        ag.leg = { k: 'trot', x, y, speed: FLEE[ag.kind][2], pose: 'run', flee: true, until: now + 4 };
        ag.fleeT = now + 1.5;
      }
    }

    // ================= on =================
    const figures = [], lights = [];
    let sunT = -1, clockT = -Infinity, tick = 0, acc = 0;
    function step(dt, d) {
      dt = Math.min(dt, maxDt);
      now += dt;
      // (the hour afresh every two seconds or so)
      if (Math.abs(d.getTime() - clockT) > 2000) { clock = hour(d); clockT = d.getTime(); }
      if (Math.abs(d.getTime() - sunT) > 60e3) { sunT = d.getTime(); sunAz = RomanTownSky.local(d).sun.az; }
      deadline = timeNow() + 8;
      if (!hash.size) reindex();
      // (the grass grazed and growing, every couple of seconds)
      grassT += dt;
      if (grassT > 2) { grow(grassT); grassT = 0; }
      // (the crowd at a show breaking into applause now and then)
      const sw = showOf(clock.day);
      if (sw && clock.R > SHOW[0] && clock.R < SHOW[1]) { const A = cheers[sw]; if (now > A.next) { A.until = Math.max(A.until, now + range(4, 10)); A.next = now + range(40, 150); } }
      for (const ag of all) {
        if (ag.kind === 'boat') { boat(ag, dt); continue; }
        // hungrier and wearier, or eating, or asleep; and now and then a look
        // whether one's body or the show calls one from what one is about
        if (ag.kind === 'person' && ag.hunger !== undefined) {
          // (each a frame in four)
          ag.ndt = (ag.ndt || 0) + dt;
          if ((tick + ag.id) % 4 === 0) { needs(ag, ag.ndt); ag.ndt = 0; }
          if (now >= (ag.check || 0)) {
            ag.check = now + 5 + (ag.id % 9);
            if (ag.follow) { const M = ag.follow; if (!M.vis || M.asleep || M.cl === M.home.C || !ESCORTED.has(M.doing) || ag.hunger > 0.9 || ag.fatigue > sleepAt(ag)) detach(ag); }
            else if (urgent(ag)) interrupt(ag);
          }
        }
        // (nothing to do for one out of sight, or a beast standing, grazing or lying a while, till it is over)
        const Lq = ag.leg;
        if (Lq && now < Lq.until && (Lq.k === 'hide' || (Lq.k === 'stay' && ag.kind !== 'person' && !Lq.face && !Lq.tether && Lq.seen))) { ag.mv = false; continue; }
        if (Lq && Lq.k === 'stay') Lq.seen = true;
        const x0 = ag.x, y0 = ag.y, p0 = ag.pose;
        update(ag, dt);
        ag.mv = ag.x !== x0 || ag.y !== y0 || ag.pose !== p0;
        // the leaders' trails, for their followers
        if ((ag.train || ag.cart) && !ag.parked) {
          const T = ag.trail || (ag.trail = []), last = T[T.length - 1];
          if (!last || Math.hypot(ag.x - last[0], ag.y - last[1]) > 0.3) { T.push([ag.x, ag.y]); if (T.length > 60) T.shift(); }
        }
      }
      for (const ag of all) if (ag.follow) { follow(ag); ag.mv = true; }
      reindex();
      feeders = all.filter(a => a.vis && a.anim === 'scatter');
      // (the frightened and the kept apart every other moment)
      if (dt > 0) { acc += dt; if (++tick % 2 === 0) { shy(); steer(acc); apart(acc); acc = 0; } }
      figures.length = 0; lights.length = 0;
      for (const T of tables.values()) if (T.laid > now) figures.push(T);
      for (const Hd of herds) if (Hd.trough) figures.push(Hd.trough);
      for (const c of cages) figures.push(c);
      for (const w of all) if (w.job === 'woodcutter' && w.pile && w.treeDay === clock.day && !figures.includes(w.pile)) figures.push(w.pile);
      for (const ag of all) {
        if (!ag.vis) continue;
        figures.push(ag);
        if (ag.prop) figures.push(ag.prop);
        if (ag.torch) {
          const c = Math.cos(ag.a), s = Math.sin(ag.a);
          lights.push({ x: ag.x + c * 0.3 - s * 0.32, y: ag.y + s * 0.3 + c * 0.32, z: ag.z + 2.1, power: 0.75 });
        }
      }
    }
    // ---- someone, as one would say who they are and what they are about ----
    const SHOPNAME = { caupona: 'a tavern', bakery: 'a bakery', smithy: 'a smithy', fullery: 'a fullery', pottery: 'a pottery', butcher: 'a butcher’s', grocer: 'a greengrocer’s', wine: 'a wine-shop', weaver: 'a weaver’s', cobbler: 'a cobbler’s', carpenter: 'a carpenter’s', barber: 'a barber’s' };
    function describe(f) {
      const p = f && f.kind === 'rider' ? f.man : f;
      if (!p) return null;
      if (p.kind !== 'person') {
        // a beast: whose, and what it is about
        const H = p.herd, M = p.master || (H && H.shepherd) || (p.farm && p.farm.master);
        const what = p.exotic ? ({ lion: p.male ? 'a lion, from Africa' : 'a lioness, from Africa', bear: 'a bear, from the mountains', elephant: 'an elephant, from Africa', ostrich: 'an ostrich, from Africa', bull: 'a bull, for the games' })[p.kind] : p.kind === 'dog' && p.stray ? 'a stray dog' : p.kind === 'cat' ? 'a cat' : `a ${p.kind}`;
        const whose = M ? `${M.name}’s` : '';
        const foe = p.exotic && p.leg && (p.leg.maul || (p.leg.k === 'chase' && p.leg.who)), foeName = foe && (foe.job === 'gladiator' ? 'a gladiator' : foe.job === 'venator' ? 'a hunter' : foe.kind === 'person' ? 'a man' : `the ${foe.kind}`);
        const doing = p.exotic ? (onSand(p) ? (foe ? (p.leg.maul ? `at grips with ${foeName}` : `rushing at ${foeName}`) : p.kind === 'ostrich' && p.pose === 'run' ? 'running for its life' : 'in the arena, for the hunt') : p.pose === 'walk' ? 'pacing its cage' : p.pose === 'lie' ? 'lying in its cage' : 'in its cage by the amphitheatre') : p.drove || (H && H.mode !== 'graze') ? 'being moved to fresh grass' : p.pose === 'lie' ? 'lying down' : p.pose === 'graze' ? (H && p.leg && p.leg.drinking ? 'drinking at the trough' : H && grass[H.f.idx] < 0.25 ? 'nosing for the last of the grass' : 'grazing') : p.pose === 'walk' || p.pose === 'run' ? 'on the move' : '';
        return { name: whose ? `${whose} ${p.kind}${H ? ', of the ' + (H.kind === 'sheep' || H.kind === 'goat' ? 'flock' : 'herd') : ''}` : what, title: '', doing, needs: '' };
      }
      const his = p.sex === 'f' ? 'her' : 'his';
      let title = p.title || TITLE[p.job] || '';
      if (p.job === 'slave') title = { doorkeeper: 'a slave, keeps the door', cook: 'a slave, the cook', escort: 'a slave, attends his master', maid: 'a slave, a maid' }[p.role] || 'a slave';
      else if (p.job === 'farmer' && p.bond) title = 'a slave on the farm';
      else if (p.job === 'patron' && p.magistrate) title = 'a magistrate of the town';
      else if (p.job === 'child') title = p.pupil ? 'a schoolboy' : p.helps ? `${p.sex === 'm' ? 'a boy' : 'a girl'}, learning ${his} father’s trade` : p.sex === 'm' ? 'a boy' : 'a girl';
      else if (p.job === 'hand' && p.shop) title = `works in ${SHOPNAME[p.shop.trade] || 'a shop'}`;
      else if (p.job === 'wife' && p.shopwife) title = `keeps the house, and ${SHOPNAME[p.shopwife.trade] || 'the shop'}`;
      else if (p.job === 'sentry' || p.job === 'lookout') title += p.night ? ', by night' : ', by day';
      else if (p.job === 'gladiator') title = p.armed === 'net' ? 'a gladiator, with net and trident' : 'a gladiator, with sword and shield';
      const L = p.leg, act = p.doing || (p.work && p.work.act) || 'home', words = ABOUT[act] || ['', ''];
      let doing;
      if (L && L.sleep && (L.k === 'hide' || p.pose === 'lie' || !p.vis)) doing = p.mat && p.vis ? 'asleep on a straw pallet' : 'asleep';
      else if (p.follow) doing = `walking behind ${his} master`;
      else if (L && (L.k === 'go' || L.k === 'climb' || L.k === 'lead') && p.vis && p.pose !== 'stand') doing = act === 'show' && L.k === 'climb' ? 'climbing to a seat' : `on ${his} way ${words[1]}`;
      else if (L && L.k === 'hide') doing = act === 'inn' ? 'asleep upstairs at an inn' : act === 'travel' ? 'away on the road' : 'indoors';
      else if (L && L.watch) doing = p.anim === 'clap' ? 'applauding' : p.anim === 'cheer' ? 'on his feet, cheering' : L.watch === 'arena' ? 'watching the games' : 'watching the play';
      else if (L && L.food !== undefined) doing = act === 'cena' || p.pose === 'recline' ? 'at dinner' : 'eating';
      else if (L && L.hunt) doing = `facing ${({ lion: 'a lion', bear: 'the bear', elephant: 'the elephant', ostrich: 'an ostrich', bull: 'a bull' })[L.face && L.face.kind] || 'a beast'}, ${p.job === 'gladiator' ? (p.armed === 'net' ? 'net and trident ready' : 'sword drawn') : 'spear levelled'}`;
      else if (L && L.k === 'chase' && (p.job === 'venator' || p.job === 'gladiator')) doing = 'closing in on a beast';
      else if (p.job === 'woodcutter' && (p.carry === 'wood' || p.carry === 'timber') && L && L.k === 'go') doing = p.carry === 'timber' ? 'carrying a timber to a carpenter' : 'carrying in a load of firewood';
      else if (L && L.lap) doing = 'swimming lengths in the open pool';
      else if (L && L.wade) doing = 'in the warm pool';
      else if (L && L.drink) doing = p.pose === 'kneel' ? 'drinking from the river' : p.pose === 'bend' ? 'drinking at the fountain' : L.atCounter ? 'a cup of wine at a tavern' : p.cl ? 'a drink of water' : `a drink from ${his} flask`;
      else if (L && L.ease) doing = p.pose === 'squat' ? 'answering a call of nature behind a bush' : !p.vis ? 'indoors' : L.sp && L.sp.cl && L.sp.cl.bs.some(b => b.trade === 'forica') ? (p.anim === 'talk' ? 'at the public latrine, chatting with a neighbour' : 'at the public latrine') : 'at the latrine';
      else if (L && L.rest) doing = p.pose === 'lie' ? 'having a nap' : 'resting';
      else if (p.anim && DOING[p.anim] && p.anim !== 'talk') doing = DOING[p.anim];
      else doing = words[0] || (p.anim === 'talk' ? 'talking' : '');
      if (act === 'drove' && L && L.k === 'go') doing = 'driving the flock to fresh grass';
      const needs = [];
      if (p.hunger !== undefined && !doing.startsWith('asleep')) {
        if (p.hunger > 0.85) needs.push('very hungry'); else if (p.hunger > 0.6) needs.push('hungry');
        if (p.fatigue > sleepAt(p)) needs.push('sleepy'); else if (p.fatigue > 0.7) needs.push('tired');
        if (p.thirst > 0.7 && !(L && L.drink)) needs.push(p.thirst > 0.95 ? 'parched' : 'thirsty');
        if (p.nature > 0.8 && !(L && L.ease)) needs.push('needs the latrine');
      }
      return { name: p.name, title, doing, needs: needs.join(', ') };
    }

    // a warm start: everyone already about what they are about at this hour
    warm = true;
    // (a traveller on the road keeps his own hours, eating and sleeping at inns we do not see)
    for (const ag of all) if (ag.kind === 'person' && ag.wakeR !== undefined && ag.job !== 'traveller' && ag.job !== 'rider') presume(ag);
    for (const ag of all) {
      if (ag.kind === 'boat') continue;
      if (ag.follow) continue;
      think(ag);
      if (!ag.placed && ag.legs.length) {
        // (if nothing put it anywhere, at the first spot it is going to)
        const L = ag.legs.find(l => l.sp);
        if (L) place(ag, L.sp);
      }
      ag.placed = true;
      // part way through what it is doing
      if (ag.traveller) continue;
      const L = ag.legs.find(l => l.k === 'stay' || l.k === 'hide');
      if (L) { const i = ag.legs.indexOf(L); ag.legs.splice(0, i); L.until = now + (L.until - now) * rng(); }
    }
    warm = false;
    // (the beasts of a herd settled where they were put, none on top of another)
    for (const Hd of herds) for (let it = 0; it < 12; it++) {
      let moved = false;
      for (const a of Hd.beasts) for (const b of Hd.beasts) {
        if (a.id >= b.id) continue;
        const [ha, ra] = sizeOf(a), [hb, rb] = sizeOf(b), want = ra + rb + (ha + hb) * 0.6, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= want) continue;
        const ux = d > 1e-3 ? dx / d : Math.cos(a.id), uy = d > 1e-3 ? dy / d : Math.sin(a.id), m = (want - d) / 2 + 0.02;
        for (const [o, sg] of [[a, -1], [b, 1]]) { const x = o.x + ux * m * sg, y = o.y + uy * m * sg; if (standable(o, x, y)) { o.x = x; o.y = y; o.z = groundZ(x, y); o.dest = [x, y]; if (o.leg && o.leg.sp) o.leg.sp = { ...o.leg.sp, x, y }; } }
        moved = true;
      }
      if (!moved) break;
    }
    for (const ag of all) if (ag.kind === 'boat') boat(ag, 0);
    step(0, date);
    return { step, figures, lights, people: all, describe, herds, grass, get grassV() { return grassV; } };
  }

  return { create, hour };
})();
