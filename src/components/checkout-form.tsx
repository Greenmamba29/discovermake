"use client";

import { useEffect, useState } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function CheckoutForm({ price }: { price: number }) {
    const stripe = useStripe();
    const elements = useElements();
    const [message, setMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!stripe || !elements) {
            return;
        }

        setIsLoading(true);

        const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: `${window.location.origin}/success`,
            },
        });

        if (error.type === "card_error" || error.type === "validation_error") {
            setMessage(error.message || "An unexpected error occurred.");
        } else {
            setMessage("An unexpected error occurred.");
        }

        setIsLoading(false);
    };

    return (
        <form id="payment-form" onSubmit={handleSubmit} className="space-y-6">
            <PaymentElement id="payment-element" options={{ layout: "tabs" }} />

            {message && <div id="payment-message" className="text-red-500 text-sm">{message}</div>}

            <Button disabled={isLoading || !stripe || !elements} id="submit" className="w-full h-12 text-lg font-bold bg-indigo-600 hover:bg-indigo-700">
                {isLoading ? <Loader2 className="animate-spin" /> : `Pay $${price}`}
            </Button>
        </form>
    );
}
