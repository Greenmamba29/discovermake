export interface Template {
    id: string;
    name: string;
    slug: string;
    shortDescription: string;
    fullDescription: string; // Markdown
    category: string;
    price: number;
    salePrice?: number;
    complexity: 'Beginner' | 'Intermediate' | 'Advanced';
    aiModels: string[]; // 'Claude' | 'GPT-4' | 'Gemini'
    requiredServices: string[]; // 'Make.com' | 'Apify' | etc.
    setupTime: number; // minutes
    hoursSaved?: number; // per automation run
    monthlyHoursSaved?: number; // Total estimated per month
    revenuePotential?: number;
    coverImage: string;
    screenshots: string[];
    tags: string[];
    totalSales: number;
    averageRating: number;
    badges?: ('new' | 'bestseller' | 'trending')[];
    affiliateLinks: {
        make: string;
        apify?: string;
        others?: Record<string, string>;
    };
}

export interface User {
    id: string;
    email: string;
    fullName: string;
    subscriptionTier?: 'monthly' | 'annual';
}

export interface CartItem {
    type: 'template' | 'bundle' | 'subscription';
    id: string;
    name: string;
    price: number;
    quantity: number;
}
