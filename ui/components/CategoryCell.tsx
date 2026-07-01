import { StyleSheet, View } from 'react-native';
import { AutoFitText } from './AutoFitText';
import { colors, radius, type as typeTokens } from '../theme/tokens';

interface CategoryCellProps {
  name: string;
}

export function CategoryCell({ name }: CategoryCellProps) {
  return (
    <View style={styles.cell}>
      <AutoFitText style={styles.text} maxLines={3} min={8} max={44} widthScale={0.85}>
        {name.toUpperCase()}
      </AutoFitText>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  text: {
    fontFamily: typeTokens.board,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
});
