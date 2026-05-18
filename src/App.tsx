import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import {
  Search,
  Download,
  RotateCcw,
  Info,
  Calculator,
  BarChart3,
  Sun,
  Moon
} from 'lucide-react';
import {
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area
} from 'recharts';

import type { BondData, Results, MoexCoupon, CalcParams, ComparisonEntry } from './types';
import {
  TOOLTIPS, normalizeCurrency, getCurrencySymbol, clamp,
  isFloatingCoupon, getBondTypeLabel,
  convertInvestment
} from './utils';
import {
  MOEX_BOARDS, searchBonds, fetchBondBoards, fetchBondDetails, fetchBondization
} from './api/moex';
import { computeResults, extractBondParams } from './calc';
import { parseBondData, parseSearchResult, type ParsedSearchResult } from './validation';

function Tooltip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <div className="relative inline-block group">
      {children}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-3 rounded-xl text-[10px] leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 shadow-xl z-[100]"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
        {text}
      </div>
    </div>
  );
}

export default function App() {
  const [investment, setInvestment] = useState(300000);
  const [nominal, setNominal] = useState(1000);
  const [pricePercent, setPricePercent] = useState(100);
  const [nkd, setNkd] = useState(0);
  const [couponRate, setCouponRate] = useState(15);
  const [couponFrequency, setCouponFrequency] = useState(4);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [maturityDate, setMaturityDate] = useState('');
  const [taxRate, setTaxRate] = useState(13);
  const [commission, setCommission] = useState(0.05);
  const [nextCouponDate, setNextCouponDate] = useState('');
  const [bondSearch, setBondSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [selectedBond, setSelectedBond] = useState<BondData | null>(null);
  const [currency, setCurrency] = useState('RUB');
  const [isLoading, setIsLoading] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const bondTypeCacheRef = useRef<Map<string, { type: string; couponPercent: number }>>(new Map());
  const [comparisonList, setComparisonList] = useState<ComparisonEntry[]>([]);

  const addToComparison = useCallback(() => {
    if (!selectedBond) return;
    const id = selectedBond.SECID.toUpperCase();
    if (comparisonList.some(e => e.id === id)) return;
    const bp = extractBondParams(selectedBond);
    setComparisonList(prev => [...prev, { id, bond: selectedBond, params: bp }]);
  }, [selectedBond, comparisonList]);

  const removeComparison = useCallback((id: string) => {
    setComparisonList(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const securities = await searchBonds(query);
      const filtered = securities.filter((s) => {
        if (MOEX_BOARDS.includes(String(s.primary_boardid || ''))) return true;
        const bondGroups = ['stock_bonds'];
        const bondTypes = ['corporate_bond', 'government_bond', 'ofz_bond', 'exchange_bond', 'municipal_bond', 'subfederal_bond', 'euro_bond'];
        const group = String(s.group || '').toLowerCase();
        const type = String(s.type || '').toLowerCase();
        return bondGroups.includes(group) || bondTypes.includes(type);
      });
      setSearchResults(filtered.map(r => parseSearchResult(r)).filter((r): r is ParsedSearchResult => r !== null));
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectBond = useCallback(async (bond: Record<string, unknown>) => {
    setShowComparison(false);
    setIsLoading(true);
    setBondSearch(String(bond.isin || bond.secid || bond.shortname || ''));
    setSearchResults([]);

    try {
      const secId = String(bond.secid || bond.SECID || '');

      const boardsList = await fetchBondBoards(secId);
      let targetBoard = String(bond.primary_boardid || bond.BOARDID || '');
      const preferred = MOEX_BOARDS.find(b => boardsList.includes(b));
      if (preferred) targetBoard = preferred;
      else if (boardsList.length > 0) targetBoard = boardsList[0];

      const { securities: secData, marketdata: marketData } = await fetchBondDetails(secId, targetBoard);

      let amortizationData: Record<string, unknown>[] = [];
      let couponSchedule: MoexCoupon[] = [];
      try {
        const bzData = await fetchBondization(secId);
        amortizationData = bzData.amortizations;
        couponSchedule = bzData.coupons;
      } catch (bzErr) {
        console.warn('Bondization fetch failed:', bzErr);
      }

      if (!secData || Object.keys(secData).length === 0) {
        throw new Error('Security details not found');
      }

      const fullBondRaw = {
        ...secData,
        ...marketData,
        amortizations: amortizationData,
        coupons: couponSchedule
      };
      const fullBond = parseBondData(fullBondRaw);
      if (!fullBond) {
        throw new Error('Invalid bond data from MOEX');
      }
      setSelectedBond(fullBond);

      const bondKey = secId.toUpperCase();
      const cache = bondTypeCacheRef.current;
      cache.set(bondKey, {
        type: getBondTypeLabel(fullBond.BONDTYPE, fullBond.BONDSUBTYPE) || '',
        couponPercent: Number(fullBond.COUPONPERCENT || 0)
      });
      if (cache.size > 50) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }

      const bp = extractBondParams(fullBond);
      setNominal(bp.nominal);
      setPricePercent(bp.pricePercent);
      setNkd(bp.nkd);
      setCouponRate(bp.couponRate);
      setCouponFrequency(bp.couponFrequency);
      setMaturityDate(bp.maturityDate);
      setNextCouponDate(bp.nextCouponDate);

      let actualCurrency = String(fullBond.FACEUNIT || marketData.CURRENCYID || fullBond.CURRENCYID || fullBond.CURRENCY || '');

      const secName = (fullBond.NAME || '').toUpperCase();
      const secShort = (fullBond.SHORTNAME || '').toUpperCase();
      const sId = (secId || '').toUpperCase();
      if (secName.includes('GOLD') || secShort.includes('GOLD') || secName.includes('\u0417\u041E\u041B\u041E\u0422\u041E') || secShort.includes('\u0417\u041E\u041B\u041E\u0422\u041E') || sId.includes('GOLD')) {
        actualCurrency = 'XAU';
      }

      const prevCurrency = currency;
      const newCurrency = normalizeCurrency(actualCurrency);
      if (newCurrency !== prevCurrency) {
        setInvestment(await convertInvestment(investment, prevCurrency, newCurrency));
      }
      setCurrency(newCurrency);

      const secIdUpper = (secId || '').toUpperCase();
      if (secIdUpper.startsWith('SU') || fullBond.BONDSUBTYPE === 'GOVERNMENT') {
        setTaxRate(prev => prev !== 0 ? 0 : prev);
      } else {
        setTaxRate(prev => prev === 0 ? 13 : prev);
      }

    } catch (e) {
      console.error('Selection error:', e);
      alert('\u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B \u0438\u043B\u0438 \u043E\u0431\u043B\u0438\u0433\u0430\u0446\u0438\u044F \u043D\u0435 \u0442\u043E\u0440\u0433\u0443\u0435\u0442\u0441\u044F.');
    } finally {
      setIsLoading(false);
    }
  }, [currency, investment]);

  const calcParams: CalcParams = { investment, nominal, pricePercent, nkd, couponRate, couponFrequency, purchaseDate, maturityDate, taxRate, commission, nextCouponDate };

  const results: Results | null = useMemo(() =>
    computeResults(selectedBond, calcParams),
    [selectedBond, investment, nominal, pricePercent, nkd, couponRate, couponFrequency, purchaseDate, maturityDate, taxRate, commission, nextCouponDate]
  );

  const comparisonResults = useMemo(() =>
    comparisonList.map(entry => computeResults(entry.bond, { ...calcParams, ...entry.params })),
    [comparisonList, investment, taxRate, commission, purchaseDate]
  );

  const normDate = (raw?: string) => raw ? new Date(raw).toISOString().split('T')[0] : null;
  const isAfterPurchase = (d: string | null) => d && results && new Date(d) >= new Date(purchaseDate);

  const offerDateNorm = normDate(selectedBond?.OFFERDATE);
  const hasOffer = isAfterPurchase(offerDateNorm);
  const callDateNorm = normDate(selectedBond?.CALLOPTIONDATE);
  const hasCall = isAfterPurchase(callDateNorm);
  const putDateNorm = normDate(selectedBond?.PUTOPTIONDATE);
  const hasPut = isAfterPurchase(putDateNorm);

  const augmentedCashFlows = useMemo(() => {
    if (!results) return [];
    let copy = [...results.cashFlows];

    const addEvent = (dateNorm: string | null, cond: boolean, type: string) => {
      if (!cond || !dateNorm) return;
      const idx = copy.findIndex(cf => cf.date >= dateNorm);
      const prevCumul = idx > 0 ? copy[idx - 1].cumulative : 0;
      copy.splice(idx < 0 ? copy.length : idx, 0, {
        date: dateNorm,
        amount: 0, cumulative: prevCumul, overpayment: results.totalOverpayment, flow: 0, type, gross: 0, tax: 0
      });
    };

    addEvent(offerDateNorm, hasOffer, 'OFFER');
    addEvent(callDateNorm, hasCall, 'CALL');
    addEvent(putDateNorm, hasPut, 'PUT');

    if (results.paybackDate) {
      const pbIdx = copy.findIndex(cf => cf.date >= results.paybackDate);
      const pbCumul = pbIdx > 0 ? copy[pbIdx - 1].cumulative : 0;
      copy.splice(pbIdx < 0 ? copy.length : pbIdx, 0, {
        date: results.paybackDate,
        amount: 0, cumulative: pbCumul, overpayment: results.totalOverpayment, flow: 0, type: 'PAYBACK', gross: 0, tax: 0,
        isPaybackPoint: true
      } as Results['cashFlows'][number] & { isPaybackPoint: boolean });
    }

    return copy;
  }, [results, hasOffer, offerDateNorm, hasCall, callDateNorm, hasPut, putDateNorm]);

  const chartData = useMemo(() => {
    if (!results) return [];
    return results.cashFlows.map(cf => ({ ...cf, ts: new Date(cf.date).getTime() }));
  }, [results]);

  const chartTicks = useMemo<number[]>(() => {
    if (chartData.length === 0) return [];
    const base = chartData.map(d => d.ts);
    if (results?.paybackDate) base.push(new Date(results.paybackDate).getTime());
    if (selectedBond?.OFFERDATE) base.push(new Date(selectedBond.OFFERDATE).getTime());
    if (selectedBond?.CALLOPTIONDATE) base.push(new Date(selectedBond.CALLOPTIONDATE).getTime());
    if (selectedBond?.PUTOPTIONDATE) base.push(new Date(selectedBond.PUTOPTIONDATE).getTime());
    const sorted = Array.from<number>(new Set(base)).sort((a, b) => a - b);
    if (sorted.length <= 8) return sorted;
    const step = (sorted.length - 2) / 6;
    const picks: number[] = [];
    for (let i = 0; i < 6; i++) {
      const idx = 1 + Math.round(step * i);
      if (idx < sorted.length - 1) picks.push(sorted[idx]);
    }
    return [sorted[0], ...picks, sorted[sorted.length - 1]];
  }, [chartData, results?.paybackDate, selectedBond?.OFFERDATE, selectedBond?.CALLOPTIONDATE, selectedBond?.PUTOPTIONDATE]);

  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const exportPDF = useCallback(async () => {
    if (!results) return;
    window.print();
  }, [results]);

  const chartTheme = {
    tick: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
    tickSec: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
    tooltipBg: isDark ? '#161618' : '#fff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    tooltipText: isDark ? '#fff' : '#1a1a1c',
    tooltipShadow: isDark ? '0 10px 30px rgba(0,0,0,0.4)' : '0 10px 30px rgba(0,0,0,0.1)',
    gridStroke: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)',
  };

  return (
    <>
    <div id="screen-app" className={`min-h-screen flex flex-col font-sans overflow-x-hidden ${isDark ? 'dark' : ''}`} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="px-6 lg:px-16 py-10 flex justify-between items-start border-b" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-500 rounded-2xl rotate-3 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <div className="w-5 h-5 bg-black -rotate-3"></div>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter" style={{ color: 'var(--text-primary)' }}>ОБЛИГАЦИОННЫЙ АРБИТРАЖ</h1>
               <p className="text-[10px] tracking-[0.3em] font-mono uppercase" style={{ color: 'var(--text-secondary)' }}>НЕ совершай ошибок и всё будет</p>
            </div>
          </div>
        </div>
          <div className="flex items-center gap-4">
            {results && (
              <div className="flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--accent)' }} onClick={exportPDF}>
                <Download size={16} style={{ color: 'var(--accent)' }} />
              </div>
            )}
            {comparisonList.length > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: showComparison ? 'var(--accent)' : 'var(--text-muted)' }} onClick={() => setShowComparison(v => !v)}>
                <BarChart3 size={16} style={{ color: showComparison ? 'var(--accent)' : 'var(--text-muted)' }} />
              </div>
            )}
            <div className="flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--accent)' }} onClick={() => setIsDark(!isDark)}>
              {isDark ? <Sun size={16} style={{ color: 'var(--accent)' }} /> : <Moon size={16} style={{ color: 'var(--accent)' }} />}
            </div>
            <div className="flex flex-col items-end gap-1 opacity-20 hover:opacity-100 transition-opacity cursor-default">
            <span className="text-[10px] font-mono">СТАТУС: СОЕДИНЕНИЕ_УСТАНОВЛЕНО</span>
            <span className="text-[10px] font-mono tracking-widest leading-none">ОБНОВЛЕНИЕ: {isLoading ? 'СИНХ...' : 'ОНЛАЙН'}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-0 overflow-hidden">
        
        {/* Input Sidebar */}
        <aside className="xl:col-span-3 p-8 space-y-12 overflow-y-auto max-h-[calc(100vh-140px)] border-r" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          <div className="space-y-8">
            {/* Search */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-secondary)' }}>01/ Поиск активов</h3>
                {selectedBond && (
                  <button onClick={() => { setSelectedBond(null); setBondSearch(''); setNkd(0); setMaturityDate(''); }} className="text-[9px] font-bold uppercase tracking-tighter opacity-60 hover:opacity-100 flex items-center gap-1">
                    <RotateCcw size={10} /> Сброс
                  </button>
                )}
              </div>
              <div className="relative group">
                <input 
                  type="text" 
                  value={bondSearch}
                  onChange={(e) => {
                    setBondSearch(e.target.value);
                    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                    searchTimerRef.current = setTimeout(() => handleSearch(e.target.value), 350);
                  }}
                  placeholder="Тикер, ISIN или название..."
                  className="w-full border rounded-xl px-4 py-3.5 text-sm font-bold outline-none transition-all shadow-inner"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30" style={{ color: 'var(--text-muted)' }}>
                  {isLoading ? <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-color)', borderTopColor: 'var(--accent)' }} /> : <Search size={14} style={{ color: 'var(--text-muted)' }} />}
                </div>

                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 rounded-xl shadow-xl z-50 divide-y overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                    {searchResults.slice(0, 15).map((bond, i) => (
                      <button 
                        key={String(bond.secid || bond.SECID || i)}
                        onClick={() => selectBond(bond)}
                        className="w-full px-4 py-3 text-left hover:opacity-80 flex flex-col gap-0.5 transition-opacity"
                      >
                        <span className="font-bold text-[13px]" style={{ color: 'var(--text-primary)' }}>{bond.shortname || bond.SHORTNAME}</span>
                        <div className="flex justify-between w-full items-center">
                           <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{bond.secid || bond.SECID}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>{bond.primary_boardid || bond.BOARDID}</span>
                            {(() => {
                              const key = (bond.secid || bond.SECID || '').toUpperCase();
                              const cached = bondTypeCacheRef.current.get(key);
                              if (cached) {
                                if (cached.type) {
                                  return (
                                    <span className="text-[10px] font-black text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full shadow-sm">
                                      {cached.type}
                                    </span>
                                  );
                                }
                                if (cached.couponPercent > 0) {
                                  return (
                                    <span className="text-[10px] font-black text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full shadow-sm">
                                      {cached.couponPercent.toFixed(2)}%
                                    </span>
                                  );
                                }
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
<h3 className="text-[10px] font-black tracking-widest uppercase" style={{ color: 'var(--text-secondary)' }}>02/ Распределение капитала</h3>
                <div className="space-y-4">
                <div className="group">
                  <div className="flex justify-between items-center mb-1.5 ">
                    <label className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Объем инвестиций</label>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner focus-within:border-orange-500/30 transition-colors" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                    <input type="number" value={investment} onChange={e => setInvestment(Number(e.target.value) || 0)} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                    <span className="text-[10px] font-bold opacity-30 shrink-0">{getCurrencySymbol(currency)}</span>
                  </div>
                </div>

                <div className="group">
                  <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Номинал облигации ({currency})</label>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner focus-within:border-orange-500/30 transition-colors" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                    <input type="number" value={nominal} onChange={e => setNominal(Number(e.target.value))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                    <span className="text-[10px] font-bold opacity-30 shrink-0">{getCurrencySymbol(currency)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Цена %</label>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                      <input type="number" step="0.01" value={pricePercent} onChange={e => setPricePercent(Number(e.target.value))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--accent)' }} />
                      <span className="text-[10px] font-bold opacity-30">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>НКД ({currency})</label>
                    <div className="flex items-center rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                      <input type="number" step="0.01" value={nkd} onChange={e => setNkd(Number(e.target.value))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                      <span className="text-[10px] font-bold opacity-30 shrink-0">{getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mechanics */}
            <div className="space-y-6">
              <h3 className="text-[10px] font-black tracking-widest uppercase" style={{ color: 'var(--text-secondary)' }}>03/ Механика выплат</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Купон %</label>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                      <input type="number" step="0.01" value={couponRate} onChange={e => setCouponRate(Number(e.target.value))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                      <span className="text-[10px] font-bold opacity-30">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Выплата</label>
                    <div className="flex items-center gap-2 px-3 py-2 italic shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-black" style={{ color: 'var(--text-muted)' }}>
                        {results ? (results.periodCoupon).toFixed(2) : (nominal * (couponRate / 100) / (couponFrequency || 1)).toFixed(2)}
                      </span>
                      <span className="text-[10px] font-bold opacity-30 shrink-0">{getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Частота</label>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)', borderWidth: '1px', borderStyle: 'solid' }}>
                      <input type="number" min="1" max="12" value={couponFrequency} onChange={e => setCouponFrequency(clamp(Number(e.target.value) || 1, 1, 12))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Погашение</label>
                    <input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} className="w-full rounded-lg px-3 py-2 text-xs font-bold outline-none appearance-none shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)', borderWidth: '1px', borderStyle: 'solid' }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Налог %</label>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)', borderWidth: '1px', borderStyle: 'solid' }}>
                      <input type="number" value={taxRate} onChange={e => setTaxRate(clamp(Number(e.target.value) || 0, 0, 100))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                      <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ком. %</label>
                    <div className="flex items-center rounded-lg px-3 py-2 shadow-inner" style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-color)', borderWidth: '1px', borderStyle: 'solid' }}>
                      <input type="number" step="0.01" value={commission} onChange={e => setCommission(clamp(Number(e.target.value) || 0, 0, 100))} className="bg-transparent w-full text-sm font-bold outline-none" style={{ color: 'var(--text-primary)' }} />
                      <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                </div>
</div>
              </div>
            </div>
          </aside>

        {/* Analytic Viewports */}
        <section ref={resultsRef} className={`xl:col-span-9 p-8 lg:p-16 space-y-16 overflow-y-auto max-h-[calc(100vh-140px)] ${isDark ? 'dark' : ''}`} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          
          {showComparison && comparisonList.length > 0 && comparisonResults.some(r => r !== null) ? (
            <div className="space-y-6 w-full">
              <div className="flex justify-between items-end px-2">
                <h2 className="text-[10px] font-mono tracking-[0.5em] uppercase" style={{ color: 'var(--text-secondary)' }}>Сравнение облигаций</h2>
                <span className="text-[9px] opacity-50 font-bold">{comparisonList.length} шт.</span>
              </div>
              <div className="overflow-x-auto rounded-3xl border shadow-2xl no-scrollbar" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                <table className="w-full text-[11px] font-mono text-left border-collapse">
                  <thead>
                    <tr className="border-b opacity-60" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <th className="px-6 py-4 font-normal text-[10px]" style={{ color: 'var(--text-secondary)' }}>МЕТРИКА</th>
                      {comparisonList.map((entry, ci) => {
                        const res = comparisonResults[ci];
                        if (!res) return null;
                        return (
                          <th key={entry.id} className="px-6 py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
                            <div className="flex flex-col items-center gap-1">
                              <span className="font-bold text-[11px]" style={{ color: 'var(--text-primary)' }}>{entry.bond.SHORTNAME || entry.bond.SECID}</span>
                              <span className="text-[8px] opacity-50">{entry.bond.ISIN}</span>
                              <button onClick={() => removeComparison(entry.id)}
                                className="text-[8px] uppercase tracking-wider opacity-40 hover:opacity-100 transition-opacity"
                                style={{ color: '#ef4444' }}>Удалить</button>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {[
                      { label: 'Тип', render: (_: Results | null, ci: number) => getBondTypeLabel(comparisonList[ci].bond.BONDTYPE, comparisonList[ci].bond.BONDSUBTYPE) || '\u2014' },
                      { label: 'ISIN', render: (_: Results | null, ci: number) => comparisonList[ci].bond.ISIN || '\u2014' },
                      { label: '\u0426\u0435\u043D\u0430, %', render: (_: Results | null, ci: number) => comparisonList[ci].params.pricePercent.toFixed(2) },
                      { label: '\u041D\u041A\u0414', render: (r: Results | null) => r ? `${r.cleanPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${getCurrencySymbol(currency)}` : '\u2014' },
                      { label: '\u041A\u0443\u043F\u043E\u043D, %', render: (_: Results | null, ci: number) => `${comparisonList[ci].params.couponRate.toFixed(2)}%` },
                      { label: '\u0412\u044B\u043F\u043B\u0430\u0442\u0430', render: (_: Results | null, ci: number) => `${comparisonList[ci].params.couponFrequency} \u0440\u0430\u0437/\u0433\u043E\u0434` },
                      { label: '\u0414\u043D\u0435\u0439 \u0434\u043E \u043F\u043E\u0433\u0430\u0448.', render: (r: Results | null) => r ? `${r.daysToMaturity}` : '\u2014' },
                      { label: '\u041A\u043E\u043B-\u0432\u043E', render: (r: Results | null) => r ? `${r.bondCount} \u0448\u0442.` : '\u2014' },
                      { label: '\u0422\u0435\u043A. \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C', render: (r: Results | null) => r ? `${r.currentYield.toFixed(2)}%` : '\u2014' },
                      { label: 'YTM', render: (r: Results | null) => r ? `${r.isFloatingCoupon ? '~' : ''}${r.ytm.toFixed(2)}%` : '\u2014' },
                      { label: 'NET \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C', render: (r: Results | null) => r ? `${r.netYield.toFixed(2)}%` : '\u2014', highlight: true },
                      { label: '\u041E\u043A\u0443\u043F\u0430\u0435\u043C\u043E\u0441\u0442\u044C', render: (r: Results | null) => r ? (r.paybackMonths === null ? '\u041D\u0435 \u043E\u043A\u0443\u043F\u0430\u0435\u0442\u0441\u044F' : r.totalOverpayment <= 0 ? '\u0421\u0440\u0430\u0437\u0443' : `${r.paybackMonths.toFixed(1)} \u043C\u0435\u0441.`) : '\u2014' },
                      { label: '\u0427\u0438\u0441\u0442\u0430\u044F \u043F\u0440\u0438\u0431\u044B\u043B\u044C', render: (r: Results | null) => r ? `${r.netProfit >= 0 ? '+' : ''}${r.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${getCurrencySymbol(currency)}` : '\u2014', profit: true },
                    ].map(row => (
                      <tr key={row.label} className="hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="px-6 py-3 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{row.label}</td>
                        {comparisonResults.map((r, ci) => (
                          <td key={ci} className={`px-6 py-3 text-center text-[12px] ${row.highlight ? 'font-black' : 'font-medium'}`}
                            style={row.highlight ? { color: 'var(--accent)' } : row.profit && r ? { color: r.netProfit >= 0 ? '#22c55e' : '#ef4444' } : { color: 'var(--text-primary)' }}>
                            {row.render(r, ci)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : !results ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-20">
              <div className="w-24 h-24 border rounded-3xl flex items-center justify-center shadow-inner" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                <Calculator size={32} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="space-y-4">
                <h2 className="text-3xl font-black tracking-tighter uppercase" style={{ color: 'var(--text-primary)' }}>Требуется расчет</h2>
                <p className="text-sm max-w-xs mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>Система ожидает корректные параметры для инициализации прогноза. Все расчеты производятся в валюте облигации ({currency}).</p>
              {investment > 0 && maturityDate && (nominal * (pricePercent/100) + nkd) * (1 + commission/100) > investment && (
                <p className="text-sm text-red-400 font-bold">Недостаточно средств для покупки хотя бы одной облигации</p>
              )}
              </div>
            </div>
          ) : (
            <>
              {/* Yield Hero */}
              <div className="space-y-12">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        {selectedBond && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono tracking-[0.5em] uppercase border-b pb-1" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}>
                                  {selectedBond.SHORTNAME || selectedBond.SECID}
                               </span>
                                <span className="text-[10px] font-bold text-orange-500 border border-orange-500/30 rounded px-2 py-0.5">
                                  {getBondTypeLabel(selectedBond.BONDTYPE, selectedBond.BONDSUBTYPE) || '--'}
                                </span>
                               <span className="text-[10px] font-bold text-orange-500">
                                 {selectedBond.COUPONPERCENT ? `${Number(selectedBond.COUPONPERCENT).toFixed(2)}%` : '--'}
                               </span>
                               {!comparisonList.some(e => e.id === selectedBond.SECID.toUpperCase()) && (
                                 <button onClick={addToComparison} className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-opacity hover:opacity-80"
                                   style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                                   + Сравнить
                                 </button>
                             )}
                             {selectedBond?.OFFERDATE && (
                               <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold" style={{ backgroundColor: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                                 <Info size={12} />
                                 Оферта {new Date(selectedBond.OFFERDATE).toLocaleDateString('ru-RU')}
                               </div>
                             )}
                             {selectedBond?.CALLOPTIONDATE && (
                               <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold" style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                                 <Info size={12} />
                                 Колл {new Date(selectedBond.CALLOPTIONDATE).toLocaleDateString('ru-RU')}
                               </div>
                             )}
                             {selectedBond?.PUTOPTIONDATE && (
                               <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold" style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                                 <Info size={12} />
                                 Пут {new Date(selectedBond.PUTOPTIONDATE).toLocaleDateString('ru-RU')}
                               </div>
                             )}
                          </div>
                            {isFloatingCoupon(selectedBond.BONDTYPE, selectedBond.BONDSUBTYPE, selectedBond.COUPONTYPE, selectedBond.SHORTNAME, selectedBond.coupons) && (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold" style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                                <Info size={12} />
                                Плавающий купон — текущая ставка может измениться. Расчёт приблизительный.
                              </div>
                            )}
                          </div>
                        )}
                       <div className="flex items-center gap-2">
                          <h2 className="text-[10px] font-mono tracking-[0.5em] uppercase" style={{ color: 'var(--text-secondary)' }}>Прогноз чистой доходности</h2>
                         <div className="group relative">
                            <Info size={10} className="cursor-help" style={{ color: 'var(--text-muted)' }} />
                            <div className="absolute left-0 bottom-full mb-2 w-64 p-3 rounded-xl text-[10px] leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl z-50"
                              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                              Реальная годовая доходность (XIRR) с учетом налогов ({taxRate}%), комиссии ({commission}%) и НКД.
                            </div>
                         </div>
                       </div>
                    </div>
                    <div className="flex items-baseline gap-2 leading-none" style={{ color: 'var(--text-primary)' }}>
                      <span className="text-[100px] lg:text-[180px] font-black tracking-tighter">{results.netYield.toFixed(2)}</span>
                      <span className="text-4xl lg:text-7xl font-light" style={{ color: 'var(--text-muted)' }}>%</span>
                      <span className="ml-4 px-3 py-1.5 bg-orange-500/10 text-orange-500 rounded text-[10px] font-bold border border-orange-500/20 uppercase tracking-widest">NET APR</span>
                      {results.isFloatingCoupon && (
                        <span className="ml-2 px-2 py-1 text-[10px] font-bold rounded" style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                          ~ по последнему купону
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-12 gap-y-6 border-l pl-8" style={{ borderColor: 'var(--border-color)' }}>
<div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>YTM (Грязная)</span>
                          <Tooltip text={TOOLTIPS.ytm}>
                            <Info size={10} style={{ color: 'var(--text-muted)' }} />
                          </Tooltip>
                        </div>
                         <p className="text-2xl font-bold" style={{ color: 'var(--text-secondary)' }}>{results.isFloatingCoupon ? '~' : ''}{results.ytm.toFixed(2)}%</p>
                      </div>
                    <Tooltip text={TOOLTIPS.payback}>
                      <div className="space-y-1 cursor-help">
                        <span className="text-[10px] uppercase font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>Окупаемость</span>
                                                   <p className="text-2xl font-bold" style={{ color: 'var(--text-secondary)' }}>{results.paybackMonths === null ? "Не окупается" : results.totalOverpayment <= 0 ? "Сразу" : `${results.paybackMonths.toFixed(1)} мес.`}</p>
                      </div>
                    </Tooltip>
                    <Tooltip text={TOOLTIPS.netProfit}>
                      <div className="space-y-1 text-right cursor-help">
                         <span className="text-[10px] uppercase font-bold tracking-widest" style={{ color: 'var(--text-secondary)' }}>Прибыль</span>
                           <p className="text-2xl font-black text-green-500">+{results.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</p>
                      </div>
                    </Tooltip>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
                  <Tooltip text="Количество облигаций которое вы можете купить на указанную сумму">
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>Количество</span>
                                              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{results.bondCount.toLocaleString()} шт.</span>
                    </div>
                  </Tooltip>
                  <Tooltip text="Чистый доход от купонов за год (после налога)">
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>Доход за год</span>
                                              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{results.netAnnualTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </Tooltip>
                  <Tooltip text="Количество дней до даты погашения облигации">
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>Дней осталось</span>
                                              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{results.daysToMaturity} дн.</span>
                    </div>
                  </Tooltip>
                  <Tooltip text="Общая сумма к получению: все купоны + номинал при погашении">
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>К выплате всего</span>
                                              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{results.finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </Tooltip>
                  <Tooltip text={TOOLTIPS.capitalGain}>
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>Ценовой доход</span>
                        <span className={`text-xl font-bold ${results.capitalGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                         {results.capitalGain > 0 ? '+' : ''}{results.capitalGain.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}
                       </span>
                    </div>
                  </Tooltip>
                  <Tooltip text={TOOLTIPS.dirtyPrice}>
                    <div className="p-6 rounded-2xl flex flex-col gap-2 shadow-inner cursor-help border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                      <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--text-muted)' }}>Цена с НКД</span>
                                             <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{results.dirtyPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </Tooltip>
                </div>
              </div>

              {/* Chart Visualization */}
              <div className="space-y-8">
                <div className="flex justify-between items-center">
                  <h2 className="text-[10px] font-mono tracking-[0.5em] uppercase" style={{ color: 'var(--text-secondary)' }}>Распределение денежных потоков и капитала</h2>
                  <div className="flex items-center gap-4 text-[9px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500"></div> Накопление</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500/50"></div> Выплаты</div>
                  </div>
                </div>
                <div className="h-[450px] min-h-[450px] w-full rounded-[40px] border p-0 relative overflow-hidden group shadow-2xl" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={1} minWidth={1} debounce={50}>
                    <ComposedChart data={chartData} margin={{ top: 40, right: 40, left: 20, bottom: 40 }}>
                      <defs>
                        <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis 
                        dataKey="ts" 
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        ticks={chartTicks}
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: chartTheme.tick }}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
                        }}
                        dy={10}
                        height={40}
                      />
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartTheme.gridStroke} />
                      <YAxis 
                        yId="left"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: chartTheme.tickSec }}
                        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                        width={45}
                      />
                      <YAxis 
                        yId="right"
                        orientation="right"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: chartTheme.tickSec }}
                        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                        width={45}
                      />
                      <YAxis 
                        yId="right"
                        orientation="right"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} 
                        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '12px', fontSize: '11px', boxShadow: chartTheme.tooltipShadow, color: chartTheme.tooltipText, padding: '12px' }}
                        itemStyle={{ padding: '4px 0', color: chartTheme.tooltipText, fontSize: '11px' }}
                        labelStyle={{ color: '#f97316', fontWeight: 'bold', fontSize: '12px', marginBottom: '8px' }}
                        labelFormatter={(ts: number) => {
                          const d = new Date(ts);
                          return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
                        }}
                        formatter={(value: number, name: string, props: { payload?: { type?: string } }) => {
                          const type = props?.payload?.type || '';
                          const typeLabel: Record<string, string> = {
                            'OPEN': 'Открытие позиции',
                            'COUPON': 'Выплата купона',
                            'PAYBACK': 'Точка окупаемости',
                            'MATURITY': 'Погашение',
                            'OFFER': 'Оферта',
                            'CALL': 'Колл',
                            'PUT': 'Пут'
                          };
                          if (name === 'cumulative') {
                            return [`${Number(value).toLocaleString('ru-RU')} ${getCurrencySymbol(currency)}`, 'Накоплено'];
                          }
                          if (name === 'flow') {
                            if (value === 0) return null;
                            return [`${Number(value).toLocaleString('ru-RU')} ${getCurrencySymbol(currency)}`, typeLabel[type] || 'Выплата'];
                          }
                          return [`${Number(value).toLocaleString('ru-RU')} ${getCurrencySymbol(currency)}`, name];
                        }}
                      />
                      {results.paybackDate && (
                        <ReferenceLine 
                          yId="left"
                          x={new Date(results.paybackDate).getTime()} 
                          stroke="#ef4444" 
                          strokeDasharray="3 3"
                          label={{ 
                            value: 'ОКУПАЕМОСТЬ', 
                            position: 'top', 
                            fill: '#ef4444', 
                            fontSize: 9, 
                            fontWeight: 'bold' 
                          }} 
                        />
                      )}
                      {selectedBond?.OFFERDATE && (
                        <ReferenceLine 
                          yId="left"
                          x={new Date(selectedBond.OFFERDATE).getTime()}
                          stroke="#a855f7" 
                          strokeDasharray="6 3"
                          label={{ 
                            value: 'ОФЕРТА', 
                            position: 'top', 
                            dy: 20,
                            fill: '#a855f7', 
                            fontSize: 9, 
                            fontWeight: 'bold' 
                          }} 
                        />
                      )}
                      {selectedBond?.CALLOPTIONDATE && (
                        <ReferenceLine 
                          yId="left"
                          x={new Date(selectedBond.CALLOPTIONDATE).getTime()}
                          stroke="#3b82f6" 
                          strokeDasharray="6 3"
                          label={{ 
                            value: 'КОЛЛ', 
                            position: 'top', 
                            dy: 40,
                            fill: '#3b82f6', 
                            fontSize: 9, 
                            fontWeight: 'bold' 
                          }} 
                        />
                      )}
                      {selectedBond?.PUTOPTIONDATE && (
                        <ReferenceLine 
                          yId="left"
                          x={new Date(selectedBond.PUTOPTIONDATE).getTime()}
                          stroke="#22c55e" 
                          strokeDasharray="6 3"
                          label={{ 
                            value: 'ПУТ', 
                            position: 'top', 
                            dy: 60,
                            fill: '#22c55e', 
                            fontSize: 9, 
                            fontWeight: 'bold' 
                          }} 
                        />
                      )}
                      <Bar 
                        yId="right"
                        dataKey="flow" 
                        barSize={12} 
                        radius={[4, 4, 0, 0]}
                        fill="rgba(59, 130, 246, 0.4)" 
                        name="Поток средств"
                      />
<Area 
                        yId="left"
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke="#f97316" 
                        strokeWidth={3} 
                        fillOpacity={1} 
                        fill="url(#colorProfit)" 
                        animationDuration={2000}
                        name="Итого капитал"
                        dot={(props: { cx?: number; cy?: number; payload?: { isPaybackPoint?: boolean } }) => {
                          if (props.payload?.isPaybackPoint) {
                            return (
                              <circle
                                cx={props.cx}
                                cy={props.cy}
                                r={8}
                                fill="#ef4444"
                                stroke="#fff"
                                strokeWidth={2}
                              />
                            );
                          }
                          return null;
                        }}
                      />
                      <ReferenceLine yId="left" y={0} stroke={isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'} strokeWidth={1} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Financial Breakout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6 p-10 rounded-[32px] shadow-inner border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <h3 className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Структура расходов</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Чистая стоимость облигаций</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{results.cleanPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)', color: 'var(--accent)' }}>
                      <span className="text-sm font-medium">Накопленный купонный доход (НКД)</span>
                      <span className="text-sm font-bold">{(results.dirtyPrice - results.cleanPrice).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Комиссия брокера ({commission}%)</span>
                      <span className="text-sm font-bold">{results.commissionAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-6" style={{ color: 'var(--text-primary)' }}>
                      <span className="text-sm font-black uppercase tracking-tighter">Итого к списанию</span>
                      <span className="text-xl font-black">{(results.totalCost + results.commissionAmount).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 p-10 rounded-[32px] shadow-inner border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <h3 className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Прогноз доходов</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Общая сумма купонов (Грязная)</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{(results.grossCouponTotal).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Прогноз по налогам ({taxRate}%)</span>
                      <span className="text-sm font-bold text-red-500">-{results.totalTaxPaid.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Возврат номинала</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{(results.finalAmount - results.totalCouponToMaturity).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-6" style={{ color: 'var(--text-primary)' }}>
                      <span className="text-sm font-black uppercase tracking-tighter">Чистая доходность за период</span>
                      <span className="text-xl font-black text-green-500">+{results.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="space-y-6">
                <div className="flex justify-between items-end px-2">
                  <h2 className="text-[10px] font-mono tracking-[0.5em] uppercase" style={{ color: 'var(--text-secondary)' }}>Детализация выплат</h2>
                  <div className="text-[9px] opacity-50 font-bold">Всего купонов: {results.couponCount}</div>
                </div>
                <div className="overflow-x-auto rounded-3xl border shadow-2xl no-scrollbar" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                  <table className="w-full text-[11px] font-mono text-left border-collapse">
                    <thead>
                      <tr className="border-b opacity-60" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                        <th className="px-8 py-5 font-normal" style={{ color: 'var(--text-secondary)' }}>ДАТА</th>
                        <th className="py-5 font-normal" style={{ color: 'var(--text-secondary)' }}>СОБЫТИЕ</th>
                        <th className="py-5 font-normal text-right" style={{ color: 'var(--text-secondary)' }}>ГРЯЗНЫМИ</th>
                        <th className="py-5 font-normal text-right" style={{ color: 'var(--text-secondary)' }}>НАЛОГ</th>
                        <th className="py-5 font-normal text-right" style={{ color: 'var(--text-secondary)' }}>ЧИСТЫМИ</th>
                        <th className="px-8 py-5 font-normal text-right" style={{ color: 'var(--text-secondary)' }}>КАПИТАЛ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                      {augmentedCashFlows.map((row, i) => {
                        if (row.type === 'OPEN') return (
                          <tr key={i} className="transition-colors" style={{ backgroundColor: 'var(--bg-card)' }}>
                            <td className="px-8 py-5 italic" style={{ color: 'var(--text-muted)' }}>{row.date}</td>
                            <td className="py-5 font-bold tracking-tighter" style={{ color: 'var(--text-secondary)' }}>ОТКРЫТИЕ_ПОЗИЦИИ</td>
                            <td className="py-5 text-right opacity-20">—</td>
                            <td className="py-5 text-right opacity-20">—</td>
                            <td className="py-5 text-right font-bold text-red-500">-{ (results.totalCost + results.commissionAmount).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } {getCurrencySymbol(currency)}</td>
                            <td className="px-8 py-5 text-right opacity-40" style={{ color: 'var(--text-muted)' }}>0.00 {getCurrencySymbol(currency)}</td>
                          </tr>
                        );
                        
                        const labels: Record<string, string> = {
                          'COUPON': 'ВЫПЛАТА КУПОНА',
                          'AMORTIZATION': 'АМОРТИЗАЦИЯ',
                          'MATURITY': 'ГАСЯЩИЙ ПЛАТЕЖ',
                          'OFFER': 'ОФЕРТА',
                          'CALL': 'КОЛЛ',
                          'PUT': 'ПУТ',
                          'PAYBACK': 'ТОЧКА ОКУПАЕМОСТИ'
                        };

                        const colors: Record<string, string> = {
                          'COUPON': 'bg-orange-500/10 text-orange-500',
                          'AMORTIZATION': 'bg-blue-500/10 text-blue-400',
                          'MATURITY': 'bg-green-500/10 text-green-400',
                          'OFFER': 'bg-purple-500/10 text-purple-400',
                          'CALL': 'bg-blue-500/10 text-blue-400',
                          'PUT': 'bg-emerald-500/10 text-emerald-400',
                          'PAYBACK': 'bg-red-500/10 text-red-400'
                        };

                        const formatVal = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                        return (
                          <tr key={i} className="hover:opacity-80 transition-colors" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-8 py-5 font-medium" style={{ color: 'var(--text-muted)' }}>{row.date}</td>
                            <td className="py-5">
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${colors[row.type] || 'bg-transparent text-inherit'}`}>
                                {labels[row.type] || row.type}
                              </span>
                            </td>
                            <td className="py-5 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>{formatVal(row.gross)} {getCurrencySymbol(currency)}</td>
                            <td className="py-5 text-right font-medium text-red-400">{row.tax > 0 ? `-${formatVal(row.tax)}` : '—'}</td>
                            <td className="py-5 text-right font-black" style={{ color: 'var(--text-secondary)' }}>{formatVal(row.amount)} {getCurrencySymbol(currency)}</td>
                            <td className="px-8 py-5 text-right font-bold" style={{ color: 'var(--text-muted)' }}>{formatVal(row.cumulative)} {getCurrencySymbol(currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </>
          )}
        </section>
      </main>

        {/* Footer */}
        <footer className="px-6 lg:px-16 py-8 border-t flex flex-col md:flex-row justify-between items-center gap-6 text-[9px] font-mono uppercase tracking-[0.2em]"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
          <div className="flex gap-12">
            <span>ИСТОЧНИК: МОСКОВСКАЯ_БИРЖА</span>
            <span>АВТОР: ALZA</span>
          </div>
          <span>© {new Date().getFullYear()} ALZA // ВСЕ ПРАВА ЗАЩИЩЕНЫ</span>
        </footer>

      </div> {/* end screen-app */}

        {/* Print Report */}
        <div id="print-report">
          {(() => {
            const now = new Date();
            const dateStr = now.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
            return (
              <>
              {!showComparison && results && (() => {
                const r = results;
                const bondName = selectedBond?.SHORTNAME || selectedBond?.SECID || 'Облигация';
                const bondIsin = selectedBond?.ISIN || '—';

                return (
                  <>
                  <div style={{ fontFamily: "'Inter', sans-serif", color: '#1a1a1c', background: 'white' }}>
                {/* Report Header */}
                <div style={{ borderBottom: '2px solid #f97316', paddingBottom: 12, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: '#1a1a1c' }}>ОБЛИГАЦИОННЫЙ АРБИТРАЖ</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2, letterSpacing: '0.05em' }}>АНАЛИТИЧЕСКИЙ ОТЧЁТ</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 10, color: '#999' }}>
                    <div>{dateStr}</div>
                    <div style={{ marginTop: 2 }}>ИСТОЧНИК: MOEX</div>
                  </div>
                </div>

                {/* Bond Identity */}
                <div style={{ background: '#fafafa', borderRadius: 8, padding: '14px 18px', marginBottom: 20, border: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{bondName}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>ISIN: {bondIsin}</div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#888' }}>Инвестиции</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{investment.toLocaleString('ru-RU')} {getCurrencySymbol(currency)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#888' }}>К погашению</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{r.daysToMaturity} дн.</div>
                    </div>
                  </div>
                </div>

                {/* Key Metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                  {[
                    { label: 'Чистая доходность (NET)', value: `${r.netYield.toFixed(2)}%`, color: '#f97316' },
                    { label: 'YTM (грязная)', value: `${r.ytm.toFixed(2)}%`, color: '#1a1a1c' },
                    { label: 'Окупаемость', value: r.paybackMonths === null ? 'Не окупается' : r.totalOverpayment <= 0 ? 'Сразу' : `${r.paybackMonths.toFixed(1)} мес.`, color: '#1a1a1c' },
                    { label: 'Чистая прибыль', value: `+${r.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${getCurrencySymbol(currency)}`, color: '#16a34a' },
                    { label: 'Общая выплата', value: `${r.finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${getCurrencySymbol(currency)}`, color: '#1a1a1c' },
                    { label: 'Купонов получено', value: `${r.couponCount} шт.`, color: '#1a1a1c' },
                    { label: 'Кол-во облигаций', value: `${r.bondCount} шт.`, color: '#1a1a1c' },
                    { label: 'Текущая доходность', value: `${r.currentYield.toFixed(2)}%`, color: '#1a1a1c' },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#fafafa', borderRadius: 8, padding: '12px 14px', border: '1px solid #eee' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: '#888', marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: m.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Costs vs Returns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 12 }}>Структура расходов</div>
                    {[
                      { label: 'Чистая стоимость', value: `${r.cleanPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                      { label: 'НКД', value: `${(r.dirtyPrice - r.cleanPrice).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                      { label: 'Комиссия', value: `${r.commissionAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                    ].map(row => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <span style={{ color: '#666', whiteSpace: 'nowrap' }}>{row.label}</span>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11 }}>{row.value} {getCurrencySymbol(currency)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: 12, fontWeight: 800 }}>
                      <span style={{ whiteSpace: 'nowrap' }}>ИТОГО</span>
                      <span style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{(r.totalCost + r.commissionAmount).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                  <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 12 }}>Прогноз доходов</div>
                    {[
                      { label: 'Купоны (грязными)', value: `${r.grossCouponTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                      { label: 'Налог', value: `-${r.totalTaxPaid.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                      { label: 'Возврат номинала', value: `${(r.finalAmount - r.totalCouponToMaturity).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` },
                    ].map(row => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <span style={{ color: '#666', whiteSpace: 'nowrap' }}>{row.label}</span>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11 }}>{row.value} {getCurrencySymbol(currency)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: 12, fontWeight: 800, color: '#16a34a' }}>
                      <span style={{ whiteSpace: 'nowrap' }}>ЧИСТАЯ ПРИБЫЛЬ</span>
                      <span style={{ whiteSpace: 'nowrap', fontSize: 11 }}>+{r.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {getCurrencySymbol(currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Cash Flow Table */}
                <div className="print-page-break" style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', padding: '12px 16px', background: '#fafafa', borderBottom: '1px solid #eee' }}>
                    Денежные потоки
                  </div>
                  <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Дата</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Событие</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {augmentedCashFlows.map((row, i) => {
                         const labels: Record<string, string> = { 'OPEN': 'Открытие', 'COUPON': 'Купон', 'AMORTIZATION': 'Амортизация', 'MATURITY': 'Погашение', 'OFFER': 'Оферта', 'CALL': 'Колл', 'PUT': 'Пут', 'PAYBACK': 'Окупаемость' };
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '6px 12px', color: '#666', whiteSpace: 'nowrap' }}>{row.date}</td>
                            <td style={{ padding: '6px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{labels[row.type] || row.type}</td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 9, color: row.flow < 0 ? '#dc2626' : row.flow > 0 ? '#16a34a' : '#aaa' }}>
                              {row.flow === 0 ? '—' : (row.flow < 0 ? '-' : '+') + Math.abs(row.flow).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ' + getCurrencySymbol(currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div style={{ borderTop: '1px solid #eee', paddingTop: 12, fontSize: 9, color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Сгенерировано {dateStr}</span>
                  <span>ALZA // ОБЛИГАЦИОННЫЙ АРБИТРАЖ</span>
                </div>
              </div>
                </>
              );
            })()}

              {showComparison && comparisonList.length > 0 && comparisonResults.some(r => r !== null) && (
                <div className="print-page-break" style={{ pageBreakBefore: 'always', fontFamily: "'Inter', sans-serif", color: '#1a1a1c', background: 'white', marginTop: 32 }}>
                  <div style={{ borderBottom: '2px solid #f97316', paddingBottom: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: '#1a1a1c' }}>ОБЛИГАЦИОННЫЙ АРБИТРАЖ</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2, letterSpacing: '0.05em' }}>СРАВНЕНИЕ ОБЛИГАЦИЙ</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 10, color: '#999' }}>
                      <div>{dateStr}</div>
                      <div style={{ marginTop: 2 }}>ИСТОЧНИК: MOEX</div>
                    </div>
                  </div>

                  <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse', marginTop: 16 }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Метрика</th>
                        {comparisonList.map((entry, ci) => {
                          const res = comparisonResults[ci];
                          if (!res) return null;
                          return (
                            <th key={entry.id} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 700, color: '#1a1a1c', fontSize: 11 }}>{entry.bond.SHORTNAME || entry.bond.SECID}</div>
                              <div style={{ fontSize: 8, color: '#999', marginTop: 2 }}>{entry.bond.ISIN}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Тип', render: (_: Results | null, ci: number) => getBondTypeLabel(comparisonList[ci].bond.BONDTYPE, comparisonList[ci].bond.BONDSUBTYPE) || '—' },
                        { label: 'Цена, %', render: (_: Results | null, ci: number) => comparisonList[ci].params.pricePercent.toFixed(2) },
                        { label: 'Купон, %', render: (_: Results | null, ci: number) => `${comparisonList[ci].params.couponRate.toFixed(2)}%` },
                        { label: 'Выплат/год', render: (_: Results | null, ci: number) => `${comparisonList[ci].params.couponFrequency}` },
                        { label: 'Дней до погаш.', render: (r: Results | null) => r ? `${r.daysToMaturity}` : '—' },
                        { label: 'Тек. доходность', render: (r: Results | null) => r ? `${r.currentYield.toFixed(2)}%` : '—' },
                        { label: 'YTM', render: (r: Results | null) => r ? `${r.isFloatingCoupon ? '~' : ''}${r.ytm.toFixed(2)}%` : '—' },
                        { label: 'NET доходность', render: (r: Results | null) => r ? `${r.netYield.toFixed(2)}%` : '—' },
                        { label: 'Окупаемость', render: (r: Results | null) => r ? (r.paybackMonths === null ? 'Не окупается' : r.totalOverpayment <= 0 ? 'Сразу' : `${r.paybackMonths.toFixed(1)} мес.`) : '—' },
                        { label: 'Кол-во', render: (r: Results | null) => r ? `${r.bondCount} шт.` : '—' },
                        { label: 'Чистая прибыль', render: (r: Results | null) => r ? `${r.netProfit >= 0 ? '+' : ''}${r.netProfit.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${getCurrencySymbol(currency)}` : '—' },
                      ].map(row => (
                        <tr key={row.label} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 9, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{row.label}</td>
                          {comparisonResults.map((r, ci) => (
                            <td key={ci} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, fontSize: 11, color: row.label === 'NET доходность' ? '#f97316' : '#1a1a1c' }}>
                              {row.render(r, ci)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ borderTop: '1px solid #eee', paddingTop: 12, marginTop: 20, fontSize: 9, color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Сгенерировано {dateStr}</span>
                    <span>ALZA // ОБЛИГАЦИОННЫЙ АРБИТРАЖ</span>
                  </div>
                </div>
              )}
              </>
            );
          })()}
        </div>
    </>
  );
}
