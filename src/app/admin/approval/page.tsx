"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Search,
    Bell,
    ArrowLeft,
    CheckCircle,
    XCircle,
    User,
    ShieldCheck,
    MessageSquare,
    Zap,
    Filter,
    ArrowLeftCircle,
    Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel, IronButton, RetroStrata, DesignSystem } from "@/components/ui/DesignSystem";
import Link from "next/link";
import Image from "next/image";
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner"; // Assuming sonner is available, or use alert

/**
 * Hi-Fi Admin Approval Dashboard
 * Connects to Firestore 'projects' collection
 */

interface ApprovalItem {
    id: string;
    title: string;
    description: string;
    creator?: {
        username: string;
        isVerified: boolean;
        trustScore: number;
        avatarUrl?: string;
        uid?: string;
    };
    submittedAt?: any;
    priority?: "standard" | "enterprise";
    thumbnailUrl?: string;
    status: string;
    [key: string]: any;
}

export default function ApprovalQueuePage() {
    const [activeTab, setActiveTab] = useState<"needs-review" | "flagged" | "dispute" | "history">("needs-review");
    const [queue, setQueue] = useState<ApprovalItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState<Record<string, string>>({});
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        // Real-time listener for projects
        const q = query(collection(db, "projects"), where("status", "in", ["pending_approval", "flagged", "dispute"]));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ApprovalItem));
            setQueue(items);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching approval queue:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleAction = async (id: string, action: "approve" | "reject") => {
        setProcessingId(id);
        try {
            const projectRef = doc(db, "projects", id);
            const newStatus = action === "approve" ? "published" : "rejected";

            await updateDoc(projectRef, {
                status: newStatus,
                adminFeedback: feedback[id] || "",
                reviewedAt: serverTimestamp(),
            });

            toast.success(`Project ${action === "approve" ? "Published" : "Rejected"} Successfully`);
        } catch (error) {
            console.error(`Error ${action}ing project:`, error);
            toast.error(`Failed to ${action} project`);
        } finally {
            setProcessingId(null);
        }
    };

    // Filter queue based on tabs
    const filteredQueue = queue.filter(item => {
        if (activeTab === "needs-review") return item.status === "pending_approval";
        if (activeTab === "flagged") return item.status === "flagged";
        if (activeTab === "dispute") return item.status === "dispute";
        return false;
    });

    return (
        <div className="min-h-screen bg-[#0B1120] text-[#e8e8f0] font-sans selection:bg-blue-500/30">
            {/* Background Auras */}
            <div className="fixed top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[120px] pointer-events-none" />

            {/* Sticky Header */}
            <header className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/apex">
                            <button className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-white">
                                <ArrowLeftCircle className="w-5 h-5" />
                            </button>
                        </Link>
                        <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                            Approval Queue
                        </h1>
                    </div>
                    {/* ... search/bell ... */}
                </div>

                {/* Tabs */}
                <div className="max-w-4xl mx-auto px-4 flex gap-8">
                    {[
                        { id: "needs-review", label: "Needs Review", count: queue.filter(i => i.status === "pending_approval").length },
                        { id: "flagged", label: "Flagged", count: queue.filter(i => i.status === "flagged").length },
                        { id: "dispute", label: "Dispute Matrix", count: queue.filter(i => i.status === "dispute").length }, // Added Dispute tab
                        { id: "history", label: "Approved History" },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "pb-3 text-sm font-bold uppercase tracking-wider transition-all relative",
                                activeTab === tab.id
                                    ? "text-blue-400"
                                    : "text-gray-500 hover:text-gray-300"
                            )}
                        >
                            {tab.label} {tab.count !== undefined && `(${tab.count})`}
                            {activeTab === tab.id && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                                />
                            )}
                        </button>
                    ))}
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-8 space-y-6 pb-24">
                {loading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : (
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-6"
                        >
                            {filteredQueue.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">
                                    <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                    <p>No items in this queue.</p>
                                </div>
                            ) : (
                                filteredQueue.map((item) => (
                                    <GlassPanel key={item.id} variant="elevated" className="overflow-hidden p-0 border-white/5 group">
                                        {/* Banner Image */}
                                        <div className="relative h-40 bg-gray-900 border-b border-white/5">
                                            <Image
                                                src={item.thumbnailUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800"}
                                                alt={item.title}
                                                fill
                                                className="object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a2e] to-transparent" />

                                            <div className="absolute top-4 right-4">
                                                {item.priority === "enterprise" && (
                                                    <RetroStrata label="Enterprise Priority" variant="premium" pulse />
                                                )}
                                            </div>

                                            <div className="absolute bottom-4 left-6 right-6">
                                                <h2 className="text-2xl font-black tracking-tight text-white drop-shadow-md">
                                                    {item.title}
                                                </h2>
                                            </div>
                                        </div>

                                        <div className="p-6 space-y-6">
                                            {/* Creator Metadata */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 border border-white/10 flex items-center justify-center">
                                                        <User className="w-6 h-6 text-gray-400" />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-white">{item.creator?.username || "Unknown"}</span>
                                                            {item.creator?.isVerified && (
                                                                <CheckCircle className="w-4 h-4 text-blue-400" />
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-gray-500">Submitted {item.submittedAt?.toDate ? item.submittedAt.toDate().toLocaleDateString() : "Recently"}</span>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 italic">Trust Score</p>
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "text-lg font-black",
                                                            (item.creator?.trustScore || 0) > 90 ? "text-emerald-400" : "text-amber-400"
                                                        )}>
                                                            {item.creator?.trustScore || 0}/100
                                                        </span>
                                                        <div className={cn(
                                                            "w-2 h-2 rounded-full",
                                                            (item.creator?.trustScore || 0) > 90 ? "bg-emerald-500" : "bg-amber-500"
                                                        )} />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Outcome / Description */}
                                            <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                                                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 italic">Expected Outcome</h3>
                                                <p className="text-sm leading-relaxed text-gray-300">
                                                    {item.description}
                                                </p>
                                            </div>

                                            {/* Feedback Input */}
                                            <div className="relative group/input">
                                                <MessageSquare className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within/input:text-blue-400 transition-colors" />
                                                <input
                                                    type="text"
                                                    placeholder="Optional feedback for creator..."
                                                    className="w-full bg-black/40 border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-gray-600"
                                                    value={feedback[item.id] || ""}
                                                    onChange={(e) => setFeedback({ ...feedback, [item.id]: e.target.value })}
                                                />
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <IronButton
                                                    variant="secondary"
                                                    className="h-12 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                                    icon={<XCircle className="w-5 h-5" />}
                                                    onClick={() => handleAction(item.id, "reject")}
                                                    disabled={processingId === item.id}
                                                >
                                                    {processingId === item.id ? "Processing..." : "Reject"}
                                                </IronButton>
                                                <IronButton
                                                    variant="primary"
                                                    className="h-12"
                                                    icon={<CheckCircle className="w-5 h-5" />}
                                                    onClick={() => handleAction(item.id, "approve")}
                                                    disabled={processingId === item.id}
                                                >
                                                    {processingId === item.id ? "Processing..." : "Approve"}
                                                </IronButton>
                                            </div>
                                        </div>
                                    </GlassPanel>
                                ))
                            )}
                        </motion.div>
                    </AnimatePresence>
                )}
                {/* Seed Data Button (Dev Only) */}
                {process.env.NODE_ENV === "development" && (
                    <div className="fixed bottom-20 right-6 opacity-50 hover:opacity-100 transition-opacity z-50">
                        <button
                            onClick={async () => {
                                try {
                                    const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
                                    const { db } = await import("@/lib/firebase");

                                    await addDoc(collection(db, "projects"), {
                                        title: "Test Project " + Math.floor(Math.random() * 1000),
                                        description: "This is a generated test project for the approval queue.",
                                        status: "pending_approval",
                                        submittedAt: serverTimestamp(),
                                        creator: {
                                            username: "@test_user",
                                            isVerified: Math.random() > 0.5,
                                            trustScore: Math.floor(Math.random() * 100),
                                            uid: "test-uid-" + Math.floor(Math.random() * 1000)
                                        },
                                        priority: Math.random() > 0.7 ? "enterprise" : "standard",
                                        thumbnailUrl: `https://picsum.photos/seed/${Math.random()}/800/600`
                                    });
                                    alert("Seeded test project!");
                                } catch (e) {
                                    console.error(e);
                                    alert("Error seeding: " + e);
                                }
                            }}
                            className="bg-purple-900/50 text-purple-200 px-4 py-2 rounded-full text-xs font-mono border border-purple-500/30"
                        >
                            + Seed Data
                        </button>
                    </div>
                )}
            </main>
            {/* ... nav ... */}
        </div>
    );
}
