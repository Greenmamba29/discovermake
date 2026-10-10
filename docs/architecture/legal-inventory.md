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
| **Kids & Family** (docs/architecture/kids-family.md): per kid profile a nickname (≤ 12 letters/numbers, set by the grown-up), an age band (6–9 / 10–12 / 13–17), a preset avatar id, the grown-up's controls; per design the template, its bounded options and ≤ 12 characters of label; requests and an activity log. Grown-up PIN as a scrypt hash. Nothing else about a child (no email, phone, photo, address, school, birthday, location) | `kid_profiles`, `kid_designs` (+ STL/GLB under `kids/designs/…` and `parts/…`), `kid_requests`, `family_activity`, `families.pin_hash`, `kid_mode_locks`; `dm_kid` cookie (signed, HttpOnly) | Let a kid design and ask; show the grown-up what was asked; make and ship the approved order; approval log. **Retention:** while the profile exists; one-tap delete removes profile, designs, requests, activity and unordered builds/files; paid orders stay as the grown-up's purchase records. **Parental access:** Family page (review, change, delete), privacy email | Partner shop receives the print file (with the printed label) for approved orders only; Resend (email to the grown-up only). Never an AI model, never public, no analytics |

## High-stakes review: customer legal documents

Stakes: **legal + privacy**. Verdict: **needs counsel** (this is their first publication).

| Regulation / term | Applies because | Requirement | Met in draft? |
|---|---|---|---|
| GDPR / UK GDPR | EU/UK buyers possible | Lawful basis, processors, rights, transfers, retention | Yes in outline; retention periods need owner decision |
| CCPA / CPRA | California buyers | Categories, no sale/share, rights, contact | Yes; "do not sell" stated |
| COPPA | General audience; **Kids & Family lets under-13s use the grown-up's device** | Verifiable parental consent before collecting a child's personal information; direct notice to parents; parental review/delete; data minimisation; retention limits; no conditioning on more data than needed | Partly by design: the parent is the signed-in account holder who sets up profiles; the child provides no contact or identifying data (nickname, age band, preset avatar, ≤ 12-character label); review and one-tap delete on /family. **Open:** whether a nickname + printed label is "personal information" under 16 CFR 312.2, whether a signed-in account holder suffices as verifiable consent (and which method under 312.5), the notice wording, retention period. **Verdict: needs counsel before launch** |
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

### Kids & Family (high-stakes: children's data)

Stakes: **privacy (children) + legal**. Verdict: **needs counsel before launch**. The Kids section of the Privacy Policy is a draft behind the same "Draft for legal review" banner and is marked "needs counsel review". Before launch: counsel confirms the COPPA analysis above (consent method, notice, whether the label/nickname is personal information), state laws (e.g. California's Age-Appropriate Design Code, CCPA minors), UK Children's Code / GDPR Art. 8 if offered outside the US, and the retention period for kid designs. Engineering facts counsel can rely on: no third-party analytics or advertising in Kids mode; nothing a kid types reaches an AI model or a public page (kid builds cannot be published); kids cannot chat, upload, check out or change settings (server-enforced, `src/lib/kids/policy.ts`); notifications go only to the grown-up's account email.

**Human decisions needed:** legal entity name; retention periods; counsel review of all four texts; whether to use a denied-party screening provider; the credit policy for missed promises; then set `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE`. Keep previous versions in git history; any change to the text is a new legal-stakes approval.
