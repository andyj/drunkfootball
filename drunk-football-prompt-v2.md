# Build prompt: Drunk Football (Phaser)

Build a complete, playable browser game called **Drunk Football**: a chaotic top-down 2D football game. Movement is normal, but every player on the pitch is drunk, so the moment you try to kick the ball there is no guarantee your legs do what your brain asked. That mechanic is the whole point of the game. Everything else exists to serve it.

**This build is mechanics only.** Use plain placeholder shapes generated in code. Do not spend effort on art direction, styling or polish. A visual design pass comes later, so keep all rendering isolated enough that it can be swapped out without touching game logic.

---

## Tech requirements

- **Phaser 4** (latest 4.x), loaded from the jsDelivr CDN. If you are only confident in Phaser 3, use **Phaser 3.90.0** instead and say so. The game only needs Arcade Physics and basic APIs that exist in both.
- **Arcade Physics** only. No Matter.js.
- Deliverable is **one `index.html`** with inline JS (or `index.html` + `game.js`). No build step, no bundler. Must run from a plain static file server.
- **No external assets.** Everything drawn with the Graphics API / `generateTexture`. No asset files, no sound needed.
- Canvas **1280x720**, `Scale.FIT`, centred.
- Every tunable number (speeds, kick power, drunk weights, match length, penalty settings) lives in a single `CONFIG` object at the top of the file.

## Build order

1. **Bot mode first.** One human vs bot is the primary target and must be fully playable before anything else.
2. **Two player on the same keyboard** comes second, sharing all the same code paths. Both players are local, no networking.
3. Menu lets you pick: **1** for vs Bot, **2** for two player.

## Scenes

1. **MenuScene**: title, controls list, mode select.
2. **GameScene**: the match.
3. **PenaltyScene**: shootout, entered only if the match ends level.
4. **FullTimeScene**: result, **Space** to rematch, **M** for menu.

## The pitch

- Rectangular pitch filling the canvas, with a halfway line and a centre spot marked.
- **Left and right edges each have a goal mouth**: an opening roughly 150px tall, vertically centred.
- All boundaries are solid walls the ball bounces off, except the goal mouths. No throw-ins, corners or offside. Walls keep play flowing and make wall passes viable.

## Players and movement

- **1v1.** Red plays left and attacks right, Blue plays right and attacks left.
- Placeholder representation only: a body shape with a clear indicator of which way the player is facing. Facing direction must be readable at a glance because every kick depends on it.
- 8-direction movement, normalised diagonals. Base speed around 230 px/s, around 180 px/s while dribbling.
- Facing = last non-zero movement direction. Kickoff facing is toward the opponent's goal.

## Controls

| Action | Player 1 (Red) | Player 2 (Blue) |
|---|---|---|
| Move up / left / down / right | W / A / S / D | I / J / K / L |
| Pass | Q | U |
| Shoot | E | O |

The rule for both players: the key to the **left** of your up key is Pass, the key to the **right** is Shoot (Q/E flank W, U/O flank I). Same muscle memory on both sides. **P** or **Esc** pauses. Action keys only register while that player has possession; otherwise ignore the press.

## Ball, dribbling and tackles

- Tune drag so a pass rolls to a stop in roughly 1.5 seconds. Bounce factor about 0.75 off walls and keepers.
- **Dribbling**: come within about 28px of a free ball to take possession. While in possession the ball sits about 24px ahead of the player's facing direction each frame.
- **Tackling**: if the opponent's body touches the ball while someone is dribbling, possession breaks and the ball pops loose with a small random impulse. Apply a 400ms cooldown before anyone can recapture it so possession does not ping-pong on contact.

## The drunk mechanic (the whole point)

Pressing Pass or Shoot never guarantees that action. Each press rolls once against a weighted outcome table. Weights live in `CONFIG` and must be trivially tweakable.

| Outcome | Weight | What happens |
|---|---|---|
| Intended action | 35% | Exactly the kick you asked for |
| Wrong foot | 18% | The other action fires instead (Shoot becomes Pass, Pass becomes Shoot) |
| Wild slice | 14% | Ball launched in a completely random direction at random power, full 360 degrees. Own goals very much on the table |
| Fumble | 12% | Boot connects but barely. Ball trickles a very short distance (roughly 10 to 25% of pass power) in a **random** direction. Possession is lost, ball is live |
| Whiff | 8% | Total air kick. Ball is not touched at all and does not move. Player stumbles in place for 300ms but keeps possession |
| Backheel | 8% | Medium-power kick directly behind the player's facing direction |
| Faceplant | 5% | Player falls over the ball, loses possession, stunned for 1 second. Ball stays put |

To be explicit, there are three separate "it went wrong" flavours and all three must exist:
- **Whiff**: ball goes nowhere, untouched.
- **Fumble**: ball goes somewhere useless, random direction, tiny power.
- **Wild slice**: ball goes somewhere random at real power.

Kick definitions:
- **Pass**: medium impulse (about 420) in the facing direction.
- **Shoot**: strong impulse (about 750) aimed at the centre of the opponent's goal, with small random angular spread.

Feedback: every outcome **other than the intended action** shows a floating text label above the player that fades over about 700ms ("WRONG FOOT!", "SLICED IT!", "FUMBLE!", "WHIFF!", "BACKHEEL?!", "TIMBER!"). Intended actions show nothing, so the label appearing is itself the joke.

## Goalkeepers

- Each goal has a keeper that tracks the ball's y position within the goal mouth at a capped speed. The ball bounces off it.
- Keepers are drunk too: every 2 to 4 seconds a keeper freezes for 0.5 to 1 second. That freeze is the scoring window.
- If keepers cause trouble in open play, ship without them and narrow the goal mouths to about 110px. Keepers are still required for the shootout.

## Scoring and match flow

- A goal is scored when the ball fully crosses the line inside a goal mouth. On a goal: "GOAL!" text, brief pause, then kickoff reset (ball to centre spot, players to fixed positions in their own halves, keepers recentred).
- HUD: score and countdown timer.
- **Match length: 3 minutes (180 seconds)**, in `CONFIG`.
- If the scores are **level at full time, go straight to the penalty shootout**. No golden goal, no extra time.

## Penalty shootout

Entered only on a level score at full time. This is the tiebreak and it should feel like the most unfair thing in the game.

- Standard format: **5 penalties each**, alternating, best of five. If still level after five, sudden death pairs until someone misses and the other scores.
- Each penalty is a single key press by the taker: **Pass or Shoot**. That is the entire input. No movement, no aiming.
- The keeper dives to a randomly chosen third (left, centre, right) at the moment of the kick, chosen independently of the shot.
- Roll the taker's press against a **separate penalty outcome table** in `CONFIG`. The taker's own intent barely matters, which is the point:

| Outcome | Weight | Result |
|---|---|---|
| Clean strike | 30% | Ball goes to a random third of the goal at full power. Scores unless the keeper dove that way |
| Swapped | 25% | The other action fires. Pass becomes a proper shot (usually a goal), Shoot becomes a limp pass that dribbles wide (miss) |
| Skied | 15% | Ball goes over the bar. Miss |
| Fumble | 15% | Barely connects, rolls gently at the keeper. Miss unless the keeper is frozen |
| Slice | 10% | Wide of the post. Miss |
| Faceplant | 5% | Taker falls over. Miss, no contact with the ball |

- Keeper freezes apply here too. A frozen keeper cannot dive, which turns fumbles and weak efforts into goals.
- Show the running shootout tally (scored, missed, still to take) and a result label per kick.
- Winner goes to FullTimeScene with the score shown as "2 - 2 (4 - 3 on penalties)".

## Bot mode

The bot controls Blue with **exactly the same abilities and the same drunk tables**. It never cheats. It presses virtual buttons that go through the identical outcome roll, in open play and in the shootout.

- Without possession: chase the ball.
- With possession: run toward Red's goal. Past roughly 60% of pitch width, press Shoot. If Red is closing in, occasionally press Pass to bounce off a wall.
- 150 to 250ms reaction delay and a little aim wobble so a human can beat it.
- In the shootout the bot picks Pass or Shoot at random and rolls the same table.
- The bot faceplanting or slicing into its own net is a feature. Do not shield it from the drunk table.

## Definition of done

- vs Bot is fully playable end to end: 3 minute match, goals, kickoff resets, shootout on a draw, full-time result.
- Two players on one keyboard can play the same match with the same rules.
- Every Pass/Shoot press in open play and in the shootout goes through its weighted table, with a floating label whenever the roll betrays the player.
- All three failure flavours (whiff, fumble, wild slice) are distinguishable in play.
- Runs from a static server, no external assets, no build step, no console errors.
- All tuning values live in `CONFIG`.
- Rendering is separated from game logic well enough that a design pass can replace it without rewriting mechanics.

## Stretch goals (not in v1)

- 2v2 with a drunk AI teammate, so Pass has a real target.
- Beer pickups that raise the drunk weights for whoever collects them.
- Movement sway (slow sine drift on velocity) behind a `CONFIG` toggle.
- Gamepad support, sound, replays of own goals.
