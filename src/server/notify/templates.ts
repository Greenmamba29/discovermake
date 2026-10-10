/**
 * Plain, accessible transactional email templates (text + minimal HTML).
 * Every user-supplied value is HTML-escaped. Money is formatted from integer cents.
 */
import type { NotifyKind, NotifyPayloads } from './index';

export type RenderedEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatMoney(cents: number, currency: string): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
    } catch {
        return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }
}

type Block = { kind: 'p'; text: string } | { kind: 'link'; label: string; href: string };

function layout(subject: string, blocks: Block[]): RenderedEmail {
    const text = [
        ...blocks.map((b) => (b.kind === 'p' ? b.text : `${b.label}: ${b.href}`)),
        '',
        'DiscoverMake · Discover. Make. Build.',
    ].join('\n\n');
    const body = blocks
        .map((b) =>
            b.kind === 'p'
                ? `<p style="margin:0 0 16px">${escapeHtml(b.text)}</p>`
                : `<p style="margin:0 0 16px"><a href="${escapeHtml(b.href)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(b.label)}</a></p>`,
        )
        .join('');
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h1>${body}<p style="margin:32px 0 0;color:#666;font-size:12px">DiscoverMake · Discover. Make. Build.</p></body></html>`;
    return { subject, text, html };
}

export function renderEmail<K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]): RenderedEmail {
    switch (kind) {
        case 'order.confirmed': {
            const p = payload as NotifyPayloads['order.confirmed'];
            return layout(`Order ${p.orderNumber} confirmed`, [
                { kind: 'p', text: `Thanks! We received your payment of ${formatMoney(p.totalCents, p.currency)} and production is authorized.` },
                { kind: 'p', text: 'We are routing your parts to a vetted partner shop now. You can follow every step (shop acceptance, cutting, inspection, shipping) from your private order link below.' },
                { kind: 'link', label: 'Track your order', href: p.orderUrl },
                { kind: 'p', text: 'Keep this email: the link is your access to the order. Anyone with the link can view it.' },
            ]);
        }
        case 'order.payment_failed': {
            const p = payload as NotifyPayloads['order.payment_failed'];
            return layout(`Payment for ${p.orderNumber} did not go through`, [
                { kind: 'p', text: `Your payment for order ${p.orderNumber} failed${p.reason ? ` (${p.reason})` : ''}. Nothing has been charged and production has not started.` },
                { kind: 'p', text: 'You can return to your quote and check out again at any time while the quote is valid.' },
            ]);
        }
        case 'shop.job_offered': {
            const p = payload as NotifyPayloads['shop.job_offered'];
            return layout(`New job offer · ${p.orderNumber}`, [
                { kind: 'p', text: `Hi ${p.shopName}, a new job (${p.orderNumber}) is waiting for you in the Shop Console.` },
                { kind: 'p', text: `Please accept or decline before ${p.offerExpiresAt}. After that the offer goes to the next shop.` },
                { kind: 'link', label: 'Open Shop Console', href: p.consoleUrl },
            ]);
        }
        case 'order.in_production': {
            const p = payload as NotifyPayloads['order.in_production'];
            return layout(`${p.orderNumber} is in production`, [
                { kind: 'p', text: `${p.shopName} has started making your parts. We will email you again when they pass inspection and ship.` },
            ]);
        }
        case 'order.shipped': {
            const p = payload as NotifyPayloads['order.shipped'];
            const blocks: Block[] = [
                { kind: 'p', text: `Your parts passed inspection and shipped with ${p.carrier}. Tracking number: ${p.trackingNumber}.` },
            ];
            if (p.trackingUrl) blocks.push({ kind: 'link', label: 'Track the package', href: p.trackingUrl });
            return layout(`${p.orderNumber} has shipped`, blocks);
        }
        case 'order.delivered': {
            const p = payload as NotifyPayloads['order.delivered'];
            const blocks: Block[] = [{ kind: 'p', text: `Order ${p.orderNumber} was delivered. Thank you for making with DiscoverMake.` }];
            if (p.passportUrl) {
                blocks.push({ kind: 'p', text: 'Your Product Passport is now active: a signed record of the material, process, shop and inspection behind your parts.' });
                blocks.push({ kind: 'link', label: 'View your Product Passport', href: p.passportUrl });
            }
            return layout(`${p.orderNumber} delivered`, blocks);
        }
        case 'build_slot.released': {
            const p = payload as NotifyPayloads['build_slot.released'];
            return layout(`Your Build Slot for ${p.dropTitle} was released`, [
                { kind: 'p', text: `${p.reason} Order ${p.orderNumber} is cancelled and the payment hold on your card was released: nothing was charged.` },
                { kind: 'p', text: 'Follow the channel to hear about the next drop.' },
            ]);
        }
        case 'ops.alert': {
            const p = payload as NotifyPayloads['ops.alert'];
            return layout(`[ops] ${p.subject}`, [
                { kind: 'p', text: p.message },
                ...(p.orderId ? [{ kind: 'p' as const, text: `Order: ${p.orderId}` }] : []),
            ]);
        }
        case 'auth.sign_in_code': {
            const p = payload as NotifyPayloads['auth.sign_in_code'];
            return layout('Your DiscoverMake sign-in code', [
                { kind: 'p', text: `Enter ${p.code} to sign in to DiscoverMake. The code works once and expires in ${p.expiresMinutes} minutes.` },
                { kind: 'p', text: 'If you did not ask for this code, you can ignore this email. Nobody can sign in without it.' },
            ]);
        }
        case 'auction.outbid': {
            const p = payload as NotifyPayloads['auction.outbid'];
            return layout(`You were outbid on ${p.auctionTitle}`, [
                { kind: 'p', text: `Someone bid ${formatMoney(p.amountCents, p.currency)}. Bid ${formatMoney(p.nextMinimumCents, p.currency)} or more to take the lead. Your earlier hold is released when the auction closes unless you win.` },
                { kind: 'link', label: 'Back to the auction', href: p.showUrl },
            ]);
        }
        case 'family.kid_request': {
            const p = payload as NotifyPayloads['family.kid_request'];
            return layout(`${p.kidNickname} asked for a ${p.templateTitle}`, [
                { kind: 'p', text: `${p.kidNickname} designed a ${p.templateTitle} in Kids mode and asked you to say yes. The price is ${formatMoney(p.priceCents, p.currency)} (a binding 3D-print quote, plus shipping).` },
                { kind: 'p', text: 'Open Family to see the design, then approve and pay through your usual checkout, or say not this time with a kind note.' },
                { kind: 'link', label: 'Open your Family requests', href: p.familyUrl },
            ]);
        }
        case 'auction.won': {
            const p = payload as NotifyPayloads['auction.won'];
            return layout(`You won ${p.auctionTitle}`, [
                { kind: 'p', text: `Your winning bid of ${formatMoney(p.amountCents, p.currency)} was charged and order ${p.orderNumber} is going to production. Every other hold you had on this auction was released.` },
            ]);
        }
        default: {
            const never: never = kind as never;
            throw new Error(`Unknown notification kind ${String(never)}`);
        }
    }
}
