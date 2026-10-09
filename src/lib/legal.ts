/**
 * Customer-facing legal documents (GA hardening, workflow 14).
 *
 * These texts are drafted against what the code actually does (data inventory in
 * docs/architecture/legal-inventory.md). They are NOT in effect until the owner and
 * counsel approve them: pages show a "Draft for legal review" banner until
 * NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE (YYYY-MM-DD) is set at build time.
 */

export type LegalSection = { heading: string; paragraphs: string[]; bullets?: string[] };
export type LegalDoc = {
    slug: LegalSlug;
    title: string;
    summary: string;
    sections: LegalSection[];
};

export const LEGAL_SLUGS = ['terms', 'privacy', 'refunds', 'prohibited-items'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** Effective date once approved; null while the documents are drafts. */
export function legalEffectiveDate(): string | null {
    const v = process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE?.trim();
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export const LEGAL_ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() || 'DiscoverMake';
export const LEGAL_CONTACT = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || 'legal@discovermake.com';
export const PRIVACY_CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() || 'privacy@discovermake.com';

const terms: LegalDoc = {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The agreement between you and DiscoverMake when you get quotes, place orders, sell designs or work jobs as a partner shop.',
    sections: [
        {
            heading: 'Who we are and what we do',
            paragraphs: [
                `${LEGAL_ENTITY} ("DiscoverMake", "we") runs a manufacturing service. You upload or describe a part, we quote it, and a vetted partner shop or sourced supplier makes and ships it. When we show a Binding quote, we are the seller to you, and we commit to that price and ship date.`,
                'Some prices are labelled AI estimate, Supplier estimate or Supplier-confirmed. Those are not offers to sell and cannot be ordered until they become a Binding quote.',
            ],
        },
        {
            heading: 'Accounts and guest checkout',
            paragraphs: [
                'You can get quotes and order as a guest. Your order link works like a key: anyone with it can see your order status, so keep it private. If you create an account (email code, passkey, Google or Apple), you are responsible for activity under it.',
                'You must be at least 18 years old, or the age of majority where you live, to place an order or sell on DiscoverMake.',
            ],
        },
        {
            heading: 'Your designs',
            paragraphs: [
                'You keep ownership of the designs you upload. You give us, and the partner shops and suppliers we route your order to, a limited licence to store, analyze, quote and manufacture them for your orders, and to keep a record of what was made (the Product Passport).',
                'You confirm you have the right to manufacture what you upload, and that it does not infringe anyone else\'s rights or break the law. We may refuse or cancel any job, including anything on our Prohibited items list.',
                'Sourcing partners receive only a redacted design package unless you or our staff approve releasing the full package to a named supplier.',
            ],
        },
        {
            heading: 'Quotes, prices and payment',
            paragraphs: [
                'A Binding quote is valid until the time shown on it. The price is calculated on our servers; the total at checkout includes the part price, shipping and any taxes shown. Payment is processed by Stripe; we never see or store your full card number.',
                'If a part needs engineering review, we will tell you before you pay. We do not charge you for review-only quotes.',
            ],
        },
        {
            heading: 'Production, shipping and delivery dates',
            paragraphs: [
                'We show one ship date or arrival date. When we show a guaranteed arrival date and miss it for reasons within our control, you receive the credit described on your order. Delays caused by carriers, customs, weather or incorrect address details are not within our control unless the order says otherwise.',
                'Risk of loss passes to you when the carrier delivers the order to your shipping address.',
            ],
        },
        {
            heading: 'Creators and remixes',
            paragraphs: [
                'If you publish a design for others to remix or order, you grant DiscoverMake and buyers the licence described on that design, and you will be paid the royalty shown on it through our payment provider. You remain responsible for the rights in what you publish.',
            ],
        },
        {
            heading: 'Partner shops',
            paragraphs: [
                'Partner shops work under a separate Shop Agreement. Shop Console access tokens are confidential and may be revoked at any time.',
            ],
        },
        {
            heading: 'Liability',
            paragraphs: [
                'Parts are made to the design and selections you approved. We are not responsible for whether your design is fit for a particular purpose unless we agreed to that in writing. To the extent the law allows, our total liability for any order is limited to the amount you paid for that order. Nothing in these terms limits liability that cannot be limited by law, or your statutory rights as a consumer.',
            ],
        },
        {
            heading: 'Changes and contact',
            paragraphs: [
                `We will post changes to these terms on this page with a new effective date and, for material changes, tell account holders by email. Questions: ${LEGAL_CONTACT}.`,
            ],
        },
    ],
};

const privacy: LegalDoc = {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What personal data DiscoverMake collects, why, who processes it, how long we keep it, and your rights.',
    sections: [
        {
            heading: 'What we collect',
            paragraphs: ['We collect only what we need to quote, make, ship and support your order.'],
            bullets: [
                'Contact and order details: email, name, shipping address and optional phone number.',
                'Design files you upload and the analysis we compute from them (geometry, manufacturability checks, quotes).',
                'Account data if you create one: email, display name, creator handle, and passkey public keys (never your fingerprint, face or device PIN).',
                'Make AI descriptions: your text is sent to our AI provider to produce an estimate; we store a fingerprint and length of it, not the text itself.',
                'Payment status from Stripe. We never receive or store full card numbers.',
                'Technical data: a device cookie that keeps your guest builds together, a session cookie when signed in, and IP addresses used briefly for rate limiting and fraud prevention.',
            ],
        },
        {
            heading: 'Why we use it',
            paragraphs: [
                'To provide the service you asked for (quoting, production, shipping, support), to keep the service secure, to meet legal obligations (tax, accounting), and, with your consent where required, to send product updates. We do not sell personal data and do not use it for cross-site advertising.',
            ],
        },
        {
            heading: 'Who we share it with',
            paragraphs: ['We share data only with the service providers and partners needed to run your order:'],
            bullets: [
                'Partner shops and suppliers making your order (design files, and your shipping details when they ship directly).',
                'Sourcing partners (Accio Work), which receive a redacted design package without your identity.',
                'Stripe (payments), EasyPost and carriers (shipping labels and tracking), Resend (email), Google (Make AI model), and our hosting, database and storage providers.',
            ],
        },
        {
            heading: 'How long we keep it',
            paragraphs: [
                'Order, payment and Product Passport records are kept as long as required for tax, accounting and warranty purposes. Account data is kept while your account is open. Rate-limit records expire within hours. You can ask us to delete your account and the personal data we are not required to keep.',
            ],
        },
        {
            heading: 'Your rights',
            paragraphs: [
                `Depending on where you live (for example under the GDPR, UK GDPR or California law) you can ask to access, correct, delete or export your personal data, or object to certain uses. Email ${PRIVACY_CONTACT}. We will verify the request and respond within the time the law requires. You can also complain to your local data protection authority.`,
            ],
        },
        {
            heading: 'Cookies',
            paragraphs: [
                'We use only strictly necessary cookies: the device cookie, the sign-in session cookie, the partner shop session cookie, and short-lived cookies that protect sign-in with Google or Apple. We do not use advertising or third-party analytics cookies.',
            ],
        },
        {
            heading: 'Children',
            paragraphs: ['DiscoverMake is not directed to children under 13, and we do not knowingly collect their data.'],
        },
        {
            heading: 'International transfers and security',
            paragraphs: [
                'Our providers may process data outside your country, under contractual safeguards. Access tokens and links are stored as one-way hashes, traffic is encrypted, and design files are reachable only through signed, expiring links.',
            ],
        },
    ],
};

const refunds: LegalDoc = {
    slug: 'refunds',
    title: 'Refunds & Quality Guarantee',
    summary: 'What happens when a part is wrong, late or damaged.',
    sections: [
        {
            heading: 'Our quality guarantee',
            paragraphs: [
                'Every order is inspected against an inspection plan before it ships, and the results are recorded on its Product Passport. If a part does not match the design and selections you approved, within the tolerances shown at checkout, we will remake it or refund it.',
            ],
        },
        {
            heading: 'How to report a problem',
            paragraphs: [
                'Report problems within 14 days of delivery from your order page, with photos. We may ask you to return the part; we pay return shipping when the fault is ours.',
            ],
        },
        {
            heading: 'Cancellations',
            paragraphs: [
                'Custom parts are made to order. You can cancel for a full refund until a partner shop accepts the job; after that we can only refund the work not yet done. Build Slots and live drops are authorised but not charged until the run is confirmed; if a run does not reach its minimum, every slot is released or refunded automatically.',
            ],
        },
        {
            heading: 'Late deliveries',
            paragraphs: [
                'If we miss a guaranteed arrival date for reasons within our control, we credit the amount shown on your order automatically. You do not need to ask.',
            ],
        },
        {
            heading: 'Refund timing',
            paragraphs: ['Refunds go back to the original payment method through Stripe, usually within 5–10 business days depending on your bank.'],
        },
    ],
};

const prohibited: LegalDoc = {
    slug: 'prohibited-items',
    title: 'Prohibited items & export control',
    summary: 'What we will not make, and the export rules every order follows.',
    sections: [
        {
            heading: 'We will not make',
            paragraphs: ['We refuse or cancel jobs that include, or are clearly intended to be part of:'],
            bullets: [
                'Firearms, firearm frames or receivers, suppressors, and parts whose purpose is to convert or modify a weapon.',
                'Weapons designed to injure people, and explosive or incendiary devices.',
                'Drug paraphernalia, and devices intended to defeat locks, meters, emissions or safety systems you do not own.',
                'Counterfeit goods, or designs that infringe someone else\'s trademark, patent or copyright.',
                'Medical devices, safety-critical vehicle or aircraft parts, and pressure vessels, unless we have agreed in writing that a certified route applies.',
                'Anything illegal where it is made, shipped from or delivered to.',
            ],
        },
        {
            heading: 'Export control and sanctions',
            paragraphs: [
                'Orders must comply with U.S. export control and sanctions laws (including the EAR and OFAC rules) and those of the countries involved. We do not ship to embargoed destinations or restricted parties, and we may ask for end-use information for controlled items. You must not upload technical data that you are not authorised to share with us or our partners.',
            ],
        },
        {
            heading: 'Reporting',
            paragraphs: [`To report a listing or design that breaks these rules, email ${LEGAL_CONTACT}.`],
        },
    ],
};

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
    terms,
    privacy,
    refunds,
    'prohibited-items': prohibited,
};
