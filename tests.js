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
    check('outcome colours differ by category', () => {
      const comic = Renderer.outcomeColour('whiff');
      const disaster = Renderer.outcomeColour('faceplant');
      const plain = Renderer.outcomeColour('wrongFoot');
      return {
        pass: comic !== disaster && disaster !== plain && comic !== plain,
        detail: [comic, disaster, plain].join(' / '),
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
    check('the crowd never stands on the HUD', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const clashes = [];
      ['bot', 'two'].forEach((mode) => {
        for (let run = 0; run < 4; run++) {
          const g = startMatch(mode);
          const fans = g.children.list.filter((o) => o.texture && o.texture.key === 'fan');
          const hud = [g.hud.score, g.hud.timer, g.hud.left, g.hud.right, g.hud.hint];
          hud.forEach((item) => {
            const box = boundsOf(item);
            fans.forEach((fan) => {
              if (overlaps(boundsOf(fan), box, 0)) clashes.push(mode + ' run ' + run);
            });
          });
        }
      });
      Renderer.applySkin(wasSkin);
      return { pass: clashes.length === 0, detail: clashes.slice(0, 3).join(', ') };
    });
    check('the crowd is the size it claims to be', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sunday');
      const K = Renderer.CROWD;
      const counts = [];
      for (let run = 0; run < 4; run++) {
        const g = startMatch('two');
        counts.push(g.children.list.filter((o) => o.texture && o.texture.key === 'fan').length);
      }
      Renderer.applySkin(wasSkin);
      const bad = counts.filter((n) => n < K.minPeople || n > K.maxPeople);
      return { pass: bad.length === 0, detail: 'counts ' + counts.join(', ') };
    });
    check('a skin without a crowd has none', () => {
      const wasSkin = Renderer.activeSkin;
      Renderer.applySkin('sixpints');
      const g = startMatch('two');
      const fans = g.children.list.filter((o) => o.texture && o.texture.key === 'fan').length;
      Renderer.applySkin(wasSkin);
      return { pass: fans === 0, detail: fans + ' supporters on a skin that asked for none' };
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
      if (leadsWithDisplayFace(g.hud.hint)) bad.push('pause hint');
      if (leadsWithDisplayFace(g.hud.left)) bad.push('controls');
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
