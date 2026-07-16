const LIGHT_COUNT = 151;
const tiers = Math.ceil(LIGHT_COUNT / 2);
const rangeStart = 0.2;
const rangeLen = 0.8;
const progress = 0.2; // AT RANGE START

for (let i = 0; i < LIGHT_COUNT; i++) {
  const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
  const threshold = rangeStart + (edgeDistance + 1) * (rangeLen / tiers);
  const fadeStart = Math.max(0, threshold - rangeLen / tiers);
  let step = 1.0;
  if (progress >= threshold) step = 0.15;
  else if (progress > fadeStart) step = 1.0 - (progress - fadeStart) / (threshold - fadeStart) * 0.85;
  
  if (i === 0 || i === 75 || i === 150) {
    console.log(`i=${i} edgeDistance=${edgeDistance} threshold=${threshold} step=${step}`);
  }
}
