'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Fingerprint, Mail } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { accountApi, useInvalidateAccount, useMe } from './account-api';
import { passkeyErrorMessage, passkeysSupported, signInWithPasskey } from './passkey-client';

const OAUTH_ERRORS: Record<string, string> = {
    state: 'That sign-in link expired or was opened in another browser. Try again.',
    denied: 'Sign-in was cancelled.',
    unverified_email: 'Your provider did not confirm your email address. Use another way to sign in.',
    claims: 'We could not confirm that sign-in. Try again.',
    exchange: 'We could not reach the sign-in provider. Try again in a moment.',
};

type Step = { kind: 'email' } | { kind: 'code'; email: string; challengeId: string; devCode?: string };

/**
 * Sign in / create an account (ADR-0009). Deferred signup (Behance pattern): people quote and
 * build first, and are asked to sign in only to save, order or sell. Email code first, then
 * passkey, then Google / Apple when this deployment has them.
 */
export function SignInScreen({ next, mode, error }: { next: string; mode: 'signin' | 'create'; error: string | null }) {
    const router = useRouter();
    const me = useMe();
    const invalidate = useInvalidateAccount();
    const [step, setStep] = useState<Step>({ kind: 'email' });
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(error ? (OAUTH_ERRORS[error] ?? 'Sign-in did not complete. Try again.') : null);
    const [pending, setPending] = useState<'email' | 'code' | 'passkey' | null>(null);
    const [canPasskey, setCanPasskey] = useState(false);
    const codeRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    useEffect(() => setCanPasskey(passkeysSupported()), []);
    useEffect(() => {
        if (step.kind === 'code') codeRef.current?.focus();
    }, [step]);

    const providers = me.data?.providers ?? ['email', 'passkey'];
    const create = mode === 'create';

    async function finish() {
        await invalidate();
        router.replace(next);
        router.refresh();
    }

    async function sendCode(e?: FormEvent) {
        e?.preventDefault();
        setFieldError(null);
        setFormError(null);
        const value = email.trim();
        if (!/^\S+@\S+\.\S+$/.test(value)) {
            setFieldError('Enter your email address, like you@example.com.');
            emailRef.current?.focus();
            return;
        }
        setPending('email');
        try {
            const res = await accountApi.emailStart(value);
            setCode('');
            setStep({ kind: 'code', email: value, challengeId: res.challengeId, devCode: res.devCode });
        } catch (err) {
            setFieldError(errorMessage(err));
            emailRef.current?.focus();
        } finally {
            setPending(null);
        }
    }

    async function verify(e: FormEvent) {
        e.preventDefault();
        if (step.kind !== 'code') return;
        setFieldError(null);
        if (!/^\d{6}$/.test(code.trim())) {
            setFieldError('Enter the 6 digits from the email.');
            codeRef.current?.focus();
            return;
        }
        setPending('code');
        try {
            await accountApi.emailVerify(step.challengeId, code.trim());
            await finish();
        } catch (err) {
            setFieldError(errorMessage(err));
            codeRef.current?.focus();
            setPending(null);
        }
    }

    async function passkey() {
        setFormError(null);
        setPending('passkey');
        try {
            await signInWithPasskey();
            await finish();
        } catch (err) {
            const msg = passkeyErrorMessage(err);
            if (msg) setFormError(msg);
            setPending(null);
        }
    }

    if (me.data?.viewer && pending === null) {
        return (
            <Shell title="You are signed in" lead={`Signed in as ${me.data.viewer.email}.`}>
                <Link href={next} className={buttonClass('primary', 'lg', 'w-full')} data-testid="signin-continue">
                    Continue
                </Link>
            </Shell>
        );
    }

    return (
        <Shell
            title={create ? 'Save your build' : 'Sign in'}
            lead={
                create
                    ? 'Create a free account so your builds, quotes and orders stay with you on every device. No password needed.'
                    : 'Use a code from your email or a passkey. No password needed.'
            }
        >
            {formError && (
                <Notice tone="error" className="mb-4" testId="signin-error">
                    {formError}
                </Notice>
            )}

            {step.kind === 'email' ? (
                <form onSubmit={sendCode} noValidate className="flex flex-col gap-3" aria-label="Sign in with email">
                    <Field label="Email" error={fieldError} hint="We will send you a 6-digit code.">
                        {({ id, describedBy, invalid }) => (
                            <TextInput
                                ref={emailRef}
                                id={id}
                                type="email"
                                inputMode="email"
                                autoComplete="email webauthn"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setFieldError(null);
                                }}
                                placeholder="you@example.com"
                                aria-describedby={describedBy}
                                aria-invalid={invalid}
                                data-testid="signin-email"
                            />
                        )}
                    </Field>
                    <Button type="submit" size="lg" loading={pending === 'email'} disabled={pending !== null} data-testid="signin-email-submit">
                        {pending !== 'email' && <Mail className="h-5 w-5" aria-hidden />}
                        {create ? 'Continue with email' : 'Email me a code'}
                    </Button>
                </form>
            ) : (
                <form onSubmit={verify} noValidate className="flex flex-col gap-3" aria-label="Enter your code">
                    <p className="text-sm text-fg-muted" aria-live="polite">
                        We sent a code to <span className="font-semibold text-fg">{step.email}</span>. It works for 10 minutes.
                    </p>
                    {step.devCode && (
                        <Notice tone="info" testId="signin-dev-code" title="Development mode">
                            No email provider is configured, so here is your code: <span className="font-mono font-semibold text-fg">{step.devCode}</span>
                        </Notice>
                    )}
                    <Field label="6-digit code" error={fieldError}>
                        {({ id, describedBy, invalid }) => (
                            <TextInput
                                ref={codeRef}
                                id={id}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                pattern="[0-9]*"
                                maxLength={6}
                                value={code}
                                onChange={(e) => {
                                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                                    setFieldError(null);
                                }}
                                className="font-mono text-lg tracking-[0.4em]"
                                aria-describedby={describedBy}
                                aria-invalid={invalid}
                                data-testid="signin-code"
                            />
                        )}
                    </Field>
                    <Button type="submit" size="lg" loading={pending === 'code'} disabled={pending !== null} data-testid="signin-code-submit">
                        {create ? 'Create account' : 'Sign in'}
                    </Button>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg px-1 py-1 text-fg-muted hover:text-fg"
                            onClick={() => {
                                setStep({ kind: 'email' });
                                setFieldError(null);
                                setTimeout(() => emailRef.current?.focus(), 0);
                            }}
                        >
                            <ArrowLeft className="h-4 w-4" aria-hidden />
                            Use a different email
                        </button>
                        <button type="button" className="rounded-lg px-1 py-1 font-medium text-signal hover:underline" onClick={() => sendCode()} disabled={pending !== null}>
                            Send a new code
                        </button>
                    </div>
                </form>
            )}

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-fg-subtle" aria-hidden>
                <span className="h-px flex-1 bg-graphite-700" />
                or
                <span className="h-px flex-1 bg-graphite-700" />
            </div>

            <div className="flex flex-col gap-3">
                {providers.includes('passkey') && (
                    <Button variant="secondary" size="lg" onClick={passkey} loading={pending === 'passkey'} disabled={pending !== null || !canPasskey} data-testid="signin-passkey" aria-describedby={!canPasskey ? 'passkey-unsupported' : undefined}>
                        {pending !== 'passkey' && <Fingerprint className="h-5 w-5" aria-hidden />}
                        Sign in with a passkey
                    </Button>
                )}
                {!canPasskey && (
                    <p id="passkey-unsupported" className="text-xs text-fg-subtle">
                        This browser does not support passkeys.
                    </p>
                )}
                {providers.includes('google') && (
                    <a href={`/api/auth/oauth/google?next=${encodeURIComponent(next)}`} className={buttonClass('secondary', 'lg')} data-testid="signin-google">
                        Continue with Google
                    </a>
                )}
                {providers.includes('apple') && (
                    <a href={`/api/auth/oauth/apple?next=${encodeURIComponent(next)}`} className={buttonClass('secondary', 'lg')} data-testid="signin-apple">
                        Continue with Apple
                    </a>
                )}
            </div>
            <p className="mt-6 text-xs text-fg-subtle">New here? Signing in creates your account. Builds and orders from this browser come with you.</p>
        </Shell>
    );
}

function Shell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
            <p className="eyebrow">Account</p>
            <h1 className="mt-2 font-display font-wide text-3xl font-extrabold">{title}</h1>
            <p className="mt-2 text-fg-muted">{lead}</p>
            <div className="mt-8 rounded-2xl bg-graphite-900 p-5 ring-1 ring-graphite-700 sm:p-6">{children}</div>
        </div>
    );
}
