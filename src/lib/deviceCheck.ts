/**
 * Device-class detection used to block sign-in from phones and tablets.
 *
 * EIA Internal Projects is a desktop / laptop product (dense board UI,
 * keyboard-driven). Signing in from a phone or iPad is intentionally
 * disabled — the login page renders a red "use a computer" message
 * instead of the form, and the form submit handler short-circuits as a
 * second line of defense.
 *
 * Detection layers (any one is enough to classify as mobile/tablet):
 *   1. UA tokens — Android, iPhone, iPod, iPad, BlackBerry, IEMobile,
 *      Opera Mini, generic "Mobile" / "Tablet" markers, Kindle "Silk".
 *   2. iPadOS 13+ ships a desktop-class Safari UA ("Macintosh"), so we
 *      additionally treat any Macintosh UA with >1 touch points as an
 *      iPad. Real Macs report maxTouchPoints === 0.
 *   3. Heuristic fallback for hybrid devices: touch-capable AND the
 *      smaller viewport dimension < 820px (covers landscape tablets).
 *
 * The hook re-evaluates on resize + orientationchange so a phone that
 * starts in portrait and rotates is still blocked.
 */
import { useEffect, useState } from 'react';

export function detectMobileOrTablet(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // Layer 1 — explicit mobile/tablet UA tokens.
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk/i.test(ua)) {
    return true;
  }

  // Layer 2 — iPadOS 13+ reports as Macintosh. Real Macs have 0 touch
  // points; iPads report 5. navigator.maxTouchPoints is widely supported.
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  if (/Macintosh/.test(ua) && touchPoints > 1) return true;

  // Layer 3 — touch-capable AND viewport small enough that this is
  // almost certainly a tablet in landscape, not a desktop with a
  // touchscreen. 820px is just below a 1024×768 iPad in landscape.
  const hasTouch = 'ontouchstart' in window || touchPoints > 0;
  const minDim = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  if (hasTouch && minDim > 0 && minDim < 820) return true;

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
