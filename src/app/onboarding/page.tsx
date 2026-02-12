"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/components/auth-provider";
import { updateUserProfile } from "@/lib/firestore";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Search,
    Wrench,
    Palette,
    Check,
    ArrowRight,
    ArrowLeft,
    Sparkles,
    Shield,
    ShieldCheck,
    Upload,
    Camera,
    DollarSign,
    Loader2,
    Zap,
    Code2,
    Paintbrush,
    Globe,
    Smartphone,
    Brain,
    Database,
    Layout,
    ChevronRight,
    Lock,
    Eye,
    EyeOff,
    CheckCircle2,
    AlertCircle,
    Activity,
    Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ─── Constants ─── */
const BUDGET_RANGES = [
    { id: "starter", label: "$500 – $2,000", desc: "Small MVP or single feature", icon: "💡" },
    { id: "growth", label: "$2,000 – $10,000", desc: "Full product build or multi-feature", icon: "🚀" },
    { id: "scale", label: "$10,000 – $50,000", desc: "Enterprise-grade, multi-team", icon: "🏢" },
    { id: "enterprise", label: "$50,000+", desc: "Custom enterprise solution", icon: "🌐" },
];

const PROJECT_TYPES = [
    { id: "web-app", label: "Web Application", icon: Globe },
    { id: "mobile-app", label: "Mobile App", icon: Smartphone },
    { id: "ai-ml", label: "AI / Machine Learning", icon: Brain },
    { id: "api-backend", label: "API / Backend", icon: Database },
    { id: "ui-design", label: "UI/UX Design", icon: Layout },
    { id: "automation", label: "Automation", icon: Zap },
];

const PERSONAS = [
    {
        id: "seeker" as const,
        title: "THE ARCHITECT",
        subtitle: "I seek protocol genesis",
        desc: "Define your vision. Blueprint your logic. Watch as our Forge network brings your infrastructure to life.",
        icon: Brain,
        gradient: "from-blue-600/20 to-cyan-500/20",
        glow: "shadow-blue-500/10",
        action: "Enter Architect Hub"
    },
    {
        id: "maker" as const,
        title: "THE FORGE MASTER",
        subtitle: "I execute sovereign logic",
        desc: "Accept protocol pings, deliver optimized code, and build your reputation within the sovereign network.",
        icon: Zap,
        gradient: "from-amber-500/20 to-orange-500/20",
        glow: "shadow-amber-500/10",
        action: "Enter Maker Foundry"
    },
    {
        id: "apex" as const, // Added Apex persona
        title: "APEX OVERSEER",
        subtitle: "I govern the network",
        desc: "Monitor global traffic, moderate protocol disputes, and oversee the evolution of the DiscoverMake fleet.",
        icon: ShieldCheck,
        gradient: "from-purple-600/20 to-blue-600/20",
        glow: "shadow-purple-500/10",
        action: "Enter Apex Command"
    },
];

/* ─── Step Indicator ─── */
function StepIndicator({ currentStep, persona }: { currentStep: number; persona: string | null }) {
    const defaultSteps = [
        { label: "Welcome", icon: Sparkles },
        { label: "Role", icon: Search },
        { label: "Trust", icon: Shield },
        { label: persona === "seeker" ? "Budget" : "Skills", icon: persona === "seeker" ? DollarSign : Code2 },
        { label: "Enter", icon: Zap },
    ];

    const steps = defaultSteps;
    const totalSteps = steps.length;

    return (
        <div className="fixed top-0 left-0 w-full z-50">
            <div className="h-1 bg-white/5">
                <motion.div
                    className="h-full bg-gradient-to-r from-blue-600 via-violet-500 to-cyan-400"
                    initial={{ width: "0%" }}
                    animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                />
            </div>
            <div className="flex justify-center gap-8 py-4 px-6">
                {steps.map((step, i) => {
                    const StepIcon = step.icon;
                    const isActive = i + 1 === currentStep;
                    const isComplete = i + 1 < currentStep;
                    return (
                        <div key={step.label + i} className="flex items-center gap-2">
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
                                isComplete ? "bg-green-500/20 text-green-400" :
                                    isActive ? "bg-blue-600/30 text-blue-400 ring-2 ring-blue-500/50" :
                                        "bg-white/5 text-white/30"
                            )}>
                                {isComplete ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                            </div>
                            <span className={cn(
                                "text-xs font-black uppercase tracking-widest hidden sm:block transition-colors italic",
                                isActive ? "text-white" : isComplete ? "text-green-400" : "text-white/30"
                            )}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ─── Main Page ─── */
export default function OnboardingPage() {
    const { user, userData, loading } = useAuth();
    const [step, setStep] = useState(1);
    const [persona, setPersona] = useState<"seeker" | "maker" | "apex" | null>(null);
    const [experience, setExperience] = useState<string | null>(null);
    const [timeline, setTimeline] = useState<string | null>(null);
    const [selectedProjectTypes, setSelectedProjectTypes] = useState<string[]>([]);
    const [budgetRange, setBudgetRange] = useState<string | null>(null);
    const [idUploaded, setIdUploaded] = useState(false);
    const [selfieUploaded, setSelfieUploaded] = useState(false);
    const [verificationStep, setVerificationStep] = useState<"intro" | "id" | "selfie" | "done">("intro");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const getSteps = () => {
        const welcome = { label: "Welcome", icon: Sparkles };
        const role = { label: "Role", icon: Search };
        const trust = { label: "Trust", icon: Shield };
        const enter = { label: "Enter", icon: Zap };

        if (persona === "seeker") {
            return [welcome, role, trust, { label: "Budget", icon: DollarSign }, { label: "Timeline", icon: Clock }, enter];
        }
        if (persona === "maker") {
            return [welcome, role, trust, { label: "Skills", icon: Code2 }, { label: "Mastery", icon: Wrench }, enter];
        }
        return [welcome, role, trust, { label: "Context", icon: Layout }, enter];
    };

    const steps = getSteps();
    const totalSteps = steps.length;

    useEffect(() => {
        if (!loading && !user) {
            router.push("/login");
        }
    }, [user, loading, router]);

    const nextStep = () => setStep(s => Math.min(s + 1, totalSteps));
    const prevStep = () => setStep(s => Math.max(s - 1, 1));

    const toggleProjectType = (id: string) => {
        setSelectedProjectTypes(prev =>
            prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
        );
    };

    const handleComplete = async () => {
        if (!user) return;
        setIsSubmitting(true);

        const onboardingData: any = {
            projectTypes: selectedProjectTypes || [],
            persona: persona || "seeker",
        };
        if (budgetRange) onboardingData.budgetRange = budgetRange;
        if (experience) onboardingData.experience = experience;
        if (timeline) onboardingData.timeline = timeline;

        // Determine target route based on persona
        const target = persona === "seeker" ? "/dashboard/client" :
            persona === "maker" ? "/dashboard/maker" :
                persona === "apex" ? "/admin/apex" : "/dashboard";

        // Safety net: redirect via hard navigation after 3s no matter what
        const redirectTimer = setTimeout(() => {
            console.warn("Redirect timeout – forcing navigation to", target);
            window.location.href = target;
        }, 3000);

        try {
            await updateUserProfile(user.uid, {
                onboardingCompleted: true,
                verificationStatus: (idUploaded && selfieUploaded) ? "pending" : "unverified",
                onboardingData,
                subscription_tier: "free",
                role: persona === "apex" ? "admin" : persona === "maker" ? "agency" : "user"
            });

            toast.success("Sovereign Registry Initialized", {
                description: "Welcome to the DiscoverMake network.",
            });
        } catch (error) {
            console.error("Error saving onboarding:", error);
            toast.error("Registry sync queued", {
                description: "Your profile will sync when connection is restored.",
            });
        }

        // Clear the safety timer and redirect immediately
        clearTimeout(redirectTimer);
        router.push(target);
    };

    // Simulate file upload
    const simulateUpload = (type: "id" | "selfie") => {
        if (type === "id") {
            setIdUploaded(true);
            setTimeout(() => setVerificationStep("selfie"), 500);
        } else {
            setSelfieUploaded(true);
            setTimeout(() => setVerificationStep("done"), 500);
        }
    };

    const stepVariants = {
        enter: { x: 60, opacity: 0 },
        center: { x: 0, opacity: 1, transition: { duration: 0.4, ease: "easeOut" } },
        exit: { x: -60, opacity: 0, transition: { duration: 0.2 } },
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0B1120] text-white flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                    <p className="text-white/50 text-sm font-medium">Loading your experience...</p>
                </div>
            </div>
        );
    }

    if (!user) return null;

    return (
        <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center p-6 sm:p-12 overflow-hidden relative">
            {/* Background aura effects */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

            <StepIndicator currentStep={step} persona={persona} />

            <AnimatePresence mode="wait">
                {/* ─── STEP 1: Welcome ─── */}
                {step === 1 && (
                    <motion.div
                        key="step1"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-2xl w-full space-y-8 text-center mt-16"
                    >
                        <motion.div
                            animate={{ scale: [1, 1.05, 1] }}
                            transition={{ repeat: Infinity, duration: 4 }}
                            className="inline-block p-5 bg-gradient-to-br from-blue-600/20 to-violet-600/20 rounded-3xl border border-white/10"
                        >
                            <Sparkles className="w-14 h-14 text-blue-400" />
                        </motion.div>
                        <h1 className="text-4xl sm:text-6xl font-black tracking-tighter leading-none">
                            Welcome to{" "}
                            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-violet-400 to-cyan-400">
                                DiscoverMake
                            </span>
                        </h1>
                        <p className="text-lg text-white/50 font-light max-w-lg mx-auto leading-relaxed">
                            The marketplace where ideas become software. Describe what you want built, get matched with
                            verified talent in seconds — not weeks.
                        </p>
                        <div className="flex flex-col items-center gap-3">
                            <Button
                                onClick={nextStep}
                                className="h-14 px-10 text-lg font-bold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white rounded-2xl group shadow-lg shadow-blue-500/25 transition-all"
                            >
                                Get Started
                                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Button>
                            <p className="text-white/30 text-xs font-medium">Takes less than 2 minutes</p>
                        </div>
                    </motion.div>
                )}

                {/* ─── STEP 2: Persona Selection ─── */}
                {step === 2 && (
                    <motion.div
                        key="step2"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-5xl w-full space-y-10 mt-16"
                    >
                        <div className="text-center">
                            <h2 className="text-3xl sm:text-5xl font-black mb-3 tracking-tight">How will you use DiscoverMake?</h2>
                            <p className="text-white/40 font-medium">Pick your primary role. You can always switch later.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {PERSONAS.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => { setPersona(p.id); nextStep(); }}
                                    className={cn(
                                        "relative p-8 rounded-[2.5rem] border text-left transition-all duration-500 group hover:scale-[1.02] overflow-hidden backdrop-blur-xl",
                                        persona === p.id
                                            ? "bg-blue-600/20 border-blue-400/30 shadow-[0_0_40px_rgba(59,130,246,0.1)]"
                                            : "bg-white/5 border-white/10 hover:border-white/20"
                                    )}
                                >
                                    {/* Aura Glow */}
                                    <div className={cn(
                                        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-3xl",
                                        `bg-gradient-to-br ${p.gradient}`
                                    )} />

                                    <div className="relative z-10 flex flex-col h-full">
                                        <div className={cn(
                                            "size-14 rounded-2xl flex items-center justify-center mb-6 transition-all duration-500 border border-white/10",
                                            persona === p.id ? "bg-blue-500/20 shadow-lg shadow-blue-500/20" : "bg-white/5 group-hover:bg-blue-500/10 group-hover:scale-110"
                                        )}>
                                            <p.icon className={cn("size-6 transition-colors", persona === p.id ? "text-blue-400" : "text-gray-500 group-hover:text-blue-400")} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-gray-500 tracking-[0.2em] mb-1 italic uppercase">{p.subtitle}</p>
                                            <h3 className="text-2xl font-black mb-3 tracking-tighter text-white italic uppercase">{p.title}</h3>
                                            <p className="text-sm text-gray-400 leading-relaxed italic">{p.desc}</p>
                                        </div>
                                        <div className="mt-auto pt-8 flex items-center gap-2 text-[10px] font-black text-blue-500 tracking-widest uppercase italic group-hover:translate-x-1 transition-transform">
                                            {p.action} <ChevronRight className="size-3" />
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                        <div className="flex justify-center">
                            <button onClick={prevStep} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-medium">
                                <ArrowLeft className="w-4 h-4" /> Go Back
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* ─── STEP 3: Identity Verification ─── */}
                {step === 3 && (
                    <motion.div
                        key="step3"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-2xl w-full space-y-8 mt-16"
                    >
                        <div className="text-center">
                            <div className="inline-block p-4 bg-green-500/10 rounded-2xl border border-green-500/20 mb-4">
                                <ShieldCheck className="w-10 h-10 text-green-400" />
                            </div>
                            <h2 className="text-3xl sm:text-5xl font-black mb-3 tracking-tight">Verify Your Identity</h2>
                            <p className="text-white/40 font-medium max-w-md mx-auto">
                                {persona === "seeker"
                                    ? "Verified Discoverers get matched with our top-tier Makers. Your identity stays private."
                                    : "Verified Makers unlock premium gigs and higher visibility on the marketplace."}
                            </p>
                        </div>

                        <div className="glass-card rounded-3xl p-8 space-y-6">
                            {/* Why verify */}
                            <div className="flex items-start gap-4 p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                                <Lock className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-bold text-white/90">Why we verify</p>
                                    <p className="text-xs text-white/50 mt-1">
                                        DiscoverMake sources only the best verifiable talent to match with high-caliber clients.
                                        Verification protects everyone on the platform.
                                    </p>
                                </div>
                            </div>

                            {/* ID Upload */}
                            <div className={cn(
                                "p-6 rounded-2xl border transition-all duration-300",
                                idUploaded
                                    ? "bg-green-500/10 border-green-500/30"
                                    : verificationStep === "id" || verificationStep === "intro"
                                        ? "bg-white/5 border-white/10 hover:border-white/20"
                                        : "bg-white/2 border-white/5 opacity-50"
                            )}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "p-3 rounded-xl",
                                            idUploaded ? "bg-green-500/20" : "bg-white/5"
                                        )}>
                                            {idUploaded ? <CheckCircle2 className="w-6 h-6 text-green-400" /> : <Upload className="w-6 h-6 text-white/60" />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-white/90">Government-Issued ID</p>
                                            <p className="text-xs text-white/40 mt-0.5">Passport, driver&apos;s license, or national ID</p>
                                        </div>
                                    </div>
                                    {!idUploaded && (
                                        <Button
                                            onClick={() => { setVerificationStep("id"); simulateUpload("id"); }}
                                            className="bg-white/10 hover:bg-white/20 text-white text-sm rounded-xl px-4"
                                            size="sm"
                                        >
                                            Upload
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Selfie Upload */}
                            <div className={cn(
                                "p-6 rounded-2xl border transition-all duration-300",
                                selfieUploaded
                                    ? "bg-green-500/10 border-green-500/30"
                                    : verificationStep === "selfie"
                                        ? "bg-white/5 border-white/10 hover:border-white/20"
                                        : "bg-white/2 border-white/5 opacity-50"
                            )}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "p-3 rounded-xl",
                                            selfieUploaded ? "bg-green-500/20" : "bg-white/5"
                                        )}>
                                            {selfieUploaded ? <CheckCircle2 className="w-6 h-6 text-green-400" /> : <Camera className="w-6 h-6 text-white/60" />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-white/90">Selfie Verification</p>
                                            <p className="text-xs text-white/40 mt-0.5">Quick photo to match your ID</p>
                                        </div>
                                    </div>
                                    {!selfieUploaded && verificationStep === "selfie" && (
                                        <Button
                                            onClick={() => simulateUpload("selfie")}
                                            className="bg-white/10 hover:bg-white/20 text-white text-sm rounded-xl px-4"
                                            size="sm"
                                        >
                                            Take Photo
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Verification Status */}
                            {verificationStep === "done" && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-4 bg-green-500/10 rounded-2xl border border-green-500/20 text-center"
                                >
                                    <p className="text-green-400 font-bold text-sm">✅ Documents uploaded — verification in progress</p>
                                    <p className="text-white/40 text-xs mt-1">Usually takes under 5 minutes</p>
                                </motion.div>
                            )}
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={prevStep} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-medium">
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={nextStep}
                                    className="text-white/30 hover:text-white/60 transition-colors text-sm"
                                >
                                    Skip for now
                                </button>
                                <Button
                                    onClick={nextStep}
                                    disabled={!idUploaded || !selfieUploaded}
                                    className={cn(
                                        "px-6 rounded-2xl font-bold transition-all",
                                        idUploaded && selfieUploaded
                                            ? "bg-green-600 hover:bg-green-500 text-white"
                                            : "bg-white/10 text-white/30"
                                    )}
                                >
                                    Continue <ArrowRight className="ml-2 w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ─── STEP 4: Budget + Project Types ─── */}
                {step === 4 && (
                    <motion.div
                        key="step4"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-3xl w-full space-y-8 mt-16"
                    >
                        <div className="text-center">
                            <h2 className="text-3xl sm:text-5xl font-black mb-3 tracking-tight italic uppercase">
                                {persona === "seeker" ? "Project Genesis" : "Skill Mastery"}
                            </h2>
                            <p className="text-white/40 font-medium italic tracking-wide">
                                {persona === "seeker"
                                    ? "Define your resource allocation and mission scope."
                                    : "Configure your technical stack for node matching."}
                            </p>
                        </div>

                        {/* Budget selection (Seekers) */}
                        {persona === "seeker" && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {BUDGET_RANGES.map((range) => (
                                    <button
                                        key={range.id}
                                        onClick={() => setBudgetRange(range.id)}
                                        className={cn(
                                            "p-6 rounded-2xl border text-left transition-all duration-200 group",
                                            budgetRange === range.id
                                                ? "bg-gradient-to-br from-blue-600/20 to-violet-600/20 border-blue-500/40 shadow-lg shadow-blue-500/10"
                                                : "glass-card hover:border-white/20"
                                        )}
                                    >
                                        <span className="text-2xl">{range.icon}</span>
                                        <p className="text-lg font-black mt-3">{range.label}</p>
                                        <p className="text-sm text-white/40 mt-1">{range.desc}</p>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Project types (all personas) */}
                        <div>
                            <p className="text-[10px] font-black italic uppercase text-blue-500 tracking-widest mb-4">
                                {persona === "seeker" ? "INFRASTRUCTURE TYPE" : "TECHNICAL SPECIALIZATION"}
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {PROJECT_TYPES.map((type) => (
                                    <button
                                        key={type.id}
                                        onClick={() => toggleProjectType(type.id)}
                                        className={cn(
                                            "p-4 rounded-2xl flex items-center gap-3 border transition-all duration-200",
                                            selectedProjectTypes.includes(type.id)
                                                ? "bg-white text-black border-white font-bold"
                                                : "bg-white/5 border-white/10 hover:border-white/20"
                                        )}
                                    >
                                        <type.icon className="w-5 h-5 flex-shrink-0" />
                                        <span className="text-sm font-semibold">{type.label}</span>
                                        {selectedProjectTypes.includes(type.id) && <Check className="ml-auto w-4 h-4" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={prevStep} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-medium">
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                            <Button
                                onClick={nextStep}
                                disabled={persona === "seeker" ? !budgetRange : selectedProjectTypes.length === 0}
                                className="px-8 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 rounded-2xl font-bold"
                            >
                                Continue <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </div>
                    </motion.div>
                )}

                {/* ─── STEP 5: Persona Specific Expansion ─── */}
                {step === 5 && (
                    <motion.div
                        key="step5-expansion"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-3xl w-full space-y-8 mt-16"
                    >
                        <div className="text-center">
                            <h2 className="text-3xl sm:text-5xl font-black mb-3 tracking-tight italic uppercase">
                                {persona === "seeker" ? "Mission Timeline" : "Proof of Forge"}
                            </h2>
                            <p className="text-white/40 font-medium italic tracking-wide">
                                {persona === "seeker"
                                    ? "When do you require protocol initialization?"
                                    : "Define your level of mastery within the network."}
                            </p>
                        </div>

                        {persona === "seeker" ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {[
                                    { id: 'urgent', label: 'Urgent', desc: 'ASAP Initialization', icon: '⚡' },
                                    { id: 'standard', label: 'Standard', desc: '2-4 Week Genesis', icon: '📅' },
                                    { id: 'planning', label: 'Planning', desc: 'Future Roadmapping', icon: '📝' },
                                    { id: 'flexible', label: 'Flexible', desc: 'Non-critical Timing', icon: '🌊' }
                                ].map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setTimeline(t.id)}
                                        className={cn(
                                            "p-6 rounded-2xl border text-left transition-all duration-200 group",
                                            timeline === t.id
                                                ? "bg-gradient-to-br from-blue-600/20 to-violet-600/20 border-blue-500/40 shadow-lg shadow-blue-500/10"
                                                : "glass-card hover:border-white/20"
                                        )}
                                    >
                                        <span className="text-2xl">{t.icon}</span>
                                        <p className="text-lg font-black mt-3">{t.label}</p>
                                        <p className="text-sm text-white/40 mt-1">{t.desc}</p>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {[
                                    { id: 'expert', label: 'Elite Forge Master', desc: '5+ years sovereign execution', icon: '🏆' },
                                    { id: 'pro', label: 'Pro Mechanic', desc: '2-5 years node stabilization', icon: '🛠️' },
                                    { id: 'rising', label: 'Rising Spark', desc: '0-2 years genesis experience', icon: '✨' },
                                    { id: 'apprentice', label: 'Apprentice', desc: 'Network Entry Level', icon: '🌱' }
                                ].map((e) => (
                                    <button
                                        key={e.id}
                                        onClick={() => setExperience(e.id)}
                                        className={cn(
                                            "p-6 rounded-2xl border text-left transition-all duration-200 group",
                                            experience === e.id
                                                ? "bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-amber-500/40 shadow-lg shadow-amber-500/10"
                                                : "glass-card hover:border-white/20"
                                        )}
                                    >
                                        <span className="text-2xl">{e.icon}</span>
                                        <p className="text-lg font-black mt-3">{e.label}</p>
                                        <p className="text-sm text-white/40 mt-1">{e.desc}</p>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-between items-center">
                            <button onClick={prevStep} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-medium">
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                            <Button
                                onClick={nextStep}
                                disabled={persona === "seeker" ? !timeline : !experience}
                                className="px-8 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 rounded-2xl font-bold"
                            >
                                Finalize <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </div>
                    </motion.div>
                )}

                {/* ─── STEP 6: Complete ─── */}
                {step === 6 && (
                    <motion.div
                        key="step5"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="max-w-2xl w-full space-y-8 mt-16"
                    >
                        <div className="text-center space-y-4">
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", duration: 0.6 }}
                                className="inline-block p-5 bg-green-500/20 rounded-3xl border border-green-500/30"
                            >
                                <CheckCircle2 className="w-14 h-14 text-green-400" />
                            </motion.div>
                            <h2 className="text-3xl sm:text-6xl font-black tracking-tighter italic uppercase">
                                System Armed
                            </h2>
                            <p className="text-lg text-white/50 max-w-lg mx-auto leading-relaxed italic">
                                {persona === "seeker"
                                    ? "Your Architect profile is synchronized. The Forge awaits your blueprints."
                                    : persona === "maker"
                                        ? "Your Forge Master profile is live. Sovereign gigs are entering your sector."
                                        : "Apex Overseer access granted. The network is under your command."}
                            </p>
                        </div>

                        {/* Summary Card */}
                        <div className="glass-card rounded-3xl p-8 space-y-6">
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "p-3 rounded-2xl bg-gradient-to-br",
                                    persona === "seeker" ? "from-blue-600/30 to-cyan-600/30" :
                                        persona === "maker" ? "from-violet-600/30 to-purple-600/30" :
                                            "from-amber-600/30 to-orange-600/30"
                                )}>
                                    {persona === "seeker" ? <Search className="w-6 h-6" /> :
                                        persona === "maker" ? <Wrench className="w-6 h-6" /> :
                                            <Palette className="w-6 h-6" />}
                                </div>
                                <div>
                                    <p className="font-black text-lg italic uppercase">
                                        {persona === "seeker" ? "ARCHITECT" : persona === "maker" ? "FORGE MASTER" : "APEX OVERSEER"}
                                    </p>
                                    <p className="text-[10px] font-black uppercase text-white/40 tracking-widest">{user.displayName || user.email}</p>
                                </div>
                                <div className="ml-auto">
                                    {(idUploaded && selfieUploaded) ? (
                                        <span className="flex items-center gap-1.5 text-xs font-bold text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
                                            <ShieldCheck className="w-3.5 h-3.5" /> Verification Pending
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full">
                                            <AlertCircle className="w-3.5 h-3.5" /> Unverified
                                        </span>
                                    )}
                                </div>
                            </div>

                            {budgetRange && (
                                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                                    <DollarSign className="w-4 h-4 text-white/40" />
                                    <span className="text-sm font-semibold">Budget: {BUDGET_RANGES.find(b => b.id === budgetRange)?.label}</span>
                                </div>
                            )}

                            {selectedProjectTypes.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {selectedProjectTypes.map(t => (
                                        <span key={t} className="text-xs font-bold bg-white/10 px-3 py-1.5 rounded-full text-white/70">
                                            {PROJECT_TYPES.find(pt => pt.id === t)?.label}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <Button
                            onClick={handleComplete}
                            disabled={isSubmitting}
                            className="w-full h-16 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-xl font-black rounded-2xl shadow-lg shadow-blue-500/25"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                    Launching...
                                </>
                            ) : (
                                <>
                                    Enter DiscoverMake <ArrowRight className="ml-2 w-5 h-5" />
                                </>
                            )}
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
