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

  /*
   * Thumb controls need somewhere to live that is not the pitch. There is nowhere: the
   * margin either side is 80px and a stick worth using is well over twice that. So on a
   * touch device the world gets wider, a gutter each side, and the pitch is left exactly
   * the size it always was and moved to the middle of it.
   *
   * Only the frame changes. PITCH.width and PITCH.height are untouched, so every distance
   * a ball travels and every angle a shot needs is the same game either way.
   */
  FRAME: { gutter: 210, wide: false },

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
    carryStepPx: 4,      // granularity when pulling a carried ball back out of a keeper
    kickLockMs: 250,     // stops the kicker instantly recapturing their own fumble
    tackleLockMs: 400,   // spec: no recapture for 400ms after a tackle
    tackleImpulseMin: 90,
    tackleImpulseMax: 190,
  },

  /*
   * What the pitch does underfoot. Skins are cosmetic everywhere else, so this is the one
   * place the choice reaches the mechanics, and the numbers live here with the rest of
   * the physics rather than in render.js. A skin only names the surface it is played on.
   *
   * grip is the fraction of the gap between current and intended velocity closed each
   * frame, so 1 is the instant response the game has always had and anything less slides.
   * ballDragScale multiplies BALL.drag, which stays the single source for how a ball rolls.
   */
  /*
   * What you are playing on. grip is how much of a change of direction happens at once,
   * ballDragScale is how hard the ground is on a rolling ball, and wears says the ground
   * gives up where it is played on.
   */
  SURFACES: {
    grass: { grip: 1, ballDragScale: 1 },
    ice: { grip: 0.12, ballDragScale: 0.55 },
    /* Ice with snow coming down on it: still slippery, but it grabs a little. */
    snow: { grip: 0.34, ballDragScale: 0.78 },
    /* A park pitch. Starts as grass and gets worse everywhere the ball is kicked. */
    mud: { grip: 1, ballDragScale: 1, wears: true },
  },
  SURFACE_BY_SKIN: { frozen: 'ice', sunday: 'mud' },

  /* Frozen is the only skin with weather, and it snows on one match in three. */
  WEATHER: { snowChance: 1 / 3 },

  /*
   * What a kick takes out of a park pitch. Every swing tears a bit more out of the ground
   * it was taken from and a little out of the ground around it, and a ball rolling through
   * the churn afterwards is a ball rolling through churn: by full time the middle of a
   * Sunday League match is a bog, and only where it was actually played.
   */
  WEAR: {
    cellPx: 56,
    perKick: 0.3,
    spread: 0.1,            // and this much into each of the four cells around it
    dragScale: 2.2,         // how much harder fully churned ground is than fresh grass
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

  /*
   * Aim assist, in three settings, and every one of them is bought rather than given: the
   * steadier your aim, the drunker you are when you swing at it. cleanTouchScale is what
   * the help costs, and it costs it out of the one weight on the drunk table that is any
   * use to you. Nothing else on that table moves, so what you buy is a straighter shot
   * and what you pay is more shots you never hit at all.
   *
   * Priced to hurt. A press comes off a third of the time sober, a bit over a quarter on
   * steady and one in five with the lot, which is the point: a setting nobody would think
   * twice about taking is not a setting, it is just the game being easier.
   *
   * Never for the bot, neither the help nor the price. Its aim is its aimWobbleDeg, which
   * is how a difficulty is set, and it rolls the plain table like it always has.
   *
   * A level says only what it changes, so off is an empty one and every unassisted number
   * stays the single copy of itself up in KICK.
   *
   * Deliberately weak. An earlier go at this shot within 2 degrees and put the ball in the
   * corner the keeper had left, which aimed the game for you. So the ladder is 7 degrees
   * of scatter down to 4, and the most the top setting does about the keeper is lean away
   * from him.
   */
  ASSIST: {
    openLeanPx: 50,         // how far inside the post to lean, which is nowhere near a corner
    LEVELS: [
      { key: 'off' },
      { key: 'steady', shootSpreadDeg: 5.5, passBendDeg: 10, cleanTouchScale: 0.7 },
      {
        key: 'full',
        shootSpreadDeg: 4,
        passBendDeg: 22,
        leanOffKeeper: true,
        cleanTouchScale: 0.5,
      },
    ],
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
    speed: 185,
    lineInset: 20,          // how far in front of the line the keeper stands
    deadZone: 4,
    /*
     * The keeper is a solid body, so without this every ball that reaches it is stopped,
     * always. This is the odds it gets a touch at all: fail the roll and the ball goes
     * straight through, which is the only way a well struck shot beats a keeper standing
     * in the right place.
     *
     * Rolled once per approach and held, or the coin would be flipped again every frame
     * the ball overlapped and no shot would ever get past.
     *
     * The odds are not the goal rate: a beaten keeper concedes shots it would otherwise
     * have stopped dead, so the effect is a good deal larger than the number suggests.
     * Measured over 250 seeded shots from the attacking third, at 185 speed:
     * always saves 16.0%, 0.97 19.6%, 0.94 22.4% and 23.6% on a second seed, 0.90 29.6%,
     * 0.82 34.4%. For reference the keeper before this change, at 210 speed and unbeatable,
     * conceded 14.4%.
     */
    saveChance: 0.94,
    beatenHoldMs: 600,
    /*
     * How stale the keeper's picture of the ball is. At 0 it reads the ball every frame
     * and is already standing on the line of the shot before you hit it, which no amount
     * of making it slower or smaller undoes: measured over 500 shots, cutting its speed
     * and its height moved conversion by less than a point. A delay is the only knob that
     * bites, because a shot is in the air for barely longer than this.
     *
     * Measured conversion from the attacking third: 0ms 11.6%, 110ms 15.0%, 180ms 19.0%.
     */
    reactionMs: 110,
    freezeEveryMinMs: 2000,
    freezeEveryMaxMs: 4000,
    freezeMinMs: 500,
    freezeMaxMs: 1000,
    clearMaxSpeed: 350,     // a ball arriving slower than this is gathered, not bounced
    clearPower: 520,        // how hard the keeper hoofs it back out
    clearSpreadDeg: 8,      // the keeper is a decent shot, but not a perfect one
  },

  MATCH: {
    durationSec: 180,
    goalPauseMs: 1300,
    kickoffCount: 3,        // counts 3, 2, 1 then GO
    kickoffStepMs: 450,
    /*
     * The walk out of the tunnel, before the first kickoff of a match and only that one.
     * Doing it again after every goal would be four seconds of walking for every thirty
     * of football.
     */
    entranceWalkMs: 1400,
    entranceGapMs: 320,     // the second one out comes a beat behind the first
  },

  /*
   * Difficulty is skill, never sobriety. Every bot rolls the same DRUNK.TABLE the human
   * does, so a hard bot is one that reacts quickly, reads pressure early and aims
   * straight. It mis-hits exactly as often as you do, it just wastes fewer of the
   * touches that come off. medium is the bot that shipped before difficulty existed.
   *
   * The knobs, once, so the three blocks below can stay a wall of numbers:
   *   reactionMinMs/MaxMs        how stale its picture of the pitch is between decisions
   *   chaseWobbleScale           how loosely it aims at a loose ball
   *   driftWobblePx              how much it wanders while carrying
   *   aimWobbleDeg               slop added to its every pass and shot
   *   shootProgress              fraction of the pitch covered before it shoots
   *   pressureRadius             how close you get before it counts as pressure
   *   passUnderPressureChance    odds it panics and hoofs the ball away when pressured
   */
  BOT: {
    steerDeadZonePx: 12,     // how close to the target counts as "arrived" per axis
    order: ['easy', 'medium', 'hard'],     // what 1, 2 and 3 mean, in order
    pickKeys: ['ONE', 'TWO', 'THREE'],
    padKeys: ['NUMPAD_ONE', 'NUMPAD_TWO', 'NUMPAD_THREE'],
    defaultLevel: 'medium',
    LEVELS: {
      easy: {
        reactionMinMs: 320,
        reactionMaxMs: 480,
        chaseWobbleScale: 0.6,
        driftWobblePx: 90,
        aimWobbleDeg: 16,
        shootProgress: 0.45,
        pressureRadius: 90,
        passUnderPressureChance: 0.5,
      },
      medium: {
        reactionMinMs: 150,
        reactionMaxMs: 250,
        chaseWobbleScale: 0.3,
        driftWobblePx: 55,
        aimWobbleDeg: 9,
        shootProgress: 0.6,
        pressureRadius: 150,
        passUnderPressureChance: 0.35,
      },
      hard: {
        reactionMinMs: 80,
        reactionMaxMs: 140,
        chaseWobbleScale: 0.12,
        driftWobblePx: 25,
        aimWobbleDeg: 4,
        shootProgress: 0.68,
        pressureRadius: 200,
        passUnderPressureChance: 0.15,
      },
    },
  },

  PENALTY: {
    kicksEach: 5,
    thirds: ['top', 'centre', 'bottom'],   // what 1, 2 and 3 mean, in order
    pickKeys: ['ONE', 'TWO', 'THREE'],
    padKeys: ['NUMPAD_ONE', 'NUMPAD_TWO', 'NUMPAD_THREE'],
    botDelayMinMs: 700,
    botDelayMaxMs: 1400,
    kickAnimMs: 520,
    resultHoldMs: 1200,
    /*
     * The shootout is staged on the real pitch at blue's goal, so the goal line, mouth
     * and depth are the pitch's own and are derived below rather than set here. What is
     * left is where the spot sits and how far a miss travels past the line, and those
     * are bounded by the strip of surround behind the goal: keep every offset under
     * about 70px or a skied ball flies off the right edge of the canvas.
     */
    GEOM: {
      spotInset: 88,         // penalty spot, back from blue's goal line
      takerOffsetX: 54,      // how far behind the ball the taker stands
      behindLineX: 32,       // where a scoring ball settles past the line
      keeperGapX: 14,        // gap between a saved ball and the keeper
      wideOffsetX: 26,
      wideOffsetY: 62,       // clear of the post
      skiedOffsetX: 58,
      skiedOffsetY: 128,     // over the bar
    },
    /*
     * Separate table. The taker's intent barely matters, which is the point.
     *
     * The taker picks a third, the keeper dives to a third chosen independently, so an
     * on-target kick beats an active keeper 2 times in 3 and a frozen one every time.
     * Weighted so the whole thing converts at roughly a third: clean and wrongNumber
     * are the only ways to be on target, and fumble only scores past a frozen keeper.
     */
    TABLE: [
      { key: 'clean',       weight: 26 },   // goes exactly where you asked
      { key: 'wrongNumber', weight: 15 },   // on target, just not the third you picked
      { key: 'skied',       weight: 20 },
      { key: 'fumble',      weight: 15 },
      { key: 'slice',       weight: 19 },
      { key: 'faceplant',   weight: 5 },
    ],
  },

  FEEDBACK: {
    labelMs: 700,
  },

  /* Pass sits left of Shoot for both players, within reach of the movement hand. */
  CONTROLS: {
    red:  { up: 'W', down: 'S', left: 'A', right: 'D', pass: 'C', shoot: 'V' },
    blue: { up: 'I', down: 'K', left: 'J', right: 'L', pass: 'MINUS', shoot: 'PLUS' },
  },

  /*
   * What a thumb on the on-screen stick means. The stick reports a direction as a fraction
   * of its own travel and nothing else, so these are the only two numbers that decide how
   * it plays; where it sits and how big it is are render.js's business.
   */
  TOUCH: {
    // How far the thumb has to move before the stick counts as pushed at all, so resting
    // one on the glass does not walk you into a wall.
    deadZone: 0.22,
    /*
     * Eight ways, exactly what the keys give, because a diagonal is both of its neighbours
     * held at once. This is the share of the push an axis needs before it counts, and
     * sin(22.5 degrees) makes all eight sectors the same size. Nothing finer, deliberately:
     * a thumb, a keyboard and the bot fill in the same six booleans and reach the same
     * speeds, and the bot cannot be given a movement a player has no way to ask for.
     */
    axisShare: 0.3827,
  },
};

/*
 * What the keys were before anybody changed them, kept whole so RESET has something to
 * reset to. Copied rather than referenced, because CONFIG.CONTROLS is what gets rebound.
 */
const DEFAULT_CONTROLS = JSON.parse(JSON.stringify(CONFIG.CONTROLS));

/* The six things a player can ask for, in the order the rebinding screen lists them. */
const ACTIONS = [
  { key: 'up', name: 'Up' },
  { key: 'down', name: 'Down' },
  { key: 'left', name: 'Left' },
  { key: 'right', name: 'Right' },
  { key: 'pass', name: 'Pass' },
  { key: 'shoot', name: 'Shoot' },
];

/*
 * Keys the match itself answers to, so binding a player to one would pause the game every
 * time they tried to run. R, S and Q are deliberately not here: they only mean anything
 * while the pause menu is up, and nobody is running about at the time.
 */
const RESERVED_KEYS = { ESC: 'pauses', P: 'pauses', M: 'switches the mouse scheme' };

/*
 * A browser keydown carries a code; Phaser wants a name. Reversing its own table keeps
 * both sides speaking the same vocabulary, so whatever is stored can be handed straight
 * back to addKeys.
 */
function keyNameFor(keyCode) {
  const codes = Phaser.Input.Keyboard.KeyCodes;
  return Object.keys(codes).find((name) => codes[name] === keyCode) || null;
}

/* Whoever already answers to this key, if anyone does. */
function boundTo(name) {
  let found = null;
  Object.keys(CONFIG.CONTROLS).forEach((team) => {
    ACTIONS.forEach((action) => {
      if (!found && CONFIG.CONTROLS[team][action.key] === name) found = { team, action };
    });
  });
  return found;
}

/*
 * Derived geometry, so the numbers above stay the only things worth editing.
 *
 * Called rather than run on the spot, because whether the world is the wide one depends on
 * a saved preference, and preferences are not loaded yet when this file is read.
 */
function deriveGeometry() {
  const P = CONFIG.PITCH;
  P.width = P.right - P.left;
  P.height = P.bottom - P.top;
  P.centreX = P.left + P.width / 2;
  P.centreY = P.top + P.height / 2;
  P.mouthTop = P.centreY - P.goalMouth / 2;
  P.mouthBottom = P.centreY + P.goalMouth / 2;

  // Penalties happen at blue's goal, the right-hand one, on the same pitch the match is
  // played on. Every shared number comes straight from the pitch so the two can't drift.
  const G = CONFIG.PENALTY.GEOM;
  G.goalLineX = P.right;
  G.goalDepth = P.goalDepth;
  G.mouthHeight = P.goalMouth;
  G.mouthTop = P.mouthTop;
  G.mouthBottom = P.mouthBottom;
  G.spotX = P.right - G.spotInset;
  G.spotY = P.centreY;
  G.thirdY = {
    top: G.mouthTop + G.mouthHeight / 6,
    centre: G.spotY,
    bottom: G.mouthBottom - G.mouthHeight / 6,
  };
}

/*
 * Widen the world and slide the pitch into the middle of it. Everything else on every
 * screen is either centred on the canvas or measured from the pitch, so both follow.
 */
function useWideFrame() {
  const F = CONFIG.FRAME;
  if (F.wide) return;
  F.wide = true;
  CONFIG.CANVAS.width += F.gutter * 2;
  CONFIG.PITCH.left += F.gutter;
  CONFIG.PITCH.right += F.gutter;
}

deriveGeometry();

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

/*
 * How red is driven, beyond the keys. Kept outside the scenes so a choice survives a
 * rematch, and both of these are one-player only: two humans cannot share one pointer, and
 * they certainly cannot share one phone.
 *
 * redUsesMouse is the click scheme: left click passes, right click shoots. Nothing else
 * changes, so red still faces wherever it is running and a kick goes where it always did.
 * M turns it off during a match for anyone who would rather keep both hands on the keys.
 *
 * touch is 'auto', 'on' or 'off' for the on-screen stick and buttons. Auto asks the
 * device, which is a guess, which is why the other two exist.
 */
const AIM = { redUsesMouse: true, touch: 'auto', assist: 'off' };
const TOUCH_MODES = ['auto', 'on', 'off'];
const ASSIST_KEYS = CONFIG.ASSIST.LEVELS.map((level) => level.key);

/* Whatever is stored, something sane comes back: the first level is off. */
function assistByKey(key) {
  return CONFIG.ASSIST.LEVELS.find((level) => level.key === key) || CONFIG.ASSIST.LEVELS[0];
}

/*
 * A coarse pointer with no fine one anywhere is a phone or a tablet. A laptop with a
 * touchscreen reports both, and it has a keyboard, so it is left alone.
 */
function deviceIsTouch() {
  if (!window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches
    && !window.matchMedia('(any-pointer: fine)').matches;
}

function touchWanted() {
  if (AIM.touch === 'on') return true;
  if (AIM.touch === 'off') return false;
  return deviceIsTouch();
}

/*
 * ?wide on the address builds the world a phone gets, whatever the controls are set to:
 * the suite plays both frames that way, and it is how that frame gets looked at on a
 * desktop. The frame only, not the thumb controls, which stay the setting's business.
 *
 * Read here rather than set from the page, because the game boots off a promise: with the
 * display face already cached that boot runs as a microtask, and microtasks drain before
 * the next script tag on the page has run at all. A flag set from the page arrived after
 * the canvas had been sized, so half the suite quietly played the narrow frame twice and
 * a written down coordinate got through it.
 */
function wideFrameAsked() {
  return window.location.search.indexOf('wide') !== -1;
}

/*
 * Legacy mode is the game as it stood at the commit that put blue's kicks on - and =,
 * kept whole in legacy/ rather than reconstructed from flags. Every feature added since
 * would need its own conditional otherwise, and a copy is the honest article: the same
 * files that shipped that day, with a button on the page to come back.
 */
const LEGACY_URL = 'legacy/';

/*
 * The settings screen promises these are kept, so they are. The skin looks after itself in
 * render.js; this is everything else. Storage throws in private browsing, and a forgotten
 * preference is not worth a crash.
 */
const PREFS_KEY = 'drunkfootball.prefs';

function loadPrefs() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(PREFS_KEY);
  } catch (err) { raw = null; }

  if (raw) {
    let saved = null;
    try {
      saved = JSON.parse(raw);
    } catch (err) { saved = null; }
    if (saved && typeof saved.redUsesMouse === 'boolean') AIM.redUsesMouse = saved.redUsesMouse;
    if (saved && TOUCH_MODES.indexOf(saved.touch) !== -1) AIM.touch = saved.touch;
    // An older build stored this as a switch, and on meant everything now called full.
    if (saved && typeof saved.assist === 'boolean') AIM.assist = saved.assist ? 'full' : 'off';
    if (saved && ASSIST_KEYS.indexOf(saved.assist) !== -1) AIM.assist = saved.assist;
    if (saved && saved.controls) applySavedControls(saved.controls);
  }
}

/*
 * Every binding is checked against Phaser's own key table on the way in. Storage can hold
 * anything, including the leftovers of an older version of this game, and a control map
 * with a key nobody can press is a match you cannot move in.
 */
function applySavedControls(saved) {
  Object.keys(DEFAULT_CONTROLS).forEach((team) => {
    if (!saved[team]) return;
    ACTIONS.forEach((action) => {
      const name = saved[team][action.key];
      if (typeof name === 'string' && Phaser.Input.Keyboard.KeyCodes[name] !== undefined) {
        CONFIG.CONTROLS[team][action.key] = name;
      }
    });
  });
}

function savePrefs() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({
      redUsesMouse: AIM.redUsesMouse,
      touch: AIM.touch,
      assist: AIM.assist,
      controls: CONFIG.CONTROLS,
    }));
  } catch (err) { /* nothing worth doing */ }
}

/*
 * Phaser names number keys rather than taking the character, so binding "the nth item in
 * a list" needs a lookup. Indexed rather than hardcoded, so a list that grows keeps
 * working: the settings screen used to bind three keys and special-case a fourth, which
 * is precisely why a fifth skin could be shown but not chosen.
 */
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const NUMPAD_KEYS = DIGIT_KEYS.map((name) => 'NUMPAD_' + name);

/*
 * Shared by every menu screen. A new palette means the baked sprites are the wrong
 * colours and the drawn pitch is stale, so the honest fix is to rebuild both and redraw
 * the screen you are standing on.
 */
function chooseSkin(scene, key) {
  Renderer.applySkin(key);
  // The restart is what repaints: the new scene rebakes the stale textures before it has
  // drawn anything, which is the only moment it is safe to throw the old ones away.
  if (scene.refresh) scene.refresh();
  else scene.scene.restart();
}

/* ==========================================================================
 * MenuScene
 * ======================================================================= */

class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    Renderer.beginScene(this);
    Renderer.createMenu(this, (index) => this.pick(index), touchWanted());
    this.keys = this.input.keyboard.addKeys('ONE,TWO,NUMPAD_ONE,NUMPAD_TWO');
  }

  /* The single place a menu choice means anything, whether it arrived by key or click. */
  pick(index) {
    this.scene.start(index === 0 ? 'Play' : 'Settings');
  }

  update() {
    const k = this.keys;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(k.ONE) || JustDown(k.NUMPAD_ONE)) this.pick(0);
    else if (JustDown(k.TWO) || JustDown(k.NUMPAD_TWO)) this.pick(1);
  }
}

/* ==========================================================================
 * PlayScene — what kind of game, once you have said you want one
 * ======================================================================= */

class PlayScene extends Phaser.Scene {
  constructor() { super('Play'); }

  create() {
    Renderer.beginScene(this);
    Renderer.createPlay(this, (index) => this.pick(index));
    this.keys = this.input.keyboard.addKeys(
      'ONE,TWO,THREE,NUMPAD_ONE,NUMPAD_TWO,NUMPAD_THREE');
    this.backKey = this.input.keyboard.addKey('ESC');
  }

  pick(index) {
    if (index === 0) this.scene.start('Difficulty');
    else if (index === 1) this.scene.start('Game', { mode: 'two' });
    else this.scene.start('PenaltyMode');
  }

  update() {
    const k = this.keys;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.backKey)) this.scene.start('Menu');
    else if (JustDown(k.ONE) || JustDown(k.NUMPAD_ONE)) this.pick(0);
    else if (JustDown(k.TWO) || JustDown(k.NUMPAD_TWO)) this.pick(1);
    else if (JustDown(k.THREE) || JustDown(k.NUMPAD_THREE)) this.pick(2);
  }
}

/* ==========================================================================
 * SettingsScene — the skin, and whether red's mouse buttons kick
 * ======================================================================= */

class SettingsScene extends Phaser.Scene {
  constructor() { super('Settings'); }

  /*
   * Reached either from the front screen, where leaving means the menu, or from a paused
   * match, where it is running on top of a game that is still there and leaving means
   * going back to it.
   */
  init(data) {
    const from = data && data.returnTo;
    // Phaser hands a scene its previous data again when it is started without any, so a
    // returnTo can outlive the match that set it. There is a way back only if that scene
    // really is still sitting underneath us, paused.
    this.returnTo = from && this.scene.isPaused(from) ? from : null;
  }

  create() {
    Renderer.beginScene(this);
    Renderer.createSettings(this, {
      mouseClicks: AIM.redUsesMouse,
      touch: AIM.touch,
      assist: AIM.assist,
      volume: Sound.step,
      inMatch: !!this.returnTo,
    }, {
      skin: (key) => chooseSkin(this, key),
      mouse: () => this.toggleMouse(),
      touch: () => this.cycleTouch(),
      assist: () => this.cycleAssist(),
      volume: (step) => this.setVolume(step),
      stadium: () => this.cycleStadium(),
      keys: () => this.scene.start('Keys', { returnTo: this.returnTo }),
      legacy: () => { window.location.href = LEGACY_URL; },
    });
    // One key per skin, however many there are, so the numbers on screen and the numbers
    // that work can never disagree again.
    this.skinCount = Math.min(Renderer.SKINS.length, DIGIT_KEYS.length);
    const bindings = [];
    for (let i = 0; i < this.skinCount; i++) bindings.push(DIGIT_KEYS[i], NUMPAD_KEYS[i]);
    this.keys = this.input.keyboard.addKeys(
      bindings.concat(['M', 'T', 'A', 'V', 'G', 'K', 'L']).join(','));
    this.backKey = this.input.keyboard.addKey('ESC');
  }

  /*
   * Back where we came from. Launched over a paused match this only stops itself, leaving
   * the match exactly as it was, still paused with its menu up.
   */
  leave() {
    if (!this.returnTo) {
      this.scene.start('Menu');
      return;
    }
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }

  /* Restarting has to carry where we came from, or leaving would forget the match. */
  refresh() {
    this.scene.restart({ returnTo: this.returnTo });
  }

  toggleMouse() {
    AIM.redUsesMouse = !AIM.redUsesMouse;
    savePrefs();
    this.refresh();
  }

  /* Cycled rather than toggled, because there are three answers and one of them is auto. */
  cycleTouch() {
    const next = (TOUCH_MODES.indexOf(AIM.touch) + 1) % TOUCH_MODES.length;
    AIM.touch = TOUCH_MODES[next];
    savePrefs();

    /*
     * Thumb controls come with a wider world, and a canvas cannot be resized once the game
     * is running. So when the answer actually changes, start the page again rather than
     * leave a setting that claims to be on and plainly is not.
     */
    if (touchWanted() !== CONFIG.FRAME.wide) {
      this.restartForFrame();
      return;
    }
    this.refresh();
  }

  /* Its own method so the suite can cycle the setting without taking the page with it. */
  restartForFrame() {
    window.location.reload();
  }

  /* Cycled rather than toggled: there are three answers and one of them is off. */
  cycleAssist() {
    const next = (ASSIST_KEYS.indexOf(AIM.assist) + 1) % ASSIST_KEYS.length;
    AIM.assist = ASSIST_KEYS[next];
    savePrefs();
    this.refresh();
  }

  /*
   * Volume, from the bar or from the key. The bar hands over the block that was clicked;
   * the key has no block to name, so it steps up and comes round to silence off the top.
   */
  setVolume(step) {
    if (step === undefined) Sound.nextStep();
    else Sound.setStep(step);
    this.refresh();
  }

  stepVolume() {
    this.setVolume(undefined);
  }

  /* Four answers here: random, and each of the three grounds pinned. */
  cycleStadium() {
    const list = Renderer.STADIUM_CHOICES;
    Renderer.saveStadium(list[(list.indexOf(Renderer.stadiumChoice) + 1) % list.length]);
    this.refresh();
  }


  update() {
    const JustDown = Phaser.Input.Keyboard.JustDown;

    if (JustDown(this.backKey)) {
      this.leave();
      return;
    }
    if (JustDown(this.keys.M)) {
      this.toggleMouse();
      return;
    }
    if (JustDown(this.keys.T)) {
      this.cycleTouch();
      return;
    }
    if (JustDown(this.keys.A)) {
      this.cycleAssist();
      return;
    }
    if (JustDown(this.keys.V)) {
      this.stepVolume();
      return;
    }
    if (JustDown(this.keys.G)) {
      this.cycleStadium();
      return;
    }
    if (JustDown(this.keys.K)) {
      this.scene.start('Keys', { returnTo: this.returnTo });
      return;
    }
    if (JustDown(this.keys.L)) {
      window.location.href = LEGACY_URL;
      return;
    }

    // The number beside a skin picks it, from either the row or the numpad.
    for (let i = 0; i < this.skinCount; i++) {
      if (JustDown(this.keys[DIGIT_KEYS[i]]) || JustDown(this.keys[NUMPAD_KEYS[i]])) {
        chooseSkin(this, Renderer.SKINS[i].key);
        return;
      }
    }
  }
}

/* ==========================================================================
 * KeysScene — change what everybody presses
 * ======================================================================= */

class KeysScene extends Phaser.Scene {
  constructor() { super('Keys'); }

  /* Carried through, so leaving lands wherever settings would have landed. */
  init(data) {
    this.returnTo = (data && data.returnTo) || null;
    // Carried through the restart that redraws this screen, or asking for a key would
    // forget it had asked the moment it repainted.
    this.capturing = (data && data.capturing) || null;
    this.message = (data && data.message) || '';
  }

  create() {
    Renderer.beginScene(this);
    Renderer.createKeysScreen(this, {
      actions: ACTIONS,
      capturing: this.capturing,
      message: this.message,
    }, {
      rebind: (team, action) => this.beginCapture(team, action),
      reset: () => this.resetAll(),
    });

    this.sceneKeys = this.input.keyboard.addKeys('ESC,R');

    /*
     * Every key press on this screen is a candidate binding, so they are read raw rather
     * than through bound Key objects. Nothing else here listens while a capture is open.
     */
    const onKey = (event) => this.captured(event);
    this.input.keyboard.on('keydown', onKey);
    this.events.once('shutdown', () => this.input.keyboard.off('keydown', onKey));
  }

  beginCapture(team, action) {
    this.capturing = { team, action };
    this.message = '';
    this.redraw();
  }

  captured(event) {
    if (!this.capturing) return;
    event.preventDefault();

    const name = keyNameFor(event.keyCode);
    const { team, action } = this.capturing;

    // Escape backs out of the capture rather than out of the screen: leaving mid-question
    // with nothing bound would be the surprising thing.
    if (name === 'ESC') {
      this.capturing = null;
      this.message = 'left ' + Renderer.TEAM_NAME[team] + ' ' + action.name + ' alone';
      this.redraw();
      return;
    }

    if (!name) {
      this.message = 'that key has no name the game knows';
      this.redraw();
      return;
    }
    if (RESERVED_KEYS[name]) {
      this.message = Renderer.keyLabel(name) + ' already ' + RESERVED_KEYS[name];
      this.redraw();
      return;
    }

    const taken = boundTo(name);
    if (taken && !(taken.team === team && taken.action.key === action.key)) {
      this.message = Renderer.keyLabel(name) + ' is already '
        + Renderer.TEAM_NAME[taken.team] + ' ' + taken.action.name.toLowerCase();
      this.redraw();
      return;
    }

    CONFIG.CONTROLS[team][action.key] = name;
    savePrefs();
    this.capturing = null;
    this.message = Renderer.TEAM_NAME[team] + ' ' + action.name.toLowerCase() + ' is now '
      + Renderer.keyLabel(name);
    this.redraw();
  }

  resetAll() {
    Object.keys(DEFAULT_CONTROLS).forEach((team) => {
      ACTIONS.forEach((a) => { CONFIG.CONTROLS[team][a.key] = DEFAULT_CONTROLS[team][a.key]; });
    });
    savePrefs();
    this.capturing = null;
    this.message = 'back to the keys it came with';
    this.redraw();
  }

  /* The screen is drawn from the bindings, so changing one means drawing it again. */
  redraw() {
    this.scene.restart({
      returnTo: this.returnTo,
      capturing: this.capturing,
      message: this.message,
    });
  }

  /*
   * Back to settings, which is where this was reached from, and settings knows whether
   * there is a paused match behind it to go back to after that.
   */
  leave() {
    this.scene.start('Settings', { returnTo: this.returnTo });
  }

  update() {
    if (this.capturing) return;   // every key belongs to the capture while one is open
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.sceneKeys.ESC)) this.leave();
    else if (JustDown(this.sceneKeys.R)) this.resetAll();
  }
}

/* ==========================================================================
 * PenaltyModeScene — who is taking them, when the shootout is the whole game
 * ======================================================================= */

class PenaltyModeScene extends Phaser.Scene {
  constructor() { super('PenaltyMode'); }

  create() {
    Renderer.beginScene(this);
    Renderer.createPenaltyMode(this, (index) => this.pick(index));
    this.keys = this.input.keyboard.addKeys('ONE,TWO,NUMPAD_ONE,NUMPAD_TWO');
    this.backKey = this.input.keyboard.addKey('ESC');
  }

  pick(index) {
    this.scene.start('Penalty', { mode: index === 0 ? 'bot' : 'two', standalone: true });
  }

  update() {
    const k = this.keys;
    const JustDown = Phaser.Input.Keyboard.JustDown;

    if (JustDown(this.backKey)) this.scene.start('Play');
    else if (JustDown(k.ONE) || JustDown(k.NUMPAD_ONE)) this.pick(0);
    else if (JustDown(k.TWO) || JustDown(k.NUMPAD_TWO)) this.pick(1);
  }
}

/* ==========================================================================
 * DifficultyScene — which bot you are up against
 * ======================================================================= */

class DifficultyScene extends Phaser.Scene {
  constructor() { super('Difficulty'); }

  create() {
    Renderer.beginScene(this);
    Renderer.createDifficulty(this, (index) => this.pick(index));

    // Same 1/2/3 shape as the penalty picker, numpad equivalents accepted.
    this.pickKeys = this.input.keyboard.addKeys(
      CONFIG.BOT.pickKeys.concat(CONFIG.BOT.padKeys).join(','));
    this.backKey = this.input.keyboard.addKey('ESC');
  }

  pick(index) {
    this.scene.start('Game', { mode: 'bot', difficulty: CONFIG.BOT.order[index] });
  }

  update() {
    const JustDown = Phaser.Input.Keyboard.JustDown;

    if (JustDown(this.backKey)) {
      this.scene.start('Play');
      return;
    }

    for (let i = 0; i < CONFIG.BOT.pickKeys.length; i++) {
      if (JustDown(this.pickKeys[CONFIG.BOT.pickKeys[i]])
        || JustDown(this.pickKeys[CONFIG.BOT.padKeys[i]])) {
        this.pick(i);
        break;
      }
    }
  }
}

/* ==========================================================================
 * GameScene — the match
 * ======================================================================= */

class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.mode = (data && data.mode) || 'bot';

    // Resolved once here so every bot read is a plain property lookup, and so a rematch
    // arriving from full time with a stale or missing level still starts a match.
    const asked = (data && data.difficulty) || CONFIG.BOT.defaultLevel;
    this.difficulty = CONFIG.BOT.LEVELS[asked] ? asked : CONFIG.BOT.defaultLevel;
    this.botCfg = CONFIG.BOT.LEVELS[this.difficulty];

    /*
     * The chosen skin decides what you are playing on, and it is decided again in create
     * once the weather has been rolled. Set here as well because a scene can be asked
     * about its surface before its pitch exists.
     */
    this.surface = this.surfaceNow();
  }

  /*
   * Anything unmapped is grass. Snow is the exception that is not the skin's: it is rolled
   * with the pitch, and snow lying on ice is not ice.
   */
  surfaceNow() {
    if (Renderer.snowing) return CONFIG.SURFACES.snow;
    return CONFIG.SURFACES[CONFIG.SURFACE_BY_SKIN[Renderer.activeSkin]]
      || CONFIG.SURFACES.grass;
  }

  create() {
    const P = CONFIG.PITCH;

    Renderer.beginScene(this);
    Renderer.createPitch(this);
    // After the pitch, because drawing it is what rolls the weather.
    this.surface = this.surfaceNow();
    this.wear = this.surface.wears ? this.freshPitch() : null;

    this.physics.world.setBounds(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);
    this.pitchBounds = new Phaser.Geom.Rectangle(P.left, P.top, P.width, P.height);

    this.state = {
      scores: { red: 0, blue: 0 },
      timeLeft: CONFIG.MATCH.durationSec,
      phase: 'kickoff',            // entrance | kickoff | play | goal | over
      phaseUntil: 0,
      entrance: null,         // who is still walking out, and from where
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
    const ballDrag = CONFIG.BALL.drag * this.surface.ballDragScale;
    this.ball.body.setDrag(ballDrag, ballDrag);
    this.ball.body.setBounce(CONFIG.BALL.bounce, CONFIG.BALL.bounce);
    this.ball.body.setMaxVelocity(CONFIG.BALL.maxSpeed, CONFIG.BALL.maxSpeed);

    this.keepers = CONFIG.KEEPER.enabled
      ? [this.makeKeeper('left'), this.makeKeeper('right')]
      : [];

    this.physics.add.collider(this.ball, this.walls, (ball) => {
      Renderer.onWallBounce(this, ball.x, ball.y, ball.body.speed);
    });
    this.keepers.forEach((keeper) => {
      // The process callback decides whether the bodies separate at all, so a keeper that
      // fails its roll simply is not there for this ball.
      this.physics.add.collider(this.ball, keeper.sprite,
        () => this.keeperContact(keeper),
        () => this.keeperReaches(keeper));
      // Keepers are solid to players as well as to the ball. Without this a dribbler
      // walks its body straight through the keeper and takes the ball with it.
      this.players.forEach((p) => this.physics.add.collider(p.sprite, keeper.sprite));
    });

    this.keys = { red: keysFor(this, 'red'), blue: keysFor(this, 'blue') };
    this.systemKeys = this.input.keyboard.addKeys('P,ESC,M,R,S,Q');

    // The keys can be changed from settings while this match sits paused underneath, so
    // they are read again on the way back in rather than only once at kick off.
    this.events.on('resume', () => this.rebindKeys());

    // Without this the browser's own menu swallows every right click.
    this.input.mouse.disableContextMenu();
    this.queuedClick = null;
    this.input.on('pointerdown', (pointer) => {
      if (!this.redUsesMouse()) return;
      this.queuedClick = pointer.rightButtonDown() ? 'shoot' : 'pass';
    });

    /*
     * Thumb controls, and only for a one-player match: two people cannot share one phone,
     * which is the same reason the click scheme is one-player only.
     */
    this.touch = this.mode === 'bot' && touchWanted()
      ? { x: 0, y: 0, queuedKick: null }
      : null;

    this.hud = Renderer.createHUD(this, {
      mode: this.mode,
      difficulty: this.difficulty,
      mouseClicks: this.redUsesMouse(),
      touch: !!this.touch,
    });

    // Cleared rather than left: Phaser reuses the same scene object for every match, so a
    // view from the last one outlives the objects it is made of, and hiding it on the next
    // pause would reach into things that have been destroyed.
    this.touchView = null;
    if (this.touch) {
      this.touchView = Renderer.createTouchControls(this, {
        move: (x, y) => { this.touch.x = x; this.touch.y = y; },
        pass: () => { this.touch.queuedKick = 'pass'; },
        shoot: () => { this.touch.queuedKick = 'shoot'; },
        pause: () => this.togglePause(),
      });
    }
    this.view = {
      players: this.players,
      ball: this.ball,
      keepers: this.keepers,
      state: this.state,
      hud: this.hud,
    };

    this.pauseView = null;
    this.ballApproachSpeed = 0;
    // Who starts with the ball is a coin toss, fresh for every match.
    this.state.kickoffTeam = Math.random() < 0.5 ? 'red' : 'blue';
    this.state.kickoffIsToss = true;
    this.startEntrance(this.time.now);
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
      nextLookAt: 0,
      targetY: P.centreY,
      beatenUntil: 0,
      reachedUntil: 0,
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
    // A scene that has been stopped can still take one more update after its objects have
    // been destroyed, and everything below here assumes there is a match to run.
    if (!this.ball || !this.ball.body) return;

    Renderer.onTick(this, this.view, time, delta);

    const pausePressed = Phaser.Input.Keyboard.JustDown(this.systemKeys.P);
    const escPressed = Phaser.Input.Keyboard.JustDown(this.systemKeys.ESC);
    if (pausePressed || escPressed) this.togglePause();

    // Swapping works while paused too, which is when you are most likely to want it.
    // In a two-player match there is nothing to swap, so the key is left alone.
    if (this.mode === 'bot' && Phaser.Input.Keyboard.JustDown(this.systemKeys.M)) {
      AIM.redUsesMouse = !AIM.redUsesMouse;
      savePrefs();
      Renderer.updateControlHint(this.hud, this.redUsesMouse());
    }

    if (this.state.paused || this.state.phase === 'over') {
      // The pause menu's own keys, live only while it is up.
      if (this.state.paused) {
        const JustDown = Phaser.Input.Keyboard.JustDown;
        if (JustDown(this.systemKeys.R)) this.togglePause();
        else if (JustDown(this.systemKeys.S)) this.openSettings();
        else if (JustDown(this.systemKeys.Q)) this.scene.start('Menu');
      }
      this.freezeEveryone();
      return;
    }

    switch (this.state.phase) {
      case 'entrance':
        this.freezeEveryone();
        this.updateEntrance(delta);
        break;
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
    // The ball is dragged by the ground it is on rather than by the ground in general, so
    // this is asked again every frame on a pitch that wears.
    if (this.wear) {
      const drag = this.ballDragNow();
      this.ball.body.setDrag(drag, drag);
    }
    this.readInput(time);
    this.players.forEach((p) => this.movePlayer(p, time));
    this.keepers.forEach((k) => this.updateKeeper(k, time));
    this.resolveActions(time);
    this.updatePossession(time);

    // Arcade steps on the scene's UPDATE event, which fires BEFORE scene.update, so the
    // next physics step runs before this method is called again and uses exactly the
    // velocity recorded here. That makes this the speed the ball is travelling at when
    // it reaches a keeper. Recorded after the kicks are resolved, otherwise a point
    // blank shot would still look stationary to the keeper it was struck against.
    this.ballApproachSpeed = this.ball.body.velocity.length();

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
    this.queuedClick = null;   // consumed or not, a click is worth exactly one frame
    if (this.touch) this.touch.queuedKick = null;   // and so is a tap
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

    // A click is just another way of pressing the same button, so it fills in the same
    // struct and runs down the identical kick path, drunk roll and all.
    if (this.queuedClick && this.mouseKicker(player)) input[this.queuedClick] = true;

    // And so is a thumb. Red's, and only red's.
    if (this.touch && player === this.red) this.applyTouch(input);
  }

  /*
   * The stick's direction, folded into the same four booleans the keys set. Written as
   * "set true if", never as an assignment, so a thumb adds to what the keyboard is doing
   * rather than cancelling it: anyone playing a tablet with a keyboard plugged in can use
   * whichever is nearer.
   */
  applyTouch(input) {
    const t = this.touch;
    const T = CONFIG.TOUCH;
    const len = Math.sqrt(t.x * t.x + t.y * t.y);

    if (len > T.deadZone) {
      if (t.x / len < -T.axisShare) input.left = true;
      else if (t.x / len > T.axisShare) input.right = true;
      if (t.y / len < -T.axisShare) input.up = true;
      else if (t.y / len > T.axisShare) input.down = true;
    }

    if (t.queuedKick) input[t.queuedKick] = true;
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
        this.botCfg.reactionMinMs, this.botCfg.reactionMaxMs);
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
    const wobble = () => Phaser.Math.FloatBetween(-1, 1) * this.botCfg.driftWobblePx;

    if (this.state.owner === player) {
      bot.targetX = player.targetGoalX;
      bot.targetY = Phaser.Math.Clamp(P.centreY + wobble(), P.mouthTop, P.mouthBottom);

      const covered = player.team === 'red'
        ? (player.sprite.x - P.left) / P.width
        : (P.right - player.sprite.x) / P.width;
      const opponent = player === this.red ? this.blue : this.red;
      const pressured = Phaser.Math.Distance.Between(
        opponent.sprite.x, opponent.sprite.y, player.sprite.x, player.sprite.y
      ) < this.botCfg.pressureRadius;

      if (covered >= this.botCfg.shootProgress) bot.queuedKick = 'shoot';
      else if (pressured && Math.random() < this.botCfg.passUnderPressureChance) bot.queuedKick = 'pass';
    } else {
      bot.targetX = this.ball.x + wobble() * this.botCfg.chaseWobbleScale;
      bot.targetY = this.ball.y + wobble() * this.botCfg.chaseWobbleScale;
    }
  }

  /* ----------------------------------------------------------- movement */

  /*
   * Every velocity change goes through the surface, so on grass grip is 1 and this is the
   * instant response it has always been, while on ice you carry on a little past the point
   * you meant to stop at. Standing still and being stunned slide too: skidding on your
   * back is the whole reason to play on ice.
   */
  steer(body, targetX, targetY) {
    const grip = this.surface.grip;
    if (grip >= 1) {
      body.setVelocity(targetX, targetY);
      return;
    }
    body.setVelocity(
      Phaser.Math.Linear(body.velocity.x, targetX, grip),
      Phaser.Math.Linear(body.velocity.y, targetY, grip));
  }

  /*
   * Switched on, and a one-player match: two humans cannot share one pointer. Never
   * alongside the thumb controls either, or a tap on the stick would also be a pass.
   */
  redUsesMouse() {
    return AIM.redUsesMouse && this.mode === 'bot' && !this.touch;
  }

  /* Whose kicks a click counts as. Red's, and only red's. */
  mouseKicker(player) {
    return this.redUsesMouse() && player === this.red;
  }

  movePlayer(player, now) {
    const body = player.sprite.body;
    if (now < player.stunnedUntil) {
      this.steer(body, 0, 0);
      return;
    }

    const input = player.input;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    if (dx === 0 && dy === 0) {
      this.steer(body, 0, 0);
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
    this.steer(body, dx * speed, dy * speed);
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

    // It only looks up every reactionMs, and moves towards wherever the ball was then.
    if (now >= keeper.nextLookAt) {
      keeper.nextLookAt = now + CONFIG.KEEPER.reactionMs;
      keeper.targetY = Phaser.Math.Clamp(this.ball.y, P.mouthTop + half, P.mouthBottom - half);
    }

    const dy = keeper.targetY - keeper.sprite.y;
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
      // Ball rides just ahead of the dribbler's facing, clamped to stay on the pitch and
      // pulled back out of a keeper if one is in the way.
      const point = this.carryPoint(this.state.owner);
      ball.body.reset(point.x, point.y);
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

  /*
   * Where the dribbled ball sits this frame.
   *
   * The carry is a teleport, not a physics move, so it would happily place the ball
   * inside a keeper and from there a kick starts already past the only thing guarding
   * the goal. Keepers are solid, so pull the ball back along the carry line until it
   * is clear of them, right back to the dribbler's feet if that is what it takes.
   */
  carryPoint(owner) {
    const step = CONFIG.BALL.carryStepPx;
    let point = this.carryPointAt(owner, CONFIG.BALL.carryDistance);
    if (!this.overlapsKeeper(point)) return point;

    for (let d = CONFIG.BALL.carryDistance - step; d > 0; d -= step) {
      point = this.carryPointAt(owner, d);
      if (!this.overlapsKeeper(point)) return point;
    }
    return this.carryPointAt(owner, 0);
  }

  carryPointAt(owner, distance) {
    const P = CONFIG.PITCH;
    const r = CONFIG.BALL.radius;
    return {
      x: Phaser.Math.Clamp(
        owner.sprite.x + Math.cos(owner.facing) * distance, P.left + r, P.right - r),
      y: Phaser.Math.Clamp(
        owner.sprite.y + Math.sin(owner.facing) * distance, P.top + r, P.bottom - r),
    };
  }

  overlapsKeeper(point) {
    const r = CONFIG.BALL.radius;
    return this.keepers.some((k) => {
      const b = k.sprite.body;
      return point.x > b.x - r && point.x < b.right + r
        && point.y > b.y - r && point.y < b.bottom + r;
    });
  }

  /*
   * The ball has reached a keeper.
   *
   * Anything arriving hard is simply blocked, and the bounce Arcade has already
   * applied stands. Anything slow enough is gathered and hoofed back out toward that
   * keeper's own outfield player, so winning the ball back is a reward for being
   * somewhere useful. A frozen keeper does neither: the freeze is the scoring window
   * and a free clearance would hand it straight back.
   */
  /*
   * Asked before the ball and the keeper are separated: false means no contact happens at
   * all and the ball carries on through. The verdict is latched for a moment, because this
   * runs every frame the two overlap and re-rolling would turn one shot into a dozen
   * coin flips it could not survive.
   */
  keeperReaches(keeper) {
    const now = this.time.now;
    if (now < keeper.beatenUntil) return false;
    if (now < keeper.reachedUntil) return true;

    if (Math.random() < CONFIG.KEEPER.saveChance) {
      keeper.reachedUntil = now + CONFIG.KEEPER.beatenHoldMs;
      return true;
    }

    keeper.beatenUntil = now + CONFIG.KEEPER.beatenHoldMs;
    Renderer.onKeeperBeaten(this, keeper, this.ballApproachSpeed);
    return false;
  }

  keeperContact(keeper) {
    const speed = this.ballApproachSpeed;

    if (keeper.frozen || speed > CONFIG.KEEPER.clearMaxSpeed) {
      Renderer.onKeeperSave(this, keeper, speed);
      return;
    }

    const mate = keeper.team === 'red' ? this.red : this.blue;
    const spread = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(
      -CONFIG.KEEPER.clearSpreadDeg, CONFIG.KEEPER.clearSpreadDeg));
    const angle = Phaser.Math.Angle.Between(
      keeper.sprite.x, keeper.sprite.y, mate.sprite.x, mate.sprite.y) + spread;

    this.ball.body.setVelocity(
      Math.cos(angle) * CONFIG.KEEPER.clearPower,
      Math.sin(angle) * CONFIG.KEEPER.clearPower);
    Renderer.onKeeperClear(this, keeper, mate);
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

    // Every swing takes something out of the ground it was taken from, whether or not it
    // connects with anything. A whiff is a divot too.
    this.tearPitch(player.sprite.x, player.sprite.y);

    const outcome = rollOutcome(this.drunkTable(player));

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

  /* Whatever is set, and never for a bot: a bot's aim is how its difficulty is set. */
  assistLevel(player) {
    return player.isBot ? CONFIG.ASSIST.LEVELS[0] : assistByKey(AIM.assist);
  }

  /*
   * The table this player rolls. Aim assist is paid for here: the weight on `intended`
   * comes down, which leaves every mis-hit relatively likelier without any of them being
   * touched. Unassisted, this is the shared constant itself and not a copy of it.
   */
  drunkTable(player) {
    const scale = this.assistLevel(player).cleanTouchScale;
    if (!scale) return CONFIG.DRUNK.TABLE;
    return CONFIG.DRUNK.TABLE.map((row) => (row.key === 'intended'
      ? { key: row.key, weight: row.weight * scale }
      : row));
  }

  /*
   * Where an assisted shot leans: the half of the goal the keeper is furthest from, and
   * only leans, because the aim point sits well inside the post rather than in the corner
   * and the spread around it is wider than the lean itself. With no keeper on the pitch
   * there is nothing to lean away from, so the middle will do.
   */
  awayFromKeeper(player) {
    const P = CONFIG.PITCH;
    const lean = CONFIG.ASSIST.openLeanPx;
    const top = P.mouthTop + lean;
    const bottom = P.mouthBottom - lean;
    const side = player.targetGoalX > P.centreX ? 'right' : 'left';
    const keeper = this.keepers.find((k) => k.side === side);
    if (!keeper) return P.centreY;
    return Math.abs(keeper.sprite.y - top) > Math.abs(keeper.sprite.y - bottom) ? top : bottom;
  }

  /*
   * Turned towards goal, but only so far. A pass that snapped straight at the net would
   * stop being a pass, so this bends it by at most `most` degrees and leaves the rest of
   * the decision where it was, with whoever is holding the keys.
   */
  bendGoalwards(player, facing, mostDeg) {
    const want = Phaser.Math.Angle.Between(
      this.ball.x, this.ball.y, player.targetGoalX, CONFIG.PITCH.centreY);
    const most = Phaser.Math.DegToRad(mostDeg);
    const off = Phaser.Math.Angle.Wrap(want - facing);
    return facing + Phaser.Math.Clamp(off, -most, most);
  }

  doKick(player, kind, now) {
    const wobble = player.isBot ? this.botCfg.aimWobbleDeg : 0;
    const level = this.assistLevel(player);

    if (kind === 'pass') {
      const aimed = level.passBendDeg
        ? this.bendGoalwards(player, player.facing, level.passBendDeg)
        : player.facing;
      const angle = aimed + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-wobble, wobble));
      this.releaseBall(player, angle, CONFIG.KICK.passPower, now, 'pass');
      return;
    }

    // A level says only what it changes, so an unset spread is the unassisted one.
    const spread = (level.shootSpreadDeg === undefined
      ? CONFIG.KICK.shootSpreadDeg : level.shootSpreadDeg) + wobble;
    const aimY = level.leanOffKeeper ? this.awayFromKeeper(player) : CONFIG.PITCH.centreY;
    const base = Phaser.Math.Angle.Between(this.ball.x, this.ball.y, player.targetGoalX, aimY);
    const angle = base + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-spread, spread));
    this.releaseBall(player, angle, CONFIG.KICK.shootPower, now, 'shoot');
  }

  releaseBall(player, angle, power, now, kind) {
    this.setOwner(null);
    this.state.recaptureLockUntil = now + CONFIG.BALL.kickLockMs;
    this.ball.body.setVelocity(Math.cos(angle) * power, Math.sin(angle) * power);
    Renderer.onKick(this, player, kind, power);
  }

  /* ------------------------------------------------------------ the ground */

  /*
   * How churned the pitch is, as a grid over the playing area. A grid rather than a list
   * of marks because what it is for is answering one question, several times a second, for
   * wherever the ball happens to be: how bad is it just here.
   */
  freshPitch() {
    const P = CONFIG.PITCH;
    const W = CONFIG.WEAR;
    const cols = Math.ceil(P.width / W.cellPx);
    const rows = Math.ceil(P.height / W.cellPx);
    return { cols, rows, level: new Float32Array(cols * rows) };
  }

  /* The cell a point is in, or -1 for anywhere off the pitch. */
  wearCell(x, y) {
    const P = CONFIG.PITCH;
    const W = CONFIG.WEAR;
    if (!this.wear || x < P.left || x >= P.right || y < P.top || y >= P.bottom) return -1;
    const col = Math.floor((x - P.left) / W.cellPx);
    const row = Math.floor((y - P.top) / W.cellPx);
    return row * this.wear.cols + col;
  }

  wearAt(x, y) {
    const cell = this.wearCell(x, y);
    return cell === -1 ? 0 : this.wear.level[cell];
  }

  /*
   * A kick going in. The ground under the boot takes most of it and the ground around it
   * takes a little, which is what turns a match's worth of kicks into a worn middle rather
   * than a scatter of dots.
   */
  tearPitch(x, y) {
    if (!this.wear) return 0;
    const cell = this.wearCell(x, y);
    if (cell === -1) return 0;

    const W = CONFIG.WEAR;
    const add = (at, much) => {
      if (at >= 0 && at < this.wear.level.length) {
        this.wear.level[at] = Math.min(1, this.wear.level[at] + much);
      }
    };
    add(cell, W.perKick);
    // Left and right only within the same row, or a kick by the touchline wears the far one.
    const col = cell % this.wear.cols;
    if (col > 0) add(cell - 1, W.spread);
    if (col < this.wear.cols - 1) add(cell + 1, W.spread);
    add(cell - this.wear.cols, W.spread);
    add(cell + this.wear.cols, W.spread);

    Renderer.onPitchWear(this, x, y, this.wear.level[cell]);
    return this.wear.level[cell];
  }

  /* What the ball is rolling through, right where it is. */
  ballDragNow() {
    const base = CONFIG.BALL.drag * this.surface.ballDragScale;
    if (!this.wear) return base;
    return base * (1 + this.wearAt(this.ball.x, this.ball.y) * (CONFIG.WEAR.dragScale - 1));
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

  /*
   * The teams come out. Everything is put where the kickoff wants it first, so the walk
   * knows where it is walking to and the end of it is simply the kickoff starting.
   *
   * The bodies are switched off for the length of it: the way out runs through the wall
   * behind the touchline, and a player shoved off it by a collision he is not allowed to
   * have would arrive somewhere else.
   */
  startEntrance(now) {
    this.resetPositions();
    const mouth = Renderer.tunnelWalk();
    if (!mouth) { this.startKickoff(now); return; }   // no stand, no tunnel, no walk

    this.state.phase = 'entrance';
    this.state.entrance = {
      /*
       * Counted in frames rather than clock time. A scene's clock reads whatever it read
       * the last time that scene ran, which on the frame create() runs can be a long way
       * in the past: the whole walk was over before it started, on the first tab that had
       * been left in the background for a minute.
       */
      elapsed: 0,
      walkers: this.players.map((player, i) => ({
        player,
        from: mouth,
        to: { x: player.sprite.x, y: player.sprite.y },
        delay: i * CONFIG.MATCH.entranceGapMs,
      })),
    };
    this.state.entrance.walkers.forEach((walker) => {
      walker.player.sprite.body.enable = false;
      walker.player.sprite.setPosition(mouth.x, mouth.y);
    });
    // Nobody has the ball on the way out: it is already sat on the centre spot.
    this.setOwner(null);
    Renderer.onEntrance(this, this.state.entrance.walkers);
  }

  updateEntrance(delta) {
    const entrance = this.state.entrance;
    entrance.elapsed += delta;
    let walking = false;
    entrance.walkers.forEach((walker) => {
      const gone = entrance.elapsed - walker.delay;
      const f = Math.max(0, Math.min(1, gone / CONFIG.MATCH.entranceWalkMs));
      if (f < 1) walking = true;
      const at = this.entranceStep(walker, f);
      walker.player.sprite.setPosition(at.x, at.y);
      walker.player.facing = at.facing;
      Renderer.onFacingChanged(this, walker.player);
    });
    if (!walking) this.finishEntrance();
  }

  /*
   * Where a walker is, a fraction of the way out. Two legs rather than one, because a
   * straight line from the back of the tunnel to the centre circle goes through the wall,
   * and shared out by length rather than half the time each, so the pace does not change
   * as he steps onto the grass.
   */
  entranceStep(walker, f) {
    const gate = { x: walker.from.x, y: CONFIG.PITCH.top + CONFIG.PLAYER.radius };
    const out = Phaser.Math.Distance.BetweenPoints(walker.from, gate);
    const across = Phaser.Math.Distance.BetweenPoints(gate, walker.to);
    const walked = (out + across) * f;
    const leg = walked <= out
      ? { a: walker.from, b: gate, t: out ? walked / out : 1 }
      : { a: gate, b: walker.to, t: across ? (walked - out) / across : 1 };
    return {
      x: leg.a.x + (leg.b.x - leg.a.x) * leg.t,
      y: leg.a.y + (leg.b.y - leg.a.y) * leg.t,
      facing: Math.atan2(leg.b.y - leg.a.y, leg.b.x - leg.a.x),
    };
  }

  finishEntrance() {
    this.state.entrance.walkers.forEach((walker) => {
      walker.player.sprite.body.enable = true;
    });
    Renderer.onEntranceDone(this, this.state.entrance.walkers);
    this.state.entrance = null;
    this.startKickoff(this.time.now);
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
    if (this.state.countLeft < 0) {
      this.state.phase = 'play';
      this.wakeKeepers(now);
    }
  }

  /*
   * A keeper's clock should not run while the ball is out of play. It always did, and it
   * never showed until the teams started walking out: three and a half seconds of ceremony
   * is longer than a keeper stays awake for, so both of them were stood there swaying
   * before anybody had kicked anything. The scoring window opens during the football.
   */
  wakeKeepers(now) {
    this.keepers.forEach((keeper) => {
      if (keeper.frozen) {
        keeper.frozen = false;
        Renderer.onKeeperFreeze(this, keeper, false);
      }
      scheduleKeeperFreeze(keeper, now);
    });
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
      this.pauseView = Renderer.showPause(this, {
        resume: () => this.togglePause(),
        settings: () => this.openSettings(),
        quit: () => this.scene.start('Menu'),
      });
    } else {
      Renderer.hidePause(this, this.pauseView);
      this.pauseView = null;
    }
    // The pause menu has its own resume, and a stick the match is no longer reading is
    // only something to push against. A kick tapped in the same frame as the pause goes
    // with it, rather than waiting to go off when play restarts.
    Renderer.setTouchControlsVisible(this.touchView, !this.state.paused);
    if (this.touch) this.touch.queuedKick = null;
  }

  rebindKeys() {
    this.keys = { red: keysFor(this, 'red'), blue: keysFor(this, 'blue') };
    Renderer.updateControlHint(this.hud, this.redUsesMouse());
  }

  /*
   * Settings runs on top of the match rather than replacing it, so the game is still there
   * to come back to. This scene is properly paused first, not merely logically: otherwise
   * it keeps reading the keyboard underneath and answers to the same keys settings uses.
   */
  openSettings() {
    this.scene.pause();
    this.scene.launch('Settings', { returnTo: this.scene.key });
    this.scene.bringToTop('Settings');
  }

  endMatch() {
    this.state.timeLeft = 0;
    this.state.phase = 'over';
    this.freezeEveryone();
    Renderer.updateHUD(this.hud, this.state.scores, 0);

    const scores = { red: this.state.scores.red, blue: this.state.scores.blue };
    // Level at full time goes straight to penalties. No golden goal, no extra time.
    const carry = { mode: this.mode, difficulty: this.difficulty, scores };
    if (scores.red === scores.blue) this.scene.start('Penalty', carry);
    else this.scene.start('FullTime', Object.assign({ penalties: null }, carry));
  }
}

/* ==========================================================================
 * PenaltyScene — entered only on a level score at full time
 * ======================================================================= */

class PenaltyScene extends Phaser.Scene {
  constructor() { super('Penalty'); }

  init(data) {
    this.mode = data.mode;
    this.difficulty = data.difficulty;
    // Picked straight off the menu rather than reached through a drawn match, in which
    // case there is no match scoreline to carry into full time.
    this.standalone = !!data.standalone;
    this.matchScores = data.scores || null;
  }

  create() {
    Renderer.beginScene(this);
    this.geom = CONFIG.PENALTY.GEOM;
    this.view = Renderer.createPenaltyView(this, this.geom);

    // Both takers use the same 1/2/3, which is unambiguous because only the taker ever
    // has the ball. Numpad equivalents accepted.
    this.pickKeys = this.input.keyboard.addKeys(
      CONFIG.PENALTY.pickKeys.concat(CONFIG.PENALTY.padKeys).join(','));

    // The thirds themselves are pickable too, on every device rather than only the ones
    // without a keyboard: aiming at the corner you want is a better way of asking than
    // remembering which number it was.
    Renderer.makePenaltyPicksTappable(this, this.geom, (index) => this.pick(index));

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

  /*
   * A corner chosen, however it was asked for. Guarded here rather than at each way in, so
   * a tap can never take a kick the keys would have refused.
   */
  pick(index) {
    if (this.phase !== 'await' || !this.isHumanTurn()) return;
    this.takePenalty(index);
  }

  update(time) {
    updateKeeperFreeze(this, this.keeper, time);

    if (this.phase === 'await') {
      if (this.isHumanTurn()) {
        const JustDown = Phaser.Input.Keyboard.JustDown;
        for (let i = 0; i < CONFIG.PENALTY.pickKeys.length; i++) {
          if (JustDown(this.pickKeys[CONFIG.PENALTY.pickKeys[i]])
            || JustDown(this.pickKeys[CONFIG.PENALTY.padKeys[i]])) {
            this.pick(i);
            break;
          }
        }
      } else if (time >= this.botKickAt) {
        // The bot picks a third at random and rolls the same table as everyone else.
        this.takePenalty(Phaser.Math.Between(0, CONFIG.PENALTY.thirds.length - 1));
      }
    } else if (this.phase === 'result' && time >= this.resultUntil) {
      this.advance();
    }
  }

  /*
   * Decides the result first, then hands the renderer a plan to animate. Whether the
   * kick scored is settled here and nowhere else.
   */
  /* pick is the index of the third the taker chose: 0, 1 or 2 for keys 1, 2 and 3. */
  takePenalty(pick) {
    this.phase = 'kicking';

    const G = this.geom;
    const thirds = CONFIG.PENALTY.thirds;
    const outcome = rollOutcome(CONFIG.PENALTY.TABLE);
    const frozen = this.keeper.frozen;
    // The keeper picks a third at the moment of the kick, independently of the taker.
    const dive = Phaser.Utils.Array.GetRandom(thirds);
    const aimed = thirds[pick];

    const plan = { outcome, keeperFrozen: frozen, keeperY: G.thirdY[dive], slow: false,
                   aimed, dive };
    let scored = false;

    /* On target for the given third: beaten only if the keeper happens to be there. */
    const strike = (third) => {
      // A frozen keeper cannot dive, so an on-target kick always beats it.
      scored = frozen || dive !== third;
      plan.ballY = G.thirdY[scored ? third : dive];
      plan.ballX = scored ? G.goalLineX + G.behindLineX
        : G.goalLineX - CONFIG.KEEPER.lineInset - G.keeperGapX;
    };

    /* Same power and placement, just not the third that was asked for. */
    const otherThird = () => Phaser.Utils.Array.GetRandom(thirds.filter((t) => t !== aimed));

    const wide = (slow) => {
      scored = false;
      plan.slow = !!slow;
      plan.ballX = G.goalLineX + G.wideOffsetX;
      plan.ballY = Math.random() < 0.5 ? G.mouthTop - G.wideOffsetY : G.mouthBottom + G.wideOffsetY;
    };

    switch (outcome) {
      case 'clean':
        strike(aimed);
        break;

      case 'wrongNumber':
        // Struck just as well, but the legs picked a different corner.
        strike(otherThird());
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
        difficulty: this.difficulty,
        standalone: this.standalone,
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
    this.difficulty = data.difficulty;
    this.standalone = !!data.standalone;
    this.scores = data.scores || null;
    this.penalties = data.penalties || null;
  }

  create() {
    Renderer.beginScene(this);

    let winner = null;
    if (this.penalties) {
      winner = this.penalties.red > this.penalties.blue ? 'red' : 'blue';
    } else if (this.scores && this.scores.red !== this.scores.blue) {
      winner = this.scores.red > this.scores.blue ? 'red' : 'blue';
    }

    const result = { scores: this.scores, penalties: this.penalties, winner };
    Renderer.createFullTime(this, result, {
      again: () => this.again(),
      menu: () => this.scene.start('Menu'),
    });
    Renderer.onFullTime(this, result);

    this.keys = this.input.keyboard.addKeys('SPACE,M');
  }

  /* Whatever you just played is what this gives you again. */
  again() {
    if (this.standalone) this.scene.start('Penalty', { mode: this.mode, standalone: true });
    else this.scene.start('Game', { mode: this.mode, difficulty: this.difficulty });
  }

  update() {
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.keys.SPACE)) this.again();
    else if (JustDown(this.keys.M)) this.scene.start('Menu');
  }
}

/* ========================================================================== */

/*
 * Before the game exists, so the first pitch and the first menu are already dressed. The
 * ground and the volume are yours from last time; the skin is not, because it opens on
 * classic every run whatever it was left on.
 */
Renderer.applySkin(Renderer.DEFAULT_SKIN);
Renderer.loadStadium();
loadPrefs();

/*
 * Phaser measures text the moment it is created, so a scene built before the display face
 * arrives is laid out for the fallback and never corrects itself. Wait for the font, but
 * never on it: offline, or with the font blocked, the race gives up and the game starts in
 * the system stack looking plainer and playing identically.
 */
function whenFontReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wait = Promise.all([
    document.fonts.load('16px "Bangers"'),
    document.fonts.ready,
  ]).catch(() => {});
  const giveUp = new Promise((resolve) => window.setTimeout(resolve, 1500));
  return Promise.race([wait, giveUp]);
}

function boot() {
/*
 * Decided once, here, because the canvas cannot be resized afterwards. Changing the
 * setting later therefore reloads the page rather than pretending to take effect.
 */
if (touchWanted() || wideFrameAsked()) {
  useWideFrame();
  deriveGeometry();
}

/*
 * The canvas is built at a multiple of the game's own size and every camera zooms to
 * match, so the picture is drawn near the display's real resolution while game
 * coordinates stay the world's own throughout.
 */
const renderScale = Renderer.chooseRenderScale();

/* Exposed so the game can be inspected from the console during development. */
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.CANVAS.width * renderScale,
  height: CONFIG.CANVAS.height * renderScale,
  backgroundColor: Renderer.canvasBackground(),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [MenuScene, PlayScene, SettingsScene, KeysScene, DifficultyScene, PenaltyModeScene,
    GameScene, PenaltyScene, FullTimeScene],
});
}

whenFontReady().then(boot);
