
import fs from 'fs';
import path from 'path';

// REGIONS to try
const REGIONS = ['us1', 'us2', 'eu1', 'eu2'];
const OUTPUT_DIR = path.join(process.cwd(), 'src/data/templates');
const CREDS_FILE = path.join(process.cwd(), 'make-creds.json');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function loadCredentials() {
    if (!fs.existsSync(CREDS_FILE)) {
        console.error(`Missing credentials file: ${CREDS_FILE}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
}

async function scrapeAllTemplates() {
    const headers = await loadCredentials();

    // 1. Detect Region
    let activeRegion = '';
    console.log("🌍 Detecting active Make.com region...");

    for (const region of REGIONS) {
        const base = `https://${region}.make.com`;
        const testUrl = `${base}/api/v2/templates/public?limit=1`;

        try {
            // console.log(`Testing connection to ${region}...`);
            const response = await fetch(testUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': `${base}/templates`,
                    'Origin': base,
                    ...headers
                }
            });

            if (response.ok) {
                activeRegion = region;
                console.log(`✅ Success! Active region detected: ${region.toUpperCase()}`);
                break;
            } else if (response.status === 401) {
                // console.log(`❌ ${region}: 401 Unauthorized`);
            }
        } catch (e) {
            // console.log(`❌ ${region}: Network Error`);
        }
    }

    if (!activeRegion) {
        console.error("\n❌ Authentication Failed in ALL regions.");
        console.error("Please double-check your 'Cookie' in make-creds.json.");
        process.exit(1);
    }

    // 2. Start Scraping
    const API_BASE_URL = `https://${activeRegion}.make.com/api/v2/templates/public`;
    const base = `https://${activeRegion}.make.com`;
    let offset = 0;
    const limit = 50;
    let totalFetched = 0;
    let keepFetching = true;

    console.log(`🚀 Starting Bulk Scrape from ${activeRegion.toUpperCase()}...`);

    while (keepFetching) {
        const url = `${API_BASE_URL}?limit=${limit}&offset=${offset}&includeEn=true`;
        process.stdout.write(`Fetching offset ${offset}... `);

        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': `${base}/templates`,
                    'Origin': base,
                    ...headers
                }
            });

            if (!response.ok) {
                console.log(`\n❌ Error ${response.status}: ${response.statusText}`);
                keepFetching = false;
                break;
            }

            const data = await response.json();
            const templates = data.templatesPublic || [];

            if (templates.length === 0) {
                console.log("\n✅ Done! No more templates.");
                keepFetching = false;
                break;
            }

            const batchFile = path.join(OUTPUT_DIR, `batch_${offset}.json`);
            fs.writeFileSync(batchFile, JSON.stringify(templates, null, 2));

            totalFetched += templates.length;
            offset += limit;

            console.log(`Saved ${templates.length} items. (Total: ${totalFetched})`);

            // Sleep to be nice
            await new Promise(r => setTimeout(r, 500));

        } catch (error) {
            console.error("\n❌ Network Error:", error);
            keepFetching = false;
        }
    }
}

scrapeAllTemplates();
