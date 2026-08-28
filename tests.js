'use strict';

/*
 * Drunk Football — validation suite.
 *
 * Open tests.html. Every check runs against the real game booted on the same page, because
 * the things worth testing here are things a headless run cannot see: laid-out text, baked
 * textures, camera framing, a loaded font.
 *
 * The suite leans deliberately towards the failures this project has actually had, which
 * were almost never logic errors:
 *
 *   - two pieces of text quietly sitting on top of each other
 *   - a list that grew past the keys bound to it
 *   - a colour that stopped being derived and drifted
 *
 * so those get checked exhaustively rather than by eye.
 *
 * DrunkTests.stage(name) is the other half: it sets a scene up, triggers an effect and
 * pauses, so a transient thing like a faceplant or a ball trail sits still long enough to
 * be looked at and photographed.
 */
const DrunkTests = (() => {
  const results = [];
  let currentGroup = 'general';

  function group(name) { currentGroup = name; }

  function check(name, fn) {
    let passed = false;
    let detail = '';
    try {
      const outcome = fn();
      if (outcome === true || outcome === undefined) {
        passed = true;
      } else if (outcome && typeof outcome === 'object') {
        passed = !!outcome.pass;
        detail = outcome.detail || '';
      } else {
        detail = 'returned ' + JSON.stringify(outcome);
      }
    } catch (err) {
      detail = err && err.message ? err.message : String(err);
    }
    results.push({ group: currentGroup, name, passed, detail });
    return passed;
  }

  /* ------------------------------------------------------------------ helpers */

  const scenes = () => window.game.scene.scenes;
  const sceneByKey = (key) => window.game.scene.getScene(key);

  function textsOf(scene) {
    return scene.children.list.filter((o) => o.text !== undefined && o.text !== ''
      && o.visible && o.alpha > 0);
  }

  /*
   * Where the object actually inks, which is not the same as how big it is. Display text
   * carries transparent padding so its drop shadow and the lean on the last glyph are not
   * sliced off, and counting that padding as occupied space would report collisions
   * between things with a comfortable gap between them.
   */
  function boundsOf(obj) {
    const w = obj.displayWidth !== undefined ? obj.displayWidth : obj.width;
    const h = obj.displayHeight !== undefined ? obj.displayHeight : obj.height;
    const originX = obj.originX !== undefined ? obj.originX : 0;
    const originY = obj.originY !== undefined ? obj.originY : 0;
    const pad = (obj.inkPad || 0) * (obj.scaleX !== undefined ? obj.scaleX : 1);

    return {
      left: obj.x - w * originX + pad,
      top: obj.y - h * originY + pad,
      right: obj.x + w * (1 - originX) - pad,
      bottom: obj.y + h * (1 - originY) - pad,
    };
  }

  function overlaps(a, b, tolerance) {
    const t = tolerance || 0;
    return a.left < b.right - t && b.left < a.right - t
      && a.top < b.bottom - t && b.top < a.bottom - t;
  }

  /*
   * The game only ever has one scene live: every scene.start stops the one before it. The
   * suite hops between scenes far more freely than a player can, so without this it leaves
   * old ones running, and a skin change that retires a texture then kills a sprite in a
   * scene nobody remembered was still there. Restoring the game's own invariant.
   */
  function onlyScene(key) {
    scenes().forEach((s) => {
      if (s.scene.key !== key && (s.sys.isActive() || s.sys.isPaused() || s.sys.isSleeping())) {
        window.game.scene.stop(s.scene.key);
      }
    });
  }

  /* Rebuilds a menu scene from scratch and hands it over once its create() has run. */
  function withScene(key, fn) {
    onlyScene(key);
    const scene = sceneByKey(key);
    scene.scene.start(key);
    step(6);
    return fn(sceneByKey(key));
  }

  let virtualNow = 0;
  function step(frames) {
    if (!virtualNow) virtualNow = window.performance.now();
    for (let i = 0; i < frames; i++) {
      virtualNow += 1000 / 60;
      window.game.loop.step(virtualNow);
    }
  }

  /* --------------------------------------------------------------------- sound */

  /*
   * Sound is rendered rather than played. An offline context runs exactly the graph the
   * game would and hands back the samples, but it only ever hands them back later, and
   * every check in here is synchronous. So the rendering happens once before the checks
   * start and the checks read the numbers off these.
   */
  const heard = {};

  function renderSound(name, seconds, step, make) {
    const rate = 44100;
    const ctx = new window.OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
    const wasStep = Sound.step;
    Sound.step = step;
    Sound.attach(ctx);
    make();
    Sound.step = wasStep;
    return ctx.startRendering().then((buffer) => { heard[name] = buffer.getChannelData(0); });
  }

  /* Called by the page before run(), because a promise cannot be waited for inside one. */
  function listen() {
    if (!window.OfflineAudioContext) return Promise.resolve();
    const loud = Sound.STEPS;
    return Promise.all([
      renderSound('whistle', 0.7, loud, () => Sound.whistle()),
      renderSound('groan', 1.3, loud, () => Sound.groan(1)),
      renderSound('cheer', 2.3, loud, () => Sound.cheer(1)),
      renderSound('smallCheer', 2.3, loud, () => Sound.cheer(0.02)),
      renderSound('halfGroan', 1.3, Math.round(Sound.STEPS / 2), () => Sound.groan(1)),
      renderSound('muted', 0.7, 0, () => {
        Sound.whistle();
        Sound.groan(1);
        Sound.cheer(1);
      }),
    ]).then(() => {
      // Put the game back on nothing, so the first real sound builds a real context.
      Sound.ctx = null;
      Sound.master = null;
      Sound.live = false;
    });
  }

  const slice = (pcm, from, to) => pcm.subarray(
    Math.floor(pcm.length * from), Math.floor(pcm.length * to));

  function peak(pcm) {
    let most = 0;
    for (let i = 0; i < pcm.length; i += 1) most = Math.max(most, Math.abs(pcm[i]));
    return most;
  }

  /*
   * How much sound there is, rather than how loud the loudest sample happened to be. Most
   * of what this game plays is noise, and the peak of a stretch of noise is luck: two
   * renderings of the same groan can differ by a third at the peak and by a per cent or
   * two across the whole of it.
   */
  function rms(pcm) {
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 1) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / pcm.length);
  }

  /*
   * How often the waveform crosses zero, which is a poor man's pitch: no maths beyond
   * counting sign changes, and enough to tell a band of noise sliding down from one
   * sliding up, which is the whole difference between a groan and a cheer.
   */
  function crossings(pcm) {
    let n = 0;
    for (let i = 1; i < pcm.length; i += 1) {
      if ((pcm[i] < 0) !== (pcm[i - 1] < 0)) n += 1;
    }
    return n / pcm.length;
  }

  /*
   * The quietest reading in a stretch, rather than the average one. A cheer has applause
   * scattered through it at random, every clap is bright, and a clap landing in the window
   * being measured only ever pushes the count up. Taking the lowest of several windows
   * measures the crowd underneath the applause instead of whichever burst happened to land.
   */
  function floorCrossings(pcm, from, to, parts) {
    let least = Infinity;
    const span = (to - from) / parts;
    for (let i = 0; i < parts; i += 1) {
      least = Math.min(least, crossings(slice(pcm, from + i * span, from + (i + 1) * span)));
    }
    return least;
  }

  /*
   * How much the loudness moves from one moment to the next, measured against how loud it
   * is: a tone held flat barely moves, two tones close enough to beat against each other
   * move a great deal. The difference between a whistle and an alarm.
   */
  function ripple(pcm, from, to, windows) {
    const region = slice(pcm, from, to);
    const win = Math.max(1, Math.floor(region.length / windows));
    const level = [];
    for (let i = 0; i + win <= region.length; i += win) {
      level.push(rms(region.subarray(i, i + win)));
    }
    let moved = 0;
    let mean = 0;
    for (let i = 1; i < level.length; i += 1) moved += Math.abs(level[i] - level[i - 1]);
    level.forEach((v) => { mean += v; });
    return mean === 0 ? 0 : (moved / (level.length - 1)) / (mean / level.length);
  }

  /* ------------------------------------------------------------------- checks */

  function runAll() {
    results.length = 0;

    group('boot');
    check('game booted', () => !!window.game && window.game.isBooted);
    check('display font loaded', () => {
      const loaded = document.fonts.check('16px "Bangers"');
      return { pass: loaded, detail: loaded ? '' : 'falling back to the system stack' };
    });
    check('every scene registered', () => {
      const want = ['Menu', 'Play', 'Settings', 'Difficulty', 'PenaltyMode', 'Game',
        'Penalty', 'FullTime'];
      const have = scenes().map((s) => s.scene.key);
      const missing = want.filter((k) => have.indexOf(k) === -1);
      return { pass: missing.length === 0, detail: missing.join(', ') };
    });

    group('render scale');
    check('canvas is drawn above game resolution', () => {
      const c = window.game.canvas;
      return {
        pass: c.width === CONFIG.CANVAS.width * Renderer.RENDER_SCALE,
        detail: c.width + 'x' + c.height + ' at scale ' + Renderer.RENDER_SCALE,
      };
    });
    check('every camera frames exactly the game area', () => {
      const bad = [];
      scenes().forEach((s) => {
        if (!s.sys.isActive() && !s.sys.isSleeping()) return;
        const cam = s.cameras && s.cameras.main;
        if (!cam) return;
        if (Math.abs(cam.zoom - Renderer.RENDER_SCALE) > 0.001) bad.push(s.scene.key + ' zoom');
      });
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });

    group('theme');
    check('every skin supplies all seven named values', () => {
      const want = ['pitchGreen', 'stripe', 'chalkWhite', 'redTeam', 'blueTeam',
        'lagerYellow', 'nightBlack'];
      const bad = [];
      Renderer.SKINS.forEach((skin) => {
        want.forEach((k) => {
          if (typeof skin.colours[k] !== 'number') bad.push(skin.key + '.' + k);
        });
        Object.keys(skin.colours).forEach((k) => {
          if (want.indexOf(k) === -1) bad.push(skin.key + ' has extra ' + k);
        });
      });
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('every skin derives a full palette', () => {
      const want = Object.keys(Renderer.PALETTE);
      const wasSkin = Renderer.activeSkin;
      const bad = [];
      Renderer.SKINS.forEach((skin) => {
        Renderer.applySkin(skin.key);
        want.forEach((k) => {
          if (typeof Renderer.PALETTE[k] !== 'number' || isNaN(Renderer.PALETTE[k])) {
            bad.push(skin.key + '.' + k);
          }
        });
      });
      Renderer.applySkin(wasSkin);
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('keeper kits are lighter than their team, in every skin', () => {
      const wasSkin = Renderer.activeSkin;
      const bad = [];
      const lum = (c) => ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
      Renderer.SKINS.forEach((skin) => {
        Renderer.applySkin(skin.key);
        if (lum(Renderer.PALETTE.keeperRed) <= lum(Renderer.PALETTE.red)) bad.push(skin.key + ' red');
        if (lum(Renderer.PALETTE.keeperBlue) <= lum(Renderer.PALETTE.blue)) bad.push(skin.key + ' blue');
      });
      Renderer.applySkin(wasSkin);
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('the net is distinguishable from the surround', () => {
      const wasSkin = Renderer.activeSkin;
      const bad = [];
      Renderer.SKINS.forEach((skin) => {
        Renderer.applySkin(skin.key);
        if (Renderer.PALETTE.net === Renderer.PALETTE.surround) bad.push(skin.key);
      });
      Renderer.applySkin(wasSkin);
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('a nonsense skin name falls back rather than throwing', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('no-such-skin');
      const fellBack = Renderer.activeSkin === Renderer.SKINS[0].key;
      Renderer.applySkin(wasSkin);
      return fellBack;
    });

    group('juice');
    check('every effect has an on switch', () => {
      const bad = Object.keys(Renderer.JUICE)
        .filter((k) => typeof Renderer.JUICE[k].on !== 'boolean');
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('the drunk sway is capped where facing stays readable', () => {
      const deg = Renderer.JUICE.drunkSway.degrees;
      return { pass: deg > 0 && deg <= 6, detail: deg + ' degrees' };
    });
    check('a shot shakes the camera harder than a pass', () => {
      const J = Renderer.JUICE.cameraShake;
      const pass = CONFIG.KICK.passPower * J.passScale;
      const shot = CONFIG.KICK.shootPower * J.shootScale;
      return {
        pass: shot > pass * 2 && shot < 0.05,
        detail: 'pass ' + pass.toFixed(4) + ', shot ' + shot.toFixed(4),
      };
    });
    check('a fumble is labelled in the colour of whoever fumbled it', () => {
      const red = Renderer.outcomeColour('red');
      const blue = Renderer.outcomeColour('blue');
      // Lightened off the kit, or a label in a kit colour disappears into the grass.
      const lum = (css) => {
        const n = parseInt(css.slice(1), 16);
        return ((n >> 16) & 0xff) * 0.299 + ((n >> 8) & 0xff) * 0.587 + (n & 0xff) * 0.114;
      };
      const brighter = lum(red) > lum(Renderer.hex(Renderer.THEME.redTeam))
        && lum(blue) > lum(Renderer.hex(Renderer.THEME.blueTeam));
      return {
        pass: red !== blue && brighter,
        detail: 'red ' + red + ', blue ' + blue + ', lightened ' + brighter,
      };
    });
    check('the label that goes up really is the fumbler\'s colour', () => {
      const g = startMatch('two');
      const shown = [];
      ['red', 'blue'].forEach((team) => {
        Renderer.onOutcome(g, g[team], 'whiff');
        const label = g.children.list.filter((o) => o.depth === Renderer.DEPTH.label).pop();
        shown.push(label && label.style.color);
      });
      return {
        pass: shown[0] === Renderer.outcomeColour('red')
          && shown[1] === Renderer.outcomeColour('blue'),
        detail: shown.join(' / '),
      };
    });

    check('the default skin is named, not whichever happens to be listed first', () => {
      // Reordering the list to put classic first would otherwise have silently changed
      // what a new player starts on.
      const named = Renderer.SKINS.some((s) => s.key === Renderer.DEFAULT_SKIN);
      return {
        pass: named && Renderer.DEFAULT_SKIN === 'classic',
        detail: 'default is ' + Renderer.DEFAULT_SKIN + ', first listed is '
          + Renderer.SKINS[0].key,
      };
    });

    group('controls');
    check('one key per skin on the settings screen', () => withScene('Settings', (s) => {
      const missing = [];
      for (let i = 0; i < Renderer.SKINS.length; i++) {
        if (!s.keys[DIGIT_KEYS[i]]) missing.push(Renderer.SKINS[i].key);
      }
      return { pass: missing.length === 0, detail: 'unreachable: ' + missing.join(', ') };
    }));
    check('every skin can actually be selected', () => withScene('Settings', (s) => {
      const wasSkin = Renderer.activeSkin;
      const bad = [];
      for (let i = 0; i < Renderer.SKINS.length; i++) {
        chooseSkin(sceneByKey('Settings'), Renderer.SKINS[i].key);
        step(4);
        if (Renderer.activeSkin !== Renderer.SKINS[i].key) bad.push(Renderer.SKINS[i].key);
      }
      Renderer.applySkin(wasSkin);
      return { pass: bad.length === 0, detail: bad.join(', ') };
    }));
    check('one key per difficulty', () => {
      const bound = CONFIG.BOT.pickKeys.length;
      return {
        pass: bound >= CONFIG.BOT.order.length,
        detail: CONFIG.BOT.order.length + ' levels, ' + bound + ' keys',
      };
    });

    group('layout');
    ['Menu', 'Play', 'Settings', 'Difficulty', 'PenaltyMode'].forEach((key) => {
      check(key + ': no two pieces of text overlap', () => withScene(key, (scene) => {
        const items = textsOf(scene);
        const clashes = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            if (overlaps(boundsOf(items[i]), boundsOf(items[j]), 2)) {
              clashes.push('"' + items[i].text + '" / "' + items[j].text + '"');
            }
          }
        }
        return { pass: clashes.length === 0, detail: clashes.slice(0, 4).join('; ') };
      }));

      check(key + ': everything stays on screen', () => withScene(key, (scene) => {
        const off = textsOf(scene).filter((t) => {
          const b = boundsOf(t);
          return b.left < -1 || b.top < -1
            || b.right > CONFIG.CANVAS.width + 1 || b.bottom > CONFIG.CANVAS.height + 1;
        });
        return { pass: off.length === 0, detail: off.map((t) => t.text).slice(0, 4).join('; ') };
      }));
    });

    group('match');
    check('the crowd never stands on the HUD, in the biggest ground there is', () => {
      // The largest stadium stands deepest, so it is the one with the most chance of
      // somebody ending up in the scoreline.
      const wasStadium = Renderer.stadiumChoice;
      Renderer.stadiumChoice = 'large';
      const clashes = [];
      ['bot', 'two'].forEach((mode) => {
        for (let run = 0; run < 3; run++) {
          const g = startMatch(mode);
          const fans = g.children.list.filter((o) => o.texture && o.texture.key === 'fan');
          const hud = [g.hud.score, g.hud.timer, g.hud.left, g.hud.right, g.hud.hint]
            .filter(Boolean);
          hud.forEach((item) => {
            const box = boundsOf(item);
            fans.forEach((fan) => {
              if (overlaps(boundsOf(fan), box, 0)) clashes.push(mode + ' run ' + run);
            });
          });
        }
      });
      Renderer.stadiumChoice = wasStadium;
      return {
        pass: clashes.length === 0,
        detail: clashes.slice(0, 3).join(', ') || 'clear of the score, clock and both hints',
      };
    });
    check('both ends of the ground have room for about as many people', () => {
      /*
       * The blocks either side have to dodge whatever the HUD writes along the top and the
       * bottom, and being over-cautious about it up top left a thin scatter along one
       * touchline and a wall of people along the other.
       *
       * Counted in seats rather than in who turned up: the seats are the design, and the
       * turnout is a shuffle that would make this wobble either side of any threshold.
       */
      const stadium = Renderer.STADIUMS.find((st) => st.key === 'large');
      const perSide = Renderer.standRows(stadium).map((side) => {
        let n = 0;
        side.rows.forEach((row) => {
          side.bands.forEach((band) => { n += Renderer.seatsIn(band, row).length; });
        });
        return n;
      });
      const ratio = Math.min(...perSide) / Math.max(...perSide);
      return {
        pass: ratio > 0.75,
        detail: perSide.join(' and ') + ' seats (' + ratio.toFixed(2) + ')',
      };
    });
    check('a pinned ground is the one you get, and it is the size it claims', () => {
      const wasStadium = Renderer.stadiumChoice;
      const report = [];
      const bad = [];
      Renderer.pickableStadiums().forEach((stadium) => {
        Renderer.stadiumChoice = stadium.key;
        for (let run = 0; run < 3; run++) {
          const g = startMatch('two');
          const n = g.children.list.filter((o) => o.texture && o.texture.key === 'fan').length;
          if (Renderer.currentStadium.key !== stadium.key) bad.push(stadium.key + ' not honoured');
          if (n < stadium.people[0] || n > stadium.people[1]) {
            bad.push(stadium.key + ' turnout ' + n);
          }
          if (run === 0) report.push(stadium.key + ' ' + n);
        }
      });
      Renderer.stadiumChoice = wasStadium;
      return { pass: bad.length === 0, detail: bad.join(', ') || report.join(', ') };
    });
    check('a bigger ground really is bigger', () => {
      // Ordered by both measures, so the three are told apart at a glance rather than
      // being three names for the same thing.
      const sizes = Renderer.pickableStadiums();
      const rows = sizes.map((s) => s.rows);
      const most = sizes.map((s) => s.people[1]);
      const rising = (a) => a.every((n, i) => i === 0 || n > a[i - 1]);
      return {
        pass: sizes.length === 3 && rising(rows) && rising(most),
        detail: 'rows ' + rows.join('<') + ', crowd ' + most.join('<'),
      };
    });
    check('random gives more than one ground', () => {
      const wasStadium = Renderer.stadiumChoice;
      Renderer.stadiumChoice = 'random';
      const seen = new Set();
      for (let run = 0; run < 24; run++) {
        startMatch('two');
        seen.add(Renderer.currentStadium.key);
      }
      Renderer.stadiumChoice = wasStadium;
      return { pass: seen.size > 1, detail: [...seen].join(', ') };
    });
    check('nobody watching is standing on the pitch, or off the screen', () => {
      /*
       * Stated as "not on the playing area" rather than "above or below it", because the
       * biggest ground now has stands behind both goals and the people in them are beside
       * the pitch rather than over it.
       */
      const P = CONFIG.PITCH;
      const pitch = { left: P.left, right: P.right, top: P.top, bottom: P.bottom };
      const wasStadium = Renderer.stadiumChoice;
      const bad = [];
      Renderer.pickableStadiums().forEach((stadium) => {
        Renderer.stadiumChoice = stadium.key;
        const g = startMatch('two');
        g.children.list.filter((o) => o.texture && o.texture.key === 'fan').forEach((fan) => {
          const b = boundsOf(fan);
          if (overlaps(b, pitch, 0)) bad.push(stadium.key + ' on the pitch at y' + Math.round(fan.y));
          if (b.top < 0 || b.left < 0 || b.bottom > CONFIG.CANVAS.height
            || b.right > CONFIG.CANVAS.width) {
            bad.push(stadium.key + ' off the screen at y' + Math.round(fan.y));
          }
        });
      });
      Renderer.stadiumChoice = wasStadium;
      return { pass: bad.length === 0, detail: bad.slice(0, 4).join(', ') || 'all in the stands' };
    });
    check('only the biggest ground has stands behind the goals', () => {
      const withEnds = Renderer.STADIUMS.filter((st) => Renderer.endStands(st).length > 0);
      return {
        pass: withEnds.length === 1 && withEnds[0].key === 'large',
        detail: withEnds.map((st) => st.key).join(', ') || 'none of them',
      };
    });
    check('the stands behind the goals are not joined to the ones down the sides', () => {
      /*
       * Open corners are the whole look: a ground that grew a bit at a time rather than a
       * tidy continuous bowl. So every end has to stop short of every side.
       */
      const large = Renderer.STADIUMS.find((st) => st.key === 'large');
      const sides = Renderer.standRows(large);
      const ends = Renderer.endStands(large);
      const joined = [];
      ends.forEach((end, i) => {
        sides.forEach((side, j) => {
          const sideBox = { left: -Infinity, right: Infinity,
            top: Math.min(side.rail, side.back), bottom: Math.max(side.rail, side.back) };
          const endBox = { left: Math.min(end.face, end.back), right: Math.max(end.face, end.back),
            top: end.top, bottom: end.bottom };
          if (overlaps(endBox, sideBox, 0)) joined.push('end ' + i + ' meets side ' + j);
        });
      });
      return {
        pass: ends.length === 2 && joined.length === 0,
        detail: joined.join(', ') || ends.length + ' ends, all four corners open',
      };
    });
    check('the stands behind the goals are behind the goals, not in them', () => {
      const P = CONFIG.PITCH;
      const large = Renderer.STADIUMS.find((st) => st.key === 'large');
      const bad = [];
      Renderer.endStands(large).forEach((end) => {
        const near = Math.min(end.face, end.back);
        const far = Math.max(end.face, end.back);
        // Clear of the netting, which reaches goalDepth back from each line.
        if (near < P.left - P.goalDepth && far > P.left - P.goalDepth) bad.push('left in the net');
        if (near < P.right + P.goalDepth && far > P.right + P.goalDepth) bad.push('right in the net');
        if (near < 0 || far > CONFIG.CANVAS.width) bad.push('off the screen');
      });
      return { pass: bad.length === 0, detail: bad.join(', ') || 'both tucked in behind the nets' };
    });
    check('there is grass between the back of the net and the stand', () => {
      // A stand built hard against the netting reads as part of the goal rather than as
      // somewhere people are standing to watch it.
      const P = CONFIG.PITCH;
      const large = Renderer.STADIUMS.find((st) => st.key === 'large');
      const gaps = Renderer.endStands(large).map((end) => {
        const netBack = end.dir < 0 ? P.left - P.goalDepth : P.right + P.goalDepth;
        return Math.round(Math.abs(end.face - netBack));
      });
      return {
        pass: gaps.length === 2 && gaps.every((gap) => gap >= 8),
        detail: gaps.join('px and ') + 'px off the netting',
      };
    });
    check('everybody in an end stand is inside it, sway and all', () => {
      /*
       * The space behind a goal line is fixed and most of it is net, so what is left has
       * to hold the seating exactly. This is the sum that decides how many columns fit:
       * get it wrong and somebody in the back one is leaning through the back wall, or
       * off the edge of the screen entirely.
       */
      const K = Renderer.CROWD;
      const large = Renderer.STADIUMS.find((st) => st.key === 'large');
      const reach = K.figureRadius + K.swayPx;
      const bad = [];
      Renderer.endStands(large).forEach((end) => {
        const near = Math.min(end.face, end.back);
        const far = Math.max(end.face, end.back);
        end.columns.forEach((column, i) => {
          const r = reach * column.scale;
          if (column.x - r < near - 0.01 || column.x + r > far + 0.01) {
            bad.push('column ' + i + ' at x' + Math.round(column.x) + ' of ' + Math.round(near)
              + '-' + Math.round(far));
          }
        });
      });
      return {
        pass: bad.length === 0,
        detail: bad.join(', ') || 'every seat clear of both walls, '
          + Renderer.ENDS.columns + ' deep',
      };
    });
    check('sunday league is played on its own ground and no other', () => {
      // Its blurb promises mud, a rail and a dozen witnesses. A brick terrace is not that.
      const wasSkin = Renderer.activeSkin;
      const wasStadium = Renderer.stadiumChoice;
      const got = [];
      Renderer.applySkin('sunday');
      ['random', 'small', 'medium', 'large'].forEach((choice) => {
        Renderer.stadiumChoice = choice;
        startMatch('two');
        got.push(Renderer.currentStadium.key);
      });
      Renderer.applySkin(wasSkin);
      Renderer.stadiumChoice = wasStadium;
      const own = Renderer.STADIUMS.find((st) => st.key === 'sunday');
      return {
        pass: got.every((k) => k === 'sunday') && own && own.structure === false,
        detail: 'asked for random/small/medium/large, got ' + got.join(', '),
      };
    });
    check('its ground cannot be picked for anything else', () => {
      const offered = Renderer.pickableStadiums().map((st) => st.key);
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const rolled = new Set();
      const wasStadium = Renderer.stadiumChoice;
      Renderer.stadiumChoice = 'random';
      for (let i = 0; i < 40; i += 1) {
        startMatch('two');
        rolled.add(Renderer.currentStadium.key);
      }
      Renderer.applySkin(wasSkin);
      Renderer.stadiumChoice = wasStadium;
      return {
        pass: offered.indexOf('sunday') === -1 && !rolled.has('sunday'),
        detail: 'settings offer ' + offered.join('/') + ', 40 rolls gave ' + [...rolled].join('/'),
      };
    });
    check('a ground with no stand has no seats to sit in', () => {
      // Sunday league is a rail and some grass. Drawing seats on it would be drawing a
      // stand it does not have.
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const g = startMatch('two');
      const fans = g.children.list.filter((o) => o.texture && o.texture.key === 'fan');
      // Shaken off the grid they were spaced out on, so they read as a scatter.
      const onTheGrid = fans.filter((f) => Number.isInteger(f.seat.x * 2)).length;
      Renderer.applySkin(wasSkin);
      return {
        pass: fans.length > 0 && onTheGrid < fans.length,
        detail: fans.length + ' standing, ' + onTheGrid + ' of them still on the grid',
      };
    });
    check('the HUD score and clock do not collide', () => {
      const g = startMatch('bot');
      return {
        pass: !overlaps(boundsOf(g.hud.score), boundsOf(g.hud.timer), 0),
        detail: 'score bottom ' + Math.round(boundsOf(g.hud.score).bottom)
          + ', clock top ' + Math.round(boundsOf(g.hud.timer).top),
      };
    });

    group('typography');
    // The family string starts with a quote, so "leads with" is a search, not index 0.
    const leadsWithDisplayFace = (t) => /^\s*"?Bangers"?/.test(t.style.fontFamily);

    check('the shouty roles use the display face', () => {
      const g = startMatch('bot');
      const bad = [];
      if (!leadsWithDisplayFace(g.hud.score)) bad.push('score');
      if (!leadsWithDisplayFace(g.hud.timer)) bad.push('clock');
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    check('small copy stays on the system stack', () => {
      const g = startMatch('bot');
      const bad = [];
      // Absent in a thumb-controlled match, where neither has anything to say.
      if (g.hud.hint && leadsWithDisplayFace(g.hud.hint)) bad.push('pause hint');
      if (g.hud.left && leadsWithDisplayFace(g.hud.left)) bad.push('controls');
      return { pass: bad.length === 0, detail: bad.join(', ') };
    });
    /*
     * Not "above 1", because that depends on the window: this page shows the canvas
     * smaller than it is drawn, so 1 is correct here and 3.5 is correct in the game. What
     * must hold everywhere is that text is rendered at the density that was worked out
     * for it rather than at whatever Phaser defaults to.
     */
    check('text is rendered at the density worked out for the display', () => {
      const g = startMatch('bot');
      const want = Renderer.textResolution(g);
      const got = g.hud.score.style.resolution;
      return {
        pass: Math.abs(got - want) < 0.01,
        detail: 'wanted ' + want.toFixed(2) + ', got ' + got.toFixed(2),
      };
    });

    group('effects');
    check('a frozen keeper is visibly marked, and unmarked when it thaws', () => {
      const g = startMatch('two');
      const keeper = g.keepers[0];
      const stars = () => g.children.list.filter((o) => o.texture && o.texture.key === 'star').length;
      Renderer.onKeeperFreeze(g, keeper, true);
      step(2);
      const during = stars();
      Renderer.onKeeperFreeze(g, keeper, true);
      step(2);
      const afterRepeat = stars();
      Renderer.onKeeperFreeze(g, keeper, false);
      step(2);
      return {
        pass: during === Renderer.JUICE.keeperFreeze.stars && afterRepeat === during && stars() === 0,
        detail: during + ' during, ' + afterRepeat + ' after a repeat, ' + stars() + ' after thaw',
      };
    });
    check('the ball only trails when it is moving fast', () => {
      const g = startMatch('two');
      const trail = () => g.children.list.filter((o) => o.texture
        && o.texture.key === 'ball' && o.depth === Renderer.DEPTH.ball - 1).length;
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      g.ball.setPosition(CONFIG.PITCH.centreX, CONFIG.PITCH.centreY - 140);
      g.ball.body.setVelocity(0, 0);
      step(10);
      const slow = trail();
      g.ball.body.setVelocity(Renderer.JUICE.ballTrail.minSpeed + 250, 0);
      step(12);
      return { pass: slow === 0 && trail() > 0, detail: slow + ' when slow, ' + trail() + ' when fast' };
    });
    check('an outcome label stays on screen from the touchline', () => {
      const g = startMatch('two');
      g.red.sprite.setPosition(CONFIG.PITCH.left + 4, CONFIG.PITCH.top + 20);
      Renderer.onOutcome(g, g.red, 'wildSlice');
      step(2);
      const label = g.children.list.filter((o) => o.text && o.depth === Renderer.DEPTH.label).pop();
      const b = boundsOf(label);
      return {
        pass: b.left >= -1 && b.right <= CONFIG.CANVAS.width + 1 && b.top >= -1,
        detail: 'left ' + Math.round(b.left) + ', right ' + Math.round(b.right),
      };
    });
    check('turning an effect off suppresses it', () => {
      const g = startMatch('two');
      const was = Renderer.JUICE.outcomeLabels.on;
      Renderer.JUICE.outcomeLabels.on = false;
      const before = g.children.list.filter((o) => o.depth === Renderer.DEPTH.label).length;
      Renderer.onOutcome(g, g.red, 'whiff');
      step(2);
      const after = g.children.list.filter((o) => o.depth === Renderer.DEPTH.label).length;
      Renderer.JUICE.outcomeLabels.on = was;
      return { pass: after === before, detail: before + ' before, ' + after + ' after' };
    });

    group('set pieces');
    check('a goal flashes, bursts and banners', () => {
      const g = startMatch('two');
      const before = g.children.list.length;
      Renderer.onGoal(g, 'red', { red: 1, blue: 0 });
      step(2);
      const added = g.children.list.length - before;
      const banner = g.children.list.filter((o) => o.text === 'GOAL!').length;
      return {
        pass: added > Renderer.JUICE.goalCelebration.particles && banner === 1,
        detail: added + ' objects added, ' + banner + ' banner',
      };
    });
    check('the goal banner arrives from off screen', () => {
      const g = startMatch('two');
      Renderer.onGoal(g, 'blue', { red: 0, blue: 1 });
      step(1);
      const banner = g.children.list.find((o) => o.text === 'GOAL!');
      return { pass: banner.x < 0, detail: 'starts at x ' + Math.round(banner.x) };
    });
    check('the countdown uses the display face', () => {
      const g = startMatch('two');
      Renderer.onKickoffCount(g, 3);
      step(1);
      const n = g.children.list.filter((o) => o.text === '3').pop();
      return { pass: /^\s*"?Bangers"?/.test(n.style.fontFamily), detail: n.style.fontFamily };
    });

    check('full time: nothing overlaps and the winner is named', () => {
      sceneByKey('Menu').scene.start('FullTime', {
        mode: 'two', scores: { red: 3, blue: 1 }, penalties: null,
      });
      step(6);
      const scene = sceneByKey('FullTime');
      const items = textsOf(scene);
      const clashes = [];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (overlaps(boundsOf(items[i]), boundsOf(items[j]), 2)) {
            clashes.push('"' + items[i].text + '" / "' + items[j].text + '"');
          }
        }
      }
      const named = items.some((t) => t.text.indexOf('WINS') !== -1);
      return { pass: clashes.length === 0 && named, detail: clashes.slice(0, 3).join('; ') };
    });
    check('a drawn shootout still reads as a result', () => {
      onlyScene('FullTime');
      sceneByKey('Menu').scene.start('FullTime', {
        mode: 'bot', standalone: true, scores: null, penalties: { red: 4, blue: 3 },
      });
      step(6);
      const items = textsOf(sceneByKey('FullTime')).map((t) => t.text);
      return {
        pass: items.some((t) => t.indexOf('4 - 3') !== -1)
          && items.some((t) => t.indexOf('on penalties') !== -1),
        detail: items.join(' | ').slice(0, 90),
      };
    });
    check('penalty scene: nothing overlaps', () => {
      onlyScene('Penalty');
      sceneByKey('Menu').scene.start('Penalty', { mode: 'bot', standalone: true });
      step(10);
      const items = textsOf(sceneByKey('Penalty'));
      const clashes = [];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (overlaps(boundsOf(items[i]), boundsOf(items[j]), 2)) {
            clashes.push('"' + items[i].text + '" / "' + items[j].text + '"');
          }
        }
      }
      return { pass: clashes.length === 0, detail: clashes.slice(0, 3).join('; ') };
    });

    group('pitch dressing');
    /* Netting is drawn with a clipper, and a clipper that leaks would paint strands
     * across the pitch. Worth checking as arithmetic rather than by eye. */
    check('net strands are clipped to the goal mouth', () => {
      const drawn = [];
      const fake = { lineStyle() {}, lineBetween(x1, y1, x2, y2) { drawn.push([x1, y1, x2, y2]); } };
      const box = { x: 100, y: 200, w: 46, h: 150 };
      Renderer.crosshatch(fake, box.x, box.y, box.w, box.h);
      const outside = drawn.filter((l) => l.some((v, i) => {
        const isX = i % 2 === 0;
        const lo = isX ? box.x : box.y;
        const hi = isX ? box.x + box.w : box.y + box.h;
        return v < lo - 0.01 || v > hi + 0.01;
      }));
      return {
        pass: drawn.length > 0 && outside.length === 0,
        detail: drawn.length + ' strands, ' + outside.length + ' escaping the mouth',
      };
    });
    /*
     * The goal is drawn rather than baked from a picture, so what it looks like is
     * arithmetic and can be checked as arithmetic. A recorder standing in for a Graphics
     * object is enough: what matters is where each stroke lands, not the pixels.
     */
    function recorder() {
      // seq is the order it was drawn in, which is the only way to ask whether something
      // ended up over the top of something else.
      const r = { fills: [], lines: [], circles: [], rects: [], seq: 0 };
      r.fillStyle = (colour) => { r.fill = colour; };
      r.lineStyle = (width, colour, alpha) => {
        r.width = width;
        r.stroke = colour;
        r.alpha = alpha === undefined ? 1 : alpha;
      };
      r.fillRect = (x, y, w, h) => r.fills.push({ x, y, w, h, colour: r.fill, seq: r.seq++ });
      r.lineBetween = (x1, y1, x2, y2) => r.lines.push({
        x1, y1, x2, y2, colour: r.stroke, alpha: r.alpha, width: r.width, seq: r.seq++,
      });
      r.strokeRect = (x, y, w, h) => r.rects.push({
        x, y, w, h, colour: r.stroke, alpha: r.alpha, seq: r.seq++,
      });
      r.fillCircle = (x, y, radius) => r.circles.push({
        x, y, radius, colour: r.fill, seq: r.seq++,
      });
      r.strokeCircle = (x, y, radius) => r.circles.push({
        x, y, radius, rim: true, seq: r.seq++,
      });
      return r;
    }

    check('nobody is sat in a doorway', () => {
      /*
       * Every stand has a way out cut into its back wall, and the seating is laid on a
       * grid that knows nothing about it. Left alone, that puts two supporters in the
       * doorway of every block, sitting in mid air with the wall drawn through them.
       */
      const S = Renderer.STADIUMS.find((st) => st.key === 'large');
      const room = Math.max(Renderer.SEATS.width, Renderer.SEATS.height) / 2;
      const doors = Renderer.standRows(S)
        .reduce((all, side) => all.concat(Renderer.exitsIn(side)), [])
        .concat(Renderer.endStands(S).map((end) => end.exit))
        .map((exit) => ({
          left: exit.x - exit.width / 2, right: exit.x + exit.width / 2,
          top: exit.y - exit.height / 2, bottom: exit.y + exit.height / 2,
        }));
      const blocked = Renderer.seatPlaces(S).filter((place) => doors.some((door) => overlaps(
        { left: place.seat.x - room, right: place.seat.x + room,
          top: place.seat.y - room, bottom: place.seat.y + room }, door, 0)));
      return {
        pass: doors.length === 6 && blocked.length === 0,
        detail: blocked.length ? blocked.length + ' seats in the way of ' + doors.length + ' doors'
          : Renderer.seatPlaces(S).length + ' seats, all of ' + doors.length + ' doorways clear',
      };
    });
    check('the netting is in shade towards the back of the net', () => {
      // Flat dark grey behind the line is what makes a goal look painted on. Each band
      // back has to be darker than the one in front of it, and its strands fainter.
      const rec = recorder();
      Renderer.drawNet(rec, Renderer.PALETTE, -1);
      const bands = rec.fills.slice().sort((a, b) => b.x - a.x);
      const lum = (c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
      const strands = bands.map((band) => rec.lines
        .filter((l) => Math.abs(l.x2 - l.x1) > 0.01)
        .filter((l) => {
          // A pixel in off each edge: the bands are painted with a shade of overlap so
          // their seams do not show, and that overlap reaches into the next band's mesh.
          const mid = (l.x1 + l.x2) / 2;
          return mid > band.x + 1 && mid < band.x + band.w - 1;
        })
        .reduce((most, l) => Math.max(most, l.alpha), 0));
      const wrong = [];
      bands.forEach((band, i) => {
        if (i > 0 && lum(band.colour) >= lum(bands[i - 1].colour)) wrong.push('band ' + i + ' no darker');
        if (i > 0 && strands[i] >= strands[i - 1]) wrong.push('band ' + i + ' no fainter');
      });
      return {
        pass: bands.length >= 4 && wrong.length === 0,
        detail: wrong.join(', ') || bands.length + ' bands, ' + lum(bands[0].colour) + ' down to '
          + lum(bands[bands.length - 1].colour) + ' with strands '
          + strands[0].toFixed(2) + ' down to ' + strands[strands.length - 1].toFixed(2),
      };
    });
    check('the mesh does not restart at the seams between the bands', () => {
      /*
       * The shading is drawn band by band but the netting is one net. Every strand runs at
       * 45 degrees, so y-x names a strand going one way and y+x one going the other: if a
       * band laid out its own mesh from its own edge, those numbers would stop landing on
       * a single lattice and the seams would show as chevrons.
       */
      const rec = recorder();
      Renderer.drawNet(rec, Renderer.PALETTE, -1);
      const step = Renderer.GOAL.netSpacing;
      const lattice = { down: null, up: null };
      const off = [];
      rec.lines.forEach((l) => {
        // A strand clipped to a corner arrives as a point, which has no direction to read.
        if (Math.abs(l.x2 - l.x1) < 0.01) return;
        const way = (l.y2 - l.y1) * (l.x2 - l.x1) >= 0 ? 'down' : 'up';
        const c = way === 'down' ? l.y1 - l.x1 : l.y1 + l.x1;
        if (lattice[way] === null) lattice[way] = c;
        const from = Math.abs(((c - lattice[way]) % step + step) % step);
        if (Math.min(from, step - from) > 0.01) off.push(way + ' strand at ' + Math.round(c));
      });
      return {
        pass: rec.lines.length > 40 && off.length === 0,
        detail: off.slice(0, 3).join(', ') || rec.lines.length + ' strands, all on the same mesh',
      };
    });
    check('the whole goal fits in the goal', () => {
      /*
       * There is a stand ten pixels behind the netting now and a keeper in front of it, so
       * a frame drawn a shade too generously would be drawn through one or the other. The
       * uprights and the stanchions are the exception, and only by their own thickness:
       * they stand on the line and on the back of the net, so half of each is outside.
       */
      const P = CONFIG.PITCH;
      const N = Renderer.GOAL;
      const rec = recorder();
      Renderer.drawNet(rec, Renderer.PALETTE, -1);
      Renderer.drawGoalFrame(rec, Renderer.PALETTE, -1);
      const box = {
        left: P.left - P.goalDepth - N.stanchionRadius,
        right: P.left + N.postRadius,
        top: P.mouthTop - N.postRadius,
        bottom: P.mouthBottom + N.postRadius,
      };
      const out = [];
      const test = (what, left, right, top, bottom) => {
        if (left < box.left - 0.6 || right > box.right + 0.6
          || top < box.top - 0.6 || bottom > box.bottom + 0.6) out.push(what);
      };
      rec.fills.forEach((f) => test('netting', f.x, f.x + f.w, f.y, f.y + f.h));
      rec.lines.forEach((l) => test('a strand or a bar', Math.min(l.x1, l.x2), Math.max(l.x1, l.x2),
        Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)));
      rec.circles.forEach((c) => test('a post', c.x - c.radius, c.x + c.radius,
        c.y - c.radius, c.y + c.radius));
      return {
        pass: out.length === 0 && rec.circles.length === 8,
        detail: out.length ? [...new Set(out)].join(', ') + ' outside the recess'
          : 'net, frame, 2 uprights and 2 stanchions, all inside '
            + Math.round(box.right - box.left) + 'px',
      };
    });
    check('the pitch markings do not move the walls', () => {
      const g = startMatch('two');
      const bounds = g.red.sprite.body.customBoundsRectangle;
      return {
        pass: !!bounds && bounds.width === CONFIG.PITCH.width
          && bounds.height === CONFIG.PITCH.height,
        detail: bounds ? bounds.width + 'x' + bounds.height : 'no bounds',
      };
    });

    group('skin switching');
    check('the game opens on classic, whatever it was left on', () => {
      /*
       * The skins are a laugh to be reached for rather than a wardrobe to be kept, so a
       * run that ended in Sunday League does not start there. Nothing is written down,
       * which is what leaves the next load nothing to read back.
       */
      const key = 'drunkfootball.skin';
      const was = Renderer.activeSkin;
      let stored = null;
      try { window.localStorage.removeItem(key); } catch (err) { /* private browsing */ }
      Renderer.applySkin('sunday');
      try { stored = window.localStorage.getItem(key); } catch (err) { stored = null; }
      Renderer.applySkin(was);
      const opening = Renderer.SKINS.find((sk) => sk.key === Renderer.DEFAULT_SKIN);
      return {
        pass: stored === null && Renderer.DEFAULT_SKIN === 'classic' && !!opening,
        detail: stored === null
          ? 'it opens on ' + Renderer.DEFAULT_SKIN + ' and remembers nothing'
          : 'sunday league was written down as ' + stored,
      };
    });
    /* Textures are baked from the palette, so swapping skins used to destroy textures that
     * sprites on screen were still holding, and the next render died on a null. */
    check('switching skins mid-match repaints without a dangling texture', () => {
      const wasSkin = Renderer.activeSkin;
      const g = startMatch('two');
      const order = ['sunday', 'frozen', 'sixpints'];
      let survived = true;
      order.forEach((key) => {
        chooseSkin(sceneByKey('Game'), key);
        step(8);
        const scene = sceneByKey('Game');
        const bad = scene.children.list.filter((o) => o.texture && o.texture.key !== '__MISSING'
          && (!o.texture.source || !o.texture.source[0]));
        if (bad.length) survived = false;
      });
      Renderer.applySkin(wasSkin);
      return { pass: survived, detail: survived ? '' : 'a sprite was left holding a dead texture' };
    });
    check('the kits actually change with the skin', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sixpints');
      startMatch('two');
      const before = Renderer.PALETTE.red;
      Renderer.applySkin('sunday');
      startMatch('two');
      const after = Renderer.PALETTE.red;
      Renderer.applySkin(wasSkin);
      return { pass: before !== after, detail: Renderer.hex(before) + ' then ' + Renderer.hex(after) };
    });

    group('readability');
    /* The brief is explicit that facing, ball position and possession must be easier to
     * read after the design pass, not harder. Possession is the one with nothing else to
     * infer it from, so it gets checked hardest. */
    check('the ball carrier is marked, and unmarked when the ball comes loose', () => {
      const g = startMatch('two');
      const ring = () => g.children.list.find((o) => o.texture && o.texture.key === 'owner_ring');
      g.red.sprite.setPosition(CONFIG.PITCH.centreX - 200, CONFIG.PITCH.centreY);
      g.setOwner(g.red);
      step(3);
      const held = ring() && ring().visible;

      // Genuinely loose: dropping possession alone is not enough, a ball still at their
      // feet is picked straight back up on the next frame.
      g.setOwner(null);
      g.ball.setPosition(CONFIG.PITCH.centreX + 300, CONFIG.PITCH.centreY - 200);
      g.ball.body.setVelocity(0, 0);
      step(3);
      const loose = ring() && ring().visible;
      return { pass: held === true && loose === false, detail: 'held ' + held + ', loose ' + loose };
    });
    check('the mark follows whoever has it', () => {
      const g = startMatch('two');
      g.red.sprite.setPosition(CONFIG.PITCH.centreX - 200, CONFIG.PITCH.centreY);
      g.blue.sprite.setPosition(CONFIG.PITCH.centreX + 200, CONFIG.PITCH.centreY);
      g.setOwner(g.red);
      step(3);
      const ring = g.children.list.find((o) => o.texture && o.texture.key === 'owner_ring');
      const onRed = Math.abs(ring.x - g.red.sprite.x) < 2;
      g.setOwner(g.blue);
      step(3);
      const onBlue = Math.abs(ring.x - g.blue.sprite.x) < 2;
      return { pass: onRed && onBlue, detail: 'red ' + onRed + ', blue ' + onBlue };
    });
    check('turning the possession mark off suppresses it', () => {
      const g = startMatch('two');
      const was = Renderer.JUICE.possessionRing.on;
      Renderer.JUICE.possessionRing.on = false;
      g.setOwner(g.red);
      step(3);
      const ring = g.children.list.find((o) => o.texture && o.texture.key === 'owner_ring');
      const hidden = !ring || !ring.visible;
      Renderer.JUICE.possessionRing.on = was;
      return { pass: hidden, detail: hidden ? '' : 'still showing with the switch off' };
    });
    check('facing survives the sway', () => {
      // Nothing may overwrite facing beyond the capped wobble, or the nose stops telling
      // you where a kick will go.
      const g = startMatch('two');
      g.red.facing = 0;
      g.red.sprite.body.setVelocity(0, 0);
      step(4);
      const drift = Math.abs(Phaser.Math.RadToDeg(g.red.sprite.rotation - g.red.facing));
      return { pass: drift < 0.01, detail: drift.toFixed(3) + ' degrees off when still' };
    });

    group('keeper');
    check('a ball that gets behind him goes in rather than sitting there', () => {
      /*
       * Written the day a match ran out its clock with the ball parked between a keeper
       * and his own goal line: not over it, so not a goal, and not reachable either,
       * because a keeper is a solid body standing in the only way to it.
       */
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const before = g.state.scores.blue;
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      // Behind him, on the line, going nowhere.
      g.ball.body.reset(P.left + 4, P.centreY);
      g.ball.body.setVelocity(0, 0);
      let guard = 0;
      while (g.state.phase === 'play' && guard++ < 30) step(1);
      return {
        pass: g.state.scores.blue === before + 1,
        detail: g.state.scores.blue === before + 1
          ? 'given after ' + guard + ' frames' : 'still sat there after ' + guard + ' frames',
      };
    });
    check('a ball lying against the wall beside the goal is not one', () => {
      // The mouth is 150px of a 600px line. Touching the line beside it is touching a wall.
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const before = g.state.scores.blue;
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      g.ball.body.reset(P.left + 4, P.mouthTop - 60);
      g.ball.body.setVelocity(0, 0);
      for (let i = 0; i < 12; i += 1) step(1);
      return {
        pass: g.state.scores.blue === before,
        detail: g.state.scores.blue === before ? 'no goal given, 60px above the mouth'
          : 'a goal was given off the wall',
      };
    });
    check('neither of them is asleep when play starts', () => {
      /*
       * A keeper's freeze runs on a clock of its own, and that clock used to run through
       * every stoppage: the coin toss, the countdown and now the walk out add up to longer
       * than a keeper stays awake for, so both of them were stood there swaying before
       * anybody had kicked anything. The scoring window belongs in the football.
       */
      const g = startMatch('two');
      const now = g.time.now;
      const asleep = g.keepers.filter((k) => k.frozen).length;
      const soonest = Math.min(...g.keepers.map((k) => k.nextFreezeAt - now));
      return {
        pass: asleep === 0 && soonest >= 0,
        detail: asleep ? asleep + ' of them already frozen at the whistle'
          : 'both awake, the first freeze due in ' + Math.round(soonest) + 'ms',
      };
    });
    check('a keeper that fails its roll lets the ball through', () => {
      const g = startMatch('two');
      const keeper = g.keepers[0];
      keeper.beatenUntil = g.time.now + 1000;
      keeper.reachedUntil = 0;
      return { pass: g.keeperReaches(keeper) === false, detail: 'still reaching while beaten' };
    });
    check('the verdict is held rather than re-rolled every frame', () => {
      const g = startMatch('two');
      const keeper = g.keepers[0];
      keeper.beatenUntil = 0;
      keeper.reachedUntil = 0;
      // Forced failure, then the same overlap asked again: it must stay beaten.
      const real = Math.random;
      Math.random = () => 0.999;
      const first = g.keeperReaches(keeper);
      Math.random = () => 0;      // would now succeed, if it were re-rolling
      const second = g.keeperReaches(keeper);
      Math.random = real;
      return {
        pass: first === false && second === false,
        detail: 'first ' + first + ', second ' + second,
      };
    });
    check('a keeper that makes its roll still saves', () => {
      const g = startMatch('two');
      const keeper = g.keepers[0];
      keeper.beatenUntil = 0;
      keeper.reachedUntil = 0;
      const real = Math.random;
      Math.random = () => 0;      // inside saveChance
      const reached = g.keeperReaches(keeper);
      Math.random = real;
      return { pass: reached === true, detail: 'reached ' + reached };
    });
    check('being beaten is announced, not silent', () => {
      const g = startMatch('two');
      const keeper = g.keepers[0];
      const before = g.children.list.filter((o) => o.depth === Renderer.DEPTH.label).length;
      Renderer.onKeeperBeaten(g, keeper, 700);
      step(2);
      const after = g.children.list.filter((o) => o.depth === Renderer.DEPTH.label).length;
      return { pass: after > before, detail: before + ' before, ' + after + ' after' };
    });
    check('the save odds leave the shootout alone', () => {
      // Penalties are tweened, not physical, so the roll must not touch their one-in-three.
      const table = CONFIG.PENALTY.TABLE.reduce((sum, row) => sum + row.weight, 0);
      return { pass: table > 0 && typeof CONFIG.PENALTY.TABLE[0].weight === 'number',
               detail: 'penalty table still weighted, total ' + table };
    });

    group('pause menu');
    check('pausing offers resume, settings and quit', () => {
      const g = startMatch('two');
      g.togglePause();
      step(2);
      const offered = textsOf(g).map((t) => t.text).join(' | ');
      const has = (word) => offered.indexOf(word) !== -1;
      return {
        pass: g.state.paused && has('RESUME') && has('SETTINGS') && has('QUIT'),
        detail: offered.slice(0, 110),
      };
    });
    check('the menu card covers every line printed on it', () => {
      // Pause mid-kickoff on purpose: the banner and the countdown both live in the middle
      // of the screen, which is exactly where the menu goes.
      const g = startMatch('two');
      Renderer.onKickoffCount(g, 3);
      g.togglePause();
      step(2);
      const card = g.pauseView.find((o) => o.texture && o.texture.key === 'px'
        && Math.round(o.displayWidth) === Renderer.PAUSE_CARD.width);
      if (!card) return { pass: false, detail: 'no card behind the menu' };
      const box = boundsOf(card);
      const spills = g.pauseView.filter((o) => o.text)
        .filter((o) => {
          const b = boundsOf(o);
          return b.left < box.left || b.right > box.right || b.top < box.top || b.bottom > box.bottom;
        })
        .map((o) => o.text);
      return {
        pass: card.alpha > 0.95 && spills.length === 0,
        detail: spills.length ? 'spills: ' + spills.join(', ') : 'card alpha ' + card.alpha,
      };
    });
    check('resuming clears the menu', () => {
      const g = startMatch('two');
      g.togglePause();
      step(2);
      g.togglePause();
      step(2);
      const left = textsOf(g).filter((t) => t.text.indexOf('RESUME') !== -1).length;
      return { pass: !g.state.paused && left === 0, detail: left + ' menu items left behind' };
    });
    /* The whole point of opening settings from a pause: the match has to survive it. */
    check('settings opens over the match without ending it', () => {
      const g = startMatch('two');
      g.state.scores.red = 2;
      g.togglePause();
      step(2);
      g.openSettings();
      step(4);
      const settingsUp = window.game.scene.isActive('Settings');
      const matchAlive = window.game.scene.getScene('Game').state.scores.red === 2;
      const matchAsleep = window.game.scene.isPaused('Game');
      return {
        pass: settingsUp && matchAlive && matchAsleep,
        detail: 'settings ' + settingsUp + ', score kept ' + matchAlive + ', match paused ' + matchAsleep,
      };
    });
    check('leaving settings returns to the match, still paused', () => {
      const g = startMatch('two');
      g.state.scores.blue = 3;
      g.togglePause();
      step(2);
      g.openSettings();
      step(4);
      sceneByKey('Settings').leave();
      step(4);
      const back = sceneByKey('Game');
      return {
        pass: !window.game.scene.isActive('Settings') && back.state.scores.blue === 3
          && back.state.paused === true,
        detail: 'score ' + back.state.scores.blue + ', paused ' + back.state.paused,
      };
    });
    check('settings from the front screen still goes back to the menu', () => {
      // Cleared right down first: a match left running from the previous check would keep
      // updating underneath and this would be testing the wrong thing.
      scenes().forEach((s) => window.game.scene.stop(s.scene.key));
      step(2);
      window.game.scene.start('Settings');
      step(6);
      sceneByKey('Settings').leave();
      step(6);
      return {
        pass: window.game.scene.isActive('Menu'),
        detail: 'landed on ' + scenes().filter((s) => s.sys.isActive()).map((s) => s.scene.key).join(',')
      };
    });
    check('changing a skin mid-pause keeps the way back', () => {
      const g = startMatch('two');
      g.togglePause();
      step(2);
      g.openSettings();
      step(4);
      chooseSkin(sceneByKey('Settings'), 'frozen');
      step(6);
      const kept = sceneByKey('Settings').returnTo === 'Game';
      Renderer.applySkin('sixpints');
      return { pass: kept, detail: 'returnTo is ' + sceneByKey('Settings').returnTo };
    });

    group('thumb controls');
    /*
     * Forced on throughout: the suite runs on a desktop, which is exactly the device auto
     * is meant to say no to, so nothing below would ever run otherwise.
     */
    function withTouch(mode, fn) {
      const was = AIM.touch;
      AIM.touch = 'on';
      try {
        return fn(startMatch(mode || 'bot'));
      } finally {
        AIM.touch = was;
      }
    }

    /* One frame of the real input pipeline, so these read the struct the game reads. */
    function readOnce(g) {
      g.red.input = makeInput();
      g.readInput(g.time.now);
      return g.red.input;
    }

    const pressed = (input) => Object.keys(input).filter((k) => input[k]).sort().join('+') || 'none';

    check('a match on a touch device gets a stick, two buttons and a pause', () => {
      return withTouch('bot', (g) => {
        const v = g.touchView;
        const labels = v.objects.filter((o) => o.text).map((o) => o.text).sort().join(',');
        return {
          pass: !!g.touch && !!v.base && !!v.nub && !!v.buttons.pass && !!v.buttons.shoot
            && labels === 'PASS,PAUSE,SHOOT',
          detail: 'labels ' + labels,
        };
      });
    });
    check('switched off, a match has none of it', () => {
      const was = AIM.touch;
      AIM.touch = 'off';
      const g = startMatch('bot');
      AIM.touch = was;
      return { pass: g.touch === null && !g.touchView, detail: 'touch is ' + g.touch };
    });
    check('two players never get them, however hard you ask', () => {
      // Two thumbs on one phone is not a game, so this stays keyboard whatever the setting.
      return withTouch('two', (g) => ({
        pass: g.touch === null, detail: 'touch is ' + g.touch,
      }));
    });

    check('a push on the stick sets the same booleans a key does', () => {
      return withTouch('bot', (g) => {
        g.touch.x = 1; g.touch.y = 0;
        const right = pressed(readOnce(g));
        g.touch.x = -0.7; g.touch.y = -0.7;
        const upLeft = pressed(readOnce(g));
        return {
          pass: right === 'right' && upLeft === 'left+up',
          detail: 'right gave ' + right + ', up-left gave ' + upLeft,
        };
      });
    });
    check('the stick gives eight ways, no more and no fewer', () => {
      // The same eight the keys give. Anything finer would put a thumb on a movement path
      // the keyboard and the bot cannot reach, and the three are deliberately identical.
      return withTouch('bot', (g) => {
        const seen = new Set();
        for (let deg = 0; deg < 360; deg += 3) {
          const rad = Phaser.Math.DegToRad(deg);
          g.touch.x = Math.cos(rad);
          g.touch.y = Math.sin(rad);
          seen.add(pressed(readOnce(g)));
        }
        return { pass: seen.size === 8, detail: seen.size + ' distinct: ' + [...seen].join(' ') };
      });
    });
    check('a thumb resting on the glass is not a direction', () => {
      return withTouch('bot', (g) => {
        g.touch.x = CONFIG.TOUCH.deadZone * 0.9; g.touch.y = 0;
        const inside = pressed(readOnce(g));
        g.touch.x = CONFIG.TOUCH.deadZone * 1.6; g.touch.y = 0;
        const outside = pressed(readOnce(g));
        return {
          pass: inside === 'none' && outside === 'right',
          detail: 'inside ' + inside + ', outside ' + outside,
        };
      });
    });
    check('a tap is worth exactly one kick', () => {
      // The bug this guards: a held-down flag kicks again on every frame it survives.
      return withTouch('bot', (g) => {
        g.touch.queuedKick = 'shoot';
        const first = readOnce(g).shoot;
        const second = readOnce(g).shoot;
        return { pass: first === true && second === false,
                 detail: 'first ' + first + ', then ' + second };
      });
    });
    check('the buttons report through the handlers they were given', () => {
      return withTouch('bot', (g) => {
        g.touchView.buttons.pass.emit('pointerdown');
        const afterPass = g.touch.queuedKick;
        g.touchView.buttons.shoot.emit('pointerdown');
        const afterShoot = g.touch.queuedKick;
        return { pass: afterPass === 'pass' && afterShoot === 'shoot',
                 detail: afterPass + ' then ' + afterShoot };
      });
    });
    check('dragging the stick reports how far it was pushed, not how many pixels', () => {
      return withTouch('bot', (g) => {
        const L = Renderer.touchLayout();
        const S = L.stick;
        const v = g.touchView;
        /*
         * Picked up well down its own column. It follows a thumb along the column and is
         * held inside it across the column, which is the whole behaviour: the sideways
         * clamp is what keeps it off the pitch.
         */
        const grabY = CONFIG.CANVAS.height - S.margin;
        v.zone.emit('pointerdown', { id: 7, worldX: S.x, worldY: grabY });
        const followed = Math.abs(v.base.y - grabY) < 1;
        const inColumn = v.base.x >= S.margin - 1
          && v.base.x <= Math.max(S.margin, L.stickZone.right - S.margin) + 1;

        // Pushed from wherever the base ended up: half the travel, then far past the end.
        const from = { x: v.base.x, y: v.base.y };
        g.input.emit('pointermove', { id: 7, worldX: from.x + S.travel / 2, worldY: from.y });
        const half = g.touch.x;
        g.input.emit('pointermove', { id: 7, worldX: from.x + S.travel * 4, worldY: from.y });
        const capped = g.touch.x;
        const nubHeld = Math.abs(v.nub.x - (v.base.x + S.travel)) < 1;

        g.input.emit('pointerup', { id: 7 });
        const let_go = g.touch.x === 0 && Math.abs(v.base.y - S.y) < 1;

        return {
          pass: followed && inColumn && Math.abs(half - 0.5) < 0.02
            && Math.abs(capped - 1) < 0.02 && nubHeld && let_go,
          detail: 'followed ' + followed + ', in column ' + inColumn + ', half '
            + half.toFixed(2) + ', capped ' + capped.toFixed(2) + ', nub held ' + nubHeld
            + ', released ' + let_go,
        };
      });
    });
    check('a second thumb cannot steal the stick', () => {
      return withTouch('bot', (g) => {
        const S = Renderer.touchLayout().stick;
        const v = g.touchView;
        const first = CONFIG.CANVAS.height - S.margin;
        v.zone.emit('pointerdown', { id: 1, worldX: S.x, worldY: first });
        v.zone.emit('pointerdown', { id: 2, worldX: S.x, worldY: S.margin });
        const stayed = Math.abs(v.base.y - first) < 1;
        // The button thumb lifting must not drop the steering thumb's stick.
        g.input.emit('pointerup', { id: 2 });
        const held = Math.abs(v.base.y - first) < 1;
        g.input.emit('pointerup', { id: 1 });
        return { pass: stayed && held, detail: 'stayed ' + stayed + ', held ' + held };
      });
    });

    check('pausing takes the controls away and lets the stick go', () => {
      return withTouch('bot', (g) => {
        const v = g.touchView;
        v.zone.emit('pointerdown', { id: 3, worldX: 300, worldY: 600 });
        g.input.emit('pointermove', { id: 3, worldX: 400, worldY: 600 });
        const pushing = g.touch.x > 0.5;

        g.togglePause();
        step(2);
        const hidden = v.objects.every((o) => !o.visible);
        const deaf = v.zone.input.enabled === false;
        const centred = g.touch.x === 0;

        g.togglePause();
        step(2);
        const back = v.objects.every((o) => o.visible) && v.zone.input.enabled === true;
        return {
          pass: pushing && hidden && deaf && centred && back,
          detail: 'pushing ' + pushing + ', hidden ' + hidden + ', deaf ' + deaf
            + ', centred ' + centred + ', back ' + back,
        };
      });
    });
    check('a kick tapped as the match pauses does not go off on resume', () => {
      return withTouch('bot', (g) => {
        g.touchView.buttons.shoot.emit('pointerdown');
        g.togglePause();
        step(2);
        g.togglePause();
        step(2);
        const fired = readOnce(g).shoot;
        return { pass: fired === false, detail: 'shot on resume: ' + fired };
      });
    });
    check('thumbs and the click scheme are never both live', () => {
      // Otherwise every tap on the stick is also a pass. Asked for explicitly, because an
      // earlier check leaves the preference wherever it happened to finish.
      const was = AIM.redUsesMouse;
      AIM.redUsesMouse = true;
      const out = withTouch('bot', (g) => ({
        pass: g.redUsesMouse() === false,
        detail: 'pref on, in use ' + g.redUsesMouse(),
      }));
      AIM.redUsesMouse = was;
      return out;
    });
    check('the key legend and the pause hint give way to the button', () => {
      return withTouch('bot', (g) => ({
        pass: !g.hud.left && !g.hud.hint && !!g.hud.score && !!g.hud.right,
        detail: 'left ' + !!g.hud.left + ', hint ' + !!g.hud.hint,
      }));
    });

    check('nothing on the thumb layout touches anything else on it', () => {
      const L = Renderer.touchLayout();
      const circles = [
        { name: 'stick', x: L.stick.x, y: L.stick.y, r: L.stick.baseRadius },
      ].concat(L.buttons.map((b) => ({ name: b.key, x: b.x, y: b.y, r: b.radius })));
      const clashes = [];
      for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
          const a = circles[i];
          const b = circles[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) clashes.push(a.name + '/' + b.name);
        }
      }
      // The pause pill sits in the surround under the pitch, between the two thumbs.
      const pill = L.pause;
      circles.forEach((c) => {
        const nearestX = Math.max(pill.x - pill.width / 2, Math.min(c.x, pill.x + pill.width / 2));
        const nearestY = Math.max(pill.y - pill.height / 2, Math.min(c.y, pill.y + pill.height / 2));
        if (Math.hypot(c.x - nearestX, c.y - nearestY) < c.r) clashes.push(c.name + '/pause');
      });
      return { pass: clashes.length === 0, detail: clashes.join(', ') || 'all clear' };
    });
    check('the wide frame moves the pitch without resizing it', () => {
      // The promise the whole frame rests on: a phone plays the same game, not a smaller
      // one. Only the margins either side of the pitch differ.
      const P = CONFIG.PITCH;
      const F = CONFIG.FRAME;
      const gutterLeft = P.left;
      const gutterRight = CONFIG.CANVAS.width - P.right;
      return {
        pass: P.width === 1120 && P.height === 600 && gutterLeft === gutterRight
          && gutterLeft === (F.wide ? 80 + F.gutter : 80),
        detail: 'play area ' + P.width + 'x' + P.height + ', gutters '
          + gutterLeft + '/' + gutterRight + ', wide ' + F.wide,
      };
    });
    check('no thumb control stands on the pitch', () => {
      /*
       * The reason the frame is wide at all. Meaningful only in that frame, which is what
       * tests.html?wide boots, and asking for thumb controls for real is what turns it on.
       */
      if (!CONFIG.FRAME.wide) return { pass: true, detail: 'narrow frame, nothing to check' };
      const L = Renderer.touchLayout();
      const P = CONFIG.PITCH;
      const on = [];
      const clear = (name, left, right) => {
        if (right > P.left && left < P.right) on.push(name);
      };
      const S = L.stick;
      // Worst case: the stick picked up at the far edge of its column, pushed all the way
      // over, so the nub is as close to the touchline as it can ever get.
      const basedAt = Math.max(S.margin, L.stickZone.right - S.margin);
      clear('stick ring', S.x - S.baseRadius, basedAt + S.baseRadius);
      clear('stick nub', S.x - S.baseRadius - S.travel, basedAt + S.travel + S.nubRadius);
      L.buttons.forEach((b) => clear(b.key, b.x - b.radius, b.x + b.radius));
      // The pause pill is centred, so it is only ever clear of the pitch vertically.
      const pillTop = L.pause.y - L.pause.height / 2;
      if (pillTop < P.bottom) on.push('pause');
      return { pass: on.length === 0, detail: on.join(', ') || 'all clear of the grass' };
    });
    check('every thumb control is on the screen', () => {
      // Wide frame only, for the same reason as the check above: it is the only frame in
      // which thumb controls are ever really drawn.
      if (!CONFIG.FRAME.wide) return { pass: true, detail: 'narrow frame, nothing to check' };
      const L = Renderer.touchLayout();
      const W = CONFIG.CANVAS.width;
      const H = CONFIG.CANVAS.height;
      const off = [];
      const box = (name, left, top, right, bottom) => {
        if (left < 0 || top < 0 || right > W || bottom > H) off.push(name);
      };
      // Checked at whatever reaches further, the ring or the nub pushed all the way out.
      const S = L.stick;
      const reach = S.margin;
      box('stick', S.x - reach, S.y - reach, S.x + reach, S.y + reach);
      L.buttons.forEach((b) => box(b.key, b.x - b.radius, b.y - b.radius,
        b.x + b.radius, b.y + b.radius));
      box('pause', L.pause.x - L.pause.width / 2, L.pause.y - L.pause.height / 2,
        L.pause.x + L.pause.width / 2, L.pause.y + L.pause.height / 2);
      return { pass: off.length === 0, detail: off.join(', ') || 'all on screen' };
    });

    check('the settings list has not outgrown the grass it stands on', () => {
      // Adding a line pushed the last row of the key table onto the very edge of the band.
      // Nothing may start on the grass and finish off it.
      const band = Renderer.SETTINGS_BAND;
      const bottom = band.top + band.height;
      return withScene('Settings', (scene) => {
        const spills = textsOf(scene)
          .filter((t) => {
            const b = boundsOf(t);
            return b.top >= band.top && b.top < bottom && b.bottom > bottom;
          })
          .map((t) => t.text);
        return { pass: spills.length === 0, detail: spills.join(', ') || 'all on the grass' };
      });
    });
    check('the setting cycles through all three and is remembered', () => {
      // The stored blob, not just the live value: this check calls the real save, and a
      // suite that leaves the game booting into a different frame next time is a suite
      // that has broken something.
      const storedBefore = window.localStorage.getItem('drunkfootball.prefs');
      const was = AIM.touch;
      AIM.touch = 'auto';
      const s = sceneByKey('Settings');
      const seen = [];
      for (let i = 0; i < 4; i++) {
        seen.push(AIM.touch);
        // Stubbed on both counts: a real cycle either redraws the screen or, when the
        // frame width changes with it, reloads the page out from under the suite.
        s.cycleTouch.call({ refresh: () => {}, restartForFrame: () => {} });
      }
      const stored = JSON.parse(window.localStorage.getItem('drunkfootball.prefs') || '{}');
      const remembered = stored.touch === AIM.touch;
      AIM.touch = was;
      if (storedBefore === null) window.localStorage.removeItem('drunkfootball.prefs');
      else window.localStorage.setItem('drunkfootball.prefs', storedBefore);
      return {
        pass: seen.join(',') === 'auto,on,off,auto' && remembered,
        detail: seen.join(',') + ', remembered ' + remembered,
      };
    });
    check('the front screen explains thumbs instead of naming keys', () => {
      const was = AIM.touch;
      AIM.touch = 'on';
      onlyScene('Menu');
      sceneByKey('Menu').scene.restart();
      step(6);
      const said = textsOf(sceneByKey('Menu')).map((t) => t.text).join(' | ');
      AIM.touch = was;
      return {
        pass: said.indexOf('right thumb') !== -1 && said.indexOf('W A S D') === -1,
        detail: said.slice(0, 120),
      };
    });

    check('every penalty corner can be tapped as well as keyed', () => {
      // Without this a shootout is unplayable on a phone: 1, 2 and 3 are the only way in.
      onlyScene('Penalty');
      sceneByKey('Menu').scene.start('Penalty', { mode: 'bot', standalone: true });
      step(20);
      const p = sceneByKey('Penalty');
      const zones = p.children.list.filter((o) => o.type === 'Zone' && o.input);
      if (zones.length !== CONFIG.PENALTY.thirds.length) {
        return { pass: false, detail: zones.length + ' zones for '
          + CONFIG.PENALTY.thirds.length + ' corners' };
      }
      // A tap has to travel the same road a key press does, guards included.
      const taken = [];
      const realTake = p.takePenalty;
      p.takePenalty = (i) => { taken.push(i); };
      p.phase = 'await';
      zones.forEach((z) => z.emit('pointerdown'));
      // And must be refused when it is not yours to take.
      p.phase = 'kicking';
      zones[0].emit('pointerdown');
      p.takePenalty = realTake;
      return {
        pass: taken.join(',') === '0,1,2',
        detail: 'taps produced ' + taken.join(',') || 'nothing',
      };
    });
    check('full time can be left without a keyboard', () => {
      onlyScene('FullTime');
      sceneByKey('Menu').scene.start('FullTime', {
        mode: 'two', scores: { red: 3, blue: 1 }, penalties: null,
      });
      step(14);
      const f = sceneByKey('FullTime');
      const pickable = textsOf(f).filter((t) => t.input
        && (t.text.indexOf('rematch') !== -1 || t.text.indexOf('menu') !== -1));
      return {
        pass: pickable.length === 2,
        detail: pickable.map((t) => t.text).join(' | ') || 'nothing pickable',
      };
    });

    group('aim assist');

    function withAssist(level, fn) {
      const was = AIM.assist;
      AIM.assist = level;
      try {
        return fn();
      } finally {
        AIM.assist = was;
      }
    }

    /*
     * One shot, taken from a fixed spot with the roll forced to come off, so what is being
     * measured is the aim and only the aim.
     */
    function shootFrom(g, player, keeperY) {
      const P = CONFIG.PITCH;
      player.sprite.setPosition(P.centreX, P.centreY);
      g.ball.setPosition(P.centreX, P.centreY);
      g.ball.body.setVelocity(0, 0);
      g.setOwner(player);
      const keeper = g.keepers.find((k) => k.side === (player.targetGoalX > P.centreX ? 'right' : 'left'));
      if (keeper) keeper.sprite.setPosition(keeper.homeX, keeperY);
      g.doKick(player, 'shoot', g.time.now);
      const v = g.ball.body.velocity;
      // Where the ball crosses the goal line, which is the only thing that matters.
      const run = player.targetGoalX - P.centreX;
      return P.centreY + (v.y / v.x) * run;
    }

    check('there are three settings and they are a ladder', () => {
      /*
       * Off, then a nudge, then the lot. Each step has to be more help than the one before
       * it or there is no reason for it to be there, and only the top one does anything
       * about the keeper at all.
       */
      const levels = CONFIG.ASSIST.LEVELS;
      const spread = (l) => (l.shootSpreadDeg === undefined
        ? CONFIG.KICK.shootSpreadDeg : l.shootSpreadDeg);
      const wrong = [];
      if (levels.length !== 3) wrong.push(levels.length + ' settings');
      if (levels[0].key !== 'off' || Object.keys(levels[0]).length !== 1) {
        wrong.push('the first one does something');
      }
      levels.forEach((level, i) => {
        if (i === 0) return;
        if (spread(level) >= spread(levels[i - 1])) wrong.push(level.key + ' shoots no straighter');
        if (!(level.passBendDeg > (levels[i - 1].passBendDeg || 0))) {
          wrong.push(level.key + ' bends a pass no further');
        }
      });
      if (levels.filter((l) => l.leanOffKeeper).length !== 1 || !levels[2].leanOffKeeper) {
        wrong.push('leaning off the keeper is not the top setting alone');
      }
      return {
        pass: wrong.length === 0,
        detail: wrong.join(', ') || levels.map((l) => l.key + ' ' + spread(l) + 'deg/'
          + (l.passBendDeg || 0) + 'deg bend').join(', '),
      };
    });
    check('assisted shots lean away from the keeper, and only lean', () => {
      /*
       * A lean, not a pick: the aim shifts to the half the keeper has left, but the
       * scatter around it is wider than the shift, so plenty of shots still go straight
       * back at him. Averages, because one shot proves nothing either way.
       */
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      const high = [];
      const low = [];
      withAssist('full', () => {
        // Keeper high, then keeper low. The aim should cross over between the two.
        for (let i = 0; i < 40; i += 1) high.push(shootFrom(g, g.red, P.mouthTop + 10));
        for (let i = 0; i < 40; i += 1) low.push(shootFrom(g, g.red, P.mouthBottom - 10));
      });
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const keeperHigh = mean(high);
      const keeperLow = mean(low);
      const atKeeper = high.filter((y) => y < P.centreY).length;
      return {
        pass: keeperHigh > P.centreY && keeperLow < P.centreY && atKeeper > 0,
        detail: 'keeper high -> averages y' + Math.round(keeperHigh)
          + ', keeper low -> y' + Math.round(keeperLow)
          + ' (centre ' + Math.round(P.centreY) + '), and ' + atKeeper
          + ' of 40 still went back at him',
      };
    });
    check('an assisted shot is still a shot on target', () => {
      // Leaning off the keeper is no use if the lean plus the scatter puts the ball wide.
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      const wide = [];
      withAssist('full', () => {
        for (let i = 0; i < 60; i += 1) {
          const y = shootFrom(g, g.red, i % 2 ? P.mouthTop + 10 : P.mouthBottom - 10);
          if (y < P.mouthTop || y > P.mouthBottom) wide.push(Math.round(y));
        }
      });
      return {
        pass: wide.length === 0,
        detail: wide.length ? 'off target at y' + wide.slice(0, 4).join(', ')
          : '60 shots, all between the posts',
      };
    });
    check('each setting tightens the spread, and none of them removes it', () => {
      // Measured on the goal line, in pixels, with the keeper parked in the middle so the
      // aim is the same for all three and only the scatter round it differs.
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      const spreadOf = (level) => withAssist(level, () => {
        const ys = [];
        for (let i = 0; i < 60; i += 1) ys.push(shootFrom(g, g.red, P.centreY));
        return Math.max(...ys) - Math.min(...ys);
      });
      const spreads = CONFIG.ASSIST.LEVELS.map((l) => spreadOf(l.key));
      const tightening = spreads.every((px, i) => i === 0 || px < spreads[i - 1]);
      return {
        pass: tightening && spreads[spreads.length - 1] > 0,
        detail: CONFIG.ASSIST.LEVELS.map((l, i) => l.key + ' ' + Math.round(spreads[i]) + 'px')
          .join(', '),
      };
    });
    check('an assisted pass is bent towards goal, not aimed at it', () => {
      /*
       * The cap is the point. A pass that snapped straight at the net would stop being a
       * pass, so it may only be turned so far and the rest of the decision stays with
       * whoever is holding the keys.
       */
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      g.red.sprite.setPosition(P.centreX, P.centreY);
      g.ball.setPosition(P.centreX, P.centreY);

      const angleAfterPass = (facing) => {
        g.red.facing = facing;
        g.ball.setPosition(P.centreX, P.centreY);
        g.ball.body.setVelocity(0, 0);
        g.setOwner(g.red);
        g.doKick(g.red, 'pass', g.time.now);
        return Math.atan2(g.ball.body.velocity.y, g.ball.body.velocity.x);
      };

      // Facing straight away from goal is the hardest case: a full 180 to correct, so
      // every setting turns the pass by exactly as much as it is allowed to and no more.
      const away = Math.PI;
      const wrong = [];
      const turns = CONFIG.ASSIST.LEVELS.map((level) => {
        const angle = withAssist(level.key, () => angleAfterPass(away));
        const turned = Math.abs(Phaser.Math.RadToDeg(Phaser.Math.Angle.Wrap(angle - away)));
        const cap = level.passBendDeg || 0;
        if (Math.abs(turned - cap) > 0.5) wrong.push(level.key + ' turned ' + turned.toFixed(1)
          + ' with a cap of ' + cap);
        return level.key + ' ' + turned.toFixed(0) + ' of ' + cap;
      });
      return { pass: wrong.length === 0, detail: wrong.join(', ') || turns.join(', ') };
    });
    check('the help is paid for in sobriety', () => {
      /*
       * The bargain, and the whole reason there is a choice to make: every step up the
       * ladder takes a clean touch off you. Read off the table each level actually rolls,
       * because the release rate alone cannot see it - a mis-hit still sends the ball
       * somewhere, so most of the price is invisible to anything counting kicks.
       */
      const g = startMatch('two');
      const before = JSON.stringify(CONFIG.DRUNK.TABLE);
      const misHits = (table) => table.filter((row) => row.key !== 'intended')
        .map((row) => row.weight).join(',');

      const odds = CONFIG.ASSIST.LEVELS.map((level) => withAssist(level.key, () => {
        const table = g.drunkTable(g.red);
        const total = table.reduce((n, row) => n + row.weight, 0);
        return {
          key: level.key,
          clean: table.find((row) => row.key === 'intended').weight / total,
          rest: misHits(table),
        };
      }));
      const wrong = [];
      odds.forEach((level, i) => {
        if (i > 0 && level.clean >= odds[i - 1].clean) wrong.push(level.key + ' costs nothing');
        if (level.rest !== misHits(CONFIG.DRUNK.TABLE)) wrong.push(level.key + ' moved a mis-hit');
      });
      if (JSON.stringify(CONFIG.DRUNK.TABLE) !== before) wrong.push('THE TABLE ITSELF CHANGED');

      return {
        pass: wrong.length === 0,
        detail: wrong.join(', ') || 'a clean touch '
          + odds.map((l) => l.key + ' ' + Math.round(l.clean * 100) + '%').join(' -> ')
          + ', every mis-hit left exactly as it was',
      };
    });
    check('the price is paid at the real kick, not just on paper', () => {
      /*
       * Counted off the real thing rather than inferred from how fast the ball left: every
       * outcome but the one you asked for reports itself to the renderer, so borrowing
       * that hook counts clean touches exactly instead of guessing at them by speed.
       *
       * Off against full only. Their eight points apart is a gap 2000 presses can see
       * without arguing; the step between neighbours is half that, and how the ladder is
       * ordered is arithmetic the check above does exactly.
       */
      const was = Renderer.onOutcome;
      const clean = (level) => withAssist(level, () => {
        const g = startMatch('two');
        const P = CONFIG.PITCH;
        let intended = 0;
        for (let i = 0; i < 2000; i += 1) {
          let missed = false;
          Renderer.onOutcome = () => { missed = true; };
          g.red.sprite.setPosition(P.centreX, P.centreY);
          g.red.stunnedUntil = 0;
          g.ball.setPosition(P.centreX, P.centreY);
          g.ball.body.setVelocity(0, 0);
          g.setOwner(g.red);
          g.attemptKick(g.red, 'shoot', g.time.now);
          if (!missed) intended += 1;
        }
        return intended / 2000;
      });

      const before = JSON.stringify(CONFIG.DRUNK.TABLE);
      let off = 0;
      let full = 0;
      try {
        off = clean('off');
        full = clean('full');
      } finally {
        Renderer.onOutcome = was;
      }
      const after = JSON.stringify(CONFIG.DRUNK.TABLE);

      return {
        pass: before === after && off - full > 0.03,
        detail: (before === after ? '' : 'THE TABLE CHANGED, ')
          + 'the press came off ' + Math.round(off * 100) + '% of the time with no help, '
          + Math.round(full * 100) + '% with the lot',
      };
    });
    check('the bot pays nothing, because it is given nothing', () => {
      // Identity, not equality: unassisted, a player rolls the shared table itself.
      return withAssist('full', () => {
        const g = startMatch('bot');
        return {
          pass: g.drunkTable(g.blue) === CONFIG.DRUNK.TABLE
            && g.drunkTable(g.red) !== CONFIG.DRUNK.TABLE,
          detail: 'bot on the plain table, human on one of its own',
        };
      });
    });
    check('the bot never gets it, whatever it is set to', () => {
      // Its aim is how a difficulty is set, so handing it this would make every bot harder.
      const got = CONFIG.ASSIST.LEVELS.map((level) => withAssist(level.key, () => {
        const g = startMatch('bot');
        return { bot: g.assistLevel(g.blue).key, human: g.assistLevel(g.red).key };
      }));
      return {
        pass: got.every((r) => r.bot === 'off') && got[2].human === 'full',
        detail: got.map((r) => 'bot ' + r.bot + '/human ' + r.human).join(', '),
      };
    });
    check('both players get it in a two player match', () => {
      return withAssist('steady', () => {
        const g = startMatch('two');
        return {
          pass: g.assistLevel(g.red).key === 'steady' && g.assistLevel(g.blue).key === 'steady',
          detail: 'red ' + g.assistLevel(g.red).key + ', blue ' + g.assistLevel(g.blue).key,
        };
      });
    });
    check('a setting nobody recognises is off rather than a crash', () => {
      // Storage holds whatever an older build put there, including a level since renamed.
      return withAssist('rocket boots', () => {
        const g = startMatch('two');
        return { pass: g.assistLevel(g.red).key === 'off', detail: 'fell back to off' };
      });
    });
    check('the setting cycles through all three and is remembered', () => {
      const stored = window.localStorage.getItem('drunkfootball.prefs');
      const was = AIM.assist;
      AIM.assist = 'off';
      const scene = sceneByKey('Settings');
      const seen = [];
      for (let i = 0; i < CONFIG.ASSIST.LEVELS.length; i += 1) {
        scene.cycleAssist();
        seen.push(AIM.assist);
      }
      const saved = JSON.parse(window.localStorage.getItem('drunkfootball.prefs') || '{}');
      AIM.assist = was;
      if (stored === null) window.localStorage.removeItem('drunkfootball.prefs');
      else window.localStorage.setItem('drunkfootball.prefs', stored);
      return {
        pass: seen.join(',') === 'steady,full,off' && saved.assist === 'off',
        detail: 'off -> ' + seen.join(' -> ') + ', stored as ' + saved.assist,
      };
    });
    check('an old saved switch becomes a level', () => {
      /*
       * This was a toggle a version ago. Somebody who had it on has `true` in storage, and
       * a preference that quietly reset itself would be read as the setting not working.
       */
      const stored = window.localStorage.getItem('drunkfootball.prefs');
      const was = AIM.assist;
      const read = (value) => {
        window.localStorage.setItem('drunkfootball.prefs', JSON.stringify({ assist: value }));
        AIM.assist = 'steady';
        loadPrefs();
        return AIM.assist;
      };
      const on = read(true);
      const off = read(false);
      AIM.assist = was;
      if (stored === null) window.localStorage.removeItem('drunkfootball.prefs');
      else window.localStorage.setItem('drunkfootball.prefs', stored);
      return {
        pass: on === 'full' && off === 'off',
        detail: 'true reads as ' + on + ', false as ' + off,
      };
    });

    group('the stands');

    const fansIn = (scene) => scene.children.list.filter((o) => o.texture
      && o.texture.key === 'fan');

    /* Every seat in the ground, however many rows and blocks it has, ends included. */
    const allSeats = (stadium) => Renderer.seatPlaces(stadium).map((place) => place.seat);

    function withStadium(key, fn) {
      const was = Renderer.stadiumChoice;
      Renderer.stadiumChoice = key;
      try {
        return fn(startMatch('two'), Renderer.STADIUMS.find((s) => s.key === key));
      } finally {
        Renderer.stadiumChoice = was;
      }
    }

    /*
     * Tweens in this harness run on the wall clock rather than on the stepped one, so a
     * trip to the bar cannot be watched happening: it is read off where each leg of it is
     * declared to be going, and driven on by finishing the tween outright. What is being
     * checked is the order things happen in and where each leg ends up, which is where the
     * bugs would be.
     */
    /*
     * Tweens in this harness run on the wall clock rather than on the stepped one, so a
     * trip to the bar cannot be watched happening. Each leg is finished outright instead,
     * and each leg puts its traveller exactly where it was taking them, so what arrives is
     * still the real thing rather than a reading off the tween.
     */
    function finishTrip(obj) {
      if (obj.trip) obj.trip.complete();
    }

    const at = (obj, x, y) => Math.abs(obj.x - x) < 0.5 && Math.abs(obj.y - y) < 0.5;

    check('a small ground is metal and the bigger two are brick', () => {
      const wrong = Renderer.STADIUMS.filter((st) => !Renderer.MATERIALS[st.material]);
      const byKey = {};
      Renderer.STADIUMS.forEach((st) => { byKey[st.key] = st.material; });
      const metal = Renderer.MATERIALS.metal;
      const brick = Renderer.MATERIALS.brick;
      return {
        pass: wrong.length === 0 && byKey.small === 'metal'
          && byKey.medium === 'brick' && byKey.large === 'brick'
          && metal.wall !== brick.wall && metal.seat !== brick.seat,
        detail: wrong.length ? 'unknown material: ' + wrong.map((st) => st.key).join(', ')
          : Object.keys(byKey).map((k) => k + ' ' + byKey[k]).join(', '),
      };
    });
    check('there are always more seats than there are people to fill them', () => {
      // An empty seat is the point: it is what makes a thin crowd read as a thin crowd,
      // and what shows that somebody has gone for a drink.
      const tight = [];
      Renderer.STADIUMS.forEach((st) => {
        const seats = allSeats(st).length;
        if (seats <= st.people[1]) tight.push(st.key + ': ' + seats + ' seats, up to ' + st.people[1]);
      });
      return {
        pass: tight.length === 0,
        detail: tight.join(', ') || Renderer.STADIUMS
          .map((st) => st.key + ' ' + allSeats(st).length).join(', '),
      };
    });
    check('everybody is sat on a seat rather than near one', () => {
      return withStadium('large', (g, stadium) => {
        const seats = allSeats(stadium);
        const key = (x, y) => Math.round(x) + ',' + Math.round(y);
        const there = new Set(seats.map((st) => key(st.x, st.y)));
        const floating = fansIn(g).filter((f) => !there.has(key(f.seat.x, f.seat.y)));
        return {
          pass: floating.length === 0,
          detail: floating.length + ' off their seat, of ' + fansIn(g).length,
        };
      });
    });
    check('no two people are given the same seat', () => {
      return withStadium('medium', (g) => {
        const seen = new Set();
        let doubled = 0;
        fansIn(g).forEach((f) => {
          const k = Math.round(f.seat.x) + ',' + Math.round(f.seat.y);
          if (seen.has(k)) doubled += 1;
          seen.add(k);
        });
        return { pass: doubled === 0, detail: doubled + ' seats sat in twice' };
      });
    });
    check('every block has a way out, cut into the stand and clear of the HUD', () => {
      return withStadium('large', (g, stadium) => {
        const sides = Renderer.standRows(stadium);
        const bad = [];
        sides.forEach((side) => {
          const exits = Renderer.exitsIn(side);
          if (exits.length !== side.bands.length) bad.push('block without an exit');
          exits.forEach((hole) => {
            // Inside the structure, and on the screen.
            const withinStand = side.dir < 0
              ? hole.y >= side.back && hole.y <= side.rail
              : hole.y <= side.back && hole.y >= side.rail;
            if (!withinStand) bad.push('exit outside the stand at y' + Math.round(hole.y));
            const box = { left: hole.x - Renderer.BEER.holeWidth / 2,
              right: hole.x + Renderer.BEER.holeWidth / 2,
              top: hole.y - 10, bottom: hole.y + 10 };
            [g.hud.score, g.hud.timer, g.hud.left, g.hud.right, g.hud.hint]
              .filter(Boolean)
              .forEach((item) => {
                if (overlaps(box, boundsOf(item), 0)) bad.push('exit on the HUD');
              });
          });
        });
        return { pass: bad.length === 0, detail: bad.join(', ') || 'four ways out, all clear' };
      });
    });
    check('going for a beer empties the seat and then puts them back in it', () => {
      return withStadium('medium', (g) => {
        const fan = fansIn(g).find((f) => !f.away);
        const seat = { x: fan.seat.x, y: fan.seat.y };

        Renderer.sendForBeer(g, fan);
        const left = fan.away === true && fan.swayTween.paused === true;

        // Out through the gap in the back of the stand, gone by the time they reach it.
        finishTrip(fan);
        const outside = at(fan, fan.exit.x, fan.exit.y) && fan.alpha === 0;
        const seatEmpty = !fansIn(g).some((f) => !f.away && at(f, seat.x, seat.y));

        step(300);                     // long enough at the bar, on the scene clock
        finishTrip(fan);

        // And back to the seat they left, not to whichever one happens to be free.
        const home = at(fan, seat.x, seat.y) && fan.alpha === 1;

        return {
          pass: left && outside && seatEmpty && home && fan.away === false
            && fan.swayTween.paused === false,
          detail: 'left ' + left + ', out through the gap ' + outside
            + ', seat stood empty ' + seatEmpty + ', back in the same seat ' + home
            + ', swaying again ' + (fan.swayTween.paused === false),
        };
      });
    });
    check('the stand never empties out', () => {
      // The cap is what stops a lively crowd turning into a queue at the bar.
      return withStadium('large', (g) => {
        let most = 0;
        for (let i = 0; i < 60; i += 1) {
          step(30);
          most = Math.max(most, fansIn(g).filter((f) => f.away).length);
        }
        return {
          pass: most <= Renderer.BEER.maxAway && most > 0,
          detail: most + ' away at once, cap is ' + Renderer.BEER.maxAway,
        };
      });
    });

    group('floodlights');

    /* Runs fn under the floodlit skin and puts the old one back afterwards. */
    function underLights(fn) {
      const was = Renderer.activeSkin;
      Renderer.applySkin('floodlit');
      try {
        return fn(startMatch('two'));
      } finally {
        Renderer.applySkin(was);
      }
    }

    const poolsIn = (scene) => scene.children.list.filter((o) => o.texture
      && o.texture.key === 'light_pool');
    const shadowsIn = (scene) => scene.children.list.filter((o) => o.texture
      && o.texture.key === 'soft_shadow');

    check('the floodlit ground has a tower in each corner', () => {
      return underLights((g) => {
        const towers = Renderer.pylonPositions();
        const P = CONFIG.PITCH;
        // One per corner, and each of them actually outside the playing area.
        const outside = towers.filter((t) => t.x < P.left || t.x > P.right);
        return {
          pass: towers.length === 4 && outside.length === 4
            && poolsIn(g).length >= 4,
          detail: towers.length + ' towers, ' + outside.length + ' clear of the pitch, '
            + poolsIn(g).length + ' pools',
        };
      });
    });
    check('no tower stands on the HUD', () => {
      // They did. The control legend runs along the very top of the surround and the
      // corners are the only place a tower can go.
      return underLights((g) => {
        const clashes = [];
        Renderer.pylonPositions().forEach((pylon, i) => {
          const box = Renderer.pylonBox(pylon);
          [g.hud.score, g.hud.timer, g.hud.left, g.hud.right, g.hud.hint]
            .filter(Boolean)
            .forEach((item) => {
              if (overlaps(box, boundsOf(item), 0)) clashes.push('tower ' + i);
            });
        });
        return { pass: clashes.length === 0, detail: clashes.join(', ') || 'all four clear' };
      });
    });
    check('everybody on the pitch casts one shadow per tower', () => {
      return underLights((g) => {
        step(4);
        const casters = g.players.length + g.keepers.length + 1;   // and the ball
        const want = casters * Renderer.pylonPositions().length;
        const got = shadowsIn(g).length;
        return { pass: got === want, detail: got + ' shadows for ' + casters + ' on the pitch' };
      });
    });
    check('a shadow falls away from its tower, and follows whoever cast it', () => {
      return underLights((g) => {
        const P = CONFIG.PITCH;
        g.red.sprite.setPosition(P.centreX, P.centreY);
        step(4);
        const entry = g.juiceState.shadows.find((e) => e.caster.sprite === g.red.sprite);
        const wrongSide = entry.blobs.filter((blob, i) => {
          const pylon = entry.pylons[i];
          // Further from the tower than the player is, in both directions.
          const dp = Math.hypot(g.red.sprite.x - pylon.x, g.red.sprite.y - pylon.y);
          const db = Math.hypot(blob.x - pylon.x, blob.y - pylon.y);
          return db <= dp;
        });

        // And they move with him rather than staying where he was.
        const before = entry.blobs.map((b) => b.x);
        g.red.sprite.setPosition(P.centreX + 200, P.centreY);
        step(2);
        const moved = entry.blobs.every((b, i) => b.x > before[i]);

        return {
          pass: wrongSide.length === 0 && moved,
          detail: wrongSide.length + ' on the wrong side, followed ' + moved,
        };
      });
    });
    check('only the floodlit ground has any of it', () => {
      const was = Renderer.activeSkin;
      const bad = [];
      Renderer.SKINS.filter((sk) => sk.key !== 'floodlit').forEach((sk) => {
        Renderer.applySkin(sk.key);
        const g = startMatch('two');
        step(4);
        if (poolsIn(g).length || shadowsIn(g).length) bad.push(sk.key);
      });
      Renderer.applySkin(was);
      return { pass: bad.length === 0, detail: bad.join(', ') || 'daylight everywhere else' };
    });
    check('turning the lights off leaves a plain dark pitch', () => {
      const was = Renderer.JUICE.floodlights.on;
      Renderer.JUICE.floodlights.on = false;
      const out = underLights((g) => {
        step(4);
        return {
          pass: poolsIn(g).length === 0 && shadowsIn(g).length === 0,
          detail: poolsIn(g).length + ' pools, ' + shadowsIn(g).length + ' shadows',
        };
      });
      Renderer.JUICE.floodlights.on = was;
      return out;
    });
    check('the floodlit pitch really is the darkest one', () => {
      const lum = (c) => ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
      const floodlit = Renderer.SKINS.find((sk) => sk.key === 'floodlit');
      const brighter = Renderer.SKINS
        .filter((sk) => sk.key !== 'floodlit')
        .filter((sk) => lum(sk.colours.pitchGreen) <= lum(floodlit.colours.pitchGreen));
      return {
        pass: brighter.length === 0 && Renderer.FLOODLIGHTS.darken > 0.3,
        detail: brighter.map((sk) => sk.key).join(', ')
          || 'darkest grass, then dimmed a further ' + Renderer.FLOODLIGHTS.darken,
      };
    });

    group('changing the keys');

    /* The cell for one action, found the way a finger finds it: by where it is drawn. */
    function keyCell(scene, team, actionKey) {
      const T = Renderer.KEYS_TABLE;
      const i = ACTIONS.findIndex((a) => a.key === actionKey);
      const y = T.topY + i * T.rowGap;
      const cx = CONFIG.CANVAS.width / 2;
      const x = team === 'red' ? cx - 40 : cx + 190;
      return scene.children.list.find((o) => o.input && o.text !== undefined
        && Math.abs(o.y - y) < 2 && Math.abs(o.x - x) < 2);
    }

    function pressKey(keyCode) {
      window.dispatchEvent(new KeyboardEvent('keydown', { keyCode, which: keyCode, bubbles: true }));
      step(4);
    }

    /* Runs fn against a fresh keys screen and puts every binding back afterwards. */
    function withKeysScreen(fn) {
      const before = JSON.parse(JSON.stringify(CONFIG.CONTROLS));
      const stored = window.localStorage.getItem('drunkfootball.prefs');
      try {
        onlyScene('Keys');
        sceneByKey('Menu').scene.start('Keys', { returnTo: null });
        step(8);
        return fn();
      } finally {
        Object.keys(before).forEach((team) => {
          ACTIONS.forEach((a) => { CONFIG.CONTROLS[team][a.key] = before[team][a.key]; });
        });
        if (stored === null) window.localStorage.removeItem('drunkfootball.prefs');
        else window.localStorage.setItem('drunkfootball.prefs', stored);
      }
    }

    check('every key in the game is on the screen and can be picked', () => {
      return withKeysScreen(() => {
        const scene = sceneByKey('Keys');
        const missing = [];
        ['red', 'blue'].forEach((team) => {
          ACTIONS.forEach((a) => {
            if (!keyCell(scene, team, a.key)) missing.push(team + ' ' + a.key);
          });
        });
        return {
          pass: missing.length === 0,
          detail: missing.join(', ') || (ACTIONS.length * 2) + ' keys, all pickable',
        };
      });
    });
    check('picking a key and pressing another binds it', () => {
      return withKeysScreen(() => {
        keyCell(sceneByKey('Keys'), 'red', 'up').emit('pointerdown');
        step(8);
        const asked = !!sceneByKey('Keys').capturing;
        pressKey(Phaser.Input.Keyboard.KeyCodes.T);
        step(8);
        const bound = CONFIG.CONTROLS.red.up;
        const saved = JSON.parse(window.localStorage.getItem('drunkfootball.prefs') || '{}');
        return {
          pass: asked && bound === 'T' && saved.controls && saved.controls.red.up === 'T',
          detail: 'asked ' + asked + ', bound ' + bound,
        };
      });
    });
    check("a key that is already somebody else's is refused", () => {
      // Refused rather than swapped: two things answering to one key is the bug, and
      // silently moving somebody else's key is not the fix.
      return withKeysScreen(() => {
        const scene = sceneByKey('Keys');
        keyCell(scene, 'red', 'up').emit('pointerdown');
        step(8);
        pressKey(Phaser.Input.Keyboard.KeyCodes.I);   // blue's up
        step(8);
        return {
          pass: CONFIG.CONTROLS.red.up === 'W' && CONFIG.CONTROLS.blue.up === 'I'
            && sceneByKey('Keys').message.indexOf('already') !== -1,
          detail: 'red up ' + CONFIG.CONTROLS.red.up + ', blue up ' + CONFIG.CONTROLS.blue.up
            + ', said "' + sceneByKey('Keys').message + '"',
        };
      });
    });
    check('a key the match itself needs is refused', () => {
      return withKeysScreen(() => {
        const refused = [];
        Object.keys(RESERVED_KEYS).forEach((name) => {
          keyCell(sceneByKey('Keys'), 'red', 'pass').emit('pointerdown');
          step(8);
          pressKey(Phaser.Input.Keyboard.KeyCodes[name]);
          step(8);
          if (CONFIG.CONTROLS.red.pass === name) refused.push(name + ' got through');
        });
        return {
          pass: refused.length === 0,
          detail: refused.join(', ') || Object.keys(RESERVED_KEYS).join(', ') + ' all held back',
        };
      });
    });
    check('escape backs out of the question rather than out of the screen', () => {
      return withKeysScreen(() => {
        keyCell(sceneByKey('Keys'), 'blue', 'shoot').emit('pointerdown');
        step(8);
        pressKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        step(8);
        return {
          pass: CONFIG.CONTROLS.blue.shoot === 'PLUS'
            && !sceneByKey('Keys').capturing
            && window.game.scene.isActive('Keys'),
          detail: 'still on the screen ' + window.game.scene.isActive('Keys')
            + ', shoot ' + CONFIG.CONTROLS.blue.shoot,
        };
      });
    });
    check('reset puts every key back', () => {
      return withKeysScreen(() => {
        keyCell(sceneByKey('Keys'), 'red', 'up').emit('pointerdown');
        step(8);
        pressKey(Phaser.Input.Keyboard.KeyCodes.T);
        step(8);
        sceneByKey('Keys').resetAll();
        step(8);
        const wrong = [];
        Object.keys(DEFAULT_CONTROLS).forEach((team) => {
          ACTIONS.forEach((a) => {
            if (CONFIG.CONTROLS[team][a.key] !== DEFAULT_CONTROLS[team][a.key]) {
              wrong.push(team + ' ' + a.key);
            }
          });
        });
        return { pass: wrong.length === 0, detail: wrong.join(', ') || 'all back to the originals' };
      });
    });
    check('a rebound key really is the one that moves the player', () => {
      // The whole point. Everything above is bookkeeping until the match reads it.
      const before = CONFIG.CONTROLS.red.right;
      CONFIG.CONTROLS.red.right = 'T';
      const g = startMatch('two');
      const startX = g.red.sprite.x;
      g.keys.red.T.isDown = true;
      step(20);
      const movedOnNew = g.red.sprite.x - startX;
      g.keys.red.T.isDown = false;
      CONFIG.CONTROLS.red.right = before;
      return {
        pass: movedOnNew > 20,
        detail: 'moved ' + Math.round(movedOnNew) + 'px on the rebound key',
      };
    });
    check('keys changed during a pause are live again on resume', () => {
      // Settings is reachable from a paused match, so the bindings a match started with
      // are not necessarily the ones it should finish with.
      const before = CONFIG.CONTROLS.red.right;
      const g = startMatch('two');
      g.togglePause();
      step(2);
      CONFIG.CONTROLS.red.right = 'T';
      g.openSettings();
      step(4);
      sceneByKey('Settings').leave();
      step(6);
      const back = sceneByKey('Game');
      const bound = !!(back.keys.red.T);
      CONFIG.CONTROLS.red.right = before;
      back.rebindKeys();
      return { pass: bound, detail: 'match knows the new key: ' + bound };
    });

    group('sound');

    check('the whistle makes a noise, and then stops making it', () => {
      // Rendered through the same graph the game plays, so this is the actual sound.
      const pcm = heard.whistle;
      if (!pcm) return { pass: false, detail: 'nothing rendered' };
      const blast = peak(slice(pcm, 0, 0.5));
      const after = peak(slice(pcm, 0.75, 1));
      return {
        pass: blast > 0.05 && after < blast * 0.05,
        detail: 'peaks at ' + blast.toFixed(2) + ' and is down to '
          + after.toFixed(4) + ' by the end',
      };
    });
    check('the whistle warbles rather than ringing like an alarm', () => {
      /*
       * A pea whistle is two tones a few dozen hertz apart beating against each other.
       * These were written down a fourth apart, which is not a beat, it is a chord: two
       * clean sine tones sounding at once, up in the most piercing part of hearing, and it
       * rang in the ears long after it stopped. A chord holds still; a beat does not.
       */
      const pcm = heard.whistle;
      if (!pcm) return { pass: false, detail: 'nothing rendered' };
      const moved = ripple(pcm, 0.06, 0.31, 45);
      const apart = Math.abs(Sound.MIX.whistle.tones[0] - Sound.MIX.whistle.tones[1]);
      return {
        pass: moved > 0.2,
        detail: 'tones ' + apart + 'Hz apart, and the blast moves ' + moved.toFixed(2)
          + ' of its own level from one moment to the next',
      };
    });
    check('the groan slides down and the cheer slides up', () => {
      /*
       * The one thing that makes disappointment sound like disappointment rather than like
       * a cheer played backwards, so it is worth checking rather than assuming. Counted as
       * zero crossings, which rise and fall with the band the noise is filtered to, and
       * read at the floor on the cheer so the applause scattered over it is not what is
       * being counted.
       */
      const groan = heard.groan;
      const cheer = heard.cheer;
      if (!groan || !cheer) return { pass: false, detail: 'nothing rendered' };
      const groanFrom = crossings(slice(groan, 0.1, 0.3));
      const groanTo = crossings(slice(groan, 0.55, 0.75));
      const cheerFrom = floorCrossings(cheer, 0.02, 0.12, 5);
      const cheerTo = floorCrossings(cheer, 0.25, 0.4, 5);
      return {
        pass: groanTo < groanFrom && cheerTo > cheerFrom,
        detail: 'groan ' + groanFrom.toFixed(3) + ' down to ' + groanTo.toFixed(3)
          + ', cheer ' + cheerFrom.toFixed(3) + ' up to ' + cheerTo.toFixed(3),
      };
    });
    check('muted is silence, not quiet', () => {
      const pcm = heard.muted;
      if (!pcm) return { pass: false, detail: 'nothing rendered' };
      return { pass: peak(pcm) === 0, detail: 'peak ' + peak(pcm) };
    });
    check('the volume setting is on the way out to the speakers', () => {
      /*
       * Half the steps is not half the loudness: the bar is curved, and this is the curve.
       *
       * Read off two separate renderings of a groan, and a groan is mostly noise, which is
       * fresh every time: eight pairs measured 0.277 to 0.309 against a curve that says
       * 0.287. So this allows a good deal more than it would like to. It is still nowhere
       * near enough to let a straight bar through, which would come out at 0.5.
       */
      const loud = rms(heard.groan || new Float32Array(1));
      const half = rms(heard.halfGroan || new Float32Array(1));
      const want = Math.pow(0.5, Sound.CURVE);
      const got = loud > 0 ? half / loud : 0;
      return {
        pass: Math.abs(got - want) < 0.045,
        detail: 'half the bar came out at ' + got.toFixed(3) + ' of full, the curve says '
          + want.toFixed(3),
      };
    });
    check('a smaller ground cheers smaller', () => {
      const full = heard.cheer;
      const few = heard.smallCheer;
      if (!full || !few) return { pass: false, detail: 'nothing rendered' };
      // Where it last rises above a twentieth of its peak is where the noise has finished.
      const endOf = (pcm) => {
        const quiet = peak(pcm) / 20;
        for (let i = pcm.length - 1; i > 0; i -= 1) if (Math.abs(pcm[i]) > quiet) return i;
        return 0;
      };
      const rate = 44100;
      return {
        pass: peak(few) < peak(full) && endOf(few) < endOf(full),
        detail: 'a full house peaks ' + peak(full).toFixed(2) + ' for '
          + (endOf(full) / rate).toFixed(1) + 's, a dozen of them ' + peak(few).toFixed(2)
          + ' for ' + (endOf(few) / rate).toFixed(1) + 's',
      };
    });
    check('every mis-hit has a noise, and nothing else does', () => {
      /*
       * The crowd reacts to all of them, so an outcome added to the drunk table without a
       * groan beside it would be met with silence, which reads as the sound being broken
       * rather than as a gap in a table.
       */
      const table = CONFIG.DRUNK.TABLE.map((row) => row.key).filter((key) => key !== 'intended');
      const noises = Object.keys(Sound.GROANS);
      const missing = table.filter((key) => !(key in Sound.GROANS));
      const extra = noises.filter((key) => table.indexOf(key) === -1);
      const sizes = new Set(table.map((key) => Sound.GROANS[key])).size;
      return {
        pass: missing.length === 0 && extra.length === 0 && sizes > 1
          && Sound.GROANS.fumble === 1 && Sound.GROANS.wrongFoot < Sound.GROANS.fumble,
        detail: missing.length || extra.length
          ? 'missing ' + missing.join(',') + ', spare ' + extra.join(',')
          : table.length + ' mis-hits, graded into ' + sizes + ' sizes of groan',
      };
    });
    check('two mistakes in a moment are one groan', () => {
      // Possession can go twice in a second, and two crowds on top of each other is a
      // noise rather than a crowd.
      if (!window.OfflineAudioContext) return { pass: false, detail: 'no offline audio' };
      const wasStep = Sound.step;
      Sound.step = Sound.STEPS;
      Sound.attach(new window.OfflineAudioContext(1, 44100, 44100));
      const first = Sound.groan(1);
      const second = Sound.groan(1);
      Sound.step = wasStep;
      Sound.ctx = null;
      Sound.master = null;
      return {
        pass: !!first && second === null,
        detail: first ? 'the first played and the second was dropped' : 'the first was dropped',
      };
    });
    check('the volume is remembered, and rubbish in storage is not', () => {
      const stored = window.localStorage.getItem(Sound.STORAGE_KEY);
      const was = Sound.step;
      Sound.setStep(3);
      Sound.load();
      const remembered = Sound.step;
      window.localStorage.setItem(Sound.STORAGE_KEY, 'nine hundred');
      Sound.load();
      const fallback = Sound.step;
      Sound.step = was;
      if (stored === null) window.localStorage.removeItem(Sound.STORAGE_KEY);
      else window.localStorage.setItem(Sound.STORAGE_KEY, stored);
      return {
        pass: remembered === 3 && fallback === Sound.DEFAULT_STEP,
        detail: 'saved 3 and read back ' + remembered + ', junk read back as ' + fallback,
      };
    });
    check('the bar goes all the way up and round to silence', () => {
      const stored = window.localStorage.getItem(Sound.STORAGE_KEY);
      const was = Sound.step;
      Sound.setStep(Sound.STEPS - 1);
      const up = Sound.nextStep();
      const round = Sound.nextStep();
      const clampHigh = Sound.setStep(99);
      const clampLow = Sound.setStep(-5);
      Sound.setStep(was);
      if (stored === null) window.localStorage.removeItem(Sound.STORAGE_KEY);
      else window.localStorage.setItem(Sound.STORAGE_KEY, stored);
      return {
        pass: up === Sound.STEPS && round === 0 && clampHigh === Sound.STEPS && clampLow === 0,
        detail: 'the top is ' + up + ', one more is ' + round + ', and 99 and -5 land on '
          + clampHigh + ' and ' + clampLow,
      };
    });
    check('the bar on screen has a block for every step', () => withScene('Settings', (scene) => {
      const blocks = scene.children.list.filter((o) => o.texture && o.texture.key === 'px'
        && o.input && Math.abs(o.displayWidth - Renderer.VOLUME_BAR.block) < 0.6);
      const lit = blocks.filter((b) => b.displayHeight > Renderer.VOLUME_BAR.height * 0.9).length;
      return {
        pass: blocks.length === Sound.STEPS && lit === Sound.step,
        detail: blocks.length + ' blocks, ' + lit + ' lit for a setting of ' + Sound.step,
      };
    }));
    check('the bar has the row to itself', () => withScene('Settings', (scene) => {
      // It lives between the label and the blurb, which is the one place on that screen
      // with no words in it. A wider label or an earlier blurb would sit under it.
      const B = Renderer.VOLUME_BAR;
      const barX = Renderer.volumeBarX();
      const bar = {
        left: barX - B.block / 2,
        right: barX + (Sound.STEPS - 1) * (B.block + B.gap) + B.block / 2,
        top: -B.height / 2,
        bottom: B.height / 2,
      };
      const label = scene.children.list.find((o) => o.text && /VOLUME/.test(o.text));
      if (!label) return { pass: false, detail: 'no volume row' };
      const onThisRow = textsOf(scene).filter((t) => Math.abs(t.y - label.y) < 14);
      const clashes = onThisRow.filter((t) => {
        const b = boundsOf(t);
        return b.right > bar.left && b.left < bar.right;
      }).map((t) => t.text);
      return {
        pass: clashes.length === 0 && onThisRow.length >= 2,
        detail: clashes.join(', ') || 'clear of ' + onThisRow.length + ' pieces of text',
      };
    }));

    group('hands');

    check('a player runs with two of them, one either side', () => {
      const g = startMatch('two');
      const missing = g.players.filter((p) => !p.sprite.hands || p.sprite.hands.length !== 2);
      const sides = g.red.sprite.hands.map((h) => h.side).join(',');
      const apart = g.red.sprite.hands.length === 2
        ? Math.round(Phaser.Math.Distance.BetweenPoints(
          g.red.sprite.hands[0], g.red.sprite.hands[1])) : 0;
      return {
        pass: missing.length === 0 && sides === '-1,1' && apart > CONFIG.PLAYER.radius,
        detail: missing.length ? missing.length + ' of them empty handed'
          : 'sides ' + sides + ', held ' + apart + 'px apart',
      };
    });
    check('they are carried about with him, and swing when he runs', () => {
      /*
       * The hands are their own sprites rather than part of the body, which is what lets
       * them swing: so the thing worth checking is that they still go where he goes.
       */
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      g.red.sprite.body.reset(P.centreX - 300, P.centreY + 100);
      g.red.facing = 0;
      step(2);
      const near = g.red.sprite.hands.map((h) => Math.round(
        Phaser.Math.Distance.Between(h.x, h.y, g.red.sprite.x, g.red.sprite.y)));
      // And that they move on him while he runs, rather than being painted on: read as
      // the offset from his middle, so his own travel is out of it.
      const offsets = [];
      for (let i = 0; i < 24; i += 1) {
        g.red.sprite.body.setVelocity(CONFIG.PLAYER.speed, 0);
        step(1);
        offsets.push(g.red.sprite.hands[0].x - g.red.sprite.x);
      }
      const swing = Math.max(...offsets) - Math.min(...offsets);
      return {
        pass: near.every((d) => d > 0 && d < CONFIG.PLAYER.radius * 2) && swing > 1,
        detail: 'held ' + near.join(' and ') + 'px off him, and swinging '
          + swing.toFixed(1) + 'px fore and aft as he runs',
      };
    });
    check('the keeper is a circle with a pair of them, and still blocks a slab', () => {
      /*
       * He is drawn wider than he blocks, on purpose: the gloves stick out past the body
       * every save rate in this game was measured against. What must not happen is the
       * body quietly taking the texture's size instead.
       */
      const g = startMatch('two');
      const keeper = g.keepers[0].sprite;
      const K = Renderer.KEEPER_ART;
      const body = keeper.body;
      return {
        pass: body.width === CONFIG.KEEPER.width && body.height === CONFIG.KEEPER.height
          && keeper.displayWidth === K.radius * 2,
        detail: 'drawn ' + keeper.displayWidth + 'x' + keeper.displayHeight
          + ', blocking ' + body.width + 'x' + body.height,
      };
    });
    check('a new match gets new hands', () => {
      // The same trap as the referee: a scene handed back by Phaser is the same object,
      // and hands left hanging off it point at sprites that were destroyed with it.
      const first = startMatch('two').red.sprite.hands;
      const second = startMatch('two').red.sprite.hands;
      return {
        pass: !!second && second !== first && second.every((h) => h.active)
          && first.every((h) => !h.active),
        detail: second === first ? 'the same pair twice'
          : 'the old pair is destroyed and the new one is live',
      };
    });

    group('the crowd');

    check('they all go up when somebody scores', () => {
      /*
       * A goal is the one moment the crowd is worth looking at. From directly above a jump
       * is a supporter getting bigger and smaller again, which is also the only thing about
       * them nothing else is using: the sway has their x and a trip to the bar has both.
       */
      const g = startMatch('two');
      const fans = g.children.list.filter((o) => o.texture && o.texture.key === 'fan');
      const seated = fans.map((f) => f.scaleX);
      const jumped = Renderer.crowdCelebrate(g);
      const jumping = fans.filter((f) => g.tweens.getTweensOf(f).length > 1);
      return {
        pass: fans.length > 0 && jumped === fans.length && jumping.length === fans.length
          && seated.every((sc) => sc > 0),
        detail: jumped + ' of ' + fans.length + ' up, and ' + jumping.length
          + ' of them with a jump on top of their sway',
      };
    });
    check('and they come back down again', () => {
      // A jump left half finished by the next goal would leave somebody stuck at the top
      // of it for the rest of the match.
      const g = startMatch('two');
      const fan = g.children.list.find((o) => o.texture && o.texture.key === 'fan');
      const seated = fan.scaleX;
      Renderer.crowdCelebrate(g);
      const jump = g.tweens.getTweensOf(fan).find((t) => t !== fan.swayTween);
      if (jump) jump.complete();
      return {
        pass: !!jump && Math.abs(fan.scaleX - seated) < 1e-6,
        detail: !jump ? 'nobody jumped' : 'back to ' + fan.scaleX.toFixed(3)
          + ' from a seat at ' + seated.toFixed(3),
      };
    });
    check('a goal sets them off', () => {
      const g = startMatch('two');
      const was = Renderer.crowdCelebrate;
      let cheered = 0;
      Renderer.crowdCelebrate = () => { cheered += 1; return 0; };
      try {
        g.scoreGoal('red', g.time.now);
      } finally {
        Renderer.crowdCelebrate = was;
      }
      return { pass: cheered === 1, detail: cheered + ' celebrations for one goal' };
    });

    group('the referee');

    check('he stands off the pitch, and on the screen', () => {
      const g = startMatch('two');
      const ref = g.referee;
      if (!ref) return { pass: false, detail: 'there is no referee' };
      const b = boundsOf(ref);
      const P = CONFIG.PITCH;
      const onPitch = overlaps(b, { left: P.left, right: P.right, top: P.top, bottom: P.bottom }, 0);
      const offScreen = b.left < 0 || b.top < 0
        || b.right > CONFIG.CANVAS.width || b.bottom > CONFIG.CANVAS.height;
      return {
        pass: !onPitch && !offScreen,
        detail: onPitch ? 'standing on the pitch' : (offScreen ? 'off the screen'
          : 'at ' + Math.round(ref.x) + ',' + Math.round(ref.y) + ', '
            + Math.round(P.top - b.bottom) + 'px off the near touchline'),
      };
    });
    check('he is in black and white stripes, which nobody else is wearing', () => {
      /*
       * Read straight off the baked texture, a row at a time through the middle of him: a
       * fill that quietly stopped being stripes would still be a circle of the right size
       * in the right place, and nothing else would notice.
       */
      const outer = Renderer.refereeOuter();
      const row = [];
      for (let x = 0; x < outer * 2; x += 1) {
        const c = window.game.textures.getPixel(x, outer, 'referee');
        if (c && c.alpha > 0) row.push((c.red + c.green + c.blue) / 3 > 128 ? 'W' : 'B');
      }
      const changes = row.filter((shade, i) => i > 0 && shade !== row[i - 1]).length;
      const white = row.filter((shade) => shade === 'W').length;
      // And the ring: whatever the stripes are doing, both edges of him are white.
      const ringed = row[0] === 'W' && row[row.length - 1] === 'W';
      return {
        pass: changes >= 4 && white > 3 && white < row.length - 3 && ringed,
        detail: row.join('') + ', ' + changes + ' changes across him'
          + (ringed ? ' inside a white ring' : ' and no ring'),
      };
    });
    check('he keeps out of everything the HUD writes', () => {
      const g = startMatch('bot');
      const clashes = textsOf(g).filter((t) => overlaps(boundsOf(g.referee), boundsOf(t), 0))
        .map((t) => t.text);
      return { pass: clashes.length === 0, detail: clashes.join(', ') || 'clear of the lot' };
    });
    check('a new match gets a new referee', () => {
      /*
       * Phaser hands a restarted scene the same object it gave the last one, so anything
       * parked on a scene outlives the sprites it points at. This has bitten twice.
       */
      const first = startMatch('two').referee;
      const second = startMatch('two').referee;
      return {
        pass: !!second && second !== first && second.active && !first.active,
        detail: second === first ? 'the same sprite twice'
          : 'the old one is destroyed and the new one is live',
      };
    });
    check('he blows it on GO, and not on three, two or one', () => {
      const g = startMatch('two');
      const was = Sound.whistle;
      let blown = 0;
      Sound.whistle = () => { blown += 1; return null; };
      try {
        [3, 2, 1, 0].forEach((n) => Renderer.onKickoffCount(g, n));
      } finally {
        Sound.whistle = was;
      }
      return { pass: blown === 1, detail: blown + ' blast across the whole countdown' };
    });
    check('the whistle goes even with the countdown switched off', () => {
      // That setting is about what you see. Turning the numbers off should not take the
      // referee with them.
      const g = startMatch('two');
      const wasJuice = Renderer.JUICE.kickoffCountdown.on;
      const was = Sound.whistle;
      let blown = 0;
      Sound.whistle = () => { blown += 1; return null; };
      Renderer.JUICE.kickoffCountdown.on = false;
      try {
        Renderer.onKickoffCount(g, 0);
      } finally {
        Renderer.JUICE.kickoffCountdown.on = wasJuice;
        Sound.whistle = was;
      }
      return { pass: blown === 1, detail: blown + ' blast with the countdown off' };
    });

    group('the tunnel');

    /* The hole as a box, which is what everything here wants to compare against. */
    function tunnelBox(tunnel) {
      return {
        left: tunnel.x - tunnel.width / 2,
        right: tunnel.x + tunnel.width / 2,
        top: Math.min(tunnel.mouth, tunnel.back),
        bottom: Math.max(tunnel.mouth, tunnel.back),
      };
    }

    /* A match caught in the act of starting, with the teams still in the wall. */
    function startMatchSlowly(mode) {
      onlyScene('Game');
      sceneByKey('Menu').scene.start('Game', { mode: mode || 'two', difficulty: 'medium' });
      step(3);
      return sceneByKey('Game');
    }

    check('every ground with a stand has a way out onto the pitch', () => {
      const was = Renderer.currentStadium;
      const got = Renderer.STADIUMS.map((S) => S.key + ' '
        + (Renderer.tunnel(S) ? 'has one' : 'has none'));
      const wrong = Renderer.STADIUMS.filter((S) => !!Renderer.tunnel(S) !== !!S.structure);
      Renderer.currentStadium = was;
      return {
        pass: wrong.length === 0,
        detail: wrong.length ? wrong.map((S) => S.key).join(', ') + ' the wrong way round'
          : got.join(', '),
      };
    });
    check('it is cut through the near stand, front to back', () => {
      /*
       * A tunnel that stops short of the back wall is a cupboard, and one that stops short
       * of the front is a hole in the roof. It runs the full depth of the stand or it is
       * not a tunnel.
       */
      const S = Renderer.STADIUMS.find((st) => st.key === 'large');
      const near = Renderer.standRows(S)[0];
      const t = Renderer.tunnel(S);
      return {
        pass: !!t && t.mouth === near.rail && t.back === near.back
          && t.width === Renderer.TUNNEL.width,
        detail: t ? t.width + 'px wide, from ' + t.mouth + ' back to ' + t.back
          + ', in a stand that runs ' + near.rail + ' to ' + near.back : 'no tunnel',
      };
    });
    check('it comes out on the halfway line, in the gap between the blocks', () => {
      /*
       * Where a tunnel belongs, and the one stretch of that stand with nothing in it: the
       * seating already parts there to leave the score and the clock a clear run. So the
       * mouth is on the centre line and it costs nobody their seat.
       */
      const P = CONFIG.PITCH;
      const S = Renderer.STADIUMS.find((st) => st.key === 'large');
      const near = Renderer.standRows(S)[0];
      const t = Renderer.tunnel(S);
      const offCentre = Math.abs(t.x - P.centreX);
      const inABlock = near.bands.some((band) => t.x + t.width / 2 > band[0]
        && t.x - t.width / 2 < band[1]);
      return {
        pass: offCentre < 0.5 && !inABlock,
        detail: inABlock ? 'cut through a block of seats'
          : Math.round(offCentre) + 'px off the centre line, between blocks that stop at '
            + Math.round(near.bands[0][1]) + ' and start again at '
            + Math.round(near.bands[1][0]),
      };
    });
    check('nothing is drawn across the mouth', () => {
      /*
       * The stand has a lip along its front and a rail in front of that, and both of them
       * ran the full width of the ground before there was a tunnel to come out of. Either
       * one left whole is a bar across the mouth. Read in the order things are drawn,
       * because the brickwork underneath is painted over by the hole itself.
       */
      const S = Renderer.STADIUMS.find((st) => st.key === 'large');
      const mat = Renderer.MATERIALS[S.material];
      const sides = Renderer.standRows(S);
      const t = Renderer.tunnel(S);
      const box = tunnelBox(t);
      const rec = recorder();
      sides.forEach((side) => Renderer.drawStand(rec, side, S, mat));
      Renderer.drawRail(rec, sides, S, mat);

      const hole = rec.fills.find((f) => Math.abs(f.x - box.left) < 0.01
        && Math.abs(f.w - t.width) < 0.01);
      const barred = rec.lines.filter((l) => hole && l.seq > hole.seq
        && Math.min(l.x1, l.x2) < box.right - 1 && Math.max(l.x1, l.x2) > box.left + 1
        && Math.min(l.y1, l.y2) <= box.bottom && Math.max(l.y1, l.y2) >= box.top);
      // And the lip and the rail still exist either side of it, rather than being dropped.
      const atMouth = rec.lines.filter((l) => Math.abs(l.y1 - t.mouth) < 0.01
        && Math.abs(l.y2 - t.mouth) < 0.01);
      return {
        pass: !!hole && barred.length === 0 && atMouth.length === 4,
        detail: !hole ? 'the hole itself was never drawn'
          : barred.length ? barred.length + ' strokes across the mouth'
            : atMouth.length + ' runs of lip and rail, none of them across the mouth',
      };
    });
    check('no seat is bolted into it', () => {
      const room = Math.max(Renderer.SEATS.width, Renderer.SEATS.height) / 2;
      const bad = [];
      Renderer.STADIUMS.filter((S) => S.structure).forEach((S) => {
        const box = tunnelBox(Renderer.tunnel(S));
        Renderer.seatPlaces(S).forEach((place) => {
          if (overlaps({ left: place.seat.x - room, right: place.seat.x + room,
            top: place.seat.y - room, bottom: place.seat.y + room }, box, 0)) {
            bad.push(S.key + ' at ' + Math.round(place.seat.x));
          }
        });
      });
      return {
        pass: bad.length === 0,
        detail: bad.slice(0, 3).join(', ') || 'all three grounds part around it',
      };
    });
    check('nobody is stood in it either', () => {
      // The seats are laid on a grid and the people are shaken off that grid, so a seat
      // clear of the mouth is not the same as a supporter clear of it.
      const g = startMatch('two');
      const t = Renderer.tunnel();
      const box = t ? tunnelBox(t) : null;
      const inIt = !t ? [] : g.children.list
        .filter((o) => o.texture && o.texture.key === 'fan')
        .filter((fan) => overlaps(boundsOf(fan), box, 0));
      return {
        pass: !!t && inIt.length === 0,
        detail: !t ? 'no tunnel on this ground'
          : inIt.length ? inIt.length + ' of them in the way'
            : 'the mouth is clear',
      };
    });
    check('the referee stands a stride off it, not in the doorway', () => {
      /*
       * The mouth is on the halfway line and both teams walk out through it, so he stands
       * beside it rather than in it. Near enough to the centre line to read as standing on
       * it, which is the point of him: a fifteenth of the pitch, on a pitch twelve times
       * wider than he is.
       */
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const t = Renderer.tunnel();
      const box = t ? tunnelBox(t) : null;
      const b = boundsOf(g.referee);
      const offCentre = Math.abs(g.referee.x - P.centreX);
      const gap = t ? b.left - box.right : 0;
      return {
        pass: !!t && !overlaps(b, box, 0) && gap > CONFIG.PLAYER.radius
          && offCentre < P.width / 12,
        detail: !t ? 'no tunnel on this ground'
          : overlaps(b, box, 0) ? 'stood in the mouth'
            : Math.round(offCentre) + 'px off the halfway line and ' + Math.round(gap)
              + 'px clear of the mouth',
      };
    });
    check('the teams walk out of it before the first kickoff', () => {
      const g = startMatchSlowly('two');
      const t = Renderer.tunnel();
      const box = t ? tunnelBox(t) : null;
      const inWall = !t ? [] : g.players.filter((p) => p.sprite.x > box.left
        && p.sprite.x < box.right && p.sprite.y < CONFIG.PITCH.top);
      const solid = g.players.filter((p) => p.sprite.body.enable);
      return {
        pass: g.state.phase === 'entrance' && inWall.length === 2 && solid.length === 0,
        detail: 'phase ' + g.state.phase + ', ' + inWall.length
          + ' of them in the tunnel, ' + solid.length + ' with a body switched on',
      };
    });
    check('and are stood on their marks by the time the count starts', () => {
      /*
       * The walk is scenery. Where it puts them has to be exactly where the kickoff would
       * have put them anyway, or the ceremony has moved the kickoff.
       */
      const g = startMatchSlowly('two');
      let guard = 0;
      while (g.state.phase === 'entrance' && guard++ < 400) step(1);
      const marks = g.players.map((p) => ({ x: p.sprite.x, y: p.sprite.y }));
      g.resetPositions();
      const drift = g.players.map((p, i) => Math.round(Math.max(
        Math.abs(p.sprite.x - marks[i].x), Math.abs(p.sprite.y - marks[i].y))));
      const solid = g.players.filter((p) => p.sprite.body.enable).length;
      return {
        pass: g.state.phase === 'kickoff' && drift.every((d) => d === 0) && solid === 2
          && g.state.entrance === null,
        detail: 'phase ' + g.state.phase + ' after ' + guard + ' frames, off their marks by '
          + drift.join(' and ') + 'px, ' + solid + ' of them solid again',
      };
    });
    check('the walk is counted in frames, not off the clock', () => {
      /*
       * A scene's clock reads whatever it read the last time that scene ran, and on the
       * frame create() runs that can be a long way in the past. Timed against it, the walk
       * was over before it began on any tab that had been left in the background for a
       * minute, which is exactly how this was found.
       */
      const g = startMatchSlowly('two');
      const before = g.state.entrance.elapsed;
      step(6);
      const moved = g.state.entrance.elapsed - before;
      const expected = 6 * (1000 / 60);
      return {
        pass: g.state.phase === 'entrance' && Math.abs(moved - expected) < expected * 0.3,
        detail: 'six frames moved the walk on by ' + Math.round(moved) + 'ms of '
          + Math.round(expected),
      };
    });
    check('and they can be seen when they get there', () => {
      /*
       * They come up out of the dark on the way out, and a fade left half finished is a
       * player nobody can see. However the walk ends, it ends with both of them visible.
       */
      const g = startMatchSlowly('two');
      let guard = 0;
      while (g.state.phase === 'entrance' && guard++ < 400) step(1);
      const alphas = g.players.map((p) => p.sprite.alpha);
      return {
        pass: alphas.every((a) => a === 1),
        detail: 'they arrive at alpha ' + alphas.map((a) => a.toFixed(2)).join(' and '),
      };
    });
    check('nobody has the ball while they are walking out', () => {
      const g = startMatchSlowly('two');
      const P = CONFIG.PITCH;
      const onSpot = Math.abs(g.ball.x - P.centreX) < 0.5 && Math.abs(g.ball.y - P.centreY) < 0.5;
      return {
        pass: g.state.owner === null && onSpot,
        detail: (g.state.owner ? 'somebody has it' : 'nobody has it') + ', and it is '
          + (onSpot ? 'on the spot' : 'at ' + Math.round(g.ball.x) + ',' + Math.round(g.ball.y)),
      };
    });
    check('they come out once a match, not once a goal', () => {
      // A walk out after every goal would be four seconds of walking for every thirty of
      // football.
      const g = startMatch('two');
      g.scoreGoal('red', g.time.now);
      let guard = 0;
      while (g.state.phase === 'goal' && guard++ < 200) step(1);
      return {
        pass: g.state.phase === 'kickoff' && g.state.entrance === null,
        detail: 'the restart went straight to ' + g.state.phase,
      };
    });
    check('a ground with no tunnel gets straight on with it', () => {
      // Sunday league is a rail and some grass. There is nothing to come out of, so
      // nobody comes out of it.
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const g = startMatchSlowly('two');
      const phase = g.state.phase;
      const tunnel = Renderer.tunnel();
      Renderer.applySkin(wasSkin);
      return {
        pass: !tunnel && phase === 'kickoff',
        detail: (tunnel ? 'it grew a tunnel, ' : 'no tunnel, ') + 'and it opened on ' + phase,
      };
    });

    group('the ground');

    check('the pitch has grass on it, not just paint', () => {
      /*
       * Two shades of green in ten bands is mowing, not grass. The blades are what make it
       * a pitch: short strokes, half lighter than the band they stand in and half darker,
       * and every one of them inside the touchline.
       */
      const P = CONFIG.PITCH;
      const rec = recorder();
      Renderer.drawGrass(rec);
      const off = rec.lines.filter((l) => Math.min(l.x1, l.x2) < P.left
        || Math.max(l.x1, l.x2) > P.right || Math.min(l.y1, l.y2) < P.top
        || Math.max(l.y1, l.y2) > P.bottom);
      // Two base greens, each drawn a shade up and a shade down: four in all, and the
      // bands alternate between them.
      const shades = new Set(rec.lines.map((l) => l.colour));
      return {
        pass: rec.lines.length > 500 && off.length === 0 && shades.size === 4,
        detail: rec.lines.length + ' blades in ' + shades.size + ' shades, '
          + off.length + ' of them growing off the pitch',
      };
    });
    check('snow lies on the frozen pitch, and on no other', () => {
      const P = CONFIG.PITCH;
      const rec = recorder();
      Renderer.drawLyingSnow(rec);
      const spilling = rec.circles.filter((c) => c.x - c.radius < P.left - 0.01
        || c.x + c.radius > P.right + 0.01 || c.y - c.radius < P.top - 0.01
        || c.y + c.radius > P.bottom + 0.01);
      const snowy = Renderer.SKINS.filter((sk) => sk.snowy).map((sk) => sk.key);
      return {
        pass: rec.circles.length >= Renderer.LYING_SNOW.patches && spilling.length === 0
          && snowy.join(',') === 'frozen',
        detail: rec.circles.length + ' blobs of snow, ' + spilling.length
          + ' over the line, lying on ' + (snowy.join(',') || 'nothing'),
      };
    });
    check('only a park pitch wears', () => {
      // Every other ground is the same at full time as it was at kickoff.
      const wears = Object.keys(CONFIG.SURFACES).filter((k) => CONFIG.SURFACES[k].wears);
      const sunday = CONFIG.SURFACE_BY_SKIN.sunday;
      return {
        pass: wears.join(',') === 'mud' && sunday === 'mud',
        detail: 'wearing surfaces: ' + (wears.join(',') || 'none') + ', and sunday league '
          + 'is played on ' + sunday,
      };
    });
    check('the ground gives way where the ball is kicked', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const spot = { x: P.centreX + 160, y: P.centreY - 80 };
      const far = { x: P.left + 60, y: P.bottom - 60 };
      const before = g.wearAt(spot.x, spot.y);
      for (let i = 0; i < 3; i += 1) g.tearPitch(spot.x, spot.y);
      const after = g.wearAt(spot.x, spot.y);
      const elsewhere = g.wearAt(far.x, far.y);
      Renderer.applySkin(wasSkin);
      return {
        pass: !!g.wear && before === 0 && after > before && elsewhere === 0,
        detail: !g.wear ? 'the pitch does not wear at all'
          : 'three kicks took it from ' + before.toFixed(2) + ' to ' + after.toFixed(2)
            + ', and the far corner is still ' + elsewhere.toFixed(2),
      };
    });
    check('running over it wears it as well as kicking it', () => {
      /*
       * Most of what kills a park pitch is not the kicking, it is a whole afternoon of
       * being run over. Measured off where he actually ends up, so being shoved about by
       * a collision counts the same as running does.
       */
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const lane = P.centreY + 120;
      g.red.sprite.body.reset(P.left + 100, lane);
      g.red.trodX = P.left + 100;
      g.red.trodY = lane;
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      /*
       * Driven at the body rather than through the keys: the match reads the keyboard at
       * the top of every frame and would wipe a faked press before it ever moved him. The
       * velocity set here is the one the next physics step uses, which is the same one a
       * key held down would have produced.
       */
      for (let i = 0; i < 90; i += 1) {
        g.red.sprite.body.setVelocity(CONFIG.PLAYER.speed, 0);
        step(1);
      }
      const behind = g.wearAt(P.left + 140, lane);
      const ahead = g.wearAt(g.red.sprite.x + 200, lane);
      const ran = Math.round(g.red.sprite.x - (P.left + 100));
      Renderer.applySkin(wasSkin);
      return {
        pass: behind > 0 && ahead === 0,
        detail: 'ran ' + ran + 'px, leaving the ground behind him at ' + behind.toFixed(2)
          + ' and the ground in front of him at ' + ahead.toFixed(2),
      };
    });
    check('a stride costs less than a kick, and is not drawn as often', () => {
      // A divot per stride is a pitch buried by half time and a few thousand strokes to
      // draw every frame after it.
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      const g = startMatch('two');
      const was = Renderer.onPitchWear;
      let drawn = 0;
      Renderer.onPitchWear = () => { drawn += 1; };
      let strides = 0;
      try {
        for (let i = 0; i < 10; i += 1) {
          g.tearPitch(P.centreX - 200, P.centreY + 200, CONFIG.WEAR.perStride);
          strides += 1;
        }
      } finally {
        Renderer.onPitchWear = was;
      }
      Renderer.applySkin(wasSkin);
      return {
        pass: CONFIG.WEAR.perStride < CONFIG.WEAR.perKick && drawn < strides,
        detail: strides + ' strides at ' + CONFIG.WEAR.perStride + ' each against a kick at '
          + CONFIG.WEAR.perKick + ', and the ground was drawn again ' + drawn + ' times',
      };
    });
    check('it churns rather than digging through to Australia', () => {
      // Fifty kicks in the same spot is a bog, and a bog is as bad as it gets.
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      // In the sun: rain has its own say on the drag and this is about the ground.
      const g = matchInWeather('sunny');
      for (let i = 0; i < 50; i += 1) g.tearPitch(P.centreX, P.centreY);
      const worst = g.wearAt(P.centreX, P.centreY);
      g.ball.setPosition(P.centreX, P.centreY);
      const drag = g.ballDragNow();
      const fresh = CONFIG.BALL.drag * g.surface.ballDragScale;
      Renderer.applySkin(wasSkin);
      return {
        pass: worst === 1 && drag === fresh * CONFIG.WEAR.dragScale,
        detail: 'worn to ' + worst.toFixed(2) + ', and the ball drags at ' + Math.round(drag)
          + ' where fresh grass drags at ' + Math.round(fresh),
      };
    });
    check('a ball rolls up short through the churn', () => {
      /*
       * The whole point of the wear: not that it looks bad, but that a pass across the
       * middle of a Sunday League match at full time does not arrive. Rolled twice down
       * the same lane at the same speed, once on grass and once through a bog.
       */
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      // In the sun, so what is being measured is the ground rather than the weather.
      const g = matchInWeather('sunny');
      const lane = P.centreY - 150;
      const from = P.left + 120;
      // Out of the way, and left there: a player who picks the ball up ends the roll.
      g.red.sprite.setPosition(P.centreX, P.bottom - 60);
      g.blue.sprite.setPosition(P.centreX + 200, P.bottom - 60);
      const roll = () => {
        g.setOwner(null);
        g.state.recaptureLockUntil = g.time.now + 99999;
        g.ball.body.reset(from, lane);
        g.ball.body.setVelocity(CONFIG.KICK.passPower, 0);
        let guard = 0;
        while (g.ball.body.speed > 8 && guard++ < 400) step(1);
        return g.ball.x - from;
      };
      const onGrass = roll();
      for (let x = from; x < from + 700; x += CONFIG.WEAR.cellPx) {
        for (let i = 0; i < 5; i += 1) g.tearPitch(x, lane);
      }
      const throughMud = roll();
      Renderer.applySkin(wasSkin);
      return {
        pass: throughMud < onGrass * 0.85,
        detail: Math.round(onGrass) + 'px on fresh grass, ' + Math.round(throughMud)
          + 'px once it is churned',
      };
    });
    check('nothing wears on a proper pitch', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const P = CONFIG.PITCH;
      // In the sun, because rain has its own say on the drag and this is about the ground.
      const g = matchInWeather('sunny');
      const torn = g.tearPitch(P.centreX, P.centreY);
      const drag = g.ballDragNow();
      Renderer.applySkin(wasSkin);
      return {
        pass: g.wear === null && torn === 0 && drag === CONFIG.BALL.drag,
        detail: g.wear ? 'the grass wore out' : 'kicks leave it alone, drag stays at ' + drag,
      };
    });
    check('a new match is played on a fresh pitch', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      const first = startMatch('two');
      for (let i = 0; i < 6; i += 1) first.tearPitch(P.centreX, P.centreY);
      const churned = first.wearAt(P.centreX, P.centreY);
      const second = startMatch('two');
      const afterwards = second.wearAt(P.centreX, P.centreY);
      Renderer.applySkin(wasSkin);
      return {
        pass: churned > 0 && afterwards === 0,
        detail: 'left at ' + churned.toFixed(2) + ', the next match starts at '
          + afterwards.toFixed(2),
      };
    });

    group('weather');

    /* A match played in one particular kind of weather, whatever the odds say. */
    function matchInWeather(kind, mode) {
      const was = CONFIG.WEATHER.chances;
      const forced = {};
      Object.keys(was).forEach((key) => { forced[key] = key === kind ? 1 : 0; });
      CONFIG.WEATHER.chances = forced;
      /*
       * And whatever the skin says: a frozen pitch insists on its own share of snow, which
       * is exactly what would override this. For one match it does not insist.
       */
      const skin = Renderer.SKINS.find((sk) => sk.key === Renderer.activeSkin);
      const insisted = skin && skin.weather;
      if (insisted) delete skin.weather;
      try {
        return startMatch(mode || 'two');
      } finally {
        CONFIG.WEATHER.chances = was;
        if (insisted) skin.weather = insisted;
      }
    }

    check('the odds add up to a hundred, and every one of them does something', () => {
      const C = CONFIG.WEATHER;
      const total = Object.keys(C.chances).reduce((sum, k) => sum + C.chances[k], 0);
      const unhandled = Object.keys(C.chances).filter((k) => !C.EFFECTS[k]);
      const undrawn = Object.keys(C.chances).filter((k) => k !== 'sunny'
        && k !== 'foggy' && !Renderer.FALLING[k]);
      return {
        pass: Math.abs(total - 1) < 1e-9 && unhandled.length === 0 && undrawn.length === 0,
        detail: Object.keys(C.chances).map((k) => k + ' ' + Math.round(C.chances[k] * 100)
          + '%').join(', ') + ', adding to ' + Math.round(total * 100) + '%',
      };
    });
    check('it rolls one of them a match, in the proportions written down', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const rolls = 2000;
      const got = {};
      for (let i = 0; i < rolls; i += 1) {
        const kind = Renderer.rollWeather();
        got[kind] = (got[kind] || 0) + 1;
      }
      Renderer.applySkin(wasSkin);
      const off = Object.keys(CONFIG.WEATHER.chances).filter((k) => Math.abs(
        (got[k] || 0) / rolls - CONFIG.WEATHER.chances[k]) > 0.04);
      return {
        pass: off.length === 0,
        detail: Object.keys(got).map((k) => k + ' ' + Math.round((got[k] / rolls) * 100)
          + '%').join(', ') + ' over ' + rolls + ' matches',
      };
    });
    check('a frozen pitch snows a third of the time whatever the table says', () => {
      /*
       * The skin insists on its own share and the rest of the table divides what is left
       * between them, keeping the proportions it already had.
       */
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('frozen');
      const odds = Renderer.weatherOdds();
      const total = Object.keys(odds).reduce((sum, k) => sum + odds[k], 0);
      const forced = Renderer.SKINS.find((sk) => sk.key === 'frozen').weather.snow;
      let snowed = 0;
      const rolls = 900;
      for (let i = 0; i < rolls; i += 1) if (Renderer.rollWeather() === 'snow') snowed += 1;
      Renderer.applySkin(wasSkin);
      return {
        pass: Math.abs(odds.snow - forced) < 1e-9 && Math.abs(total - 1) < 1e-9
          && Math.abs(snowed / rolls - forced) < 0.05,
        detail: 'snow is ' + Math.round(odds.snow * 100) + '% of a table adding to '
          + Math.round(total * 100) + '%, and it snowed on '
          + Math.round((snowed / rolls) * 100) + '% of ' + rolls + ' matches',
      };
    });
    check('sunshine is the game as it always was', () => {
      // On grass: what the ground is doing is the skin's business, not the sky's.
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const g = matchInWeather('sunny');
      Renderer.applySkin(wasSkin);
      return {
        pass: Object.keys(g.weather).length === 0 && g.wind === null
          && g.ballDragNow() === CONFIG.BALL.drag,
        detail: 'nothing on the ball, and it drags at ' + g.ballDragNow(),
      };
    });
    check('rain skids the ball on and cuts a park pitch up faster', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const P = CONFIG.PITCH;
      const dry = matchInWeather('sunny');
      const dryDrag = dry.ballDragNow();
      dry.tearPitch(P.centreX, P.centreY);
      const dryTear = dry.wearAt(P.centreX, P.centreY);

      const wet = matchInWeather('rainy');
      const wetDrag = wet.ballDragNow();
      wet.tearPitch(P.centreX, P.centreY,
        CONFIG.WEAR.perKick * (wet.weather.wearScale || 1));
      const wetTear = wet.wearAt(P.centreX, P.centreY);
      Renderer.applySkin(wasSkin);
      return {
        pass: wetDrag < dryDrag && wetTear > dryTear,
        detail: 'drag ' + Math.round(dryDrag) + ' dry against ' + Math.round(wetDrag)
          + ' wet, and one kick takes ' + dryTear.toFixed(2) + ' out of it dry against '
          + wetTear.toFixed(2) + ' wet',
      };
    });
    check('wind blows a rolling ball off its line and leaves a still one alone', () => {
      const P = CONFIG.PITCH;
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const g = matchInWeather('windy');
      Renderer.applySkin(wasSkin);
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      g.red.sprite.body.reset(P.left + 80, P.bottom - 60);
      g.blue.sprite.body.reset(P.right - 80, P.bottom - 60);

      // Sat on the spot: a wind that can move this is a wind that scores on its own.
      g.ball.body.reset(P.centreX, P.centreY);
      g.ball.body.setVelocity(0, 0);
      for (let i = 0; i < 30; i += 1) step(1);
      const crept = Math.abs(g.ball.x - P.centreX);

      // Rolling across the wind, which runs along the pitch: it should bend into it.
      g.ball.body.reset(P.centreX, P.top + 60);
      g.ball.body.setVelocity(0, 320);
      for (let i = 0; i < 60; i += 1) step(1);
      const bent = Math.abs(g.ball.x - P.centreX);
      return {
        pass: crept < 1 && bent > 10,
        detail: 'a ball sat still moved ' + crept.toFixed(1) + 'px, and one rolling across '
          + 'the wind bent ' + Math.round(bent) + 'px',
      };
    });
    check('snow deadens the ball, and grips where bare ice would not', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('frozen');
      const bare = matchInWeather('sunny');
      const bareDrag = bare.ballDragNow();
      bare.red.sprite.body.setVelocity(0, 0);
      bare.steer(bare.red.sprite.body, 200, 0);
      const onIce = Math.round(bare.red.sprite.body.velocity.x);

      const snowy = matchInWeather('snow');
      const snowDrag = snowy.ballDragNow();
      snowy.red.sprite.body.setVelocity(0, 0);
      snowy.steer(snowy.red.sprite.body, 200, 0);
      const onSnow = Math.round(snowy.red.sprite.body.velocity.x);
      Renderer.applySkin(wasSkin);
      return {
        pass: snowDrag > bareDrag && onSnow > onIce,
        detail: 'drag ' + Math.round(bareDrag) + ' on bare ice against ' + Math.round(snowDrag)
          + ' under snow, and a shove of 200 gets you ' + onIce + ' on ice, ' + onSnow
          + ' on snow',
      };
    });
    check('fog is between you and the pitch, not on it', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const g = matchInWeather('foggy');
      Renderer.applySkin(wasSkin);
      const parts = g.fog || [];
      const off = parts.filter((o) => !o.active);
      return {
        pass: parts.length > 1 && off.length === 0 && g.wind === null
          && g.ballDragNow() === CONFIG.BALL.drag
          && parts.every((o) => o.depth < Renderer.DEPTH.hud),
        detail: parts.length + ' pieces of fog, all under the HUD, and the ball drags at '
          + g.ballDragNow() + ' as it does in the sun',
      };
    });
    check('the fog is thick enough to be fog and thin enough to play through', () => {
      /*
       * Measured at the worst moment of the cycle — the flat haze at FOG.thick, plus every
       * bank overlapping that spot, composited the way they actually are and each weighted
       * by the softness baked into its own texture rather than counted at full strength
       * across its whole width.
       *
       * The ceiling is deliberately high, because at the thick end of the roll the fog is
       * supposed to be nearly blinding. What it must never do is white out completely:
       * something has to come through everywhere, and the fog has to lift again, which is
       * the next check.
       */
      const F = Renderer.FOG;
      const P = CONFIG.PITCH;
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');

      // How a bank fades from its middle outwards, read off the baked texture.
      const mid = 64;
      const falloff = [];
      for (let i = 0; i <= 20; i += 1) {
        const px = window.game.textures.getPixel(
          mid + Math.round((i / 20) * (mid - 2)), mid, 'fogbank');
        falloff.push(px ? px.alpha / 255 : 0);
      }

      let worst = 0;
      for (let run = 0; run < 4; run += 1) {
        const g = matchInWeather('foggy');
        const banks = (g.fog || []).slice(1);      // [0] is the flat wash over everything
        for (let x = P.left; x <= P.right; x += 40) {
          for (let y = P.top; y <= P.bottom; y += 40) {
            let clear = 1 - F.thick;
            banks.forEach((bank) => {
              const dx = (x - bank.x) / (bank.displayWidth / 2);
              const dy = (y - bank.y) / (bank.displayHeight / 2);
              const out = Math.sqrt(dx * dx + dy * dy);
              if (out <= 1) clear *= 1 - bank.alpha * falloff[Math.round(out * 20)];
            });
            worst = Math.max(worst, 1 - clear);
          }
        }
      }
      Renderer.applySkin(wasSkin);
      return {
        pass: worst > F.thick && worst < 0.92 && falloff[0] > falloff[20],
        detail: 'at its worst the haze is ' + F.thick + ' under ' + F.banks
          + ' banks that fade from ' + falloff[0].toFixed(2) + ' to '
          + falloff[20].toFixed(2) + ', so the thickest point on the pitch is '
          + worst.toFixed(2) + ' of full white, leaving ' + (1 - worst).toFixed(2)
          + ' coming through',
      };
    });
    check('the fog rolls in and lifts again rather than sitting at one thickness', () => {
      /*
       * The point of the roll is that it can be nearly blinding without the match becoming
       * unplayable, because it always clears. So both ends matter: it has to reach thick,
       * and it has to come back to thin.
       *
       * Read off the tween rather than watched, because tweens in this harness advance on
       * real elapsed time and a stepped frame moves them not at all.
       */
      const F = Renderer.FOG;
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('classic');
      const g = matchInWeather('foggy');
      Renderer.applySkin(wasSkin);

      const haze = (g.fog || [])[0];
      const roll = haze && haze.roll;
      const live = !!roll && g.tweens.getTweensOf(haze).length > 0;
      // Both ends of the swing, off the tween's own data.
      const data = roll && roll.data ? roll.data.find((d) => d.key === 'alpha') : null;
      const ends = data ? [data.start, data.end].map((v) => Math.round(v * 100) / 100) : [];
      return {
        pass: live && F.thick > F.thin && F.thin > 0
          && ends.indexOf(F.thin) !== -1 && ends.indexOf(F.thick) !== -1,
        detail: !live ? 'the haze is not moving at all'
          : 'it swings ' + ends.join(' to ') + ' and back, over '
            + Math.round(F.rollMsMin / 1000) + '-' + Math.round(F.rollMsMax / 1000)
            + 's each way',
      };
    });
    check('what is coming down is on the screen, falling, and new every match', () => {
      const first = matchInWeather('rainy');
      const old = first.weatherMotes;
      const g = matchInWeather('rainy');
      const motes = g.weatherMotes || [];
      const offScreen = motes.filter((m) => m.x < -20 || m.x > CONFIG.CANVAS.width + 20
        || m.y < -20 || m.y > CONFIG.CANVAS.height + 20);
      const falling = motes.filter((m) => g.tweens.getTweensOf(m).length > 0);
      return {
        pass: motes.length === Renderer.FALLING.rainy.motes && offScreen.length === 0
          && falling.length === motes.length && motes !== old
          && (old || []).every((m) => !m.active),
        detail: motes.length + ' drops, ' + falling.length + ' of them falling, '
          + offScreen.length + ' off the screen, and the last match\'s '
          + ((old || []).length) + ' destroyed with it',
      };
    });
    check('a sunny match has nothing coming down at all', () => {
      const g = matchInWeather('sunny');
      const motes = g.children.list.filter((o) => o.texture
        && ['flake', 'raindrop', 'gust', 'fogbank'].indexOf(o.texture.key) !== -1);
      return {
        pass: g.weatherMotes === null && g.fog === null && motes.length === 0,
        detail: motes.length + ' bits of weather on a clear day',
      };
    });

    group('the settings keys');

    check('every key on that screen reaches something that exists', () => {
      /*
       * Written the day the A key stopped working: the method behind it had been renamed
       * and the row still worked with a click, so the setting looked fine unless you used
       * the key it advertises. Every handler is stubbed, so this asks only the question
       * that went wrong - does the key reach a method that is actually there.
       */
      onlyScene('Settings');
      sceneByKey('Menu').scene.start('Settings', { returnTo: null });
      step(8);
      const scene = sceneByKey('Settings');
      const wired = [
        { name: 'M', code: 77, method: 'toggleMouse' },
        { name: 'T', code: 84, method: 'cycleTouch' },
        { name: 'A', code: 65, method: 'cycleAssist' },
        { name: 'V', code: 86, method: 'stepVolume' },
        { name: 'G', code: 71, method: 'cycleStadium' },
      ];
      const called = [];
      wired.forEach((w) => { scene[w.method] = () => called.push(w.name); });
      const broke = [];
      wired.forEach((w) => {
        try {
          pressKey(w.code);
        } catch (err) {
          broke.push(w.name + ': ' + (err && err.message ? err.message : err));
        }
      });
      wired.forEach((w) => { delete scene[w.method]; });
      const missed = wired.filter((w) => called.indexOf(w.name) === -1).map((w) => w.name);
      const trouble = broke.concat(missed.length ? ['nothing happened: ' + missed.join(',')] : []);
      return {
        pass: trouble.length === 0,
        detail: trouble.join('; ') || called.join(', ') + ' all reached their setting',
      };
    });

    group('hooks');
    check('every announced event has a renderer to receive it', () => {
      const want = ['onFacingChanged', 'onOutcome', 'onGoal', 'onKickoff', 'onKickoffCount',
        'onKick', 'onWallBounce', 'onKeeperSave', 'onKeeperClear', 'onKeeperFreeze',
        'onPossessionChange', 'onStumble', 'onFaceplant', 'onPenaltyResult', 'onFullTime',
        'onTick'];
      const missing = want.filter((k) => typeof Renderer[k] !== 'function');
      return { pass: missing.length === 0, detail: missing.join(', ') };
    });

    return summary();
  }

  /* Fresh match, played far enough in that the kickoff is over. */
  function startMatch(mode) {
    onlyScene('Game');
    sceneByKey('Menu').scene.start('Game', { mode: mode, difficulty: 'medium' });
    step(8);
    const g = sceneByKey('Game');
    /*
     * The teams walk out before the first kickoff, which is a second and a half of nothing
     * to the sixty-odd checks that only want a match in play. Wound forward rather than
     * skipped: the same code runs and arrives at the end of the walk on the next frame.
     * The walk itself is checked in 'the tunnel'.
     */
    if (g.state.entrance) g.state.entrance.startedAt -= 99999;
    let guard = 0;
    while (g.state.phase !== 'play' && guard++ < 900) step(1);
    step(4);
    return g;
  }

  function summary() {
    const failed = results.filter((r) => !r.passed);
    return {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed.map((r) => r.group + ' / ' + r.name + (r.detail ? ': ' + r.detail : '')),
      results: results.slice(),
    };
  }

  /* ------------------------------------------------------------------ visuals */

  /*
   * Effects are transient by design, which makes them impossible to photograph across two
   * separate commands. Each of these sets one up and then pauses the scene, so the frame
   * sits still for as long as it takes to look at it.
   */
  const stages = {
    match(skin) {
      Renderer.applySkin(skin || Renderer.activeSkin);
      const g = startMatch('two');
      const P = CONFIG.PITCH;
      g.red.sprite.setPosition(P.centreX - 190, P.centreY - 40);
      g.blue.sprite.setPosition(P.centreX + 190, P.centreY + 40);
      g.ball.body.setVelocity(0, 0);
      g.ball.setPosition(P.centreX - 155, P.centreY - 40);
      step(2);
      return g;
    },

    /* The teams on their way out: one across the grass, one still in the mouth. */
    entrance(skin) {
      Renderer.applySkin(skin || Renderer.activeSkin);
      Renderer.stadiumChoice = 'large';
      onlyScene('Game');
      sceneByKey('Menu').scene.start('Game', { mode: 'two', difficulty: 'medium' });
      step(2);
      const g = sceneByKey('Game');
      let guard = 0;
      // Held at the moment the second one out steps over the touchline, which is the
      // frame with somebody in the tunnel, somebody on the grass and the referee waiting.
      while (g.state.phase === 'entrance' && guard++ < 400
        && g.players[1].sprite.y < CONFIG.PITCH.top) step(1);
      // They fade up out of the dark on a tween, and tweens run on real time, which a
      // stage stepped through in a few milliseconds does not have. Held at full, so the
      // frame shows where they are rather than how far the fade happened to get.
      g.players.forEach((p) => p.sprite.setAlpha(1));
      return g;
    },

    labels() {
      const g = stages.match();
      const P = CONFIG.PITCH;
      const shots = [
        ['whiff', P.centreX - 320, P.centreY - 160],
        ['wildSlice', P.centreX + 300, P.centreY - 160],
        ['wrongFoot', P.centreX - 320, P.centreY + 120],
        ['faceplant', P.centreX + 300, P.centreY + 120],
      ];
      shots.forEach((s) => {
        g.red.sprite.setPosition(s[1], s[2]);
        Renderer.onOutcome(g, g.red, s[0]);
      });
      g.red.sprite.setPosition(P.centreX - 190, P.centreY - 40);
      // Labels arrive at 40% and spring up, so let the overshoot finish before freezing.
      g.children.list.filter((o) => o.depth === Renderer.DEPTH.label)
        .forEach((o) => o.setScale(1));
      step(2);
      return g;
    },

    stun() {
      const g = stages.match();
      const P = CONFIG.PITCH;
      g.red.sprite.setPosition(P.centreX - 220, P.centreY + 80);
      g.red.stunnedUntil = g.time.now + 60000;
      Renderer.onFaceplant(g, g.red, 60000);
      g.red.sprite.setRotation(Phaser.Math.DegToRad(Renderer.JUICE.faceplant.spinDeg));
      Renderer.onKeeperFreeze(g, g.keepers[0], true);
      Renderer.onKeeperFreeze(g, g.keepers[1], true);
      step(6);
      return g;
    },

    trail() {
      const g = stages.match();
      const P = CONFIG.PITCH;
      g.setOwner(null);
      g.state.recaptureLockUntil = g.time.now + 99999;
      g.ball.setPosition(P.centreX + 240, P.centreY);
      g.ball.body.setVelocity(-900, 0);
      for (let i = 0; i < 10; i++) step(1);
      return g;
    },

    crowd() {
      return stages.match('sunday');
    },

    /* A match as a phone gets it: stick down, buttons and pause button up. */
    touch(skin) {
      const was = AIM.touch;
      AIM.touch = 'on';
      Renderer.applySkin(skin || Renderer.activeSkin);
      const g = startMatch('bot');
      AIM.touch = was;
      const P = CONFIG.PITCH;
      g.red.sprite.setPosition(P.centreX - 190, P.centreY - 40);
      g.ball.body.setVelocity(0, 0);
      g.ball.setPosition(P.centreX - 155, P.centreY - 40);
      // Held mid-push, so the stick is photographed doing its job rather than at rest.
      const S = Renderer.touchLayout().stick;
      g.touchView.zone.emit('pointerdown', { id: 9, worldX: S.x, worldY: S.y });
      g.input.emit('pointermove', { id: 9, worldX: S.x + S.travel, worldY: S.y - S.travel / 2 });
      step(2);
      return g;
    },

    pause() {
      const g = stages.match();
      g.togglePause();
      step(4);
      return g;
    },

    /* Settings running on top of a match that is still there, paused, behind it. */
    pausedSettings() {
      const g = stages.match();
      g.togglePause();
      step(2);
      g.openSettings();
      step(6);
      return sceneByKey('Settings');
    },

    goal() {
      const g = stages.match();
      Renderer.onGoal(g, 'red', { red: 1, blue: 0 });
      // Let the banner sweep in and the burst spread before freezing the frame.
      for (let i = 0; i < 26; i++) step(1);
      const banner = g.children.list.find((o) => o.text === 'GOAL!');
      if (banner) banner.x = CONFIG.CANVAS.width / 2;
      return g;
    },

    countdown() {
      const g = stages.match();
      Renderer.onKickoffCount(g, 3);
      step(2);
      g.children.list.filter((o) => o.text === '3').forEach((o) => o.setScale(1).setAlpha(1));
      return g;
    },

    penalty() {
      onlyScene('Penalty');
      sceneByKey('Menu').scene.start('Penalty', { mode: 'bot', standalone: true });
      for (let i = 0; i < 30; i++) step(1);
      const p = sceneByKey('Penalty');
      p.view.result.setText('RIGHT ON THE LACES');
      p.tally.red = [true, false, true];
      p.tally.blue = [true, true];
      p.tally.redScore = 2;
      p.tally.blueScore = 2;
      p.tally.round = 3;
      Renderer.updatePenaltyTally(p.view, p.tally);
      step(2);
      return p;
    },

    fulltime() {
      onlyScene('FullTime');
      sceneByKey('Menu').scene.start('FullTime', {
        mode: 'two', scores: { red: 3, blue: 1 }, penalties: null,
      });
      for (let i = 0; i < 20; i++) step(1);
      return sceneByKey('FullTime');
    },
  };

  function stage(name, skin) {
    const g = stages[name] ? stages[name](skin) : null;
    if (g) {
      // Held still: paused scenes stop updating, so the last frame stays on screen.
      window.game.scene.pause(g.scene.key);
    }
    return g ? g.scene.key : 'unknown stage: ' + name;
  }

  function resume() {
    scenes().forEach((s) => {
      if (s.sys.isPaused()) window.game.scene.resume(s.scene.key);
    });
  }

  return { run: runAll, listen, stage, resume, results: () => results.slice() };
})();

window.DrunkTests = DrunkTests;
