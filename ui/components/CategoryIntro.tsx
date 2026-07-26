import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, shadow, type as typeTokens } from '../theme/tokens';
import { sanitizeText } from '../../src/sanitizeText';

/** How long each category card sits on screen before pushing to the next. */
const HOLD_MS = 966;
/** Duration of the horizontal push between two cards. */
const SLIDE_MS = 254;
interface CategoryIntroProps {
  /** Category names in board order. The 6th (backfilled) category should
   *  already carry its trailing " *". */
  categories: string[];
  /** Called once the last card has been held — reveal the board. */
  onDone: () => void;
}

const MAX_INTRO_FONT = 48;
const MIN_INTRO_FONT = 24;
const INTRO_LINE_HEIGHT = 1.18;

/** Fit category copy without relying on native adjustsFontSizeToFit events.
 * Offscreen cards do not reliably emit those events on iOS, which can
 * deadlock an intro that waits for every card. Anton is condensed; these
 * conservative glyph-width estimates keep the result within four lines. */
function fitIntroFont(text: string, width: number, height: number): number {
  const words = sanitizeText(text).toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return MAX_INTRO_FONT;
  const glyphWidth = (word: string) =>
    Array.from(word).reduce((total, char) => {
      if ('MW'.includes(char)) return total + 0.78;
      if ('I1'.includes(char)) return total + 0.32;
      if ('.,!:\'`'.includes(char)) return total + 0.26;
      return total + 0.58;
    }, 0);
  const wordWidths = words.map(glyphWidth);
  const spaceWidth = 0.34;

  for (let fontSize = MAX_INTRO_FONT; fontSize >= MIN_INTRO_FONT; fontSize--) {
    const lineCapacity = width / fontSize;
    let lines = 1;
    let current = 0;
    let fits = true;
    for (const wordWidth of wordWidths) {
      if (wordWidth > lineCapacity) {
        fits = false;
        break;
      }
      if (current === 0) current = wordWidth;
      else if (current + spaceWidth + wordWidth <= lineCapacity) {
        current += spaceWidth + wordWidth;
      } else {
        lines++;
        current = wordWidth;
      }
    }
    if (fits && lines <= 4 && lines * fontSize * INTRO_LINE_HEIGHT <= height) {
      return fontSize;
    }
  }
  return MIN_INTRO_FONT;
}

/**
 * Round-intro fly-by: the category title cards scroll past horizontally, one
 * at a time, like the show reading out the categories. The cards sit edge to
 * edge on a single strip and we translate the strip left by one screen width
 * per step (a constant-speed "push"). After the last card it fades out to
 * reveal the board behind. Tap anywhere to drop the intro instantly. Mount
 * this keyed by round so each round replays its own intro.
 */
export function CategoryIntro({ categories, onDone }: CategoryIntroProps) {
  const tx = useRef(new Animated.Value(0)).current;
  const revealCoverOpacity = useRef(new Animated.Value(1)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const { width: w, height: h } = useWindowDimensions();
  const startedSignatureRef = useRef<string | null>(null);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const introFontSizes = useMemo(() => {
    const cardTextWidth = Math.max(1, w * 0.86 - 56);
    const cardTextHeight = Math.max(1, h * 0.76);
    return categories.map(category => fitIntroFont(category, cardTextWidth, cardTextHeight));
  }, [categories, h, w]);
  const animationSignature = `${w}|${h}|${categories.join('\u0001')}`;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    if (
      startedSignatureRef.current === animationSignature ||
      w <= 0 ||
      h <= 0 ||
      introFontSizes.length !== categories.length
    ) return;
    startedSignatureRef.current = animationSignature;
    tx.setValue(0);
    revealCoverOpacity.setValue(1);
    containerOpacity.setValue(1);

    const n = categories.length;
    // The fitted cards render normally behind a solid black cover. Only after
    // native text layout reports completion does the cover fade away.
    const steps: Animated.CompositeAnimation[] = [
      Animated.timing(revealCoverOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      })
    ];
    // Hold on each card, then push to the next; on the last card, hold and
    // then fade the whole overlay out to reveal the board already behind it.
    for (let i = 0; i < n; i++) {
      steps.push(Animated.delay(HOLD_MS));
      if (i < n - 1) {
        steps.push(
          Animated.timing(tx, {
            toValue: -(i + 1) * w,
            duration: SLIDE_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        );
      }
    }
    // Then fade out the entire container to reveal the board
    steps.push(
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    );
    const sequence = Animated.sequence(steps);
    sequence.start(({ finished }) => {
      if (finished) finish();
    });
    return () => sequence.stop();
  }, [w, h, categories.length, finish, tx, revealCoverOpacity, containerOpacity, introFontSizes.length, animationSignature]);

  // Dark frame around the blue card, matching the broadcast proportions:
  // ~7% of width on the sides, ~12% of height top and bottom.
  const pad = { paddingHorizontal: w * 0.07, paddingVertical: h * 0.12 };

  return (
    <Animated.View style={[styles.fill, { opacity: containerOpacity }]}>
      <Pressable style={styles.fill} onPress={finish}>
        <Animated.View
          style={[
            styles.strip,
            { width: w * categories.length, transform: [{ translateX: tx }] },
          ]}
        >
          {categories.map((name, i) => (
            <View key={i} style={[styles.slot, { width: w }, pad]}>
              <View style={styles.card}>
                <Text
                  style={[
                    styles.categoryText,
                    {
                      fontSize: introFontSizes[i] ?? MIN_INTRO_FONT,
                      lineHeight: (introFontSizes[i] ?? MIN_INTRO_FONT) * INTRO_LINE_HEIGHT,
                    },
                  ]}
                  numberOfLines={4}
                  allowFontScaling={false}
                >
                  {sanitizeText(name).toUpperCase()}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </Pressable>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.revealCover, { opacity: revealCoverOpacity }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    height: '100%',
  },
  revealCover: {
    zIndex: 2,
    backgroundColor: colors.bg,
  },
  // Each slot is a full screen-width column on the dark background; the blue
  // card is inset within it, so the dark frame shows on all sides and the gap
  // between two cards' frames reads as a dark sliver during the push.
  slot: {
    height: '100%',
    backgroundColor: colors.bg,
  },
  card: {
    flex: 1,
    backgroundColor: colors.cell,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  categoryText: {
    fontFamily: typeTokens.board,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
});
