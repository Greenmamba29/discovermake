"use client";

import React from "react";
import { motion } from "framer-motion";
import {
    Lock,
    Star,
    ShieldCheck,
    Clock,
    Eye,
    EyeOff,
    Zap,
    CheckCircle2,
    MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Image from "next/image";

export interface MakerCardData {
    id: string;
    displayName?: string;
    photoURL?: string;
    skills: string[];
    rating: number;
    completedProjects: number;
    hourlyRate?: number;
    availability: "available" | "busy" | "offline";
    matchScore?: number;
    location?: string;
}

interface AnonymizedMakerCardProps {
    maker: MakerCardData;
    isRevealed: boolean;
    isAdmin?: boolean;
    onUnlock?: (makerId: string) => void;
    className?: string;
}

/**
 * US-002: Privacy Gate — The Invisible Market
 * 
 * Anonymized Maker card that hides identity until payment.
 * - Before payment: Blurred avatar, skill tags, rating, match score (no name/photo)
 * - After payment: Full identity revealed
 * - Admin: Always sees full identity
 */
export function AnonymizedMakerCard({
    maker,
    isRevealed,
    isAdmin = false,
    onUnlock,
    className,
}: AnonymizedMakerCardProps) {
    const showIdentity = isRevealed || isAdmin;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "glass-card rounded-3xl p-6 relative overflow-hidden group transition-all duration-300",
                showIdentity ? "hover:border-emerald-500/30" : "hover:border-purple-500/30",
                className
            )}
        >
            {/* Glow effect */}
            {!showIdentity && (
                <div className="absolute inset-0 bg-gradient-to-br from-purple-600/5 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}

            {/* Match Score Badge */}
            {maker.matchScore && (
                <div className="absolute top-4 right-4">
                    <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest italic px-3 py-1.5 rounded-full",
                        maker.matchScore >= 90
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                            : maker.matchScore >= 75
                                ? "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                                : "bg-white/10 text-white/50 border border-white/10"
                    )}>
                        {maker.matchScore}% Match
                    </span>
                </div>
            )}

            <div className="relative z-10 flex items-start gap-4">
                {/* Avatar */}
                <div className="relative">
                    <div className={cn(
                        "w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden border-2 transition-all",
                        showIdentity
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : "border-white/10 bg-white/5"
                    )}>
                        {showIdentity && maker.photoURL ? (
                            <Image
                                src={maker.photoURL}
                                alt={maker.displayName || "Maker"}
                                fill
                                className="object-cover"
                            />
                        ) : (
                            <div className="w-full h-full bg-gradient-to-br from-purple-600/30 to-blue-600/30 flex items-center justify-center">
                                <EyeOff className="w-6 h-6 text-white/30" />
                            </div>
                        )}
                    </div>
                    {/* Availability dot */}
                    <span className={cn(
                        "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0B1120]",
                        maker.availability === "available" ? "bg-emerald-400" :
                            maker.availability === "busy" ? "bg-amber-400" : "bg-white/20"
                    )} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    {showIdentity ? (
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-lg font-black tracking-tight truncate">
                                {maker.displayName || "Unknown Maker"}
                            </h4>
                            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-lg font-black tracking-tight text-white/50">
                                Hidden Maker
                            </h4>
                            <Lock className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        </div>
                    )}

                    {/* Rating + Stats */}
                    <div className="flex items-center gap-3 text-xs text-white/40 font-medium mb-3">
                        <span className="flex items-center gap-1">
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                            {maker.rating.toFixed(1)}
                        </span>
                        <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {maker.completedProjects} builds
                        </span>
                        {maker.hourlyRate && showIdentity && (
                            <span className="flex items-center gap-1 text-emerald-400">
                                ${maker.hourlyRate}/hr
                            </span>
                        )}
                        {maker.location && showIdentity && (
                            <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {maker.location}
                            </span>
                        )}
                    </div>

                    {/* Skills */}
                    <div className="flex flex-wrap gap-1.5">
                        {maker.skills.slice(0, showIdentity ? 6 : 4).map((skill) => (
                            <span
                                key={skill}
                                className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg italic"
                            >
                                {skill}
                            </span>
                        ))}
                        {maker.skills.length > (showIdentity ? 6 : 4) && (
                            <span className="text-[10px] font-bold text-white/30 px-2 py-1">
                                +{maker.skills.length - (showIdentity ? 6 : 4)}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Unlock CTA or Revealed status */}
            <div className="mt-5 pt-4 border-t border-white/5">
                {showIdentity ? (
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 italic">
                            <Eye className="w-3.5 h-3.5" />
                            {isAdmin ? "Admin View" : "Identity Unlocked"}
                        </span>
                        <Button
                            className="bg-white/10 hover:bg-white/15 text-white text-xs rounded-xl px-4 h-8 font-bold"
                            size="sm"
                        >
                            View Profile
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-white/30">
                            <Lock className="w-3.5 h-3.5 text-purple-400" />
                            <span className="italic">Identity hidden until payment</span>
                        </div>
                        <Button
                            onClick={() => onUnlock?.(maker.id)}
                            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs rounded-xl px-4 h-8 font-bold shadow-lg shadow-purple-500/20"
                            size="sm"
                        >
                            <Zap className="w-3 h-3 mr-1" /> Unlock Maker
                        </Button>
                    </div>
                )}
            </div>

            {/* Admin indicator */}
            {isAdmin && !isRevealed && (
                <div className="absolute top-4 left-4">
                    <span className="text-[8px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 px-2 py-1 rounded-full border border-amber-500/20 italic">
                        Admin Bypass
                    </span>
                </div>
            )}
        </motion.div>
    );
}

/**
 * Grid of anonymized Maker cards for marketplace browsing
 */
export function MakerGrid({
    makers,
    revealedMakerIds,
    isAdmin = false,
    onUnlock,
}: {
    makers: MakerCardData[];
    revealedMakerIds: Set<string>;
    isAdmin?: boolean;
    onUnlock?: (makerId: string) => void;
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {makers.map((maker) => (
                <AnonymizedMakerCard
                    key={maker.id}
                    maker={maker}
                    isRevealed={revealedMakerIds.has(maker.id)}
                    isAdmin={isAdmin}
                    onUnlock={onUnlock}
                />
            ))}
        </div>
    );
}
