import { LoaderCircle, Mic, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { downsampleToMono16k, encodePcm16Wav, wavToBase64, MAX_ASR_SECONDS } from "./asr-audio";

interface AsrRecorderCallbacks {
  disabled?: boolean;
  onText: (text: string) => void;
  onSendText: (text: string) => void;
  onError: (message: string) => void;
}

export interface AsrRecorderSession {
  active: boolean;
  recording: boolean;
  busy: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  start: () => Promise<void>;
  stop: (send?: boolean) => void;
  cancel: () => void;
}

export function shouldAnimateWaveform(recording: boolean, busy: boolean, reducedMotion: boolean): boolean {
  return recording && !busy && !reducedMotion;
}

/**
 * Map analyser RMS into 0–1 bar height for monitoring.
 * Soft linear scale so quiet/normal/loud stay visually distinct.
 */
export function mapAsrAnalyserRmsToLevel(rawRms: number): number {
  if (!Number.isFinite(rawRms) || rawRms <= 0) return 0;
  return Math.min(1, rawRms * 8);
}

export function resolveAsrErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function reportAsrError(onError: (message: string) => void, caught: unknown, fallback: string): void {
  onError(resolveAsrErrorMessage(caught, fallback));
}

export function useAsrRecorder({
  disabled,
  onText,
  onSendText,
  onError,
}: AsrRecorderCallbacks): AsrRecorderSession {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const sendAfterTranscriptionRef = useRef(false);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const audioContextsRef = useRef<AudioContext[]>([]);
  const levelHistoryRef = useRef<number[]>(Array.from({ length: 48 }, () => 0));
  const displayLevelRef = useRef(0);
  const targetLevelRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, []);

  useEffect(() => {
    if (!recording || busy) {
      if (animationRef.current !== undefined) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      return;
    }
    drawWaveform();
    return () => {
      if (animationRef.current !== undefined) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [recording, busy]);

  async function start() {
    if (disabled || busy || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      sendAfterTranscriptionRef.current = false;
      startedAtRef.current = Date.now();
      levelHistoryRef.current = Array.from({ length: 48 }, () => 0);
      displayLevelRef.current = 0;
      targetLevelRef.current = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finish(recorder);
      const context = new AudioContext();
      audioContextsRef.current.push(context);
      if (context.state === "suspended") {
        await context.resume();
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      source.connect(analyser);
      analyserRef.current = analyser;
      recorder.start(250);
      setRecording(true);
      timerRef.current = window.setTimeout(() => stop(false), MAX_ASR_SECONDS * 1000);
    } catch (caught) {
      cleanup();
      if (mountedRef.current) {
        reportAsrError(
          onError,
          caught instanceof DOMException && caught.name === "NotAllowedError"
            ? new Error(t("asr.error.permission"))
            : caught,
          t("asr.error.start"),
        );
      }
    }
  }

  function stop(send = false) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    sendAfterTranscriptionRef.current = send;
    recorder.stop();
    if (mountedRef.current) {
      setRecording(false);
      setBusy(true);
    }
  }

  function cancel() {
    sendAfterTranscriptionRef.current = false;
    const recorder = recorderRef.current;
    if (recorder) recorder.onstop = null;
    if (recorder?.state === "recording") recorder.stop();
    cleanup();
    if (mountedRef.current) {
      setRecording(false);
      setBusy(false);
    }
  }

  async function finish(recorder: MediaRecorder) {
    const chunks = chunksRef.current.slice();
    const send = sendAfterTranscriptionRef.current;
    try {
      if (!chunks.length || chunks.every((chunk) => chunk.size === 0)) throw new Error(t("asr.error.empty"));
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/wav" });
      const context = new AudioContext();
      audioContextsRef.current.push(context);
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (!decoded.length || !decoded.numberOfChannels) throw new Error(t("asr.error.empty"));
      const wav = encodePcm16Wav(downsampleToMono16k(decoded));
      const result = await window.eco?.transcribeAsr({ audioWavBase64: wavToBase64(wav) });
      if (!result?.text) throw new Error(t("asr.error.emptyResult"));
      if (mountedRef.current) {
        if (send) onSendText(result.text);
        else onText(result.text);
      }
    } catch (caught) {
      if (mountedRef.current) reportAsrError(onError, caught, t("asr.error.transcribe"));
    } finally {
      cleanup();
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  function drawWaveform() {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!analyser || !canvas || !context) return;
    const timeDomain = new Uint8Array(analyser.fftSize);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastSampleAt = 0;
    const sampleIntervalMs = 75;
    const maxHistoryLength = 96;

    const draw = (now: number) => {
      analyser.getByteTimeDomainData(timeDomain);
      let sum = 0;
      for (const value of timeDomain) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rawRms = Math.sqrt(sum / timeDomain.length);
      targetLevelRef.current = mapAsrAnalyserRmsToLevel(rawRms);

      if (now - lastSampleAt >= sampleIntervalMs) {
        displayLevelRef.current = targetLevelRef.current;
        levelHistoryRef.current.push(displayLevelRef.current);
        if (levelHistoryRef.current.length > maxHistoryLength) {
          levelHistoryRef.current.splice(0, levelHistoryRef.current.length - maxHistoryLength);
        }
        lastSampleAt = now;
      }

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || canvas.width;
      const cssHeight = canvas.clientHeight || canvas.height;
      if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);

      const spacing = 5.5;
      const count = Math.max(1, Math.ceil(cssWidth / spacing));
      const slotWidth = cssWidth / count;
      const centerY = cssHeight / 2;
      const history = levelHistoryRef.current;
      const visibleHistory =
        history.length > count
          ? history.slice(history.length - count)
          : [...Array.from({ length: count - history.length }, () => 0), ...history];
      const scrollProgress = Math.min(1, (now - lastSampleAt) / sampleIntervalMs);
      const styles = getComputedStyle(canvas);
      const waveColor = styles.getPropertyValue("--asr-wave-active").trim() || "currentColor";

      for (let index = 0; index <= count; index += 1) {
        const historyLevel = index === count ? displayLevelRef.current : (visibleHistory[index] ?? 0);
        const x = (index + 0.5 - scrollProgress) * slotWidth;
        if (x < -slotWidth || x > cssWidth + slotWidth) continue;
        const normalizedLevel = Math.max(0, Math.min(1, historyLevel));
        const height = 2.5 + (cssHeight - 7) * normalizedLevel;
        context.strokeStyle = waveColor;
        context.globalAlpha = 0.45 + normalizedLevel * 0.55;
        context.lineWidth = 3;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(x, centerY - height / 2);
        context.lineTo(x, centerY + height / 2);
        context.stroke();
      }
      context.globalAlpha = 1;

      if (shouldAnimateWaveform(true, false, reducedMotion) && recorderRef.current?.state === "recording") {
        animationRef.current = requestAnimationFrame(draw);
      }
    };
    animationRef.current = requestAnimationFrame(draw);
  }

  function cleanup() {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    for (const context of audioContextsRef.current) void context.close().catch(() => {});
    timerRef.current = undefined;
    animationRef.current = undefined;
    streamRef.current = undefined;
    recorderRef.current = undefined;
    analyserRef.current = undefined;
    audioContextsRef.current = [];
    chunksRef.current = [];
    levelHistoryRef.current = Array.from({ length: 48 }, () => 0);
    displayLevelRef.current = 0;
    targetLevelRef.current = 0;
  }

  return {
    active: recording || busy,
    recording,
    busy,
    canvasRef,
    start,
    stop,
    cancel,
  };
}

export function AsrMicButton({
  session,
  disabled,
}: {
  session: AsrRecorderSession;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="asr-recorder">
      <button
        type="button"
        title={t("asr.record")}
        aria-label={t("asr.record")}
        onClick={() => void session.start()}
        disabled={disabled || session.busy || session.recording}
      >
        <Mic size={15} />
      </button>
    </div>
  );
}

export function AsrVoiceComposer({ session }: { session: AsrRecorderSession }) {
  const { t } = useTranslation();
  const finishing = session.busy;

  return (
    <div className={`asr-voice-composer${finishing ? " is-busy" : ""}`} aria-busy={finishing}>
      <button
        type="button"
        className="asr-voice-round-button"
        title={t("asr.cancel")}
        aria-label={t("asr.cancel")}
        onClick={session.cancel}
        disabled={finishing}
      >
        <X size={20} strokeWidth={2.2} />
      </button>
      <div className="asr-voice-pill">
        <canvas
          ref={session.canvasRef}
          className="asr-voice-wave"
          aria-label={t("asr.level")}
        />
        <button
          type="button"
          className="asr-voice-round-button"
          title={t("asr.stopInsert")}
          aria-label={t("asr.stopInsert")}
          onClick={() => session.stop(false)}
          disabled={finishing}
        >
          {finishing ? (
            <LoaderCircle size={18} className="asr-voice-spinner" aria-hidden />
          ) : (
            <span className="asr-voice-stop-icon" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className="asr-voice-round-button is-send"
          title={t("asr.stopSend")}
          aria-label={t("asr.stopSend")}
          onClick={() => session.stop(true)}
          disabled={finishing}
        >
          <Send size={18} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  );
}

/** @deprecated Prefer useAsrRecorder + AsrMicButton / AsrVoiceComposer */
export function AsrRecorder(props: AsrRecorderCallbacks) {
  const session = useAsrRecorder(props);
  if (session.active) {
    return <AsrVoiceComposer session={session} />;
  }
  return (
    <AsrMicButton
      session={session}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
    />
  );
}
