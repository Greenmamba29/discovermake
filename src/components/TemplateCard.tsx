import { useAuth } from "@/components/auth-provider";
import { useUserData } from "@/hooks/use-user-data";
import { toggleSavedTemplate } from "@/lib/firestore";
import { Heart, Star, Clock, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";

interface TemplateCardProps {
    template: any;
    index?: number;
}

export function TemplateCard({ template, index = 0 }: TemplateCardProps) {
    const { user } = useAuth();
    const { userData, refresh } = useUserData();

    const isSaved = userData?.saved_templates?.includes(template.slug);

    const handleToggleFavorite = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) return; // Maybe show a toast to login
        await toggleSavedTemplate(user.uid, template.slug);
        refresh();
    };
    return (
        <motion.div
        // ...
        >
            {/* Image Section */}
            <div className="relative h-48 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                {/* ... Image ... */}
                <Image
                    src={template.coverImage}
                    alt={template.name}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent opacity-60" />

                {/* Favorite Button */}
                <button
                    onClick={handleToggleFavorite}
                    className={`absolute top-3 left-3 z-20 p-2 rounded-full backdrop-blur-md border transition-all duration-300 ${isSaved
                        ? "bg-pink-500 border-pink-400 text-white shadow-lg shadow-pink-500/30"
                        : "bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60"
                        }`}
                >
                    <Heart className={`w-4 h-4 ${isSaved ? "fill-white" : ""}`} />
                </button>

                {/* Apps Icons (New Logic) */}
                <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-1.5 max-w-[70%]">
                    {/* Combine requiredServices + tags, dedupe, and slice to max 3-4 to avoid crowding */}
                    {Array.from(new Set([...(template.requiredServices || []), ...(template.tags || [])]))
                        .filter(tag => !['Automation', 'Make.com'].includes(tag)) // Filter generic tags
                        .slice(0, 4)
                        .map(app => (
                            <AppIcon key={app} app={app} />
                        ))}
                </div>

                {/* Time Wealth Badge */}
                <div className="absolute bottom-4 left-4">
                    <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                        <Clock className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs font-semibold text-white">
                            Saves <span className="text-green-400">{template.monthlyHoursSaved || 5}h</span> / mo
                        </span>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <div className="p-5 space-y-4">
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-lg text-slate-900 dark:text-white line-clamp-1 group-hover:text-blue-500 transition-colors">
                            {template.name}
                        </h3>
                        <div className="flex items-center gap-1 text-amber-500 text-xs font-bold">
                            <Star className="w-3 h-3 fill-amber-500" />
                            {template.averageRating}
                        </div>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 h-10">
                        {template.shortDescription}
                    </p>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="flex -space-x-2">
                        {/* Mock user avatars who saved time */}
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white dark:border-slate-900" />
                        ))}
                    </div>
                    <span>used by 120+ makers</span>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <span className="text-xs text-slate-400 block">Price</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                            {template.price === 0 ? "Free" : `$${template.price}`}
                        </span>
                    </div>

                    <Link href={`/templates/${template.slug}`}>
                        <button className="flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity">
                            View Details <ArrowRight className="w-4 h-4" />
                        </button>
                    </Link>
                </div>
            </div>
        </motion.div>
    );
}
