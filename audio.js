'use strict';

/*
 * Everything you can hear, built out of oscillators and noise at the moment it is needed.
 *
 * Not one audio file. Every texture in this game is baked at boot from a few numbers, and
 * sound is the same idea pointed at a different output: a whistle is two tones close
 * enough together to beat against each other, a groan is a band of noise sliding down and
 * a cheer is one sliding up. It also means there is nothing to fail to load, nothing to
 * license, and a whole stadium in about a hundred lines.
 *
 * game.js knows nothing about any of this, the same way it knows nothing about colours.
 * Every sound here is triggered from a hook render.js already had.
 */
const Sound = {
  STORAGE_KEY: 'drunkfootball.volume',

  /*
   * Volume is a whole number of steps, because what it has to survive is being drawn as a
   * bar and being nudged with a key. Zero is silence and is a real setting.
   */
  STEPS: 10,
  DEFAULT_STEP: 6,
  step: 6,

  /*
   * Loudness is not linear. Halving the number halves nothing anybody can hear, so the
   * steps are curved: the quiet end of the bar is where the useful range lives.
   */
  CURVE: 1.8,

  ctx: null,
  live: false,
  master: null,
  noiseBuffer: null,
  noiseFor: null,
  lastGroanAt: -Infinity,

  /*
   * The mix, in one place, because balancing sound is nothing but relative numbers and
   * they are useless scattered through the code that makes them.
   */
  MIX: {
    /*
     * A pea whistle is two tones a few dozen hertz apart, beating against each other, with
     * a great deal of air behind them. Written down as a fourth apart it was two clean
     * sine tones sounding at once, which is not a whistle: it is a smoke alarm, and it
     * rang in the ears long after it stopped. Close them up, drop the pitch out of the
     * most piercing part of hearing, take the edge off the top with a filter and let the
     * air carry most of it.
     */
    whistle: {
      tones: [2180, 2216],   // 36Hz apart, which beats rather than sounding two notes
      rattleHz: 21,          // the pea going round
      rattleDepth: 55,
      breath: 0.5,           // air, which is most of what a whistle actually is
      soften: 3200,          // and the edge off the top of it
      level: 0.34,
      ms: 320,
    },
    groan: {
      /*
       * A crowd noise is a band of noise with some voice under it. The band slides down,
       * which is the whole of what makes a groan sound like disappointment rather than
       * like a cheer played backwards.
       */
      voices: [148, 191, 233],
      glide: 0.86,           // where those voices end up, as a fraction of where they began
      fromHz: 640,
      toHz: 210,
      level: 0.34,
      minMs: 340,
      maxMs: 900,
      gapMs: 260,            // no dogpiling: one groan at a time and no more
    },
    cheer: {
      fromHz: 360,
      peakHz: 1180,
      toHz: 640,
      level: 0.5,
      minMs: 900,
      maxMs: 1850,
      clapsMin: 5,
      clapsMax: 16,
      clapMs: 34,
      clapHz: 2100,
      clapLevel: 0.5,
    },
  },

  /*
   * How sorry the crowd is, by what you just did with the ball. Every outcome on the drunk
   * table except the one you meant is in here: they are always muttering, and a fumble or
   * a faceplant is the only thing that gets the full waaay.
   */
  GROANS: {
    wrongFoot: 0.34,
    wildSlice: 0.62,
    fumble: 1,
    whiff: 0.55,
    backheel: 0.34,
    faceplant: 1,
  },

  /* ------------------------------------------------------------- the setting */

  gain() {
    return Math.pow(Sound.step / Sound.STEPS, Sound.CURVE);
  },

  setStep(step) {
    Sound.step = Math.max(0, Math.min(Sound.STEPS, Math.round(step)));
    if (Sound.master) Sound.master.gain.value = Sound.gain();
    Sound.save();
    return Sound.step;
  },

  /* Up one, and round to silence off the top: every setting reachable from one key. */
  nextStep() {
    return Sound.setStep(Sound.step >= Sound.STEPS ? 0 : Sound.step + 1);
  },

  save() {
    try {
      window.localStorage.setItem(Sound.STORAGE_KEY, String(Sound.step));
    } catch (err) { /* nothing worth doing */ }
  },

  load() {
    let saved = null;
    try {
      saved = window.localStorage.getItem(Sound.STORAGE_KEY);
    } catch (err) { saved = null; }
    const n = parseInt(saved, 10);
    Sound.step = Number.isFinite(n) && n >= 0 && n <= Sound.STEPS ? n : Sound.DEFAULT_STEP;
  },

  /* ------------------------------------------------------------- the wiring */

  /*
   * A browser will not make a sound until somebody has clicked or pressed something, so
   * the context is built on the first sound that is asked for and resumed every time
   * after. A call that arrives before the browser will allow it is dropped rather than
   * queued: a whistle that turns up late is worse than one that never came.
   */
  wake() {
    if (!Sound.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        Sound.attach(new Ctx(), true);
      } catch (err) {
        return null;
      }
    }
    // Only a context with speakers on the end of it has anything to be woken from: an
    // offline one is suspended by definition until somebody asks it to render.
    if (Sound.live && Sound.ctx.state === 'suspended') Sound.ctx.resume();
    return Sound.ctx;
  },

  /* Also how the suite listens: an offline context is the only way to hear a test. */
  attach(ctx, live) {
    Sound.ctx = ctx;
    Sound.live = !!live;
    Sound.master = ctx.createGain();
    Sound.master.gain.value = Sound.gain();
    Sound.master.connect(ctx.destination);
    Sound.noiseBuffer = null;
    Sound.lastGroanAt = -Infinity;
    return ctx;
  },

  /* Silence costs nothing to skip, and skipping it keeps the graph empty when muted. */
  silent() {
    return Sound.step <= 0;
  },

  /* A second and a half of white noise, made once per context and looped by everything. */
  noise() {
    const ctx = Sound.ctx;
    if (!Sound.noiseBuffer || Sound.noiseFor !== ctx) {
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      Sound.noiseBuffer = buffer;
      Sound.noiseFor = ctx;
    }
    const source = ctx.createBufferSource();
    source.buffer = Sound.noiseBuffer;
    source.loop = true;
    return source;
  },

  /* Attack, then all the way down. Everything here is one shape with different numbers. */
  envelope(node, at, seconds, peak, attack) {
    const g = node.gain;
    g.setValueAtTime(0.0001, at);
    g.linearRampToValueAtTime(peak, at + attack);
    g.exponentialRampToValueAtTime(0.0001, at + seconds);
  },

  /* ------------------------------------------------------------- the sounds */

  /*
   * The referee. Two tones a little apart so they beat, wobbled by the pea, with a puff of
   * air at the front. Short: a kickoff whistle is one blast, not a performance.
   */
  whistle() {
    if (Sound.silent()) return null;
    const ctx = Sound.wake();
    if (!ctx) return null;

    const W = Sound.MIX.whistle;
    const at = ctx.currentTime;
    const secs = W.ms / 1000;

    const out = ctx.createGain();
    out.connect(Sound.master);
    Sound.envelope(out, at, secs, W.level, 0.012);

    // Everything tonal goes through this: a sine pair with nothing over it is a test tone.
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = W.soften;
    soft.connect(out);

    const pea = ctx.createOscillator();
    pea.frequency.value = W.rattleHz;
    const peaDepth = ctx.createGain();
    peaDepth.gain.value = W.rattleDepth;
    pea.connect(peaDepth);

    W.tones.forEach((hz) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      peaDepth.connect(osc.frequency);
      osc.connect(soft);
      osc.start(at);
      osc.stop(at + secs);
    });

    // The air, all the way through rather than only at the front: it is the breath that
    // makes it a whistle rather than a note.
    const air = Sound.noise();
    const airBand = ctx.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.frequency.value = W.tones[0];
    airBand.Q.value = 1.6;
    const airLevel = ctx.createGain();
    Sound.envelope(airLevel, at, secs, W.breath, 0.008);
    air.connect(airBand).connect(airLevel).connect(out);
    air.start(at);
    air.stop(at + secs);

    pea.start(at);
    pea.stop(at + secs);
    return out;
  },

  /*
   * Waaay. Noise sliding down for the body of it and three voices sliding with it, at
   * whatever size the mistake deserved. Rate limited, because the ball can be given away
   * twice in a second and two groans on top of each other is a noise, not a crowd.
   */
  groan(strength) {
    const G = Sound.MIX.groan;
    const size = Math.max(0, Math.min(1, strength || 0));
    if (Sound.silent() || size <= 0) return null;
    const ctx = Sound.wake();
    if (!ctx) return null;

    const at = ctx.currentTime;
    if (at - Sound.lastGroanAt < G.gapMs / 1000) return null;
    Sound.lastGroanAt = at;

    const secs = (G.minMs + (G.maxMs - G.minMs) * size) / 1000;
    const out = ctx.createGain();
    out.connect(Sound.master);
    Sound.envelope(out, at, secs, G.level * (0.45 + 0.55 * size), 0.07);

    const body = Sound.noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(G.fromHz, at);
    band.frequency.exponentialRampToValueAtTime(G.toHz, at + secs);
    body.connect(band).connect(out);
    body.start(at);
    body.stop(at + secs);

    G.voices.forEach((hz) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz, at);
      osc.frequency.exponentialRampToValueAtTime(hz * G.glide, at + secs);
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 900;
      const level = ctx.createGain();
      level.gain.value = 0.16;
      osc.connect(soft).connect(level).connect(out);
      osc.start(at);
      osc.stop(at + secs);
    });

    return out;
  },

  /*
   * A goal. The same band of noise going the other way, plus a scatter of claps, and the
   * whole thing sized by how many people are actually in the ground: a dozen witnesses on
   * a park pitch should not sound like a full house.
   */
  cheer(size) {
    const C = Sound.MIX.cheer;
    const crowd = Math.max(0, Math.min(1, size === undefined ? 1 : size));
    if (Sound.silent()) return null;
    const ctx = Sound.wake();
    if (!ctx) return null;

    const at = ctx.currentTime;
    const secs = (C.minMs + (C.maxMs - C.minMs) * crowd) / 1000;
    const out = ctx.createGain();
    out.connect(Sound.master);
    Sound.envelope(out, at, secs, C.level * (0.4 + 0.6 * crowd), 0.11);

    const body = Sound.noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(C.fromHz, at);
    band.frequency.exponentialRampToValueAtTime(C.peakHz, at + secs * 0.35);
    band.frequency.exponentialRampToValueAtTime(C.toHz, at + secs);
    body.connect(band).connect(out);
    body.start(at);
    body.stop(at + secs);

    // Applause: short bursts of bright noise, thinner in a smaller ground.
    const claps = Math.round(C.clapsMin + (C.clapsMax - C.clapsMin) * crowd);
    for (let i = 0; i < claps; i += 1) {
      const when = at + Math.random() * secs * 0.7;
      const clap = Sound.noise();
      const bright = ctx.createBiquadFilter();
      bright.type = 'highpass';
      bright.frequency.value = C.clapHz;
      const level = ctx.createGain();
      Sound.envelope(level, when, C.clapMs / 1000, C.clapLevel * crowd, 0.002);
      clap.connect(bright).connect(level).connect(out);
      clap.start(when);
      clap.stop(when + C.clapMs / 1000);
    }

    return out;
  },
};

Sound.load();
