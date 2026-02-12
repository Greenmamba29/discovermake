import { Template } from "@/types";

export const MOCK_TEMPLATES: Template[] = [
    {
        id: "t1",
        name: "YouTube Automation Agent",
        slug: "youtube-automation-agent",
        shortDescription: "Automatically generate video ideas, scripts, and schedule posts based on trending topics.",
        fullDescription: `
# YouTube Automation Agent

Stop spending hours researching what to post. This agent does it for you.

## Features
- 🔍 Trends Analysis using Apify
- 📝 Script Generation using Claude 3 Opus
- 📅 Auto-scheduling to YouTube Studio

## Requirements
- Make.com Pro
- Apify Account
- Anthropic API Key
    `,
        category: "Content Creation",
        price: 49.99,
        salePrice: 29.99,
        complexity: "Intermediate",
        aiModels: ["Claude 3", "GPT-4o"],
        requiredServices: ["Make.com", "Apify", "Claude API"],
        setupTime: 15,
        hoursSaved: 18,
        revenuePotential: 2000, // Monthly
        coverImage: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=1974&auto=format&fit=crop",
        screenshots: [],
        tags: ["YouTube", "Automation", "Content"],
        totalSales: 342,
        averageRating: 4.8,
        badges: ["bestseller", "trending"],
        affiliateLinks: {
            make: "https://make.com/ref",
            apify: "https://apify.com/ref"
        }
    },
    {
        id: "t2",
        name: "SEO Blog Post Writer 2.0",
        slug: "seo-blog-writer",
        shortDescription: "Write 2,000+ word human-quality articles that rank on Google.",
        fullDescription: "...",
        category: "Marketing",
        price: 39.99,
        complexity: "Beginner",
        aiModels: ["GPT-4o"],
        requiredServices: ["Make.com", "OpenAI API", "Wordpress"],
        setupTime: 10,
        hoursSaved: 12,
        coverImage: "https://images.unsplash.com/photo-1542435503-956c469947f6?q=80&w=1974&auto=format&fit=crop",
        screenshots: [],
        tags: ["SEO", "Writing", "Wordpress"],
        totalSales: 125,
        averageRating: 4.6,
        badges: ["new"],
        affiliateLinks: {
            make: "https://make.com/ref"
        }
    },
    {
        id: "t3",
        name: "Customer Support Triager",
        slug: "support-triager",
        shortDescription: "Auto-label and draft responses to fresh Zendesk tickets using AI.",
        fullDescription: "...",
        category: "Customer Support",
        price: 79.99,
        complexity: "Advanced",
        aiModels: ["Claude 3 Haiku"],
        requiredServices: ["Make.com", "Zendesk", "Claude API"],
        setupTime: 30,
        hoursSaved: 40,
        coverImage: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=2070&auto=format&fit=crop",
        screenshots: [],
        tags: ["Support", "Zendesk"],
        totalSales: 56,
        averageRating: 4.9,
        affiliateLinks: {
            make: "https://make.com/ref"
        }
    },
    {
        id: "t4",
        name: "Finance & Receipt Organizer",
        slug: "finance-organizer",
        shortDescription: "Scan email receipts and categorize them into Google Sheets automatically.",
        fullDescription: "...",
        category: "Financial Automation",
        price: 19.99,
        complexity: "Beginner",
        aiModels: ["GPT-3.5"],
        requiredServices: ["Make.com", "Gmail", "Google Sheets"],
        setupTime: 5,
        hoursSaved: 4,
        coverImage: "https://images.unsplash.com/photo-1554224155-98406858d0dc?q=80&w=2072&auto=format&fit=crop",
        screenshots: [],
        tags: ["Finance", "Productivity"],
        totalSales: 890,
        averageRating: 4.7,
        badges: ["bestseller"],
        affiliateLinks: {
            make: "https://make.com/ref"
        }
    },
    {
        id: "t5",
        name: "Lead Research Agent",
        slug: "lead-researcher",
        shortDescription: "Enrich Apollo leads with personalized LinkedIn intros.",
        fullDescription: "...",
        category: "Sales",
        price: 59.99,
        complexity: "Intermediate",
        aiModels: ["Gemini 1.5 Pro"],
        requiredServices: ["Make.com", "Apollo", "LinkedIn"],
        setupTime: 20,
        hoursSaved: 25,
        coverImage: "https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=2074&auto=format&fit=crop",
        screenshots: [],
        tags: ["Sales", "Research"],
        totalSales: 45,
        averageRating: 4.5,
        badges: ["new"],
        affiliateLinks: {
            make: "https://make.com/ref"
        }
    },
    {
        id: "t6",
        name: "Podcast Repurposer",
        slug: "podcast-repurposer",
        shortDescription: "Turn one audio file into 10 social posts, 2 blogs, and a newsletter.",
        fullDescription: "...",
        category: "Content Creation",
        price: 35.00,
        complexity: "Intermediate",
        aiModels: ["Claude 3 Opus"],
        requiredServices: ["Make.com", "Google Drive"],
        setupTime: 15,
        hoursSaved: 10,
        coverImage: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?q=80&w=2070&auto=format&fit=crop",
        screenshots: [],
        tags: ["Podcast", "Content"],
        totalSales: 210,
        averageRating: 4.8,
        affiliateLinks: {
            make: "https://make.com/ref"
        }
    }
];

export async function getTemplates() {
    return MOCK_TEMPLATES;
}

export async function getTemplateBySlug(slug: string) {
    return MOCK_TEMPLATES.find((t) => t.slug === slug) || null;
}
