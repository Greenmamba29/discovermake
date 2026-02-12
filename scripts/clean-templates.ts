
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.join(process.cwd(), 'templates-db');
const DEST_DIR = path.join(process.cwd(), 'templates-db-clean');

// Keys to strip or anonymize
const SENSITIVE_KEYS = [
    'webhookId',
    'connectionId',
    //'email', // Sometimes useful for context, but often PII in examples
    'hook',    // Often contains specific hook IDs
    'connection',
    'pgpKey',
    'password',
    'token',
    'apiKey'
];

// Helper to recursively clean object
function cleanObject(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(cleanObject);
    } else if (obj !== null && typeof obj === 'object') {
        const newObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (SENSITIVE_KEYS.includes(key)) {
                // Replace with generic placeholder
                newObj[key] = `{{${key.toUpperCase()}}}`;
            } else if (typeof value === 'string' && (value.includes('hooks.make.com') || value.includes('integromat.com'))) {
                // Anonymize webhook URLs
                newObj[key] = "https://hook.make.com/generic-webhook-placeholder";
            } else {
                newObj[key] = cleanObject(value);
            }
        }
        return newObj;
    }
    return obj;
}

async function run() {
    if (!fs.existsSync(DEST_DIR)) {
        fs.mkdirSync(DEST_DIR, { recursive: true });
    }

    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.json'));
    console.log(`🧹 Cleaning ${files.length} templates...`);

    let count = 0;
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8');
            const json = JSON.parse(content);
            const cleaned = cleanObject(json);

            // Minify to save space for AI ctx
            fs.writeFileSync(path.join(DEST_DIR, file), JSON.stringify(cleaned));
            count++;
        } catch (e) {
            console.error(`Error processing ${file}:`, e);
        }
    }

    console.log(`✨ Successfully cleaned ${count} templates to ${DEST_DIR}`);
}

run();
