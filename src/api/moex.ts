import type { MoexCoupon } from '../types';

export const MOEX_BASE_URL = "https://iss.moex.com/iss";
export const MOEX_ENGINE = "stock";
export const MOEX_MARKET = "bonds";
export const MOEX_BOARDS = ["TQCB", "TQOB", "TQOS", "PACT", "TQBD"];

function rowsToObjects(data: unknown[][], columns: string[]): Record<string, unknown>[] {
  return data.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

export async function searchBonds(query: string): Promise<Record<string, unknown>[]> {
  const url = `${MOEX_BASE_URL}/securities.json?q=${encodeURIComponent(query)}&iss.meta=off&iss.only=securities`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (!json.securities?.data) return [];
  return rowsToObjects(json.securities.data, json.securities.columns);
}

export async function fetchBondBoards(secId: string): Promise<string[]> {
  const url = `${MOEX_BASE_URL}/securities/${secId}.json?iss.meta=off&iss.only=boards`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (!json.boards?.data) return [];
  const colIdx = json.boards.columns.indexOf('boardid');
  return json.boards.data.map((row: unknown[]) => String(row[colIdx]));
}

export async function fetchBondDetails(
  secId: string, board: string
): Promise<{ securities: Record<string, unknown>; marketdata: Record<string, unknown> }> {
  const url = `${MOEX_BASE_URL}/engines/${MOEX_ENGINE}/markets/${MOEX_MARKET}/boards/${board}/securities/${secId}.json?iss.meta=off`;
  const resp = await fetch(url);
  const json = await resp.json();

  const securities = json.securities?.data?.[0]
    ? rowsToObjects(json.securities.data, json.securities.columns)[0]
    : {};
  const marketdata = json.marketdata?.data?.[0]
    ? rowsToObjects(json.marketdata.data, json.marketdata.columns)[0]
    : {};

  return { securities, marketdata };
}

export async function fetchBondization(
  secId: string
): Promise<{ amortizations: Record<string, unknown>[]; coupons: MoexCoupon[] }> {
  const url = `${MOEX_BASE_URL}/statistics/engines/stock/markets/bonds/bondization/${secId}.json?iss.meta=off`;
  const resp = await fetch(url);
  const json = await resp.json();

  const amortizations = json.amortizations?.data
    ? rowsToObjects(json.amortizations.data, json.amortizations.columns)
    : [];
  const coupons = json.coupons?.data
    ? rowsToObjects(json.coupons.data, json.coupons.columns).map(c => ({
        ...c,
        value: Number(c.value),
        coupondate: String(c.coupondate)
      }))
    : [];

  return { amortizations, coupons };
}
