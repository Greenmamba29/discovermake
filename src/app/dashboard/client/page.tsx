"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import {
    Search,
    LayoutGrid,
    Clock,
    CheckCircle2,
    MoreHorizontal,
    Plus,
    Zap,
    Box,
    CreditCard,
    MessageSquare,
    ChevronRight,
    ShieldCheck,
    AlertCircle,
    X,
    Loader2,
    Send,
    Activity,
    Lock
} from 'lucide-react';
import { GlassPanel, IronButton, RetroStrata, ProgressBar, DesignSystem, AnimatedText } from '@/components/ui/DesignSystem';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { getUserProjects, createProject, Project } from '@/lib/projects';
import { subscribeToAuditLogs, logSystemEvent, AuditLog } from '@/lib/admin';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const ClientDashboard = () => {
    const { user, userData } = useAuth();
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // State
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [aiMessage, setAiMessage] = useState('');
    const [isAiResponding, setIsAiResponding] = useState(false);
    const [aiResponse, setAiResponse] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form state
    const [projectName, setProjectName] = useState('');
    const [projectDesc, setProjectDesc] = useState('');

    const verificationStatus = userData?.verificationStatus || 'unverified';

    useEffect(() => {
        if (!user) return;

        const unsubProjects = getUserProjects(user.uid, (fetchedProjects) => {
            setProjects(fetchedProjects);
            setIsLoading(false);
        });

        const unsubLogs = subscribeToAuditLogs((logs) => {
            setAuditLogs(logs);
        });

        return () => {
            unsubProjects();
            unsubLogs();
        };
    }, [user]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!aiMessage.trim()) return;

        setIsAiResponding(true);
        setAiResponse(null);

        // Mock AI interaction for MVP logic
        setTimeout(() => {
            setAiResponse("Analysis complete. I've optimized your build-buffer and identified a faster pathway for the Genesis protocol. Ready to proceed?");
            setIsAiResponding(false);
            setAiMessage('');
        }, 1500);
    };

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log('handleCreateProject triggered', { projectName, projectDesc });
        if (!user || !projectName.trim()) return;

        setIsCreating(true);
        try {
            console.log('Calling createProject...');
            const projectId = await createProject(user.uid, {
                name: projectName,
                description: projectDesc
            });
            console.log('createProject success');

            // Log activity to system audit
            await logSystemEvent(
                "Protocol Genesis Initialized",
                `Node: ${projectName.slice(0, 10)}... [${projectId?.slice(-4)}]`,
                "OK"
            );

            toast.success('Protocol Genesis Initialized', {
                description: `Project "${projectName}" has been registered in the network.`
            });
            setIsModalOpen(false);
            setProjectName('');
            setProjectDesc('');
        } catch (error) {
            console.error('Failed to create project:', error);
            toast.error('Genesis Failure', {
                description: 'The registry node is currently unreachable.'
            });
        } finally {
            setIsCreating(false);
        }
    };

    const stats = [
        { icon: Zap, label: 'Active Builds', value: String(projects.filter(p => p.status === 'active' || p.status === 'pending').length), variant: 'glow' as const },
        { icon: CheckCircle2, label: 'Shipped', value: String(projects.filter(p => p.status === 'complete').length), variant: 'default' as const },
        { icon: Clock, label: 'In Review', value: String(projects.filter(p => p.status === 'review').length), variant: 'subtle' as const },
        { icon: CreditCard, label: 'Escrow Credits', value: '$0', variant: 'default' as const }
    ];

    return (
        <div className="flex-1 p-8 relative min-h-screen bg-[#0B1120] text-[#e8e8f0]">
            {/* Background Aura */}
            <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="fixed bottom-0 left-0 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[120px] pointer-events-none" />

            <header className="flex justify-between items-end mb-12 relative z-10">
                <div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500 mb-2 italic">Sovereign Operations Center</h2>
                    <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white">
                        {user?.displayName ? `${user.displayName.split(' ')[0]}'s Nexus` : 'The Architect Hub'}
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    {verificationStatus === 'verified' ? (
                        <RetroStrata label="Verified Architect" variant="success" pulse />
                    ) : verificationStatus === 'pending' ? (
                        <RetroStrata label="Identity Pending" variant="warning" pulse />
                    ) : (
                        <button
                            onClick={() => router.push('/onboarding')}
                            className="group relative"
                        >
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full opacity-20 blur group-hover:opacity-40 transition-opacity" />
                            <RetroStrata label="Verify Identity" variant="error" />
                        </button>
                    )}
                    <IronButton
                        onClick={() => setIsModalOpen(true)}
                        variant="primary"
                        size="lg"
                        className="rounded-2xl h-14"
                        icon={<Plus size={20} />}
                    >
                        New Protocol Genesis
                    </IronButton>
                </div>
            </header>

            {/* Stats Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 relative z-10">
                {stats.map((stat, i) => (
                    <GlassPanel key={i} variant={stat.variant} className="p-6 rounded-[2rem] group hover:scale-[1.02] transition-all">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:border-blue-500/30 transition-colors">
                                <stat.icon size={18} className="text-blue-400" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">{stat.label}</span>
                        </div>
                        <div className="text-3xl font-black italic tracking-tighter text-white">{stat.value}</div>
                    </GlassPanel>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 relative z-10">
                {/* Deployment Matrix (Left/Center) */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Live Deployment Streams</h3>
                        <button className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-blue-400 transition-colors italic flex items-center gap-1">
                            View All Streams <ChevronRight size={12} />
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="animate-spin text-blue-500 size-10" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic">Syncing with registry...</p>
                        </div>
                    ) : projects.length === 0 ? (
                        <GlassPanel variant="subtle" className="p-12 text-center rounded-[2.5rem] border-dashed border-white/10">
                            <Box className="size-12 text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-400 italic mb-6">No active protocols detected in your sector.</p>
                            <IronButton onClick={() => setIsModalOpen(true)} variant="secondary" size="md" icon={<Plus size={16} />}>
                                Initialize First Genesis
                            </IronButton>
                        </GlassPanel>
                    ) : (
                        projects.map((project) => (
                            <GlassPanel key={project.id} variant="elevated" className="p-8 rounded-[2.5rem] group hover:border-blue-500/20 transition-all overflow-hidden relative">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/40" />

                                <div className="flex items-start justify-between mb-8">
                                    <div className="flex items-start gap-6">
                                        <div className="size-16 bg-white/5 rounded-[1.25rem] flex items-center justify-center border border-white/10 group-hover:border-blue-500/30 transition-colors bg-gradient-to-br from-blue-500/10 to-transparent">
                                            <Box className="text-blue-400 size-7" />
                                        </div>
                                        <div>
                                            <h4 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-1">{project.name}</h4>
                                            <div className="flex items-center gap-4">
                                                <p className="text-xs text-gray-500 italic">Maker Identity: <span className="text-gray-300">{project.makerName || 'Unassigned'}</span></p>
                                                {project.tier && <RetroStrata label={project.tier} variant="premium" size="sm" />}
                                                <RetroStrata
                                                    label={project.status}
                                                    variant={project.status === 'active' ? 'success' : project.status === 'pending' ? 'warning' : 'info'}
                                                    size="sm"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <button className="size-12 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center hover:bg-blue-500/10 hover:border-blue-500/30 transition-all">
                                            <MessageSquare size={18} className="text-gray-400 group-hover:text-blue-400" />
                                        </button>
                                        <IronButton variant="secondary" size="md" className="rounded-2xl border-white/5 bg-white/5">
                                            Open Console
                                        </IronButton>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] italic">
                                        <span className="text-gray-500">Fabrication Status</span>
                                        <span className="text-blue-400">{project.progress}% Complete</span>
                                    </div>
                                    <ProgressBar value={project.progress} showPercentage={false} />
                                    <div className="flex items-center gap-2 pt-2">
                                        <div className={cn(
                                            "size-2 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                                            project.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                                        )} />
                                        <span className="text-[10px] font-black uppercase tracking-widest italic text-gray-500">
                                            {project.status.toUpperCase()} — Last Update: {project.updatedAt?.toDate()?.toLocaleTimeString() || 'Just now'}
                                        </span>
                                    </div>
                                </div>
                            </GlassPanel>
                        ))
                    )}
                </div>

                {/* Intelligence & Network Core (Right) */}
                <div className="space-y-8">
                    <GlassPanel variant="glow" className="p-8 rounded-[2.5rem] border-blue-500/20 bg-gradient-to-br from-blue-600/5 to-transparent relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-40 transition-opacity">
                            <Activity className="size-24 text-blue-500" />
                        </div>
                        <div className="flex items-center gap-4 mb-8">
                            <div className="size-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                                <Zap className="text-white size-6" />
                            </div>
                            <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white">Devie Core</h3>
                        </div>

                        <div className="min-h-[100px] mb-8 relative z-10">
                            <p className="text-sm text-gray-400 italic leading-relaxed">
                                {aiResponse ? `"${aiResponse}"` : projects.length === 0
                                    ? "\"Protocol network is silent. I recommend initializing a new genesis to begin fabrication.\""
                                    : "\"Current fabrication velocity is optimal. Systems are primed for your next command.\""}
                            </p>
                        </div>

                        <form onSubmit={handleSendMessage} className="relative z-10 flex gap-2">
                            <Input
                                value={aiMessage}
                                onChange={(e) => setAiMessage(e.target.value)}
                                placeholder="Command Devie..."
                                className="bg-white/5 border-white/10 h-12 rounded-xl focus:border-blue-500/50 text-white italic"
                                disabled={isAiResponding}
                            />
                            <IronButton
                                type="submit"
                                variant="primary"
                                className="size-12 rounded-xl flex-shrink-0 flex items-center justify-center p-0"
                                disabled={isAiResponding}
                            >
                                {isAiResponding ? <Loader2 className="animate-spin size-5" /> : <Send size={18} />}
                            </IronButton>
                        </form>
                    </GlassPanel>

                    <GlassPanel variant="default" className="p-8 rounded-[2.5rem]">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Network Audit Stream</h3>
                        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            {auditLogs.length === 0 ? (
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-700 italic text-center py-4">No activity detected</p>
                            ) : (
                                auditLogs.map((log) => (
                                    <div key={log.id} className="flex gap-4 p-3 bg-white/2 border border-white/5 rounded-xl group hover:bg-white/5 transition-all">
                                        <div className={cn(
                                            "size-2 rounded-full mt-1.5 shrink-0",
                                            log.status === 'OK' ? 'bg-emerald-500' :
                                                log.status === 'ALERT' ? 'bg-red-500' : 'bg-amber-500'
                                        )} />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="text-[10px] font-black uppercase tracking-tight text-white italic">{log.event}</div>
                                                <div className="text-[8px] font-black uppercase text-gray-600">{log.timestamp?.toDate()?.toLocaleTimeString() || '00:00:00'}</div>
                                            </div>
                                            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">{log.node}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </GlassPanel>

                    <GlassPanel variant="default" className="p-8 rounded-[2.5rem]">
                        <h3 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">Network Organization</h3>
                        <div className="space-y-4">
                            {[
                                { label: 'Team Switcher', icon: LayoutGrid, desc: 'Enterprise Hub' },
                                { label: 'Group Fabricator', icon: Box, desc: 'Co-op Missions' },
                                { label: 'Bounty Ledger', icon: Lock, desc: 'Escrow Records', path: '/marketplace/bounties' }
                            ].map((item, i) => {
                                const Icon = item.icon as any;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => item.path && router.push(item.path)}
                                        className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl hover:bg-blue-500/5 hover:border-blue-500/20 transition-all cursor-pointer group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="size-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 group-hover:bg-blue-500/10 group-hover:border-blue-500/20 transition-all">
                                                <Icon size={18} className="text-gray-500 group-hover:text-blue-400" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-black italic text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">{item.label}</div>
                                                <div className="text-[9px] font-black uppercase tracking-widest text-gray-600">{item.desc}</div>
                                            </div>
                                        </div>
                                        <ChevronRight size={16} className="text-gray-700 group-hover:text-blue-500 transition-all" />
                                    </div>
                                );
                            })}
                        </div>
                    </GlassPanel>
                </div>
            </div>

            {/* New Project Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsModalOpen(false)}
                            className="absolute inset-0 bg-black/60 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative w-full max-w-lg"
                        >
                            <GlassPanel variant="glow" className="p-8 border-blue-500/30">
                                <div className="flex justify-between items-center mb-8">
                                    <div className="flex items-center gap-3">
                                        <div className="size-10 bg-blue-600 rounded-xl flex items-center justify-center">
                                            <Box className="text-white size-5" />
                                        </div>
                                        <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white">Initialize Genesis</h3>
                                    </div>
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="size-10 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center transition-colors"
                                    >
                                        <X className="text-gray-500" size={20} />
                                    </button>
                                </div>

                                <form onSubmit={handleCreateProject} className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 italic ml-1">Protocol Name</label>
                                        <Input
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                            placeholder="E.g. SaaS Payment Engine"
                                            required
                                            className="bg-white/5 border-white/10 h-12 rounded-xl focus:border-blue-500/50 text-white italic"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 italic ml-1">Mission Description</label>
                                        <Textarea
                                            value={projectDesc}
                                            onChange={(e) => setProjectDesc(e.target.value)}
                                            placeholder="Define the scope of this fabrication protocol..."
                                            className="bg-white/5 border-white/10 rounded-xl focus:border-blue-500/50 text-white italic min-h-[120px]"
                                        />
                                    </div>

                                    <div className="pt-4 flex gap-4">
                                        <IronButton
                                            type="button"
                                            onClick={() => setIsModalOpen(false)}
                                            variant="secondary"
                                            className="flex-1 h-14 rounded-2xl uppercase italic font-black"
                                        >
                                            Abort
                                        </IronButton>
                                        <IronButton
                                            type="submit"
                                            disabled={isCreating || !projectName.trim()}
                                            variant="primary"
                                            className="flex-[2] h-14 rounded-2xl uppercase italic font-black"
                                            icon={isCreating ? <Loader2 className="animate-spin size-5" /> : <Plus size={20} />}
                                        >
                                            {isCreating ? 'Synchronizing...' : 'Register Genesis'}
                                        </IronButton>
                                    </div>
                                </form>
                            </GlassPanel>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ClientDashboard;
