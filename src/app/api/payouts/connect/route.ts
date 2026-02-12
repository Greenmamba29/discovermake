import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-01-27' as any,
    })
    : null;

export async function POST(req: Request) {
    try {
        if (!stripe) {
            return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
        }

        const { userId, email } = await req.json();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();

        let stripeAccountId = userData?.stripeAccountId;

        // 1. Create a Standard Connect account if the user doesn't have one
        if (!stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'standard',
                email: email,
                metadata: { userId },
            });
            stripeAccountId = account.id;
            await updateDoc(userRef, { stripeAccountId });
        }

        // 2. Create an account link for the onboarding flow
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: `${req.headers.get('origin')}/maker/earnings?error=refresh`,
            return_url: `${req.headers.get('origin')}/maker/earnings?success=true`,
            type: 'account_onboarding',
        });

        return NextResponse.json({ url: accountLink.url });
    } catch (error: any) {
        console.error('Stripe Connect Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
