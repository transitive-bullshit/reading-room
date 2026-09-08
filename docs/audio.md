# Reading-room audio

Recorded book impacts provide physical feedback while a subdued background recording supports the room. [design.md](design.md) describes the experience, [physics.md](physics.md) describes movement, and [assets.md](assets.md) records asset provenance and retention.

## Controls and lifetime

Audio is the master toggle. Ambient separately controls the background recording and retains its preference while Audio is muted. Both default to enabled. Unlock the browser audio context from a user gesture such as Replay.

[room-audio.ts](../app/prototypes/reading-room/room-audio.ts) owns one persistent engine across replay and grouping changes. Load and decode recordings outside the impact callback. The callback uses ready buffers; it does not fetch audio or replay an old collision after loading finishes. Dispose requests, voices, nodes, and the audio context with the scene's audio owner.

The ambient source is the supplied `background.mp3`, edited into a five-minute stereo loop with an eight-second boundary crossfade. The served [background loop](../public/audio/background-loop.mp3) is 2.4 MB at 64 kbps and 24 kHz, about 80% smaller than the source. Web Audio loops the decoded buffer without timer-driven restarts. Its level was reduced to 20% of the earlier ambient gain so book sounds remain distinct.

## Recorded effects and contact detection

The user selected 22 clips from [Stacking Books Sound Effect](https://www.youtube.com/watch?v=5Fi-wrbNe-0) by ftus sound effects: 19 table recordings and three quiet book-contact recordings. [The retained source manifest](../public/audio/book-impacts/source.json) includes source intervals, processing, and hashes. The served clips are attack-aligned mono 24 kHz WAVs with short entry and exit fades. Preserve the recordings' character while varying impact strength, stereo position, and pitch subtly.

[physics-impacts.ts](../app/prototypes/reading-room/variants/physics-impacts.ts) records linear and angular velocities before each physics step. After solving contacts, it combines incoming relative velocity at the contact point with the solved impulse. This preserves a landing's incoming speed even when the solver has stopped the book. Sleeping pairs, support forces, and gentle sliding remain quiet.

Contact filtering emits at most two strongest impacts per 45 ms burst, with a 150 ms cooldown per pair. Table and book contacts draw from separate shuffle bags. A sample bag advances only when a sound is admitted to playback.

## Voice budget

The shared limit is six simultaneous effects, including at most two quiet book contacts. Book admission leaves one slot available for a table landing. Existing recordings finish normally; excess contacts are skipped. Use the audio clock and playback rate to reclaim finished voices even when a busy frame delays `onended`.

Each eligible book contact has a 25% chance to proceed to voice admission and uses a gain multiplier of 0.16. That is a further 36% amplitude reduction, about 3.9 dB, from the profiled baseline of 0.25. Table gain is unchanged. These limits keep frequent small contacts subordinate to clear table landings.

The six-effect budget is `floor(11 × 0.6)`: 60% of the observed combined peak, rounded down. The earlier separate limits allowed eight table and four book effects.

## Profiling reference

The 8 September 2026 profile used the production 25- and 86-book collections, Rapier contacts, contact filtering, and selected recordings. Drops ran for 12 seconds. Each drag scenario made six brisk scripted drags through a settled heap over 18 seconds; the larger case included two normal off-table recoveries. Contacts were replayed through the audio engine 30 times with seeded sample draws. Recording duration and playback rate determined voice lifetimes.

Counts below exclude Ambient. Median and 95th percentile cover time with at least one active effect, excluding silence.

| Scenario | Previous median / P95 / peak | Current median / P95 / peak |
| --- | --: | --: |
| The Pile: initial drop | 6 / 11 / 11 | 3 / 6 / 6 |
| The Big Pile: initial drop | 4 / 8 / 9 | 3 / 5 / 6 |
| The Pile: six drags | 4 / 7 / 10 | 2 / 5 / 6 |
| The Big Pile: six drags | 4 / 7 / 10 | 2 / 5 / 6 |

These representative distributions explain the budget; the six-voice cap is enforced for every interaction. [profile-book-impacts.ts](../scripts/profile-book-impacts.ts) recreates contact traces. The [contact tests](../tests/reading-room-impacts.test.ts) cover landings, airborne collisions, and quiet supported stacks; the [audio tests](../tests/reading-room-audio.test.ts) cover playback and admission behavior. Reassess drop and drag overlap when changing recordings, filtering, or voice limits.
