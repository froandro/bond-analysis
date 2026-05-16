import type { BondData, CalcParams, Results } from './types';
import { getDaysBetween, calculateYTM, isFloatingCoupon } from './utils';

export function extractBondParams(bond: BondData) {
  const nom = Number(Number(bond.FACEVALUE || bond.NOMINAL || bond.INITIALFACEVALUE || 1000).toFixed(2));
  const priceVal = Number(Number(bond.LAST || bond.WAPRICE || bond.LCURRENTPRICE || bond.LCLOSEPRICE || bond.PREVPRICE || 100).toFixed(2));
  const frequency = Math.round(365.25 / (Number(bond.COUPONPERIOD) || 91)) || 4;
  let couponVal = Number(bond.COUPONPERCENT || 0);
  const couponValueAbs = Number(bond.COUPONVALUE || 0);
  if (couponVal === 0 && couponValueAbs > 0 && nom > 0) {
    couponVal = (couponValueAbs / nom) * (frequency || 1) * 100;
  }
  return {
    nominal: nom,
    pricePercent: priceVal,
    nkd: Number(Number(bond.ACCRUEDINT || 0).toFixed(2)),
    couponRate: couponVal,
    couponFrequency: frequency,
    maturityDate: bond.MATDATE || bond.MATURITYDATE || '',
    nextCouponDate: bond.NEXTCOUPON || '',
  };
}

export function computeResults(bond: BondData | null, params: CalcParams): Results | null {
  const {
    investment, nominal, pricePercent, nkd, couponRate, couponFrequency,
    purchaseDate, maturityDate, taxRate, commission, nextCouponDate
  } = params;

  if (!maturityDate || isNaN(nominal) || isNaN(pricePercent) || nominal <= 0) return null;

  const purchase = new Date(purchaseDate);
  const maturity = new Date(maturityDate || bond?.MATURITYDATE || '');
  if (!maturityDate && !bond?.MATURITYDATE) return null;
  if (maturity <= purchase) return null;

  const daysToMat = getDaysBetween(purchase, maturity);
  const cleanPriceVal = nominal * (pricePercent / 100);
  const dirtyPriceVal = cleanPriceVal + nkd;

  const cleanPriceOne = nominal * (pricePercent / 100);
  const dirtyPriceOne = cleanPriceOne + nkd;
  const commOne = dirtyPriceOne * (commission / 100);
  const totalCostOne = dirtyPriceOne + commOne;

  let bondCountVal = Math.floor(investment / (dirtyPriceVal * (1 + commission / 100)));
  if (bondCountVal <= 0) return null;

  const totalCostVal = bondCountVal * dirtyPriceVal;
  const commissionVal = totalCostVal * (commission / 100);
  const totalCostWithComm = totalCostVal + commissionVal;
  const remainderVal = Math.max(0, investment - totalCostWithComm);

  const couponFreqVal = Math.max(1, couponFrequency);
  const couponPeriodDays = Math.round(365.25 / couponFreqVal);

  const isFloater = bond ? isFloatingCoupon(bond.BONDTYPE, bond.BONDSUBTYPE, bond.COUPONTYPE, bond.SHORTNAME, bond.coupons) : false;

  const events: { date: Date; type: string; value: number }[] = [];

  const amortSchedule: { date: Date; value: number }[] = [];
  if (bond?.amortizations && bond.amortizations.length > 0) {
    bond.amortizations.forEach(a => {
      const d = new Date(String(a.amortdate));
      if (d > purchase) {
        amortSchedule.push({ date: d, value: Number(a.value) });
        if (d < maturity) {
          events.push({ date: d, type: 'amortization', value: Number(a.value) });
        }
      }
    });
  }
  amortSchedule.sort((a, b) => a.date.getTime() - b.date.getTime());

  if (bond?.coupons && bond.coupons.length > 0) {
    bond.coupons.forEach(c => {
      const d = new Date(String(c.coupondate));
      if (d > purchase && d <= maturity) {
        events.push({ date: d, type: 'coupon', value: Number(c.value) });
      }
    });

    const lastKnownCouponDate = new Date(Math.max(...bond.coupons.map(c => new Date(String(c.coupondate)).getTime())));
    if (lastKnownCouponDate < maturity) {
      const knownCoupons = bond.coupons.filter(c => Number(c.value) > 0);
      const lastCouponValue = knownCoupons.length > 0 ? Number(knownCoupons[knownCoupons.length - 1].value) : 0;
      let currentNext = new Date(lastKnownCouponDate);
      currentNext.setDate(currentNext.getDate() + couponPeriodDays);
      let safety = 0;
      while (currentNext <= maturity && safety < 100) {
        const paidAmort = amortSchedule.filter(a => a.date < currentNext).reduce((sum, a) => sum + a.value, 0);
        const nominalAtDate = Math.max(0, nominal - paidAmort);
        const cVal = isFloater && lastCouponValue > 0 ? lastCouponValue : nominalAtDate * (couponRate / 100) / couponFreqVal;
        events.push({ date: new Date(currentNext), type: 'coupon', value: cVal });
        currentNext.setDate(currentNext.getDate() + couponPeriodDays);
        safety++;
      }
    }
  } else {
    let currentCoupon = nextCouponDate ? new Date(nextCouponDate) : new Date(purchase);
    if (!nextCouponDate) currentCoupon.setDate(currentCoupon.getDate() + couponPeriodDays);

    let s1 = 0;
    while (currentCoupon <= purchase && s1 < 50) {
      currentCoupon.setDate(currentCoupon.getDate() + couponPeriodDays);
      s1++;
    }

    let safetyCounter = 0;
    while (currentCoupon <= maturity && safetyCounter < 500) {
      const paidAmort = amortSchedule.filter(a => a.date < currentCoupon).reduce((sum, a) => sum + a.value, 0);
      const nominalAtDate = Math.max(0, nominal - paidAmort);
      events.push({ date: new Date(currentCoupon), type: 'coupon', value: nominalAtDate * (couponRate / 100) / couponFreqVal });
      currentCoupon.setDate(currentCoupon.getDate() + couponPeriodDays);
      safetyCounter++;
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  const couponCountVal = events.filter(e => e.type === 'coupon').length;
  let totalNetCoupons = 0;

  const cashFlows: number[] = [-totalCostOne];
  const cfDates: Date[] = [purchase];
  const netCashFlows: number[] = [-totalCostOne];

  let currentNominal = nominal;
  let ytmCumulativeAccum = 0;
  let ytmNkdUsedForTax = nkd;
  const ytmTotalOverpaymentVal = (dirtyPriceOne - nominal);
  let ytmPaybackDate: string | null = ytmTotalOverpaymentVal <= 0 ? purchase.toISOString().split('T')[0] : null;

  const portCashFlows: number[] = [-totalCostWithComm];
  const portCfDates: Date[] = [purchase];
  const netPortCashFlows: number[] = [-totalCostWithComm];
  const portChartData: Results['cashFlows'] = [{
    date: purchase.toISOString().split('T')[0],
    amount: 0,
    cumulative: 0,
    overpayment: (dirtyPriceVal - nominal) * bondCountVal,
    flow: -totalCostWithComm,
    type: 'OPEN',
    gross: 0,
    tax: 0
  }];
  let cumulativeAccum = 0;
  let totalTaxVal = 0;
  let totalGrossCoupons = 0;
  const totalOverpaymentVal = (dirtyPriceVal - nominal) * bondCountVal;
  let paybackDateVal: string | null = totalOverpaymentVal <= 0 ? purchase.toISOString().split('T')[0] : null;

  let nkdUsedForTax = nkd * bondCountVal;
  events.forEach(event => {
    if (event.type === 'coupon') {
      const cVal = event.value;
      const taxableAmount = Math.max(0, cVal - ytmNkdUsedForTax);
      const taxVal = taxableAmount * (taxRate / 100);
      ytmNkdUsedForTax = Math.max(0, ytmNkdUsedForTax - cVal);
      const netCVal = cVal - taxVal;
      ytmCumulativeAccum += netCVal;
      cashFlows.push(cVal);
      netCashFlows.push(netCVal);
      cfDates.push(event.date);

      const cValP = event.value * bondCountVal;
      const taxableAmountP = Math.max(0, cValP - nkdUsedForTax);
      const taxValP = taxableAmountP * (taxRate / 100);
      nkdUsedForTax = Math.max(0, nkdUsedForTax - cValP);
      const netCValP = cValP - taxValP;
      totalNetCoupons += netCValP;
      totalGrossCoupons += cValP;
      totalTaxVal += taxValP;
      cumulativeAccum += netCValP;
      portCashFlows.push(cValP);
      netPortCashFlows.push(netCValP);
      portCfDates.push(event.date);
      portChartData.push({ date: event.date.toISOString().split('T')[0], amount: netCValP, cumulative: cumulativeAccum, overpayment: totalOverpaymentVal, flow: netCValP, type: 'COUPON', gross: cValP, tax: taxValP });
    } else if (event.type === 'amortization') {
      const aVal = event.value;
      currentNominal -= event.value;
      ytmCumulativeAccum += aVal;
      cashFlows.push(aVal);
      netCashFlows.push(aVal);
      cfDates.push(event.date);

      const aValP = event.value * bondCountVal;
      cumulativeAccum += aValP;
      portCashFlows.push(aValP);
      netPortCashFlows.push(aValP);
      portCfDates.push(event.date);
      portChartData.push({ date: event.date.toISOString().split('T')[0], amount: aValP, cumulative: cumulativeAccum, overpayment: totalOverpaymentVal, flow: aValP, type: 'AMORTIZATION', gross: aValP, tax: 0 });
    }

    if (!ytmPaybackDate && ytmCumulativeAccum >= ytmTotalOverpaymentVal) {
      ytmPaybackDate = event.date.toISOString().split('T')[0];
    }
    if (!paybackDateVal && cumulativeAccum >= totalOverpaymentVal) {
      paybackDateVal = event.date.toISOString().split('T')[0];
    }
  });

  const finalNominalPayout = currentNominal;
  const finalNominalPayoutP = currentNominal * bondCountVal;
  cashFlows.push(finalNominalPayout);
  netCashFlows.push(finalNominalPayout);
  cfDates.push(maturity);
  ytmCumulativeAccum += finalNominalPayout;

  portCashFlows.push(finalNominalPayoutP);
  netPortCashFlows.push(finalNominalPayoutP);
  portCfDates.push(maturity);
  cumulativeAccum += finalNominalPayoutP;
  portChartData.push({
    date: maturity.toISOString().split('T')[0],
    amount: finalNominalPayoutP,
    cumulative: cumulativeAccum,
    overpayment: totalOverpaymentVal,
    flow: finalNominalPayoutP,
    type: 'MATURITY',
    gross: finalNominalPayoutP,
    tax: 0
  });

  if (!ytmPaybackDate && ytmCumulativeAccum >= ytmTotalOverpaymentVal) {
    ytmPaybackDate = maturity.toISOString().split('T')[0];
  }
  if (!paybackDateVal && cumulativeAccum >= totalOverpaymentVal) {
    paybackDateVal = maturity.toISOString().split('T')[0];
  }

  let ytmVal = calculateYTM(cashFlows, cfDates, purchase);
  if (isNaN(ytmVal) || ytmVal < -99) ytmVal = 0;

  let netYieldVal = calculateYTM(netCashFlows, cfDates, purchase);
  if (isNaN(netYieldVal) || netYieldVal < -99) netYieldVal = 0;

  const capitalGainVal = (nominal * bondCountVal) - (cleanPriceVal * bondCountVal);
  const finalAmountVal = (nominal * bondCountVal) + totalNetCoupons;
  const netProfitVal = finalAmountVal - totalCostWithComm;

  const firstCoupon = events.find(e => e.type === 'coupon')?.value || (nominal * (couponRate / 100) / couponFreqVal);
  const netCouponPerPeriod = firstCoupon * (1 - (taxRate / 100));
  const annualNetCoupon = netCouponPerPeriod * couponFreqVal * bondCountVal;
  const paybackMonthsVal = !paybackDateVal ? -1 : (totalOverpaymentVal <= 0 ? 0 : (annualNetCoupon > 0 ? (totalOverpaymentVal / (annualNetCoupon / 12)) : 0));

  return {
    cleanPrice: cleanPriceVal,
    dirtyPrice: dirtyPriceVal,
    bondCount: bondCountVal,
    totalCost: totalCostVal,
    remainder: remainderVal,
    periodCoupon: firstCoupon,
    netCoupon: firstCoupon * (1 - (taxRate / 100)),
    annualCoupon: firstCoupon * couponFreqVal,
    netAnnualTotal: annualNetCoupon,
    totalOverpayment: totalOverpaymentVal,
    currentYield: ((firstCoupon * couponFreqVal) / cleanPriceVal) * 100,
    simpleYield: (firstCoupon * couponFreqVal / nominal) * 100,
    ytm: ytmVal,
    netYield: netYieldVal,
    totalCouponToMaturity: totalNetCoupons,
    finalAmount: finalAmountVal,
    netProfit: netProfitVal,
    commissionAmount: commissionVal,
    totalTaxPaid: totalTaxVal,
    daysToMaturity: daysToMat,
    couponCount: couponCountVal,
    paybackMonths: paybackMonthsVal,
    paybackDate: paybackDateVal,
    capitalGain: capitalGainVal,
    grossCouponTotal: totalGrossCoupons,
    isFloatingCoupon: isFloater,
    knownCouponsOnly: false,
    cashFlows: portChartData
  };
}
