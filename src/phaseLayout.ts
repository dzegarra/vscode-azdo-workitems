/**
 * Layout of the mini timeline of a completed PR: the widths of the bands (with a minimum so that short phases stay
 * visible) and where the events fall on them. Pure, so no "vscode" import
 */

export interface BandLayout {
  /** Position of the left edge and width, as fractions (0 to 1) of the track */
  from: number;
  width: number;
}

/** Fraction of the track that even an empty phase takes */
export const MIN_BAND_SHARE = 0.04;

/** Bands in order covering the whole track: each takes at least `minimum`, the rest is shared by the real shares */
export function layoutBands(shares: readonly number[], minimum = MIN_BAND_SHARE): BandLayout[] {
  if (!shares.length) {
    return [];
  }
  const floor = Math.min(minimum, 1 / shares.length);
  const widths = shares.map((share) => Math.max(0, share));
  const sum = widths.reduce((total, width) => total + width, 0);
  const natural = sum > 0 ? widths.map((width) => width / sum) : widths.map(() => 1 / shares.length);
  const small = natural.filter((width) => width < floor).length;
  const roomLeft = 1 - small * floor;
  const bigSum = natural.filter((width) => width >= floor).reduce((total, width) => total + width, 0);
  let from = 0;
  return natural.map((width) => {
    const adjusted = width < floor ? floor : (width / bigSum) * roomLeft;
    const band = { from, width: adjusted };
    from += adjusted;
    return band;
  });
}

/** Where an event falls on the track: its position among the real shares, moved onto the adjusted bands */
export function eventPosition(share: number, shares: readonly number[], bands: readonly BandLayout[]): number {
  let start = 0;
  for (let index = 0; index < shares.length; index += 1) {
    const end = start + shares[index];
    if (share <= end || index === shares.length - 1) {
      const inside = shares[index] > 0 ? Math.min(1, Math.max(0, (share - start) / shares[index])) : 0;
      return bands[index].from + inside * bands[index].width;
    }
    start = end;
  }
  return 0;
}
