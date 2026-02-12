
import fs from 'fs';
import path from 'path';

// Define paths
const RAW_FILE_PATH = path.join(process.cwd(), 'templates_raw.json');
const OUTPUT_DIR = path.join(process.cwd(), 'templates-db');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Check source file
if (!fs.existsSync(RAW_FILE_PATH)) {
    console.error(`❌ Source file not found: ${RAW_FILE_PATH}`);
    process.exit(1);
}

// Define interface for the scraped object
interface ScrapedTemplate {
    id: number | string;
    name: string;
    description?: string;
    // Add other fields you expect from Make.com scraping
    // For now we trust the structure is valid Make scenario JSON or meta-wrapper
    [key: string]: any;
}

// Slugify helper
function slugify(text: string) {
    return text
        .toString()
        .toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
}

// Main logic
async function importData() {
    console.log("🚀 Starting import process...");

    try {
        const rawContent = fs.readFileSync(RAW_FILE_PATH, 'utf-8');
        let templates: ScrapedTemplate[] = [];

        // Try to parse - handle both Array and Single Wrapper Object
        const parsed = JSON.parse(rawContent);
        if (Array.isArray(parsed)) {
            templates = parsed;
        } else if (parsed.templates) {
            templates = parsed.templates;
        } else if (parsed.scenarios) {
            templates = parsed.scenarios;
        } else {
            // Fallback: assume the object itself is a single template or list wrapper
            // If it's a map/object of templates, we might need iteration
            templates = Object.values(parsed);
        }

        console.log(`📦 Found ${templates.length} templates to process.`);

        let successCount = 0;

        for (const template of templates) {
            if (!template.name) continue;

            const filename = `${slugify(template.name)}.json`;
            const filePath = path.join(OUTPUT_DIR, filename);

            // Write individual file
            fs.writeFileSync(filePath, JSON.stringify(template, null, 2));
            successCount++;
        }

        console.log(`✅ Successfully imported ${successCount} templates to ${OUTPUT_DIR}`);

    } catch (error) {
        console.error("❌ Error parsing/saving templates:", error);
    }
}

importData();
