import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

/** Upward drag (px) past which a release commits the menu open. */
const MENU_SWIPE_THRESHOLD = 120;
/** Upward velocity (px/ms) that commits even below full threshold. */
const MENU_SWIPE_VELOCITY = 0.5;
/** Backdrop opacity when the menu is fully open. */
const BACKDROP_OPACITY = 0.6;

type OverlayPage = 'menu' | 'settings';

interface SwipeUpMenuProps {
  children: React.ReactNode;
  /** Render the main menu page. Receives a callback to navigate to settings. */
  renderMenu: (showSettings: () => void) => React.ReactNode;
  /** Render the settings page inside the overlay. Receives a back callback. */
  renderSettings?: (goBack: () => void) => React.ReactNode;
  /** Suppress the swipe gesture (e.g. during active clue answering). */
  disabled?: boolean;
}

export function SwipeUpMenu({ children, renderMenu, renderSettings, disabled }: SwipeUpMenuProps) {
  const { height: screenHeight } = useWindowDimensions();
  const menuY = useRef(new Animated.Value(screenHeight)).current;
  const [menuVisible, setMenuVisible] = useState(false);
  const [overlayPage, setOverlayPage] = useState<OverlayPage>('menu');

  const openMenu = () => {
    setMenuVisible(true);
    Animated.spring(menuY, {
      toValue: 0,
      speed: 14,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = useCallback(() => {
    Animated.spring(menuY, {
      toValue: screenHeight,
      speed: 14,
      bounciness: 4,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMenuVisible(false);
        setOverlayPage('menu');
      }
    });
  }, [menuY, screenHeight]);

  const showSettings = useCallback(() => setOverlayPage('settings'), []);
  const showMenu = useCallback(() => setOverlayPage('menu'), []);

  // Swipe-up on the children area to open the menu.
  const openResponder = useMemo(() => {
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !disabled && g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => {
        const clamped = Math.max(0, screenHeight + g.dy);
        menuY.setValue(clamped);
      },
      onPanResponderGrant: () => {
        setMenuVisible(true);
      },
      onPanResponderRelease: (_e, g) => {
        if (
          -g.dy > MENU_SWIPE_THRESHOLD ||
          (-g.dy > 50 && -g.vy > MENU_SWIPE_VELOCITY)
        ) {
          openMenu();
        } else {
          closeMenu();
        }
      },
      onPanResponderTerminate: () => {
        closeMenu();
      },
    });
  }, [disabled, screenHeight, menuY, closeMenu]);

  // Swipe-down on the menu panel to dismiss.
  const dismissResponder = useMemo(() => {
    return PanResponder.create({
      // Capture phase so the drag intercepts before Pressable children
      // consume the touch. Taps still fall through (only moves are captured).
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        g.dy > 12 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => {
        menuY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_e, g) => {
        if (
          g.dy > MENU_SWIPE_THRESHOLD ||
          (g.dy > 50 && g.vy > MENU_SWIPE_VELOCITY)
        ) {
          closeMenu();
        } else {
          Animated.spring(menuY, {
            toValue: 0,
            speed: 14,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(menuY, {
          toValue: 0,
          speed: 14,
          bounciness: 4,
          useNativeDriver: true,
        }).start();
      },
    });
  }, [screenHeight, menuY, closeMenu]);

  const backdropOpacity = menuY.interpolate({
    inputRange: [0, screenHeight],
    outputRange: [BACKDROP_OPACITY, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root}>
      <View style={styles.content} {...openResponder.panHandlers}>
        {children}
      </View>

      {menuVisible && (
        <>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.backdrop,
              { opacity: backdropOpacity },
            ]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
          </Animated.View>

          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateY: menuY }] },
            ]}
            {...dismissResponder.panHandlers}
          >
            {overlayPage === 'settings' && renderSettings
              ? renderSettings(showMenu)
              : renderMenu(showSettings)}
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000',
  },
});
