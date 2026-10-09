'use client';

import { useState } from 'react';
import { money } from '@/lib/format';

/** Chart colors validated for the graphite surface (#111413): CVD ΔE 26.8, ≥ 3:1 contrast. */
export const SERIES_COLORS = { royalties: '#3987e5', live: '#d95926' } as const;

export type DayPoint = { date: string; royaltiesCents: number; liveRevenueCents: number; orders: number };

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Earnings per day as stacked bars (royalties, live revenue), plain SVG. Hover a day for the
 * values; the same numbers are in the table under the chart.
 */
export function EarningsChart({ series, currency = 'usd' }: { series: DayPoint[]; currency?: string }) {
    const [hover, setHover] = useState<number | null>(null);
    const W = 640;
    const H = 200;
    const padL = 48;
    const padB = 24;
    const padT = 8;
    const plotW = W - padL - 8;
    const plotH = H - padB - padT;
    const totals = series.map((d) => Math.max(0, d.royaltiesCents) + Math.max(0, d.liveRevenueCents));
    const max = Math.max(100, ...totals);
    const step = plotW / Math.max(1, series.length);
    const barW = Math.max(2, Math.min(28, step - 2));
    const y = (v: number) => padT + plotH - (v / max) * plotH;
    const ticks = [0, max / 2, max];
    const labelEvery = Math.ceil(series.length / 7);
    const h = hover !== null ? series[hover] : null;
    return (
        <figure className="relative" data-testid="earnings-chart">
            <div className="mb-2 flex flex-wrap gap-4 text-xs text-fg-muted" aria-hidden>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS.royalties }} /> Royalties
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS.live }} /> Live drops and auctions
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Earnings per day: ${money(totals.reduce((a, b) => a + b, 0), currency)} over ${series.length} days. Values are in the table below.`} onMouseLeave={() => setHover(null)}>
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#2a2f2d" strokeWidth={1} />
                        <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#9aa19d">
                            {money(Math.round(t), currency, { compact: true })}
                        </text>
                    </g>
                ))}
                {series.map((d, i) => {
                    const x = padL + i * step + (step - barW) / 2;
                    const r = Math.max(0, d.royaltiesCents);
                    const l = Math.max(0, d.liveRevenueCents);
                    const rTop = y(r);
                    const lTop = y(r + l);
                    return (
                        <g key={d.date}>
                            {r > 0 && <rect x={x} y={rTop} width={barW} height={Math.max(1, padT + plotH - rTop)} rx={2} fill={SERIES_COLORS.royalties} />}
                            {l > 0 && <rect x={x} y={lTop} width={barW} height={Math.max(1, rTop - lTop - (r > 0 ? 2 : 0))} rx={2} fill={SERIES_COLORS.live} />}
                            <rect x={padL + i * step} y={padT} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                            {i % labelEvery === 0 && (
                                <text x={padL + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#9aa19d">
                                    {shortDay(d.date)}
                                </text>
                            )}
                        </g>
                    );
                })}
                {hover !== null && <line x1={padL + hover * step + step / 2} x2={padL + hover * step + step / 2} y1={padT} y2={padT + plotH} stroke="#5d6561" strokeWidth={1} strokeDasharray="3 3" />}
            </svg>
            {h && (
                <div className="pointer-events-none absolute right-2 top-8 rounded-lg bg-graphite-800 px-3 py-2 text-xs text-fg shadow-lg ring-1 ring-graphite-600" role="status">
                    <p className="font-semibold">{shortDay(h.date)}</p>
                    <p>Royalties {money(h.royaltiesCents, currency)}</p>
                    <p>Live {money(h.liveRevenueCents, currency)}</p>
                    <p className="text-fg-muted">{h.orders} orders</p>
                </div>
            )}
            <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-fg-muted hover:text-fg">Show as a table</summary>
                <div className="mt-2 max-h-64 overflow-auto" tabIndex={0} role="region" aria-label="Earnings per day table">
                    <table className="w-full text-left text-xs">
                        <thead className="text-fg-muted">
                            <tr>
                                <th scope="col" className="py-1 pr-3 font-medium">Day</th>
                                <th scope="col" className="py-1 pr-3 font-medium">Royalties</th>
                                <th scope="col" className="py-1 pr-3 font-medium">Live</th>
                                <th scope="col" className="py-1 font-medium">Orders</th>
                            </tr>
                        </thead>
                        <tbody>
                            {series.map((d) => (
                                <tr key={d.date} className="border-t border-graphite-800">
                                    <td className="py-1 pr-3">{shortDay(d.date)}</td>
                                    <td className="py-1 pr-3 tabular">{money(d.royaltiesCents, currency)}</td>
                                    <td className="py-1 pr-3 tabular">{money(d.liveRevenueCents, currency)}</td>
                                    <td className="py-1 tabular">{d.orders}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </figure>
    );
}

/** DoorDash Merchant product mix: share of earnings per build as horizontal bars (one hue). */
export function ProductMixChart({ rows, currency = 'usd' }: { rows: { buildId: string; title: string; earningsCents: number; sharePct: number; orders: number }[]; currency?: string }) {
    if (!rows.length) return <p className="text-sm text-fg-muted">No earnings in this range yet.</p>;
    const rowH = 34;
    const W = 640;
    const labelW = 0;
    const barMax = W - 140;
    return (
        <figure data-testid="product-mix">
            <svg viewBox={`0 0 ${W} ${rows.length * rowH}`} className="h-auto w-full" role="img" aria-label={`Product mix: ${rows.map((r) => `${r.title} ${r.sharePct}%`).join(', ')}`}>
                {rows.map((r, i) => {
                    const w = Math.max(2, (Math.max(0, r.sharePct) / 100) * barMax);
                    return (
                        <g key={r.buildId} transform={`translate(0 ${i * rowH})`}>
                            <text x={labelW} y={11} fontSize={11} fill="#dfe5e1">
                                {r.title.length > 48 ? `${r.title.slice(0, 47)}…` : r.title}
                            </text>
                            <rect x={labelW} y={16} width={w} height={10} rx={3} fill={SERIES_COLORS.royalties} />
                            <text x={labelW + w + 8} y={25} fontSize={11} fill="#9aa19d">
                                {r.sharePct}% · {money(r.earningsCents, currency)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </figure>
    );
}
