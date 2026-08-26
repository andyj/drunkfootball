'use strict';

/*
 * Drunk Football — game logic.
 *
 * Nothing in this file creates a display object, picks a colour or writes a piece of
 * on-screen text. All of that lives in render.js behind the Renderer contract, so the
 * design pass can replace the look of the game without touching a line of mechanics.
 */

/* ==========================================================================
 * CONFIG — every tunable number in the game
 * ======================================================================= */

const CONFIG = {

  CANVAS: { width: 1280, height: 720 },

  PITCH: {
    left: 80,
    right: 1200,
    top: 60,
    bottom: 660,
    goalMouth: 150,      // height of each goal opening
    goalDepth: 46,       // how far the net sits behind the line
    wallThickness: 30,
  },

  PLAYER: {
    radius: 16,
    speed: 230,
    dribbleSpeed: 180,
    kickoffOffset: 170,  // distance either side of the centre spot at kickoff
  },

  BALL: {
    radius: 8,
    bounce: 0.75,
    drag: 280,           // px/s^2. A 420 pass rolls to a stop in 420/280 = 1.5s
    maxSpeed: 1100,
    captureRadius: 28,
    carryDistance: 24,
    kickLockMs: 250,     // stops the kicker instantly recapturing their own fumble
    tackleLockMs: 400,   // spec: no recapture for 400ms after a tackle
    tackleImpulseMin: 90,
    tackleImpulseMax: 190,
  },

  KICK: {
    passPower: 420,
    shootPower: 750,
    shootSpreadDeg: 7,
    backheelPower: 380,
    fumbleMinFactor: 0.10,
    fumbleMaxFactor: 0.25,
    sliceMinPower: 280,
    sliceMaxPower: 820,
  },

  /* The whole point of the game. Every Pass/Shoot press rolls against this once. */
  DRUNK: {
    stumbleMs: 300,
    faceplantMs: 1000,
    TABLE: [
      { key: 'intended',  weight: 35 },
      { key: 'wrongFoot', weight: 18 },
      { key: 'wildSlice', weight: 14 },
      { key: 'fumble',    weight: 12 },
      { key: 'whiff',     weight: 8 },
      { key: 'backheel',  weight: 8 },
      { key: 'faceplant', weight: 5 },
    ],
  },

  KEEPER: {
    enabled: true,
    width: 16,
    height: 48,
    speed: 210,
    lineInset: 20,          // how far in front of the line the keeper stands
    deadZone: 4,
    freezeEveryMinMs: 2000,
    freezeEveryMaxMs: 4000,
    freezeMinMs: 500,
    freezeMaxMs: 1000,
  },

  MATCH: {
    durationSec: 180,
    goalPauseMs: 1300,
    kickoffCount: 3,        // counts 3, 2, 1 then GO
    kickoffStepMs: 450,
  },

  BOT: {
    reactionMinMs: 150,
    reactionMaxMs: 250,
    shootProgress: 0.6,     // fraction of the pitch covered before it shoots
    pressureRadius: 150,
    passUnderPressureChance: 0.35,
    aimWobbleDeg: 9,
    driftWobblePx: 55,
    chaseWobbleScale: 0.3,   // the bot aims loosely at the ball, not exactly at it
    steerDeadZonePx: 12,     // how close to the target counts as "arrived" per axis
  },

  PENALTY: {
    kicksEach: 5,
    thirds: ['top', 'centre', 'bottom'],
    botDelayMinMs: 700,
    botDelayMaxMs: 1400,
    kickAnimMs: 520,
    resultHoldMs: 1200,
    GEOM: {
      fieldTop: 90,
      fieldHeight: 400,
      goalLineX: 980,
      goalDepth: 60,
      spotX: 560,
      behindLineX: 40,       // where a scoring ball settles past the line
      keeperGapX: 14,        // gap between a saved ball and the keeper
      wideOffsetX: 30,
      wideOffsetY: 62,       // clear of the post
      skiedOffsetX: 96,
      skiedOffsetY: 128,     // over the bar
    },
    /* Separate table. The taker's intent barely matters, which is the point. */
    TABLE: [
      { key: 'clean',     weight: 30 },
      { key: 'swapped',   weight: 25 },
      { key: 'skied',     weight: 15 },
      { key: 'fumble',    weight: 15 },
      { key: 'slice',     weight: 10 },
      { key: 'faceplant', weight: 5 },
    ],
  },

  FEEDBACK: {
    labelMs: 700,
  },

  /* Pass sits left of Shoot for both players, within reach of the movement hand. */
  CONTROLS: {
    red:  { up: 'W', down: 'S', left: 'A', right: 'D', pass: 'C', shoot: 'V' },
    blue: { up: 'I', down: 'K', left: 'J', right: 'L', pass: 'N', shoot: 'M' },
  },
};

/* Derived geometry, so the numbers above stay the only things worth editing. */
(function deriveGeometry() {
  const P = CONFIG.PITCH;
  P.width = P.right - P.left;
  P.height = P.bottom - P.top;
  P.centreX = P.left + P.width / 2;
  P.centreY = P.top + P.height / 2;
  P.mouthTop = P.centreY - P.goalMouth / 2;
  P.mouthBottom = P.centreY + P.goalMouth / 2;

  const G = CONFIG.PENALTY.GEOM;
  G.mouthHeight = P.goalMouth;
  G.mouthTop = G.fieldTop + (G.fieldHeight - G.mouthHeight) / 2;
  G.mouthBottom = G.mouthTop + G.mouthHeight;
  G.spotY = G.mouthTop + G.mouthHeight / 2;
  G.thirdY = {
    top: G.mouthTop + G.mouthHeight / 6,
    centre: G.spotY,
    bottom: G.mouthBottom - G.mouthHeight / 6,
  };
}());

/* ==========================================================================
 * Shared helpers
 * ======================================================================= */

/* One weighted roll. Used by human presses, bot presses and the shootout alike. */
function rollOutcome(table) {
  let total = 0;
  for (const row of table) total += row.weight;
  let r = Math.random() * total;
  for (const row of table) {
    r -= row.weight;
    if (r < 0) return row.key;
  }
  return table[table.length - 1].key;
}

function makeInput() {
  return { up: false, down: false, left: false, right: false, pass: false, shoot: false };
}

function keysFor(scene, team) {
  const map = CONFIG.CONTROLS[team];
  return scene.input.keyboard.addKeys(
    [map.up, map.down, map.left, map.right, map.pass, map.shoot].join(',')
  );
}

/* Keepers are drunk too: they freeze on a timer, and that freeze is the scoring window. */
function scheduleKeeperFreeze(keeper, now) {
  keeper.nextFreezeAt = now + Phaser.Math.Between(
    CONFIG.KEEPER.freezeEveryMinMs, CONFIG.KEEPER.freezeEveryMaxMs);
}

function updateKeeperFreeze(scene, keeper, now) {
  if (keeper.frozen) {
    if (now >= keeper.frozenUntil) {
      keeper.frozen = false;
      scheduleKeeperFreeze(keeper, now);
      Renderer.onKeeperFreeze(scene, keeper, false);
    }
  } else if (now >= keeper.nextFreezeAt) {
    keeper.frozen = true;
    keeper.frozenUntil = now + Phaser.Math.Between(
      CONFIG.KEEPER.freezeMinMs, CONFIG.KEEPER.freezeMaxMs);
    Renderer.onKeeperFreeze(scene, keeper, true);
  }
}

/* ==========================================================================
 * MenuScene
 * ======================================================================= */

class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    Renderer.makeTextures(this);
    Renderer.createMenu(this);
    this.keys = this.input.keyboard.addKeys('ONE,TWO,NUMPAD_ONE,NUMPAD_TWO');
  }

  update() {
    const k = this.keys;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    const one = JustDown(k.ONE) || JustDown(k.NUMPAD_ONE);
    const two = JustDown(k.TWO) || JustDown(k.NUMPAD_TWO);
    if (one) this.scene.start('Game', { mode: 'bot' });
    else if (two) this.scene.start('Game', { mode: 'two' });
  }
}

/* ==========================================================================
 * GameScene — the match
 * ======================================================================= */

class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.mode = (data && data.mode) || 'bot';
  }

  create() {
    const P = CONFIG.PITCH;

    Renderer.makeTextures(this);
    Renderer.createPitch(this);

    this.physics.world.setBounds(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);
    this.pitchBounds = new Phaser.Geom.Rectangle(P.left, P.top, P.width, P.height);

    this.state = {
      scores: { red: 0, blue: 0 },
      timeLeft: CONFIG.MATCH.durationSec,
      phase: 'kickoff',            // kickoff | play | goal | over
      phaseUntil: 0,
      countLeft: 0,
      nextCountAt: 0,
      paused: false,
      owner: null,
      recaptureLockUntil: 0,
      kickoffTeam: null,      // who takes the next kickoff, and starts with the ball
      kickoffIsToss: false,   // true only for the coin toss that opens the match
    };

    this.walls = this.buildWalls();

    this.red = this.makePlayer('red');
    this.blue = this.makePlayer('blue');
    this.players = [this.red, this.blue];
    this.blue.isBot = this.mode === 'bot';
    this.bot = this.blue.isBot ? this.makeBot(this.blue) : null;

    this.ball = Renderer.createBall(this, P.centreX, P.centreY);
    this.ball.body.setDrag(CONFIG.BALL.drag, CONFIG.BALL.drag);
    this.ball.body.setBounce(CONFIG.BALL.bounce, CONFIG.BALL.bounce);
    this.ball.body.setMaxVelocity(CONFIG.BALL.maxSpeed, CONFIG.BALL.maxSpeed);

    this.keepers = CONFIG.KEEPER.enabled
      ? [this.makeKeeper('left'), this.makeKeeper('right')]
      : [];

    this.physics.add.collider(this.ball, this.walls, (ball) => {
      Renderer.onWallBounce(this, ball.x, ball.y, ball.body.speed);
    });
    this.keepers.forEach((keeper) => {
      this.physics.add.collider(this.ball, keeper.sprite, (ball) => {
        Renderer.onKeeperSave(this, keeper, ball.body.speed);
      });
    });

    this.keys = { red: keysFor(this, 'red'), blue: keysFor(this, 'blue') };
    this.systemKeys = this.input.keyboard.addKeys('P,ESC');

    this.hud = Renderer.createHUD(this, this.mode);
    this.view = {
      players: this.players,
      ball: this.ball,
      keepers: this.keepers,
      state: this.state,
      hud: this.hud,
    };

    this.pauseView = null;
    // Who starts with the ball is a coin toss, fresh for every match.
    this.state.kickoffTeam = Math.random() < 0.5 ? 'red' : 'blue';
    this.state.kickoffIsToss = true;
    this.startKickoff(this.time.now);
    Renderer.updateHUD(this.hud, this.state.scores, this.state.timeLeft);
  }

  /* ------------------------------------------------------------ building */

  /* Solid walls all the way round, with a gap at each goal mouth and a back net
   * so a scored ball stays put. No throw-ins, so wall passes are always on. */
  buildWalls() {
    const P = CONFIG.PITCH;
    const t = P.wallThickness;
    const outerLeft = P.left - P.goalDepth;
    const outerRight = P.right + P.goalDepth;
    const specs = [
      [outerLeft - t, P.top - t, (outerRight - outerLeft) + t * 2, t],           // top
      [outerLeft - t, P.bottom, (outerRight - outerLeft) + t * 2, t],            // bottom
      [P.left - t, P.top, t, P.mouthTop - P.top],                                // left, above mouth
      [P.left - t, P.mouthBottom, t, P.bottom - P.mouthBottom],                  // left, below mouth
      [P.right, P.top, t, P.mouthTop - P.top],                                   // right, above mouth
      [P.right, P.mouthBottom, t, P.bottom - P.mouthBottom],                     // right, below mouth
      [outerLeft - t, P.mouthTop, t, P.goalMouth],                               // left net back
      [outerRight, P.mouthTop, t, P.goalMouth],                                  // right net back
    ];
    return specs.map((s) => Renderer.createWall(this, s[0], s[1], s[2], s[3]));
  }

  makePlayer(team) {
    const P = CONFIG.PITCH;
    const player = {
      team,
      isBot: false,
      facing: team === 'red' ? 0 : Math.PI,
      input: makeInput(),
      stunnedUntil: 0,
      // Red plays left and attacks right.
      targetGoalX: team === 'red' ? P.right : P.left,
      sprite: Renderer.createPlayer(this, P.centreX, P.centreY, team),
    };
    player.sprite.body.setCollideWorldBounds(true);
    player.sprite.body.setBoundsRectangle(this.pitchBounds);
    Renderer.onFacingChanged(this, player);
    return player;
  }

  makeKeeper(side) {
    const P = CONFIG.PITCH;
    const team = side === 'left' ? 'red' : 'blue';
    const x = side === 'left' ? P.left + CONFIG.KEEPER.lineInset : P.right - CONFIG.KEEPER.lineInset;
    const keeper = {
      side,
      team,
      homeX: x,
      frozen: false,
      frozenUntil: 0,
      nextFreezeAt: 0,
      sprite: Renderer.createKeeper(this, x, P.centreY, team),
    };
    keeper.sprite.body.setImmovable(true);
    keeper.sprite.body.setAllowGravity(false);
    scheduleKeeperFreeze(keeper, this.time.now);
    return keeper;
  }

  makeBot(player) {
    return {
      player,
      nextDecisionAt: 0,
      targetX: player.sprite.x,
      targetY: player.sprite.y,
      queuedKick: null,
    };
  }

  /* --------------------------------------------------------------- loop */

  update(time, delta) {
    Renderer.onTick(this, this.view, time, delta);

    const pausePressed = Phaser.Input.Keyboard.JustDown(this.systemKeys.P);
    const escPressed = Phaser.Input.Keyboard.JustDown(this.systemKeys.ESC);
    if (pausePressed || escPressed) this.togglePause();

    if (this.state.paused || this.state.phase === 'over') {
      this.freezeEveryone();
      return;
    }

    switch (this.state.phase) {
      case 'kickoff':
        this.freezeEveryone();
        this.updateCountdown(time);
        break;
      case 'goal':
        this.freezeEveryone();
        if (time >= this.state.phaseUntil) this.startKickoff(time);
        break;
      case 'play':
        this.updatePlay(time, delta);
        break;
    }
  }

  updatePlay(time, delta) {
    this.readInput(time);
    this.players.forEach((p) => this.movePlayer(p, time));
    this.keepers.forEach((k) => this.updateKeeper(k, time));
    this.resolveActions(time);
    this.updatePossession(time);

    if (this.checkGoal(time)) return;

    this.state.timeLeft -= delta / 1000;
    Renderer.updateHUD(this.hud, this.state.scores, this.state.timeLeft);
    if (this.state.timeLeft <= 0) this.endMatch();
  }

  /* -------------------------------------------------------------- input */

  readInput(now) {
    this.readHumanInput(this.red);
    if (this.bot) this.readBotInput(this.bot, now);
    else this.readHumanInput(this.blue);
  }

  readHumanInput(player) {
    const map = CONFIG.CONTROLS[player.team];
    const keys = this.keys[player.team];
    const input = player.input;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    input.up = keys[map.up].isDown;
    input.down = keys[map.down].isDown;
    input.left = keys[map.left].isDown;
    input.right = keys[map.right].isDown;
    input.pass = JustDown(keys[map.pass]);
    input.shoot = JustDown(keys[map.shoot]);
  }

  /*
   * The bot fills in exactly the same input struct a human keyboard fills in, so it
   * runs down the identical movement and kick code paths. It cannot cheat by design.
   */
  readBotInput(bot, now) {
    const player = bot.player;
    const input = player.input;
    input.pass = false;
    input.shoot = false;

    if (now >= bot.nextDecisionAt) {
      bot.nextDecisionAt = now + Phaser.Math.Between(
        CONFIG.BOT.reactionMinMs, CONFIG.BOT.reactionMaxMs);
      this.decideBot(bot);
    }

    const dead = CONFIG.BOT.steerDeadZonePx;
    const dx = bot.targetX - player.sprite.x;
    const dy = bot.targetY - player.sprite.y;
    input.left = dx < -dead;
    input.right = dx > dead;
    input.up = dy < -dead;
    input.down = dy > dead;

    if (bot.queuedKick) {
      input[bot.queuedKick] = true;
      bot.queuedKick = null;
    }
  }

  decideBot(bot) {
    const P = CONFIG.PITCH;
    const player = bot.player;
    const wobble = () => Phaser.Math.FloatBetween(-1, 1) * CONFIG.BOT.driftWobblePx;

    if (this.state.owner === player) {
      bot.targetX = player.targetGoalX;
      bot.targetY = Phaser.Math.Clamp(P.centreY + wobble(), P.mouthTop, P.mouthBottom);

      const covered = player.team === 'red'
        ? (player.sprite.x - P.left) / P.width
        : (P.right - player.sprite.x) / P.width;
      const opponent = player === this.red ? this.blue : this.red;
      const pressured = Phaser.Math.Distance.Between(
        opponent.sprite.x, opponent.sprite.y, player.sprite.x, player.sprite.y
      ) < CONFIG.BOT.pressureRadius;

      if (covered >= CONFIG.BOT.shootProgress) bot.queuedKick = 'shoot';
      else if (pressured && Math.random() < CONFIG.BOT.passUnderPressureChance) bot.queuedKick = 'pass';
    } else {
      bot.targetX = this.ball.x + wobble() * CONFIG.BOT.chaseWobbleScale;
      bot.targetY = this.ball.y + wobble() * CONFIG.BOT.chaseWobbleScale;
    }
  }

  /* ----------------------------------------------------------- movement */

  movePlayer(player, now) {
    const body = player.sprite.body;
    if (now < player.stunnedUntil) {
      body.setVelocity(0, 0);
      return;
    }

    const input = player.input;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    if (dx === 0 && dy === 0) {
      body.setVelocity(0, 0);
      return;
    }

    const len = Math.sqrt(dx * dx + dy * dy);   // normalise so diagonals are not faster
    dx /= len;
    dy /= len;

    const facing = Math.atan2(dy, dx);
    if (facing !== player.facing) {
      player.facing = facing;
      Renderer.onFacingChanged(this, player);
    }

    const speed = this.state.owner === player ? CONFIG.PLAYER.dribbleSpeed : CONFIG.PLAYER.speed;
    body.setVelocity(dx * speed, dy * speed);
  }

  updateKeeper(keeper, now) {
    updateKeeperFreeze(this, keeper, now);

    const P = CONFIG.PITCH;
    const half = CONFIG.KEEPER.height / 2;
    const body = keeper.sprite.body;

    if (keeper.frozen) {
      body.setVelocityY(0);
      return;
    }

    const target = Phaser.Math.Clamp(this.ball.y, P.mouthTop + half, P.mouthBottom - half);
    const dy = target - keeper.sprite.y;
    if (Math.abs(dy) < CONFIG.KEEPER.deadZone) body.setVelocityY(0);
    else body.setVelocityY(Math.sign(dy) * CONFIG.KEEPER.speed);
  }

  freezeEveryone() {
    this.players.forEach((p) => p.sprite.body.setVelocity(0, 0));
    this.keepers.forEach((k) => k.sprite.body.setVelocity(0, 0));
    this.ball.body.setVelocity(0, 0);
  }

  /* --------------------------------------------------- possession & ball */

  setOwner(player) {
    if (this.state.owner === player) return;
    this.state.owner = player;
    Renderer.onPossessionChange(this, player);
  }

  updatePossession(now) {
    const P = CONFIG.PITCH;
    const ball = this.ball;
    const owner = this.state.owner;

    if (owner) {
      // A body touching the ball while someone dribbles knocks it loose.
      for (const p of this.players) {
        if (p === owner || now < p.stunnedUntil) continue;
        const d = Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, ball.x, ball.y);
        if (d < CONFIG.PLAYER.radius + CONFIG.BALL.radius) {
          this.tackle(now);
          break;
        }
      }
    }

    if (this.state.owner) {
      // Ball rides just ahead of the dribbler's facing, clamped to stay on the pitch.
      const o = this.state.owner;
      const r = CONFIG.BALL.radius;
      const x = Phaser.Math.Clamp(
        o.sprite.x + Math.cos(o.facing) * CONFIG.BALL.carryDistance, P.left + r, P.right - r);
      const y = Phaser.Math.Clamp(
        o.sprite.y + Math.sin(o.facing) * CONFIG.BALL.carryDistance, P.top + r, P.bottom - r);
      ball.body.reset(x, y);
      return;
    }

    if (now < this.state.recaptureLockUntil) return;

    for (const p of this.players) {
      if (now < p.stunnedUntil) continue;
      const d = Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, ball.x, ball.y);
      if (d < CONFIG.BALL.captureRadius) {
        this.setOwner(p);
        return;
      }
    }
  }

  tackle(now) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const power = Phaser.Math.Between(CONFIG.BALL.tackleImpulseMin, CONFIG.BALL.tackleImpulseMax);
    this.setOwner(null);
    this.state.recaptureLockUntil = now + CONFIG.BALL.tackleLockMs;
    this.ball.body.setVelocity(Math.cos(angle) * power, Math.sin(angle) * power);
  }

  /* ------------------------------------------------------- the drunk roll */

  resolveActions(now) {
    for (const p of this.players) {
      if (p.input.pass) this.attemptKick(p, 'pass', now);
      else if (p.input.shoot) this.attemptKick(p, 'shoot', now);
    }
  }

  /*
   * The single entry point for every kick in open play. A human press, a bot press
   * and a wrong-foot rebound all arrive here and all roll the same table.
   */
  attemptKick(player, intent, now) {
    if (this.state.owner !== player) return;   // no possession, the press is ignored
    if (now < player.stunnedUntil) return;

    const outcome = rollOutcome(CONFIG.DRUNK.TABLE);

    switch (outcome) {
      case 'intended':
        this.doKick(player, intent, now);
        break;

      case 'wrongFoot':
        this.doKick(player, intent === 'pass' ? 'shoot' : 'pass', now);
        break;

      // Real power, completely random direction. Own goals very much on the table.
      case 'wildSlice':
        this.releaseBall(player, Phaser.Math.FloatBetween(0, Math.PI * 2),
          Phaser.Math.Between(CONFIG.KICK.sliceMinPower, CONFIG.KICK.sliceMaxPower),
          now, 'slice');
        break;

      // Connects but barely. Random direction, tiny power, possession gone.
      case 'fumble':
        this.releaseBall(player, Phaser.Math.FloatBetween(0, Math.PI * 2),
          CONFIG.KICK.passPower * Phaser.Math.FloatBetween(
            CONFIG.KICK.fumbleMinFactor, CONFIG.KICK.fumbleMaxFactor),
          now, 'fumble');
        break;

      // Total air kick. The ball is not touched and does not move.
      case 'whiff':
        player.stunnedUntil = now + CONFIG.DRUNK.stumbleMs;
        Renderer.onStumble(this, player, CONFIG.DRUNK.stumbleMs);
        break;

      case 'backheel':
        this.releaseBall(player, player.facing + Math.PI, CONFIG.KICK.backheelPower, now, 'backheel');
        break;

      // Falls over the ball. Possession gone, stunned, ball stays exactly where it is.
      case 'faceplant':
        player.stunnedUntil = now + CONFIG.DRUNK.faceplantMs;
        this.setOwner(null);
        this.ball.body.setVelocity(0, 0);
        Renderer.onFaceplant(this, player, CONFIG.DRUNK.faceplantMs);
        break;
    }

    // Intended actions show nothing, so the label appearing is itself the joke.
    if (outcome !== 'intended') Renderer.onOutcome(this, player, outcome);
  }

  doKick(player, kind, now) {
    const wobble = player.isBot ? CONFIG.BOT.aimWobbleDeg : 0;

    if (kind === 'pass') {
      const angle = player.facing + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-wobble, wobble));
      this.releaseBall(player, angle, CONFIG.KICK.passPower, now, 'pass');
      return;
    }

    const spread = CONFIG.KICK.shootSpreadDeg + wobble;
    const base = Phaser.Math.Angle.Between(
      this.ball.x, this.ball.y, player.targetGoalX, CONFIG.PITCH.centreY);
    const angle = base + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-spread, spread));
    this.releaseBall(player, angle, CONFIG.KICK.shootPower, now, 'shoot');
  }

  releaseBall(player, angle, power, now, kind) {
    this.setOwner(null);
    this.state.recaptureLockUntil = now + CONFIG.BALL.kickLockMs;
    this.ball.body.setVelocity(Math.cos(angle) * power, Math.sin(angle) * power);
    Renderer.onKick(this, player, kind, power);
  }

  /* --------------------------------------------------------- match flow */

  checkGoal(now) {
    const P = CONFIG.PITCH;
    const r = CONFIG.BALL.radius;
    if (this.ball.x + r <= P.left) { this.scoreGoal('blue', now); return true; }
    if (this.ball.x - r >= P.right) { this.scoreGoal('red', now); return true; }
    return false;
  }

  scoreGoal(team, now) {
    this.state.scores[team] += 1;
    // The side that conceded restarts with the ball.
    this.state.kickoffTeam = team === 'red' ? 'blue' : 'red';
    this.state.kickoffIsToss = false;
    this.state.phase = 'goal';
    this.state.phaseUntil = now + CONFIG.MATCH.goalPauseMs;
    this.setOwner(null);
    this.freezeEveryone();
    Renderer.updateHUD(this.hud, this.state.scores, this.state.timeLeft);
    Renderer.onGoal(this, team, this.state.scores);
  }

  startKickoff(now) {
    this.resetPositions();
    this.state.phase = 'kickoff';
    this.state.countLeft = CONFIG.MATCH.kickoffCount;
    this.state.nextCountAt = now;
    Renderer.onKickoff(this, this.state.kickoffTeam, this.state.kickoffIsToss);
  }

  updateCountdown(now) {
    if (now < this.state.nextCountAt) return;
    Renderer.onKickoffCount(this, this.state.countLeft);
    this.state.nextCountAt = now + CONFIG.MATCH.kickoffStepMs;
    this.state.countLeft -= 1;
    if (this.state.countLeft < 0) this.state.phase = 'play';
  }

  resetPositions() {
    const P = CONFIG.PITCH;

    // Kickoff facing is always toward the opponent's goal.
    this.red.facing = 0;
    this.blue.facing = Math.PI;

    // The side kicking off stands on the centre spot so the ball is already at its
    // feet. The other side waits at its fixed position in its own half.
    const kicking = this.state.kickoffTeam === 'blue' ? this.blue : this.red;
    const waiting = kicking === this.red ? this.blue : this.red;
    kicking.sprite.body.reset(
      P.centreX - Math.cos(kicking.facing) * CONFIG.BALL.carryDistance, P.centreY);
    waiting.sprite.body.reset(
      P.centreX + (waiting === this.red ? -1 : 1) * CONFIG.PLAYER.kickoffOffset, P.centreY);

    this.players.forEach((p) => {
      p.stunnedUntil = 0;
      p.input = makeInput();
      Renderer.onFacingChanged(this, p);
    });

    this.ball.body.reset(P.centreX, P.centreY);
    this.keepers.forEach((k) => k.sprite.body.reset(k.homeX, P.centreY));
    if (this.bot) {
      this.bot.queuedKick = null;
      this.bot.nextDecisionAt = 0;
      this.bot.targetX = this.blue.sprite.x;
      this.bot.targetY = this.blue.sprite.y;
    }
    this.state.recaptureLockUntil = 0;
    this.setOwner(kicking);
  }

  togglePause() {
    if (this.state.phase === 'over') return;
    this.state.paused = !this.state.paused;
    if (this.state.paused) {
      this.pauseView = Renderer.showPause(this);
    } else {
      Renderer.hidePause(this, this.pauseView);
      this.pauseView = null;
    }
  }

  endMatch() {
    this.state.timeLeft = 0;
    this.state.phase = 'over';
    this.freezeEveryone();
    Renderer.updateHUD(this.hud, this.state.scores, 0);

    const scores = { red: this.state.scores.red, blue: this.state.scores.blue };
    // Level at full time goes straight to penalties. No golden goal, no extra time.
    if (scores.red === scores.blue) this.scene.start('Penalty', { mode: this.mode, scores });
    else this.scene.start('FullTime', { mode: this.mode, scores, penalties: null });
  }
}

/* ==========================================================================
 * PenaltyScene — entered only on a level score at full time
 * ======================================================================= */

class PenaltyScene extends Phaser.Scene {
  constructor() { super('Penalty'); }

  init(data) {
    this.mode = data.mode;
    this.matchScores = data.scores;
  }

  create() {
    Renderer.makeTextures(this);
    this.geom = CONFIG.PENALTY.GEOM;
    this.view = Renderer.createPenaltyView(this, this.geom);

    this.keys = { red: keysFor(this, 'red'), blue: keysFor(this, 'blue') };

    this.keeper = { frozen: false, frozenUntil: 0, nextFreezeAt: 0, sprite: this.view.keeper };
    scheduleKeeperFreeze(this.keeper, this.time.now);

    this.tally = {
      red: [], blue: [],
      redScore: 0, blueScore: 0,
      round: 1,
      suddenDeath: false,
    };

    this.turn = 'red';
    this.phase = 'await';        // await | kicking | result
    this.resultUntil = 0;
    this.botKickAt = 0;

    this.beginTurn();
  }

  isHumanTurn() {
    return this.turn === 'red' || this.mode === 'two';
  }

  beginTurn() {
    Renderer.resetPenaltyKicker(this.view, this.turn);
    Renderer.updatePenaltyTally(this.view, this.tally);
    Renderer.setPenaltyResult(this.view, null);
    Renderer.setPenaltyPrompt(this.view, this.turn, this.isHumanTurn());
    if (!this.isHumanTurn()) {
      this.botKickAt = this.time.now + Phaser.Math.Between(
        CONFIG.PENALTY.botDelayMinMs, CONFIG.PENALTY.botDelayMaxMs);
    }
    this.phase = 'await';
  }

  update(time) {
    updateKeeperFreeze(this, this.keeper, time);

    if (this.phase === 'await') {
      if (this.isHumanTurn()) {
        const map = CONFIG.CONTROLS[this.turn];
        const keys = this.keys[this.turn];
        const JustDown = Phaser.Input.Keyboard.JustDown;
        const pass = JustDown(keys[map.pass]);
        const shoot = JustDown(keys[map.shoot]);
        if (pass) this.takePenalty('pass');
        else if (shoot) this.takePenalty('shoot');
      } else if (time >= this.botKickAt) {
        // The bot picks at random and rolls the same table as everyone else.
        this.takePenalty(Math.random() < 0.5 ? 'pass' : 'shoot');
      }
    } else if (this.phase === 'result' && time >= this.resultUntil) {
      this.advance();
    }
  }

  /*
   * Decides the result first, then hands the renderer a plan to animate. Whether the
   * kick scored is settled here and nowhere else.
   */
  takePenalty(intent) {
    this.phase = 'kicking';

    const G = this.geom;
    const outcome = rollOutcome(CONFIG.PENALTY.TABLE);
    const frozen = this.keeper.frozen;
    // The keeper picks a third at the moment of the kick, independently of the shot.
    const dive = Phaser.Utils.Array.GetRandom(CONFIG.PENALTY.thirds);

    const plan = { outcome, keeperFrozen: frozen, keeperY: G.thirdY[dive], slow: false };
    let scored = false;

    const strike = () => {
      const third = Phaser.Utils.Array.GetRandom(CONFIG.PENALTY.thirds);
      // A frozen keeper cannot dive, so a clean strike always beats it.
      scored = frozen || dive !== third;
      plan.ballY = G.thirdY[scored ? third : dive];
      plan.ballX = scored ? G.goalLineX + G.behindLineX
        : G.goalLineX - CONFIG.KEEPER.lineInset - G.keeperGapX;
    };

    const wide = (slow) => {
      scored = false;
      plan.slow = !!slow;
      plan.ballX = G.goalLineX + G.wideOffsetX;
      plan.ballY = Math.random() < 0.5 ? G.mouthTop - G.wideOffsetY : G.mouthBottom + G.wideOffsetY;
    };

    switch (outcome) {
      case 'clean':
        strike();
        break;

      case 'swapped':
        // Pass becomes a proper shot. Shoot becomes a limp pass that dribbles wide.
        if (intent === 'pass') strike();
        else wide(true);
        break;

      case 'skied':
        scored = false;
        plan.ballX = G.goalLineX + G.skiedOffsetX;
        plan.ballY = G.mouthTop - G.skiedOffsetY;
        break;

      // Barely connects and rolls at the keeper, who does not need to dive for it.
      case 'fumble':
        scored = frozen;
        plan.slow = true;
        plan.keeperY = G.spotY;
        plan.ballY = G.spotY;
        plan.ballX = scored ? G.goalLineX + G.behindLineX
          : G.goalLineX - CONFIG.KEEPER.lineInset - G.keeperGapX;
        break;

      case 'slice':
        wide(false);
        break;

      // The taker falls over. No contact with the ball at all.
      case 'faceplant':
        scored = false;
        plan.ballX = this.view.ball.x;
        plan.ballY = this.view.ball.y;
        break;
    }

    Renderer.playPenaltyKick(this, this.view, plan, () => this.settle(outcome, scored));
  }

  settle(outcome, scored) {
    const team = this.turn;
    this.tally[team].push(scored);
    if (scored) this.tally[team === 'red' ? 'redScore' : 'blueScore'] += 1;

    Renderer.setPenaltyResult(this.view, outcome, scored);
    Renderer.updatePenaltyTally(this.view, this.tally);
    Renderer.onPenaltyResult(this, team, outcome, scored);

    this.phase = 'result';
    this.resultUntil = this.time.now + CONFIG.PENALTY.resultHoldMs;
  }

  /* Best of five with the usual early finish, then sudden death pairs. */
  isDecided() {
    const t = this.tally;
    const each = CONFIG.PENALTY.kicksEach;

    if (t.red.length >= each && t.blue.length >= each) {
      return t.red.length === t.blue.length && t.redScore !== t.blueScore;
    }
    const redLeft = Math.max(0, each - t.red.length);
    const blueLeft = Math.max(0, each - t.blue.length);
    return t.redScore > t.blueScore + blueLeft || t.blueScore > t.redScore + redLeft;
  }

  advance() {
    if (this.isDecided()) {
      this.scene.start('FullTime', {
        mode: this.mode,
        scores: this.matchScores,
        penalties: { red: this.tally.redScore, blue: this.tally.blueScore },
      });
      return;
    }
    this.turn = this.turn === 'red' ? 'blue' : 'red';
    if (this.turn === 'red') this.tally.round += 1;
    this.tally.suddenDeath = this.tally.round > CONFIG.PENALTY.kicksEach;
    this.beginTurn();
  }
}

/* ==========================================================================
 * FullTimeScene
 * ======================================================================= */

class FullTimeScene extends Phaser.Scene {
  constructor() { super('FullTime'); }

  init(data) {
    this.mode = data.mode;
    this.scores = data.scores;
    this.penalties = data.penalties || null;
  }

  create() {
    Renderer.makeTextures(this);

    let winner = null;
    if (this.penalties) {
      winner = this.penalties.red > this.penalties.blue ? 'red' : 'blue';
    } else if (this.scores.red !== this.scores.blue) {
      winner = this.scores.red > this.scores.blue ? 'red' : 'blue';
    }

    const result = { scores: this.scores, penalties: this.penalties, winner };
    Renderer.createFullTime(this, result);
    Renderer.onFullTime(this, result);

    this.keys = this.input.keyboard.addKeys('SPACE,M');
  }

  update() {
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.keys.SPACE)) this.scene.start('Game', { mode: this.mode });
    else if (JustDown(this.keys.M)) this.scene.start('Menu');
  }
}

/* ========================================================================== */

/* Exposed so the game can be inspected from the console during development. */
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.CANVAS.width,
  height: CONFIG.CANVAS.height,
  backgroundColor: Renderer.canvasBackground(),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [MenuScene, GameScene, PenaltyScene, FullTimeScene],
});
