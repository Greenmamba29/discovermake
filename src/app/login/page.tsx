"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Loader2, Zap, ArrowRight, ShieldCheck } from "lucide-react";
import { GlassPanel, RetroStrata, IronButton } from "@/components/ui/DesignSystem";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleDemoLogin = () => {
        router.push("/dashboard?demo=true");
    };

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        if (!auth) {
            setError("Authentication service is currently unavailable.");
            setIsLoading(false);
            return;
        }

        try {
            await signInWithEmailAndPassword(auth, email, password);
            router.push("/marketplace");
        } catch (err: any) {
            console.error("Login Error:", err);
            if (err.code === 'auth/unauthorized-domain') {
                setError("ERROR: This domain is not authorized in Firebase. Add it to the Console or use Demo Access below.");
            } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                setError("Invalid email or password.");
            } else {
                setError(err.message || "An unexpected error occurred.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError("");

        if (!auth) {
            setError("Authentication service is currently unavailable.");
            setIsLoading(false);
            return;
        }

        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            router.push("/marketplace");
        } catch (err: any) {
            console.error("Google Login Error:", err);
            if (err.code === 'auth/unauthorized-domain') {
                setError("ERROR: Domain unauthorized. Please add this domain to Firebase Console Authentication settings.");
            } else {
                setError("Could not sign in with Google.");
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
                        <Zap className="w-9 h-9 text-white fill-current" />
                    </div>
                    <div>
                        <h1 className="text-4xl font-black italic tracking-tighter uppercase text-white">Access Refinery</h1>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.3em] italic mt-2">DiscoverMake Secure Gateway</p>
                    </div>
                </div>

                <GlassPanel variant="glow" className="p-10 rounded-[2.5rem] border-white/10 space-y-8 bg-gradient-to-b from-white/[0.02] to-transparent">
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 text-xs font-bold text-red-100 bg-red-500/20 border border-red-500/40 rounded-2xl text-center italic leading-relaxed"
                        >
                            {error}
                        </motion.div>
                    )}

                    <div className="space-y-4">
                        <IronButton
                            variant="primary"
                            className="w-full h-14 text-[10px] uppercase italic tracking-widest font-black bg-white text-black hover:bg-gray-200"
                            onClick={handleGoogleLogin}
                            disabled={isLoading}
                        >
                            <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            Continue with Google
                        </IronButton>

                        <div className="relative py-4">
                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/5" /></div>
                            <div className="relative flex justify-center text-[9px] uppercase font-black italic tracking-widest"><span className="bg-[#0B1120] px-4 text-gray-600">Genetic Authentication</span></div>
                        </div>

                        <form onSubmit={handleEmailLogin} className="space-y-4">
                            <div className="space-y-4">
                                <input
                                    type="email"
                                    placeholder="Enter Protocol ID (Email)"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-6 text-sm font-bold text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 italic transition-all"
                                />
                                <input
                                    type="password"
                                    placeholder="Security Key (Password)"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
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
                                        Authorize Access
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="pt-4 space-y-4">
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/5 border-dashed" /></div>
                                <div className="relative flex justify-center text-[8px] uppercase font-black italic tracking-widest"><span className="bg-[#0B1120] px-4 text-gray-700">Sandbox Overlay</span></div>
                            </div>
                            <button
                                onClick={handleDemoLogin}
                                className="w-full h-12 rounded-2xl border border-blue-500/30 text-blue-400 font-black uppercase italic tracking-widest text-[10px] hover:bg-blue-500/10 transition-all active:scale-95"
                            >
                                Enter Demo Mode (Bypass Auth)
                            </button>
                        </div>
                    </div>

                    <div className="text-center pt-2">
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest italic leading-relaxed">
                            New to the refinery? <Link href="/register" className="text-blue-500 hover:underline">Register Biometrics</Link>
                        </p>
                    </div>
                </GlassPanel>

                <div className="mt-12 flex items-center justify-center gap-6 opacity-30">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-gray-400" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">AES-256 Meta</span>
                    </div>
                    <div className="w-px h-4 bg-white/10" />
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-gray-400" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Zero Trust Network</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
