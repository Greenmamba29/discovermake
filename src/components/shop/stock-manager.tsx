'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Boxes, Minus, Plus } from 'lucide-react';
import type { ShopStockView } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { EmptyState, ErrorState, Notice } from '@/components/ui/state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { primeApi } from '@/lib/prime-api';

const KEY = ['shop-stock'] as const;

function StockRow({ line }: { line: ShopStockView }) {
    const qc = useQueryClient();
    const [qty, setQty] = useState(String(line.quantity));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => setQty(String(line.quantity)), [line.quantity]);
    const save = async (next: number) => {
        if (!Number.isInteger(next) || next < 0) return setError('Enter a whole number, 0 or more.');
        setBusy(true);
        setError(null);
        try {
            await primeApi.updateStock(line.id, next);
            await qc.invalidateQueries({ queryKey: KEY });
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const inputId = `stock-qty-${line.id}`;
    return (
        <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`stock-row-${line.sku}`}>
            <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-fg">{line.description}</p>
                <p className="font-mono text-[11px] text-fg-subtle">
                    {line.sku} · {line.kind === 'SHEET' ? 'Sheet' : 'Hardware'} · updated {dateTime(line.updatedAt)}
                </p>
                {error && (
                    <p className="mt-1 text-xs text-ember" role="alert">
                        {error}
                    </p>
                )}
            </div>
            <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" aria-label={`One less ${line.sku}`} disabled={busy || line.quantity === 0} onClick={() => save(line.quantity - 1)}>
                    <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <label htmlFor={inputId} className="sr-only">
                    Quantity of {line.sku} ({line.unit})
                </label>
                <TextInput
                    id={inputId}
                    inputMode="numeric"
                    className="w-20 text-center font-mono"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    onBlur={() => Number(qty) !== line.quantity && save(Number(qty))}
                    data-testid={`stock-qty-${line.sku}`}
                />
                <Button size="sm" variant="ghost" aria-label={`One more ${line.sku}`} disabled={busy} onClick={() => save(line.quantity + 1)}>
                    <Plus className="h-4 w-4" aria-hidden />
                </Button>
                <span className="w-10 text-xs text-fg-muted">{line.unit}</span>
            </div>
        </li>
    );
}

function AddStockForm() {
    const qc = useQueryClient();
    const [kind, setKind] = useState<'SHEET' | 'HARDWARE'>('HARDWARE');
    const [sku, setSku] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('0');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setNotice(null);
        try {
            await primeApi.upsertStock({ kind, sku: sku.trim(), description: description.trim(), quantity: Number(quantity), unit: kind === 'SHEET' ? 'sheet' : 'pcs' });
            setNotice({ tone: 'success', text: `${sku.trim()} saved.` });
            setSku('');
            setDescription('');
            setQuantity('0');
            await qc.invalidateQueries({ queryKey: KEY });
        } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err) });
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" aria-labelledby="add-stock-heading">
            <h2 id="add-stock-heading" className="font-display text-lg font-bold">
                Add or replace a stock line
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type">
                    {({ id }) => (
                        <SelectInput id={id} value={kind} onChange={(e) => setKind(e.target.value as 'SHEET' | 'HARDWARE')}>
                            <option value="HARDWARE">Hardware</option>
                            <option value="SHEET">Sheet</option>
                        </SelectInput>
                    )}
                </Field>
                <Field label="SKU" hint="Letters, digits, dot, dash or underscore.">
                    {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={sku} maxLength={80} onChange={(e) => setSku(e.target.value)} data-testid="stock-new-sku" />}
                </Field>
                <Field label="Description">{({ id }) => <TextInput id={id} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} data-testid="stock-new-description" />}</Field>
                <Field label="Quantity">{({ id }) => <TextInput id={id} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="stock-new-quantity" />}</Field>
            </div>
            <Button type="submit" loading={busy} disabled={!sku.trim() || !description.trim()} data-testid="stock-new-submit">
                Save stock line
            </Button>
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </form>
    );
}

/** Shop Console · Stock: the partner's sheet and hardware on hand. Quotes filled from stock get the fastest delivery promise. */
export function StockManager() {
    const router = useRouter();
    const { data, error, isLoading, refetch } = useQuery({ queryKey: KEY, queryFn: () => primeApi.shopStock() });
    const unauthorized = error instanceof ApiClientError && error.status === 401;
    useEffect(() => {
        if (unauthorized) router.replace('/shop');
    }, [unauthorized, router]);
    if (isLoading || unauthorized) return <PageSkeleton label="Loading stock" />;
    if (error || !data) return <ErrorState title="Could not load stock" message={errorMessage(error)} action={<Button onClick={() => refetch()}>Try again</Button>} />;
    return (
        <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
            <div>
                <p className="eyebrow">Shop Console</p>
                <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">Stock</h1>
                <p className="mt-1 text-sm text-fg-muted">Keep this current: orders we can fill from your shelf get the fastest delivery date, and your shop is preferred for them.</p>
            </div>
            {data.stock.length === 0 ? (
                <EmptyState icon={<Boxes className="h-8 w-8" aria-hidden />} title="No stock tracked yet">
                    Add the sheet and hardware you keep on hand.
                </EmptyState>
            ) : (
                <ul className="divide-y divide-graphite-700 overflow-hidden rounded-2xl bg-graphite-900 ring-1 ring-graphite-700" aria-label="Stock on hand" data-testid="stock-list">
                    {data.stock.map((line) => (
                        <StockRow key={line.id} line={line} />
                    ))}
                </ul>
            )}
            <AddStockForm />
        </div>
    );
}
