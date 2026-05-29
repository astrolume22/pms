/**
 * Device-class detection used to block sign-in from phones and tablets.
 *
 * EIA Internal Projects is a desktop / laptop product (dense board UI,
 * keyboard-driven). Signing in from a phone or iPad is intentionally
 * disabled — the login page renders a red "use a computer" message
 * instead of the form, and the form submit handler short-circuits as a
 * second line of defense.
 *
 * Block target:
 *   • iOS phones (iPhone, iPod)
 *   • Android phones
 *   • iPads (incl. iPadOS 13+ in desktop-Safari mode)
 *   • Android tablets
 *
 * Allow target (explicitly):
 *   • Windows of any kind — desktop PCs, laptops, AND 2-in-1
 *     touchscreen devices (Surface Pro, Surface Book, Surface Laptop
 *     Studio, etc.). These are real laptops with detachable keyboards
 *     and the user IS supposed to be able to sign in from them.
 *   • macOS (real Macs only — iPads in desktop-Safari mode are blocked
 *     by the Macintosh + touch-points check).
 *   • Linux desktops.
 *   • ChromeOS.
 *
 * Detection order:
 *   1. ALLOW Windows immediately. This is the single most important
 *      change vs. the previous version, which used a touch +
 *      small-viewport heuristic that wrongly blocked Surface Pro 10
 *      and other Windows touchscreens running in compact-window mode.
 *   2. BLOCK on explicit phone/tablet UA tokens (iPhone, iPad, iPod,
 *      Android, BlackBerry, IEMobile, Opera Mini, Mobile, Silk).
 *   3. BLOCK iPadOS 13+ which advertises a Macintosh UA but has
 *      >1 touch points (real Macs have 0).
 *
 * No viewport / touch heuristic any more — that was the misfire that
 * caught Windows touchscreen laptops. UA-only from here on.
 *
 * The hook re-evaluates on resize + orientationchange so a phone that
 * starts in portrait and rotates is still blocked (UA doesn't change,
 * but the hook handles it cheaply either way).
 */
import { useEffect, useState } from 'react';

export function detectMobileOrTablet(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // ---- ALLOW LAYER 0 — Windows of any kind ----------------------------
  // Catches Surface Pro / Surface Book / any Windows desktop or laptop,
  // including 2-in-1 touchscreens. Must run BEFORE the mobile-UA block
  // because some Windows tablet UAs historically included the word
  // "Tablet" — even though modern Edge / Chrome on Surface no longer
  // does, the guard is cheap and future-proofs the check.
  if (/Windows NT|Win64|WOW64|Win32/i.test(ua)) return false;

  // ---- BLOCK LAYER 1 — explicit phone/tablet UA tokens ----------------
  // iPhone / iPad / iPod / Android (phones + tablets) / BlackBerry /
  // IEMobile (old Windows Phone) / Opera Mini / generic "Mobile" /
  // Kindle Fire "Silk".
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i.test(ua)) {
    return true;
  }

  // ---- BLOCK LAYER 2 — iPadOS 13+ in desktop-Safari mode --------------
  // Apple ships a "Macintosh" UA on iPads since iPadOS 13 to make sites
  // serve the desktop layout. Real Macs report navigator.maxTouchPoints
  // === 0; iPads report 5. This is the canonical disambiguation.
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  if (/Macintosh/.test(ua) && touchPoints > 1) return true;

  // Everything else (macOS, Linux, ChromeOS, anything not explicitly
  // phone/tablet) is allowed.
  return false;
}

export function useIsMobileOrTablet(): boolean {
  // Initial value is computed synchronously so the very first paint
  // already shows the block — no form-flash for mobile users.
  const [blocked, setBlocked] = useState<boolean>(() => detectMobileOrTablet());

  useEffect(() => {
    const recompute = () => setBlocked(detectMobileOrTablet());
    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
    };
  }, []);

  return blocked;
}
