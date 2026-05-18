import { describe, it, expect } from 'vitest';
import { computeResults, extractBondParams } from './calc';
import type { BondData, CalcParams } from './types';

function makeBond(overrides: Partial<BondData> = {}): BondData {
  return {
    SECID: 'SU26248RMFS4',
    ISIN: 'RU000A106DZ4',
    SHORTNAME: 'ОФЗ 26248',
    BOARDID: 'TQCB',
    NOMINAL: 1000,
    FACEVALUE: 1000,
    MATDATE: '2030-05-17',
    NEXTCOUPON: '2025-11-20',
    COUPONPERCENT: 12,
    COUPONPERIOD: 182,
    ACCRUEDINT: 20,
    CURRENCY: 'RUB',
    NAME: 'ОФЗ 26248',
    EMITENT_FULL_NAME_RU: 'Минфин России',
    ...overrides,
  } as unknown as BondData;
}

const defaultParams: CalcParams = {
  investment: 300000,
  nominal: 1000,
  pricePercent: 100,
  nkd: 20,
  couponRate: 12,
  couponFrequency: 2,
  purchaseDate: '2025-05-17',
  maturityDate: '2030-05-17',
  taxRate: 13,
  commission: 0.05,
  nextCouponDate: '2025-11-20',
};

describe('extractBondParams', () => {
  it('extracts params from a bond', () => {
    const bond = makeBond();
    const p = extractBondParams(bond);
    expect(p.nominal).toBe(1000);
    expect(p.couponRate).toBe(12);
    expect(p.couponFrequency).toBe(2);
    expect(p.maturityDate).toBe('2030-05-17');
  });

  it('falls back to NOMINAL when FACEVALUE is missing', () => {
    const bond = makeBond({ FACEVALUE: undefined, NOMINAL: 500 });
    const p = extractBondParams(bond);
    expect(p.nominal).toBe(500);
  });

  it('computes couponRate from COUPONVALUE if COUPONPERCENT is 0', () => {
    const bond = makeBond({ COUPONPERCENT: 0, COUPONVALUE: 60, NOMINAL: 1000 });
    const p = extractBondParams(bond);
    expect(p.couponRate).toBeCloseTo(12, 1);
  });
});

describe('computeResults', () => {
  it('returns null for invalid params', () => {
    const invalid: CalcParams = { ...defaultParams, nominal: 0 };
    expect(computeResults(makeBond(), invalid)).toBeNull();
  });

  it('returns null for empty maturity', () => {
    const invalid: CalcParams = { ...defaultParams, maturityDate: '' };
    expect(computeResults(makeBond({ MATDATE: '', MATURITYDATE: '' }), invalid)).toBeNull();
  });

  it('returns null when maturity before purchase', () => {
    const invalid: CalcParams = { ...defaultParams, maturityDate: '2020-01-01' };
    expect(computeResults(makeBond({ MATDATE: '2020-01-01' }), invalid)).toBeNull();
  });

  it('calculates basic metrics for a bond at par with zero NKD', () => {
    const couponDates = [
      '2025-11-20', '2026-05-21', '2026-11-19', '2027-05-20',
      '2027-11-19', '2028-05-18', '2028-11-17', '2029-05-18',
      '2029-11-16', '2030-05-17',
    ];
    const bond = makeBond({
      coupons: couponDates.map(d => ({ coupondate: d, value: 60 })),
    });
    const params: CalcParams = {
      ...defaultParams,
      pricePercent: 100,
      nkd: 0,
      commission: 0,
      taxRate: 0,
    };
    const r = computeResults(bond, params)!;
    expect(r).not.toBeNull();
    expect(r.bondCount).toBe(300);
    expect(r.cleanPrice).toBe(1000);
    expect(r.dirtyPrice).toBe(1000);
    expect(r.ytm).toBeCloseTo(12, 0);
    expect(r.paybackMonths).toBe(0);
  });

  it('calculates YTM including commission', () => {
    const bond = makeBond();
    const params: CalcParams = {
      ...defaultParams,
      pricePercent: 100,
      nkd: 0,
      commission: 1,
      taxRate: 0,
    };
    const r = computeResults(bond, params)!;
    expect(r.ytm).toBeLessThan(12);
  });

  it('calculates paybackDate when premium exists', () => {
    const bond = makeBond();
    const params: CalcParams = {
      ...defaultParams,
      pricePercent: 105,
      nkd: 0,
      taxRate: 0,
    };
    const r = computeResults(bond, params)!;
    expect(r.paybackMonths).not.toBeNull();
    expect(r.paybackMonths!).toBeGreaterThan(0);
  });

  it('returns negative YTM for extreme premium', () => {
    const bond = makeBond();
    const params: CalcParams = {
      ...defaultParams,
      pricePercent: 200,
      nkd: 0,
      commission: 0,
      taxRate: 0,
    };
    const r = computeResults(bond, params)!;
    expect(r.ytm).toBeLessThan(0);
  });

  it('handles zero commission', () => {
    const bond = makeBond();
    const params: CalcParams = {
      ...defaultParams,
      commission: 0,
      taxRate: 0,
    };
    const r = computeResults(bond, params)!;
    expect(r.commissionAmount).toBe(0);
    expect(r.netProfit).toBeGreaterThan(0);
  });
});
