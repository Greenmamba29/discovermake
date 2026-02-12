import 'dotenv/config'; // Load env vars
import fs from 'fs';
import path from 'path';
import { notion, NOTION_DB_ID, getRichText, getTitle, getMultiSelect } from '../src/lib/notion';

const TEMPLATES_DIR = path.join(process.cwd(), 'templates-db');

async function syncNotionToLocal() {
    console.log("🔄 Starting Notion Sync...");
    console.log(`📂 Target Directory: ${TEMPLATES_DIR}`);

    try {
        let hasMore = true;
        let cursor: string | undefined = undefined;
        let count = 0;

        while (hasMore) {
            const response: any = await notion.databases.query({
                database_id: NOTION_DB_ID!,
                start_cursor: cursor,
            });

            for (const page of response.results) {
                const props = page.properties;

                // 1. Extract ID (Critical for matching)
                // Assuming "ID" property exists in Notion is number or text
                let id: string | number = "";
                if (props.ID?.type === 'number') id = props.ID.number;
                else if (props.ID?.type === 'rich_text') id = getRichText(props.ID.rich_text);
                else if (props.ID?.type === 'title') id = getTitle(props.ID.title);

                if (!id) {
                    console.warn(`⚠️ Skipping page ${page.id}: Missing 'ID' property.`);
                    continue;
                }

                // 2. Extract Data
                const name = props.Name ? getTitle(props.Name.title) : `Template ${id}`;
                const description = props.Description ? getRichText(props.Description.rich_text) : "";
                const price = props.Price?.number || 0;
                const usedApps = props.Apps ? getMultiSelect(props.Apps.multi_select) : [];
                const slug = props.Slug ? getRichText(props.Slug.rich_text) : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

                // Cover Image (Notion Page Cover or Property)
                let coverImage = "";
                if (page.cover?.type === 'external') coverImage = page.cover.external.url;
                else if (page.cover?.type === 'file') coverImage = page.cover.file.url;

                // 3. Construct Template Object
                const templateData = {
                    id: String(id), // Normalize to string
                    name,
                    description,
                    usage: props.Usage?.number || 0, // Sync usage count if available
                    price,
                    usedApps,
                    url: `${id}-${slug}`, // Legacy ID-Slug format
                    coverImage,
                    minutedSaved: props.MinutesSaved?.number || 60,
                    setupTime: props.SetupTime?.number || 15
                };

                // 4. Write to File (Cross-Sync Logic)
                // If it exists, we overwrite. If not, we create.
                // We use the ID to find the file if possible, or just standard filename
                const filename = `${slug}.json`; // Prefer slug-based filename for SEO
                const filepath = path.join(TEMPLATES_DIR, filename);

                // Check if a file with this ID already exists under a different name?
                // For MVP, we just write to slug.json. 
                // Advanced: could grep directory for `"id": ${id}` but let's stick to slug matching for now.

                const existingData = fs.existsSync(filepath) ? JSON.parse(fs.readFileSync(filepath, 'utf8')) : {};

                // Merge: Notion is source of truth, but keep existing generated fields if Notion is empty?
                // Enforce Notion authority:
                const mergedData = { ...existingData, ...templateData };

                fs.writeFileSync(filepath, JSON.stringify(mergedData, null, 2));
                console.log(`✅ Synced: ${name} (${id}) -> ${filename}`);
                count++;
            }

            hasMore = response.has_more;
            cursor = response.next_cursor || undefined;
        }

        console.log(`\n🎉 Sync Complete! Processed ${count} templates.`);

        // Re-generate index.json
        console.log("Recalculating index...");
        const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
        const indexData = files.map(f => {
            const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8'));
            return {
                id: t.id,
                name: t.name,
                slug: f.replace('.json', ''),
                description: t.description,
                price: t.price,
                usedApps: t.usedApps,
                coverImage: t.coverImage
            };
        });
        fs.writeFileSync(path.join(TEMPLATES_DIR, 'index.json'), JSON.stringify(indexData, null, 2));
        console.log("Index updated.");

    } catch (error) {
        console.error("❌ Sync Failed:", error);
    }
}

syncNotionToLocal();
