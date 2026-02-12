"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Zap, ArrowRight, ShieldCheck, UserPlus } from "lucide-react";
import { GlassPanel, IronButton } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";

export default function RegisterPage() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        if (!auth) {
            setError("Authentication service is currently unavailable.");
            setIsLoading(false);
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
            router.push("/onboarding");
        } catch (err: any) {
            console.error("Registration Error:", err);
            if (err.code === 'auth/email-already-in-use') {
                setError("This email is already registered.");
            } else if (err.code === 'auth/weak-password') {
                setError("Password is too weak (min 6 chars).");
            } else {
                setError(err.message || "An unexpected error occurred.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B1120] p-6 relative overflow-hidden font-sans">
            {/* Background */}
            <div className="fixed inset-0 opacity-10 pointer-events-none origin-center scale-125">
                <HeroMotionBackground />
            </div>

            <div className="w-full max-w-[440px] relative z-10">
                <div className="text-center mb-10 space-y-4">
                    <div className="size-16 rounded-[1.5rem] bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 mx-auto group hover:scale-110 transition-transform">
                        <UserPlus className="w-9 h-9 text-white" />
                    </div>
                    <div>
                        <h1 className="text-4xl font-black italic tracking-tighter uppercase text-white">Initialize Node</h1>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.3em] italic mt-2">New Protocol Registration</p>
                    </div>
                </div>

                <GlassPanel variant="glow" className="p-10 rounded-[2.5rem] border-white/10 space-y-8 bg-gradient-to-b from-white/[0.02] to-transparent">
                    {error && (
                        <div className="p-4 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl text-center italic">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleRegister} className="space-y-4">
                        <div className="space-y-4">
                            <input
                                type="text"
                                placeholder="Biological Name (Full Name)"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all"
                            />
                            <input
                                type="email"
                                placeholder="Protocol ID (Email)"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all"
                            />
                            <input
                                type="password"
                                placeholder="Security Key (Min 6 Characters)"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all"
                            />
                        </div>
                        <button
                            type="submit"
                            className="w-full h-14 rounded-2xl bg-blue-600 text-white font-black uppercase italic tracking-widest text-[11px] shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50"
                            disabled={isLoading}
                        >
                            {isLoading ? <Loader2 className="animate-spin w-5 h-5 text-white" /> : (
                                <>
                                    Establish Link
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="text-center">
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic leading-relaxed">
                            Already linked? <Link href="/login" className="text-blue-500 hover:underline">Access Gateway</Link>
                        </p>
                    </div>
                </GlassPanel>

                <div className="mt-12 flex items-center justify-center gap-6 opacity-30">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-gray-400" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Secure Protocol</span>
                    </div>
                    <div className="w-px h-4 bg-white/10" />
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-gray-400" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Instant Deploy</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
