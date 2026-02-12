
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.join(process.cwd(), 'templates-db');
const INDEX_FILE = path.join(process.cwd(), 'templates-db', 'index.json');

// Helper to sanitize text for index
function clean(str: string) {
    return str ? str.replace(/\s+/g, ' ').trim() : '';
}

async function generateIndex() {
    console.log("🔍 Scanning templates...");

    if (!fs.existsSync(TEMPLATES_DIR)) {
        console.error("❌ Templates directory not found at " + TEMPLATES_DIR);
        return;
    }

    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
    const index = [];

    let count = 0;
    for (const file of files) {
        try {
            // Read only enough to parse - actually we have to parse the whole JSON to be safe
            // but these files are small < 10KB mostly.
            const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
            const json = JSON.parse(content);

            const slug = file.replace('.json', '');

            // Minimal data for listing/search
            index.push({
                id: json.id || slug,
                name: json.name || slug,
                slug: slug,
                description: clean(json.description).substring(0, 150), // Truncate for index size
                category: json.category || "Automation",
                price: 0,
                // Add tags if available for search
                tags: json.tags || []
            });
            count++;
            if (count % 1000 === 0) console.log(`Processed ${count} templates...`);

        } catch (e) {
            console.error(`Error processing ${file}:`, e);
        }
    }

    console.log(`💾 Writing index with ${index.length} items...`);
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index)); // Minified
    console.log(`✅ Index generated at ${INDEX_FILE} (${(fs.statSync(INDEX_FILE).size / 1024 / 1024).toFixed(2)} MB)`);
}

generateIndex();
