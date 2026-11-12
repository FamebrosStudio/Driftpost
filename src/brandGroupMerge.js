// When platform matching creates adjacent groups around the same connection
// (for example Facebook→Instagram and Instagram→YouTube), collapse them into
// one brand card so no connected account is displayed or selected twice.
export function mergeOverlappingBrandGroups(brands) {
  for (let i = 0; i < brands.length; i++) {
    for (let j = i + 1; j < brands.length;) {
      const primary = brands[i];
      const secondary = brands[j];
      const primaryIds = Object.values(primary.map || {});
      const secondaryIds = Object.values(secondary.map || {});
      const overlaps = secondaryIds.some((id) => primaryIds.includes(id));
      const conflicts = Object.entries(secondary.map || {}).some(([platform, id]) =>
        primary.map?.[platform] && primary.map[platform] !== id,
      );
      if (!overlaps || conflicts) {
        j++;
        continue;
      }
      primary.map = { ...secondary.map, ...primary.map };
      primary.keys = [...new Set([...(primary.keys || [primary.key]), ...(secondary.keys || [secondary.key])].filter(Boolean))];
      brands.splice(j, 1);
    }
  }
  return brands;
}
