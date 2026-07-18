/**
 * Reusable bottom-sheet keyboard container with swipe-to-dismiss.
 *
 * Encapsulates the animated show/hide, PanResponder drag, grabber bar,
 * and dismiss-layer overlay that was previously duplicated across screens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../theme/tokens';

const SHEET_MIN_HEIGHT = 208;
const SHEET_MAX_HEIGHT = 272;
const SHEET_HEIGHT_PCT = 0.272;
const SHEET_BOTTOM_OVERHANG = 56;
const SHEET_RADIUS = 18;
const DISMISS_THRESHOLD = 80;
const DISMISS_VELOCITY = 0.5;

export interface KeyboardSheetControls {
  visible: boolean;
  panelHeight: number;
  open: () => void;
  close: () => void;
}

/**
 * Hook that manages keyboard sheet animation state.
 *
 * @param onOpen  Called when the sheet opens (use to scroll content into view).
 * @param onClose Called after the sheet finishes its close animation.
 */
export function useKeyboardSheet(
  onOpen?: () => void,
  onClose?: () => void,
): KeyboardSheetControls & { _render: RenderState } {
  const { height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Use refs so callbacks don't destabilize memoized values.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panelHeight = Math.min(
    SHEET_MAX_HEIGHT,
    Math.max(SHEET_MIN_HEIGHT, Math.round(height * SHEET_HEIGHT_PCT)),
  );

  const kb = useRef(new Animated.Value(0)).current;
  const kbDrag = useRef(new Animated.Value(0)).current;
  const visibleRef = useRef(false);

  const open = useCallback(() => {
    kbDrag.setValue(0);
    setMounted(true);
    setVisible(true);
    visibleRef.current = true;
    onOpenRef.current?.();
  }, [kbDrag]);

  const close = useCallback(() => {
    setVisible(false);
    visibleRef.current = false;
  }, []);

  useEffect(() => {
    if (visible) {
      Animated.spring(kb, {
        toValue: 1,
        speed: 16,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(kb, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          onCloseRef.current?.();
        }
      });
    }
  }, [visible, kb]);

  const panelRise = useMemo(
    () => kb.interpolate({ inputRange: [0, 1], outputRange: [panelHeight, 0] }),
    [kb, panelHeight],
  );

  const responder = useMemo(() => {
    const snapBack = () =>
      Animated.spring(kbDrag, {
        toValue: 0,
        speed: 22,
        bounciness: 0,
        useNativeDriver: true,
      }).start();

    const finishDismiss = () => {
      Animated.timing(kbDrag, {
        toValue: panelHeight,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        kb.setValue(0);
        kbDrag.setValue(0);
        setVisible(false);
        visibleRef.current = false;
        setMounted(false);
        onCloseRef.current?.();
      });
    };

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        const vert = Math.abs(g.dy) > 15 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        return vert && visibleRef.current && g.dy > 0;
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const vert = Math.abs(g.dy) > 15 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        return vert && visibleRef.current && g.dy > 0;
      },
      onPanResponderMove: (_e, g) => {
        if (visibleRef.current && g.dy > 0) {
          kbDrag.setValue(Math.min(g.dy, panelHeight));
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (visibleRef.current && g.dy > 0) {
          const projected = g.dy + Math.max(0, g.vy) * 120;
          if (
            g.dy > DISMISS_THRESHOLD ||
            (g.dy > 24 && projected > DISMISS_THRESHOLD && g.vy > DISMISS_VELOCITY)
          ) {
            finishDismiss();
          } else {
            snapBack();
          }
        }
      },
      onPanResponderTerminate: snapBack,
    });
  }, [kb, kbDrag, panelHeight]);

  return {
    visible,
    panelHeight,
    open,
    close,
    _render: { mounted, panelRise, kbDrag, responder, panelHeight, close },
  };
}

/** Internal state passed to KeyboardSheet component. */
interface RenderState {
  mounted: boolean;
  panelRise: Animated.AnimatedInterpolation<number>;
  kbDrag: Animated.Value;
  responder: ReturnType<typeof PanResponder.create>;
  panelHeight: number;
  close: () => void;
}

interface KeyboardSheetProps {
  controls: KeyboardSheetControls & { _render: RenderState };
  children: React.ReactNode;
}

/**
 * Renders the dismiss overlay + animated bottom sheet with grabber.
 * Place at the end of your screen's root View.
 */
export function KeyboardSheet({ controls, children }: KeyboardSheetProps) {
  const { visible, _render: r } = controls;

  return (
    <>
      {visible && (
        <Pressable
          style={styles.dismissLayer}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          onPress={r.close}
        />
      )}
      {r.mounted && (
        <Animated.View
          style={[
            styles.sheetWrap,
            { transform: [{ translateY: Animated.add(r.panelRise, r.kbDrag) }] },
          ]}
          {...r.responder.panHandlers}
        >
          <View style={[styles.sheet, { height: r.panelHeight + SHEET_BOTTOM_OVERHANG }]}>
            <Pressable onPress={() => {}} style={[styles.sheetInner, { height: r.panelHeight }]}>
              <View style={styles.grabber} />
              <View style={styles.keypad}>
                {children}
              </View>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dismissLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -SHEET_BOTTOM_OVERHANG,
    alignItems: 'center',
    zIndex: 2,
  },
  sheet: {
    width: '96%',
    backgroundColor: colors.cellFinalRecessed,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
  },
  sheetInner: {
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: 10,
    marginBottom: 10,
  },
  keypad: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
