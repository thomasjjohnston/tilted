// Minimal server-rendered pages (invite landing, and later support/privacy).
// Plain HTML, no scripts, no cookies, no external assets.

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap body HTML in the shared page shell. `title` is escaped here;
 * `bodyHtml` must already be safe (escape every interpolated value).
 */
export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f3d2e; color: #f4ecd8;
         font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 30rem; margin: 0 auto; padding: 3rem 1.5rem; text-align: center; }
  .eyebrow { color: #d4af37; font-size: 0.75rem; letter-spacing: 0.25em; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 1.9rem;
       line-height: 1.25; margin: 0.75rem 0 1rem; }
  p { color: #d9cfb6; margin: 0.75rem 0; }
  .code { font: 600 1.8rem/1 ui-monospace, Menlo, monospace; letter-spacing: 0.2em;
          color: #f4ecd8; background: rgba(0,0,0,0.25); border-radius: 0.6rem;
          padding: 1rem; margin: 1.5rem 0; overflow-wrap: anywhere; }
  a.button { display: inline-block; background: #d4af37; color: #1b1b1b; text-decoration: none;
             font-weight: 600; padding: 0.85rem 1.5rem; border-radius: 0.6rem; margin: 1rem 0; }
  ol { text-align: left; color: #d9cfb6; padding-left: 1.25rem; }
  small { color: #a89f88; }
  a { color: #d4af37; }
</style>
</head>
<body><main>
<div class="eyebrow">TILTED</div>
${bodyHtml}
</main></body>
</html>`;
}
