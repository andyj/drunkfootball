'use strict';

/*
 * Rendering layer.
 *
 * Every Phaser display object in Drunk Football is created in this file. Game logic
 * (game.js) never calls scene.add.*, scene.tweens.*, scene.cameras.*, and never names
 * a colour, a font, a cosmetic size or a piece of display text.
 *
 * There are two kinds of method here:
 *
 *   create* / show*  build and return display objects. Logic drives them through
 *                    physics but never restyles them.
 *
 *   on*              fire-and-forget events. Logic announces what just happened and
 *                    the renderer decides whether to draw anything at all. Several
 *                    are deliberately empty in Phase 1: the vocabulary is defined up
 *                    front so the design pass has a hook for every effect without
 *                    having to edit game logic.
 *
 * Phase 1 is placeholder shapes on purpose. Everything in this file is disposable.
 */
const Renderer = {

  /* ---------------------------------------------------------------- palette */

  PALETTE: {
    surround: 0x101319,
    grass: 0x2f7d40,
    line: 0xf2f2ea,
    net: 0x1d2430,
    red: 0xe04b4b,
    blue: 0x4b7fe0,
    ball: 0xfaf8f0,
    ballEdge: 0x22262e,
    keeperRed: 0xf0a0a0,
    keeperBlue: 0xa0bcf0,
    outline: 0x14181f,
  },

  CSS: {
    hud: '#f2f2ea',
    dim: '#9aa4b2',
    accent: '#ffd166',
    red: '#e04b4b',
    blue: '#4b7fe0',
    good: '#7bd88f',
    bad: '#ff7a7a',
  },

  FONT: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',

  DEPTH: {
    pitch: 0, wall: 5, keeper: 10, player: 20, ball: 30,
    label: 40, hud: 50, overlay: 60,
  },

  TEAM_NAME: { red: 'RED', blue: 'BLUE' },

  /* Text for every drunk outcome that betrayed the player. 'intended' has no entry,
   * which is the joke: a label appearing at all means it went wrong. One outcome has
   * many ways of being described so the same gag does not land twice in a row. */
  OUTCOME_LABELS: {
    wrongFoot: [
      'WRONG FOOT!', 'OTHER FOOT!', 'BRAIN SAID NO', 'NOT THE PLAN',
      'LEGS DISAGREED', 'MIXED IT UP', 'WRONG IDEA', 'THAT WASN\'T IT',
    ],
    wildSlice: [
      'SLICED IT!', 'OFF THE SHIN!', 'ROW Z!', 'SHANKED IT!', 'TOE PUNT!',
      'WHERE IS THAT GOING?', 'NO IDEA!', 'ABSOLUTE SCENES', 'INTO THE NIGHT',
    ],
    fumble: [
      'FUMBLE!', 'SCUFFED IT', 'TOE POKE', 'DAISY CUTTER', 'STUBBED IT',
      'WENT NOWHERE', 'LOVELY TOUCH', 'BARELY BOTHERED',
    ],
    whiff: [
      'WHIFF!', 'FRESH AIR!', 'AIR SHOT!', 'SWING AND A MISS', 'KICKED THE GRASS',
      'NOTHING THERE', 'MISSED IT ENTIRELY', 'ALL BREEZE',
    ],
    backheel: [
      'BACKHEEL?!', 'WRONG WAY!', 'BEHIND YOU!', 'THAT IS BACKWARDS',
      'CHEEKY', 'SHOWBOATING', 'WHO IS THAT FOR?',
    ],
    faceplant: [
      'TIMBER!', 'FLAT OUT', 'GOODNIGHT', 'GRAVITY WINS', 'HAD A SIT DOWN',
      'LEGS GONE', 'DOWN AND OUT', 'FOUND THE FLOOR',
    ],
  },

  PENALTY_LABELS: {
    clean: [
      'CLEAN STRIKE', 'RIGHT ON THE LACES', 'PROPER CONTACT', 'SWEETLY STRUCK',
      'NO ARGUMENT', 'BANG ON',
    ],
    wrongNumber: [
      'WRONG CORNER!', 'NOT THAT ONE!', 'MISCOUNTED', 'WRONG NUMBER!',
      'AIMED ELSEWHERE', 'THE OTHER ONE', 'CAN YOU COUNT?',
    ],
    skied: [
      'OVER THE BAR!', 'ROW Z!', 'INTO ORBIT', 'STILL RISING', 'MOON SHOT',
      'ASK THE STEWARD', 'GONE FOR GOOD',
    ],
    fumble: [
      'FUMBLED IT!', 'ROLLED IT', 'APOLOGETIC', 'A GENTLE GIFT', 'BACK PASS?',
      'WELL WRAPPED',
    ],
    slice: [
      'WIDE!', 'MILES WIDE', 'OFF THE SHIN', 'NOWHERE NEAR', 'CORNER FLAG',
      'WRONG POSTCODE',
    ],
    faceplant: [
      'TIMBER!', 'FELL OVER IT', 'GOODNIGHT', 'LEGS GONE', 'SAT DOWN',
      'BEATEN BY THE BALL',
    ],
  },

  /* One phrase from an outcome's list. */
  phraseFor(table, key) {
    const list = table[key];
    if (!list) return null;
    return Phaser.Utils.Array.GetRandom(list);
  },

  /* ------------------------------------------------------------- textures */

  makeTextures(scene) {
    const P = Renderer.PALETTE;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    const bake = (key, w, h, draw) => {
      if (scene.textures.exists(key)) return;
      g.clear();
      draw();
      g.generateTexture(key, w, h);
    };

    // 1x1 white pixel, stretched for walls and flat panels.
    bake('px', 1, 1, () => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 1, 1);
    });

    // Player: body circle plus a chunky nose so facing reads at a glance. The sprite
    // is rotated to the facing angle, so the nose is drawn pointing right (angle 0).
    const r = CONFIG.PLAYER.radius;
    const nose = 12;
    const pw = r * 2 + nose;
    const ph = r * 2;
    const player = (key, fill) => bake(key, pw, ph, () => {
      g.fillStyle(fill, 1);
      g.lineStyle(3, P.outline, 1);
      g.beginPath();
      g.moveTo(r * 1.6, r - 9);
      g.lineTo(pw - 2, r);
      g.lineTo(r * 1.6, r + 9);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.fillCircle(r, r, r - 2);
      g.strokeCircle(r, r, r - 2);
    });
    player('player_red', P.red);
    player('player_blue', P.blue);

    const br = CONFIG.BALL.radius;
    bake('ball', br * 2, br * 2, () => {
      g.fillStyle(P.ball, 1);
      g.lineStyle(2, P.ballEdge, 1);
      g.fillCircle(br, br, br - 1);
      g.strokeCircle(br, br, br - 1);
    });

    // Keeper: an upright slab on the goal line.
    const kw = CONFIG.KEEPER.width;
    const kh = CONFIG.KEEPER.height;
    const keeper = (key, fill) => bake(key, kw, kh, () => {
      g.fillStyle(fill, 1);
      g.lineStyle(3, P.outline, 1);
      g.fillRect(1.5, 1.5, kw - 3, kh - 3);
      g.strokeRect(1.5, 1.5, kw - 3, kh - 3);
    });
    keeper('keeper_red', P.keeperRed);
    keeper('keeper_blue', P.keeperBlue);

    g.destroy();
  },

  /* ------------------------------------------------------------ text util */

  text(scene, x, y, str, size, colour) {
    return scene.add.text(x, y, str, {
      fontFamily: Renderer.FONT,
      fontSize: size + 'px',
      color: colour || Renderer.CSS.hud,
    }).setDepth(Renderer.DEPTH.hud);
  },

  centred(scene, y, str, size, colour) {
    return Renderer.text(scene, CONFIG.CANVAS.width / 2, y, str, size, colour)
      .setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
  },

  /* The canvas colour behind everything. Asked for by the Phaser config in game.js so
   * that no colour value has to live in game logic. */
  canvasBackground() {
    return Renderer.PALETTE.surround;
  },

  /* Phaser key codes are named, not printable. PLUS is the '=' key, not shift-equals. */
  KEY_LABELS: {
    MINUS: '-', PLUS: '=', COMMA: ',', PERIOD: '.', FORWARD_SLASH: '/',
    BACK_SLASH: '\\', SEMICOLON: ';', QUOTES: "'", BACKTICK: '`',
    OPEN_BRACKET: '[', CLOSED_BRACKET: ']',
  },

  keyLabel(name) {
    return Renderer.KEY_LABELS[name] || name;
  },

  /* Control text is derived from CONFIG.CONTROLS so a remap never leaves stale help on screen. */
  moveKeys(team) {
    const k = CONFIG.CONTROLS[team];
    return [k.up, k.left, k.down, k.right].map(Renderer.keyLabel).join(' ');
  },

  controlSummary(team) {
    const k = CONFIG.CONTROLS[team];
    return Renderer.TEAM_NAME[team] + '   ' + Renderer.moveKeys(team) +
      '   ' + Renderer.keyLabel(k.pass) + ' pass   ' + Renderer.keyLabel(k.shoot) + ' shoot';
  },

  formatClock(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },

  /* ---------------------------------------------------------------- pitch */

  createPitch(scene) {
    const P = CONFIG.PITCH;
    const C = Renderer.PALETTE;
    const g = scene.add.graphics().setDepth(Renderer.DEPTH.pitch);

    g.fillStyle(C.surround, 1);
    g.fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);

    g.fillStyle(C.grass, 1);
    g.fillRect(P.left, P.top, P.width, P.height);

    // Goal recesses behind each line.
    g.fillStyle(C.net, 1);
    g.fillRect(P.left - P.goalDepth, P.mouthTop, P.goalDepth, P.goalMouth);
    g.fillRect(P.right, P.mouthTop, P.goalDepth, P.goalMouth);

    g.lineStyle(3, C.line, 1);
    g.strokeRect(P.left, P.top, P.width, P.height);
    g.lineBetween(P.centreX, P.top, P.centreX, P.bottom);
    g.strokeCircle(P.centreX, P.centreY, 70);
    g.fillStyle(C.line, 1);
    g.fillCircle(P.centreX, P.centreY, 5);

    // Posts, so the two openings are unmistakable.
    g.lineStyle(5, C.line, 1);
    [P.mouthTop, P.mouthBottom].forEach((y) => {
      g.lineBetween(P.left - P.goalDepth, y, P.left, y);
      g.lineBetween(P.right, y, P.right + P.goalDepth, y);
    });

    return g;
  },

  /* Invisible in Phase 1: the pitch graphic already shows where the walls are. */
  createWall(scene, x, y, w, h) {
    const wall = scene.physics.add.staticImage(x + w / 2, y + h / 2, 'px');
    wall.setDisplaySize(w, h).refreshBody();
    wall.setVisible(false).setDepth(Renderer.DEPTH.wall);
    return wall;
  },

  /* ------------------------------------------------------- match entities */

  createPlayer(scene, x, y, team) {
    const sprite = scene.physics.add.image(x, y, team === 'red' ? 'player_red' : 'player_blue');
    const r = CONFIG.PLAYER.radius;
    sprite.setOrigin(r / sprite.width, 0.5);
    sprite.body.setCircle(r, 0, 0);
    sprite.setDepth(Renderer.DEPTH.player);
    return sprite;
  },

  createBall(scene, x, y) {
    const sprite = scene.physics.add.image(x, y, 'ball');
    sprite.body.setCircle(CONFIG.BALL.radius, 0, 0);
    sprite.setDepth(Renderer.DEPTH.ball);
    return sprite;
  },

  createKeeper(scene, x, y, team) {
    const sprite = scene.physics.add.image(x, y, team === 'red' ? 'keeper_red' : 'keeper_blue');
    sprite.setDepth(Renderer.DEPTH.keeper);
    return sprite;
  },

  /* ------------------------------------------------------------------ HUD */

  createHUD(scene, mode) {
    const cx = CONFIG.CANVAS.width / 2;
    const C = Renderer.CSS;
    return {
      score: Renderer.text(scene, cx, 8, '0 - 0', 34).setOrigin(0.5, 0),
      timer: Renderer.text(scene, cx, 56, '0:00', 20, C.accent).setOrigin(0.5, 0),
      left: Renderer.text(scene, 20, 12, Renderer.controlSummary('red'), 13, C.dim),
      right: Renderer.text(scene, CONFIG.CANVAS.width - 20, 12,
        mode === 'bot' ? Renderer.TEAM_NAME.blue + '   bot' : Renderer.controlSummary('blue'), 13, C.dim)
        .setOrigin(1, 0),
      hint: Renderer.text(scene, cx, CONFIG.CANVAS.height - 24,
        'P or ESC to pause', 13, C.dim).setOrigin(0.5, 0),
    };
  },

  updateHUD(hud, scores, timeLeft) {
    hud.score.setText(scores.red + ' - ' + scores.blue);
    hud.timer.setText(Renderer.formatClock(timeLeft));
  },

  showPause(scene) {
    const shade = scene.add.image(CONFIG.CANVAS.width / 2, CONFIG.CANVAS.height / 2, 'px')
      .setDisplaySize(CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .setTint(0x000000).setAlpha(0.55).setDepth(Renderer.DEPTH.overlay);
    return [
      shade,
      Renderer.centred(scene, CONFIG.CANVAS.height / 2, 'PAUSED', 56),
      Renderer.centred(scene, CONFIG.CANVAS.height / 2 + 48, 'P or ESC to resume', 18, Renderer.CSS.dim),
    ];
  },

  hidePause(scene, view) {
    if (view) view.forEach((o) => o.destroy());
  },

  /* --------------------------------------------------------------- events */

  onFacingChanged(scene, player) {
    player.sprite.setRotation(player.facing);
  },

  onOutcome(scene, player, outcomeKey) {
    const str = Renderer.phraseFor(Renderer.OUTCOME_LABELS, outcomeKey);
    if (!str) return;
    const label = Renderer.text(scene, player.sprite.x, player.sprite.y - 34, str, 22, Renderer.CSS.accent)
      .setOrigin(0.5).setDepth(Renderer.DEPTH.label);
    scene.tweens.add({
      targets: label,
      y: label.y - 34,
      alpha: 0,
      duration: CONFIG.FEEDBACK.labelMs,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  },

  onGoal(scene, team, scores) {
    const label = Renderer.centred(scene, CONFIG.CANVAS.height / 2, 'GOAL!', 96,
      team === 'red' ? Renderer.CSS.red : Renderer.CSS.blue);
    scene.tweens.add({
      targets: label,
      alpha: 0,
      duration: CONFIG.MATCH.goalPauseMs,
      ease: 'Quad.easeIn',
      onComplete: () => label.destroy(),
    });
  },

  /* Announced once as the kickoff is set up, so it is clear who has the ball. */
  onKickoff(scene, team, isCoinToss) {
    const hold = CONFIG.MATCH.kickoffStepMs * (CONFIG.MATCH.kickoffCount + 1);
    const label = Renderer.centred(scene, CONFIG.CANVAS.height / 2 - 96,
      (isCoinToss ? 'COIN TOSS  —  ' : '') + Renderer.TEAM_NAME[team] + ' BALL', 36,
      team === 'red' ? Renderer.CSS.red : Renderer.CSS.blue);
    scene.tweens.add({
      targets: label,
      alpha: 0,
      duration: hold,
      ease: 'Quad.easeIn',
      onComplete: () => label.destroy(),
    });
  },

  /* Drawn below the centre spot: the side kicking off now stands on the spot with the
   * ball at its feet, so the count must not sit on top of them. */
  onKickoffCount(scene, n) {
    const label = Renderer.centred(scene, CONFIG.CANVAS.height / 2 + 130,
      n > 0 ? String(n) : 'GO!', n > 0 ? 88 : 64);
    scene.tweens.add({
      targets: label,
      alpha: 0,
      duration: CONFIG.MATCH.kickoffStepMs,
      onComplete: () => label.destroy(),
    });
  },

  /* Defined now so the design pass has somewhere to hang an effect without
   * touching game logic. Deliberately silent in Phase 1. */
  onKick(scene, player, kind, impulse) {},
  onWallBounce(scene, x, y, speed) {},
  onKeeperSave(scene, keeper, speed) {},
  onKeeperClear(scene, keeper, mate) {},
  onKeeperFreeze(scene, keeper, frozen) {},
  onPossessionChange(scene, player) {},
  onStumble(scene, player, ms) {},
  onFaceplant(scene, player, ms) {},
  onPenaltyResult(scene, team, outcomeKey, scored) {},
  onFullTime(scene, result) {},
  onTick(scene, view, time, delta) {},

  /* ----------------------------------------------------------- menu scene */

  createMenu(scene) {
    const C = Renderer.CSS;
    const cx = CONFIG.CANVAS.width / 2;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 205, CONFIG.CANVAS.width, 290);

    Renderer.centred(scene, 110, 'DRUNK FOOTBALL', 76);
    Renderer.centred(scene, 166, 'you know what you meant to do', 20, C.dim);

    const red = CONFIG.CONTROLS.red;
    const blue = CONFIG.CONTROLS.blue;
    const rows = [
      ['', Renderer.TEAM_NAME.red, Renderer.TEAM_NAME.blue],
      ['Move', Renderer.moveKeys('red'), Renderer.moveKeys('blue')],
      ['Pass', Renderer.keyLabel(red.pass), Renderer.keyLabel(blue.pass)],
      ['Shoot', Renderer.keyLabel(red.shoot), Renderer.keyLabel(blue.shoot)],
    ];
    rows.forEach((row, i) => {
      const y = 250 + i * 34;
      const colour = i === 0 ? C.accent : C.hud;
      const size = i === 0 ? 20 : 22;
      Renderer.text(scene, cx - 250, y, row[0], size, colour).setDepth(Renderer.DEPTH.overlay);
      Renderer.text(scene, cx - 20, y, row[1], size, colour).setOrigin(0.5, 0).setDepth(Renderer.DEPTH.overlay);
      Renderer.text(scene, cx + 205, y, row[2], size, colour).setOrigin(0.5, 0).setDepth(Renderer.DEPTH.overlay);
    });

    Renderer.centred(scene, 420, 'Pass and Shoot only work when you have the ball.', 16, C.dim);
    Renderer.centred(scene, 446, 'Having the ball is no guarantee your legs agree.', 16, C.dim);

    Renderer.centred(scene, 555, 'PRESS  1  FOR ONE PLAYER vs BOT', 30, C.accent);
    Renderer.centred(scene, 600, 'PRESS  2  FOR TWO PLAYERS', 30, C.accent);
    Renderer.centred(scene, 668,
      'Match is ' + Math.round(CONFIG.MATCH.durationSec / 60) +
      ' minutes. Level at full time goes to penalties.', 15, C.dim);
  },

  /* -------------------------------------------------------- penalty scene */

  createPenaltyView(scene, geom) {
    const C = Renderer.CSS;
    const P = Renderer.PALETTE;

    const g = scene.add.graphics().setDepth(Renderer.DEPTH.pitch);
    g.fillStyle(P.surround, 1).fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);
    g.fillStyle(P.grass, 1).fillRect(0, geom.fieldTop, CONFIG.CANVAS.width, geom.fieldHeight);
    g.fillStyle(P.net, 1).fillRect(geom.goalLineX, geom.mouthTop, geom.goalDepth, geom.mouthHeight);
    g.lineStyle(3, P.line, 1);
    g.strokeRect(0, geom.fieldTop, CONFIG.CANVAS.width, geom.fieldHeight);
    g.strokeCircle(geom.spotX, geom.spotY, 70);
    g.fillStyle(P.line, 1).fillCircle(geom.spotX, geom.spotY, 5);
    g.lineStyle(5, P.line, 1);
    g.lineBetween(geom.goalLineX, geom.mouthTop, geom.goalLineX + geom.goalDepth, geom.mouthTop);
    g.lineBetween(geom.goalLineX, geom.mouthBottom, geom.goalLineX + geom.goalDepth, geom.mouthBottom);

    Renderer.centred(scene, 40, 'PENALTY SHOOTOUT', 44);

    // Number the thirds, otherwise 1/2/3 is a guess rather than a choice.
    CONFIG.PENALTY.thirds.forEach((third, i) => {
      Renderer.text(scene, geom.goalLineX + geom.goalDepth / 2, geom.thirdY[third],
        String(i + 1), 30, C.accent).setOrigin(0.5).setDepth(Renderer.DEPTH.pitch + 1);
    });

    const taker = scene.add.image(geom.spotX - 54, geom.spotY, 'player_red')
      .setDepth(Renderer.DEPTH.player);
    taker.setOrigin(CONFIG.PLAYER.radius / taker.width, 0.5);

    return {
      geom,
      taker,
      keeper: scene.add.image(geom.goalLineX - CONFIG.KEEPER.lineInset, geom.spotY, 'keeper_blue')
        .setDepth(Renderer.DEPTH.keeper),
      ball: scene.add.image(geom.spotX, geom.spotY, 'ball').setDepth(Renderer.DEPTH.ball),
      prompt: Renderer.centred(scene, 540, '', 30, C.accent),
      result: Renderer.centred(scene, 588, '', 36),
      tallyRed: Renderer.text(scene, 60, 616, '', 24, C.red),
      tallyBlue: Renderer.text(scene, 60, 652, '', 24, C.blue),
      score: Renderer.text(scene, CONFIG.CANVAS.width - 60, 612, '', 32).setOrigin(1, 0),
      round: Renderer.text(scene, CONFIG.CANVAS.width - 60, 656, '', 17, C.dim).setOrigin(1, 0),
    };
  },

  /* A mark per penalty: O scored, X missed, . still to take. */
  updatePenaltyTally(view, tally) {
    const total = Math.max(CONFIG.PENALTY.kicksEach, tally.red.length, tally.blue.length);
    const row = (marks) => {
      const out = [];
      for (let i = 0; i < total; i++) out.push(i < marks.length ? (marks[i] ? 'O' : 'X') : '.');
      return out.join(' ');
    };
    view.tallyRed.setText('RED    ' + row(tally.red));
    view.tallyBlue.setText('BLUE   ' + row(tally.blue));
    view.score.setText(tally.redScore + ' - ' + tally.blueScore);
    view.round.setText(tally.suddenDeath
      ? 'SUDDEN DEATH  —  pair ' + (tally.round - CONFIG.PENALTY.kicksEach)
      : 'Penalty ' + Math.min(tally.round, CONFIG.PENALTY.kicksEach) + ' of ' + CONFIG.PENALTY.kicksEach);
  },

  setPenaltyPrompt(view, team, isHuman) {
    if (!isHuman) {
      view.prompt.setText(Renderer.TEAM_NAME[team] + ' is stepping up...');
      return;
    }
    view.prompt.setText(Renderer.TEAM_NAME[team] + ': pick a corner, 1  2  or  3');
  },

  setPenaltyResult(view, outcomeKey, scored) {
    if (!outcomeKey) {
      view.result.setText('');
      return;
    }
    view.result.setText(Renderer.phraseFor(Renderer.PENALTY_LABELS, outcomeKey)
      + '   ' + (scored ? 'GOAL' : 'NO GOAL'));
    view.result.setColor(scored ? Renderer.CSS.good : Renderer.CSS.bad);
  },

  resetPenaltyKicker(view, team) {
    const geom = view.geom;
    view.taker.setTexture(team === 'red' ? 'player_red' : 'player_blue');
    view.taker.setOrigin(CONFIG.PLAYER.radius / view.taker.width, 0.5);
    view.taker.setAngle(0).setPosition(geom.spotX - 54, geom.spotY);
    view.keeper.setTexture(team === 'red' ? 'keeper_blue' : 'keeper_red');
    view.keeper.setPosition(geom.goalLineX - CONFIG.KEEPER.lineInset, geom.spotY);
    view.ball.setScale(1).setPosition(geom.spotX, geom.spotY);
  },

  /*
   * Plays out a penalty whose result logic has ALREADY decided. The renderer only
   * animates the given plan; it never works out whether the kick scored.
   */
  playPenaltyKick(scene, view, plan, onDone) {
    const ms = CONFIG.PENALTY.kickAnimMs;

    if (!plan.keeperFrozen) {
      scene.tweens.add({
        targets: view.keeper,
        y: plan.keeperY,
        duration: ms * 0.75,
        ease: 'Quad.easeOut',
      });
    }

    if (plan.outcome === 'faceplant') {
      scene.tweens.add({
        targets: view.taker,
        angle: 90,
        duration: ms,
        ease: 'Quad.easeOut',
        onComplete: onDone,
      });
      return;
    }

    const tween = {
      targets: view.ball,
      x: plan.ballX,
      y: plan.ballY,
      duration: plan.slow ? ms * 2.2 : ms,
      ease: plan.slow ? 'Quad.easeOut' : 'Quad.easeIn',
      onComplete: onDone,
    };
    // Skied: top down can't show height, so sell it by scaling the ball up as it sails past.
    if (plan.outcome === 'skied') {
      tween.scale = 2.6;
      tween.ease = 'Quad.easeOut';
    }
    scene.tweens.add(tween);
  },

  /* ------------------------------------------------------ full time scene */

  createFullTime(scene, result) {
    const C = Renderer.CSS;
    const winnerColour = result.winner === 'red' ? C.red : result.winner === 'blue' ? C.blue : C.hud;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 200, CONFIG.CANVAS.width, 300);

    Renderer.centred(scene, 150, 'FULL TIME', 60, C.dim);
    Renderer.centred(scene, 268,
      result.winner ? Renderer.TEAM_NAME[result.winner] + ' WINS' : 'HONOURS EVEN', 88, winnerColour);

    let scoreline = result.scores.red + ' - ' + result.scores.blue;
    if (result.penalties) {
      scoreline += '  (' + result.penalties.red + ' - ' + result.penalties.blue + ' on penalties)';
    }
    Renderer.centred(scene, 366, scoreline, 44);

    Renderer.centred(scene, 570, 'SPACE  rematch', 30, C.accent);
    Renderer.centred(scene, 612, 'M  menu', 30, C.accent);
  },
};
