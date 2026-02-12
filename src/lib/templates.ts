import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Template } from '@/types';

const TEMPLATES_DIR = path.join(process.cwd(), 'templates-db');

const PREMIUM_COVERS: Record<string, string> = {
    // Marketing / Social
    'facebook': '/images/covers/nano_marketing.png',
    'instagram': '/images/covers/nano_marketing.png',
    'tiktok': '/images/covers/nano_marketing.png',
    'linkedin': '/images/covers/nano_marketing.png',
    'marketing': '/images/covers/nano_marketing.png',
    'outreach': '/images/covers/nano_marketing.png',

    // Productivity / Workflow
    'trello': '/images/covers/nano_productivity.png',
    'asana': '/images/covers/nano_productivity.png',
    'notion': '/images/covers/nano_productivity.png',
    'slack': '/images/covers/nano_productivity.png',
    'task': '/images/covers/nano_productivity.png',
    'email': '/images/covers/nano_productivity.png',
    'calendar': '/images/covers/nano_productivity.png',

    // Data / Tech
    'sheet': '/images/covers/nano_data.png',
    'excel': '/images/covers/nano_data.png',
    'airtable': '/images/covers/nano_data.png',
    'database': '/images/covers/nano_data.png',
    'mysql': '/images/covers/nano_data.png',
    'webhook': '/images/covers/nano_data.png',
    'api': '/images/covers/nano_data.png',
    'json': '/images/covers/nano_data.png',
    'egnyte': '/images/covers/nano_data.png'
};

function getPremiumCoverImage(slug: string): string {
    // 1. Check direct keyword match in slug
    for (const [key, url] of Object.entries(PREMIUM_COVERS)) {
        if (slug.toLowerCase().includes(key)) {
            return url;
        }
    }

    // 2. Fallback to random rotation based on length (deterministic)
    const fallbacks = [
        '/images/covers/nano_marketing.png',
        '/images/covers/nano_productivity.png',
        '/images/covers/nano_data.png'
    ];
    // Simple hash to simulate random but consistent assignment
    const index = slug.length % fallbacks.length;
    return fallbacks[index];
}

// Helper to map raw JSON to our Template type with defaults
function mapJsonToTemplate(slug: string, raw: any): Template {
    // MVP "Intelligence": Estimate time saved based on complexity or random for "Time Wealth" features
    const estimatedMinutesSaved = raw.minutesSaved || Math.floor(Math.random() * (480 - 30 + 1)) + 30; // Random between 30 mins and 8 hours if missing
    const hoursSaved = Math.round((estimatedMinutesSaved / 60) * 10) / 10;

    return {
        id: raw.id ? String(raw.id) : slug,
        name: raw.name || slug.replace(/-/g, ' '),
        slug: slug,
        shortDescription: raw.description ? raw.description.substring(0, 150) + "..." : "Automate your workflow with this Make.com blueprint.",
        fullDescription: raw.description ? `# ${raw.name}\n\n${raw.description}` : "No description available.",
        category: raw.category || "Automation",
        price: raw.price || 0,
        complexity: raw.usage > 1000 ? 'Advanced' : (raw.usage > 100 ? 'Intermediate' : 'Beginner'), // Infer availability
        aiModels: raw.aiModels || ['GPT-4o'], // Default to current tech
        requiredServices: raw.usedApps || ['Make.com'],
        setupTime: raw.setupTime || 15,
        coverImage: getPremiumCoverImage(slug) || raw.coverImage || "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=1974&auto=format&fit=crop",
        screenshots: raw.screenshots || [],
        tags: ["Make.com", "Automation", ...(raw.usedApps || [])],
        totalSales: raw.usage || 0,
        averageRating: 4.8, // MVP Optimism
        affiliateLinks: {
            make: "https://make.com/ref"
        },
        // Custom fields for "Time Wealth"
        monthlyHoursSaved: hoursSaved,
        revenuePotential: hoursSaved * 50 // Assume $50/hr value
    };
}

const INDEX_FILE = path.join(TEMPLATES_DIR, 'index.json');

let cachedIndex: any[] | null = null;

export async function getAllTemplates(
    page: number = 1,
    limit: number = 24,
    search?: string,
    category?: string,
    complexity?: string
): Promise<{ templates: Template[], total: number }> {
    try {
        if (!existsSync(INDEX_FILE)) {
            return { templates: [], total: 0 };
        }

        if (!cachedIndex) {
            const content = await fs.readFile(INDEX_FILE, 'utf-8');
            cachedIndex = JSON.parse(content);
        }

        let filtered = cachedIndex || [];

        // Apply filters
        if (category && category !== "All") {
            filtered = filtered.filter(item => item.category === category);
        }
        if (complexity) {
            filtered = filtered.filter(item => item.complexity === complexity);
        }
        if (search) {
            const query = search.toLowerCase();
            filtered = filtered.filter(item =>
                item.name?.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query) ||
                item.slug?.toLowerCase().includes(query)
            );
        }

        const total = filtered.length;
        const start = (page - 1) * limit;
        const paginated = filtered.slice(start, start + limit);

        return {
            templates: paginated.map((item: any) => mapJsonToTemplate(item.slug, item)),
            total
        };
    } catch (e) {
        console.error("Error reading template index:", e);
        return { templates: [], total: 0 };
    }
}

export async function getTemplateBySlug(slug: string): Promise<Template | null> {
    try {
        const filePath = path.join(TEMPLATES_DIR, `${slug}.json`);
        if (!existsSync(filePath)) return null;

        const content = await fs.readFile(filePath, 'utf-8');
        const json = JSON.parse(content);
        return mapJsonToTemplate(slug, json);
    } catch (e) {
        console.error(`Error reading template ${slug}:`, e);
        return null;
    }
}

// Special function to get the raw JSON content for the visualizer
export async function getTemplateJson(slug: string): Promise<any | null> {
    try {
        const filePath = path.join(TEMPLATES_DIR, `${slug}.json`);
        if (!existsSync(filePath)) return null;
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return null;
    }
}
