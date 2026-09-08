import { BOOK_IMPACT_SAMPLES } from './book-impact-samples'

export type BookImpact = {
  kind: 'table' | 'book'
  strength: number
  pan: number
}

export type RoomAudio = {
  prepare: () => Promise<void>
  unlock: () => Promise<void>
  setAudioEnabled: (enabled: boolean) => void
  setAmbientEnabled: (enabled: boolean) => void
  playImpact: (impact: BookImpact) => void
  dispose: () => void
}

type Voice = {
  source: AudioBufferSourceNode
  nodes: AudioNode[]
  kind: BookImpact['kind']
  endsAt: number
}

type AudioGraph = {
  context: AudioContext
  master: GainNode
  musicBuffer?: AudioBuffer
  musicSource?: AudioBufferSourceNode
  musicGain: GainNode
  soundGain: GainNode
  nodes: AudioNode[]
  buffers: Map<string, AudioBuffer>
  voices: Set<Voice>
}

const MUSIC_URL = '/audio/background-loop.mp3'
const MUSIC_SAMPLE_RATE = 24_000
const MUSIC_LEVEL = 0.11
const MASTER_LEVEL = 0.8
const SOUND_LEVEL = 0.7
// Drop/drag profiling peaked at 11 overlapping effects; use 60%, rounded down.
const MAX_IMPACT_VOICES = 6
const MAX_BOOK_VOICES = 2
const BOOK_IMPACT_CHANCE = 0.8
const BOOK_IMPACT_LEVEL = 0.16
const AUDIO_READY_TIMEOUT_MS = 4000

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))

function finishVoice(graph: AudioGraph, voice: Voice) {
  voice.source.onended = null
  for (const node of voice.nodes) node.disconnect()
  voice.source.buffer = null
  graph.voices.delete(voice)
}

function playBuffer(
  graph: AudioGraph,
  buffer: AudioBuffer,
  kind: BookImpact['kind'],
  time: number,
  level: number,
  pan = 0,
  rate = 1
) {
  const source = graph.context.createBufferSource()
  const gain = graph.context.createGain()
  const panner = graph.context.createStereoPanner()
  source.buffer = buffer
  source.playbackRate.value = rate
  gain.gain.value = level
  panner.pan.value = pan
  source.connect(gain).connect(panner)
  panner.connect(graph.soundGain)
  const voice: Voice = {
    source,
    nodes: [source, gain, panner],
    kind,
    endsAt: time + buffer.duration / rate
  }
  graph.voices.add(voice)
  source.onended = () => finishVoice(graph, voice)
  source.start(time)
}

function createGraph(context: AudioContext): AudioGraph {
  const master = context.createGain()
  const musicGain = context.createGain()
  const soundGain = context.createGain()
  const nodes: AudioNode[] = [master, musicGain, soundGain]
  master.gain.value = MASTER_LEVEL
  musicGain.gain.value = 0
  soundGain.gain.value = SOUND_LEVEL
  musicGain.connect(master)
  soundGain.connect(master)
  master.connect(context.destination)

  return {
    context,
    master,
    musicGain,
    soundGain,
    nodes,
    buffers: new Map(),
    voices: new Set()
  }
}

function setLevel(
  param: AudioParam,
  level: number,
  time: number,
  fade: number
) {
  param.cancelScheduledValues(time)
  param.setTargetAtTime(level, time, fade)
}

/** Prepare silently on mount; call unlock directly from the entry gesture. */
export function createRoomAudio(): RoomAudio {
  let graph: AudioGraph | undefined
  let disposed = false
  let entered = false
  let audioEnabled = true
  let ambientEnabled = true
  let musicLoading: Promise<void> | undefined
  let impactsLoading: Promise<void> | undefined
  let unlocking: Promise<void> | undefined
  const audioRequest = new AbortController()
  const remaining = {
    table: [] as string[],
    book: [] as string[]
  }
  const recent = { table: [] as string[], book: [] as string[] }

  function ensureGraph() {
    if (disposed || typeof window === 'undefined') return
    if (graph) return graph
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioContextClass) return
    let context: AudioContext | undefined
    try {
      context = new AudioContextClass({ latencyHint: 'interactive' })
      graph = createGraph(context)
      graph.master.gain.value = audioEnabled ? MASTER_LEVEL : 0
      return graph
    } catch {
      void context?.close().catch(() => {})
    }
  }

  function waitForAudio(pending: Promise<unknown>) {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        audioRequest.signal.removeEventListener('abort', aborted)
        complete()
      }
      const aborted = () =>
        finish(() => reject(new Error('Audio owner disposed')))
      const timer = setTimeout(
        () => finish(() => reject(new Error('Audio readiness timed out'))),
        AUDIO_READY_TIMEOUT_MS
      )
      audioRequest.signal.addEventListener('abort', aborted, { once: true })
      if (audioRequest.signal.aborted) aborted()
      pending.then(
        () => finish(resolve),
        (err: unknown) => finish(() => reject(err))
      )
    })
  }

  function nextImpactBuffer(kind: BookImpact['kind']) {
    if (!graph) return
    const currentGraph = graph
    const available = BOOK_IMPACT_SAMPLES[kind].filter((url) =>
      currentGraph.buffers.has(url)
    )
    if (!available.length) return
    if (!remaining[kind].length) remaining[kind] = [...available]
    const bag = remaining[kind]
    // Draw without replacement. Avoid recent takes across bag boundaries too;
    // desk/book draws have independent histories even when collisions interleave.
    let choices = bag.filter((url) => !recent[kind].includes(url))
    if (!choices.length)
      choices = bag.filter((url) => url !== recent[kind].at(-1))
    if (!choices.length) choices = bag
    const url = choices[Math.floor(Math.random() * choices.length)]!
    bag.splice(bag.indexOf(url), 1)
    recent[kind].push(url)
    const memory = Math.min(kind === 'table' ? 2 : 1, available.length - 1)
    recent[kind] = memory ? recent[kind].slice(-memory) : []
    return graph.buffers.get(url)
  }

  function loadImpacts(): Promise<void> {
    if (!graph || disposed || !audioEnabled) return Promise.resolve()
    if (impactsLoading) return impactsLoading
    const currentGraph = graph
    const missing = Object.values(BOOK_IMPACT_SAMPLES)
      .flat()
      .filter((url) => !currentGraph.buffers.has(url))
    if (!missing.length) return Promise.resolve()
    const request = new AbortController()
    const { signal } = request
    impactsLoading = waitForAudio(
      Promise.allSettled(
        missing.map(async (url) => {
          const response = await fetch(url, { signal })
          if (!response.ok) throw new Error('Book sound unavailable')
          const encoded = await response.arrayBuffer()
          if (disposed || signal.aborted) return
          const buffer = await currentGraph.context.decodeAudioData(encoded)
          if (!disposed && !signal.aborted && graph === currentGraph)
            currentGraph.buffers.set(url, buffer)
        })
      )
    )
      .catch(() => {
        // Keep ready takes when a network or decoder stalls; entry can continue.
      })
      .finally(() => {
        request.abort()
        // Retry only missing takes on a later explicit request. Collisions never
        // fetch, decode, or replay stale hits after loading eventually finishes.
        impactsLoading = undefined
      })
    return impactsLoading
  }

  function startMusic() {
    if (
      !graph ||
      disposed ||
      !entered ||
      !graph.musicBuffer ||
      graph.musicSource ||
      graph.context.state !== 'running'
    )
      return
    const currentGraph = graph
    const source = currentGraph.context.createBufferSource()
    source.buffer = currentGraph.musicBuffer!
    // The file contains the crossfade. Web Audio loops it sample-accurately,
    // without a media-element restart or a timer that background tabs throttle.
    source.loop = true
    source.connect(currentGraph.musicGain)
    currentGraph.musicSource = source
    const now = currentGraph.context.currentTime
    currentGraph.musicGain.gain.cancelScheduledValues(now)
    currentGraph.musicGain.gain.setValueAtTime(0, now)
    currentGraph.musicGain.gain.setTargetAtTime(
      ambientEnabled ? MUSIC_LEVEL : 0,
      now,
      0.3
    )
    source.start()
  }

  function loadMusic(): Promise<void> {
    if (!graph || disposed || !audioEnabled || !ambientEnabled)
      return Promise.resolve()
    if (musicLoading) return musicLoading
    if (graph.musicBuffer) {
      startMusic()
      return Promise.resolve()
    }
    const currentGraph = graph
    const request = new AbortController()
    const { signal } = request
    musicLoading = waitForAudio(
      (async () => {
        const response = await fetch(MUSIC_URL, { signal })
        if (!response.ok) throw new Error('Background audio unavailable')
        const encoded = await response.arrayBuffer()
        if (disposed || signal.aborted) return
        // Decode silently at the asset's sample rate before the entry gesture.
        // The audio graph resamples the prepared buffer during playback.
        const decoder = new OfflineAudioContext(2, 1, MUSIC_SAMPLE_RATE)
        const buffer = await decoder.decodeAudioData(encoded)
        if (!disposed && !signal.aborted && graph === currentGraph)
          currentGraph.musicBuffer = buffer
      })()
    )
      .then(startMusic)
      .catch(() => {
        // A missing or stalled track cannot block entry. An explicit gesture
        // can retry; an abandoned decode cannot start delayed playback.
      })
      .finally(() => {
        request.abort()
        musicLoading = undefined
      })
    return musicLoading
  }

  return {
    prepare() {
      if (!ensureGraph()) return Promise.resolve()
      return Promise.all([loadImpacts(), loadMusic()]).then(() => {})
    },

    unlock() {
      const currentGraph = ensureGraph()
      if (!currentGraph) return Promise.resolve()
      if (unlocking) return unlocking
      let resumed: Promise<void>
      try {
        // Keep resume in the entry click's call stack, before any loading await.
        resumed =
          currentGraph.context.state === 'running'
            ? Promise.resolve()
            : currentGraph.context.resume()
      } catch {
        return Promise.resolve()
      }
      unlocking = Promise.all([
        waitForAudio(resumed),
        loadImpacts(),
        loadMusic()
      ])
        .then(() => {
          if (
            disposed ||
            currentGraph !== graph ||
            currentGraph.context.state !== 'running'
          )
            return
          entered = true
          setLevel(
            currentGraph.musicGain.gain,
            ambientEnabled ? MUSIC_LEVEL : 0,
            currentGraph.context.currentTime,
            0.3
          )
          startMusic()
        })
        .catch(() => {
          // A blocked context must not prevent entry; an explicit retry is safe.
        })
        .finally(() => {
          unlocking = undefined
        })
      return unlocking
    },

    setAudioEnabled(enabled) {
      audioEnabled = enabled
      if (!graph || disposed) return
      setLevel(
        graph.master.gain,
        enabled ? MASTER_LEVEL : 0,
        graph.context.currentTime,
        0.025
      )
      if (enabled) {
        void loadImpacts()
        void loadMusic()
      }
    },

    setAmbientEnabled(enabled) {
      ambientEnabled = enabled
      if (!graph || disposed) return
      setLevel(
        graph.musicGain.gain,
        enabled ? MUSIC_LEVEL : 0,
        graph.context.currentTime,
        enabled ? 0.2 : 0.04
      )
      if (enabled) void loadMusic()
    },

    playImpact({ kind, strength, pan }) {
      if (
        !graph ||
        disposed ||
        !entered ||
        !audioEnabled ||
        graph.context.state !== 'running'
      )
        return
      const amount = clamp(strength, 0, 1)
      if (amount < 0.025) return
      // Thin quiet contacts before drawing a take, preserving the shuffle bag.
      if (kind === 'book' && Math.random() >= BOOK_IMPACT_CHANCE) return
      const now = graph.context.currentTime
      let bookVoices = 0
      for (const voice of graph.voices) {
        // The audio clock stays accurate when a busy frame delays onended.
        if (voice.endsAt <= now) finishVoice(graph, voice)
        else if (voice.kind === 'book') bookVoices++
      }
      if (graph.voices.size >= MAX_IMPACT_VOICES) return
      // Keep quiet contacts sparse and leave a slot for a clear table landing.
      if (
        kind === 'book' &&
        (bookVoices >= MAX_BOOK_VOICES ||
          graph.voices.size >= MAX_IMPACT_VOICES - 1)
      )
        return
      const buffer = nextImpactBuffer(kind)
      if (!buffer) return
      playBuffer(
        graph,
        buffer,
        kind,
        now,
        (0.035 + 0.2 * amount ** 0.8) *
          (kind === 'book' ? BOOK_IMPACT_LEVEL : 1) *
          (0.9 + Math.random() * 0.2),
        clamp(pan, -1, 1) * 0.75,
        // A little extra weight on harder hits, plus less than a semitone of
        // random pitch either way, keeps the recording's character intact.
        2 ** (((0.5 - amount) * 0.35 + Math.random() * 1.2 - 0.6) / 12)
      )
    },

    dispose() {
      if (disposed) return
      disposed = true
      audioRequest.abort()
      if (!graph) return
      graph.musicSource?.stop()
      graph.musicSource?.disconnect()
      if (graph.musicSource) graph.musicSource.buffer = null
      graph.musicBuffer = undefined
      for (const voice of graph.voices) {
        voice.source.onended = null
        voice.source.stop()
        voice.source.buffer = null
        for (const node of voice.nodes) node.disconnect()
      }
      for (const node of graph.nodes) node.disconnect()
      graph.voices.clear()
      graph.buffers.clear()
      void graph.context.close().catch(() => {})
      graph = undefined
    }
  }
}
