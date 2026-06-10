import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type as typeTokens } from '../theme/tokens';

interface CategoryCellProps {
  name: string;
}

export function CategoryCell({ name }: CategoryCellProps) {
  return (
    <View style={styles.cell}>
      <Text
        style={styles.text}
        numberOfLines={3}
        adjustsFontSizeToFit
        allowFontScaling={false}
      >
        {name.toUpperCase()}
      </Text>
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
    fontSize: 17,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
});
