'use client';

/** WebAuthn ceremonies in the browser (@simplewebauthn/browser v13) wired to our routes. */
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { SignInResponse } from '@/contracts/account';
import { accountApi } from './account-api';

export function passkeysSupported(): boolean {
    try {
        return browserSupportsWebAuthn();
    } catch {
        return false;
    }
}

/** Turn browser WebAuthn errors into plain words; null when the person just cancelled. */
export function passkeyErrorMessage(err: unknown): string | null {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return null;
    if (name === 'InvalidStateError') return 'This device already has a passkey for your account.';
    if (err instanceof Error && err.message) return err.message;
    return 'The passkey did not work. Try again, or use your email.';
}

export async function addPasskey(name?: string): Promise<string> {
    const optionsJSON = (await accountApi.passkeyRegisterOptions()) as unknown as PublicKeyCredentialCreationOptionsJSON;
    const response = await startRegistration({ optionsJSON });
    return (await accountApi.passkeyRegisterVerify(response, name)).passkeyId;
}

export async function signInWithPasskey(): Promise<SignInResponse> {
    const { challengeId, ...options } = await accountApi.passkeyLoginOptions();
    const response = await startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
    return accountApi.passkeyLoginVerify(challengeId, response);
}
