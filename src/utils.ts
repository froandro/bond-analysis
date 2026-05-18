export const TOOLTIPS = {
  ytm: "Доходность к погашению с учётом реинвестирования купонов",
  netYield: "YTM за вычетом налога на купоны",
  currentYield: "Годовой купон / текущая цена (без реинвестирования)",
  simpleYield: "Купон / номинал (не учитывает цену покупки)",
  payback: "За сколько месяцев купоны покроют премию над номиналом",
  price: "Сумма, которую вернут при погашении",
  cleanPrice: "Стоимость облигации без НКД",
  dirtyPrice: "Чистая цена + НКД",
  nkd: "Накопленный купон, который платите продавцу",
  commission: "Обычно 0.01-0.1% от сделки",
  tax: "13% для резидентов, 0% для ИИС типа Б",
  coupon: "Выплата владельцам 2-4 раза в год",
  capitalGain: "Разница номинал − цена покупки",
  netProfit: "Купоны + номинал − все расходы"
};

export const DAYS_IN_YEAR = 365;
export const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

let _cachedRates: Record<string, number> | null = null;
let _lastRateFetch = 0;
const RATE_CACHE_TTL = 60 * 60 * 1000;

export async function fetchExchangeRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_cachedRates && now - _lastRateFetch < RATE_CACHE_TTL) return _cachedRates;
  try {
    const resp = await fetch(CBR_URL);
    const data = await resp.json();
    const rates: Record<string, number> = { RUB: 1 };
    for (const [code, val] of Object.entries(data.Valute as Record<string, { Value: number; Nominal: number }>)) {
      rates[code] = val.Value / val.Nominal;
    }
    _cachedRates = rates;
    _lastRateFetch = now;
    return rates;
  } catch {
    return { RUB: 1 };
  }
}

export function getDefaultInvestment(curr: string): number {
  switch (curr) {
    case 'RUB': return 300000;
    case 'USD': return 3000;
    case 'EUR': return 3000;
    case 'CNY': return 20000;
    case 'XAU': return 100;
    default: return 300000;
  }
}

export async function convertInvestment(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const rates = await fetchExchangeRates();
  const fromRub = from === 'RUB' ? amount : amount * (rates[from] || 0);
  const result = to === 'RUB' ? fromRub : fromRub / (rates[to] || 1);
  if (isNaN(result) || !isFinite(result) || result <= 0) return getDefaultInvestment(to);
  const magnitude = Math.pow(10, Math.floor(Math.log10(result)) - 1);
  return Math.round(result / Math.max(magnitude, 1)) * Math.max(magnitude, 1) || getDefaultInvestment(to);
}

export function getDaysBetween(date1: Date, date2: Date) {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function normalizeCurrency(curr: string) {
  if (!curr) return 'RUB';
  const c = curr.toUpperCase();
  if (c === 'SUR' || c === 'RUB' || c === 'RUB_РФ' || c === 'RUR') return 'RUB';
  if (c === 'USD' || c === 'USD_США') return 'USD';
  if (c === 'EUR' || c === 'EUR_ЕВРО') return 'EUR';
  if (c === 'CNY' || c === 'CNY_КИТАЙ' || c === 'CNY_CNH') return 'CNY';
  if (c === 'GLD' || c === 'XAU' || c === 'RUB_GOLD' || c === 'ГРАММ') return 'XAU';
  return c;
}

export function getCurrencySymbol(curr: string) {
  switch (curr) {
    case 'RUB': return '\u20BD';
    case 'USD': return '$';
    case 'EUR': return '\u20AC';
    case 'CNY': return '\u00A5';
    case 'XAU': return 'Au (\u0433)';
    default: return curr;
  }
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function isFloatingCoupon(
  bondType?: string, bondSubType?: string, couponType?: string,
  shortName?: string, coupons?: { value?: number }[]
): boolean {
  if (!bondType && !bondSubType && !couponType && !shortName) return false;

  const t = (bondType || bondSubType || couponType || '').toUpperCase();

  // MOEX type fields explicitly indicate floating
  if (t.includes('FLOAT') || t.includes('VARIABLE') || t.includes('CPI') || t.includes('INDEX') ||
      t.includes('\u041F\u041B\u0410\u0412') || t.includes('\u041F\u0415\u0420\u0415\u041C')) return true;

  // MOEX type fields exist but don't indicate floating — trust MOEX classification
  if (bondType || bondSubType || couponType) return false;

  // No MOEX type info: fallback to name + coupon variance heuristics
  const name = (shortName || '').toUpperCase();
  if (name.includes('\u041F\u041B\u0410\u0412') || name.includes('\u041F\u0415\u0420\u0415\u041C') ||
      name.includes('\u0424\u041B\u041E\u0410\u0422') || name.includes('PK-') || name.includes('\u041F\u041A-') ||
      name.includes('FLOAT') || name.includes('VARIABLE')) return true;

  if (coupons && coupons.length > 1) {
    const vals = coupons.map(c => c.value).filter((v): v is number => v !== undefined && v > 0);
    if (vals.length > 1) {
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      if (max / min > 1.01) return true;
    }
  }
  return false;
}

export function getBondTypeLabel(bondType?: string, bondSubType?: string): string {
  const type = (bondType || bondSubType || '').toUpperCase();
  if (!type) return '';
  switch (type) {
    case 'FIXED': return '\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u044B\u0439';
    case 'FLOATING': case 'FLOAT': case 'VARIABLE': return '\u0424\u043B\u043E\u0430\u0442\u0435\u0440';
    case 'AMORTIZE': case 'AMORTIZATION': case 'AMORTIZIRUEM': case 'AMORTIZIRUYEM': return '\u0410\u043C\u043E\u0440\u0442\u0438\u0437\u0430\u0446\u0438\u044F';
    case 'STEP': return '\u0421\u0442\u0443\u043F\u0435\u043D\u0447\u0430\u0442\u044B\u0439';
    case 'CALLABLE': return '\u041A\u043E\u043B\u043B';
    case 'PUTTABLE': return '\u041F\u0443\u0442';
    case 'CPI': case 'INDEXED': return '\u0418\u043D\u0434\u0435\u043A\u0441\u0430\u0446\u0438\u044F';
    case 'CLASSIC': return '\u041A\u043B\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043A\u0438\u0439';
    default: return type;
  }
}

export function calculateYTM(cashFlows: number[], dates: Date[], purchaseDate: Date) {
  if (cashFlows.length < 2) return NaN;

  const npv = (rate: number) => {
    let sum = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const years = (dates[i].getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * DAYS_IN_YEAR);
      sum += cashFlows[i] / Math.pow(1 + rate / 100, years);
    }
    return sum;
  };

  let low = -50;
  let high = 200;
  let npvLow = npv(low);
  let npvHigh = npv(high);

  if (npvLow * npvHigh > 0) {
    for (const mult of [3, 10, 50]) {
      low = -mult * 100;
      high = mult * 100;
      npvLow = npv(low);
      npvHigh = npv(high);
      if (npvLow * npvHigh < 0) break;
    }
    if (npvLow * npvHigh > 0) return NaN;
  }

  for (let iter = 0; iter < 500; iter++) {
    const mid = (low + high) / 2;
    const val = npv(mid);
    if (Math.abs(val) < 0.01 || (high - low) / 2 < 1e-8) return mid;
    if (val * npvLow < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = val;
    }
  }

  return (low + high) / 2;
}
