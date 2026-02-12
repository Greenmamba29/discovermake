
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.join(process.cwd(), 'src/data/templates');

console.time('Read Dir');
if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error("Directory missing");
    process.exit(1);
}
const allFiles = fs.readdirSync(TEMPLATES_DIR);
console.timeEnd('Read Dir');
console.log(`Found ${allFiles.length} files`);

console.time('Filter and Slice');
const files = allFiles.filter(f => f.endsWith('.json')).slice(0, 50);
console.timeEnd('Filter and Slice');

console.time('Read Content');
for (const file of files) {
    fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
}
console.timeEnd('Read Content');
