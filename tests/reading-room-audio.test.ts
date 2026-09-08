import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { BOOK_IMPACT_SAMPLES } from '../app/prototypes/reading-room/book-impact-samples'
import { createRoomAudio } from '../app/prototypes/reading-room/room-audio'

class Param {
  value = 0
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value
  }
  setTargetAtTime(value: number) {
    this.value = value
  }
}

class AudioNodeDouble {
  gain = new Param()
  pan = new Param()
  playbackRate = new Param()
  buffer: { url?: string; duration?: number } | null = null
  loop = false
  starts = 0
  stops = 0
  disconnections = 0
  onended: (() => void) | null = null
  connections: AudioNodeDouble[] = []
  connect(node: AudioNodeDouble) {
    this.connections.push(node)
    return node
  }
  disconnect() {
    this.disconnections++
  }
  start() {
    this.starts++
  }
  stop() {
    this.stops++
  }
}

function replaceGlobal(t: TestContext, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, key, previous)
    else Reflect.deleteProperty(globalThis, key)
  })
}

function audioEnvironment(t: TestContext, deferImpacts = false) {
  const contexts: Context[] = []
  let finishDecode: ((value: unknown) => void) | undefined
  const finishImpacts: (() => void)[] = []
  class Context {
    state = 'running'
    currentTime = 1
    sampleRate = 24_000
    destination = new AudioNodeDouble()
    gains: AudioNodeDouble[] = []
    sources: AudioNodeDouble[] = []
    closed = false
    constructor() {
      contexts.push(this)
    }
    createGain() {
      const node = new AudioNodeDouble()
      this.gains.push(node)
      return node
    }
    createStereoPanner() {
      return new AudioNodeDouble()
    }
    createBufferSource() {
      const node = new AudioNodeDouble()
      this.sources.push(node)
      return node
    }
    async decodeAudioData(encoded: ArrayBuffer) {
      const buffer = { url: new TextDecoder().decode(encoded), duration: 0.8 }
      if (!deferImpacts) return buffer
      return new Promise((resolve) => {
        finishImpacts.push(() => resolve(buffer))
      })
    }
    async resume() {
      this.state = 'running'
    }
    async close() {
      this.closed = true
    }
  }
  class Decoder {
    constructor(_channels: number, _length: number, rate: number) {
      assert.equal(rate, 24_000, 'decode at the compact asset sample rate')
    }
    decodeAudioData() {
      return new Promise((resolve) => {
        finishDecode = resolve
      })
    }
  }
  replaceGlobal(t, 'window', { AudioContext: Context })
  replaceGlobal(t, 'OfflineAudioContext', Decoder)
  return {
    contexts,
    complete: () => finishDecode?.({ duration: 300 }),
    completeImpacts: () => finishImpacts.splice(0).forEach((finish) => finish())
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const sampleResponse = (url: string) => ({
  ok: true,
  arrayBuffer: async () => new TextEncoder().encode(url).buffer
})
const isImpact = (url: string) => url.startsWith('/audio/book-impacts/')

await test('recorded ambience loads once, loops, and remains independent of book sounds', async (t) => {
  const environment = audioEnvironment(t)
  let requests = 0
  replaceGlobal(t, 'fetch', async (url: string) => {
    if (isImpact(url)) return sampleResponse(url)
    assert.equal(url, '/audio/background-loop.mp3')
    requests++
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
  })
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  assert.equal(environment.contexts.length, 0)
  audio.setAmbientEnabled(false)
  await audio.unlock()
  assert.equal(requests, 0, 'muted music should not download until enabled')
  const context = environment.contexts[0]!
  audio.playImpact({ kind: 'table', strength: 0.8, pan: 0.3 })
  assert.equal(context.sources.length, 1, 'book effects work without music')
  assert.ok(
    BOOK_IMPACT_SAMPLES.table.includes(context.sources[0]!.buffer!.url!)
  )
  audio.setAmbientEnabled(true)
  await audio.unlock()
  await flush()
  assert.equal(requests, 1, 'overlapping gestures share one request')
  audio.setAmbientEnabled(false)
  environment.complete()
  await flush()
  const music = context.sources.find((source) => source.loop)!
  assert.ok(music)
  assert.equal(
    context.gains[1]!.gain.value,
    0,
    'muting during decode stays muted'
  )
  audio.setAudioEnabled(false)
  audio.setAmbientEnabled(true)
  assert.equal(context.gains[1]!.gain.value, 0.11)
  assert.equal(context.gains[0]!.gain.value, 0)
  audio.setAmbientEnabled(false)
  audio.setAmbientEnabled(true)
  assert.equal(music.starts, 1, 'toggles preserve the loop position')
  assert.equal(requests, 1)
  audio.dispose()
  assert.equal(music.stops, 1)
  assert.equal(music.buffer, null)
  assert.ok(context.closed)
})

await test('disposing while ambience decodes cannot start orphaned playback', async (t) => {
  const environment = audioEnvironment(t)
  let signal: AbortSignal | undefined
  replaceGlobal(
    t,
    'fetch',
    async (_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
    }
  )
  const audio = createRoomAudio()
  await audio.unlock()
  await flush()
  audio.dispose()
  environment.complete()
  await flush()
  assert.equal(signal?.aborted, true)
  assert.equal(environment.contexts[0]!.sources.length, 0)
  assert.equal(environment.contexts[0]!.closed, true)
})

await test('desk and book contacts use only their selected recordings, with balanced nonrepeating draws', async (t) => {
  const environment = audioEnvironment(t)
  replaceGlobal(t, 'fetch', async (url: string) => sampleResponse(url))
  // Reproducible randomness while testing many bag boundaries and interleaved kinds.
  let seed = 1729
  t.mock.method(Math, 'random', () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  })
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  const played = { table: [] as string[], book: [] as string[] }
  const gains = { table: [] as number[], book: [] as number[] }
  const rates = new Set<number>()
  let suppressed = 0
  for (let i = 0; i < 114; i++) {
    for (const kind of ['table', 'book'] as const) {
      const before = context.sources.length
      for (
        let attempt = 0;
        attempt < 100 && context.sources.length === before;
        attempt++
      ) {
        audio.playImpact({ kind, strength: 0.8, pan: 0.6 })
        if (context.sources.length === before) suppressed++
      }
      assert.equal(
        context.sources.length,
        before + 1,
        'eventually accept a draw without replaying the previous source'
      )
      const source = context.sources.at(-1)!
      const url = source.buffer!.url!
      assert.ok(BOOK_IMPACT_SAMPLES[kind].includes(url), `${kind} pool: ${url}`)
      assert.notEqual(
        url,
        played[kind].at(-1),
        'never repeat an adjacent take, including across bags'
      )
      played[kind].push(url)
      const gain = source.connections[0]!
      gains[kind].push(gain.gain.value)
      assert.ok(Math.abs(gain.connections[0]!.pan.value - 0.45) < 1e-9)
      assert.ok(
        source.playbackRate.value > 0.95 && source.playbackRate.value < 1.05
      )
      rates.add(source.playbackRate.value)
      source.onended?.()
    }
  }
  for (const kind of ['table', 'book'] as const) {
    const size = BOOK_IMPACT_SAMPLES[kind].length
    for (let offset = 0; offset < played[kind].length; offset += size) {
      assert.equal(
        new Set(played[kind].slice(offset, offset + size)).size,
        size,
        'every take gets played before the bag refills'
      )
    }
  }
  assert.ok(
    Math.max(...gains.book) < Math.min(...gains.table) * 0.2,
    'book contacts stay substantially softer even with volume variation'
  )
  assert.ok(rates.size > 100)
  assert.ok(new Set(gains.table).size > 100)
  assert.ok(
    suppressed > 0,
    'suppressed contacts must leave the take bag balanced'
  )
  const triples = new Set(
    Array.from({ length: 38 }, (_, i) =>
      played.book.slice(i * 3, i * 3 + 3).join()
    )
  )
  assert.ok(
    triples.size > 2,
    'the three quiet takes must not fall into a fixed repeating order'
  )
})

await test('impact loading is shared, retries only failures, and muted sounds do not download', async (t) => {
  const environment = audioEnvironment(t)
  t.mock.method(Math, 'random', () => 0)
  const requests = new Map<string, number>()
  const failed = BOOK_IMPACT_SAMPLES.book[0]!
  replaceGlobal(t, 'fetch', async (url: string) => {
    const count = (requests.get(url) ?? 0) + 1
    requests.set(url, count)
    return { ...sampleResponse(url), ok: url !== failed || count > 1 }
  })
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  audio.setAudioEnabled(false)
  await audio.unlock()
  assert.equal(requests.size, 0)
  audio.setAudioEnabled(true)
  await Promise.all([audio.unlock(), audio.unlock()])
  assert.equal(requests.size, 22)
  assert.ok([...requests.values()].every((count) => count === 1))
  const context = environment.contexts[0]!
  audio.playImpact({ kind: 'book', strength: 1, pan: 0 })
  assert.ok(
    context.sources.at(-1)?.buffer,
    'one failure cannot silence the loaded takes'
  )
  await audio.unlock()
  assert.equal(requests.get(failed), 2)
  assert.equal(
    [...requests.values()].reduce((sum, count) => sum + count),
    23
  )
  await audio.unlock()
  assert.equal(
    [...requests.values()].reduce((sum, count) => sum + count),
    23
  )
})

await test('impact strength, voice limits, and muting keep a busy pile controlled', async (t) => {
  const environment = audioEnvironment(t)
  t.mock.method(Math, 'random', () => 0)
  replaceGlobal(t, 'fetch', async (url: string) => sampleResponse(url))
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  audio.playImpact({ kind: 'table', strength: 0.03, pan: -2 })
  const soft = context.sources.at(-1)!
  const softLevel = soft.connections[0]!.gain.value
  assert.equal(soft.connections[0]!.connections[0]!.pan.value, -0.75)
  soft.onended?.()
  audio.playImpact({ kind: 'table', strength: 1, pan: 2 })
  const hard = context.sources.at(-1)!
  assert.ok(hard.connections[0]!.gain.value > softLevel * 4)
  hard.onended?.()
  const beforeBurst = context.sources.length
  for (let i = 0; i < 20; i++)
    audio.playImpact({ kind: 'book', strength: 1, pan: 0 })
  assert.equal(context.sources.length - beforeBurst, 2)
  assert.ok(
    Math.abs(
      context.sources.at(-1)!.connections[0]!.gain.value /
        hard.connections[0]!.gain.value -
        0.16
    ) < 1e-12,
    'book playback has 16% of the same-strength table gain'
  )
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(
    context.sources.length - beforeBurst,
    3,
    'book chatter cannot crowd out a desk landing'
  )
  for (let i = 0; i < 20; i++)
    audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(
    context.sources.length - beforeBurst,
    6,
    'table and book voices share one six-effect ceiling'
  )
  assert.ok(
    context.sources.every((source) => source.stops === 0),
    'a full mix does not cut off an existing recording'
  )
  audio.setAudioEnabled(false)
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(context.sources.length - beforeBurst, 6)
  assert.equal(context.gains[0]!.gain.value, 0)
  audio.dispose()
  assert.ok(context.closed)
  assert.ok(context.sources.every((source) => source.buffer === null))
})

await test('exactly the lowest quarter of book-contact rolls play while table landings bypass thinning', async (t) => {
  const environment = audioEnvironment(t)
  replaceGlobal(t, 'fetch', async (url: string) => sampleResponse(url))
  let roll = 0
  t.mock.method(Math, 'random', () => roll)
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  const accepted: number[] = []
  for (let percent = 0; percent < 100; percent++) {
    roll = percent / 100
    const before = context.sources.length
    audio.playImpact({ kind: 'book', strength: 0.8, pan: 0 })
    if (context.sources.length > before) {
      accepted.push(percent)
      context.sources.at(-1)!.onended?.()
    }
    const beforeTable = context.sources.length
    audio.playImpact({ kind: 'table', strength: 0.8, pan: 0 })
    assert.equal(
      context.sources.length,
      beforeTable + 1,
      'table playback does not use the book probability gate'
    )
    context.sources.at(-1)!.onended?.()
  }
  assert.deepEqual(
    accepted,
    Array.from({ length: 25 }, (_, index) => index)
  )
  roll = 0.249999
  const beforeBoundary = context.sources.length
  audio.playImpact({ kind: 'book', strength: 0.8, pan: 0 })
  assert.equal(context.sources.length, beforeBoundary + 1)
  context.sources.at(-1)!.onended?.()
  roll = 0.25
  audio.playImpact({ kind: 'book', strength: 0.8, pan: 0 })
  assert.equal(
    context.sources.length,
    beforeBoundary + 1,
    'the 25% boundary itself is suppressed'
  )
})

await test('book contacts reserve the last mix slot for a table landing and ended voices release capacity', async (t) => {
  const environment = audioEnvironment(t)
  replaceGlobal(t, 'fetch', async (url: string) => sampleResponse(url))
  t.mock.method(Math, 'random', () => 0)
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  const play = (kind: 'table' | 'book') =>
    audio.playImpact({ kind, strength: 0.8, pan: 0 })
  for (let i = 0; i < 4; i++) play('table')
  play('book')
  assert.equal(context.sources.length, 5)
  play('book')
  assert.equal(
    context.sources.length,
    5,
    'even the second book voice leaves slot six available for a landing'
  )
  play('table')
  assert.equal(context.sources.length, 6)
  play('table')
  play('book')
  assert.equal(context.sources.length, 6)
  const endedTable = context.sources[0]!
  endedTable.onended?.()
  assert.equal(endedTable.buffer, null)
  assert.ok(endedTable.disconnections > 0)
  play('book')
  assert.equal(
    context.sources.length,
    6,
    'five remaining voices still reserve the table slot'
  )
  play('table')
  assert.equal(
    context.sources.length,
    7,
    'a completed source immediately makes room for a new landing'
  )
  context.sources[1]!.onended?.()
  context.sources[2]!.onended?.()
  play('book')
  assert.equal(
    context.sources.length,
    8,
    'two free mix slots permit the second book voice'
  )
  play('book')
  assert.equal(
    context.sources.length,
    8,
    'the book sublimit still applies after mixed voices finish'
  )
  assert.ok(context.sources.every((source) => source.stops === 0))
})

await test('the audio clock reclaims finished recordings when onended is delayed without expiring them early', async (t) => {
  const environment = audioEnvironment(t)
  replaceGlobal(t, 'fetch', async (url: string) => sampleResponse(url))
  t.mock.method(Math, 'random', () => 0)
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAmbientEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  const play = () => audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  const startedAt = context.currentTime
  for (let i = 0; i < 6; i++) play()
  const firstGeneration = context.sources.slice()
  const delayedCallbacks = firstGeneration.map((source) => source.onended!)
  const duration =
    firstGeneration[0]!.buffer!.duration! /
    firstGeneration[0]!.playbackRate.value
  context.currentTime = startedAt + duration - 0.000001
  play()
  assert.equal(
    context.sources.length,
    6,
    'recordings occupy their slots until their rate-adjusted duration ends'
  )
  assert.ok(firstGeneration.every((source) => source.buffer !== null))
  context.currentTime = startedAt + duration + 0.000001
  for (let i = 0; i < 6; i++) play()
  assert.equal(
    context.sources.length,
    12,
    'audio-clock expiry frees all six slots without waiting for browser callbacks'
  )
  assert.ok(
    firstGeneration.every(
      (source) =>
        source.buffer === null &&
        source.onended === null &&
        source.disconnections > 0
    )
  )
  for (const callback of delayedCallbacks) callback()
  play()
  assert.equal(
    context.sources.length,
    12,
    'late callbacks from the old generation cannot remove active replacement voices'
  )
  assert.ok(context.sources.slice(6).every((source) => source.buffer !== null))
  assert.ok(
    context.sources.every((source) => source.stops === 0),
    'reclaiming completed voices never truncates another sound'
  )
  const delayedAfterDispose = context.sources.at(-1)!.onended!
  audio.dispose()
  assert.doesNotThrow(delayedAfterDispose)
  assert.ok(
    context.sources.every(
      (source) => source.buffer === null && source.onended === null
    )
  )
  play()
  assert.equal(context.sources.length, 12)
})

await test('disposing during sample decode never plays delayed impacts or repopulates a closed graph', async (t) => {
  const environment = audioEnvironment(t, true)
  const signals: AbortSignal[] = []
  replaceGlobal(
    t,
    'fetch',
    async (url: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal)
      return sampleResponse(url)
    }
  )
  const audio = createRoomAudio()
  audio.setAmbientEnabled(false)
  const unlocking = audio.unlock()
  await flush()
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(environment.contexts[0]!.sources.length, 0)
  audio.dispose()
  environment.completeImpacts()
  await unlocking
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.ok(signals.every((signal) => signal.aborted))
  assert.equal(environment.contexts[0]!.sources.length, 0)
  assert.ok(environment.contexts[0]!.closed)
})

await test('Audio is a master mute and preserves the separate Ambient preference', async (t) => {
  const environment = audioEnvironment(t)
  let requests = 0
  replaceGlobal(t, 'fetch', async (url: string) => {
    requests++
    return sampleResponse(url)
  })
  const audio = createRoomAudio()
  t.after(() => audio.dispose())
  audio.setAudioEnabled(false)
  await audio.unlock()
  const context = environment.contexts[0]!
  const [master, ambient, effects] = context.gains
  assert.equal(requests, 0, 'master-off should not load either audio channel')
  assert.equal(master!.gain.value, 0)
  assert.ok(ambient!.connections.includes(master!))
  assert.ok(effects!.connections.includes(master!))
  audio.setAmbientEnabled(false)
  audio.setAmbientEnabled(true)
  assert.equal(requests, 0, 'Ambient cannot bypass the master mute')
  audio.setAudioEnabled(true)
  await audio.unlock()
  await flush()
  environment.complete()
  await flush()
  const loop = context.sources.find((source) => source.loop)!
  assert.ok(loop.connections.includes(ambient!))
  assert.ok(
    Math.abs(ambient!.gain.value - 0.55 * 0.2) < 1e-12,
    'ambience is 20% of its previous gain'
  )
  assert.equal(master!.gain.value, 0.8)
  audio.setAudioEnabled(false)
  assert.equal(master!.gain.value, 0, 'both connected channels are silenced')
  const sourceCount = context.sources.length
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(context.sources.length, sourceCount)
  audio.setAmbientEnabled(false)
  audio.setAudioEnabled(true)
  assert.equal(master!.gain.value, 0.8)
  assert.equal(ambient!.gain.value, 0, 'restoring Audio remembers Ambient off')
  audio.playImpact({ kind: 'table', strength: 1, pan: 0 })
  assert.equal(context.sources.length, sourceCount + 1)
  assert.equal(loop.starts, 1, 'master toggles do not restart the ambient loop')
})
