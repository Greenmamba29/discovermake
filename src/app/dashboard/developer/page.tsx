"use client";

import React from 'react';
import {
    Terminal,
    DollarSign,
    Map as MapIcon,
    Zap,
    ArrowUpRight,
    TrendingUp,
    Cpu,
    ShieldCheck,
    Code2,
    List
} from 'lucide-react';

const DeveloperDashboard = () => {
    return (
        <div className="flex-1 p-8 relative overflow-hidden">
            {/* Background Aura */}
            <div className="aura-glow glow-blue w-[300px] h-[300px] -top-20 -left-20 opacity-10"></div>

            <header className="flex justify-between items-end mb-12">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.3em] text-success mb-2 italic">Refinery Terminal</h2>
                    <h1 className="text-4xl font-display font-black uppercase italic tracking-tighter">Maker Operations</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className="glass-panel px-6 py-3 rounded-2xl flex items-center gap-3">
                        <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                        <span className="text-[10px] font-black uppercase tracking-widest italic">Live in SF_CLUSTER</span>
                    </div>
                    <button className="skeuo-button bg-success/20 border-success/30 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest italic text-success hover:bg-success/30 transition-all">
                        Go Offline
                    </button>
                </div>
            </header>

            {/* Revenue Snapshot */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                <div className="glass-card p-10 rounded-[2.5rem] bg-gradient-to-br from-success/5 to-transparent border-success/20">
                    <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 bg-success/20 rounded-2xl flex items-center justify-center border border-success/30">
                            <TrendingUp className="text-success w-6 h-6" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-success italic">+22% Surge</span>
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-2 italic">Daily Earnings</h3>
                    <div className="text-5xl font-display font-black uppercase italic tracking-tighter">$1,240.00</div>
                </div>

                <div className="glass-card p-8 rounded-[2rem] flex flex-col justify-between">
                    <div>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-4 italic">Active Gigs</h4>
                        <div className="text-3xl font-display font-black uppercase italic tracking-tighter">3 Missions</div>
                    </div>
                    <div className="flex -space-x-3 mt-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-10 h-10 rounded-full border-2 border-background bg-slate-800 flex items-center justify-center">
                                <Cpu size={14} className="text-primary" />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glass-card p-8 rounded-[2rem] flex flex-col justify-between">
                    <div>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-4 italic">Reputation Score</h4>
                        <div className="text-3xl font-display font-black uppercase italic tracking-tighter">4.98</div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                        <ShieldCheck size={16} className="text-success" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-success italic">Top Tier Maker</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                {/* Project feed inspired by unzipped assets */}
                <div className="xl:col-span-3 space-y-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-display font-black uppercase italic tracking-tighter">Nearby Gigs</h3>
                        <div className="flex gap-4">
                            <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest italic text-primary">
                                <List size={14} /> List View
                            </button>
                            <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest italic text-text-secondary">
                                <MapIcon size={14} /> Map View
                            </button>
                        </div>
                    </div>

                    {[
                        { title: 'Payment Router V3 Patch', bounty: '$500', stack: 'NODE.JS, STRIPE', urgency: 'High', distance: '0.2km' },
                        { title: 'Auth Layer Hardening', bounty: '$1,200', stack: 'FIREBASE, TS', urgency: 'Medium', distance: '1.5km' },
                        { title: 'AI Visualizer Sync', bounty: '$800', stack: 'REACT, REMOTION', urgency: 'Urgent', distance: '0.5km' }
                    ].map((project, i) => (
                        <div key={i} className="glass-card p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-8 group hover:bg-white/5 transition-all">
                            <div className="flex items-center gap-6 flex-1">
                                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 group-hover:border-success/50 transition-colors shrink-0">
                                    <Terminal className="text-text-primary w-8 h-8" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="text-2xl font-display font-black uppercase italic tracking-tighter">{project.title}</h4>
                                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-${project.urgency === 'Urgent' ? 'danger' : 'success'}/20 text-${project.urgency === 'Urgent' ? 'danger' : 'success'}`}>
                                            {project.urgency}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-text-secondary italic">
                                        <span>{project.stack}</span>
                                        <span>•</span>
                                        <span>{project.distance} away</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-8 shrink-0">
                                <div className="text-right">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary italic">Potential Bounty</p>
                                    <p className="text-3xl font-display font-black uppercase italic tracking-tighter text-success">{project.bounty}</p>
                                </div>
                                <button className="skeuo-button bg-success px-8 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest italic text-white flex items-center gap-2">
                                    Claim <ArrowUpRight size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Sidebar Mini-HUD */}
                <div className="space-y-8">
                    <div className="glass-card p-8 rounded-[2.5rem]">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-display font-black uppercase italic tracking-tighter">Skill Nodes</h3>
                            <button className="text-[10px] font-black uppercase tracking-widest text-primary italic hover:underline">Reputation Hub</button>
                        </div>
                        <div className="space-y-4">
                            {[
                                { label: 'Cloud Architecture', level: 85 },
                                { label: 'Security Kernels', level: 92 },
                                { label: 'Visual Refinement', level: 78 }
                            ].map(skill => (
                                <div key={skill.label} className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest italic">
                                        <span className="text-text-secondary">{skill.label}</span>
                                        <span className="text-primary">{skill.level}%</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary" style={{ width: `${skill.level}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className="w-full mt-8 glass-panel py-3 rounded-xl text-[10px] font-black uppercase tracking-widest italic text-text-secondary hover:text-text-primary transition-all">
                            Upgrade Nodes
                        </button>
                    </div>

                    <div className="glass-card p-8 rounded-[2.5rem]">
                        <h3 className="text-lg font-display font-black uppercase italic tracking-tighter mb-6">Financials</h3>
                        <div className="space-y-4">
                            {[
                                { label: 'Payout Settings', icon: DollarSign, desc: 'Airwallex Connect' },
                                { label: 'Surge History', icon: TrendingUp, desc: 'Revenue Machine' }
                            ].map((item, i) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <item.icon size={16} className="text-success" />
                                        <div>
                                            <div className="text-xs font-bold italic group-hover:text-success transition-colors">{item.label}</div>
                                            <div className="text-[8px] font-black uppercase tracking-widest text-text-secondary">{item.desc}</div>
                                        </div>
                                    </div>
                                    <ArrowUpRight size={14} className="text-text-secondary" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-card p-8 rounded-[2.5rem] bg-gradient-to-t from-blue-500/5 to-transparent">
                        <div className="flex items-center gap-3 mb-6">
                            <Zap size={20} className="text-primary" />
                            <h3 className="text-lg font-display font-black uppercase italic tracking-tighter">AI Buffer</h3>
                        </div>
                        <p className="text-[10px] font-medium text-text-secondary italic leading-relaxed mb-6">
                            Analyzing project throughput... You are in the top 5% of earners in the SF cluster today. Boost active?
                        </p>
                        <button className="w-full skeuo-button border-primary/30 text-primary py-3 rounded-xl text-[10px] font-black uppercase tracking-widest italic hover:bg-primary/10">
                            Activate Multiplier
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DeveloperDashboard;
