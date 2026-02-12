"use client";

import React from 'react';
import {
    Activity,
    BarChart3,
    ShieldAlert,
    Globe,
    Server,
    Users,
    AlertTriangle,
    ExternalLink,
    Search,
    Settings
} from 'lucide-react';
import { StripeTestDashboard } from '@/components/dashboard/StripeTestDashboard';

const AdminCommandCenter = () => {
    return (
        <div className="flex-1 p-8 relative overflow-hidden">
            {/* Background Aura */}
            <div className="aura-glow glow-blue w-[500px] h-[500px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-5"></div>

            <header className="flex justify-between items-end mb-12">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.3em] text-danger mb-2 italic">Kernel Oversight</h2>
                    <h1 className="text-4xl font-display font-black uppercase italic tracking-tighter">System Command</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className="glass-panel px-6 py-3 rounded-2xl flex items-center gap-3 border-success/30">
                        <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                        <span className="text-[10px] font-black uppercase tracking-widest italic text-success">Heartbeat: 42ms</span>
                    </div>
                    <button className="p-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all">
                        <Settings size={20} className="text-text-secondary" />
                    </button>
                </div>
            </header>

            {/* Global Health Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                {[
                    { icon: Globe, label: 'Global Traffic', value: 'High', color: 'blue', desc: 'Active in 27 Regions' },
                    { icon: BarChart3, label: 'Revenue (24h)', value: '$142.8k', color: 'emerald', desc: '+12.5% vs yesterday' },
                    { icon: Users, label: 'Active Makers', value: '1,240', color: 'indigo', desc: '820 in SF Cluster' },
                    { icon: ShieldAlert, label: 'Open Disputes', value: '14', color: 'danger', desc: '3 Critical Triage' }
                ].map((stat) => (
                    <div key={stat.label} className="glass-card p-8 rounded-3xl relative overflow-hidden group">
                        <div className={`absolute top-0 right-0 w-24 h-24 bg-${stat.color}-500/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-${stat.color}-500/10 transition-colors`}></div>
                        <div className="flex items-center gap-4 mb-6 relative z-10">
                            <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                                <stat.icon size={18} className={`text-${stat.color}-400`} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary italic">{stat.label}</span>
                        </div>
                        <div className="text-4xl font-display font-black uppercase italic tracking-tighter mb-2 relative z-10">{stat.value}</div>
                        <p className="text-[9px] font-bold text-text-secondary italic opacity-60 uppercase tracking-widest relative z-10">{stat.desc}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Real-time Event Log (Left/Center) */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xl font-display font-black uppercase italic tracking-tighter">System Pulse</h3>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary italic">Builds</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-danger rounded-full"></div>
                                <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary italic">Errors</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel rounded-[2.5rem] p-4 bg-black/20">
                        <div className="space-y-1">
                            {[
                                { time: '09:42:11', type: 'BUILD_SUCCESS', msg: 'SF_CLUSTER_01: Payment Router V3 Deployed', color: 'blue' },
                                { time: '09:41:05', type: 'CRITICAL_DISPUTE', msg: 'NYC_NODE_A: Unauthorized Blueprint Alteration', color: 'danger' },
                                { time: '09:40:22', type: 'MAKER_ONBOARD', msg: 'Global: 42 New Verified Makers Registered', color: 'success' },
                                { time: '09:38:15', type: 'REVENUE_SURGE', msg: 'System: 20% Increase in On-Demand Requests', color: 'indigo' },
                                { time: '09:35:44', type: 'AUTH_BLOCKED', msg: 'LDN_REF_04: 1,200 Suspicious Requests Denied', color: 'danger' }
                            ].map((event) => (
                                <div key={`${event.time}-${event.type}`} className="flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all cursor-pointer group">
                                    <span className="text-[9px] font-mono font-bold text-text-secondary opacity-40 group-hover:opacity-100 transition-opacity shrink-0">{event.time}</span>
                                    <div className={`w-1.5 h-1.5 bg-${event.color}-500 rounded-full shrink-0`}></div>
                                    <div className="flex-1 min-w-0">
                                        <span className={`text-[10px] font-black uppercase tracking-widest text-${event.color}-400 italic mr-4 shrink-0`}>[{event.type}]</span>
                                        <span className="text-xs font-medium text-text-secondary italic truncate">{event.msg}</span>
                                    </div>
                                    <ExternalLink size={14} className="text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Infrastructure Status (Right) */}
                <div className="space-y-8">
                    <div className="glass-card p-8 rounded-[2.5rem]">
                        <h3 className="text-lg font-display font-black uppercase italic tracking-tighter mb-6">Cluster Status</h3>
                        <div className="space-y-6">
                            {[
                                { name: 'North America', status: 'Optimal', load: 42 },
                                { name: 'Europe Hub', status: 'Steady', load: 68 },
                                { name: 'Asia/Pacific', status: 'Scaling', load: 85 }
                            ].map(cluster => (
                                <div key={cluster.name} className="space-y-3">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest italic">
                                        <span className="text-text-primary">{cluster.name}</span>
                                        <span className={`text-${cluster.load > 80 ? 'danger' : 'success'}-400`}>{cluster.status}</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                                        <div className={`h-full bg-${cluster.load > 80 ? 'danger' : 'primary'} transition-all duration-1000`} style={{ width: `${cluster.load}%` }}></div>
                                    </div>
                                    <div className="flex justify-between text-[8px] font-bold text-text-secondary opacity-40 uppercase tracking-tighter">
                                        <span>Node Load</span>
                                        <span>{cluster.load}% capacity</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-card p-8 rounded-[2.5rem]">
                        <h3 className="text-lg font-display font-black uppercase italic tracking-tighter mb-6">Governance Hub</h3>
                        <div className="space-y-4">
                            {[
                                { label: 'Dispute Console', icon: ShieldAlert, desc: 'Resolution Engine' },
                                { label: 'Policy Manager', icon: AlertTriangle, desc: 'IAM Kernels' },
                                { label: 'Audit Logs', icon: Activity, desc: 'System Forensics' }
                            ].map((item) => (
                                <div key={item.label} className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <item.icon size={16} className="text-danger" />
                                        <div>
                                            <div className="text-xs font-bold italic group-hover:text-danger transition-colors">{item.label}</div>
                                            <div className="text-[8px] font-black uppercase tracking-widest text-text-secondary">{item.desc}</div>
                                        </div>
                                    </div>
                                    <ExternalLink size={14} className="text-text-secondary" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-card p-8 rounded-[2.5rem] bg-gradient-to-br from-danger/5 to-transparent border-danger/20">
                        <div className="flex items-center gap-3 mb-6">
                            <ShieldAlert size={20} className="text-danger" />
                            <h3 className="text-lg font-display font-black uppercase italic tracking-tighter">Conflict Resolution</h3>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle size={14} className="text-danger" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-danger italic">Priority 1 Triage</span>
                            </div>
                            <p className="text-[10px] font-medium text-text-secondary italic mb-2">Dispute #4201 - Contract Breach reported by Mayflower Seeker.</p>
                            <div className="flex justify-end">
                                <button className="text-[9px] font-black uppercase tracking-widest text-danger hover:underline">Intercept Mission</button>
                            </div>
                        </div>
                        <button className="w-full skeuo-button bg-danger/10 border-danger/20 text-danger py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest italic hover:bg-danger/20">
                            Open Security HQ
                        </button>
                    </div>
                </div>
            </div>

            {/* Test Payment Protocol */}
            <div className="mt-12">
                <h3 className="text-xl font-display font-black uppercase italic tracking-tighter mb-6">Payment Protocol Genesis</h3>
                <StripeTestDashboard />
            </div>
        </div>
    );
};

export default AdminCommandCenter;
