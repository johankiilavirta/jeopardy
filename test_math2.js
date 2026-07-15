const LIGHT_COUNT = 39;
const tiers = Math.ceil(LIGHT_COUNT / 2);
const rangeStart = 0.2;
const rangeLen = 0.8;

for (let i = 0; i < LIGHT_COUNT; i++) {
  const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
  const threshold = rangeStart + (edgeDistance + 1) * (rangeLen / tiers);
  console.log(`i=${i} edgeDistance=${edgeDistance} threshold=${threshold}`);
}
