
import { getTemplateBySlug, getTemplateJson } from '../src/lib/templates';
import path from 'path';
import fs from 'fs';

// Quick path verification since we moved directories
const TEMPLATES_DIR = path.join(process.cwd(), 'templates-db');
console.log(`Templates DB Path: ${TEMPLATES_DIR}`);
console.log(`Exists: ${fs.existsSync(TEMPLATES_DIR)}`);
console.log(`Contents count: ${fs.readdirSync(TEMPLATES_DIR).length}`);

async function test() {
    console.log("Testing getTemplateBySlug...");
    const t = await getTemplateBySlug('youtube-automation');
    console.log(`Result: ${t ? 'Found' : 'Not Found'}`);
    if (t) console.log(`Name: ${t.name}`);

    console.log("Testing getTemplateJson...");
    const j = await getTemplateJson('youtube-automation');
    console.log(`JSON Result: ${j ? 'Found' : 'Not Found'}`);
}

test();
