import { memo, useEffect, useRef } from 'react';
import {
  FLASH_MS,
  HOLD_MS,
  LIGHT_COUNT,
  LIGHTS_REST_BOTTOM,
  LIGHTS_WIDTH_PCT,
  OFF_OPACITY,
} from './activationLightsMetrics';

export { LIGHTS_REST_BOTTOM, LIGHTS_WIDTH_PCT } from './activationLightsMetrics';

interface ActivationLightsProps {
  /** The light configurations, or null/undefined to fade out. */
  lights?: {
    deadline: number;
    durationMs: number;
    flash: boolean;
  } | null | undefined;
}

/**
 * Web rendition of the activation lights. Same look and timeline as the
 * native implementation, but react-native-web can't use the native
 * animation driver, and JS-driving 86 lamp opacities per frame cost about
 * a third of phone-class frames during the drain. Instead the whole
 * timeline — pop, hold, tier-by-tier extinguish — is scheduled up front
 * as CSS transitions with per-lamp delays: the compositor runs every
 * frame and the JS thread does nothing at all while the strip drains.
 */
export const ActivationLights = memo(function ActivationLights({ lights }: ActivationLightsProps) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // The window is compared by value: parents rebuild the prop object, and
  // rescheduling on a phantom "new window" would restart the pop.
  const lightsKey = lights ? `${lights.deadline}/${lights.durationMs}/${lights.flash}` : null;
  const lightsRef = useRef(lights);
  lightsRef.current = lights;

  useEffect(() => {
    const band = bandRef.current;
    const row = rowRef.current;
    if (!band || !row) return;

    const win = lightsRef.current;
    if (!win) {
      band.style.transition = 'opacity 350ms';
      band.style.opacity = '0';
      return;
    }
    const { deadline, durationMs, flash } = win;

    band.style.transition = 'opacity 100ms'; // Twice as fast fade-in
    band.style.opacity = '1';

    // The pop: snap the row to its off glow, flush styles so the rise
    // below actually transitions, then rise fast and hold fully lit.
    row.style.transition = 'none';
    row.style.opacity = flash ? String(OFF_OPACITY) : '1';

    // Reset every lamp to lit with no transition, then flush once.
    const lamps = row.children as HTMLCollectionOf<HTMLElement>;
    for (let i = 0; i < lamps.length; i++) {
      lamps[i]!.style.transition = 'none';
      lamps[i]!.style.opacity = '1';
    }
    void row.offsetWidth;

    row.style.transition = 'opacity 60ms ease-out'; // Twice as fast flash
    row.style.opacity = '1';

    // The drain, all scheduled now: the countdown range begins where the
    // hold ends, lamps extinguish outermost pair first with one
    // tier-length linear fade each, and the center pair dies exactly at
    // the deadline — the same math the native driver runs frame by frame.
    const holdMs = flash ? FLASH_MS : HOLD_MS;
    const drainMs = Math.max(0, deadline - Date.now() - holdMs);
    const tiers = Math.ceil(LIGHT_COUNT / 2);
    const tierMs = drainMs / tiers;
    for (let i = 0; i < lamps.length; i++) {
      const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
      const delay = holdMs + edgeDistance * tierMs;
      lamps[i]!.style.transition = `opacity ${Math.max(1, tierMs)}ms linear ${delay}ms`;
      lamps[i]!.style.opacity = String(OFF_OPACITY);
    }
  }, [lightsKey]);

  return (
    <div ref={bandRef} style={bandStyle}>
      <div ref={rowRef} style={rowStyle}>
        {Array.from({ length: LIGHT_COUNT }, (_, i) => (
          <div key={i} style={lampStyle} />
        ))}
      </div>
    </div>
  );
});

const bandStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: LIGHTS_REST_BOTTOM,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  opacity: 0,
};

const rowStyle: React.CSSProperties = {
  width: `${LIGHTS_WIDTH_PCT * 100}%`,
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'space-between',
};

const lampStyle: React.CSSProperties = {
  width: 2, // 2px square blocks
  height: 2,
  backgroundColor: '#FFFFFF', // The physical LED color when lit
  boxShadow: '0 0 3px #0088FF', // electric blue glowing halo
};
