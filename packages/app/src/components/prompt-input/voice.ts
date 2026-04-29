// Voice transcription helpers for the prompt input.
//
// Uses the browser MediaRecorder + Web Audio AnalyserNode to capture mic
// audio and report a per-frame loudness level for the voice-meter UI.
// On stop, the recorded audio is POSTed to the codeplane /global/transcribe
// route which proxies it to an OpenAI-compatible /v1/audio/transcriptions
// endpoint configured server-side.

export type VoiceLevel = (level: number) => void

export interface VoiceRecording {
  /** Stop recording, transcribe, and resolve with the resulting text. */
  finish(): Promise<string>
  /** Stop recording without transcribing. */
  cancel(): void
}

const DEFAULT_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
]

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  for (const mime of DEFAULT_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {}
  }
  return undefined
}

export function isVoiceSupported(): boolean {
  if (typeof navigator === "undefined") return false
  if (!navigator.mediaDevices?.getUserMedia) return false
  if (typeof MediaRecorder === "undefined") return false
  if (typeof window === "undefined" || !(window.AudioContext || (window as any).webkitAudioContext)) return false
  return true
}

export interface StartOptions {
  /** Receives a 0..1 loudness value at ~60Hz while recording. */
  onLevel?: VoiceLevel
  /** Optional language hint, e.g. "en" or "de". */
  language?: string
  /** Optional prior context shown to the transcription model. */
  prompt?: string
  /** Endpoint to POST the recorded audio to. Default '/global/transcribe'. */
  endpoint?: string
  /** Custom fetch (e.g. the platform-provided one used by the global SDK). */
  fetch?: typeof fetch
  /** Forwarded to fetch() so platform-specific request shaping works. */
  fetchInit?: RequestInit
}

export async function startVoiceRecording(opts: StartOptions = {}): Promise<VoiceRecording> {
  if (!isVoiceSupported()) {
    throw new Error("Voice recording is not supported in this browser.")
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const audioCtx: AudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.65
  source.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)

  let levelRaf: number | null = null
  let stopped = false
  const tick = () => {
    if (stopped) return
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / buf.length)
    // Map 0..~0.4 RMS to 0..1, with a soft ceiling
    const level = Math.min(1, rms * 2.6)
    opts.onLevel?.(level)
    levelRaf = requestAnimationFrame(tick)
  }
  levelRaf = requestAnimationFrame(tick)

  const mime = pickMime()
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }
  const stoppedPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start(500)

  const stopAll = () => {
    stopped = true
    if (levelRaf !== null) cancelAnimationFrame(levelRaf)
    levelRaf = null
    try {
      if (recorder.state !== "inactive") recorder.stop()
    } catch {}
    for (const track of stream.getTracks()) {
      try { track.stop() } catch {}
    }
    void audioCtx.close().catch(() => {})
  }

  return {
    async finish() {
      try {
        if (recorder.state !== "inactive") recorder.stop()
      } catch {}
      await stoppedPromise
      stopAll()

      if (chunks.length === 0) return ""
      const blob = new Blob(chunks, { type: chunks[0]?.type || mime || "audio/webm" })
      // Ignore very short recordings (likely mistaps).
      if (blob.size < 1500) return ""

      const filename = blob.type.includes("ogg")
        ? "voice.ogg"
        : blob.type.includes("mp4")
          ? "voice.m4a"
          : blob.type.includes("mpeg")
            ? "voice.mp3"
            : "voice.webm"

      const form = new FormData()
      form.set("file", new File([blob], filename, { type: blob.type || "audio/webm" }))
      if (opts.language) form.set("language", opts.language)
      if (opts.prompt) form.set("prompt", opts.prompt)

      const fetcher = opts.fetch ?? fetch
      const endpoint = opts.endpoint ?? "/global/transcribe"
      const res = await fetcher(endpoint, {
        ...(opts.fetchInit ?? {}),
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 300)}`)
      }
      const json = (await res.json().catch(() => null)) as { text?: string } | null
      return (json?.text ?? "").trim()
    },
    cancel() {
      stopAll()
    },
  }
}

/** Play a soft "sent" tone via Web Audio. No external assets needed. */
export function playSendChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx: AudioContext = new Ctx()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.24)
    osc.onended = () => {
      void ctx.close().catch(() => {})
    }
  } catch {
    // ignore — sound is non-critical
  }
}
