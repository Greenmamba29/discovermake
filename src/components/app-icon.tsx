import {
    Mail,
    MessageSquare,
    Sheet,
    Database,
    Calendar,
    Video,
    ShoppingCart,
    CreditCard,
    Globe,
    Zap,
    Cpu,
    Cloud,
    Slack,
    Github,
    Trello
} from "lucide-react";
import { cn } from "@/lib/utils";

// Map normalized app names to specific Lucide icons or generic fallbacks
const APP_ICONS: Record<string, any> = {
    // Communication & Social
    'slack': Slack,
    'discord': MessageSquare,
    'email': Mail,
    'gmail': Mail,
    'outlook': Mail,
    'whatsapp': MessageSquare,
    'telegram': MessageSquare,

    // Productivity
    'notion': Database,
    'trello': Trello,
    'asana': Calendar,
    'clickup': Calendar,
    'google-calendar': Calendar,
    'calendar': Calendar,

    // Data & Sheets
    'google-sheets': Sheet,
    'excel': Sheet,
    'airtable': Database,
    'mysql': Database,
    'postgres': Database,

    // Tech & Dev
    'openai': Cpu,
    'chatgpt': Cpu,
    'github': Github,
    'gitlab': Github,
    'webhook': Zap,
    'http': Globe,

    // E-commerce
    'shopify': ShoppingCart,
    'stripe': CreditCard,
    'woo': ShoppingCart
};

const APP_COLORS: Record<string, string> = {
    'slack': 'bg-[#E01E5A] text-white',
    'gmail': 'bg-[#EA4335] text-white',
    'notion': 'bg-black text-white',
    'google-sheets': 'bg-[#34A853] text-white',
    'airtable': 'bg-[#F82B60] text-white',
    'openai': 'bg-[#10A37F] text-white',
    'stripe': 'bg-[#635BFF] text-white',
    'shopify': 'bg-[#96BF48] text-white',
    'default': 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
};

interface AppIconProps {
    app: string;
    className?: string;
    showLabel?: boolean;
}

export function AppIcon({ app, className, showLabel = false }: AppIconProps) {
    const normalized = app.toLowerCase().replace(/\s+/g, '-');
    const Icon = APP_ICONS[normalized] || Zap; // Default to Zap/Bolt for generic app

    // Determine color class: check direct match or fallback
    let colorClass = APP_COLORS['default'];
    for (const key in APP_COLORS) {
        if (normalized.includes(key) && key !== 'default') {
            colorClass = APP_COLORS[key];
            break;
        }
    }

    return (
        <div className={cn("flex items-center gap-1.5", className)} title={app}>
            <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shadow-sm", colorClass)}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            {showLabel && <span className="text-xs font-medium text-slate-700 dark:text-slate-300 capitalize">{app}</span>}
        </div>
    );
}
