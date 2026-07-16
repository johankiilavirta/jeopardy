const LIGHT_COUNT = 39;
const tiers = Math.ceil(LIGHT_COUNT / 2); // 20

for (let i = 0; i < LIGHT_COUNT; i++) {
  const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
  if (edgeDistance >= tiers) {
    console.error("BAD EDGE DISTANCE", i, edgeDistance);
  }
}
console.log("All edge distances are within bounds!");
