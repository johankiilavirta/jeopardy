import { StyleSheet, Text, View } from 'react-native';
import { type as typeTokens } from '../theme/tokens';

interface PlayerLine {
  name: string;
  color: string;
  scores: number[];
}

interface ScoreChartProps {
  players: PlayerLine[];
  width: number;
  height: number;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const GRID_COLOR = 'rgba(255,255,255,0.15)';
const LABEL_COLOR = 'rgba(255,255,255,0.5)';
const ZERO_COLOR = 'rgba(255,255,255,0.3)';
const LINE_W = 2.5;
const DOT_R = 3;

export function ScoreChart({ players, width, height }: ScoreChartProps) {
  if (players.length === 0 || players.every(p => p.scores.length <= 1)) return null;

  const maxLen = Math.max(...players.map(p => p.scores.length));
  const allScores = players.flatMap(p => p.scores);
  const rawMin = Math.min(0, ...allScores);
  const rawMax = Math.max(0, ...allScores);
  const range = rawMax - rawMin || 1;
  const minVal = rawMin - range * 0.08;
  const maxVal = rawMax + range * 0.08;

  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const toX = (i: number) => PAD_LEFT + (maxLen > 1 ? (i / (maxLen - 1)) * plotW : plotW / 2);
  const toY = (v: number) => PAD_TOP + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  // Y-axis grid lines
  const nStep = niceInterval(rawMin, rawMax);
  const gridLines: number[] = [];
  const start = Math.ceil(rawMin / nStep) * nStep;
  for (let v = start; v <= rawMax; v += nStep) gridLines.push(v);
  if (!gridLines.includes(0)) gridLines.push(0);

  // Build line segments for each player
  const segments: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  for (const player of players) {
    for (let i = 1; i < player.scores.length; i++) {
      segments.push({
        x1: toX(i - 1), y1: toY(player.scores[i - 1]!),
        x2: toX(i), y2: toY(player.scores[i]!),
        color: player.color,
      });
    }
  }

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Grid lines */}
      {gridLines.map(v => (
        <View
          key={`grid-${v}`}
          style={[styles.gridLine, {
            top: toY(v),
            left: PAD_LEFT,
            width: plotW,
            borderBottomColor: v === 0 ? ZERO_COLOR : GRID_COLOR,
            borderBottomWidth: v === 0 ? 1 : StyleSheet.hairlineWidth,
          }]}
        />
      ))}

      {/* Y labels */}
      {gridLines.map(v => (
        <Text
          key={`label-${v}`}
          style={[styles.label, { top: toY(v) - 7, left: 0, width: PAD_LEFT - 6 }]}
          numberOfLines={1}
        >
          {formatDollar(v)}
        </Text>
      ))}

      {/* Line segments */}
      {segments.map((seg, i) => {
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={i}
            style={[styles.segment, {
              left: seg.x1,
              top: seg.y1 - LINE_W / 2,
              width: len,
              height: LINE_W,
              backgroundColor: seg.color,
              transform: [
                { translateX: -0 },
                { rotate: `${angle}deg` },
              ],
              transformOrigin: 'left center',
            }]}
          />
        );
      })}

      {/* Dots at each data point */}
      {players.map(player =>
        player.scores.map((s, i) => (
          <View
            key={`${player.name}-${i}`}
            style={[styles.dot, {
              left: toX(i) - DOT_R,
              top: toY(s) - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              borderRadius: DOT_R,
              backgroundColor: player.color,
            }]}
          />
        )),
      )}
    </View>
  );
}

function niceInterval(min: number, max: number): number {
  const range = max - min || 1;
  const rough = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / mag;
  if (normalized <= 1) return mag;
  if (normalized <= 2) return 2 * mag;
  if (normalized <= 5) return 5 * mag;
  return 10 * mag;
}

function formatDollar(v: number): string {
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  const formatted = abs >= 1000 ? `${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k` : `${abs}`;
  return v < 0 ? `-$${formatted}` : `$${formatted}`;
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    marginTop: 16,
  },
  gridLine: {
    position: 'absolute',
    height: 0,
  },
  label: {
    position: 'absolute',
    textAlign: 'right',
    fontFamily: typeTokens.ui500,
    fontSize: 10,
    color: LABEL_COLOR,
  },
  segment: {
    position: 'absolute',
    borderRadius: LINE_W / 2,
  },
  dot: {
    position: 'absolute',
  },
});
