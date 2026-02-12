import fs from 'fs';
import path from 'path';

// Target the public marketing page, not the app API
const PUBLIC_URL = 'https://www.make.com/en/templates';

async function fetchTemplates() {
    console.log(`Fetching public HTML from ${PUBLIC_URL}...`);

    try {
        const response = await fetch(PUBLIC_URL);

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            return;
        }

        const html = await response.text();
        console.log(`Received HTML (${html.length} chars)`);

        // Look for Next.js hydration data
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);

        if (match && match[1]) {
            const json = JSON.parse(match[1]);
            console.log('Found __NEXT_DATA__!');

            const outputPath = path.join(process.cwd(), 'src/data/templates/public_scrape.json');
            fs.writeFileSync(outputPath, JSON.stringify(json, null, 2));
            console.log(`Saved scraped data to ${outputPath}`);

            // Try to find the templates array within the deep JSON structure
            // Usually props.pageProps...
            console.log("Keys in data:", Object.keys(json.props?.pageProps || {}));
        } else {
            console.log('No __NEXT_DATA__ found. Checking for other patterns...');
            const otherMatch = html.match(/window\.__INITIAL_STATE__=(.+?);/);
            if (otherMatch) {
                console.log("Found window.__INITIAL_STATE__");
            }
        }

    } catch (error) {
        console.error('Fetch failed:', error);
    }
}

fetchTemplates();
