import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SCRATCH_PATH = '/Users/paco/.gemini/antigravity/scratch';
const PLAYGROUND_PATH = '/Users/paco/.gemini/antigravity/playground';
const MASTER_PATH = path.join(SCRATCH_PATH, 'discovermake-master');

const SOURCES = {
    discovermake: path.join(SCRATCH_PATH, 'discovermake'),
    agentManager: path.join(SCRATCH_PATH, 'agent-manager'),
    primeIntergalactic: path.join(PLAYGROUND_PATH, 'prime-intergalactic')
};

function log(msg: string) {
    console.log(`[MERGER] ${msg}`);
}

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function merge() {
    log("Starting Repo Consolidation...");

    // 1. Initialize Master Repo (Copy Base from discovermake)
    log(`Initializing master repo at ${MASTER_PATH} using discovermake as base...`);
    ensureDir(MASTER_PATH);

    // Node-native recursive copy with exclusions to avoid rsync/execSync issues
    fs.cpSync(SOURCES.discovermake, MASTER_PATH, {
        recursive: true,
        filter: (src) => {
            const relative = path.relative(SOURCES.discovermake, src);
            return !relative.includes('node_modules') && !relative.includes('.next') && !relative.includes('.git');
        }
    });
    log("Base repo copied.");

    // 2. Extract specific parts from prime-intergalactic
    log("Extracting Stripe and additional templates from prime-intergalactic...");
    const piStripe = path.join(SOURCES.primeIntergalactic, 'src/lib/stripe.ts');
    if (fs.existsSync(piStripe)) {
        fs.copyFileSync(piStripe, path.join(MASTER_PATH, 'src/lib/stripe.ts'));
        log("Added stripe.ts");
    }

    // Merge templates-db-clean using Node-native iteration to avoid "Argument list too long"
    const piTemplates = path.join(SOURCES.primeIntergalactic, 'templates-db-clean');
    const masterTemplates = path.join(MASTER_PATH, 'src/data/templates-db');
    ensureDir(masterTemplates);

    if (fs.existsSync(piTemplates)) {
        const files = fs.readdirSync(piTemplates).filter(f => f.endsWith('.json'));
        log(`Copying ${files.length} templates from prime-intergalactic...`);
        for (const file of files) {
            const dest = path.join(masterTemplates, file);
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(path.join(piTemplates, file), dest);
            }
        }
        log("Merged prime-intergalactic templates");
    }

    // 3. Extract specific parts from agent-manager
    log("Extracting requirements and templates from agent-manager...");
    const amRequirements = path.join(SOURCES.agentManager, 'requirements.md');
    const docsDir = path.join(MASTER_PATH, 'docs');
    ensureDir(docsDir);

    if (fs.existsSync(amRequirements)) {
        fs.copyFileSync(amRequirements, path.join(docsDir, 'requirements-manager.md'));
        log("Added requirements-manager.md");
    }

    const amTemplates = path.join(SOURCES.agentManager, 'templates-db-clean');
    if (fs.existsSync(amTemplates)) {
        const files = fs.readdirSync(amTemplates).filter(f => f.endsWith('.json'));
        log(`Copying ${files.length} templates from agent-manager...`);
        for (const file of files) {
            const dest = path.join(masterTemplates, file);
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(path.join(amTemplates, file), dest);
            }
        }
        log("Merged agent-manager templates");
    }

    log("Repo consolidation complete.");
    log(`Master repo located at: ${MASTER_PATH}`);
}

merge().catch(err => {
    console.error("Merger Failed:", err);
    process.exit(1);
});
