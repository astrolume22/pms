/**
 * src/lib/notify.ts — reusable notification delivery layer.
 *
 *   • playBell()        — synthesized two-note bell chime (no asset file)
 *   • primeAudioUnlock() — installs a ONE-TIME first-gesture listener so
 *                          autoplay-blocked browsers will produce sound
 *                          starting from the first click/keypress
 *   • notifyNow(...)    — single entrypoint: sonner toast + bell chime
 *   • useNotificationWatcher() — mounts at TopBar (where the bell already
 *                          lives) and fires notifyNow() for every NEW row
 *                          that arrives via the 20s notifications poll
 *
 * Design notes:
 *   – Tone is generated via Web Audio API (OscillatorNode + GainNode
 *     envelope). No audio asset → no download, no 404 risk.
 *   – AudioContext is created lazily and shared. Browsers block it until
 *     a user gesture, so we install ONE document-level pointerdown/keydown
 *     listener that resumes the context and then removes itself. If
 *     playBell() fires before that first gesture, the chime is silently
 *     skipped — the toast still shows.
 *   – The watcher seeds its "seen" markers on the FIRST successful load
 *     so existing notifications on page boot do NOT blast sound.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNotifications } from '@/hooks/notifications';
import { useWarningModalStore } from '@/state/warningModalStore';
import type { NotificationRow } from '@/lib/database.types';

// =====================================================================
// AudioContext singleton + autoplay unlock
//
// ROOT CAUSE of the silent-bell bug we're fixing here:
//   • Old playBell() did `if (ctx.state === 'suspended') return;` →
//     silently dropped the chime whenever it fired outside a user
//     gesture (i.e. from the 20s notification poll).
//   • Old primeAudioUnlock() called ctx.resume() fire-and-forget. On
//     Safari/iOS that isn't enough — you must also play a real (silent)
//     sound during the gesture for the context to fully arm.
//
// Fix:
//   1. getAudioCtx() is memoized to ONE AudioContext instance.
//   2. On the first pointerdown/keydown we resume() AND play a 1-sample
//      silent buffer (the standard Safari unlock trick). Both happen
//      synchronously inside the same gesture.
//   3. playBell() never bails on 'suspended'. If suspended, we call
//      resume() and chain .then(emit) so the chime lands the instant
//      the context becomes 'running'.
// =====================================================================
type AudioCtxCtor = typeof AudioContext;
let audioCtx: AudioContext | null = null;
let unlockInstalled = false;

function getAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtxCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

export function primeAudioUnlock(): void {
  if (unlockInstalled || typeof document === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      // Resume the suspended context. resume() returns a promise; we
      // don't await it — by the time the user clicks the next thing
      // the state will already be 'running'.
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => { /* ignore */ });
      }
      // Play a 1-sample silent buffer INSIDE the gesture. This is the
      // canonical Safari/iOS unlock trick — a no-op-sounding sound is
      // what fully arms the audio output. Skipping this is what kept
      // the chime silent on Safari even after resume() landed.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* swallow — unlock errors must never throw to the UI */
    }
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

// Fire-and-forget at module load so the unlock is armed as early as
// possible — by the time the first notification arrives, any prior user
// click on the page has already resumed the context.
primeAudioUnlock();

// =====================================================================
// playBell — synthesized two-note "ding-dong"
// =====================================================================
function emitChime(ctx: AudioContext): void {
  try {
    const now = ctx.currentTime;
    const playNote = (freq: number, startOffset: number, duration: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Gentle attack + decay envelope so the tone feels like a chime,
      // not a beep.
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peak,    now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };
    // Two-note chime: A5 then D6 — pleasant, alerting, not jarring.
    playNote(880,  0.00, 0.15, 0.20);
    playNote(1175, 0.13, 0.18, 0.18);
  } catch {
    /* swallow — audio errors must never break the caller */
  }
}

/**
 * Play a short two-note bell chime. If the AudioContext is suspended
 * (no gesture yet), we resume it and emit AFTER resume settles instead
 * of bailing out. The old early-return was the chief silent-bell bug.
 */
export function playBell(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'running') {
    emitChime(ctx);
    return;
  }
  // 'suspended' (no gesture yet) OR 'closed' (very rare). Try to
  // resume and emit. If resume rejects (autoplay still blocked), the
  // chime stays silent — the caller's toast/modal still surfaces.
  try {
    void ctx.resume().then(
      () => emitChime(ctx),
      () => { /* swallow */ },
    );
  } catch {
    /* swallow */
  }
}

// =====================================================================
// notifyNow — single entrypoint: sonner toast + bell chime
// =====================================================================
export interface NotifyArgs {
  title: string;
  body?: string;
}

export function notifyNow({ title, body }: NotifyArgs): void {
  try {
    toast(title, body ? { description: body } : undefined);
  } catch {
    /* sonner not mounted yet on cold boot */
  }
  playBell();
}

/**
 * HIGH-PRIORITY surface — centered <WarningModal/> popup + bell chime.
 * Use for warnings that demand the user's attention right now (e.g.
 * "3 minutes left on your bio break"). Does NOT use sonner toast; the
 * single mounted <WarningModal/> renders it.
 */
export function notifyImportant({ title, body }: NotifyArgs): void {
  try {
    useWarningModalStore.getState().show(title, body ?? '');
  } catch {
    /* store not mounted yet on cold boot — chime still fires */
  }
  playBell();
}

// =====================================================================
// useNotificationWatcher — mounts at TopBar; fires notifyNow() for every
// NEW row that appears via the 20s notifications poll.
//
// Seed-then-fire pattern:
//   • First successful data load: capture the newest created_at as the
//     "seen marker" and the set of current ids in seenIds — fire NOTHING
//     (existing notifications on page open must not blast sound).
//   • Every subsequent data update: any row whose created_at > marker
//     AND whose id is not in seenIds is NEW → notifyNow() and add the id
//     to seenIds. After processing, advance the marker to the newest
//     created_at observed in the current data set.
// =====================================================================
const TITLE_BY_TYPE: Record<string, string> = {
  mention:         'You were mentioned',
  comment:         'New comment',
  assigned:        'You were assigned a task',
  status_changed:  'Status changed',
  due_date:        'Task due',
  task_updated:    'Task updated',
};

function titleFor(type: string): string {
  return TITLE_BY_TYPE[type] ?? 'Notification';
}

export function useNotificationWatcher(): void {
  const { data } = useNotifications();
  const seededRef = useRef<boolean>(false);
  const markerRef = useRef<number>(0);             // max created_at (ms) we've reacted to
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const rows: NotificationRow[] = data;

    // Track the newest created_at across the current data set so the
    // marker can advance regardless of seed-vs-fire branch.
    let newestMs = markerRef.current;
    for (const r of rows) {
      const ms = new Date(r.created_at).getTime();
      if (Number.isFinite(ms) && ms > newestMs) newestMs = ms;
    }

    if (!seededRef.current) {
      // SEED PASS — record what we already had on first load. No toasts,
      // no sound; just baseline.
      seededRef.current = true;
      markerRef.current = newestMs;
      for (const r of rows) seenIdsRef.current.add(r.id);
      return;
    }

    // FIRE PASS — anything strictly newer than the marker AND not yet
    // seen is a fresh notification.
    const prevMarker = markerRef.current;
    let fired = 0;
    for (const r of rows) {
      const ms = new Date(r.created_at).getTime();
      if (!Number.isFinite(ms)) continue;
      if (ms <= prevMarker) continue;
      if (seenIdsRef.current.has(r.id)) continue;
      seenIdsRef.current.add(r.id);
      notifyNow({ title: titleFor(r.type as string) });
      fired += 1;
    }
    markerRef.current = newestMs;

    // Keep the seenIds set bounded so it can't grow without limit on a
    // long-lived session. The list query is limit:50 by default, so we
    // never need to remember more than ~200 ids to stay safe.
    if (seenIdsRef.current.size > 500) {
      const keep = new Set<string>();
      for (const r of rows) keep.add(r.id);
      seenIdsRef.current = keep;
    }

    void fired; // (no-op — silences unused; kept for future debug log)
  }, [data]);
}
