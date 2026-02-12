"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Slot } from '@radix-ui/react-slot';

/**
 * DiscoverMake Design System: "Aura & Iron"
 * 
 * Combines modern glassmorphism (Aura) with tactile skeuomorphism (Iron)
 * for a premium, nostalgic-yet-futuristic aesthetic.
 */

// ============================================================
// DESIGN TOKENS
// ============================================================

export const DESIGN_TOKENS = {
    // Aura Colors (Modern/Futuristic)
    aura: {
        primary: 'rgba(59, 130, 246, 0.9)',      // Electric Blue
        secondary: 'rgba(139, 92, 246, 0.9)',    // Violet
        accent: 'rgba(16, 185, 129, 0.9)',       // Emerald
        glow: 'rgba(59, 130, 246, 0.4)',         // Blue glow
        glass: 'rgba(255, 255, 255, 0.05)',      // Glass surface
        glassBorder: 'rgba(255, 255, 255, 0.1)', // Glass border
    },

    // Iron Colors (Skeuomorphic/Nostalgic)
    iron: {
        surface: '#1a1a2e',        // Deep space
        surfaceLight: '#252542',   // Raised surface
        border: '#3d3d5c',         // Beveled edge
        borderLight: '#5a5a7a',    // Highlight edge
        text: '#e8e8f0',           // Primary text
        textMuted: '#8888a0',      // Secondary text
    },

    // Status Colors
    status: {
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
    },

    // Shadows
    shadows: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.3)',
        bevel: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.3)',
        glow: '0 0 40px rgba(59, 130, 246, 0.3)',
    },
} as const;

// ============================================================
// GLASSMORPHIC PANEL
// ============================================================

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'elevated' | 'subtle' | 'glow';
    glow?: boolean;
    children: React.ReactNode;
}

export function GlassPanel({
    variant = 'default',
    glow = false,
    className,
    children,
    ...props
}: GlassPanelProps) {
    const variants = {
        default: 'bg-white/5 border border-white/10 backdrop-blur-xl',
        elevated: 'bg-white/8 border border-white/15 backdrop-blur-2xl shadow-xl',
        subtle: 'bg-white/3 border border-white/5 backdrop-blur-lg',
        glow: 'bg-blue-500/10 border border-blue-400/30 shadow-[0_0_30px_rgba(59,130,246,0.3)] backdrop-blur-xl',
    };

    return (
        <div
            className={cn(
                'rounded-2xl p-6 transition-all duration-300',
                variants[variant],
                (glow || variant === 'glow') && 'shadow-[0_0_40px_rgba(59,130,246,0.2)]',
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

// ============================================================
// ANIMATED TEXT
// ============================================================

interface AnimatedTextProps {
    text: string;
    className?: string;
    delay?: number;
    variant?: 'fade' | 'slideUp' | 'scaleUp' | 'typewriter';
}

export function AnimatedText({
    text,
    className,
    delay = 0,
    variant = 'fade'
}: AnimatedTextProps) {
    const variants = {
        fade: {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
        },
        slideUp: {
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0 },
        },
        scaleUp: {
            initial: { opacity: 0, scale: 0.8 },
            animate: { opacity: 1, scale: 1 },
        },
    };

    if (variant === 'typewriter') {
        return (
            <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay }}
                className={className}
            >
                {text.split('').map((char, i) => (
                    <motion.span
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: delay + i * 0.05 }}
                    >
                        {char}
                    </motion.span>
                ))}
            </motion.span>
        );
    }

    return (
        <motion.span
            initial={variants[variant].initial}
            animate={variants[variant].animate}
            transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
            className={cn('inline-block', className)}
        >
            {text}
        </motion.span>
    );
}

// ============================================================
// SKEUOMORPHIC BUTTON
// ============================================================

interface IronButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    icon?: React.ReactNode;
    asChild?: boolean;
}

export function IronButton({
    variant = 'primary',
    size = 'md',
    icon,
    asChild = false,
    className,
    children,
    ...props
}: IronButtonProps) {
    const Comp = asChild ? Slot : 'button';
    const variants = {
        primary: `
      bg-gradient-to-b from-blue-500 to-blue-600
      border border-blue-400
      text-white font-semibold
      shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_12px_rgba(59,130,246,0.4)]
      hover:from-blue-400 hover:to-blue-500
      active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]
    `,
        secondary: `
      bg-gradient-to-b from-gray-700 to-gray-800
      border border-gray-600
      text-gray-100 font-medium
      shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.3)]
      hover:from-gray-600 hover:to-gray-700
      active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]
    `,
        ghost: `
      bg-transparent
      border border-white/10
      text-gray-300 font-medium
      hover:bg-white/5 hover:border-white/20
      active:bg-white/10
    `,
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
        md: 'px-5 py-2.5 text-base rounded-xl gap-2',
        lg: 'px-7 py-3.5 text-lg rounded-2xl gap-3',
    };

    return (
        <Comp
            className={cn(
                'inline-flex items-center justify-center transition-all duration-150',
                variants[variant],
                sizes[size],
                'disabled:opacity-50 disabled:cursor-not-allowed',
                className
            )}
            {...props}
        >
            {icon && <span className="flex-shrink-0">{icon}</span>}
            {children}
        </Comp>
    );
}

// ============================================================
// NOSTALGIC BADGE (AOL/Windows 95 style)
// ============================================================

export type RetroStrataVariant = 'info' | 'success' | 'warning' | 'error' | 'premium' | 'subtle';

interface RetroStrataProps {
    label: string;
    variant?: RetroStrataVariant;
    pulse?: boolean;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function RetroStrata({ label, variant = 'info', pulse = false, size = 'md', className }: RetroStrataProps) {
    const variants = {
        info: 'bg-blue-900/50 border-blue-500/50 text-blue-300',
        success: 'bg-emerald-900/50 border-emerald-500/50 text-emerald-300',
        warning: 'bg-amber-900/50 border-amber-500/50 text-amber-300',
        error: 'bg-red-900/50 border-red-500/50 text-red-300',
        premium: 'bg-purple-900/50 border-purple-500/50 text-purple-300',
        subtle: 'bg-gray-900/50 border-gray-500/50 text-gray-300',
    };

    const sizes = {
        sm: 'px-2 py-1 text-[10px]',
        md: 'px-3 py-1.5 text-xs',
        lg: 'px-4 py-2 text-sm',
    };

    return (
        <span
            className={cn(
                'inline-flex items-center gap-2 rounded-lg border font-mono uppercase tracking-wider',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]',
                variants[variant],
                sizes[size],
                className
            )}
        >
            {pulse && (
                <span className="relative flex h-2 w-2">
                    <span className={cn(
                        'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                        variant === 'success' ? 'bg-emerald-400' :
                            variant === 'warning' ? 'bg-amber-400' :
                                variant === 'error' ? 'bg-red-400' :
                                    variant === 'premium' ? 'bg-purple-400' :
                                        'bg-blue-400'
                    )} />
                    <span className={cn(
                        'relative inline-flex rounded-full h-2 w-2',
                        variant === 'success' ? 'bg-emerald-500' :
                            variant === 'warning' ? 'bg-amber-500' :
                                variant === 'error' ? 'bg-red-500' :
                                    variant === 'premium' ? 'bg-purple-500' :
                                        'bg-blue-500'
                    )} />
                </span>
            )}
            {label}
        </span>
    );
}

// ============================================================
// STAT CARD (Dashboard Metric)
// ============================================================

interface StatCardProps {
    label: string;
    value: string | number;
    change?: string;
    changeType?: 'positive' | 'negative' | 'neutral';
    icon?: React.ReactNode;
}

export function StatCard({ label, value, change, changeType = 'neutral', icon }: StatCardProps) {
    const changeColors = {
        positive: 'text-emerald-400',
        negative: 'text-red-400',
        neutral: 'text-gray-400',
    };

    return (
        <GlassPanel variant="default" className="relative overflow-hidden">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
                    <p className="text-3xl font-bold text-white">{value}</p>
                    {change && (
                        <p className={cn('text-sm mt-1', changeColors[changeType])}>
                            {changeType === 'positive' && '↑ '}
                            {changeType === 'negative' && '↓ '}
                            {change}
                        </p>
                    )}
                </div>
                {icon && (
                    <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400">
                        {icon}
                    </div>
                )}
            </div>
            {/* Decorative glow */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl" />
        </GlassPanel>
    );
}

// ============================================================
// PROGRESS INDICATOR (Skeuomorphic)
// ============================================================

interface ProgressBarProps {
    value: number; // 0-100
    label?: string;
    showPercentage?: boolean;
    variant?: 'default' | 'success' | 'warning';
}

export function ProgressBar({ value, label, showPercentage = true, variant = 'default' }: ProgressBarProps) {
    const clampedValue = Math.min(100, Math.max(0, value));

    const barColors = {
        default: 'from-blue-500 to-blue-400',
        success: 'from-emerald-500 to-emerald-400',
        warning: 'from-amber-500 to-amber-400',
    };

    return (
        <div className="w-full">
            {(label || showPercentage) && (
                <div className="flex justify-between items-center mb-2">
                    {label && <span className="text-sm text-gray-400">{label}</span>}
                    {showPercentage && <span className="text-sm font-mono text-gray-300">{clampedValue}%</span>}
                </div>
            )}
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
                <div
                    className={cn(
                        'h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out',
                        'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_8px_rgba(59,130,246,0.5)]',
                        barColors[variant]
                    )}
                    style={{ width: `${clampedValue}%` }}
                />
            </div>
        </div>
    );
}

// ============================================================
// SECTION HEADER
// ============================================================

interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
    return (
        <div className="flex items-center justify-between mb-6">
            <div>
                <h2 className="text-2xl font-bold text-white">{title}</h2>
                {subtitle && <p className="text-gray-400 mt-1">{subtitle}</p>}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}

// ============================================================
// ANIMATED GLOW BORDER
// ============================================================

interface GlowBorderProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export function GlowBorder({ children, className, ...props }: GlowBorderProps) {
    return (
        <div className={cn('relative group', className)} {...props}>
            {/* Animated gradient border */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-2xl opacity-30 group-hover:opacity-60 blur transition-opacity duration-500 animate-gradient-x" />
            <div className="relative bg-gray-900 rounded-2xl">
                {children}
            </div>
        </div>
    );
}

// ============================================================
// EXPORTS
// ============================================================

export const DesignSystem = {
    tokens: DESIGN_TOKENS,
    GlassPanel,
    IronButton,
    RetroStrata,
    StatCard,
    ProgressBar,
    SectionHeader,
    GlowBorder,
    AnimatedText,
};

export default DesignSystem;
