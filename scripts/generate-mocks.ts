
import fs from 'fs';
import path from 'path';

const CATEGORIES = ['Marketing', 'Sales', 'IT', 'HR', 'Finance', 'Productivity'];
const APPS = ['Notion', 'Slack', 'Airtable', 'Gmail', 'OpenAI', 'HubSpot', 'Shopify', 'Stripe', 'Discord', 'Google Sheets'];
const ACTIONS = ['Watch', 'Create', 'Update', 'Delete', 'Search', 'List'];

function getRandomItem(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateMockTemplate(id: number) {
    const app1 = getRandomItem(APPS);
    const app2 = getRandomItem(APPS);
    const app3 = getRandomItem(APPS);

    return {
        id: `mock-${id}`,
        name: `Auto-Sync ${app1} to ${app2} with AI Analysis`,
        description: `Automatically watch for new items in ${app1}, analyze content using ${app3} AI, and sync results to ${app2}.`,
        category: getRandomItem(CATEGORIES),
        apps: [app1, app2, app3],
        stats: {
            downloads: Math.floor(Math.random() * 5000) + 100,
            rating: (Math.floor(Math.random() * 15) + 35) / 10, // 3.5 to 5.0
        },
        flow: [
            { id: 1, module: `${app1.toLowerCase()}:watchItems`, name: `Watch ${app1}` },
            { id: 2, module: `${app3.toLowerCase()}:analyze`, name: `Analyze with ${app3}` },
            { id: 3, module: `${app2.toLowerCase()}:createItem`, name: `Create ${app2} Record` }
        ]
    };
}

const mocks = Array.from({ length: 50 }, (_, i) => generateMockTemplate(i + 1));
const outputPath = path.join(process.cwd(), 'src/data/templates/mock_database.json');

// Ensure dir exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(outputPath, JSON.stringify(mocks, null, 2));

console.log(`Generated 50 mock templates at ${outputPath}`);
