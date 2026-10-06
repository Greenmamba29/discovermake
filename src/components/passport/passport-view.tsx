'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BadgeCheck, CheckCircle2, Factory, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { dateTime, longDate } from '@/lib/format';
import { MILESTONE_LABELS } from '@/lib/status';
import type { MilestoneKind, PassportVerifyResponse } from '@/contracts';
import { cn } from '@/lib/utils';

function QrCode({ value }: { value: string }) {
    const [svg, setSvg] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        import('qrcode')
            .then((mod) => {
                // CommonJS interop: the API may sit on `default` depending on the bundler.
                const ns = mod as unknown as { default?: typeof mod.default } & typeof mod.default;
                const QR = ns.default ?? ns;
                return QR.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#151716', light: '#00000000' } });
            })
            .then((s) => !cancelled && setSvg(s))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [value]);
    if (!svg) return <div className="skeleton h-full w-full" aria-hidden />;
    // qrcode returns a self-contained <svg> string generated locally from our own URL.
    return <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="QR code linking to this passport's verify page" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
    return (
        <div className="grid grid-cols-[120px_1fr] gap-3 border-t border-paper-line py-2.5 text-sm first:border-t-0 sm:grid-cols-[160px_1fr]">
            <dt className="text-ink-subtle">{label}</dt>
            <dd className={cn('min-w-0 break-words text-ink', mono && 'font-mono text-[13px]')}>{children}</dd>
        </div>
    );
}

/** Public Product Passport (warm-white editorial, no buyer PII). */
export function PassportView({ passportId }: { passportId: string }) {
    const { data: p, error, isLoading } = useQuery({ queryKey: ['passport', passportId], queryFn: () => api.getPassport(passportId) });
    const [verify, setVerify] = useState<PassportVerifyResponse | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState<string | null>(null);

    if (isLoading) {
        return (
            <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6" role="status">
                <span className="sr-only">Loading passport…</span>
                <div className="skeleton h-8 w-48" />
                <div className="skeleton mt-4 h-12 w-2/3" />
                <div className="skeleton mt-8 h-80" />
            </div>
        );
    }
    if (error || !p) {
        const notFound = error instanceof ApiClientError && error.status === 404;
        return (
            <div className="mx-auto w-full max-w-xl px-4 py-20 text-center sm:px-6" role="alert">
                <ShieldAlert className="mx-auto h-10 w-10 text-[#9a3b0c]" aria-hidden />
                <h1 className="mt-4 font-display text-3xl font-bold text-ink">{notFound ? 'Passport not found' : 'Could not load this passport'}</h1>
                <p className="mt-2 text-ink-muted">{notFound ? 'No DiscoverMake passport has this ID. Check the code on the packaging and try again.' : errorMessage(error)}</p>
            </div>
        );
    }

    const s = p.snapshot;
    const ok = p.verified && p.status === 'ACTIVE';
    const runVerify = async () => {
        setVerifying(true);
        setVerifyError(null);
        try {
            setVerify(await api.verifyPassport(p.id));
        } catch (err) {
            setVerifyError(errorMessage(err));
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
            <div className="flex flex-wrap items-center gap-3">
                <p className="eyebrow">Product Passport · {s.build.displayId}</p>
                {ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d8f5e1] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#14532d]" data-testid="passport-verified">
                        <BadgeCheck className="h-4 w-4" aria-hidden /> Verified
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fbe1d2] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#7a3109]" data-testid="passport-unverified">
                        <ShieldAlert className="h-4 w-4" aria-hidden /> {p.status === 'REVOKED' ? 'Revoked' : p.status === 'PENDING' ? 'Not yet active' : 'Signature mismatch'}
                    </span>
                )}
            </div>
            <h1 className="mt-4 font-display font-wide text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">{s.build.name}</h1>
            <p className="mt-3 max-w-2xl text-lg text-ink-muted">
                {s.quantity} × {s.material.name} {s.material.thicknessLabel}, made by {s.shop.name} in {s.shop.city}, {s.shop.region} on {longDate(p.manufacturedOn)}.
            </p>

            <div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-8">
                    <section aria-labelledby="pp-make">
                        <h2 id="pp-make" className="font-display text-xl font-bold text-ink">
                            What it is
                        </h2>
                        <dl className="mt-3 rounded-2xl bg-paper-raised px-4 ring-1 ring-paper-line">
                            <Row label="Part file">{s.part.filename}</Row>
                            <Row label="Size" mono>
                                {s.part.bboxWidthMm.toFixed(1)} × {s.part.bboxHeightMm.toFixed(1)} mm
                            </Row>
                            <Row label="Material">
                                {s.material.name} · {s.material.thicknessLabel} ({s.material.thicknessMm.toFixed(2)} mm)
                            </Row>
                            <Row label="Process">{s.process}</Row>
                            <Row label="Finish">{s.finish ?? 'As cut'}</Row>
                            {s.services.length > 0 && <Row label="Operations">{s.services.join(', ')}</Row>}
                            <Row label="Quantity" mono>{s.quantity}</Row>
                            <Row label="Lot" mono>{s.lot}</Row>
                            <Row label="Design version" mono>v{s.designVersion}</Row>
                            <Row label="File fingerprint" mono>
                                <span title={s.part.fileSha256}>{s.part.fileSha256.slice(0, 16)}…</span>
                            </Row>
                        </dl>
                    </section>

                    <section aria-labelledby="pp-shop">
                        <h2 id="pp-shop" className="font-display text-xl font-bold text-ink">
                            Who made it
                        </h2>
                        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-paper-raised p-4 ring-1 ring-paper-line">
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-paper" aria-hidden>
                                <Factory className="h-5 w-5" />
                            </span>
                            <div>
                                <p className="font-semibold text-ink">{s.shop.name}</p>
                                <p className="text-sm text-ink-muted">
                                    {s.shop.city}, {s.shop.region} · DiscoverMake partner shop
                                </p>
                            </div>
                        </div>
                        <ol className="mt-4 space-y-2">
                            {[...s.milestones]
                                .sort((a, b) => a.at.localeCompare(b.at))
                                .map((m, i) => (
                                    <li key={`${m.kind}-${i}`} className="flex items-center gap-3 text-sm">
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1d6b3a]" aria-hidden />
                                        <span className="flex-1 text-ink">{MILESTONE_LABELS[m.kind as MilestoneKind]?.label ?? m.kind}</span>
                                        <span className="font-mono text-[12px] text-ink-subtle">{dateTime(m.at)}</span>
                                    </li>
                                ))}
                            <li className="flex items-center gap-3 text-sm">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1d6b3a]" aria-hidden />
                                <span className="flex-1 text-ink">
                                    Delivered via {s.shipment.carrier} <span className="font-mono text-[12px] text-ink-subtle">{s.shipment.trackingNumber}</span>
                                </span>
                                <span className="font-mono text-[12px] text-ink-subtle">{dateTime(s.shipment.deliveredAt)}</span>
                            </li>
                        </ol>
                    </section>

                    <section aria-labelledby="pp-qa">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h2 id="pp-qa" className="font-display text-xl font-bold text-ink">
                                Inspection results
                            </h2>
                            <p className="text-sm text-ink-muted">
                                {s.qa.outcome === 'PASS' ? 'Passed' : 'Failed'} · {s.qa.inspectorName} · {dateTime(s.qa.inspectedAt)}
                            </p>
                        </div>
                        <div className="mt-3 overflow-x-auto rounded-2xl bg-paper-raised ring-1 ring-paper-line">
                            <table className="w-full min-w-[420px] text-sm" data-testid="passport-qa">
                                <caption className="sr-only">Inspection checks with nominal and measured values</caption>
                                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                                    <tr>
                                        <th scope="col" className="px-4 py-2.5 font-medium">Check</th>
                                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Nominal</th>
                                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Measured</th>
                                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {s.qa.checks.map((c, i) => (
                                        <tr key={`${c.label}-${i}`} className="border-t border-paper-line">
                                            <td className="px-4 py-2.5 text-ink">{c.label}</td>
                                            <td className="px-4 py-2.5 text-right font-mono tabular text-ink-muted">{c.nominalMm != null ? `${c.nominalMm.toFixed(2)} mm` : '—'}</td>
                                            <td className="px-4 py-2.5 text-right font-mono tabular text-ink">{c.measuredValue != null ? `${c.measuredValue.toFixed(2)} mm` : '—'}</td>
                                            <td className="px-4 py-2.5 text-right">
                                                {c.pass ? (
                                                    <span className="inline-flex items-center gap-1 text-[#14532d]">
                                                        <CheckCircle2 className="h-4 w-4" aria-hidden /> Pass
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[#7a3109]">
                                                        <XCircle className="h-4 w-4" aria-hidden /> Fail
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>

                <aside className="space-y-5 md:sticky md:top-24 md:self-start">
                    <div className="rounded-2xl bg-paper-raised p-5 ring-1 ring-paper-line">
                        <div className="mx-auto aspect-square w-full max-w-[200px]">
                            <QrCode value={p.verifyUrl} />
                        </div>
                        <p className="mt-3 text-center text-xs text-ink-muted">Scan to open this verify page. The same code is printed on the packaging.</p>
                    </div>
                    <div className="rounded-2xl bg-paper-raised p-5 ring-1 ring-paper-line">
                        <p className="flex items-center gap-2 font-semibold text-ink">
                            <ShieldCheck className="h-5 w-5 text-[#1d6b3a]" aria-hidden /> Signed record
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                            Every field above comes from the order records and is hashed and signed ({p.signatureAlg}) when the passport is activated. Re-checking recomputes both.
                        </p>
                        <p className="mt-3 break-all font-mono text-[11px] text-ink-subtle">sha256 {p.snapshotHash}</p>
                        <button
                            type="button"
                            onClick={runVerify}
                            disabled={verifying}
                            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-ink text-sm font-semibold text-paper hover:bg-black disabled:opacity-60"
                            data-testid="passport-verify"
                        >
                            {verifying ? 'Checking…' : 'Check signature now'}
                        </button>
                        {verify && (
                            <p className={cn('mt-3 text-sm font-medium', verify.valid ? 'text-[#14532d]' : 'text-[#7a3109]')} role="status" data-testid="passport-verify-result">
                                {verify.valid ? 'Valid: hash and signature match the record.' : 'Not valid: the record does not match its signature.'}
                            </p>
                        )}
                        {verifyError && (
                            <p className="mt-3 text-sm text-[#7a3109]" role="alert">
                                {verifyError}
                            </p>
                        )}
                        <p className="mt-3 text-[11px] text-ink-subtle">
                            Activated {dateTime(p.activatedAt)} · rules {s.rulesetVersion} · order {s.orderNumber}
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}
