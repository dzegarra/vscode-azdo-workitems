import { describe, expect, it } from 'vitest';
import { eventPosition, layoutBands } from './phaseLayout';

describe('layoutBands', () => {
  it('keeps the shares when all are big enough', () => {
    const bands = layoutBands([0.25, 0.5, 0.25]);
    expect(bands.map((band) => band.width)).toEqual([0.25, 0.5, 0.25]);
    expect(bands.map((band) => band.from)).toEqual([0, 0.25, 0.75]);
  });

  it('gives an empty phase a minimum width and still fills the track', () => {
    const bands = layoutBands([0.6, 0.4, 0], 0.05);
    expect(bands[2].width).toBe(0.05);
    expect(bands.reduce((sum, band) => sum + band.width, 0)).toBeCloseTo(1);
    expect(bands[2].from + bands[2].width).toBeCloseTo(1);
  });

  it('shares the track evenly when there is no time at all', () => {
    expect(layoutBands([0, 0]).map((band) => band.width)).toEqual([0.5, 0.5]);
  });
});

describe('eventPosition', () => {
  const shares = [0.5, 0.5, 0];
  const bands = layoutBands(shares, 0.1);

  it('moves an event onto the adjusted band', () => {
    expect(eventPosition(0.25, shares, bands)).toBeCloseTo(0.225);
    expect(eventPosition(0.5, shares, bands)).toBeCloseTo(0.45);
  });

  it('puts an event at the end of the last band', () => {
    expect(eventPosition(1, shares, bands)).toBeCloseTo(0.9);
  });
});
