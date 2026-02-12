import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-01-27' as any,
    })
    : null;

export async function POST(req: Request) {
    try {
        if (!stripe) {
            return NextResponse.json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to environment.' }, { status: 503 });
        }
        const { templateId, price, userId, email, plan } = await req.json();

        if (!userId || !email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let session: Stripe.Checkout.Session;

        if (plan === 'pro') {
            // Subscription Flow
            session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: 'DiscoverMake Pro Subscription',
                                description: 'Unlimited access to all premium templates and AI Architect features.',
                            },
                            unit_amount: 4900,
                            recurring: { interval: 'month' },
                        },
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: `${req.headers.get('origin')}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${req.headers.get('origin')}/pricing`,
                customer_email: email,
                metadata: {
                    userId,
                    plan: 'pro',
                },
            });
        } else {
            // Individual Template Purchase
            session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: templateId.replace(/-/g, ' '),
                                images: [`${req.headers.get('origin')}/api/og?title=${templateId}`],
                            },
                            unit_amount: Math.round(price * 100),
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                success_url: `${req.headers.get('origin')}/dashboard?success=true&templateId=${templateId}`,
                cancel_url: `${req.headers.get('origin')}/templates/${templateId}`,
                customer_email: email,
                metadata: {
                    userId,
                    templateId,
                },
            });
        }

        return NextResponse.json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe Checkout Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
