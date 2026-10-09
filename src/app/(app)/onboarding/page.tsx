import type { Metadata } from 'next'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'

export const metadata: Metadata = { title: 'Get started', robots: { index: false } }

/** 60-second onboarding (workflow 10): intent, pick 5, an instant first build, save with a passkey. */
export default function OnboardingPage() {
    return <OnboardingFlow />
}
