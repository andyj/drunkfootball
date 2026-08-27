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
 *                    the renderer decides whether to draw anything at all. That
 *                    vocabulary was defined up front in phase 1, which is why the
 *                    design pass added every effect here without editing a line of
 *                    game logic.
 *
 * The look is set by two structures. THEME is seven named colours, which a skin supplies
 * and everything else derives from. JUICE is every effect behind its own switch, so any
 * of them can be turned off without touching the code that fires it.
 *
 * Readability comes before decoration: facing, ball position and who has possession must
 * be easier to read with the effects on than with them off, which is why the sway is
 * capped and the possession ring exists at all.
 */
const Renderer = {

  /* ---------------------------------------------------------------- palette */

  /*
   * Every colour in the game comes from seven named values. A skin supplies those seven
   * and nothing else, so a new one cannot forget a shade or invent an eighth, and every
   * derived tone moves with it: keeper kits lighten from the team colours, the net from
   * the black, the dim HUD grey from the white.
   *
   * THEME is whichever seven are currently in play. PALETTE below is what the drawing
   * code actually reads, filled in by applySkin, so no draw call needs to know a skin
   * exists at all.
   */
  THEME: {
    pitchGreen: 0x2f8f46,
    stripe: 0x28803c,
    chalkWhite: 0xf5f2e6,
    redTeam: 0xe5383b,
    blueTeam: 0x3a86ff,
    lagerYellow: 0xffc53d,
    nightBlack: 0x12161c,
  },

  /* 0 keeps a, 1 gives b, so lighten is a mix towards white and darken towards black. */
  mix(a, b, t) {
    const ch = (shift) => {
      const from = (a >> shift) & 0xff;
      const to = (b >> shift) & 0xff;
      return Math.round(from + (to - from) * t) << shift;
    };
    return ch(16) | ch(8) | ch(0);
  },

  lighten(colour, t) { return Renderer.mix(colour, 0xffffff, t); },
  darken(colour, t) { return Renderer.mix(colour, 0x000000, t); },
  hex(colour) { return '#' + colour.toString(16).padStart(6, '0'); },

  /* Derived from THEME by applySkin. The literals are the default theme's, so nothing is
   * undefined if a draw call somehow beats the first applySkin. */
  PALETTE: {
    surround: 0x12161c,
    grass: 0x2f8f46,
    grassAlt: 0x28803c,
    line: 0xf5f2e6,
    net: 0x252b34,
    red: 0xe5383b,
    blue: 0x3a86ff,
    ball: 0xf5f2e6,
    ballEdge: 0x12161c,
    keeperRed: 0xf08e90,
    keeperBlue: 0x94bcff,
    outline: 0x12161c,
  },

  /*
   * The rail round the pitch and the people leaning on it. Only skins that ask for a
   * crowd get one. The figures sit along the bottom touchline in two bands with a gap in
   * the middle, which is where the pause hint and the clock live: a supporter standing on
   * the HUD would look like a bug rather than a joke.
   */
  CROWD: {
    fence: 0x4a5058,
    railInset: 12,          // how far outside the touchline the rail sits
    postEvery: 60,
    postHalfHeight: 5,
    figureRadius: 8,
    standOff: 16,           // gap between the rail and the front row
    minPeople: 45,
    maxPeople: 60,          // rolled fresh for every match, nobody counts them
    /*
     * The stretches of surround with nothing else in them. The top bands are the
     * narrower pair because the score, both control lines and the shootout title all
     * live up there, and the bottom pair leaves the middle clear for the pause hint.
     * The top gap is sized against the widest thing that sits in it, the shootout
     * title, with room left over for jitterX and a figure's radius.
     */
    bands: {
      top: [[320, 425], [855, 1030]],
      bottom: [[140, 505], [775, 1140]],
    },
    jitterX: 5,
    jitterY: 4,
    jackets: [0x3b4a5a, 0x5a4634, 0x2f3b2f, 0x4a3a4a, 0x63513a, 0x40506b],
    swayPx: 4,
    swayMinMs: 1100,
    swayMaxMs: 2100,
  },

  /*
   * Thumb controls. Laid out in game coordinates like everything else, so they scale with
   * the pitch rather than with the device, and drawn in the bottom corners where thumbs
   * already are when a phone is held sideways.
   *
   * They have to sit over the pitch: 1280x720 is all there is, and the 60px surround is
   * far too thin for a thumb. So they are translucent, and the ball reads straight
   * through them. Nothing here reaches game.js, which is told only a stick direction as a
   * fraction of full travel.
   */
  TOUCH: {
    textureSize: 256,
    ringWidth: 12,

    stick: { x: 178, y: 540, baseRadius: 84, nubRadius: 38, travel: 62 },
    /*
     * A thumb landing anywhere in here picks the stick up and re-centres it there, because
     * no two hands hold a phone the same way and a fixed stick suits exactly one of them.
     * Kept well clear of the buttons and the pause pill so a pointer can never be claimed
     * by two things at once.
     */
    stickZone: { left: 0, top: 280, right: 520, bottom: 720 },

    buttons: [
      { key: 'pass', x: 1010, y: 528, radius: 52, label: 'PASS', size: 19 },
      { key: 'shoot', x: 1140, y: 592, radius: 60, label: 'SHOOT', size: 21 },
    ],
    /* Where the pause hint already told you to look, now something to actually press. */
    pause: { x: 640, y: 688, width: 168, height: 46, edgeWidth: 3, label: 'PAUSE', size: 20 },

    restAlpha: 0.34,
    liveAlpha: 0.52,
    pressMs: 140,
  },

  /*
   * Pitch decoration. None of this is read by game.js and none of it changes where the
   * ball can go, which is exactly why it lives here rather than in CONFIG.PITCH. Sizes
   * are eyeballed against the 1120x600 playing area, not scaled from real yardages.
   */
  MARKINGS: {
    stripes: 10,             // mown bands running goal to goal
    penaltyDepth: 130,
    penaltyHeight: 300,
    goalAreaDepth: 52,
    goalAreaHeight: 180,
    cornerRadius: 18,
    netSpacing: 9,           // gap between the strands of the goal netting
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

  /*
   * Two roles, no third. The system stack carries small HUD copy and menu instructions,
   * the display face carries anything that shouts: the title, the score, the clock, the
   * GOAL banner and the drunk outcome labels. Bangers is listed first and the system
   * stack behind it, so an offline game simply looks plainer and still runs.
   */
  FONT: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  DISPLAY_FONT: '"Bangers", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',

  /*
   * Every effect the design pass adds, individually switchable. `on` kills an effect
   * outright, the scalars tune how loud it is. Nothing here changes what happens in a
   * match, only how much of a fuss the game makes about it.
   */
  JUICE: {
    squashStretch: { on: true, kick: 0.35, impact: 0.28, recoverMs: 180 },
    // Shake is a fraction of the viewport, so these are per unit of kick impulse: a 420
    // pass lands near 0.002 and a 750 shot near 0.007, which is the difference between
    // barely there and meaty.
    cameraShake: { on: true, passScale: 0.0000045, shootScale: 0.000009, goal: 0.012, ms: 160 },
    drunkSway: { on: true, degrees: 4, periodMs: 900 },
    // Readability rather than decoration: who has the ball is the one thing you cannot
    // infer from anything else on the pitch.
    possessionRing: { on: true, pulse: 0.4, pulseMs: 220 },
    ballTrail: { on: true, minSpeed: 420, everyMs: 28, fadeMs: 260 },
    outcomeLabels: { on: true, size: 58, tiltDeg: 8, overshootMs: 260, holdMs: 420 },
    stumbleJiggle: { on: true, px: 5, shakes: 6 },
    faceplant: { on: true, spinDeg: 90, stars: 4, orbitPx: 22 },
    keeperFreeze: { on: true, stars: 3, orbitPx: 16 },
    goalCelebration: { on: true, flashMs: 140, particles: 46, bannerMs: 900 },
    kickoffCountdown: { on: true, size: 92 },
    penaltyDrama: { on: true },
    fullTimeConfetti: { on: true, pieces: 90 },
  },

  DEPTH: {
    pitch: 0, wall: 5, keeper: 10, player: 20, ball: 30,
    label: 40, hud: 50, overlay: 60,
  },

  TEAM_NAME: { red: 'RED', blue: 'BLUE' },

  /*
   * Skins. Each supplies the seven named values in THEME and nothing else, and applySkin
   * derives the rest, so a skin is seven decisions rather than a dozen.
   *
   * One caveat worth knowing: Phaser reads the canvas background once when the game is
   * constructed, so switching to a skin with a different nightBlack leaves that one
   * colour stale. Nothing shows it, because every screen paints its own surround over
   * the whole canvas before anything else.
   */
  SKINS: [
    {
      key: 'sixpints',
      name: 'SIX PINTS DEEP',
      blurb: 'floodlit cage at 11pm, and it knows it is funny',
      colours: {
        pitchGreen: 0x2f8f46, stripe: 0x28803c, chalkWhite: 0xf5f2e6,
        redTeam: 0xe5383b, blueTeam: 0x3a86ff,
        lagerYellow: 0xffc53d, nightBlack: 0x12161c,
      },
    },
    {
      key: 'classic',
      name: 'CLASSIC',
      blurb: 'red and blue, dry summer pitch',
      colours: {
        pitchGreen: 0x2f7d40, stripe: 0x35894a, chalkWhite: 0xf2f2ea,
        redTeam: 0xe04b4b, blueTeam: 0x4b7fe0,
        lagerYellow: 0xffd166, nightBlack: 0x101319,
      },
    },
    {
      key: 'floodlit',
      name: 'FLOODLIT',
      blurb: 'deep green under the lights, kits turned up',
      colours: {
        pitchGreen: 0x1f5c31, stripe: 0x246a38, chalkWhite: 0xffffff,
        redTeam: 0xff5a5a, blueTeam: 0x5aa0ff,
        lagerYellow: 0xffd166, nightBlack: 0x11161f,
      },
    },
    {
      key: 'frozen',
      name: 'FROZEN',
      blurb: 'frost underfoot, everything slides a bit further',
      colours: {
        pitchGreen: 0x7f9c88, stripe: 0x8caa95, chalkWhite: 0xffffff,
        redTeam: 0xc0392b, blueTeam: 0x2c5fa8,
        lagerYellow: 0xffd166, nightBlack: 0x2a3038,
      },
    },
    {
      key: 'sunday',
      name: 'SUNDAY LEAGUE',
      blurb: 'mud, a rail, and a dozen unsteady witnesses',
      crowd: true,
      colours: {
        pitchGreen: 0x5a6b3a, stripe: 0x63753f, chalkWhite: 0xd8d2c0,
        redTeam: 0xe86a17, blueTeam: 0x7a3fbf,
        lagerYellow: 0xffd166, nightBlack: 0x22261c,
      },
    },
  ],

  SKIN_STORAGE_KEY: 'drunkfootball.skin',
  activeSkin: 'classic',

  /* Every bot is equally drunk, so none of these promise a steadier opponent. */
  DIFFICULTY_BLURB: {
    easy: 'a few too many, legs not really listening',
    medium: 'the bot you already know',
    hard: 'same drunk legs, worryingly sober judgement',
  },

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

  /* ------------------------------------------------------------------ skins */

  /*
   * The one place a colour is decided. A skin hands over its seven, and everything the
   * game draws or writes is derived here, so adding a skin is seven values and no
   * hunting for the shade of a keeper's shirt.
   */
  applySkin(key) {
    const skin = Renderer.SKINS.find((s) => s.key === key) || Renderer.SKINS[0];
    const T = Object.assign(Renderer.THEME, skin.colours);
    const P = Renderer.PALETTE;
    const C = Renderer.CSS;
    Renderer.activeSkin = skin.key;
    Renderer.paletteVersion += 1;

    P.grass = T.pitchGreen;
    P.grassAlt = T.stripe;
    P.line = T.chalkWhite;
    P.red = T.redTeam;
    P.blue = T.blueTeam;
    P.ball = T.chalkWhite;
    P.outline = T.nightBlack;
    P.ballEdge = T.nightBlack;
    P.surround = T.nightBlack;

    // Keepers wear a washed out version of their team, so a glance tells you whose goal
    // it is without them competing with the outfield player for attention.
    P.keeperRed = Renderer.lighten(T.redTeam, 0.45);
    P.keeperBlue = Renderer.lighten(T.blueTeam, 0.45);

    // The net sits just off the surround, or the goal mouth disappears into it.
    P.net = Renderer.lighten(T.nightBlack, 0.14);

    // Text names the teams too, so a Sunday League match announces its orange side in
    // orange rather than in the old red.
    C.hud = Renderer.hex(T.chalkWhite);
    C.accent = Renderer.hex(T.lagerYellow);
    C.red = Renderer.hex(T.redTeam);
    C.blue = Renderer.hex(T.blueTeam);
    C.dim = Renderer.hex(Renderer.mix(T.chalkWhite, T.nightBlack, 0.45));
    C.good = Renderer.hex(Renderer.lighten(T.pitchGreen, 0.5));
    C.bad = Renderer.hex(Renderer.lighten(T.redTeam, 0.35));

    // The rail round a Sunday League pitch is painted, not lit, so it comes off the black.
    Renderer.CROWD.fence = Renderer.lighten(T.nightBlack, 0.28);

    // Storage throws in private browsing, and a forgotten skin is not worth a crash.
    try {
      window.localStorage.setItem(Renderer.SKIN_STORAGE_KEY, skin.key);
    } catch (err) { /* nothing worth doing */ }
  },

  /* Called once before the game is constructed, so the first pitch drawn is the right one. */
  loadSkin() {
    let saved = null;
    try {
      saved = window.localStorage.getItem(Renderer.SKIN_STORAGE_KEY);
    } catch (err) { saved = null; }
    Renderer.applySkin(saved || Renderer.SKINS[0].key);
  },

  /*
   * Textures are baked from the palette and cached by key, so a new skin makes them stale.
   * Throwing them away on the spot crashes the next render, because sprites already on
   * screen still point at them. So a skin change only bumps a version number, and the
   * stale textures are replaced at the top of the next scene's create, before that scene
   * has made a single sprite. Changing a skin therefore means: apply, restart, done.
   */
  PALETTE_DEPENDENT_TEXTURES: ['player_red', 'player_blue', 'keeper_red', 'keeper_blue', 'ball'],
  paletteVersion: 0,
  bakedVersion: -1,

  makeTextures(scene) {
    const P = Renderer.PALETTE;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    /*
     * Retiring a texture is only safe when nothing else can be holding it. This scene has
     * not created anything yet, but another may be alive underneath: settings opened from
     * a paused match runs on top of a game full of sprites using these very textures, and
     * a paused scene still renders. So the purge waits, and bakedVersion is deliberately
     * left stale so the next scene that does start alone picks it up.
     */
    // Active is not the test: a paused or sleeping scene still renders, and still holds
    // every texture its sprites were made with.
    const othersAlive = scene.scene.manager.getScenes(false).some((s) => s !== scene
      && (s.sys.isActive() || s.sys.isPaused() || s.sys.isSleeping()));

    if (Renderer.bakedVersion !== Renderer.paletteVersion && !othersAlive) {
      Renderer.PALETTE_DEPENDENT_TEXTURES.forEach((key) => {
        if (scene.textures.exists(key)) scene.textures.remove(key);
      });
      Renderer.bakedVersion = Renderer.paletteVersion;
    }

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

    // A supporter, seen from above: a blob. Baked white so each one can be tinted into
    // its own coat without a texture per colour.
    const fr = Renderer.CROWD.figureRadius;
    bake('fan', fr * 2, fr * 2, () => {
      g.fillStyle(0xffffff, 1);
      g.lineStyle(2, P.outline, 1);
      g.fillCircle(fr, fr, fr - 1);
      g.strokeCircle(fr, fr, fr - 1);
    });

    // The ring marking whoever has the ball. Baked hollow so the player still reads
    // through it, and white so the theme's yellow can tint it.
    const ringR = CONFIG.PLAYER.radius + 9;
    bake('owner_ring', ringR * 2, ringR * 2, () => {
      g.lineStyle(3, 0xffffff, 1);
      g.strokeCircle(ringR, ringR, ringR - 2);
    });

    // Four-pointed star, for the ones circling a stunned player or a frozen keeper.
    // Baked white so it can be tinted to whatever the theme's yellow happens to be.
    bake('star', 14, 14, () => {
      const s = 14;
      const h = s / 2;
      const w = 2.4;
      g.fillStyle(0xffffff, 1);
      g.beginPath();
      g.moveTo(h, 0);
      g.lineTo(h + w, h - w);
      g.lineTo(s, h);
      g.lineTo(h + w, h + w);
      g.lineTo(h, s);
      g.lineTo(h - w, h + w);
      g.lineTo(0, h);
      g.lineTo(h - w, h - w);
      g.closePath();
      g.fillPath();
    });

    /*
     * The thumb controls, baked once at a size nothing asks to be drawn bigger than, so
     * one disc and one ring serve the stick base, its nub and both buttons. White, so
     * each use tints itself, and palette-independent, so a skin change never retires them.
     */
    const ts = Renderer.TOUCH.textureSize;
    const th = ts / 2;
    bake('touch_disc', ts, ts, () => {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(th, th, th - 1);
    });
    bake('touch_ring', ts, ts, () => {
      const lw = Renderer.TOUCH.ringWidth;
      g.lineStyle(lw, 0xffffff, 1);
      g.strokeCircle(th, th, th - lw / 2 - 1);
    });

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

  /*
   * A 1280x720 canvas stretched across a big retina window puts three or four real pixels
   * on every game pixel, and everything goes soft. So the canvas is built several times
   * that size and every camera is zoomed to match, which leaves game coordinates exactly
   * where they were, 1280x720, while the picture is drawn at something near the display's
   * real resolution.
   *
   * Chosen once at boot, because the canvas cannot be resized afterwards, and capped: past
   * 3x the pixels cost more than the sharpness is worth.
   */
  RENDER_SCALE: 1,

  chooseRenderScale() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = window.innerWidth || CONFIG.CANVAS.width;
    const wanted = (dpr * cssWidth) / CONFIG.CANVAS.width;
    Renderer.RENDER_SCALE = Math.min(3, Math.max(1, Math.round(wanted)));
    return Renderer.RENDER_SCALE;
  },

  /*
   * Zoom cancels the oversized canvas, and centring puts world 0,0 back in the top left
   * corner. Without the centring a zoomed camera looks at the middle of the world and
   * the pitch drifts off screen.
   */
  frameCamera(scene) {
    scene.cameras.main
      .setZoom(Renderer.RENDER_SCALE)
      .centerOn(CONFIG.CANVAS.width / 2, CONFIG.CANVAS.height / 2);
  },

  /*
   * Every scene starts the same way: textures baked, camera framed, per-run state cleared.
   *
   * That last one matters more than it looks. Phaser reuses the same Scene object across a
   * restart, so anything parked on it outlives the display objects it refers to. The
   * possession ring was held that way and came back pointing at a destroyed sprite, which
   * simply never appeared again.
   */
  beginScene(scene) {
    scene.juiceState = null;
    Renderer.makeTextures(scene);
    Renderer.frameCamera(scene);
  },

  /*
   * Glyphs are drawn into a texture at creation, so they need rendering at the ratio the
   * screen will actually show them: the camera's zoom, times however much the canvas is
   * then scaled to fit the window.
   */
  textResolution(scene) {
    const dpr = window.devicePixelRatio || 1;
    const shown = scene.scale && scene.scale.displayScale ? scene.scale.displayScale.x : 1;
    return Math.min(4, Math.max(1, (Renderer.RENDER_SCALE * dpr) / (shown || 1)));
  },

  text(scene, x, y, str, size, colour) {
    return scene.add.text(x, y, str, {
      fontFamily: Renderer.FONT,
      fontSize: size + 'px',
      color: colour || Renderer.CSS.hud,
    })
      .setResolution(Renderer.textResolution(scene))
      .setDepth(Renderer.DEPTH.hud);
  },

  centred(scene, y, str, size, colour) {
    return Renderer.text(scene, CONFIG.CANVAS.width / 2, y, str, size, colour)
      .setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
  },

  /*
   * The shouty role. Bangers has no lower case to speak of and sits high on the line, so
   * it wants a hard shadow under it to keep it off the grass and stop it swimming.
   */
  display(scene, x, y, str, size, colour) {
    const T = Renderer.THEME;
    /*
     * Phaser sizes a text texture from the glyph metrics alone, which know nothing about
     * the drop shadow hanging below and right, nor about the lean on a slanted face
     * pushing the last letter past its own advance width. Without padding the corner of
     * the final glyph is sliced off. Symmetric, so centred text stays centred.
     */
    const pad = Math.ceil(size * 0.16) + 4;
    const label = scene.add.text(x, y, str, {
      fontFamily: Renderer.DISPLAY_FONT,
      fontSize: size + 'px',
      color: colour || Renderer.CSS.hud,
      padding: { left: pad, right: pad, top: pad, bottom: pad },
    })
      .setShadow(3, 4, Renderer.hex(T.nightBlack), 0, true, true)
      .setResolution(Renderer.textResolution(scene))
      .setDepth(Renderer.DEPTH.hud);

    // Recorded rather than read back: Phaser does not expose the padding it was given,
    // and anything measuring this text needs to know how much of it is empty margin.
    label.inkPad = pad;
    return label;
  },

  centredDisplay(scene, y, str, size, colour) {
    return Renderer.display(scene, CONFIG.CANVAS.width / 2, y, str, size, colour)
      .setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
  },

  /*
   * A menu line that answers to a click as well as to its number key. The scene owns what
   * the choice means, this only reports that it was made, so the key and the click always
   * land on the same code path.
   */
  option(scene, y, label, size, onPick) {
    const C = Renderer.CSS;
    const text = Renderer.centred(scene, y, label, size, C.accent);
    return Renderer.makePickable(text, onPick, C.accent);
  },

  /* The same thing hung off a left edge, for screens that line choices up in a column. */
  optionAt(scene, x, y, label, size, onPick, colour) {
    const base = colour || Renderer.CSS.accent;
    const text = Renderer.text(scene, x, y, label, size, base)
      .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);
    return Renderer.makePickable(text, onPick, base);
  },

  makePickable(text, onPick, base) {
    text.setInteractive({ useHandCursor: true })
      .on('pointerover', () => text.setColor(Renderer.CSS.hud))
      .on('pointerout', () => text.setColor(base))
      .on('pointerdown', onPick);
    return text;
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

  /*
   * Who presses what, as a three column table. Both the front screen and settings draw it
   * from here, so there is one layout and one source, and neither can go stale.
   */
  keyTable(scene, labelX, topY, rowGap, redX, blueX, size) {
    const C = Renderer.CSS;
    const red = CONFIG.CONTROLS.red;
    const blue = CONFIG.CONTROLS.blue;
    const rows = [
      ['', Renderer.TEAM_NAME.red, Renderer.TEAM_NAME.blue],
      ['Move', Renderer.moveKeys('red'), Renderer.moveKeys('blue')],
      ['Pass', Renderer.keyLabel(red.pass), Renderer.keyLabel(blue.pass)],
      ['Shoot', Renderer.keyLabel(red.shoot), Renderer.keyLabel(blue.shoot)],
    ];
    rows.forEach((row, i) => {
      const y = topY + i * rowGap;
      const colour = i === 0 ? C.accent : C.hud;
      const s = i === 0 ? size - 2 : size;
      Renderer.text(scene, labelX, y, row[0], s, colour).setDepth(Renderer.DEPTH.overlay);
      Renderer.text(scene, redX, y, row[1], s, colour)
        .setOrigin(0.5, 0).setDepth(Renderer.DEPTH.overlay);
      Renderer.text(scene, blueX, y, row[2], s, colour)
        .setOrigin(0.5, 0).setDepth(Renderer.DEPTH.overlay);
    });
  },

  /* Control text is derived from CONFIG.CONTROLS so a remap never leaves stale help on screen. */
  moveKeys(team) {
    const k = CONFIG.CONTROLS[team];
    return [k.up, k.left, k.down, k.right].map(Renderer.keyLabel).join(' ');
  },

  /*
   * With the mouse on, the click labels replace the key labels rather than joining them.
   * The keys still work, but naming all four would run this line into the crowd standing
   * along the top touchline, and the menu lists the keys anyway.
   */
  controlSummary(team, usesMouse) {
    const k = CONFIG.CONTROLS[team];
    const actions = usesMouse
      ? 'click pass   right-click shoot'
      : Renderer.keyLabel(k.pass) + ' pass   ' + Renderer.keyLabel(k.shoot) + ' shoot';
    return Renderer.TEAM_NAME[team] + '   ' + Renderer.moveKeys(team) + '   ' + actions;
  },

  /*
   * The strip of grass everything on the settings screen stands on. Named because it is a
   * container with a growing list in it, which is exactly the shape of bug this project
   * keeps having: deep enough for five skins, two toggles and the key table, and the suite
   * checks nothing has outgrown it.
   */
  SETTINGS_BAND: { top: 205, height: 405 },

  TOUCH_BLURB: {
    auto: 'stick and buttons on a phone, keys everywhere else',
    on: 'stick and buttons always, one player only',
    off: 'never, whatever you are playing on',
  },

  /* A thumb-controlled match has no key legend to correct. */
  updateControlHint(hud, usesMouse) {
    if (hud.left) hud.left.setText(Renderer.controlSummary('red', usesMouse));
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

    // Mown bands. Every other one is painted over the base grass, so the two shades
    // alternate without either needing to know about the other.
    const M = Renderer.MARKINGS;
    const bandWidth = P.width / M.stripes;
    g.fillStyle(C.grassAlt, 1);
    for (let i = 1; i < M.stripes; i += 2) {
      g.fillRect(P.left + i * bandWidth, P.top, bandWidth, P.height);
    }

    // Goal recesses behind each line, netting drawn as crosshatch over the dark.
    g.fillStyle(C.net, 1);
    g.fillRect(P.left - P.goalDepth, P.mouthTop, P.goalDepth, P.goalMouth);
    g.fillRect(P.right, P.mouthTop, P.goalDepth, P.goalMouth);
    Renderer.crosshatch(g, P.left - P.goalDepth, P.mouthTop, P.goalDepth, P.goalMouth);
    Renderer.crosshatch(g, P.right, P.mouthTop, P.goalDepth, P.goalMouth);

    g.lineStyle(3, C.line, 1);
    g.strokeRect(P.left, P.top, P.width, P.height);
    g.lineBetween(P.centreX, P.top, P.centreX, P.bottom);
    g.strokeCircle(P.centreX, P.centreY, 70);
    g.fillStyle(C.line, 1);
    g.fillCircle(P.centreX, P.centreY, 5);

    // Penalty area and six-yard box, mirrored about the halfway line. Each box hangs off
    // its own goal line, so the left ones grow rightwards and the right ones leftwards.
    g.lineStyle(3, C.line, 1);
    [
      [M.penaltyDepth, M.penaltyHeight],
      [M.goalAreaDepth, M.goalAreaHeight],
    ].forEach(([depth, height]) => {
      const y = P.centreY - height / 2;
      g.strokeRect(P.left, y, depth, height);
      g.strokeRect(P.right - depth, y, depth, height);
    });

    // Corner arcs, each a quarter circle opening into the pitch.
    [
      [P.left, P.top, 0],
      [P.right, P.top, 90],
      [P.right, P.bottom, 180],
      [P.left, P.bottom, 270],
    ].forEach(([x, y, startDeg]) => {
      g.beginPath();
      g.arc(x, y, M.cornerRadius,
        Phaser.Math.DegToRad(startDeg), Phaser.Math.DegToRad(startDeg + 90));
      g.strokePath();
    });

    Renderer.createGround(scene, g);

    // Posts, so the two openings are unmistakable.
    g.lineStyle(5, C.line, 1);
    [P.mouthTop, P.mouthBottom].forEach((y) => {
      g.lineBetween(P.left - P.goalDepth, y, P.left, y);
      g.lineBetween(P.right, y, P.right + P.goalDepth, y);
    });

    return g;
  },

  /*
   * Netting: diagonals both ways, clipped to the goal recess. Drawn faintly off the chalk
   * so it reads as mesh at a glance without competing with the lines on the pitch.
   */
  crosshatch(g, x, y, w, h) {
    const M = Renderer.MARKINGS;
    const step = M.netSpacing;
    g.lineStyle(1, Renderer.lighten(Renderer.THEME.chalkWhite, 0), 0.22);

    // A diagonal enters the box along the top edge or the left, so run the origin from
    // above the box round to its far side and clip each line to the rectangle.
    for (let d = -h; d < w + h; d += step) {
      Renderer.clippedLine(g, x + d, y, x + d + h, y + h, x, y, w, h);
      Renderer.clippedLine(g, x + d, y + h, x + d + h, y, x, y, w, h);
    }
  },

  /* Cohen–Sutherland is overkill here: both ends are clamped and the line is redrawn. */
  clippedLine(g, x1, y1, x2, y2, bx, by, bw, bh) {
    const left = bx;
    const right = bx + bw;
    const top = by;
    const bottom = by + bh;
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return;

    let t0 = 0;
    let t1 = 1;
    const edges = [[-dx, x1 - left], [dx, right - x1], [-dy, y1 - top], [dy, bottom - y1]];
    for (let i = 0; i < edges.length; i++) {
      const p = edges[i][0];
      const q = edges[i][1];
      if (p === 0) {
        if (q < 0) return;
      } else {
        const r = q / p;
        if (p < 0) { if (r > t1) return; if (r > t0) t0 = r; }
        else { if (r < t0) return; if (r < t1) t1 = r; }
      }
    }
    g.lineBetween(x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1);
  },

  /*
   * Rail and crowd, for skins that ask for them. The rail runs along both touchlines
   * only: the goals stick out past the ends, so a rail all the way round would be drawn
   * straight through the nets.
   */
  createGround(scene, g) {
    const skin = Renderer.SKINS.find((s) => s.key === Renderer.activeSkin);
    if (!skin || !skin.crowd) return;

    const P = CONFIG.PITCH;
    const K = Renderer.CROWD;

    g.lineStyle(2, K.fence, 1);
    [P.top - K.railInset, P.bottom + K.railInset].forEach((y) => {
      g.lineBetween(P.left - K.railInset, y, P.right + K.railInset, y);
      for (let x = P.left - K.railInset; x <= P.right + K.railInset; x += K.postEvery) {
        g.lineBetween(x, y - K.postHalfHeight, x, y + K.postHalfHeight);
      }
    });

    /*
     * A fresh turnout every match, spread down both touchlines. Each band gets a share of
     * the total in proportion to how much room it has, so the crowd is the same density
     * all the way round rather than packed at one end, and the last band takes whatever
     * rounding left over so the total is exactly the number rolled.
     */
    const total = Phaser.Math.Between(K.minPeople, K.maxPeople);
    const rows = [
      { y: P.top - K.railInset - K.standOff, bands: K.bands.top },
      { y: P.bottom + K.railInset + K.standOff, bands: K.bands.bottom },
    ];
    const roomAll = rows.reduce((sum, row) =>
      sum + row.bands.reduce((w, [from, to]) => w + (to - from), 0), 0);

    const lastRow = rows[rows.length - 1];
    let placed = 0;
    let n = 0;

    rows.forEach((row) => {
      row.bands.forEach(([from, to], bandIndex) => {
        const isLast = row === lastRow && bandIndex === row.bands.length - 1;
        const count = isLast
          ? Math.max(0, total - placed)
          : Math.round(total * ((to - from) / roomAll));
        placed += count;

        for (let i = 0; i < count; i += 1) {
          const along = count === 1 ? 0.5 : i / (count - 1);
          const fan = scene.add.image(
            from + along * (to - from) + Phaser.Math.Between(-K.jitterX, K.jitterX),
            row.y + Phaser.Math.Between(-K.jitterY, K.jitterY),
            'fan')
            .setTint(K.jackets[n % K.jackets.length])
            .setDepth(Renderer.DEPTH.wall);
          n += 1;

          // Sideways only: a circle rotating on the spot would not read as anything.
          scene.tweens.add({
            targets: fan,
            x: fan.x + (Phaser.Math.Between(-K.swayPx, K.swayPx) || K.swayPx),
            duration: Phaser.Math.Between(K.swayMinMs, K.swayMaxMs),
            delay: Phaser.Math.Between(0, 900),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }
      });
    });
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

  createHUD(scene, state) {
    const cx = CONFIG.CANVAS.width / 2;
    const C = Renderer.CSS;
    const hud = {
      // Only 60px of surround above the pitch, and the display face is tall, so the two
      // are stacked tight and sized to fit rather than left where the old face sat.
      score: Renderer.display(scene, cx, 0, '0 - 0', 40).setOrigin(0.5, 0),
      timer: Renderer.display(scene, cx, 49, '0:00', 24, C.accent).setOrigin(0.5, 0),
      right: Renderer.text(scene, CONFIG.CANVAS.width - 20, 12,
        state.mode === 'bot'
          ? Renderer.TEAM_NAME.blue + '   ' + state.difficulty + ' bot'
          : Renderer.controlSummary('blue'), 13, C.dim)
        .setOrigin(1, 0),
    };

    /*
     * Playing with thumbs, neither of these is worth the space: a key legend names keys
     * that are not there, and the pause hint sits exactly where the pause button goes.
     */
    if (!state.touch) {
      hud.left = Renderer.text(scene, 20, 12,
        Renderer.controlSummary('red', state.mouseClicks), 13, C.dim);
      // Only a one-player match has a mouse scheme to swap, so only it is told about M.
      hud.hint = Renderer.text(scene, cx, CONFIG.CANVAS.height - 24,
        state.mode === 'bot'
          ? 'P or ESC to pause    M for keys only'
          : 'P or ESC to pause', 13, C.dim).setOrigin(0.5, 0);
    }

    return hud;
  },

  updateHUD(hud, scores, timeLeft) {
    hud.score.setText(scores.red + ' - ' + scores.blue);
    hud.timer.setText(Renderer.formatClock(timeLeft));
  },

  /*
   * The thumb controls for a match. Like every other control scheme in the game, this one
   * only reports: the stick says which way it is being pushed as a fraction of its own
   * travel, the buttons say they were pressed, and the scene decides what any of it means.
   * So a thumb ends up filling in the same six booleans a keyboard fills in.
   */
  createTouchControls(scene, handlers) {
    const T = Renderer.TOUCH;
    const S = T.stick;
    const depth = Renderer.DEPTH.hud;
    const chalk = Renderer.THEME.chalkWhite;

    // Phaser tracks one pointer unless told otherwise, and steering while shooting needs
    // two thumbs down at once.
    scene.input.addPointer(2);

    const disc = (x, y, radius, tint, alpha) => scene.add.image(x, y, 'touch_disc')
      .setDisplaySize(radius * 2, radius * 2).setTint(tint).setAlpha(alpha).setDepth(depth);
    const ring = (x, y, radius, tint, alpha) => scene.add.image(x, y, 'touch_ring')
      .setDisplaySize(radius * 2, radius * 2).setTint(tint).setAlpha(alpha).setDepth(depth);

    const base = ring(S.x, S.y, S.baseRadius, chalk, T.restAlpha);
    const nub = disc(S.x, S.y, S.nubRadius, chalk, T.restAlpha);

    let held = null;   // id of the pointer currently on the stick, if any

    const place = (x, y) => { base.setPosition(x, y); nub.setPosition(x, y); };
    const light = (on) => {
      base.setAlpha(on ? T.liveAlpha : T.restAlpha);
      nub.setAlpha(on ? T.liveAlpha : T.restAlpha);
    };
    const release = () => {
      held = null;
      place(S.x, S.y);
      light(false);
      handlers.move(0, 0);
    };

    const Z = T.stickZone;
    const zone = scene.add.zone((Z.left + Z.right) / 2, (Z.top + Z.bottom) / 2,
      Z.right - Z.left, Z.bottom - Z.top)
      .setInteractive()
      .on('pointerdown', (pointer) => {
        if (held !== null) return;
        held = pointer.id;
        place(pointer.worldX, pointer.worldY);
        light(true);
      });

    scene.input.on('pointermove', (pointer) => {
      if (pointer.id !== held) return;
      const dx = pointer.worldX - base.x;
      const dy = pointer.worldY - base.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) { nub.setPosition(base.x, base.y); handlers.move(0, 0); return; }
      // Capped at the ring, so a thumb that slides off the edge keeps pushing that way
      // rather than reporting a direction nobody can see.
      const reach = Math.min(len, S.travel);
      nub.setPosition(base.x + (dx / len) * reach, base.y + (dy / len) * reach);
      handlers.move((dx / len) * (reach / S.travel), (dy / len) * (reach / S.travel));
    });
    scene.input.on('pointerup', (pointer) => { if (pointer.id === held) release(); });
    scene.input.on('gameout', release);   // a thumb dragged off the canvas is a thumb lifted

    const objects = [base, nub, zone];
    const buttons = {};

    T.buttons.forEach((spec) => {
      const tint = spec.key === 'shoot' ? Renderer.THEME.lagerYellow : chalk;
      const face = disc(spec.x, spec.y, spec.radius, tint, T.restAlpha);
      const edge = ring(spec.x, spec.y, spec.radius, tint, T.liveAlpha);
      const label = Renderer.text(scene, spec.x, spec.y, spec.label, spec.size,
        spec.key === 'shoot' ? Renderer.CSS.accent : Renderer.CSS.hud)
        .setOrigin(0.5).setDepth(depth);

      // The hit area is stated in the texture's own coordinates and carried through by
      // the display size, so the circle you can see is exactly the circle that answers.
      const half = T.textureSize / 2;
      face.setInteractive(new Phaser.Geom.Circle(half, half, half), Phaser.Geom.Circle.Contains)
        .on('pointerdown', () => {
          face.setAlpha(T.liveAlpha);
          scene.tweens.add({ targets: face, alpha: T.restAlpha, duration: T.pressMs });
          handlers[spec.key]();
        });

      buttons[spec.key] = face;
      objects.push(face, edge, label);
    });

    /*
     * The pause button sits in the surround, which is the same night black a filled pill
     * would be, so it is drawn as an outline: an accent rectangle with the surround's own
     * colour laid back over the middle of it.
     */
    const P = T.pause;
    const edge = P.edgeWidth;
    const pill = scene.add.image(P.x, P.y, 'px')
      .setDisplaySize(P.width, P.height).setTint(Renderer.THEME.lagerYellow)
      .setAlpha(0.75).setDepth(depth)
      .setInteractive()
      .on('pointerdown', () => handlers.pause());
    const pillInk = scene.add.image(P.x, P.y, 'px')
      .setDisplaySize(P.width - edge * 2, P.height - edge * 2)
      .setTint(Renderer.THEME.nightBlack).setDepth(depth);
    const pillLabel = Renderer.text(scene, P.x, P.y, P.label, P.size, Renderer.CSS.accent)
      .setOrigin(0.5).setDepth(depth);
    objects.push(pill, pillInk, pillLabel);

    return { objects, zone, base, nub, buttons, pause: pill, release };
  },

  /*
   * Taken away while the pause menu is up. Leaving a stick on screen that the match is no
   * longer reading invites a thumb to push against nothing, and the stick has to be let
   * go of as well, or the direction it was last pushed survives the pause. The zone stops
   * listening too: an invisible thing that still answers to a thumb is worse than a
   * visible one.
   */
  setTouchControlsVisible(view, visible) {
    if (!view) return;
    if (!visible) view.release();
    view.objects.forEach((o) => o.setVisible(visible));
    view.objects.forEach((o) => { if (o.input) o.input.enabled = visible; });
  },

  /* Named so the test suite can check the card really does cover every line on it. */
  PAUSE_CARD: { width: 460, height: 380 },

  /*
   * The pause screen is a menu rather than a notice. Every line answers to a click and to
   * a key, through the same handlers, so the two can never disagree.
   */
  showPause(scene, handlers) {
    const cx = CONFIG.CANVAS.width / 2;
    const cy = CONFIG.CANVAS.height / 2;

    const shade = scene.add.image(cx, cy, 'px')
      .setDisplaySize(CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .setTint(Renderer.THEME.nightBlack).setAlpha(0.72).setDepth(Renderer.DEPTH.overlay);

    /*
     * The menu sits on a solid card, dressed like the shootout panel. A dimmed pitch alone
     * is not enough: pause during the kickoff banner or over an outcome label and two
     * pieces of text share the same middle of the screen. The card takes the whole block
     * out of the pitch's way whatever happens to be under it.
     */
    const cardY = cy + 15;
    const card = scene.add.image(cx, cardY, 'px')
      .setDisplaySize(Renderer.PAUSE_CARD.width, Renderer.PAUSE_CARD.height)
      .setTint(Renderer.THEME.nightBlack).setAlpha(0.97).setDepth(Renderer.DEPTH.overlay);
    const rule = scene.add.image(cx, cardY - Renderer.PAUSE_CARD.height / 2, 'px')
      .setDisplaySize(Renderer.PAUSE_CARD.width, 8)
      .setTint(Renderer.THEME.lagerYellow).setDepth(Renderer.DEPTH.overlay);

    return [
      shade,
      card,
      rule,
      Renderer.centredDisplay(scene, cy - 110, 'PAUSED', 76),
      Renderer.option(scene, cy - 10, 'R   RESUME', 34, handlers.resume),
      Renderer.option(scene, cy + 46, 'S   SETTINGS', 34, handlers.settings),
      Renderer.option(scene, cy + 102, 'Q   QUIT TO MENU', 34, handlers.quit),
      Renderer.centred(scene, cy + 168, 'P or ESC also resumes', 16, Renderer.CSS.dim),
    ];
  },

  hidePause(scene, view) {
    if (view) view.forEach((o) => o.destroy());
  },

  /* --------------------------------------------------------------- events */

  onFacingChanged(scene, player) {
    player.sprite.setRotation(player.facing);
  },

  /*
   * The signature element. These labels are the joke, so they get the budget: oversized in
   * the display face, slammed in with an overshoot, tilted a few degrees off true, held,
   * then gone. Everything else on the pitch is deliberately quieter so that these land.
   *
   * Colour carries the category. Yellow for the comic ones, red for a disaster, white for
   * the merely wrong, so you can read what happened before you have read the words.
   */
  OUTCOME_TONE: {
    whiff: 'comic',
    backheel: 'comic',
    wildSlice: 'disaster',
    faceplant: 'disaster',
  },

  outcomeColour(outcomeKey) {
    const tone = Renderer.OUTCOME_TONE[outcomeKey];
    if (tone === 'comic') return Renderer.CSS.accent;
    if (tone === 'disaster') return Renderer.hex(Renderer.lighten(Renderer.THEME.redTeam, 0.25));
    return Renderer.CSS.hud;
  },

  onOutcome(scene, player, outcomeKey) {
    const str = Renderer.phraseFor(Renderer.OUTCOME_LABELS, outcomeKey);
    if (!str) return;

    const J = Renderer.JUICE.outcomeLabels;
    if (!J.on) return;

    const label = Renderer.display(scene, player.sprite.x, player.sprite.y - 44, str,
      J.size, Renderer.outcomeColour(outcomeKey))
      .setOrigin(0.5)
      .setDepth(Renderer.DEPTH.label)
      .setAngle(Phaser.Math.Between(-J.tiltDeg, J.tiltDeg))
      .setScale(0.4);

    // Keep it on screen: a wide label thrown by a player near the touchline would
    // otherwise hang off the edge where you cannot read it.
    const halfWidth = label.displayWidth / 2;
    label.x = Phaser.Math.Clamp(label.x, halfWidth + 12, CONFIG.CANVAS.width - halfWidth - 12);
    label.y = Math.max(label.y, label.displayHeight / 2 + 8);

    scene.tweens.add({
      targets: label,
      scale: 1,
      duration: J.overshootMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: label,
          y: label.y - 30,
          alpha: 0,
          delay: J.holdMs,
          duration: CONFIG.FEEDBACK.labelMs,
          ease: 'Quad.easeIn',
          onComplete: () => label.destroy(),
        });
      },
    });
  },

  /*
   * A burst of squares in a team colour, thrown from a point. Used for a goal and, in
   * bulk and falling, for full time. Plain images rather than a particle emitter, because
   * a few dozen of them is nothing and this way each one can be given its own arc.
   */
  burst(scene, x, y, colour, count, spread, gravity) {
    for (let i = 0; i < count; i++) {
      const piece = scene.add.image(x, y, 'px')
        .setDisplaySize(Phaser.Math.Between(5, 11), Phaser.Math.Between(5, 11))
        .setTint(colour)
        .setDepth(Renderer.DEPTH.overlay - 1)
        .setAngle(Phaser.Math.Between(0, 360));

      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const reach = Phaser.Math.Between(spread * 0.35, spread);
      const ms = Phaser.Math.Between(520, 1100);

      scene.tweens.add({
        targets: piece,
        x: x + Math.cos(angle) * reach,
        y: y + Math.sin(angle) * reach + gravity,
        angle: piece.angle + Phaser.Math.Between(-320, 320),
        alpha: 0,
        duration: ms,
        ease: 'Quad.easeOut',
        onComplete: () => piece.destroy(),
      });
    }
  },

  /* A flash of the whole screen, brief enough to register without blinding anyone. */
  flash(scene, colour, ms) {
    const sheet = scene.add.image(CONFIG.CANVAS.width / 2, CONFIG.CANVAS.height / 2, 'px')
      .setDisplaySize(CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .setTint(colour)
      .setAlpha(0.55)
      .setDepth(Renderer.DEPTH.overlay - 2);
    scene.tweens.add({
      targets: sheet,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => sheet.destroy(),
    });
  },

  onGoal(scene, team, scores) {
    const J = Renderer.JUICE.goalCelebration;
    const teamColour = team === 'red' ? Renderer.THEME.redTeam : Renderer.THEME.blueTeam;
    const cx = CONFIG.CANVAS.width / 2;
    const cy = CONFIG.CANVAS.height / 2;

    if (J.on) {
      Renderer.flash(scene, teamColour, J.flashMs);
      Renderer.burst(scene, cx, cy, teamColour, J.particles, 420, 60);
      if (Renderer.JUICE.cameraShake.on) {
        scene.cameras.main.shake(Renderer.JUICE.cameraShake.ms * 2,
          Renderer.JUICE.cameraShake.goal);
      }
    }

    // The banner sweeps in from the left and holds mid-screen, so the eye is dragged
    // across the pitch rather than having the word simply appear on top of it.
    const label = Renderer.display(scene, J.on ? -400 : cx, cy, 'GOAL!', 120,
      team === 'red' ? Renderer.CSS.red : Renderer.CSS.blue)
      .setOrigin(0.5)
      .setDepth(Renderer.DEPTH.overlay);

    if (!J.on) {
      scene.tweens.add({
        targets: label,
        alpha: 0,
        duration: CONFIG.MATCH.goalPauseMs,
        ease: 'Quad.easeIn',
        onComplete: () => label.destroy(),
      });
      return;
    }

    scene.tweens.add({
      targets: label,
      x: cx,
      duration: J.bannerMs * 0.4,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: label,
          x: CONFIG.CANVAS.width + 400,
          alpha: 0,
          delay: Math.max(0, CONFIG.MATCH.goalPauseMs - J.bannerMs),
          duration: J.bannerMs * 0.5,
          ease: 'Back.easeIn',
          onComplete: () => label.destroy(),
        });
      },
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
  /* Each number lands big and shrinks away, so the count reads as a beat rather than a
   * caption that happens to change. */
  onKickoffCount(scene, n) {
    const J = Renderer.JUICE.kickoffCountdown;
    const isGo = n <= 0;
    const label = Renderer.centredDisplay(scene, CONFIG.CANVAS.height / 2 + 120,
      isGo ? 'GO!' : String(n), J.on ? J.size : 88,
      isGo ? Renderer.CSS.accent : Renderer.CSS.hud);

    if (!J.on) {
      scene.tweens.add({
        targets: label,
        alpha: 0,
        duration: CONFIG.MATCH.kickoffStepMs,
        onComplete: () => label.destroy(),
      });
      return;
    }

    label.setScale(isGo ? 0.5 : 1.6);
    scene.tweens.add({
      targets: label,
      scale: isGo ? 1.25 : 1,
      duration: CONFIG.MATCH.kickoffStepMs * 0.45,
      ease: isGo ? 'Back.easeOut' : 'Quad.easeOut',
    });
    scene.tweens.add({
      targets: label,
      alpha: 0,
      duration: CONFIG.MATCH.kickoffStepMs,
      ease: 'Quad.easeIn',
      onComplete: () => label.destroy(),
    });
  },

  /* Defined now so the design pass has somewhere to hang an effect without
   * touching game logic. Deliberately silent in Phase 1. */
  /* ------------------------------------------------------------------ juice */

  /*
   * Squash and stretch. Everything springs back to 1, so an effect interrupted by another
   * still ends up the right shape rather than stuck mid-squash.
   */
  pulse(scene, sprite, scaleX, scaleY, ms) {
    sprite.setScale(scaleX, scaleY);
    scene.tweens.add({
      targets: sprite,
      scaleX: 1,
      scaleY: 1,
      duration: ms,
      ease: 'Back.easeOut',
    });
  },

  /*
   * Stars circling a head. Pass ms 0 for "until stopped", which is what a keeper freeze
   * needs since nobody knows in advance how long it lasts. Returns a stop function either
   * way, so the caller never has to care which kind it asked for.
   */
  orbitStars(scene, follow, count, radius, ms) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push(scene.add.image(follow.x, follow.y, 'star')
        .setTint(Renderer.THEME.lagerYellow)
        .setDepth(Renderer.DEPTH.label));
    }

    // Squashed vertically so they read as circling above a head, not orbiting flat.
    const place = (t) => {
      stars.forEach((star, i) => {
        const angle = t * Math.PI * 2 + (i / count) * Math.PI * 2;
        star.x = follow.x + Math.cos(angle) * radius;
        star.y = follow.y - 22 + Math.sin(angle) * radius * 0.4;
      });
    };

    // Spread before the first tween update, or every star spends frame one stacked on
    // the same spot and the ring appears to pop into existence.
    place(0);

    const spin = { t: 0 };
    const tween = scene.tweens.add({
      targets: spin,
      t: 1,
      duration: 900,
      repeat: -1,
      onUpdate: () => place(spin.t),
    });

    const stop = () => {
      tween.stop();
      stars.forEach((star) => star.destroy());
    };
    if (ms > 0) scene.time.delayedCall(ms, stop);
    return stop;
  },

  onKick(scene, player, kind, impulse) {
    const J = Renderer.JUICE;

    if (J.squashStretch.on) {
      const k = J.squashStretch.kick;
      Renderer.pulse(scene, player.sprite, 1 + k, 1 - k * 0.7, J.squashStretch.recoverMs);
    }

    if (J.cameraShake.on) {
      const per = kind === 'shoot' ? J.cameraShake.shootScale : J.cameraShake.passScale;
      scene.cameras.main.shake(J.cameraShake.ms, impulse * per);
    }
  },

  onWallBounce(scene, x, y, speed) {
    const J = Renderer.JUICE.squashStretch;
    if (!J.on || speed < 120) return;
    const ball = scene.children.list.find((o) => o.texture && o.texture.key === 'ball'
      && o.depth === Renderer.DEPTH.ball);
    if (ball) Renderer.pulse(scene, ball, 1 - J.impact, 1 + J.impact, J.recoverMs);
  },

  onKeeperSave(scene, keeper, speed) {
    const J = Renderer.JUICE;
    if (J.squashStretch.on) {
      Renderer.pulse(scene, keeper.sprite, 1 - J.squashStretch.impact * 0.5,
        1 + J.squashStretch.impact, J.squashStretch.recoverMs);
    }
    if (J.cameraShake.on && speed > 300) {
      scene.cameras.main.shake(J.cameraShake.ms * 0.7, J.cameraShake.shootScale * speed * 0.6);
    }
  },

  /*
   * A ball going straight through the keeper needs saying out loud, or it reads as the
   * ball glitching through a solid object rather than the keeper being beaten. The keeper
   * flails the wrong way, which is both the explanation and the joke.
   */
  KEEPER_BEATEN_LABELS: [
    'THROUGH HIM!', 'WRONG WAY!', 'NOT A FINGER ON IT', 'DIVED EARLY',
    'STATUESQUE', 'WAVED IT IN', 'AFTER YOU',
  ],

  onKeeperBeaten(scene, keeper, speed) {
    if (!Renderer.JUICE.outcomeLabels.on) return;

    const J = Renderer.JUICE.outcomeLabels;
    const phrase = Renderer.KEEPER_BEATEN_LABELS[
      Phaser.Math.Between(0, Renderer.KEEPER_BEATEN_LABELS.length - 1)];

    const label = Renderer.display(scene, keeper.sprite.x, keeper.sprite.y - 52, phrase,
      J.size * 0.62, Renderer.hex(Renderer.lighten(Renderer.THEME.redTeam, 0.25)))
      .setOrigin(0.5)
      .setDepth(Renderer.DEPTH.label)
      .setAngle(Phaser.Math.Between(-J.tiltDeg, J.tiltDeg))
      .setScale(0.4);

    // Thrown from a goalmouth, so it needs pulling back onto the screen.
    const half = label.displayWidth / 2;
    label.x = Phaser.Math.Clamp(label.x, half + 12, CONFIG.CANVAS.width - half - 12);

    scene.tweens.add({
      targets: label,
      scale: 1,
      duration: J.overshootMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: label,
          y: label.y - 26,
          alpha: 0,
          delay: J.holdMs,
          duration: CONFIG.FEEDBACK.labelMs,
          onComplete: () => label.destroy(),
        });
      },
    });

    // A dive at nothing, away from where the ball actually went.
    if (Renderer.JUICE.faceplant.on) {
      const upright = keeper.sprite.rotation;
      scene.tweens.add({
        targets: keeper.sprite,
        rotation: upright + Phaser.Math.DegToRad(Phaser.Math.Between(20, 38)),
        duration: 180,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }
  },

  /* A keeper hoofing it clear is a kick like any other, so it gets the same recoil. */
  onKeeperClear(scene, keeper, mate) {
    const J = Renderer.JUICE.squashStretch;
    if (!J.on) return;
    Renderer.pulse(scene, keeper.sprite, 1 + J.kick * 0.5, 1 - J.kick * 0.4, J.recoverMs);
  },

  /*
   * A frozen keeper is the scoring window, so it has to be readable at a glance rather
   * than something you infer from it not moving.
   */
  onKeeperFreeze(scene, keeper, frozen) {
    const J = Renderer.JUICE.keeperFreeze;
    if (!J.on) return;

    if (!frozen) {
      if (keeper.freezeFx) {
        keeper.freezeFx();
        keeper.freezeFx = null;
      }
      return;
    }
    if (keeper.freezeFx) return;
    keeper.freezeFx = Renderer.orbitStars(scene, keeper.sprite, J.stars, J.orbitPx, 0);
  },

  /*
   * The ring lives for the whole match and is moved and hidden by onTick, because
   * possession changes far more often than the ring needs rebuilding. This hook only
   * announces the change, with a pop so a tackle or an interception is felt rather than
   * merely being true.
   */
  ownerRing(scene) {
    if (!scene.juiceState) scene.juiceState = { nextTrailAt: 0 };
    if (!scene.juiceState.ring) {
      scene.juiceState.ring = scene.add.image(0, 0, 'owner_ring')
        .setTint(Renderer.THEME.lagerYellow)
        .setDepth(Renderer.DEPTH.player - 1)
        .setVisible(false);
    }
    return scene.juiceState.ring;
  },

  onPossessionChange(scene, player) {
    const J = Renderer.JUICE.possessionRing;
    if (!J.on || !player) return;
    const ring = Renderer.ownerRing(scene);
    ring.setPosition(player.sprite.x, player.sprite.y).setVisible(true);
    Renderer.pulse(scene, ring, 1 + J.pulse, 1 + J.pulse, J.pulseMs);
  },

  onStumble(scene, player, ms) {
    const J = Renderer.JUICE.stumbleJiggle;
    if (!J.on) return;
    const home = player.sprite.x;
    scene.tweens.add({
      targets: player.sprite,
      x: home + J.px,
      duration: Math.max(40, ms / J.shakes),
      yoyo: true,
      repeat: J.shakes,
      ease: 'Sine.easeInOut',
      onComplete: () => { player.sprite.x = home; },
    });
  },

  onFaceplant(scene, player, ms) {
    const J = Renderer.JUICE.faceplant;
    if (!J.on) return;

    const upright = player.sprite.rotation;
    scene.tweens.add({
      targets: player.sprite,
      rotation: upright + Phaser.Math.DegToRad(J.spinDeg),
      duration: 320,
      ease: 'Bounce.easeOut',
    });

    Renderer.orbitStars(scene, player.sprite, J.stars, J.orbitPx, ms);

    // Back on their feet exactly when the stun ends, so the picture and the rules agree.
    scene.time.delayedCall(ms, () => {
      scene.tweens.add({
        targets: player.sprite,
        rotation: player.facing,
        duration: 180,
        ease: 'Quad.easeOut',
      });
    });
  },
  onPenaltyResult(scene, team, outcomeKey, scored) {},
  onFullTime(scene, result) {},
  /*
   * The two effects that run every frame rather than firing on an event.
   *
   * The sway is the theme made continuous: a slow sine wobble laid on top of facing, never
   * replacing it, and capped small. Facing is the only thing telling you which way a
   * player will kick, so it has to survive being wobbled.
   */
  onTick(scene, view, time, delta) {
    const J = Renderer.JUICE;

    // A scene being torn down can take one more update after its objects have gone, so
    // nothing here may assume the bodies it is about to read still exist.
    if (!view.ball || !view.ball.body) return;

    if (!scene.juiceState) scene.juiceState = { nextTrailAt: 0 };

    if (J.drunkSway.on) {
      const amplitude = Phaser.Math.DegToRad(J.drunkSway.degrees);
      view.players.forEach((player, i) => {
        if (!player.sprite || !player.sprite.body) return;
        // Not while they are on the floor: the faceplant owns the rotation until they are up.
        if (time < player.stunnedUntil) return;
        const moving = player.sprite.body.speed > 5;
        // Offset per player, or the two of them wobble in lockstep like a dance troupe.
        const phase = (time / J.drunkSway.periodMs) * Math.PI * 2 + i * 2.1;
        player.sprite.setRotation(player.facing + (moving ? Math.sin(phase) * amplitude : 0));
      });
    }

    // Possession changes hands constantly, so the ring is moved rather than rebuilt, and
    // hidden the moment the ball is loose. A stale ring would be worse than none: it would
    // say someone still has it.
    const ring = Renderer.ownerRing(scene);
    const owner = J.possessionRing.on ? view.state.owner : null;
    // Switched off counts as nobody: otherwise flicking it off mid-match leaves the last
    // ring stranded on a player who may since have lost the ball.
    if (owner) ring.setPosition(owner.sprite.x, owner.sprite.y).setVisible(true);
    else ring.setVisible(false);

    if (J.ballTrail.on && view.ball.body.speed > J.ballTrail.minSpeed
      && time >= scene.juiceState.nextTrailAt) {
      scene.juiceState.nextTrailAt = time + J.ballTrail.everyMs;
      const dot = scene.add.image(view.ball.x, view.ball.y, 'ball')
        .setDepth(Renderer.DEPTH.ball - 1)
        .setScale(0.75)
        .setAlpha(0.45);
      scene.tweens.add({
        targets: dot,
        alpha: 0,
        scale: 0.2,
        duration: J.ballTrail.fadeMs,
        ease: 'Quad.easeOut',
        onComplete: () => dot.destroy(),
      });
    }
  },

  /* ----------------------------------------------------------- menu scene */

  createMenu(scene, onPick, touch) {
    const C = Renderer.CSS;
    const cx = CONFIG.CANVAS.width / 2;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 205, CONFIG.CANVAS.width, 290);

    // The display face is a good deal taller than the system stack at the same size, so
    // the subtitle needs pushing clear of it rather than sitting where it always did.
    Renderer.centredDisplay(scene, 104, 'DRUNK FOOTBALL', 92);
    Renderer.centred(scene, 176, 'you know what you meant to do', 20, C.dim);

    // Naming keys to somebody holding a phone is worse than saying nothing, so the same
    // space explains the thumb controls instead.
    if (touch) {
      Renderer.centred(scene, 288, 'Drag anywhere on the left to run.', 24);
      Renderer.centred(scene, 332, 'PASS and SHOOT are under your right thumb.', 24);
    } else {
      Renderer.keyTable(scene, cx - 250, 250, 34, cx - 20, cx + 205, 22);
    }

    Renderer.centred(scene, 420, 'Pass and Shoot only work when you have the ball.', 16, C.dim);
    Renderer.centred(scene, 446, 'Having the ball is no guarantee your legs agree.', 16, C.dim);

    Renderer.option(scene, 560, 'PLAY', 46, () => onPick(0));
    Renderer.option(scene, 630, 'SETTINGS', 34, () => onPick(1));
    Renderer.centred(scene, 692,
      touch ? 'tap either' : 'click either, or press 1 and 2', 15, C.dim);
  },

  /* What kind of game. Everything the front screen used to offer, one step in. */
  createPlay(scene, onPick) {
    const C = Renderer.CSS;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 205, CONFIG.CANVAS.width, 290);

    Renderer.centred(scene, 110, 'PLAY', 66);
    Renderer.centred(scene, 166, 'three minutes, or straight to the spot', 20, C.dim);

    Renderer.option(scene, 270, 'PRESS  1  ONE PLAYER vs BOT', 32, () => onPick(0));
    Renderer.centred(scene, 302, 'you against a bot of your choosing', 16, C.dim);

    Renderer.option(scene, 360, 'PRESS  2  TWO PLAYERS', 32, () => onPick(1));
    Renderer.centred(scene, 392, 'both of you on the same keyboard', 16, C.dim);

    Renderer.option(scene, 450, 'PRESS  3  PENALTY SHOOTOUT', 32, () => onPick(2));
    Renderer.centred(scene, 482, 'no match first, straight to the spot', 16, C.dim);

    Renderer.centred(scene, 570,
      'Match is ' + Math.round(CONFIG.MATCH.durationSec / 60) +
      ' minutes. Level at full time goes to penalties.', 16, C.dim);
    Renderer.centred(scene, 640, 'ESC  to go back', 22, C.dim);
  },

  /* Same furniture as the menu, so stepping between the two screens does not move the
   * title or the green band under your eye. */
  createDifficulty(scene, onPick) {
    const C = Renderer.CSS;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 205, CONFIG.CANVAS.width, 290);

    Renderer.centred(scene, 110, 'CHOOSE YOUR OPPONENT', 60);
    Renderer.centred(scene, 166, 'one player vs bot', 20, C.dim);

    // Driven off CONFIG.BOT.order so the numbers on screen cannot drift from the
    // numbers the scene actually reads.
    CONFIG.BOT.order.forEach((level, i) => {
      const y = 258 + i * 90;
      Renderer.option(scene, y, 'PRESS  ' + (i + 1) + '  ' + level.toUpperCase(), 32, () => onPick(i));
      Renderer.centred(scene, y + 32, Renderer.DIFFICULTY_BLURB[level], 16, C.dim);
    });

    Renderer.centred(scene, 570, 'Every bot is exactly as drunk as you are. Only its judgement changes.', 16, C.dim);
    Renderer.centred(scene, 640, 'ESC  to go back', 22, C.dim);
  },

  /*
   * Everything the skins drawer used to hold, plus the mouse setting, laid out as a column
   * rather than a panel. One list in one place beats the same list in two.
   */
  createSettings(scene, state, handlers) {
    const C = Renderer.CSS;
    const cx = CONFIG.CANVAS.width / 2;
    const nameX = cx - 320;
    const blurbX = cx - 100;
    const swatchX = cx + 300;

    const band = Renderer.SETTINGS_BAND;
    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, band.top, CONFIG.CANVAS.width, band.height);

    Renderer.centredDisplay(scene, 110, 'SETTINGS', 72);
    /*
     * Opened from a paused match, a new skin cannot repaint the match already drawn behind
     * this screen, because it is using the textures baked for the old one. Saying so beats
     * letting someone pick a skin and watch nothing happen.
     */
    Renderer.centred(scene, 172, state.inMatch
      ? 'kept between sessions  ·  a new skin starts with the next match'
      : 'kept between sessions', 20, C.dim);

    Renderer.text(scene, nameX, 220, 'SKIN', 18, C.accent).setDepth(Renderer.DEPTH.overlay);

    Renderer.SKINS.forEach((skin, i) => {
      const y = 258 + i * 32;
      const current = skin.key === Renderer.activeSkin;
      if (current) {
        Renderer.text(scene, nameX - 26, y, '>', 20, C.hud)
          .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);
      }
      Renderer.optionAt(scene, nameX, y, (i + 1) + '   ' + skin.name, 22,
        () => handlers.skin(skin.key), current ? C.hud : C.accent);
      Renderer.text(scene, blurbX, y, skin.blurb, 14, C.dim)
        .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);
      // Each swatch gets a dark backing, or a skin whose grass matches the band behind it
      // appears to be missing one.
      [skin.colours.redTeam, skin.colours.blueTeam, skin.colours.pitchGreen].forEach((colour, j) => {
        scene.add.image(swatchX + j * 28, y, 'px')
          .setDisplaySize(26, 26).setTint(Renderer.PALETTE.outline)
          .setDepth(Renderer.DEPTH.overlay);
        scene.add.image(swatchX + j * 28, y, 'px')
          .setDisplaySize(22, 22).setTint(colour).setDepth(Renderer.DEPTH.overlay);
      });
    });

    Renderer.text(scene, nameX, 410, 'CONTROLS', 18, C.accent).setDepth(Renderer.DEPTH.overlay);

    // Further right than the skin blurbs, because these labels are a good deal wider.
    Renderer.optionAt(scene, nameX, 442,
      'M   MOUSE CLICKS   ' + (state.mouseClicks ? 'ON' : 'OFF'), 22, handlers.mouse);
    Renderer.text(scene, cx - 10, 442,
      'left click passes, right click shoots, one player only', 14, C.dim)
      .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);

    Renderer.optionAt(scene, nameX, 474,
      'T   THUMB CONTROLS   ' + state.touch.toUpperCase(), 22, handlers.touch);
    Renderer.text(scene, cx - 10, 474, Renderer.TOUCH_BLURB[state.touch], 14, C.dim)
      .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);

    // The keys themselves, read straight out of CONFIG.CONTROLS so a remap can never
    // leave this screen telling you something the game no longer does. Four rows, and the
    // last of them has to finish inside the green band above the legacy button.
    Renderer.keyTable(scene, nameX, 504, 25, nameX + 230, nameX + 410, 20);

    // Under the settings rather than among them, because it is not one: it leaves for a
    // different build of the game entirely.
    Renderer.option(scene, 640, 'LEGACY MODE', 28, handlers.legacy);
    Renderer.centred(scene, 670,
      'the game as it was when blue shot with - and =', 14, C.dim);

    Renderer.centred(scene, 700,
      state.inMatch ? 'ESC  back to the match' : 'ESC  to go back', 20, C.dim);
  },

  /* Same furniture again, so the three menus feel like one screen changing its mind. */
  createPenaltyMode(scene, onPick) {
    const C = Renderer.CSS;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 205, CONFIG.CANVAS.width, 290);

    Renderer.centred(scene, 110, 'PENALTY SHOOTOUT', 60);
    Renderer.centred(scene, 166, 'no match first, straight to the spot', 20, C.dim);

    Renderer.option(scene, 290, 'PRESS  1  vs BOT', 32, () => onPick(0));
    Renderer.centred(scene, 322, 'it picks a corner at random, exactly as you do', 16, C.dim);

    Renderer.option(scene, 400, 'PRESS  2  TWO PLAYERS', 32, () => onPick(1));
    Renderer.centred(scene, 432, 'take it in turns, both of you pick your own corner', 16, C.dim);

    Renderer.centred(scene, 570,
      CONFIG.PENALTY.kicksEach + ' kicks each, then sudden death.', 16, C.dim);
    Renderer.centred(scene, 640, 'ESC  to go back', 22, C.dim);
  },

  /* -------------------------------------------------------- penalty scene */

  /*
   * The numbered thirds answer to a tap as well as to their number key, which is what
   * makes a shootout possible on a phone at all. Reported by index, so both ways in land
   * on the same code and a taker can never pick a corner one of them cannot reach.
   *
   * The zones reach back off the goal line into the six-yard box rather than covering only
   * the net, because a third of a goal mouth is a small thing to hit with a thumb.
   */
  makePenaltyPicksTappable(scene, geom, onPick) {
    const reachBack = 70;
    const width = reachBack + geom.goalDepth;
    const height = geom.mouthHeight / CONFIG.PENALTY.thirds.length;
    return CONFIG.PENALTY.thirds.map((third, i) =>
      scene.add.zone(geom.goalLineX - reachBack / 2 + geom.goalDepth / 2,
        geom.thirdY[third], width, height)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onPick(i)));
  },

  /*
   * Staged on the match pitch at blue's goal rather than on a diagram of its own, so the
   * stripes, boxes and corner arcs carry straight over from the match. The right-hand
   * third of the pitch does the work, which leaves the empty half for the wording.
   */
  createPenaltyView(scene, geom) {
    const C = Renderer.CSS;
    const P = Renderer.PALETTE;
    const PITCH = CONFIG.PITCH;
    const textX = PITCH.left + 380;      // clear of the far penalty box and the centre circle

    const g = Renderer.createPitch(scene);

    // The penalty spot, the one marking the match pitch has no reason to carry.
    g.fillStyle(P.line, 1).fillCircle(geom.spotX, geom.spotY, 5);

    Renderer.centred(scene, 22, 'PENALTY SHOOTOUT', 40);

    // Number the thirds, otherwise 1/2/3 is a guess rather than a choice.
    CONFIG.PENALTY.thirds.forEach((third, i) => {
      Renderer.text(scene, geom.goalLineX + geom.goalDepth / 2, geom.thirdY[third],
        String(i + 1), 26, C.accent).setOrigin(0.5).setDepth(Renderer.DEPTH.pitch + 1);
    });

    const taker = scene.add.image(geom.spotX - geom.takerOffsetX, geom.spotY, 'player_red')
      .setDepth(Renderer.DEPTH.player);
    taker.setOrigin(CONFIG.PLAYER.radius / taker.width, 0.5);

    const centredAt = (x, y, size, colour) =>
      Renderer.text(scene, x, y, '', size, colour).setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
    const displayAt = (x, y, size, colour) =>
      Renderer.display(scene, x, y, '', size, colour).setOrigin(0.5)
        .setDepth(Renderer.DEPTH.overlay);

    /*
     * The empty half is dressed as a broadcast panel: a dark card with a bar down its
     * edge, the running score large in the display face, the tally underneath. Framing
     * rather than decoration, so the shootout feels like an occasion.
     */
    if (Renderer.JUICE.penaltyDrama.on) {
      scene.add.image(textX, 232, 'px')
        .setDisplaySize(430, 210)
        .setTint(Renderer.THEME.nightBlack)
        .setAlpha(0.82)
        .setDepth(Renderer.DEPTH.overlay - 2);
      scene.add.image(textX - 210, 232, 'px')
        .setDisplaySize(10, 210)
        .setTint(Renderer.THEME.lagerYellow)
        .setDepth(Renderer.DEPTH.overlay - 2);
    }

    return {
      geom,
      taker,
      keeper: scene.add.image(geom.goalLineX - CONFIG.KEEPER.lineInset, geom.spotY, 'keeper_blue')
        .setDepth(Renderer.DEPTH.keeper),
      ball: scene.add.image(geom.spotX, geom.spotY, 'ball').setDepth(Renderer.DEPTH.ball),
      // Stacked above and below the centre circle, never across it.
      score: displayAt(textX, 168, 56),
      round: centredAt(textX, 208, 17, C.dim),
      tallyRed: Renderer.text(scene, textX - 150, 252, '', 24, C.red).setDepth(Renderer.DEPTH.overlay),
      tallyBlue: Renderer.text(scene, textX - 150, 288, '', 24, C.blue).setDepth(Renderer.DEPTH.overlay),
      prompt: centredAt(textX, 520, 28, C.accent),
      result: displayAt(textX, 578, 44),
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
    view.taker.setAngle(0).setPosition(geom.spotX - geom.takerOffsetX, geom.spotY);
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

  createFullTime(scene, result, handlers) {
    const C = Renderer.CSS;
    const winnerColour = result.winner === 'red' ? C.red : result.winner === 'blue' ? C.blue : C.hud;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, 200, CONFIG.CANVAS.width, 300);

    // A shootout on its own has no match behind it, so it gets its own heading and a
    // scoreline that is only the penalties.
    const standalone = !result.scores;

    Renderer.centred(scene, 150, standalone ? 'SHOOTOUT OVER' : 'FULL TIME', 40, C.dim);
    Renderer.centredDisplay(scene, 262,
      result.winner ? Renderer.TEAM_NAME[result.winner] + ' WINS' : 'HONOURS EVEN', 96, winnerColour);

    /*
     * The scoreline as a broadcast caption: a bar in the winner's colour with the numbers
     * sitting in it, rather than a line of text floating on the grass.
     */
    const cx = CONFIG.CANVAS.width / 2;
    const barY = 372;
    const winnerTint = result.winner === 'red' ? Renderer.THEME.redTeam
      : result.winner === 'blue' ? Renderer.THEME.blueTeam : Renderer.THEME.lagerYellow;

    scene.add.image(cx, barY, 'px')
      .setDisplaySize(430, 74)
      .setTint(Renderer.THEME.nightBlack)
      .setDepth(Renderer.DEPTH.overlay - 1);
    scene.add.image(cx - 215 + 5, barY, 'px')
      .setDisplaySize(10, 74)
      .setTint(winnerTint)
      .setDepth(Renderer.DEPTH.overlay - 1);

    const bigScore = standalone
      ? result.penalties.red + ' - ' + result.penalties.blue
      : result.scores.red + ' - ' + result.scores.blue;
    Renderer.centredDisplay(scene, barY - 6, bigScore, 54);

    const suffix = standalone ? 'on penalties'
      : result.penalties
        ? 'after penalties, ' + result.penalties.red + ' - ' + result.penalties.blue
        : '';
    if (suffix) Renderer.centred(scene, barY + 44, suffix, 16, C.dim);

    if (Renderer.JUICE.fullTimeConfetti.on && result.winner) {
      // Thrown from above the screen so it falls through the caption rather than out of it.
      Renderer.burst(scene, cx, -40, winnerTint,
        Renderer.JUICE.fullTimeConfetti.pieces, CONFIG.CANVAS.width * 0.55, 780);
    }

    // Both answer to a tap as well as to their key, or full time is the end of the road
    // on a device with no keyboard.
    Renderer.option(scene, 570, standalone ? 'SPACE  shoot again' : 'SPACE  rematch', 30,
      handlers.again);
    Renderer.option(scene, 612, 'M  menu', 30, handlers.menu);
  },
};
