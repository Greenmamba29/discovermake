"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import {
  Zap,
  Sparkles,
  ArrowUpRight,
  Bot,
  Users,
  Terminal,
  Rocket,
  Shield,
  BarChart3
} from "lucide-react";
import Link from "next/link";
import { BrandingDrop } from "@/components/motion/BrandingDrop";
import { HeroMotionBackground } from "@/components/motion/HeroMotionBackground";
import { ParallaxSeries } from "@/components/motion/ParallaxSeries";
import { AnimatedText, SectionHeader, IronButton, RetroStrata, GlassPanel } from "@/components/ui/DesignSystem";

/**
 * SHOW STOPPING LANDING PAGE
 * High-Fidelity, Pixel-Perfect, One-of-a-Kind
 */

export default function LandingPage() {
  const { scrollY } = useScroll();

  // Safety check for transforms
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const scale = useTransform(scrollY, [0, 300], [1, 0.9]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    setIsLoaded(true);
    const timer = setTimeout(() => setShowSplash(false), 3000); // Shortened for better dev experience
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-[#e8e8f0] font-sans selection:bg-blue-500/30 overflow-x-hidden">

      {/* 0. PREMIUM SPLASH DROP */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B0F1A]"
          >
            <BrandingDrop />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. IMMERSIVE MOTION BACKGROUND */}
      <HeroMotionBackground />

      {/* 2. DYNAMIC NAVBAR */}
      <nav className="fixed top-0 w-full z-50 px-6 py-6 bg-transparent">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3 group cursor-pointer">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform border border-blue-400/30">
              <Zap className="w-6 h-6 text-white fill-current" />
            </div>
            <h1 className="text-xl font-black tracking-tight uppercase italic bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
              DiscoverMake
            </h1>
          </Link>

          <div className="hidden md:flex items-center gap-8 bg-black/20 backdrop-blur-xl border border-white/5 px-8 py-2.5 rounded-full">
            {[
              { label: 'Marketplace', href: '/marketplace' },
              { label: 'Architect', href: '/architect' },
              { label: 'Admin', href: '/admin/apex' }
            ].map((item) => (
              <Link key={item.label} href={item.href} className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white transition-colors italic">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <Link href="/login">
              <button className="text-[10px] font-black uppercase tracking-widest text-white italic hover:text-blue-400 transition-colors">
                Login
              </button>
            </Link>
            <Link href="/onboarding">
              <IronButton variant="primary" size="sm" className="h-10 px-8">
                <span className="text-[10px] uppercase font-black italic tracking-widest">Connect Hub</span>
              </IronButton>
            </Link>
          </div>
        </div>
      </nav>

      {/* 3. CORE CONTENT JOURNEY */}
      <ParallaxSeries>
        <div className="relative pt-40 pb-20 px-6 min-h-screen flex flex-col items-center justify-center text-center">
          <motion.div style={{ opacity: opacity, scale: scale }} className="max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2.5 bg-blue-600/10 backdrop-blur-md border border-blue-500/20 px-5 py-2 rounded-full mb-10 shadow-2xl"
            >
              <Sparkles className="w-4 h-4 text-blue-400" />
              <AnimatedText
                text="The Autonomous Software Refinery is Active"
                variant="typewriter"
                className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400 italic"
              />
            </motion.div>

            <h1 className="text-7xl md:text-[10rem] font-black tracking-tighter leading-[0.8] uppercase italic mb-10">
              <span className="block overflow-hidden pb-4">
                <AnimatedText text="DISCOVER" variant="slideUp" className="bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent" />
              </span>
              <span className="block overflow-hidden py-4">
                <AnimatedText text="BUILD+" variant="slideUp" delay={0.1} className="text-blue-600" />
              </span>
              <span className="block overflow-hidden pt-4">
                <AnimatedText text="MAKE" variant="slideUp" delay={0.2} className="bg-gradient-to-b from-white/40 via-white to-white bg-clip-text text-transparent" />
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-lg md:text-xl text-gray-400 font-medium italic leading-relaxed mb-14 px-4">
              Architect your vision, recruit verified Makers, and ship enterprise
              infrastructure at the speed of thought.
            </p>

            <div className="flex flex-col md:flex-row items-center justify-center gap-6">
              <Link href="/onboarding">
                <IronButton size="lg" className="w-64 h-16 text-[12px] uppercase italic tracking-[0.2em] font-black">
                  Initiate Mission
                  <ArrowUpRight className="ml-3 w-5 h-5" />
                </IronButton>
              </Link>
              <Link href="/marketplace">
                <button className="w-64 h-16 rounded-[1.25rem] border border-white/10 bg-white/5 backdrop-blur-xl text-[12px] font-black uppercase tracking-[0.2em] italic text-white hover:bg-white/10 transition-all">
                  Explore The Forge
                </button>
              </Link>
            </div>
          </motion.div>
        </div>

        {/* Persona Engines Expansion */}
        <div className="py-40 px-6 max-w-7xl mx-auto relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-600/5 blur-[120px] pointer-events-none" />

          <div className="text-center mb-24 space-y-4">
            <RetroStrata label="Operational Hierarchy" variant="info" className="mx-auto" />
            <h2 className="text-6xl font-black italic tracking-tighter uppercase text-white">The Three Engines</h2>
            <p className="max-w-xl mx-auto text-gray-500 font-medium italic">Integrated sovereign infrastructure for every node in the DiscoverMake network.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {/* Seeker Engine */}
            <GlassPanel variant="glow" className="h-[600px] p-0 rounded-[3rem] overflow-hidden group border-white/10 hover:border-blue-500/30 transition-all duration-700">
              <div className="h-2/5 p-10 flex flex-col justify-end bg-gradient-to-t from-[#0B1120] to-transparent relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                  <Bot className="w-40 h-40 text-blue-500" />
                </div>
                <Users className="w-10 h-10 text-blue-500 mb-4" />
                <h3 className="text-4xl font-black italic tracking-tighter uppercase">Seeker</h3>
              </div>
              <div className="h-3/5 p-10 space-y-8 flex flex-col">
                <p className="text-gray-400 font-medium italic text-sm leading-relaxed">
                  The consumer gateway. Architect complex visions through Devie AI and monitor every millisecond of execution.
                </p>
                <div className="space-y-3 mt-auto">
                  <Link href="/architect" className="block">
                    <IronButton variant="primary" className="w-full h-14 text-[10px] uppercase italic tracking-[0.2em]">Deploy Architect</IronButton>
                  </Link>
                  <Link href="/tracker" className="block">
                    <IronButton variant="secondary" className="w-full h-12 text-[9px] uppercase italic tracking-[0.2em] opacity-60 hover:opacity-100">Live Tracker</IronButton>
                  </Link>
                </div>
              </div>
            </GlassPanel>

            {/* Maker Engine */}
            <GlassPanel variant="glow" className="h-[600px] p-0 rounded-[3rem] overflow-hidden group border-white/10 hover:border-purple-500/30 transition-all duration-700 bg-purple-600/5">
              <div className="h-2/5 p-10 flex flex-col justify-end bg-gradient-to-t from-[#0B1120] to-transparent relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                  <Zap className="w-40 h-40 text-purple-500" />
                </div>
                <Zap className="w-10 h-10 text-purple-500 mb-4" />
                <h3 className="text-4xl font-black italic tracking-tighter uppercase">Maker</h3>
              </div>
              <div className="h-3/5 p-10 space-y-8 flex flex-col">
                <p className="text-gray-400 font-medium italic text-sm leading-relaxed">
                  The foundry. Rapidly iterate on blueprints, verify biological throughput, and monetize the autonomous future.
                </p>
                <div className="space-y-3 mt-auto">
                  <Link href="/marketplace" className="block">
                    <IronButton variant="primary" className="w-full h-14 text-[10px] uppercase italic tracking-[0.2em] bg-purple-600 hover:bg-purple-500 shadow-purple-500/20">The Forge</IronButton>
                  </Link>
                  <Link href="/maker/dashboard" className="block">
                    <IronButton variant="secondary" className="w-full h-12 text-[9px] uppercase italic tracking-[0.2em] opacity-60 hover:opacity-100">Maker Index</IronButton>
                  </Link>
                </div>
              </div>
            </GlassPanel>

            {/* Apex Engine */}
            <GlassPanel variant="glow" className="h-[600px] p-0 rounded-[3rem] overflow-hidden group border-white/10 hover:border-emerald-500/30 transition-all duration-700 bg-emerald-600/5">
              <div className="h-2/5 p-10 flex flex-col justify-end bg-gradient-to-t from-[#0B1120] to-transparent relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                  <BarChart3 className="w-40 h-40 text-emerald-500" />
                </div>
                <Shield className="w-10 h-10 text-emerald-500 mb-4" />
                <h3 className="text-4xl font-black italic tracking-tighter uppercase">Apex</h3>
              </div>
              <div className="h-3/5 p-10 space-y-8 flex flex-col">
                <p className="text-gray-400 font-medium italic text-sm leading-relaxed">
                  The sovereign command. Manage global revenue distribution, policy enforcement, and fleet-wide observability.
                </p>
                <div className="space-y-3 mt-auto">
                  <Link href="/admin/apex" className="block">
                    <IronButton variant="primary" className="w-full h-14 text-[10px] uppercase italic tracking-[0.2em] bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20">Enter Apex</IronButton>
                  </Link>
                  <Link href="/admin/revenue" className="block">
                    <IronButton variant="secondary" className="w-full h-12 text-[9px] uppercase italic tracking-[0.2em] opacity-60 hover:opacity-100">Revenue Hub</IronButton>
                  </Link>
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      </ParallaxSeries>

      <footer className="py-32 px-6 border-t border-white/5 bg-[#080B14] relative z-20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-20">
          <div className="max-w-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white fill-current" />
              </div>
              <span className="text-xl font-black italic uppercase tracking-tighter">DiscoverMake</span>
            </div>
            <p className="text-xs text-gray-500 italic leading-relaxed font-medium">
              DiscoverMake is a sovereign infrastructure platform for the autonomous age.
            </p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-32 pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-600 italic">© 2026 DISCOVERMAKE SYSTEMS</span>
          <div className="flex items-center gap-4">
            <RetroStrata label="System: Operational" variant="success" pulse />
            <RetroStrata label="Ver: 3.2.0-Alpha" variant="info" />
          </div>
        </div>
      </footer>
    </div>
  );
}
