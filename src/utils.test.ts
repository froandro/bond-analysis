import { describe, it, expect } from 'vitest';
import {
  calculateYTM, isFloatingCoupon, normalizeCurrency,
  getCurrencySymbol, getDaysBetween, clamp,
  getDefaultInvestment,
} from './utils';

describe('calculateYTM', () => {
  it('returns NaN for less than 2 cash flows', () => {
    expect(calculateYTM([100], [new Date()], new Date())).toBeNaN();
  });

  it('returns ~10% for a simple annual bond', () => {
    const purchase = new Date('2025-01-01');
    const dates = [purchase, new Date('2026-01-01')];
    const flows = [-100, 110];
    const ytm = calculateYTM(flows, dates, purchase);
    expect(ytm).toBeCloseTo(10, 0);
  });

  it('returns ~0% when return equals investment', () => {
    const purchase = new Date('2025-01-01');
    const dates = [purchase, new Date('2026-01-01')];
    const flows = [-100, 100];
    const ytm = calculateYTM(flows, dates, purchase);
    expect(ytm).toBeCloseTo(0, 0);
  });

  it('handles multiple cash flows (coupon bond)', () => {
    const purchase = new Date('2025-01-01');
    const dates = [
      purchase,
      new Date('2025-07-01'),
      new Date('2026-01-01'),
    ];
    const flows = [-950, 50, 1000];
    const ytm = calculateYTM(flows, dates, purchase);
    expect(ytm).toBeGreaterThan(5);
    expect(ytm).toBeLessThan(20);
  });
});

describe('isFloatingCoupon', () => {
  it('detects floating from bond type', () => {
    expect(isFloatingCoupon('FLOATING')).toBe(true);
    expect(isFloatingCoupon('FLOAT')).toBe(true);
    expect(isFloatingCoupon('VARIABLE')).toBe(true);
    expect(isFloatingCoupon('FIXED')).toBe(false);
  });

  it('detects floating from Russian keywords', () => {
    expect(isFloatingCoupon('ПЛАВ')).toBe(true);
    expect(isFloatingCoupon('ПЕРЕМ')).toBe(true);
  });

  it('detects floating from name with Russian prefix', () => {
    expect(isFloatingCoupon(undefined, undefined, undefined, 'ПК-123')).toBe(true);
  });

  it('returns false for fixed bonds', () => {
    expect(isFloatingCoupon('FIXED', 'CLASSIC')).toBe(false);
  });

  it('returns false when nothing is provided', () => {
    expect(isFloatingCoupon()).toBe(false);
  });

  it('detects floating from coupon variance', () => {
    const coupons = [{ value: 50 }, { value: 52 }, { value: 51 }];
    expect(isFloatingCoupon(undefined, undefined, undefined, undefined, coupons)).toBe(false);
    const varying = [{ value: 50 }, { value: 100 }];
    // needs shortName (or any non-type info) to reach coupon variance check
    expect(isFloatingCoupon(undefined, undefined, undefined, 'SOME BOND', varying)).toBe(true);
  });
});

describe('normalizeCurrency', () => {
  it('normalizes RUB variants', () => {
    expect(normalizeCurrency('RUB')).toBe('RUB');
    expect(normalizeCurrency('SUR')).toBe('RUB');
    expect(normalizeCurrency('RUR')).toBe('RUB');
  });

  it('normalizes USD variants', () => {
    expect(normalizeCurrency('USD')).toBe('USD');
    expect(normalizeCurrency('USD_США')).toBe('USD');
  });

  it('returns default for empty', () => {
    expect(normalizeCurrency('')).toBe('RUB');
  });
});

describe('getCurrencySymbol', () => {
  it('returns correct symbols', () => {
    expect(getCurrencySymbol('RUB')).toBe('₽');
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('EUR')).toBe('€');
  });
});

describe('getDaysBetween', () => {
  it('calculates days between dates', () => {
    const d1 = new Date('2025-01-01');
    const d2 = new Date('2025-01-11');
    expect(getDaysBetween(d1, d2)).toBe(10);
  });
});

describe('clamp', () => {
  it('clamps values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('getDefaultInvestment', () => {
  it('returns sensible defaults', () => {
    expect(getDefaultInvestment('RUB')).toBe(300000);
    expect(getDefaultInvestment('USD')).toBe(3000);
    expect(getDefaultInvestment('EUR')).toBe(3000);
  });
});
