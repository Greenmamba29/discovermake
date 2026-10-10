# Legal documents: data inventory and high-stakes review

The customer documents live in `src/lib/legal.ts` and are served at `/legal/terms`, `/legal/privacy`, `/legal/refunds` and `/legal/prohibited-items`. They are drafts. Each page shows **"Draft for legal review"** until the owner sets `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE` (YYYY-MM-DD) after counsel approves the exact text. Optional overrides: `NEXT_PUBLIC_LEGAL_ENTITY`, `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`, `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL`.

## Data inventory (what the code does)

| Data | Where | Why | Shared with |
|---|---|---|---|
| Buyer email, name, shipping address, phone (optional) | `orders` | Fulfilment, receipts, support | Partner shop on direct ship; EasyPost/carrier; Resend |
| Design files and analysis | object storage `parts/…`, `builds/…`; `parts.features/dfm` | Quote and manufacture | Partner shop (job packet, signed links); Accio gets a REDACTED package only |
| Make AI prompt | sent to Google (Gemini); `make_intents` stores sha256 + length only | Estimates | Google |
| Accounts: email, display name, handle, roles; passkey public keys; OAuth subject ids | `users`, `passkeys`, `oauth_accounts` | Sign-in | Google / Apple (sign-in only) |
| Cookies: `dm_device`, `dm_session`, `dm_shop_session`, OAuth state/PKCE | hashed server-side | Strictly necessary | none |
| IP address | rate limiter (memory or `rate_limit_buckets`, short TTL); sourcing audit for MCP calls | Abuse prevention, audit | none |
| Payment status | `payments` (Stripe ids, no card data) | Payment | Stripe |
| Order link tokens | HMAC only; sealed copy for email (ADR-0008) | Guest tracking | Stripe success URL |

## High-stakes review: customer legal documents

Stakes: **legal + privacy**. Verdict: **needs counsel** (this is their first publication).

| Regulation / term | Applies because | Requirement | Met in draft? |
|---|---|---|---|
| GDPR / UK GDPR | EU/UK buyers possible | Lawful basis, processors, rights, transfers, retention | Yes in outline; retention periods need owner decision |
| CCPA / CPRA | California buyers | Categories, no sale/share, rights, contact | Yes; "do not sell" stated |
| COPPA | General audience | Not directed to under-13s | Yes |
| ePrivacy (cookies) | EU visitors | Consent unless strictly necessary | Only necessary cookies are used, so no banner is needed today |
| U.S. EAR / OFAC | Manufactured goods and technical data, cross-border sourcing | Screening, embargo refusal | Policy stated; **screening is not implemented in code yet** (GA item) |
| Consumer law (EU 14-day withdrawal) | EU consumers | Custom-made goods exemption | Exemption relied on implicitly; counsel to confirm wording |
| CAN-SPAM | Transactional email only today | Marketing needs an unsubscribe link | No marketing email is sent yet |

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Liability cap unenforceable for consumers in some places | 3 × 3 = 9 | "to the extent the law allows" + statutory rights carve-out; counsel review |
| Retention not specified as periods | 3 × 4 = 12 | **Owner decides** retention per data class; then update privacy text and add purge jobs |
| Export screening promised but not automated | 4 × 3 = 12 | Add denied-party screening at checkout before GA |
| Missed-promise credit terms not defined | 3 × 3 = 9 | Defined with the Delivery Promise credit policy (Stage 2 owner input) |

**Human decisions needed:** legal entity name; retention periods; counsel review of all four texts; whether to use a denied-party screening provider; the credit policy for missed promises; then set `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE`. Keep previous versions in git history; any change to the text is a new legal-stakes approval.
