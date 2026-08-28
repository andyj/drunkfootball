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
  /*
   * Floodlights, for the skin that is named after them. Four pylons in the corners of the
   * ground, each throwing a pool across the pitch, and everybody on it casting a shadow
   * away from every one of them. That last part is the whole effect: one shadow reads as a
   * drop shadow, four fanning out reads as being under lights.
   *
   * The pools are added rather than painted over, so where two overlap the grass gets
   * brighter, and the middle of the pitch ends up the best lit part of it exactly as it
   * would under four real towers.
   */
  FLOODLIGHTS: {
    poolRadius: 640,
    poolAlpha: 0.42,
    warm: 0xfff0c4,
    /* The pitch is taken down before any of it is lit back up. */
    darken: 0.44,
    /*
     * Seen from above a floodlight is a bank of lamps, not a mast, so that is all each one
     * is. Tucked into the corner, and close enough to the touchline to clear the control
     * legend along the very top of the surround, which is the only other thing up here.
     */
    pylonInsetX: 42,
    pylonInsetY: 12,
    headWidth: 34,
    headHeight: 15,
    glowRadius: 34,
    lamps: 6,
    shadow: {
      // Far enough out that four of them read as four, rather than as one dark halo.
      offset: 27,
      alpha: 0.32,
      scale: 1.2,
    },
  },

  /*
   * Three grounds to play in. Purely what surrounds the pitch: not one number here reaches
   * the playing area, so a big ground and a small one are the same match with a different
   * turnout watching it.
   *
   * The surround is 60px and that is all there is, so the sizes differ by how many rows
   * deep the crowd stands, how many of them there are, and whether there is a terrace
   * behind them or just a rail and some grass.
   */
  STADIUMS: [
    {
      /*
       * Sunday League's own ground, and the only one it ever plays in. No stand and no
       * seats: a rail, and whoever is standing behind it. Not in STADIUM_CHOICES, so it
       * cannot be picked for anything else and nothing else can be picked for it.
       */
      key: 'sunday', name: 'SUNDAY',
      blurb: 'a rail and a dozen unsteady witnesses',
      material: 'metal', structure: false, rows: 2, people: [10, 18], terrace: 0,
    },
    {
      key: 'small', name: 'SMALL',
      blurb: 'a metal stand and whoever wandered over',
      material: 'metal', structure: true, rows: 1, people: [26, 40], terrace: 0,
    },
    {
      key: 'medium', name: 'MEDIUM',
      blurb: 'brick terracing and a proper Saturday',
      material: 'brick', structure: true, rows: 2, people: [58, 78], terrace: 2,
    },
    {
      key: 'large', name: 'LARGE',
      blurb: 'brick, packed, and louder than the game deserves',
      // Packed tighter than the others, because three rows have to fit in the same 60px
      // of surround that one row has all to itself in a small ground.
      material: 'brick', structure: true, rows: 3, people: [150, 190],
      terrace: 3, standOff: 12, rowGap: 12,
      // And a stand behind each goal, left standing on its own with the corners open.
      ends: true,
    },
  ],

  /*
   * What a stand is built out of. A small ground is a scaffold of galvanised sheet with a
   * bench along it; the bigger two are brick terracing with plastic seats bolted to them.
   * Nothing here is derived from the skin: a ground is a ground whatever colour the kits
   * are, and a brick wall that changed colour with the strip would look like a mistake.
   */
  MATERIALS: {
    metal: {
      wall: 0x3f464c,
      edge: 0x5d666d,
      rail: 0x828b93,
      seat: 0x767f87,
      seatEdge: 0x4c545b,
      jointAlpha: 0.4,
      ribEvery: 16,       // corrugation, drawn across the sheet
    },
    brick: {
      /*
       * Brick at night rather than brick in a catalogue. The first go at this was a proper
       * terracotta and the stand shouted louder than the match did.
       */
      wall: 0x40261f,
      edge: 0x56332a,
      rail: 0x6b4c40,
      seat: 0x2e3a4a,     // plastic, bolted to the terracing
      seatEdge: 0x1e2733,
      jointAlpha: 0.33,
      courseEvery: 10,    // a course of bricks
      brickEvery: 26,     // and how long each brick is
    },
  },

  /*
   * The stands behind the goals, for the one ground big enough to have them. Deliberately
   * not joined to the ones down the sides: open corners are what a ground that grew a bit
   * at a time looks like, and a continuous bowl would read as a different, tidier place.
   */
  ENDS: {
    standOff: 10,       // grass between the back of the net and the front of the stand
    columnOff: 12,      // and between the front of the stand and the seats in it
    columnGap: 13,
    backMargin: 12,     // enough that somebody swaying in the back seat is still in it
    columns: 1,         // which is all the room left over runs to, once they can sway
    cornerGap: 46,      // how far short of the corners they stop, at both ends
    holeDepth: 18,      // a shallower stand than the sides, so a shallower way out
  },

  SEATS: {
    // Wider apart than a supporter is, so a full row still has air in it and an empty seat
    // in the middle of one is something you can actually see.
    every: 21,
    width: 12,
    height: 8,
  },

  /*
   * Nobody watches a whole match. Every so often somebody gets up, goes out through one of
   * the gaps at the back of the stand, and comes back with a drink to the seat they left,
   * which is sitting there empty in the meantime.
   */
  BEER: {
    everyMinMs: 900,
    everyMaxMs: 2600,
    maxAway: 7,           // so the stand never visibly empties
    walkMinMs: 600,
    walkMaxMs: 1000,
    awayMinMs: 1800,
    awayMaxMs: 4600,
    holeWidth: 30,
    holeDepth: 22,        // how far into the back of the stand the gap is cut
  },

  /* How long a player takes to stop being a shape in the dark, once he is moving. */
  ENTRANCE: { fadeMs: 420 },

  /*
   * The players' tunnel: a hole cut clean through the near stand, front to back, on the
   * halfway line where a tunnel belongs. That is the one stretch of the stand with no
   * seating in it, because the score and the clock are written above it, so the mouth
   * costs nobody their seat and the numbers sit over the dark of it.
   */
  TUNNEL: {
    alongPitch: 0.5,
    width: 36,             // one at a time, which is how a team comes out of one anyway
    deepen: 0.5,           // the far half darker, so it reads as going somewhere
    deepFraction: 0.55,
  },

  STADIUM_STORAGE_KEY: 'drunkfootball.stadium',
  /* 'random' rolls a fresh one every match. The other three pin it. */
  stadiumChoice: 'random',
  /* What the match being played is actually in, rolled once when its pitch is drawn. */
  currentStadium: null,

  /*
   * The referee. On the halfway line, where he can see both goals, and a stride to one
   * side of it, because the centre line itself is the one place on that touchline he
   * cannot stand: the tunnel comes out there and the score is written over it.
   *
   * 66px is measured rather than guessed. It clears the widest score the game can put up
   * and leaves the teams their doorway, and it is small enough against a 1120px pitch that
   * he still reads as standing on the halfway line. The far touchline is no better: the
   * pause button sits on the centre line down there, 168px of it.
   */
  REFEREE: {
    radius: 9,
    stripePx: 3.5,         // wide enough to read as stripes at nine pixels across
    haloPx: 3,             // and a white ring round the outside, so he can be found
    fromCentre: 66,        // along the line from the halfway line, clear of both
    offLine: 12,           // how far outside the touchline he stands
    blowScale: 1.35,       // the puff he gives it
    blowMs: 190,
    flashRadius: 12,
    flashMs: 320,
  },

  CROWD: {
    fence: 0x4a5058,
    railInset: 12,          // how far outside the touchline the rail sits
    postEvery: 60,
    postHalfHeight: 5,
    figureRadius: 8,
    standOff: 16,           // gap between the rail and the front row
    /*
     * The stretches of surround with nothing else in them. The top bands are the
     * narrower pair because the score, both control lines and the shootout title all
     * live up there, and the bottom pair leaves the middle clear for the pause hint.
     * The top gap is sized against the widest thing that sits in it, the shootout
     * title, with room left over for jitterX and a figure's radius.
     */
    /*
     * Where there is room to stand, as fractions of the pitch width rather than pixels: the
     * wide frame slides the pitch sideways, and a crowd written down in absolute
     * coordinates walked out from under it and stood on the score.
     *
     * The gaps are measured off the HUD at its widest, not guessed. Along the top that is
     * the control legend out to 0.185, the score and clock between 0.470 and 0.530, and
     * the bot or blue legend from 0.887. Along the bottom it is the pause hint, 0.404 to
     * 0.596, which is also where the pause button sits. Everything here keeps 0.02 clear
     * of those, which is a shade more than a supporter's own width.
     */
    bands: {
      top: [[0.205, 0.450], [0.550, 0.867]],
      bottom: [[0.054, 0.384], [0.616, 0.946]],
    },
    rowGap: 15,             // how much deeper each row stands, away from the touchline
    /*
     * Each row back is drawn a little smaller. Depth, mostly, but it is also what lets a
     * third row fit at all: at full size the back row of a packed terrace hangs off the
     * top of the screen.
     */
    rowScale: 0.86,
    jitterX: 5,
    jitterY: 4,
    jackets: [0x3b4a5a, 0x5a4634, 0x2f3b2f, 0x4a3a4a, 0x63513a, 0x40506b],
    swayPx: 4,
    swayMinMs: 1100,
    swayMaxMs: 2100,
  },

  /*
   * Thumb controls, in the gutters the wide frame exists to provide. Nothing sits on the
   * pitch: the stick has a column of its own down the left, the buttons have one down the
   * right, and the ball is never behind a thumb.
   *
   * Sizes are the design ones and positions are worked out from the frame rather than
   * written down, so the gutter width is the only number to change.
   */
  TOUCH: {
    textureSize: 256,
    ringWidth: 12,

    stickBaseRadius: 95,
    stickNubRadius: 44,
    stickTravel: 68,
    stickClear: 6,        // breathing room, so nothing ever lands exactly on the touchline
    stickY: 455,          // where a thumb sits with a phone held sideways, not the middle

    buttons: [
      { key: 'pass', y: 355, radius: 58, label: 'PASS', size: 19 },
      { key: 'shoot', y: 520, radius: 66, label: 'SHOOT', size: 22 },
    ],
    pause: { y: 688, width: 168, height: 46, edgeWidth: 3, label: 'PAUSE', size: 20 },

    gutterTint: 0.06,     // how far the control columns are lifted off the surround
    restAlpha: 0.34,
    liveAlpha: 0.52,
    pressMs: 140,
  },

  /*
   * Pitch decoration. None of this is read by game.js and none of it changes where the
   * ball can go, which is exactly why it lives here rather than in CONFIG.PITCH. Sizes
   * are eyeballed against the 1120x600 playing area, not scaled from real yardages.
   */
  /*
   * The pitch itself, rather than the mowing. A few hundred short strokes, half of them a
   * shade lighter than the band they stand in and half a shade darker, leaning whichever
   * way they feel like: from above that reads as grass instead of paint. Drawn once into
   * the pitch's own graphics, so it costs a few hundred lines when the match is built and
   * nothing at all per frame, and grouped by band and shade so it is two dozen style
   * changes rather than nine hundred.
   */
  GRASS: {
    perBand: 220,
    lengthMin: 4,
    lengthMax: 11,
    lean: 5,
    lift: 0.2,               // how much lighter the light blades are than their band
    sink: 0.17,              // and how much darker the dark ones
    alpha: 0.6,
  },

  /*
   * Snow lying on a frozen pitch. Stippled rather than painted: a patch is a scatter of
   * specks, thick in the middle and thinning out to nothing, because a translucent blob is
   * a translucent blob and half a dozen of them overlapping is a tray of soap bubbles.
   * Laid under the chalk, so the lines stay readable however deep it gets.
   */
  LYING_SNOW: {
    patches: 22,
    radiusMin: 26,
    radiusMax: 64,
    coreMin: 4,              // opaque blobs making the solid middle of a drift
    coreMax: 7,
    specksMin: 70,
    specksMax: 150,
    speckMin: 1,
    speckMax: 3.4,
    /* And a dusting over everything else, so no part of it looks swept. */
    dusting: 380,
  },

  /*
   * What is coming down, and how fast. Each mote falls on a tween rather than off the
   * clock, so the weather keeps going in the shootout too, where nothing calls onTick.
   *
   * Rain is thin, fast and nearly straight; snow is fat, slow and all over the place. Wind
   * is not falling at all: it is blown across, which is why it has an axis of its own.
   */
  FALLING: {
    snow: {
      texture: 'flake',
      motes: 70,
      aspect: 1,             // a flake is a dot; a drop and a gust are streaks
      sizeMin: 2.4,
      sizeMax: 5.6,
      speedMin: 90,          // px a second
      speedMax: 210,
      driftMax: 40,          // and how far sideways it gets on the way down
      alphaMin: 0.5,
      alphaMax: 0.95,
    },
    rainy: {
      texture: 'raindrop',
      motes: 150,
      aspect: 0.22,
      sizeMin: 9,
      sizeMax: 17,
      speedMin: 780,
      speedMax: 1150,
      driftMax: 130,
      alphaMin: 0.25,
      alphaMax: 0.5,
    },
    windy: {
      texture: 'gust',
      motes: 34,
      aspect: 0.13,
      sizeMin: 14,
      sizeMax: 34,
      speedMin: 420,
      speedMax: 820,
      driftMax: 60,
      alphaMin: 0.16,
      alphaMax: 0.34,
      across: true,          // blown from one side to the other rather than falling
    },
  },

  /*
   * Fog: a flat haze over the lot, and banks of it drifting through. Baked soft rather
   * than drawn, because a circle at one alpha is a plate, not a cloud.
   *
   * Fog is weather, not a setting, so it does not sit at one thickness: the flat layer
   * rolls in until the far goal is nearly gone and then lifts again, over about ten
   * seconds each way. That is what lets it get genuinely bad — at the thick end only a
   * fifth of the picture is coming through — without the match becoming unplayable,
   * because it always clears again.
   *
   * All of the cycling is on the flat layer and none of it on the banks, deliberately. The
   * flat layer is uniform so it never stacks with itself, which makes the thick end a
   * number you can predict; bank alpha stacks wherever two overlap, so those stay low and
   * steady. Readability before decoration, and the ball is drawn under all of this.
   */
  FOG: {
    thin: 0.46,              // the flat haze at its clearest
    thick: 0.78,             // and at its worst, a few seconds later
    rollMsMin: 7000,         // how long it takes to close in, or to lift again
    rollMsMax: 11000,
    banks: 14,
    sizeMin: 300,
    sizeMax: 660,
    alphaMin: 0.10,
    alphaMax: 0.18,
    crossMsMin: 24000,
    crossMsMax: 46000,
    rings: 14,               // how many steps the soft edge is baked in
  },

  /* What it is doing today, rolled when the pitch is drawn, and which way it is blowing. */
  weather: 'sunny',
  windAngle: 0,

  /*
   * What a kick takes out of a park pitch. Mud is mud whatever the kits are, the same way
   * a brick stand is brick: none of this comes off the skin.
   */
  WEAR_MARK: {
    mud: 0x4a3a26,
    scuffs: 3,
    spread: 15,              // how far the studs throw it about
    lengthMin: 3,
    lengthMax: 9,
    alpha: 0.55,
    divotRadius: 4,
  },

  MARKINGS: {
    stripes: 10,             // mown bands running goal to goal
    penaltyDepth: 130,
    penaltyHeight: 300,
    goalAreaDepth: 52,
    goalAreaHeight: 180,
    cornerRadius: 18,
  },

  /*
   * The goal, seen from directly overhead: two uprights standing on the line, the side
   * netting running back from them, and the back of the net slung between the stanchions.
   * Drawing only. The mouth a ball has to cross is CONFIG.PITCH's and nothing here moves
   * it, which is why a post can be drawn wider than a post without changing a game.
   */
  GOAL: {
    netSpacing: 8,           // gap between the strands of the mesh
    netSlices: 6,            // bands of shade from the mouth to the back of the net
    /*
     * Depth is drawn by lifting the mouth rather than by darkening the back, because the
     * back of the net is already sitting at the one colour the palette guarantees is off
     * the surround. Darken past that and the goal stops having a shape at all.
     */
    mouthLift: 0.2,
    strandAlpha: 0.32,       // the mesh where the light still reaches it
    strandFade: 0.8,         // and how little of it is left at the back
    barWidth: 5,             // the frame, the same steel the whole way round
    contactSpread: 5,        // the shade it sits in, which is what gives it thickness
    contactAlpha: 0.4,
    backWidth: 3,            // the back of the net is cord, not another bar
    backAlpha: 0.62,
    crossbarAlpha: 0.36,     // from overhead the bar lies along the line and hides nothing
    postRadius: 5,
    stanchionRadius: 3,
    rimAlpha: 0.5,
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
    goalCelebration: {
      on: true, flashMs: 140, particles: 46, bannerMs: 900,
      /* And the crowd, who are the only ones in the ground with nothing else to do. */
      crowdJump: 1.5, crowdJumpMs: 150, crowdJumps: 3, crowdStaggerMs: 260,
    },
    kickoffCountdown: { on: true, size: 92 },
    penaltyDrama: { on: true },
    fullTimeConfetti: { on: true, pieces: 90 },
    /* Towers, pools and four shadows each, on the one skin that asks for them. */
    floodlights: { on: true },
  },

  /*
   * Hands. A player runs with his fists up and a keeper spreads his. The player's are two
   * sprites carried about by him rather than part of him, because they swing when he runs;
   * the keeper's are baked in, because his are simply held out.
   */
  HANDS: {
    radius: 5,
    spreadDeg: 66,           // out from the way he is facing
    reach: 15,               // and how far out from the middle of him
    pumpPx: 4,               // how far they swing, fore and aft, when he is running
    periodMs: 300,
    runningAbove: 12,        // px a second that counts as running rather than standing
  },

  KEEPER_ART: {
    radius: 12,
    handRadius: 6,
    armWidth: 5,
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
      key: 'floodlit',
      name: 'FLOODLIT',
      blurb: 'four towers, four shadows, and a very dark night',
      /* The only skin that gets the towers. Everything else is played in daylight. */
      lights: true,
      // Darker than any other ground, because the pools are about to put the light back
      // where the towers point and nowhere else.
      colours: {
        pitchGreen: 0x123a1f, stripe: 0x164426, chalkWhite: 0xffffff,
        redTeam: 0xff5a5a, blueTeam: 0x5aa0ff,
        lagerYellow: 0xffd166, nightBlack: 0x080b11,
      },
    },
    {
      key: 'frozen',
      name: 'FROZEN',
      blurb: 'frost underfoot, everything slides a bit further',
      /*
       * Snow lies on it always, and it insists on its own share of the weather: a frozen
       * pitch snows a third of the time whatever the general table says, and the rest of
       * the table divides up what is left.
       */
      snowy: true,
      weather: { snow: 1 / 3 },
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
      /* Its own ground, always. A park pitch in a brick terrace is not a park pitch. */
      ground: 'sunday',
      colours: {
        pitchGreen: 0x5a6b3a, stripe: 0x63753f, chalkWhite: 0xd8d2c0,
        redTeam: 0xe86a17, blueTeam: 0x7a3fbf,
        lagerYellow: 0xffd166, nightBlack: 0x22261c,
      },
    },
  ],

  /*
   * What every run opens on, whatever the last one was left set to. The skins are a laugh
   * to be reached for rather than a wardrobe to be kept: this game should look like this
   * game when you load it. Named rather than taken from the top of the list, because the
   * order of SKINS is what the settings screen shows and which number picks which, and
   * reordering it must not quietly change what the game opens on.
   */
  DEFAULT_SKIN: 'classic',
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
  },

  /*
   * Textures are baked from the palette and cached by key, so a new skin makes them stale.
   * Throwing them away on the spot crashes the next render, because sprites already on
   * screen still point at them. So a skin change only bumps a version number, and the
   * stale textures are replaced at the top of the next scene's create, before that scene
   * has made a single sprite. Changing a skin therefore means: apply, restart, done.
   */
  PALETTE_DEPENDENT_TEXTURES: [
    'player_red', 'player_blue', 'keeper_red', 'keeper_blue', 'ball', 'referee', 'flake',
    'hand_red', 'hand_blue', 'raindrop', 'gust', 'fogbank',
  ],
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

    // A fist, in a lighter shade of the kit so it reads as a hand rather than as more
    // player. Its own texture because what a hand does is move: these are not baked into
    // the body, they are carried about by it.
    const H = Renderer.HANDS;
    const hand = (key, fill) => bake(key, H.radius * 2, H.radius * 2, () => {
      g.fillStyle(Renderer.lighten(fill, 0.4), 1);
      g.lineStyle(2, P.outline, 1);
      g.fillCircle(H.radius, H.radius, H.radius - 1);
      g.strokeCircle(H.radius, H.radius, H.radius - 1);
    });
    hand('hand_red', P.red);
    hand('hand_blue', P.blue);

    // A supporter, seen from above: a blob. Baked white so each one can be tinted into
    // its own coat without a texture per colour.
    const fr = Renderer.CROWD.figureRadius;
    bake('fan', fr * 2, fr * 2, () => {
      g.fillStyle(0xffffff, 1);
      g.lineStyle(2, P.outline, 1);
      g.fillCircle(fr, fr, fr - 1);
      g.strokeCircle(fr, fr, fr - 1);
    });

    /*
     * The referee, seen from above: the same blob as a supporter, in the one kit nobody
     * else in the ground is wearing. Black and white stripes, which is the referee's own.
     *
     * Built out from the middle in rings: a white one round the outside so he can be
     * picked out of a dark surround and a brown stand at a glance, a dark rim inside that
     * to draw him, and the striped shirt inside that.
     */
    const rr = Renderer.REFEREE.radius;
    const stripe = Renderer.REFEREE.stripePx;
    const outer = Renderer.refereeOuter();
    const shirt = rr - 2;
    bake('referee', outer * 2, outer * 2, () => {
      g.fillStyle(Renderer.THEME.chalkWhite, 1);
      g.fillCircle(outer, outer, outer);
      g.fillStyle(P.outline, 1);
      g.fillCircle(outer, outer, rr);
      g.fillStyle(Renderer.THEME.chalkWhite, 1);
      g.fillCircle(outer, outer, shirt);

      /*
       * The stripes, a column at a time, each as tall as the shirt is at that point. A
       * rectangle laid across a circle has corners, and a referee with corners is a brick.
       * Rounded about the middle so the pattern is the same either side of him, and white
       * down the middle so the dark rim has a stripe of its own either side of it rather
       * than a black band merging into it.
       */
      g.fillStyle(P.outline, 1);
      for (let x = outer - shirt; x < outer + shirt; x += 1) {
        const dx = x + 0.5 - outer;
        if (Math.round(dx / stripe) % 2 !== 0) {
          const h = Math.sqrt(Math.max(0, shirt * shirt - dx * dx));
          if (h > 0.5) g.fillRect(x, outer - h, 1, h * 2);
        }
      }
    });

    // A snowflake, which at this size is a dot and is drawn as one; a raindrop, which is
    // a streak; and a gust, which is a longer, fainter one lying the other way.
    bake('flake', 8, 8, () => {
      g.fillStyle(Renderer.THEME.chalkWhite, 1);
      g.fillCircle(4, 4, 3.5);
    });
    bake('raindrop', 3, 14, () => {
      g.fillStyle(Renderer.THEME.chalkWhite, 1);
      g.fillRect(0, 0, 3, 14);
    });
    bake('gust', 24, 3, () => {
      g.fillStyle(Renderer.THEME.chalkWhite, 1);
      g.fillRect(0, 0, 24, 3);
    });

    /*
     * A bank of fog: rings from the middle out, each one a shade fainter than the last, so
     * its edge fades instead of stopping. Baked once and stretched into whatever shape a
     * bank happens to be.
     */
    const fogR = 64;
    bake('fogbank', fogR * 2, fogR * 2, () => {
      for (let i = Renderer.FOG.rings; i > 0; i -= 1) {
        g.fillStyle(Renderer.THEME.chalkWhite, 1 / Renderer.FOG.rings);
        g.fillCircle(fogR, fogR, (fogR * i) / Renderer.FOG.rings);
      }
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
     * A soft round falloff, stacked from the outside in. Baked white so one texture serves
     * both the light a tower throws and the shadow it casts, tinted and blended differently
     * at each use.
     */
    const falloff = (key, size, rings, step) => bake(key, size, size, () => {
      const r = size / 2;
      for (let i = rings; i > 0; i -= 1) {
        g.fillStyle(0xffffff, step);
        g.fillCircle(r, r, (i / rings) * (r - 1));
      }
    });
    falloff('light_pool', 256, 48, 0.02);
    falloff('soft_shadow', 64, 14, 0.11);

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

    /*
     * Keeper: a circle with both hands spread along the goal line, which is what a keeper
     * is doing when you look at him from above. He was a slab, and a slab is the one shape
     * that says nothing about what it is for.
     *
     * The texture is a shade wider than the body the match is tuned around, so createKeeper
     * puts the body back to the slab's own size afterwards. Four pixels of glove either
     * side of a save is not worth re-measuring every save rate in the file for.
     */
    const kh = CONFIG.KEEPER.height;
    const K = Renderer.KEEPER_ART;
    const keeper = (key, fill) => bake(key, K.radius * 2, kh, () => {
      const cx = K.radius;
      const cy = kh / 2;
      const reach = kh / 2 - K.handRadius;

      // Arms first, so the body and the gloves are drawn over the ends of them.
      g.lineStyle(K.armWidth, P.outline, 1);
      g.lineBetween(cx, cy - reach, cx, cy + reach);

      g.fillStyle(fill, 1);
      g.lineStyle(3, P.outline, 1);
      g.fillCircle(cx, cy, K.radius - 2);
      g.strokeCircle(cx, cy, K.radius - 2);
      [-1, 1].forEach((side) => {
        g.fillCircle(cx, cy + side * reach, K.handRadius - 1);
        g.strokeCircle(cx, cy + side * reach, K.handRadius - 1);
      });
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

  /*
   * The vertical rhythm of that list, as gaps rather than as a column of hand-written y
   * values. Adding the audio section meant every number below it moving, which is exactly
   * the edit that puts a row through the bottom of the band: now the screen counts its own
   * way down and the only thing to get right is how far apart things sit.
   */
  SETTINGS_LAYOUT: {
    /*
     * Measured, not guessed. A heading is drawn from its top left and stands 20px tall; a
     * row is drawn from its middle and stands 22. So a heading needs only 18px of clearance
     * above it and a good 32 below, which is nothing like the even spacing it looks like it
     * wants, and is how three sections fit where two did.
     */
    skinTop: 250,
    skinGap: 28,
    headGap: 18,       // from the middle of the last row to the top of the next heading
    firstRow: 32,      // from the top of a heading to the middle of its first row
    rowGap: 26,
  },

  /*
   * The volume bar: ten blocks, each one a setting you can click straight to. Placed from
   * the middle of the screen, the way every column on that screen is placed: written down
   * as an x it sat where it was put in the narrow frame and slid out from under the labels
   * the moment a thumb-controlled frame made the canvas wider.
   */
  VOLUME_BAR: {
    fromMiddle: -144,  // clear of the widest label, and clear of the blurb column
    block: 9,
    gap: 3,
    height: 15,
  },

  TOUCH_BLURB: {
    auto: 'stick and buttons on a phone, keys everywhere else',
    on: 'stick and buttons always, one player only',
    off: 'never, whatever you are playing on',
  },

  /* Keyed by CONFIG.ASSIST.LEVELS, which is where what they actually do is written. */
  ASSIST_BLURB: {
    off: 'shots go down the middle and passes go where you face',
    steady: 'a shade straighter, and a good deal drunker swinging at it',
    full: 'leans off the keeper too, and you will be all over the place',
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

    // Both of these belong to the match about to be played, and a scene handed back by
    // Phaser is the same object as last time: anything left lying about is a reference to
    // a sprite that was destroyed with the match before it.
    scene.wearLayer = null;
    Renderer.rollWeather();

    g.fillStyle(C.surround, 1);
    g.fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);

    /*
     * In the wide frame the gutters are lifted a shade off the surround, so the columns
     * the thumb controls live in read as part of the machine rather than as pitch that
     * happens to be empty.
     */
    if (CONFIG.FRAME.wide) {
      g.fillStyle(Renderer.lighten(Renderer.THEME.nightBlack, Renderer.TOUCH.gutterTint), 1);
      g.fillRect(0, 0, P.left, CONFIG.CANVAS.height);
      g.fillRect(P.right, 0, CONFIG.CANVAS.width - P.right, CONFIG.CANVAS.height);
    }

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

    // The grass itself, and the snow lying in it. Both under the chalk, so a line is a
    // line however deep the snow is.
    Renderer.drawGrass(g);
    const lying = Renderer.skinNow();
    if (lying && lying.snowy) Renderer.drawLyingSnow(g);

    // The netting behind each line, laid down before the chalk so the goal line is drawn
    // over the front of it rather than stopping short of it.
    [-1, 1].forEach((dir) => Renderer.drawNet(g, C, dir));

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

    // The frames, after the ground: a stand built behind a goal must not be built over
    // the top of it.
    [-1, 1].forEach((dir) => Renderer.drawGoalFrame(g, C, dir));

    // Last, so the weather comes down over a ground that is already fully drawn.
    Renderer.createFloodlights(scene, g);
    Renderer.createWeather(scene);

    return g;
  },

  /* The skin being played in, as its own entry rather than its key. */
  skinNow() {
    return Renderer.SKINS.find((sk) => sk.key === Renderer.activeSkin) || null;
  },

  /* Grass, a blade at a time, band by band so each shade is set once. */
  drawGrass(g) {
    const P = CONFIG.PITCH;
    const G = Renderer.GRASS;
    const C = Renderer.PALETTE;
    const bands = Renderer.MARKINGS.stripes;
    const bandWidth = P.width / bands;
    const each = Math.round(G.perBand / 2);

    for (let band = 0; band < bands; band += 1) {
      const base = band % 2 ? C.grassAlt : C.grass;
      const left = P.left + band * bandWidth;
      [Renderer.lighten(base, G.lift), Renderer.darken(base, G.sink)].forEach((colour) => {
        g.lineStyle(1, colour, G.alpha);
        for (let i = 0; i < each; i += 1) {
          const x = left + Math.random() * bandWidth;
          // Grown up from its own root, and kept off the touchline: a blade leaning over
          // the line is a blade growing out of the surround.
          const y = P.top + G.lengthMax + Math.random() * (P.height - G.lengthMax);
          const len = G.lengthMin + Math.random() * (G.lengthMax - G.lengthMin);
          // Held inside the touchline: a blade leaning over the line is a blade growing
          // out of the surround, and at the far end of the pitch that is where it leans.
          const tip = Math.min(P.right, Math.max(P.left, x + (Math.random() - 0.5) * G.lean));
          g.lineBetween(x, y, tip, y - len);
        }
      });
    }
  },

  /* And the snow lying on top of it, on the one skin played in winter. */
  drawLyingSnow(g) {
    const P = CONFIG.PITCH;
    const S = Renderer.LYING_SNOW;

    /*
     * All of it opaque, and that is the whole trick: translucent white circles compound
     * where they overlap, so every one of them shows its own edge and a patch of snow
     * comes out as a tray of soap bubbles. Solid ones merge into one shape.
     */
    g.fillStyle(Renderer.THEME.chalkWhite, 1);

    // One blob, held inside the touchline: snow drifted onto the surround would be snow
    // lying on the wall.
    const blob = (x, y, r) => g.fillCircle(
      Math.min(P.right - r, Math.max(P.left + r, x)),
      Math.min(P.bottom - r, Math.max(P.top + r, y)),
      r,
    );
    const speck = (x, y) => blob(x, y, S.speckMin + Math.random() * (S.speckMax - S.speckMin));

    for (let i = 0; i < S.patches; i += 1) {
      const x = P.left + Math.random() * P.width;
      const y = P.top + Math.random() * P.height;
      const radius = S.radiusMin + Math.random() * (S.radiusMax - S.radiusMin);

      // A solid middle, off-centre lumps of it, so the drift has a shape rather than an
      // outline; then a fringe of specks thinning out past its edge.
      const core = Math.round(S.coreMin + Math.random() * (S.coreMax - S.coreMin));
      for (let j = 0; j < core; j += 1) {
        const angle = Math.random() * Math.PI * 2;
        const away = radius * 0.35 * Math.random();
        blob(x + Math.cos(angle) * away, y + Math.sin(angle) * away,
          radius * (0.16 + Math.random() * 0.16));
      }

      const specks = Math.round(S.specksMin + Math.random() * (S.specksMax - S.specksMin));
      for (let j = 0; j < specks; j += 1) {
        const angle = Math.random() * Math.PI * 2;
        const away = radius * (0.5 + Math.random() * 0.8);
        speck(x + Math.cos(angle) * away, y + Math.sin(angle) * away);
      }
    }

    for (let i = 0; i < S.dusting; i += 1) {
      speck(P.left + Math.random() * P.width, P.top + Math.random() * P.height);
    }
  },

  /*
   * The odds on today, with anything the skin insists on folded in: a frozen pitch snows a
   * third of the time whatever the general chance is, and the rest of the table shares out
   * what is left of the hundred between them in the proportions it already had.
   */
  weatherOdds() {
    const base = CONFIG.WEATHER.chances;
    const skin = Renderer.skinNow();
    const forced = (skin && skin.weather) || {};
    const keys = Object.keys(base);

    let fixed = 0;
    let loose = 0;
    keys.forEach((key) => {
      if (forced[key] === undefined) loose += base[key];
      else fixed += forced[key];
    });

    const room = Math.max(0, 1 - fixed);
    const odds = {};
    keys.forEach((key) => {
      odds[key] = forced[key] === undefined
        ? (loose > 0 ? (base[key] / loose) * room : 0)
        : forced[key];
    });
    return odds;
  },

  /*
   * Rolled once when the pitch is drawn, the same way the ground is. game.js reads the
   * answer rather than the roll, because what the weather does to the football is its
   * business and what it looks like is this file's.
   */
  rollWeather() {
    const odds = Renderer.weatherOdds();
    let roll = Math.random();
    Renderer.weather = 'sunny';
    Object.keys(odds).some((key) => {
      roll -= odds[key];
      if (roll <= 0) {
        Renderer.weather = key;
        return true;
      }
      return false;
    });
    // Which way it is blowing, when it is blowing: along the pitch either way, give or
    // take, because a wind straight up the screen would only ever push the ball out.
    Renderer.windAngle = (Math.random() < 0.5 ? 0 : Math.PI)
      + (Math.random() - 0.5) * Phaser.Math.DegToRad(50);
    return Renderer.weather;
  },

  /*
   * Whatever is coming down today. Each mote starts wherever it happens to be rather than
   * at the top, so the first second of a match is already weather rather than a clear sky
   * filling up, and every one after that comes round from the edge it blew in from.
   */
  createWeather(scene) {
    scene.weatherMotes = null;
    scene.fog = null;
    if (Renderer.weather === 'foggy') {
      scene.fog = Renderer.createFog(scene);
      return scene.fog;
    }

    const art = Renderer.FALLING[Renderer.weather];
    if (!art) return null;

    const motes = [];
    for (let i = 0; i < art.motes; i += 1) {
      const size = art.sizeMin + Math.random() * (art.sizeMax - art.sizeMin);
      const mote = scene.add.image(
        Math.random() * CONFIG.CANVAS.width,
        Math.random() * CONFIG.CANVAS.height,
        art.texture,
      )
        .setAlpha(art.alphaMin + Math.random() * (art.alphaMax - art.alphaMin))
        // In front of the football and behind anything written about it.
        .setDepth(Renderer.DEPTH.label - 1);
      // Along the way it is going: a drop is long down the screen and a gust is long
      // across it, and both of them are thin the other way.
      mote.setDisplaySize(
        art.across ? size : size * art.aspect,
        art.across ? size * art.aspect : size,
      );
      mote.art = art;
      mote.drift = (Math.random() - 0.5) * art.driftMax * 2;
      mote.speed = art.speedMin + Math.random() * (art.speedMax - art.speedMin);
      // Blown the way the wind is blowing, so the streaks and the ball agree.
      mote.way = art.across && Math.cos(Renderer.windAngle) < 0 ? -1 : 1;
      if (art.across) mote.setRotation(0);
      Renderer.blowMote(scene, mote, true);
      motes.push(mote);
    }
    scene.weatherMotes = motes;
    return motes;
  },

  /*
   * One mote's trip across the screen: the first from wherever it was put, every one after
   * it from the edge. Rain and snow fall down the screen; a gust crosses it.
   */
  blowMote(scene, mote, first) {
    const W = CONFIG.CANVAS.width;
    const H = CONFIG.CANVAS.height;
    const art = mote.art;
    const edge = 12;

    let to;
    let gone;
    if (art.across) {
      if (!first) mote.x = mote.way > 0 ? -edge : W + edge;
      gone = Math.abs((mote.way > 0 ? W + edge : -edge) - mote.x);
      to = {
        x: mote.way > 0 ? W + edge : -edge,
        y: Math.min(H, Math.max(0, mote.y + mote.drift * (gone / mote.speed))),
      };
    } else {
      if (!first) mote.y = -edge;
      gone = (H + edge) - mote.y;
      to = {
        // Sideways on the way down, but not off the edge of the world: a flake that leaves
        // the screen is one nobody sees again until its next lap.
        x: Math.min(W, Math.max(0, mote.x + mote.drift * (gone / mote.speed))),
        y: H + edge,
      };
    }

    return scene.tweens.add({
      targets: mote,
      x: to.x,
      y: to.y,
      duration: (gone / mote.speed) * 1000,
      repeat: first ? 0 : -1,
      onComplete: first ? () => Renderer.blowMote(scene, mote, false) : undefined,
    });
  },

  /*
   * Fog: a flat haze over the whole ground, and banks of it drifting through. The banks are
   * baked soft, because a circle at one alpha is a plate rather than a cloud.
   */
  createFog(scene) {
    const F = Renderer.FOG;
    const W = CONFIG.CANVAS.width;
    const H = CONFIG.CANVAS.height;
    const parts = [];

    const haze = scene.add.image(W / 2, H / 2, 'px')
      .setDisplaySize(W, H)
      .setTint(Renderer.THEME.chalkWhite)
      .setAlpha(F.thin)
      .setDepth(Renderer.DEPTH.label - 1);
    // Rolling in and lifting again, on its own tween so it keeps going in the shootout too.
    haze.roll = scene.tweens.add({
      targets: haze,
      alpha: F.thick,
      duration: F.rollMsMin + Math.random() * (F.rollMsMax - F.rollMsMin),
      delay: Math.random() * 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    parts.push(haze);

    for (let i = 0; i < F.banks; i += 1) {
      const size = F.sizeMin + Math.random() * (F.sizeMax - F.sizeMin);
      const bank = scene.add.image(Math.random() * W, Math.random() * H, 'fogbank')
        .setDisplaySize(size, size * (0.5 + Math.random() * 0.4))
        .setAlpha(F.alphaMin + Math.random() * (F.alphaMax - F.alphaMin))
        .setDepth(Renderer.DEPTH.label - 1);
      const cross = F.crossMsMin + Math.random() * (F.crossMsMax - F.crossMsMin);
      scene.tweens.add({
        targets: bank,
        x: bank.x + W,
        duration: cross,
        repeat: -1,
        onRepeat: () => { bank.x = -size; },
      });
      parts.push(bank);
    }
    return parts;
  },

  /*
   * A patch of ground giving up. Studs at the spot, a few of them, and a divot in the
   * middle of it: the worse the ground already is, the more each kick throws about.
   *
   * The layer is made on the first kick that needs it, so a pitch nobody has torn up has
   * nothing drawn on it at all.
   */
  onPitchWear(scene, x, y, level) {
    const W = Renderer.WEAR_MARK;
    if (!scene.wearLayer) {
      scene.wearLayer = scene.add.graphics().setDepth(Renderer.DEPTH.pitch + 1);
    }
    const g = scene.wearLayer;
    const spread = W.spread * (0.5 + level);

    g.fillStyle(W.mud, W.alpha * (0.5 + level * 0.5));
    g.fillCircle(x, y, W.divotRadius * (0.6 + level * 0.8));

    g.lineStyle(2, W.mud, W.alpha);
    for (let i = 0; i < W.scuffs; i += 1) {
      const sx = x + (Math.random() - 0.5) * spread;
      const sy = y + (Math.random() - 0.5) * spread;
      const len = W.lengthMin + Math.random() * (W.lengthMax - W.lengthMin);
      const angle = Math.random() * Math.PI;
      g.lineBetween(sx, sy, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
    }
    return g;
  },

  /*
   * Netting: diagonals both ways, clipped to the goal recess. Drawn faintly off the chalk
   * so it reads as mesh at a glance without competing with the lines on the pitch.
   *
   * The mesh is laid out from x,y but clipped to `clip` when one is given, which is how a
   * net can be shaded in bands without the pattern restarting at every seam.
   */
  crosshatch(g, x, y, w, h, alpha, clip) {
    const step = Renderer.GOAL.netSpacing;
    const box = clip || { x, y, w, h };
    g.lineStyle(1, Renderer.THEME.chalkWhite, alpha === undefined ? 0.22 : alpha);

    // A diagonal enters the box along the top edge or the left, so run the origin from
    // above the box round to its far side and clip each line to the rectangle.
    for (let d = -h; d < w + h; d += step) {
      Renderer.clippedLine(g, x + d, y, x + d + h, y + h, box.x, box.y, box.w, box.h);
      Renderer.clippedLine(g, x + d, y + h, x + d + h, y, box.x, box.y, box.w, box.h);
    }
  },

  /*
   * The netting, in bands that darken away from the mouth. A flat rectangle is the thing
   * that makes a goal look painted onto the grass: the far corners of a real net are in
   * shade, and the strands out there catch almost nothing.
   */
  drawNet(g, C, dir) {
    const P = CONFIG.PITCH;
    const N = Renderer.GOAL;
    const lineX = dir < 0 ? P.left : P.right;
    const outer = Math.min(lineX, lineX + dir * P.goalDepth);
    const slice = P.goalDepth / N.netSlices;

    for (let i = 0; i < N.netSlices; i += 1) {
      const t = (i + 0.5) / N.netSlices;              // 0 at the mouth, 1 at the back
      const near = lineX + dir * i * slice;
      const x = Math.min(near, near + dir * slice);
      g.fillStyle(Renderer.lighten(C.net, N.mouthLift * (1 - t)), 1);
      // Half a pixel of overlap, or the seams show up as hairlines between the bands.
      g.fillRect(x - 0.5, P.mouthTop, slice + 1, P.goalMouth);
      Renderer.crosshatch(g, outer, P.mouthTop, P.goalDepth, P.goalMouth,
        N.strandAlpha * (1 - N.strandFade * t), { x, y: P.mouthTop, w: slice, h: P.goalMouth });
    }
  },

  /* The frame itself, which is the only part of a goal that is not netting. */
  drawGoalFrame(g, C, dir) {
    const P = CONFIG.PITCH;
    const N = Renderer.GOAL;
    const dark = Renderer.THEME.nightBlack;
    const lineX = dir < 0 ? P.left : P.right;
    const backX = lineX + dir * P.goalDepth;
    const posts = [P.mouthTop, P.mouthBottom];

    // Where the frame meets the netting it sits in its own shade. That, rather than any
    // extra width, is what tells a white line from a steel bar.
    g.lineStyle(N.barWidth + N.contactSpread, dark, N.contactAlpha);
    posts.forEach((y) => g.lineBetween(lineX, y, backX, y));
    g.lineBetween(backX, P.mouthTop, backX, P.mouthBottom);

    g.lineStyle(N.barWidth, C.line, 1);
    posts.forEach((y) => g.lineBetween(lineX, y, backX, y));

    g.lineStyle(N.backWidth, C.line, N.backAlpha);
    g.lineBetween(backX, P.mouthTop, backX, P.mouthBottom);

    // The crossbar is directly above the goal line from up here, so it brightens the line
    // between the posts and stops nothing.
    g.lineStyle(N.barWidth, C.line, N.crossbarAlpha);
    g.lineBetween(lineX, P.mouthTop, lineX, P.mouthBottom);

    // Uprights and stanchions, seen end on: the only round things on a football pitch.
    [[lineX, N.postRadius], [backX, N.stanchionRadius]].forEach(([x, radius]) => {
      posts.forEach((y) => {
        g.fillStyle(C.line, 1);
        g.fillCircle(x, y, radius);
        g.lineStyle(1, dark, N.rimAlpha);
        g.strokeCircle(x, y, radius);
      });
    });
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
   * How loud this ground can be, from nothing to a full house, worked out from the people
   * actually in it rather than from which ground it is. A cheer is scaled by this, so a
   * dozen witnesses on a park pitch never sound like a terrace.
   */
  crowdLoudness(scene) {
    const most = Renderer.STADIUMS.reduce((n, st) => Math.max(n, st.people[1]), 1);
    const here = scene && scene.children
      ? scene.children.list.filter((o) => o.texture && o.texture.key === 'fan').length
      : 0;
    return Math.max(0, Math.min(1, here / most));
  },

  /* A skin may name the only ground it is ever played in, which then settles it. */
  skinGround() {
    const skin = Renderer.SKINS.find((sk) => sk.key === Renderer.activeSkin);
    if (!skin || !skin.ground) return null;
    return Renderer.STADIUMS.find((st) => st.key === skin.ground) || null;
  },

  /* The grounds the setting can actually choose between. */
  pickableStadiums() {
    return Renderer.STADIUMS.filter((st) => Renderer.STADIUM_CHOICES.indexOf(st.key) !== -1);
  },

  /*
   * The ground this match is in: whatever the skin insists on, else whatever has been
   * pinned in settings, else a fresh roll every time.
   */
  rollStadium() {
    const owned = Renderer.skinGround();
    const pinned = Renderer.pickableStadiums().find((st) => st.key === Renderer.stadiumChoice);
    Renderer.currentStadium = owned || pinned
      || Phaser.Utils.Array.GetRandom(Renderer.pickableStadiums());
    return Renderer.currentStadium;
  },

  saveStadium(choice) {
    Renderer.stadiumChoice = choice;
    try {
      window.localStorage.setItem(Renderer.STADIUM_STORAGE_KEY, choice);
    } catch (err) { /* nothing worth doing */ }
  },

  loadStadium() {
    let saved = null;
    try {
      saved = window.localStorage.getItem(Renderer.STADIUM_STORAGE_KEY);
    } catch (err) { saved = null; }
    Renderer.stadiumChoice = Renderer.STADIUM_CHOICES.indexOf(saved) === -1 ? 'random' : saved;
  },

  /* 'random' first, because it is the default and the interesting one. */
  STADIUM_CHOICES: ['random', 'small', 'medium', 'large'],

  /*
   * The shape of a stand, worked out once and then used by everything that draws or fills
   * one. Both touchlines, as many rows deep as the ground has, with the seating laid on a
   * grid so an empty seat is a real thing rather than a gap in a scatter.
   *
   * `dir` is which way is away from the pitch, which is all the difference there is
   * between the two sides of the ground.
   */
  standRows(S) {
    const P = CONFIG.PITCH;
    const K = Renderer.CROWD;
    const across = (f) => P.left + f * P.width;
    const standOff = S.standOff || K.standOff;
    const rowGap = S.rowGap || K.rowGap;

    const sides = [
      { dir: -1, rail: P.top - K.railInset, bands: K.bands.top },
      { dir: 1, rail: P.bottom + K.railInset, bands: K.bands.bottom },
    ];

    // How far back the structure itself reaches: behind the last row and no further, so a
    // one-row ground looks like a one-row ground rather than an empty stand.
    const depth = standOff + (S.rows - 1) * rowGap + 12;

    return sides.map((side) => ({
      dir: side.dir,
      rail: side.rail,
      back: side.rail + side.dir * depth,
      depth,
      bands: side.bands.map(([a, b]) => [across(a), across(b)]),
      rows: Array.from({ length: S.rows }, (unused, i) => ({
        y: side.rail + side.dir * (standOff + i * rowGap),
        scale: Math.pow(K.rowScale, i),
      })),
    }));
  },

  /*
   * The stands behind each goal. Same idea as the sides turned through ninety degrees:
   * seats in columns rather than rows, and a way out cut into the outer edge.
   *
   * Depth is worked out from the seating rather than set, because the space is not
   * negotiable: 80px behind each goal line, 46 of which is netting. What is left buys a
   * gap to stand off the net, the seats, and enough wall behind the back one that a
   * supporter swaying in it is still inside the ground.
   */
  endStands(S) {
    if (!S.ends) return [];
    const P = CONFIG.PITCH;
    const E = Renderer.ENDS;
    const B = Renderer.BEER;
    const depth = E.columnOff + (E.columns - 1) * E.columnGap + E.backMargin;
    const netBack = { left: P.left - P.goalDepth, right: P.right + P.goalDepth };

    return [
      { dir: -1, netBack: netBack.left },
      { dir: 1, netBack: netBack.right },
    ].map((end) => {
      const top = P.top + E.cornerGap;
      const bottom = P.bottom - E.cornerGap;
      const face = end.netBack + end.dir * E.standOff;
      const back = face + end.dir * depth;
      return {
        dir: end.dir,
        face,
        back,
        depth,
        top,
        bottom,
        // Nearest the pitch first, so the column behind is the one drawn smaller.
        columns: Array.from({ length: E.columns }, (unused, i) => ({
          x: face + end.dir * (E.columnOff + i * E.columnGap),
          scale: Math.pow(Renderer.CROWD.rowScale, i),
        })),
        exit: {
          x: back - end.dir * (E.holeDepth / 2),
          y: (top + bottom) / 2,
          width: E.holeDepth,
          height: B.holeWidth,
        },
      };
    });
  },

  /*
   * Where the tunnel is, in world coordinates, or null on a ground with no stand to cut it
   * into. Everything that draws it, keeps seats out of it or walks somebody through it
   * asks here rather than working it out again.
   */
  tunnel(stadium) {
    const S = stadium || Renderer.currentStadium;
    if (!S || !S.structure) return null;
    const P = CONFIG.PITCH;
    const T = Renderer.TUNNEL;
    // The near side is the first one standRows lays out, and the only one with a tunnel:
    // the far touchline has the pause hint along it and nothing to come out for.
    const near = Renderer.standRows(S)[0];
    return {
      x: P.left + P.width * T.alongPitch,
      width: T.width,
      mouth: near.rail,     // the pitch end, level with the front of the stand
      back: near.back,      // and the far end, at the back wall
    };
  },

  /*
   * The tunnel as a hole in a wall: a rectangle, the same shape everything else that
   * blocks a seat is, so one filter covers doorways and tunnels alike.
   */
  tunnelGap(stadium) {
    const t = Renderer.tunnel(stadium);
    if (!t) return null;
    const K = Renderer.CROWD;
    /*
     * Wider than the hole, because what has to be clear of the mouth is not the seat but
     * whoever is in it: he is shaken off his seat by jitterX and he is a figure wide on
     * top of that, so a seat merely clear of the edge still puts a shoulder in the
     * tunnel. The doorways at the back of a stand are left as they are, where somebody
     * half in the entrance is somebody on their way to the bar.
     */
    return {
      x: t.x,
      y: (t.mouth + t.back) / 2,
      width: t.width + 2 * (K.jitterX + K.figureRadius),
      height: Math.abs(t.mouth - t.back),
    };
  },

  /*
   * Where somebody stands when he is still in the tunnel: at the back of it, out of the
   * light, facing the pitch. Handed to the match so the teams can walk out of it, because
   * the shape of the ground is worked out here rather than there.
   */
  tunnelWalk() {
    const t = Renderer.tunnel();
    if (!t) return null;
    const r = CONFIG.PLAYER.radius;
    return { x: t.x, y: Math.min(t.mouth, t.back) + r };
  },

  /* How much of the screen he takes up, ring and all. */
  refereeOuter() {
    return Renderer.REFEREE.radius + Renderer.REFEREE.haloPx;
  },

  /* On the touchline, whatever the ground: every one of them has a touchline. */
  refereeSpot() {
    const P = CONFIG.PITCH;
    const R = Renderer.REFEREE;
    return {
      x: P.centreX + R.fromCentre,
      y: P.top - R.offLine - Renderer.refereeOuter(),
    };
  },

  /* The same grid as a row of seats, stood on its end. */
  seatsDown(end, column) {
    const E = Renderer.SEATS;
    const seats = [];
    for (let y = end.top + E.every / 2; y + E.width / 2 <= end.bottom; y += E.every) {
      seats.push({ x: column.x, y, scale: column.scale });
    }
    return seats;
  },

  /* Where the seats are, on a fixed grid so the same seat is in the same place every time. */
  seatsIn(band, row) {
    const E = Renderer.SEATS;
    const seats = [];
    for (let x = band[0] + E.every / 2; x + E.width / 2 <= band[1]; x += E.every) {
      seats.push({ x, y: row.y, scale: row.scale });
    }
    return seats;
  },

  /*
   * The way out. One gap per block, cut into the back of the stand and placed in the middle
   * of the block it serves, which keeps it clear of everything the HUD writes along the top
   * and bottom of the screen.
   */
  exitsIn(side) {
    const B = Renderer.BEER;
    return side.bands.map((band) => ({
      x: (band[0] + band[1]) / 2,
      // Halfway into the gap, so somebody standing in it is in the wall rather than
      // hovering behind it.
      y: side.back - side.dir * (B.holeDepth / 2),
      width: B.holeWidth,
      height: B.holeDepth,
    }));
  },

  /*
   * Whether a seat is clear of a doorway. Nobody sits in a doorway and nobody bolts a
   * seat into one, so the seats there are simply not there. Measured with the longer side
   * of a seat both ways, which costs a pixel or two and saves knowing which way the seat
   * is turned.
   */
  clearOfDoorway(seat, exit) {
    const E = Renderer.SEATS;
    const room = Math.max(E.width, E.height);
    return Math.abs(seat.x - exit.x) > (exit.width + room) / 2
      || Math.abs(seat.y - exit.y) > (exit.height + room) / 2;
  },

  /*
   * Every hole in a block of seating: the way out at the back of it, and on the near side
   * the players' tunnel where it comes through. One list per block, so a seat is checked
   * against the holes in its own block and nothing else.
   */
  standGaps(side, S) {
    const exits = Renderer.exitsIn(side);
    const tunnel = side.dir < 0 ? Renderer.tunnelGap(S) : null;
    return side.bands.map((band, i) => (tunnel && tunnel.x > band[0] && tunnel.x < band[1]
      ? [exits[i], tunnel] : [exits[i]]));
  },

  /* Whether a seat can be bolted down where it is: clear of every hole in its block. */
  seatFits(seat, gaps) {
    return gaps.every((gap) => Renderer.clearOfDoorway(seat, gap));
  },

  /*
   * Terrace, rail, seating and crowd. The rail runs along both touchlines only: the goals
   * stick out past the ends, so a rail all the way round would be drawn through the nets.
   */
  createGround(scene, g) {
    const S = Renderer.rollStadium();
    const mat = Renderer.MATERIALS[S.material];
    const sides = Renderer.standRows(S);

    /*
     * A ground with no structure is a rail and some grass: the people are simply standing
     * there. Everything below still knows where they stand, so a drink is still a walk out
     * past the rail and back.
     */
    if (S.structure) {
      sides.forEach((side) => {
        Renderer.drawStand(g, side, S, mat);
        Renderer.drawSeats(g, side, mat, S);
      });
      Renderer.endStands(S).forEach((end) => {
        Renderer.drawEndStand(g, end, S, mat);
        Renderer.drawEndSeats(g, end, mat);
      });
    }

    // The rail goes on last of the structure, in front of everything it holds back.
    Renderer.drawRail(g, sides, S, mat);

    Renderer.fillSeats(scene, S);
    Renderer.createReferee(scene);
  },

  /*
   * Him, on the touchline. Parked on the scene so the kickoff can find him, and every
   * match makes a new one: Phaser hands a restarted scene the same object it gave the
   * last one, so a referee left lying about is a reference to a destroyed sprite.
   */
  createReferee(scene) {
    const spot = Renderer.refereeSpot();
    scene.referee = scene.add.image(spot.x, spot.y, 'referee')
      .setDepth(Renderer.DEPTH.wall + 2);
    return scene.referee;
  },

  /*
   * One blast, on GO. The puff is the whole animation: a figure this size cannot raise an
   * arm legibly, so he leans into it instead and the whistle is the flash of white.
   */
  blowWhistle(scene) {
    Sound.whistle();
    const ref = scene.referee;
    if (!ref || !ref.active) return null;

    const R = Renderer.REFEREE;
    scene.tweens.add({
      targets: ref,
      scale: R.blowScale,
      duration: R.blowMs,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    const flash = scene.add.image(ref.x, ref.y, 'px')
      .setDisplaySize(R.flashRadius * 2, R.flashRadius * 2)
      .setTint(Renderer.THEME.chalkWhite)
      .setAlpha(0.7)
      .setDepth(Renderer.DEPTH.wall + 1);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2.4,
      duration: R.flashMs,
      onComplete: () => flash.destroy(),
    });
    return flash;
  },

  /*
   * Behind the goal. The rail runs down the edge facing the pitch; the way out is cut into
   * the back, the same as on the sides.
   */
  drawEndStand(g, end, S, mat) {
    const E = Renderer.ENDS;
    const B = Renderer.BEER;
    const left = Math.min(end.face, end.back);
    const height = end.bottom - end.top;

    g.fillStyle(mat.wall, 1);
    g.fillRect(left, end.top, end.depth, height);

    if (S.material === 'metal') {
      g.lineStyle(1, mat.edge, mat.jointAlpha);
      for (let y = end.top; y <= end.bottom; y += mat.ribEvery) {
        g.lineBetween(left, y, left + end.depth, y);
      }
    } else {
      // Courses run the way the wall does, so behind a goal they run vertically.
      g.lineStyle(1, mat.edge, mat.jointAlpha);
      let course = 0;
      for (let x = left; x <= left + end.depth; x += mat.courseEvery) {
        g.lineBetween(x, end.top, x, end.bottom);
        const offset = (course % 2) * (mat.brickEvery / 2);
        for (let y = end.top + offset; y <= end.bottom; y += mat.brickEvery) {
          g.lineBetween(x, y, Math.min(x + mat.courseEvery, left + end.depth), y);
        }
        course += 1;
      }
    }

    // The way out, cut into the back edge.
    const hx = Math.min(end.back, end.back - end.dir * E.holeDepth);
    g.fillStyle(Renderer.THEME.nightBlack, 1);
    g.fillRect(hx, end.exit.y - B.holeWidth / 2, E.holeDepth, B.holeWidth);
    g.lineStyle(2, mat.edge, 0.85);
    g.strokeRect(hx, end.exit.y - B.holeWidth / 2, E.holeDepth, B.holeWidth);

    // Rail down the front, posts and all.
    g.lineStyle(2, mat.rail, 1);
    g.lineBetween(end.face, end.top, end.face, end.bottom);
    for (let y = end.top; y <= end.bottom; y += Renderer.CROWD.postEvery) {
      g.lineBetween(end.face - Renderer.CROWD.postHalfHeight, y,
        end.face + Renderer.CROWD.postHalfHeight, y);
    }
  },

  /* Behind a goal a seat faces along the pitch rather than across it, so it turns too. */
  drawEndSeats(g, end, mat) {
    const E = Renderer.SEATS;
    end.columns.forEach((column) => {
      Renderer.seatsDown(end, column)
        .filter((seat) => Renderer.clearOfDoorway(seat, end.exit))
        .forEach((seat) => Renderer.drawSeat(g, seat, mat,
          E.height * seat.scale, E.width * seat.scale));
    });
  },

  /* The structure: a sheet of corrugated metal, or courses of brick with steps cut in it. */
  drawStand(g, side, S, mat) {
    const P = CONFIG.PITCH;
    const K = Renderer.CROWD;
    const left = P.left - K.railInset;
    const width = P.width + K.railInset * 2;
    const top = Math.min(side.rail, side.back);
    const height = side.depth;

    g.fillStyle(mat.wall, 1);
    g.fillRect(left, top, width, height);

    if (S.material === 'metal') {
      // Corrugation, running the way the sheet was rolled.
      g.lineStyle(1, mat.edge, mat.jointAlpha);
      for (let x = left; x <= left + width; x += mat.ribEvery) {
        g.lineBetween(x, top, x, top + height);
      }
    } else {
      /*
       * Courses of brick, every other one offset by half a brick. Drawn rather than tiled
       * because the stand is a different depth in every ground and a tile would be cut off
       * mid-course at one end of it.
       */
      g.lineStyle(1, mat.edge, mat.jointAlpha);
      let course = 0;
      for (let y = top; y <= top + height; y += mat.courseEvery) {
        g.lineBetween(left, y, left + width, y);
        const offset = (course % 2) * (mat.brickEvery / 2);
        for (let x = left + offset; x <= left + width; x += mat.brickEvery) {
          g.lineBetween(x, y, x, Math.min(y + mat.courseEvery, top + height));
        }
        course += 1;
      }
    }

    // Terracing: the steps you actually stand on, cut across the brick.
    if (S.terrace > 0) {
      g.lineStyle(2, Renderer.lighten(mat.wall, 0.14), 0.9);
      for (let i = 1; i <= S.terrace; i += 1) {
        const y = top + height * (i / (S.terrace + 1));
        g.lineBetween(left, y, left + width, y);
      }
    }

    /*
     * And the gaps people leave through, cut into the back of the stand rather than hung
     * off the end of it, so the wall has a hole in it instead of a porch.
     */
    const B = Renderer.BEER;
    Renderer.exitsIn(side).forEach((hole) => {
      const y = Math.min(side.back, side.back - side.dir * B.holeDepth);
      g.fillStyle(Renderer.THEME.nightBlack, 1);
      g.fillRect(hole.x - B.holeWidth / 2, y, B.holeWidth, B.holeDepth);
      g.lineStyle(2, mat.edge, 0.85);
      g.strokeRect(hole.x - B.holeWidth / 2, y, B.holeWidth, B.holeDepth);
    });

    // And the one the players come out of, which goes all the way through.
    const tunnel = side.dir < 0 ? Renderer.tunnel(S) : null;
    if (tunnel) Renderer.drawTunnel(g, tunnel, mat);

    /*
     * A lip along the front, so the stand has a front rather than just stopping, broken
     * either side of the tunnel: a line drawn across the mouth walls it up.
     */
    g.lineStyle(2, mat.edge, 0.8);
    if (tunnel) {
      g.lineBetween(left, side.rail, tunnel.x - tunnel.width / 2, side.rail);
      g.lineBetween(tunnel.x + tunnel.width / 2, side.rail, left + width, side.rail);
    } else {
      g.lineBetween(left, side.rail, left + width, side.rail);
    }
  },

  /*
   * The rail along both touchlines, stopping either side of the tunnel: a fence drawn
   * across the mouth is a fence the teams would have to come through. Its own function
   * because where it stops is worth being able to check.
   */
  drawRail(g, sides, S, mat) {
    const P = CONFIG.PITCH;
    const K = Renderer.CROWD;
    const left = P.left - K.railInset;
    const right = P.right + K.railInset;

    g.lineStyle(2, mat.rail, 1);
    sides.forEach((side) => {
      const gap = side.dir < 0 ? Renderer.tunnel(S) : null;
      const from = gap ? gap.x - gap.width / 2 : 0;
      const to = gap ? gap.x + gap.width / 2 : 0;
      if (gap) {
        g.lineBetween(left, side.rail, from, side.rail);
        g.lineBetween(to, side.rail, right, side.rail);
      } else {
        g.lineBetween(left, side.rail, right, side.rail);
      }
      for (let x = left; x <= right; x += K.postEvery) {
        if (!gap || x < from || x > to) {
          g.lineBetween(x, side.rail - K.postHalfHeight, x, side.rail + K.postHalfHeight);
        }
      }
    });
  },

  /*
   * The way out onto the pitch. A hole through the stand rather than a doorway in the back
   * of it, dark the whole way, with the far half darker still so it reads as running
   * somewhere rather than as a patch of paint. Drawn over the brick and the terracing,
   * because a stand is built first and cut through afterwards.
   */
  drawTunnel(g, tunnel, mat) {
    const T = Renderer.TUNNEL;
    const left = tunnel.x - tunnel.width / 2;
    const top = Math.min(tunnel.mouth, tunnel.back);
    const height = Math.abs(tunnel.mouth - tunnel.back);
    const deep = height * T.deepFraction;

    g.fillStyle(Renderer.THEME.nightBlack, 1);
    g.fillRect(left, top, tunnel.width, height);
    g.fillStyle(0x000000, T.deepen);
    g.fillRect(left, tunnel.back < tunnel.mouth ? top : top + height - deep,
      tunnel.width, deep);

    // Two walls and no lintel: the mouth is open and the back of it is not a wall.
    g.lineStyle(2, mat.edge, 0.9);
    g.lineBetween(left, top, left, top + height);
    g.lineBetween(left + tunnel.width, top, left + tunnel.width, top + height);
  },

  /* One seat, the size it is drawn at telling you which way its stand is turned. */
  drawSeat(g, seat, mat, w, h) {
    g.fillStyle(mat.seat, 1);
    g.fillRect(seat.x - w / 2, seat.y - h / 2, w, h);
    g.lineStyle(1, mat.seatEdge, 0.9);
    g.strokeRect(seat.x - w / 2, seat.y - h / 2, w, h);
  },

  drawSeats(g, side, mat, S) {
    const E = Renderer.SEATS;
    const gaps = Renderer.standGaps(side, S);
    side.rows.forEach((row) => {
      side.bands.forEach((band, bandIndex) => {
        Renderer.seatsIn(band, row)
          .filter((seat) => Renderer.seatFits(seat, gaps[bandIndex]))
          .forEach((seat) => Renderer.drawSeat(g, seat, mat,
            E.width * seat.scale, E.height * seat.scale));
      });
    });
  },

  /*
   * Who turned up. The seats exist whether or not anybody is in them, so the turnout is
   * simply which of them are taken: a thin crowd reads as a thin crowd rather than as a
   * short row, and somebody off getting a drink leaves a hole you can see.
   */
  /* Every seat in the ground and the way out that serves it, sides and ends alike. */
  seatPlaces(S) {
    const places = [];
    Renderer.standRows(S).forEach((side) => {
      const exits = Renderer.exitsIn(side);
      const gaps = Renderer.standGaps(side, S);
      side.rows.forEach((row) => {
        side.bands.forEach((band, bandIndex) => {
          Renderer.seatsIn(band, row)
            // Nobody is sat in the tunnel either, but a drink is still a walk out through
            // the back: the way out of a stand is not the way out onto the pitch.
            .filter((seat) => Renderer.seatFits(seat, gaps[bandIndex]))
            .forEach((seat) => places.push({ seat, exit: exits[bandIndex] }));
        });
      });
    });
    Renderer.endStands(S).forEach((end) => {
      end.columns.forEach((column) => {
        Renderer.seatsDown(end, column)
          .filter((seat) => Renderer.clearOfDoorway(seat, end.exit))
          .forEach((seat) => places.push({ seat, exit: end.exit }));
      });
    });
    return places;
  },

  fillSeats(scene, S) {
    const K = Renderer.CROWD;
    const wanted = Phaser.Math.Between(S.people[0], S.people[1]);

    const all = Renderer.seatPlaces(S);
    Phaser.Utils.Array.Shuffle(all);
    const taken = all.slice(0, Math.min(wanted, all.length));

    const fans = taken.map((place, n) => {
      const seat = place.seat;
      const fan = scene.add.image(seat.x, seat.y, 'fan')
        .setTint(K.jackets[n % K.jackets.length])
        .setScale(seat.scale)
        .setDepth(Renderer.DEPTH.wall + 1);
      fan.seat = seat;
      fan.exit = place.exit;
      fan.away = false;

      /*
       * Nobody stands in a neat grid on a park pitch. With no seats to sit in, the grid is
       * only a way of spacing people out, so it gets shaken up on the way in.
       */
      if (!S.structure) {
        fan.seat = {
          x: seat.x + Phaser.Math.Between(-K.jitterX, K.jitterX),
          y: seat.y + Phaser.Math.Between(-K.jitterY, K.jitterY),
          scale: seat.scale,
        };
        fan.setPosition(fan.seat.x, fan.seat.y);
      }

      // Sideways only: a circle rotating on the spot would not read as anything. Held on
      // the sprite so a trip to the bar can stop it and put it back afterwards.
      fan.swayTween = scene.tweens.add({
        targets: fan,
        x: seat.x + (Phaser.Math.Between(-K.swayPx, K.swayPx) || K.swayPx),
        duration: Phaser.Math.Between(K.swayMinMs, K.swayMaxMs),
        delay: Phaser.Math.Between(0, 900),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return fan;
    });

    Renderer.startBeerRuns(scene, fans);
    return fans;
  },

  /*
   * Everybody up. A goal is the one moment the crowd is worth looking at, so every one of
   * them jumps: from directly above, a jump is a supporter getting bigger and smaller
   * again, which is also the one thing about them nothing else is already using. The sway
   * has their x and a trip to the bar has both, so scale is the only property free.
   *
   * Staggered, because two hundred people leaving the ground at the same instant is a
   * wave rather than a crowd.
   */
  crowdCelebrate(scene) {
    const J = Renderer.JUICE.goalCelebration;
    if (!J.on) return 0;
    const fans = scene.children.list.filter((o) => o.texture && o.texture.key === 'fan');
    fans.forEach((fan) => {
      const seated = fan.scaleX;
      scene.tweens.add({
        targets: fan,
        scale: seated * J.crowdJump,
        duration: J.crowdJumpMs,
        delay: Math.random() * J.crowdStaggerMs,
        yoyo: true,
        repeat: J.crowdJumps - 1,
        ease: 'Quad.easeOut',
        // Put back by hand: a tween interrupted by the next goal would leave somebody
        // stuck at the top of their jump for the rest of the match.
        onComplete: () => fan.setScale(seated),
      });
    });
    return fans.length;
  },

  /*
   * One timer for the whole crowd rather than one each: at this scale a ground can hold two
   * hundred people, and two hundred timers to make six of them stand up is a poor trade.
   */
  startBeerRuns(scene, fans) {
    const B = Renderer.BEER;
    if (!fans.length) return;

    const next = () => Phaser.Math.Between(B.everyMinMs, B.everyMaxMs);
    scene.time.addEvent({
      delay: next(),
      loop: true,
      callback: () => {
        const away = fans.filter((f) => f.away).length;
        if (away >= B.maxAway) return;
        const seated = fans.filter((f) => !f.away && f.active);
        if (!seated.length) return;
        Renderer.sendForBeer(scene, Phaser.Utils.Array.GetRandom(seated));
      },
    });
  },

  sendForBeer(scene, fan) {
    const B = Renderer.BEER;
    fan.away = true;
    if (fan.swayTween) fan.swayTween.pause();

    /*
     * Held on the sprite as `trip`, because a supporter has two tweens on them at once and
     * the sway is the other one. Picking whichever the tween manager happens to list last
     * is a coin toss.
     */
    // Faded out on the way, so the moment of vanishing is at the gap rather than on it.
    fan.trip = scene.tweens.add({
      targets: fan,
      x: fan.exit.x,
      y: fan.exit.y,
      alpha: 0,
      duration: Phaser.Math.Between(B.walkMinMs, B.walkMaxMs),
      ease: 'Sine.easeIn',
      onComplete: () => {
        if (!fan.active) return;
        // Put where it was going, not merely near it: a tween cut short partway leaves
        // somebody half in the wall, and the arrival is what the next leg starts from.
        fan.setPosition(fan.exit.x, fan.exit.y).setAlpha(0);
        scene.time.delayedCall(Phaser.Math.Between(B.awayMinMs, B.awayMaxMs), () => {
          if (!fan.active) return;
          fan.trip = scene.tweens.add({
            targets: fan,
            x: fan.seat.x,
            y: fan.seat.y,
            alpha: 1,
            duration: Phaser.Math.Between(B.walkMinMs, B.walkMaxMs),
            ease: 'Sine.easeOut',
            onComplete: () => {
              fan.setPosition(fan.seat.x, fan.seat.y).setAlpha(1);
              fan.away = false;
              fan.trip = null;
              if (fan.swayTween) fan.swayTween.resume();
            },
          });
        });
      },
    });
  },

  /* Where the four towers stand: just outside each corner of the pitch. */
  pylonPositions() {
    const P = CONFIG.PITCH;
    const F = Renderer.FLOODLIGHTS;
    return [
      { x: P.left - F.pylonInsetX, y: P.top - F.pylonInsetY, ax: -1, ay: -1 },
      { x: P.right + F.pylonInsetX, y: P.top - F.pylonInsetY, ax: 1, ay: -1 },
      { x: P.left - F.pylonInsetX, y: P.bottom + F.pylonInsetY, ax: -1, ay: 1 },
      { x: P.right + F.pylonInsetX, y: P.bottom + F.pylonInsetY, ax: 1, ay: 1 },
    ];
  },

  skinHasLights() {
    const skin = Renderer.SKINS.find((s) => s.key === Renderer.activeSkin);
    return !!(skin && skin.lights) && Renderer.JUICE.floodlights.on;
  },

  /*
   * Night falls, then four towers light it back up. The darkening goes over the markings
   * rather than under them, so the lines are dimmed with the grass instead of glowing
   * through it, and the pools go over that.
   */
  createFloodlights(scene, g) {
    if (!Renderer.skinHasLights()) return;
    const P = CONFIG.PITCH;
    const F = Renderer.FLOODLIGHTS;

    g.fillStyle(Renderer.THEME.nightBlack, F.darken);
    g.fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height);

    Renderer.pylonPositions().forEach((pylon) => {
      scene.add.image(pylon.x, pylon.y, 'light_pool')
        .setDisplaySize(F.poolRadius * 2, F.poolRadius * 2)
        .setTint(F.warm)
        .setAlpha(F.poolAlpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(Renderer.DEPTH.pitch + 1);

      Renderer.drawPylon(scene, pylon);
    });
  },

  /* A bank of lamps in a dark housing, with a haze around it so it reads as the source. */
  drawPylon(scene, pylon) {
    const F = Renderer.FLOODLIGHTS;
    const w = F.headWidth;
    const h = F.headHeight;

    scene.add.image(pylon.x, pylon.y, 'light_pool')
      .setDisplaySize(F.glowRadius * 2, F.glowRadius * 2)
      .setTint(F.warm).setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Renderer.DEPTH.wall);

    const g = scene.add.graphics().setDepth(Renderer.DEPTH.wall + 1);
    g.fillStyle(Renderer.mix(Renderer.THEME.nightBlack, 0xffffff, 0.24), 1);
    g.fillRect(pylon.x - w / 2, pylon.y - h / 2, w, h);

    const gap = w / F.lamps;
    for (let i = 0; i < F.lamps; i += 1) {
      g.fillStyle(F.warm, 0.95);
      g.fillCircle(pylon.x - w / 2 + gap * (i + 0.5), pylon.y, 2.6);
    }
  },

  /* Where a tower's housing actually inks, so the suite can check what it sits on. */
  pylonBox(pylon) {
    const F = Renderer.FLOODLIGHTS;
    return {
      left: pylon.x - F.headWidth / 2, right: pylon.x + F.headWidth / 2,
      top: pylon.y - F.headHeight / 2, bottom: pylon.y + F.headHeight / 2,
    };
  },

  /*
   * One shadow per tower, thrown directly away from it. Made once and then only moved,
   * because a match creates and destroys quite enough as it is.
   */
  makeShadows(scene, view) {
    if (!Renderer.skinHasLights()) return null;
    const F = Renderer.FLOODLIGHTS;
    const pylons = Renderer.pylonPositions();
    const casters = view.players.map((p) => ({ sprite: p.sprite, size: CONFIG.PLAYER.radius * 2 }))
      .concat((view.keepers || []).map((k) => ({ sprite: k.sprite, size: CONFIG.KEEPER.width })))
      .concat([{ sprite: view.ball, size: CONFIG.BALL.radius * 2 }]);

    return casters.map((caster) => ({
      caster,
      blobs: pylons.map(() => scene.add.image(caster.sprite.x, caster.sprite.y, 'soft_shadow')
        .setDisplaySize(caster.size * F.shadow.scale, caster.size * F.shadow.scale)
        .setTint(Renderer.THEME.nightBlack)
        .setAlpha(F.shadow.alpha)
        .setDepth(Renderer.DEPTH.wall + 1)),
      pylons,
    }));
  },

  moveShadows(shadows) {
    const F = Renderer.FLOODLIGHTS;
    shadows.forEach((entry) => {
      const s = entry.caster.sprite;
      if (!s || !s.active) return;
      entry.blobs.forEach((blob, i) => {
        const pylon = entry.pylons[i];
        const dx = s.x - pylon.x;
        const dy = s.y - pylon.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        blob.setPosition(s.x + (dx / len) * F.shadow.offset, s.y + (dy / len) * F.shadow.offset);
        blob.setVisible(s.visible);
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
    // Hung off the sprite, so whatever happens to him happens to them: a scene that is
    // torn down takes both, and nothing else has to know they exist.
    sprite.hands = [-1, 1].map((side) => {
      const glove = scene.add
        .image(x, y, team === 'red' ? 'hand_red' : 'hand_blue')
        .setDepth(Renderer.DEPTH.player + 1);
      glove.side = side;
      return glove;
    });
    return sprite;
  },

  /*
   * Where a pair of hands has got to. Out to either side of the way he is facing, and
   * swinging fore and aft while he runs, one forward as the other goes back.
   *
   * Read off the body's own rotation rather than off his facing, so a drunk sway takes his
   * arms round with it instead of leaving them behind.
   */
  moveHands(player, time) {
    const H = Renderer.HANDS;
    const sprite = player.sprite;
    if (!sprite || !sprite.hands) return;
    const running = !!sprite.body && sprite.body.speed > H.runningAbove;
    const phase = (time / H.periodMs) * Math.PI * 2;

    sprite.hands.forEach((glove) => {
      const out = sprite.rotation + glove.side * Phaser.Math.DegToRad(H.spreadDeg);
      const swing = running
        ? Math.sin(phase + (glove.side > 0 ? Math.PI : 0)) * H.pumpPx : 0;
      glove.setPosition(
        sprite.x + Math.cos(out) * H.reach + Math.cos(sprite.rotation) * swing,
        sprite.y + Math.sin(out) * H.reach + Math.sin(sprite.rotation) * swing,
      );
    });
  },

  createBall(scene, x, y) {
    const sprite = scene.physics.add.image(x, y, 'ball');
    sprite.body.setCircle(CONFIG.BALL.radius, 0, 0);
    sprite.setDepth(Renderer.DEPTH.ball);
    return sprite;
  },

  createKeeper(scene, x, y, team) {
    const sprite = scene.physics.add.image(x, y, team === 'red' ? 'keeper_red' : 'keeper_blue');
    // His gloves stick out past the slab the match was tuned around, and a glove is not
    // what stops a shot: the body stays the size every save rate in this game was measured
    // against, whatever he is drawn as.
    sprite.body.setSize(CONFIG.KEEPER.width, CONFIG.KEEPER.height, true);
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
   * Where each thumb control goes, worked out from the frame rather than written down.
   *
   * Both columns are the gutter the wide frame added, so the stick and the buttons are
   * beside the pitch and never on it. In the narrow frame there is no gutter to speak of
   * and this falls back to the margin: only the test harness ever sees that, because
   * asking for thumb controls is what makes the frame wide in the first place.
   */
  touchLayout() {
    const T = Renderer.TOUCH;
    const W = CONFIG.CANVAS.width;
    const left = CONFIG.PITCH.left;
    const right = W - CONFIG.PITCH.right;

    return {
      stick: {
        x: left / 2, y: T.stickY,
        baseRadius: T.stickBaseRadius, nubRadius: T.stickNubRadius, travel: T.stickTravel,
        /*
         * How close the stick may be picked up to the edge of its column. Whichever reaches
         * further, the ring or the nub pushed all the way out, and the nub usually wins:
         * clamping to the ring alone let it cross the touchline on a hard push.
         *
         * Stated once, here, because the suite checks the same number.
         */
        margin: Math.max(T.stickBaseRadius, T.stickTravel + T.stickNubRadius) + T.stickClear,
      },
      // The whole column, so the stick can be picked up wherever a thumb happens to land.
      // Stopping at the touchline is the point: a drag on the pitch must not move it there.
      stickZone: { left: 0, top: 0, right: left, bottom: CONFIG.CANVAS.height },
      buttons: T.buttons.map((b) => ({ ...b, x: W - right / 2 })),
      pause: { ...T.pause, x: W / 2 },
    };
  },

  /*
   * The thumb controls for a match. Like every other control scheme in the game, this one
   * only reports: the stick says which way it is being pushed as a fraction of its own
   * travel, the buttons say they were pressed, and the scene decides what any of it means.
   * So a thumb ends up filling in the same six booleans a keyboard fills in.
   */
  createTouchControls(scene, handlers) {
    const T = Renderer.TOUCH;
    const L = Renderer.touchLayout();
    const S = L.stick;
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

    const Z = L.stickZone;

    /*
     * The stick follows a thumb up and down its column but not sideways out of it: the
     * gutter is barely wider than the ring, and anything hanging over the touchline is the
     * whole thing this layout exists to avoid.
     */
    const margin = S.margin;
    const grabAt = (x, y) => place(
      Phaser.Math.Clamp(x, margin, Math.max(margin, Z.right - margin)),
      Phaser.Math.Clamp(y, margin, CONFIG.CANVAS.height - margin));

    const zone = scene.add.zone((Z.left + Z.right) / 2, (Z.top + Z.bottom) / 2,
      Z.right - Z.left, Z.bottom - Z.top)
      .setInteractive()
      .on('pointerdown', (pointer) => {
        if (held !== null) return;
        held = pointer.id;
        grabAt(pointer.worldX, pointer.worldY);
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

    L.buttons.forEach((spec) => {
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
    const P = L.pause;
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
   * Colour says who. The label belongs to whoever just made a mess of it, so it goes up in
   * that player's colour and you know at a glance whose fumble it was without reading a
   * word of it. Lightened, because a kit colour that reads on a player is not necessarily
   * one that reads as text on grass.
   */
  OUTCOME_LIGHTEN: 0.34,

  outcomeColour(team) {
    const base = team === 'blue' ? Renderer.THEME.blueTeam : Renderer.THEME.redTeam;
    return Renderer.hex(Renderer.lighten(base, Renderer.OUTCOME_LIGHTEN));
  },

  onOutcome(scene, player, outcomeKey) {
    // Whatever the crowd makes of it goes first: the label is switched off by a setting
    // and being able to turn the words off should not take the noise with them.
    Sound.groan(Sound.GROANS[outcomeKey]);

    const str = Renderer.phraseFor(Renderer.OUTCOME_LABELS, outcomeKey);
    if (!str) return;

    const J = Renderer.JUICE.outcomeLabels;
    if (!J.on) return;

    const label = Renderer.display(scene, player.sprite.x, player.sprite.y - 44, str,
      J.size, Renderer.outcomeColour(player.team))
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
    Sound.cheer(Renderer.crowdLoudness(scene));
    Renderer.crowdCelebrate(scene);

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

  /*
   * Out of the dark. The mouth is nearly black, and a player stepping straight out of it
   * at full brightness looks like he was stood against the wall all along, so each of them
   * comes up over the first stride and is himself by the time he reaches the grass.
   *
   * The delay is the match's, not this one's: it decides the order they come out in.
   */
  onEntrance(scene, walkers) {
    walkers.forEach((walker) => {
      const sprite = walker.player.sprite;
      sprite.setAlpha(0);
      scene.tweens.add({
        targets: sprite,
        alpha: 1,
        delay: walker.delay,
        duration: Renderer.ENTRANCE.fadeMs,
        ease: 'Quad.easeOut',
      });
    });
  },

  /*
   * However the walk ended, they are out on the grass now and they are visible. A fade
   * left half finished is a player nobody can see, which is a worse bug than no fade.
   */
  onEntranceDone(scene, walkers) {
    walkers.forEach((walker) => {
      scene.tweens.killTweensOf(walker.player.sprite);
      walker.player.sprite.setAlpha(1);
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
    // Nothing starts until he says so, which is the one thing a referee is for.
    if (isGo) Renderer.blowWhistle(scene);
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
    /*
     * Made on the first tick rather than when the match is built, so the whole of this
     * lives here and game.js never has to know a floodlit ground is any different. Cleared
     * with the rest of juiceState when a scene restarts.
     */
    if (scene.juiceState.shadows === undefined) {
      scene.juiceState.shadows = Renderer.makeShadows(scene, view);
    }
    if (scene.juiceState.shadows) Renderer.moveShadows(scene.juiceState.shadows);

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

    // After the sway, so his arms go round with him rather than a frame behind him.
    view.players.forEach((player) => Renderer.moveHands(player, time));

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
  /*
   * Ten blocks, filled up to wherever the setting is. Every block is its own target, so
   * the bar is a thing you set rather than a thing you step through: the key does the
   * stepping for anybody who would rather not aim at a nine pixel square.
   */
  /* Where it starts, in the frame the game is actually being played in. */
  volumeBarX() {
    return CONFIG.CANVAS.width / 2 + Renderer.VOLUME_BAR.fromMiddle;
  },

  volumeBar(scene, y, step, onPick) {
    const B = Renderer.VOLUME_BAR;
    const x = Renderer.volumeBarX();
    const blocks = [];
    for (let i = 0; i < Sound.STEPS; i += 1) {
      const on = i < step;
      const block = scene.add.image(x + i * (B.block + B.gap), y, 'px')
        .setDisplaySize(B.block, on ? B.height : B.height * 0.55)
        .setTint(on ? Renderer.THEME.lagerYellow : Renderer.PALETTE.outline)
        .setDepth(Renderer.DEPTH.overlay)
        .setInteractive({ useHandCursor: true });
      // Clicking the block you are already on is how you get silence out of a bar.
      block.on('pointerdown', () => onPick(step === i + 1 ? i : i + 1));
      blocks.push(block);
    }
    return blocks;
  },

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
     * Opened from a paused match, a new mode cannot repaint the match already drawn behind
     * this screen, because it is using the textures baked for the old one. Saying so beats
     * letting someone pick one and watch nothing happen.
     */
    Renderer.centred(scene, 172, state.inMatch
      ? 'kept between sessions  ·  a new mode starts with the next match'
      : 'kept between sessions', 20, C.dim);

    // MODES on screen, skins in the code: the word the player reads is the only one that
    // has to change, and renaming a hundred references would be a diff about nothing.
    Renderer.text(scene, nameX, 220, 'MODES', 18, C.accent).setDepth(Renderer.DEPTH.overlay);

    const L = Renderer.SETTINGS_LAYOUT;
    // The cursor holds the last thing drawn, so everything below places itself off it.
    let y = L.skinTop;
    Renderer.SKINS.forEach((skin, i) => {
      y = L.skinTop + i * L.skinGap;
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

    /*
     * Three sections of rows in what is left of the band, which is why the spacing is
     * tighter than it looks like it wants to be. Each heading and row takes its place from
     * the one above rather than from a number typed here, so a section can be added
     * without every y below it needing to be found and moved. The suite checks nothing has
     * grown past the grass it stands on.
     */
    let opening = false;
    const heading = (title) => {
      y += L.headGap;
      Renderer.text(scene, nameX, y, title, 18, C.accent).setDepth(Renderer.DEPTH.overlay);
      opening = true;
    };
    // Blurbs sit further right than the skins' do, because these labels are a good deal
    // wider. Returns the row's y, for anything that has to draw beside it.
    const row = (label, blurb, onPick) => {
      y += opening ? L.firstRow : L.rowGap;
      opening = false;
      Renderer.optionAt(scene, nameX, y, label, 21, onPick);
      Renderer.text(scene, cx - 10, y, blurb, 14, C.dim)
        .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);
      return y;
    };

    heading('CONTROLS');
    row('M   MOUSE CLICKS   ' + (state.mouseClicks ? 'ON' : 'OFF'),
      'left click passes, right click shoots, one player only', handlers.mouse);
    row('T   THUMB CONTROLS   ' + state.touch.toUpperCase(),
      Renderer.TOUCH_BLURB[state.touch], handlers.touch);
    row('A   AIM ASSIST   ' + state.assist.toUpperCase(),
      Renderer.ASSIST_BLURB[state.assist], handlers.assist);

    // The keys themselves live on a screen of their own, where they can be changed. It is
    // still a control, so it belongs here rather than under the ground it is played on.
    row('K   CHANGE THE KEYS',
      'move, pass and shoot, for both players', handlers.keys);

    heading('SOUND');
    const volumeY = row('V   VOLUME',
      state.volume > 0
        ? 'the whistle, the crowd, and how sorry they are for you'
        : 'muted, so nobody has to hear what you are doing',
      () => handlers.volume());
    Renderer.volumeBar(scene, volumeY, state.volume, handlers.volume);

    heading('GROUND');
    /*
     * A skin may own the only ground it is ever played in, in which case this says so
     * rather than offering a choice that would be ignored the moment a match started.
     */
    const owned = Renderer.skinGround();
    const ground = Renderer.STADIUMS.find((st) => st.key === Renderer.stadiumChoice);
    row(owned ? 'G   STADIUM   ' + owned.name
      : 'G   STADIUM   ' + Renderer.stadiumChoice.toUpperCase(),
    owned ? owned.blurb + ', and nothing else for this mode'
      : (ground ? ground.blurb : 'a different ground every match'),
    handlers.stadium);

    // Under the settings rather than among them, because it is not one: it leaves for a
    // different build of the game entirely.
    Renderer.option(scene, 640, 'LEGACY MODE', 28, handlers.legacy);
    Renderer.centred(scene, 670,
      'the game as it was when blue shot with - and =', 14, C.dim);

    Renderer.centred(scene, 700,
      state.inMatch ? 'ESC  back to the match' : 'ESC  to go back', 20, C.dim);
  },

  /*
   * Every key in the game, and every one of them changeable. Laid out as the same three
   * column table the front screen uses, except each key is a thing you can press: pick one
   * and the next key you touch becomes it.
   */
  KEYS_TABLE: { headerY: 244, topY: 288, rowGap: 42, messageY: 556 },

  createKeysScreen(scene, state, handlers) {
    const C = Renderer.CSS;
    const cx = CONFIG.CANVAS.width / 2;
    const T = Renderer.KEYS_TABLE;
    const band = Renderer.SETTINGS_BAND;

    scene.add.graphics()
      .fillStyle(Renderer.PALETTE.surround, 1)
      .fillRect(0, 0, CONFIG.CANVAS.width, CONFIG.CANVAS.height)
      .fillStyle(Renderer.PALETTE.grass, 1)
      .fillRect(0, band.top, CONFIG.CANVAS.width, band.height);

    Renderer.centredDisplay(scene, 110, 'CONTROLS', 72);
    Renderer.centred(scene, 172, 'click a key, then press the one you want it to be',
      20, C.dim);

    const labelX = cx - 250;
    const columnX = { red: cx - 40, blue: cx + 190 };

    ['red', 'blue'].forEach((team) => {
      Renderer.text(scene, columnX[team], T.headerY, Renderer.TEAM_NAME[team], 20,
        team === 'red' ? C.red : C.blue)
        .setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
    });

    state.actions.forEach((action, i) => {
      const y = T.topY + i * T.rowGap;
      Renderer.text(scene, labelX, y, action.name, 20, C.hud)
        .setOrigin(0, 0.5).setDepth(Renderer.DEPTH.overlay);

      ['red', 'blue'].forEach((team) => {
        const asking = state.capturing
          && state.capturing.team === team
          && state.capturing.action.key === action.key;
        // The one being asked about says so in its own cell, so there is never any doubt
        // about which key the next press is going to become.
        const label = asking ? 'PRESS...' : Renderer.keyLabel(CONFIG.CONTROLS[team][action.key]);
        const cell = Renderer.text(scene, columnX[team], y, label, 22,
          asking ? C.accent : C.hud)
          .setOrigin(0.5).setDepth(Renderer.DEPTH.overlay);
        Renderer.makePickable(cell, () => handlers.rebind(team, action),
          asking ? C.accent : C.hud);
      });
    });

    // Kept in the same place whether or not there is anything to say, so the table above
    // never shifts under a hand that is reaching for it.
    Renderer.centred(scene, T.messageY, state.message || ' ', 18,
      state.capturing ? C.accent : C.dim);

    Renderer.option(scene, 645, 'R   RESET TO THE ORIGINALS', 24, handlers.reset);
    Renderer.centred(scene, 690, 'ESC  back to settings', 20, C.dim);
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
