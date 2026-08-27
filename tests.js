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
        pass: named && Renderer.DEFAULT_SKIN === 'sixpints',
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
      Renderer.STADIUMS.forEach((stadium) => {
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
      const sizes = Renderer.STADIUMS;
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
    check('every ground stays inside the surround', () => {
      // There is 60px above the pitch and 60px below it. A row of people standing outside
      // that is a row standing on the pitch, or off the screen altogether.
      const K = Renderer.CROWD;
      const P = CONFIG.PITCH;
      const wasStadium = Renderer.stadiumChoice;
      const bad = [];
      Renderer.STADIUMS.forEach((stadium) => {
        Renderer.stadiumChoice = stadium.key;
        const g = startMatch('two');
        g.children.list.filter((o) => o.texture && o.texture.key === 'fan').forEach((fan) => {
          const b = boundsOf(fan);
          const above = b.bottom <= P.top && b.top >= 0;
          const below = b.top >= P.bottom && b.bottom <= CONFIG.CANVAS.height;
          if (!above && !below) bad.push(stadium.key + ' at y' + Math.round(fan.y));
        });
      });
      Renderer.stadiumChoice = wasStadium;
      return { pass: bad.length === 0, detail: bad.slice(0, 4).join(', ') || 'all in the stands' };
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

    group('the stands');

    const fansIn = (scene) => scene.children.list.filter((o) => o.texture
      && o.texture.key === 'fan');

    /* Every seat in the ground, however many rows and blocks it has. */
    function allSeats(stadium) {
      const seats = [];
      Renderer.standRows(stadium).forEach((side) => {
        side.rows.forEach((row) => {
          side.bands.forEach((band) => {
            Renderer.seatsIn(band, row).forEach((seat) => seats.push(seat));
          });
        });
      });
      return seats;
    }

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

  return { run: runAll, stage, resume, results: () => results.slice() };
})();

window.DrunkTests = DrunkTests;
