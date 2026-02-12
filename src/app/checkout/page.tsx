"use client"

import { Suspense } from "react"

import { useSearchParams, useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { MOCK_TEMPLATES } from "@/lib/mock-data"
import { Shield, Lock, Loader2 } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { loadStripe } from "@stripe/stripe-js"
import { Elements } from "@stripe/react-stripe-js"
import { CheckoutForm } from "@/components/checkout-form"
import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"

// Initialize Stripe outside render to avoid recreation
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    : null;

function CheckoutContent() {
    const searchParams = useSearchParams()
    const itemId = searchParams.get("price") // We passed price, or templateId. Let's handle generic price for MVP
    const price = Number(itemId) || 50; // Default fallback

    const { user, loading } = useAuth();
    const router = useRouter();
    const [clientSecret, setClientSecret] = useState("");

    // Auth Guard
    useEffect(() => {
        if (!loading && !user) {
            router.push("/login?redirect=/checkout");
        }
    }, [user, loading, router]);


    // Fetch PaymentIntent 
    // In a real app, we call /api/create-payment-intent with the price/tokens
    useEffect(() => {
        if (user) {
            // Mocking the PaymentIntent fetch for scaffolding purposes
            // This will fail to render the Element without a real secret,
            // BUT we can render the "Missing Key" state if stripePromise is null.

            // To test UI without backend, we can't fully render Elements without a secret.
            // I will create a dummy fetch that would fail if we ran it, but shows code structure.
            /*
            fetch("/api/create-payment-intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: [{ id: "template-1" }] }),
            })
                .then((res) => res.json())
                .then((data) => setClientSecret(data.clientSecret));
            */
            // Setting a fake one to trigger the "render" attempt if desired, or leave null to show "Loading" state?
            // For Scaffold: Show the form container.
        }
    }, [user]);

    // Template Data Mock (Visuals)
    const template = {
        name: "Premium Automation Template",
        coverImage: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=1974&auto=format&fit=crop",
        price: price
    };

    if (loading || !user) return <div className="min-h-screen flex items-center justify-center">Loading user...</div>;

    const appearance = {
        theme: 'stripe' as const,
    };
    const options = {
        clientSecret,
        appearance,
    };

    return (
        <div className="flex min-h-screen flex-col bg-slate-50">
            <Navbar />

            <main className="flex-1 py-12">
                <div className="container px-4 md:px-6 max-w-4xl mx-auto">
                    <h1 className="text-3xl font-bold mb-8">Checkout</h1>

                    <div className="grid md:grid-cols-2 gap-8">
                        {/* Payment Column */}
                        <div className="space-y-6">
                            {!stripePromise ? (
                                <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800">
                                    <h3 className="font-bold mb-2">Stripe Configuration Missing</h3>
                                    <p>Please add <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to your .env.local file to enable payments.</p>
                                </div>
                            ) : (
                                <div className="bg-white p-6 rounded-xl border shadow-sm">
                                    {clientSecret ? (
                                        <Elements options={options} stripe={stripePromise}>
                                            <CheckoutForm price={price} />
                                        </Elements>
                                    ) : (
                                        <div className="text-center py-12 text-slate-500">
                                            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                                            <p>Initializing secure payment...</p>
                                            <p className="text-xs mt-2 text-slate-400">(Backend PaymentIntent API needed to render form)</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Order Summary Column */}
                        <div>
                            <div className="bg-white p-6 rounded-xl border shadow-sm sticky top-24">
                                <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
                                <div className="flex items-center gap-4 mb-4 pb-4 border-b">
                                    <div className="h-16 w-16 bg-slate-200 rounded-md overflow-hidden relative">
                                        <Image
                                            src={template.coverImage}
                                            fill
                                            className="object-cover"
                                            alt="Template"
                                        />
                                    </div>
                                    <div>
                                        <h3 className="font-medium">{template.name}</h3>
                                        <p className="text-sm text-muted-foreground">Single License</p>
                                    </div>
                                </div>

                                <div className="space-y-2 mb-6 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Subtotal</span>
                                        <span>${price.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between font-bold text-lg pt-2 border-t">
                                        <span>Total</span>
                                        <span>${price.toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <Shield className="w-3 h-3" />
                                    Secure 256-bit SSL Encrypted Payment
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    )
}

export default function CheckoutPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading checkout...</div>}>
            <CheckoutContent />
        </Suspense>
    );
}
