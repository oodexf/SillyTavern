/**
 * Fails if any emoji appears in the frontend sources (markup, scripts, styles, locales).
 * UI icons must use Lucide classes instead, e.g. `<i class="lucide lucide-check"></i>`.
 *
 * Usage: node tools/check-no-emoji.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic})*|\uFE0F/gu;
/** Typographic symbols that Unicode also classifies as pictographic. */
const ALLOWED = new Set(['©', '®', '™']);
const SCANNED_EXTENSIONS = /\.(js|html|css|json)$/;
/** Vendored libraries (any `lib` folder) and user-installed extensions are not ours to change. */
const SKIPPED_DIRECTORIES = new Set(['lib']);
const SKIPPED_PATHS = [
    path.join(publicDir, 'scripts/extensions/third-party'),
];
const SKIPPED_FILES = /\.min\.(js|css)$/;

/** @type {string[]} */
const problems = [];

/**
 * @param {string} dir Directory to scan recursively
 */
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (SKIPPED_PATHS.includes(fullPath)) {
            continue;
        }
        if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
            continue;
        }
        if (entry.isDirectory()) {
            scan(fullPath);
            continue;
        }
        if (!SCANNED_EXTENSIONS.test(entry.name) || SKIPPED_FILES.test(entry.name)) {
            continue;
        }
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        lines.forEach((line, index) => {
            const found = [...line.matchAll(EMOJI_PATTERN)].map(m => m[0]).filter(c => !ALLOWED.has(c));
            if (found.length) {
                problems.push(`${path.relative(rootDir, fullPath)}:${index + 1}: ${found.join(' ')}`);
            }
        });
    }
}

scan(publicDir);

if (problems.length) {
    console.error(`Found ${problems.length} line(s) with emoji. Use Lucide icons instead:`);
    problems.forEach(p => console.error(`  ${p}`));
    process.exit(1);
}
console.log('No emoji found.');
