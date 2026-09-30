/**
 * Builds public/css/lucide-icons.css and public/lib/lucide/fa-icons.json.
 *
 * Every Font Awesome class name the app (or a third-party extension, or a user's saved
 * Quick Reply icon) may reference is rendered with a Lucide icon instead. Icons are drawn
 * on the ::before pseudo-element with a CSS mask, so the element keeps its own background,
 * border and layout, and JS that toggles `fa-*` classes keeps working unchanged.
 *
 * New markup should use `<i class="lucide lucide-<name>"></i>`; any Lucide icon referenced that
 * way in the public folder (.js and .html files) is picked up automatically when this script runs.
 *
 * Usage: node tools/icons/build-lucide-shim.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(toolsDir, '../..');
const lucideDir = path.join(rootDir, 'node_modules/lucide-static/icons');
const lucidePackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules/lucide-static/package.json'), 'utf8'));

const FALLBACK_ICON = 'circle-dashed';

/** Lucide icons exposed as `--lucide-<name>` custom properties, for stylesheets that draw icons on pseudo-elements. */
const CSS_VARIABLE_ICONS = [
    'check',
    'chevron-right',
    'circle-check',
    'circle-dot',
    'circle-x',
    'info',
    'lock',
    'minus',
    'plus',
    'square',
    'square-check',
    'triangle-alert',
    'x',
];

/**
 * Icons drawn as background images where a mask cannot be used (e.g. on `<select>`, which has no
 * pseudo-elements), so they need a fixed stroke color that reads on both light and dark themes.
 */
const CSS_BACKGROUND_ICONS = {
    'ui-select-chevron': { icon: 'chevron-down', stroke: '#8c8c8c' },
};

/** Word-level rewrites from Font Awesome naming to Lucide naming, used for the long tail. */
const WORD_REWRITES = [
    [/\bxmark\b/g, 'x'],
    [/\bmagnifying-glass\b/g, 'search'],
    [/\btriangle-exclamation\b/g, 'triangle-alert'],
    [/\bcircle-exclamation\b/g, 'circle-alert'],
    [/\bexclamation\b/g, 'alert'],
    [/\bcircle-question\b/g, 'circle-question-mark'],
    [/\bcircle-info\b/g, 'info'],
    [/\bgears?\b/g, 'settings'],
    [/\btrash-can\b/g, 'trash-2'],
    [/\bfloppy-disk\b/g, 'save'],
    [/\bpen-to-square\b/g, 'square-pen'],
    [/\bfile-lines\b/g, 'file-text'],
    [/\bcaret\b/g, 'chevron'],
    [/\bangles\b/g, 'chevrons'],
    [/\bangle\b/g, 'chevron'],
    [/\bbars\b/g, 'menu'],
    [/\bslash\b/g, 'off'],
    [/\bcomment\b/g, 'message-circle'],
    [/\bcomments\b/g, 'messages-square'],
    [/\bmessage\b/g, 'message-square'],
    [/\bchart-line\b/g, 'chart-line'],
    [/\bchart-simple\b/g, 'chart-column'],
    [/\bpeople\b/g, 'users'],
    [/\bperson\b/g, 'user'],
];

const lucideIcons = new Set(fs.readdirSync(lucideDir).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));
const lucideTags = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules/lucide-static/tags.json'), 'utf8'));
/** @type {{n: string[], b?: number}[]} */
const faGroups = JSON.parse(fs.readFileSync(path.join(toolsDir, 'fa-icon-groups.json'), 'utf8'));
/** @type {Record<string, string>} */
const manualMap = JSON.parse(fs.readFileSync(path.join(toolsDir, 'fa-to-lucide.manual.json'), 'utf8'));

for (const [fa, icon] of Object.entries(manualMap)) {
    if (!lucideIcons.has(icon)) {
        throw new Error(`Manual mapping ${fa} -> ${icon}: Lucide icon does not exist`);
    }
}

/**
 * Candidate Lucide names for a Font Awesome name, in order of confidence.
 * @param {string} faName Font Awesome class name, e.g. 'fa-circle-xmark'
 * @returns {string[]}
 */
function candidates(faName) {
    const name = faName.replace(/^fa-/, '');
    const rewritten = WORD_REWRITES.reduce((s, [re, r]) => s.replace(re, r), name);
    const parts = rewritten.split('-');
    const result = [name, rewritten, parts.length === 2 ? `${parts[1]}-${parts[0]}` : null];
    for (let i = parts.length - 1; i > 0; i--) {
        result.push(parts.slice(0, i).join('-'));
    }
    return result;
}

/**
 * Resolves a Font Awesome alias group to a Lucide icon.
 * @param {string[]} names All class names of one Font Awesome icon (aliases)
 * @param {boolean} isBrand Whether this is a brand logo, which Lucide does not provide
 * @returns {{ icon: string, confident: boolean }}
 */
function resolveGroup(names, isBrand) {
    const manual = names.find(n => manualMap[n]);
    if (manual) {
        return { icon: manualMap[manual], confident: true };
    }
    if (isBrand) {
        return { icon: FALLBACK_ICON, confident: false };
    }
    for (const n of names) {
        const exact = n.replace(/^fa-/, '');
        if (lucideIcons.has(exact)) {
            return { icon: exact, confident: true };
        }
    }
    for (const n of names) {
        const [, rewritten, swapped] = candidates(n);
        const hit = [rewritten, swapped].find(c => c && lucideIcons.has(c));
        if (hit) {
            return { icon: hit, confident: true };
        }
    }
    for (const n of names) {
        const hit = candidates(n).find(c => c && lucideIcons.has(c));
        if (hit) {
            return { icon: hit, confident: false };
        }
    }
    for (const n of names) {
        const phrase = n.replace(/^fa-/, '').replace(/-/g, ' ');
        const tagged = Object.keys(lucideTags).find(icon => lucideTags[icon].includes(phrase));
        if (tagged) {
            return { icon: tagged, confident: false };
        }
    }
    return { icon: FALLBACK_ICON, confident: false };
}

/**
 * Converts a Lucide SVG file into a compact data URI usable as a mask image.
 * @param {string} icon Lucide icon name
 * @param {string} [stroke] Stroke color; only matters when the image is not used as a mask
 * @returns {string}
 */
function svgDataUri(icon, stroke = '#000') {
    const svg = fs.readFileSync(path.join(lucideDir, `${icon}.svg`), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s+class="[^"]*"/, '')
        .replace(/\s+(width|height)="24"/g, '')
        .replace(/stroke="currentColor"/, `stroke="${stroke}"`)
        .replace(/>\s+</g, '><')
        .replace(/\s*(\/?)>/g, '$1>')
        .trim()
        .replace(/"/g, '\'')
        .replace(/%/g, '%25')
        .replace(/#/g, '%23')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E');
    return `url("data:image/svg+xml,${svg}")`;
}

/** @type {Map<string, string[]>} Lucide icon -> selectors that render it */
const selectorsByIcon = new Map();
/** @type {string[][]} Picker entries: alias groups, one per distinct confident Lucide icon */
const pickerGroups = [];
const pickerIcons = new Set();
const stats = { confident: 0, guessed: 0 };

const addSelector = (icon, className) => {
    if (!selectorsByIcon.has(icon)) {
        selectorsByIcon.set(icon, []);
    }
    selectorsByIcon.get(icon).push(`.${className}::before`);
};

for (const group of faGroups) {
    const { icon, confident } = resolveGroup(group.n, Boolean(group.b));
    stats[confident ? 'confident' : 'guessed']++;
    group.n.forEach(className => addSelector(icon, className));
    if (confident && !pickerIcons.has(icon)) {
        pickerIcons.add(icon);
        pickerGroups.push(group.n);
    }
}

/**
 * Finds Lucide icons referenced as `lucide-<name>` in the frontend sources, so that
 * markup can use any Lucide icon without registering it here.
 * @param {string} dir Directory to scan
 * @param {Set<string>} found Accumulator
 * @returns {Set<string>}
 */
function findReferencedLucideIcons(dir, found = new Set()) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'lib' && entry.name !== 'node_modules') {
                findReferencedLucideIcons(fullPath, found);
            }
        } else if (/\.(js|html)$/.test(entry.name)) {
            const text = fs.readFileSync(fullPath, 'utf8');
            for (const [, name] of text.matchAll(/\blucide-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
                if (lucideIcons.has(name)) {
                    found.add(name);
                }
            }
        }
    }
    return found;
}

const referencedIcons = findReferencedLucideIcons(path.join(rootDir, 'public'));
for (const icon of [...new Set([...selectorsByIcon.keys(), ...referencedIcons])].sort()) {
    addSelector(icon, `lucide-${icon}`);
}

const styleClasses = ['fa', 'fas', 'far', 'fab', 'fa-solid', 'fa-regular', 'fa-brands', 'fa-classic', 'fa-sharp', 'lucide'];
const baseCss = `
${styleClasses.map(c => `.${c}`).join(',')}{-moz-osx-font-smoothing:grayscale;-webkit-font-smoothing:antialiased;display:var(--fa-display,inline-block);font-style:normal;font-variant:normal;line-height:1;text-rendering:auto}
${styleClasses.map(c => `.${c}::before`).join(',')}{display:inline-block;flex-shrink:0;width:1em;height:1em;vertical-align:-0.125em;background-color:currentColor;-webkit-mask:var(--st-icon) center/contain no-repeat;mask:var(--st-icon) center/contain no-repeat}
`;

const variableCss = `:root{${[
    ...CSS_VARIABLE_ICONS.map(icon => `--lucide-${icon}:${svgDataUri(icon)}`),
    ...Object.entries(CSS_BACKGROUND_ICONS).map(([name, { icon, stroke }]) => `--${name}:${svgDataUri(icon, stroke)}`),
].join(';')}}\n`;

const iconCss = [...selectorsByIcon.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([icon, selectors]) => `${selectors.join(',')}{content:"";--st-icon:${svgDataUri(icon)}}`)
    .join('\n');

const header = `/*!
 * GENERATED FILE - do not edit. Source: tools/icons/build-lucide-shim.js
 * Icons: Lucide v${lucidePackage.version} (ISC License), https://lucide.dev
 * Maps Font Awesome class names to Lucide icons for backward compatibility.
 */
`;
const utilities = fs.readFileSync(path.join(toolsDir, 'fa-utilities.css'), 'utf8');

fs.writeFileSync(path.join(rootDir, 'public/css/lucide-icons.css'), `${header}${utilities}${baseCss}${variableCss}${iconCss}\n`);
fs.mkdirSync(path.join(rootDir, 'public/lib/lucide'), { recursive: true });
fs.writeFileSync(path.join(rootDir, 'public/lib/lucide/fa-icons.json'), JSON.stringify(pickerGroups));

console.log(`Font Awesome icons: ${faGroups.length} (${stats.confident} mapped, ${stats.guessed} guessed or fallback)`);
console.log(`Distinct Lucide icons emitted: ${selectorsByIcon.size}`);
console.log(`Icon picker entries: ${pickerGroups.length}`);
