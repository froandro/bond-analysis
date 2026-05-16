export interface MoexRow {
  [key: string]: unknown;
}

export interface MoexTable<T = MoexRow> {
  columns: string[];
  data: unknown[][];
}

export interface MoexResponse {
  securities?: MoexTable;
  marketdata?: MoexTable;
  boards?: MoexTable;
  amortizations?: MoexTable;
  coupons?: MoexTable;
  [key: string]: unknown;
}

export interface BondData {
  SECID: string;
  ISIN: string;
  SHORTNAME: string;
  BOARDID: string;
  NOMINAL?: number;
  INITIALNOMINAL?: number;
  FACEVALUE?: number;
  COUPONVALUE?: number;
  COUPONPERCENT?: number;
  MATDATE: string;
  MATURITYDATE?: string;
  ACCRUEDINT: number;
  NEXTCOUPON: string;
  COUPONPERIOD: number;
  CURRENCY?: string;
  CURRENCYID?: string;
  FACEUNIT?: string;
  INITIALFACEVALUE?: number;
  FACEVALUE_CURRENCY?: string;
  NAME: string;
  EMITENT_FULL_NAME_RU: string;
  DURATION?: number;
  ZSPREAD?: number;
  GSPREAD?: number;
  BONDTYPE?: string;
  BONDSUBTYPE?: string;
  COUPONTYPE?: string;
  ACTUAL_PRICE?: number;
  PREVPRICE?: number;
  LAST?: number;
  WAPRICE?: number;
  LCURRENTPRICE?: number;
  LCLOSEPRICE?: number;
  amortizations?: MoexCoupon[];
  coupons?: MoexCoupon[];
  [key: string]: unknown;
}

export interface MoexCoupon {
  value?: number;
  coupondate?: string;
  [key: string]: unknown;
}

export interface CashFlow {
  date: string;
  amount: number;
  cumulative: number;
  overpayment: number;
  flow: number;
  type: string;
  gross: number;
  tax: number;
}

export interface Results {
  cleanPrice: number;
  dirtyPrice: number;
  bondCount: number;
  totalCost: number;
  remainder: number;
  periodCoupon: number;
  netCoupon: number;
  annualCoupon: number;
  netAnnualTotal: number;
  totalOverpayment: number;
  currentYield: number;
  simpleYield: number;
  ytm: number;
  netYield: number;
  totalCouponToMaturity: number;
  finalAmount: number;
  netProfit: number;
  commissionAmount: number;
  totalTaxPaid: number;
  daysToMaturity: number;
  couponCount: number;
  paybackMonths: number;
  paybackDate: string | null;
  capitalGain: number;
  grossCouponTotal: number;
  isFloatingCoupon: boolean;
  knownCouponsOnly: boolean;
  cashFlows: CashFlow[];
}

export interface SearchResult {
  secid?: string;
  SECID?: string;
  shortname?: string;
  SHORTNAME?: string;
  primary_boardid?: string;
  BOARDID?: string;
  isin?: string;
  ISIN?: string;
  group?: string;
  type?: string;
  [key: string]: unknown;
}

export interface BondTypeCache {
  type: string;
  couponPercent: number;
}

export type EventType = 'coupon' | 'amortization';

export interface CalcEvent {
  date: Date;
  type: EventType;
  value: number;
}

export interface AmortScheduleItem {
  date: Date;
  value: number;
}

export interface CalcParams {
  investment: number;
  nominal: number;
  pricePercent: number;
  nkd: number;
  couponRate: number;
  couponFrequency: number;
  purchaseDate: string;
  maturityDate: string;
  taxRate: number;
  commission: number;
  nextCouponDate: string;
}

export interface ComparisonEntry {
  id: string;
  bond: BondData;
  params: Pick<CalcParams, 'nominal' | 'pricePercent' | 'nkd' | 'couponRate' | 'couponFrequency' | 'maturityDate' | 'nextCouponDate'>;
}
