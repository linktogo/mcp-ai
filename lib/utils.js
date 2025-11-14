import path from 'path'
// Small utility helpers used by prompts/resources modules

export function sanitizeName(base) {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 64);
}

export function guessResourceType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.txt') return 'text';
  return 'unknown';
}

export function extractMeta(markdown, fallbackName) {
  // Simple extraction of first H1
  const headingMatch = markdown.match(/^#\s+(.+)/m);
  const title = headingMatch ? headingMatch[1].trim() : fallbackName;
  // Optional: first paragraph after heading
  let description = title;
  const paraMatch = markdown.replace(/\r/g, "").split(/\n\n+/).find(p => !p.startsWith("#"));
  if (paraMatch) description = paraMatch.split(/\n/).slice(0, 3).join(" ").trim();
  return { title, description };
}
