import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, setDoc, serverTimestamp } from 'firebase/firestore';

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-01-27' as any,
    })
    : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
    if (!stripe || !webhookSecret) {
        return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
    }

    const body = await req.text();
    const sig = req.headers.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const { userId, templateId, plan } = session.metadata || {};

        if (!userId) {
            console.error('Missing userId in session metadata');
            return NextResponse.json({ received: true });
        }

        const userRef = doc(db, 'users', userId);

        if (plan === 'pro') {
            await updateDoc(userRef, {
                subscription_tier: 'pro',
                subscription: 'Pro Monthly',
                stripeCustomerId: session.customer as string,
            });
        } else if (templateId) {
            // Record the individual purchase
            await setDoc(doc(db, 'purchases', `${userId}_${templateId}`), {
                uid: userId,
                templateId,
                amount: session.amount_total! / 100,
                stripeSessionId: session.id,
                createdAt: serverTimestamp(),
                status: 'complete'
            });

            // Add to user's saved_templates/library
            await updateDoc(userRef, {
                saved_templates: arrayUnion(templateId)
            });
        }
    }

    return NextResponse.json({ received: true });
}
