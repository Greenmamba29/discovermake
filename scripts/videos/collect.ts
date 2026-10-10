/**
 * Collect recordings into watchable MP4s (H.264, web-ready) under videos/:
 *   - onboarding tours: videos/raw/onboarding/<name>.webm  -> videos/onboarding/<name>.mp4
 *   - test runs (`bun run videos:tests`): videos/raw/tests/<test>/**.webm -> videos/tests/<test>[-n].mp4
 * and write videos/manifest.json (file, title, kind, seconds, bytes). Needs ffmpeg + ffprobe.
 *
 *   bun run videos:collect
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'videos');

type Entry = { kind: 'onboarding' | 'test'; file: string; title: string; seconds: number; bytes: number };

function encode(src: string, dest: string) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', dest]);
}

function seconds(file: string): number {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim();
    return Math.round(Number(out) || 0);
}

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.webm') ? [path.join(dir, d.name)] : []));
}

const titleOf = (slug: string) => slug.replace(/-/g, ' ').replace(/\b(\d+)\b/, '$1 ·').replace(/^\w/, (c) => c.toUpperCase());

const entries: Entry[] = [];

// Onboarding tours.
const rawTours = path.join(OUT, 'raw', 'onboarding');
for (const src of fs.existsSync(rawTours) ? fs.readdirSync(rawTours).filter((f) => f.endsWith('.webm')).sort() : []) {
    const name = src.replace(/\.webm$/, '');
    const dest = path.join(OUT, 'onboarding', `${name}.mp4`);
    encode(path.join(rawTours, src), dest);
    entries.push({ kind: 'onboarding', file: path.relative(OUT, dest), title: titleOf(name), seconds: seconds(dest), bytes: fs.statSync(dest).size });
}

// Test runs: one folder per test (and project); several videos when a test drives several windows.
const results = path.join(OUT, 'raw', 'tests');
for (const dir of fs.existsSync(results) ? fs.readdirSync(results, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []) {
    const videos = walk(path.join(results, dir))
        .map((f) => ({ f, t: fs.statSync(f).birthtimeMs || fs.statSync(f).mtimeMs, size: fs.statSync(f).size }))
        .filter((v) => v.size > 20_000) // skip blank windows that closed immediately
        .sort((a, b) => a.t - b.t);
    videos.forEach((v, i) => {
        const dest = path.join(OUT, 'tests', `${dir}${videos.length > 1 ? `-${i + 1}` : ''}.mp4`);
        encode(v.f, dest);
        entries.push({ kind: 'test', file: path.relative(OUT, dest), title: `${dir}${videos.length > 1 ? ` (window ${i + 1})` : ''}`, seconds: seconds(dest), bytes: fs.statSync(dest).size });
    });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(entries, null, 2));
const mb = (n: number) => (n / 1_048_576).toFixed(1);
for (const e of entries) console.log(`${e.kind.padEnd(10)} ${String(e.seconds).padStart(4)}s ${mb(e.bytes).padStart(6)} MB  ${e.file}`);
console.log(`${entries.length} videos, ${mb(entries.reduce((s, e) => s + e.bytes, 0))} MB → ${path.relative(ROOT, OUT)}/`);
