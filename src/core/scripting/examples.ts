/** Example scripts shown in the Scripts panel (also in docs/SCRIPTING.md). */
export interface ExampleScript {
  id: string;
  name: string;
  description: string;
  language: 'js' | 'ts';
  source: string;
}

export const EXAMPLE_SCRIPTS: ExampleScript[] = [
  {
    id: 'grid',
    name: 'Colour grid',
    description: 'Fills the first page with a grid of rounded squares in a rainbow.',
    language: 'js',
    source: `// A 6 × 4 grid of squares across the first page
const cols = 6, rows = 4, gap = 16;
const w = (document.width - gap * (cols + 1)) / cols;
const h = (document.height - gap * (rows + 1)) / rows;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    document.page.addRect({
      x: gap + w / 2 + c * (w + gap),
      y: gap + h / 2 + r * (h + gap),
      w, h, radius: 12,
      fill: color.hsl((c + r * cols) * 15, 70, 55),
      name: \`Tile \${r + 1}-\${c + 1}\`,
    });
  }
}
log(\`Made \${cols * rows} tiles\`);`,
  },
  {
    id: 'rename',
    name: 'Number selected layers',
    description: 'Renames the selected objects “Item 1”, “Item 2”… from left to right.',
    language: 'ts',
    source: `const items: Node[] = selection.nodes.sort((a, b) => a.bounds.x - b.bounds.x);
if (!items.length) log('Select some objects first');
items.forEach((n, i) => (n.name = \`Item \${i + 1}\`));
log(\`Renamed \${items.length}\`);`,
  },
  {
    id: 'find-replace',
    name: 'Find and replace text',
    description: 'Replaces a word in every text object and text frame of the document.',
    language: 'js',
    source: `const find = 'colour', replace = 'color';
let count = 0;
for (const n of document.find({ text: find })) {
  n.text = n.text.split(find).join(replace);
  count++;
}
log(\`Changed \${count} text object(s)\`);`,
  },
  {
    id: 'contact-sheet',
    name: 'Page labels',
    description: 'Adds a small footer with the page number and document title to every page.',
    language: 'js',
    source: `const pages = document.pages;
for (const p of pages) {
  p.addText({
    text: \`\${document.title} — \${p.index + 1} / \${pages.length}\`,
    x: document.width / 2, y: document.height - units.mm(8),
    fontSize: 12, fill: '#6b7079', name: 'Page label',
  });
}`,
  },
  {
    id: 'swatches',
    name: 'School colours',
    description: 'Adds a set of named swatches to the document palette.',
    language: 'js',
    source: `const colours = { 'School navy': '#1f2a44', 'School gold': '#d9b44a', 'Paper': '#f6f3ea' };
for (const [name, value] of Object.entries(colours)) document.addSwatch(name, value);
log('Added', Object.keys(colours).length, 'swatches');`,
  },
];
