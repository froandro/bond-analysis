import { z } from 'zod';

const optionalNumber = z.number().optional().nullable().transform(v => v ?? undefined);
const optionalString = z.string().optional().nullable().transform(v => v ?? undefined);

export const MoexCouponSchema = z.object({
  value: optionalNumber,
  coupondate: optionalString,
}).passthrough();

export const BondDataSchema = z.object({
  SECID: z.string().min(1),
  ISIN: z.string().min(1).optional().default(''),
  SHORTNAME: z.string().optional().default(''),
  BOARDID: z.string().optional().default(''),
  NOMINAL: optionalNumber,
  INITIALNOMINAL: optionalNumber,
  FACEVALUE: optionalNumber,
  COUPONVALUE: optionalNumber,
  COUPONPERCENT: optionalNumber,
  MATDATE: z.string().optional().default(''),
  MATURITYDATE: optionalString,
  ACCRUEDINT: optionalNumber,
  NEXTCOUPON: z.string().optional().default(''),
  COUPONPERIOD: optionalNumber,
  COUPONPERCENT_DECIMAL: optionalNumber,
  CURRENCY: optionalString,
  CURRENCYID: optionalString,
  FACEUNIT: optionalString,
  INITIALFACEVALUE: optionalNumber,
  FACEVALUE_CURRENCY: optionalString,
  NAME: z.string().optional().default(''),
  EMITENT_FULL_NAME_RU: z.string().optional().default(''),
  DURATION: optionalNumber,
  ZSPREAD: optionalNumber,
  GSPREAD: optionalNumber,
  BONDTYPE: optionalString,
  BONDSUBTYPE: optionalString,
  COUPONTYPE: optionalString,
  OFFERDATE: optionalString,
  OFFERPRICE: optionalNumber,
  CALLOPTIONDATE: optionalString,
  PUTOPTIONDATE: optionalString,
  BUYBACKDATE: optionalString,
  BUYBACKPRICE: optionalNumber,
  ACTUAL_PRICE: optionalNumber,
  PREVPRICE: optionalNumber,
  LAST: optionalNumber,
  WAPRICE: optionalNumber,
  LCURRENTPRICE: optionalNumber,
  LCLOSEPRICE: optionalNumber,
}).passthrough();

export const SearchResultSchema = z.object({
  secid: optionalString,
  SECID: optionalString,
  shortname: optionalString,
  SHORTNAME: optionalString,
  primary_boardid: optionalString,
  BOARDID: optionalString,
  isin: optionalString,
  ISIN: optionalString,
  group: optionalString,
  type: optionalString,
}).passthrough();

export type ParsedBondData = z.infer<typeof BondDataSchema>;
export type ParsedSearchResult = z.infer<typeof SearchResultSchema>;
export type ParsedMoexCoupon = z.infer<typeof MoexCouponSchema>;

export function parseBondData(raw: Record<string, unknown>): ParsedBondData | null {
  const result = BondDataSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data;
}

export function parseSearchResult(raw: Record<string, unknown>): ParsedSearchResult | null {
  const result = SearchResultSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data;
}

export function parseMoexCoupon(raw: Record<string, unknown>): ParsedMoexCoupon | null {
  const result = MoexCouponSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data;
}