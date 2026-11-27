// Pure zero-DOM client-side SVG security validator matching backend file-viewer.ts rules.

const CLIENT_SVG_ROOT_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?svg\b/i;
const CLIENT_SVG_ENTITY_DECL_RE = /<!\s*entity\b/i;
const CLIENT_SVG_SCRIPT_TAG_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?script\b/i;
const CLIENT_SVG_FOREIGN_OBJECT_RE = /<\s*(?:[a-zA-Z_][\w.-]*:)?foreignobject\b/i;
const CLIENT_SVG_ACTIVE_EMBED_TAG_RE =
  /<\s*(?:[a-zA-Z_][\w.-]*:)?(?:iframe|object|embed|applet|base|meta|handler|listener)\b/i;
const CLIENT_SVG_EVENT_HANDLER_ATTR_RE = /(?:^|[\s"'/])on[a-z][a-z0-9_-]{0,31}\s*=/i;
const CLIENT_SVG_EXTERNAL_HREF_RE =
  /(?:^|[\s"'/])(?:xlink:)?href\s*=\s*(?:["']\s*(?:https?:|\/\/)|(?:https?:|\/\/))/i;
const CLIENT_SVG_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
};

function decodeHtmlAndCssEscapesLinear(input: string): string {
  // O(n) decode matching backend file-viewer.ts: HTML5 named entities, arbitrary-leading-zero/optional-semicolon numeric entities & CSS hex escapes
  const namedDecoded = input.replace(
    /&(colon|tab|newline|sol);?/gi,
    (_full, name: string) => CLIENT_SVG_NAMED_ENTITIES[name.toLowerCase()] ?? '',
  );
  const entitiesDecoded = namedDecoded.replace(
    /&#(?:x0*([0-9a-fA-F]{1,6})|0*([0-9]{1,7}));?/g,
    (full, hex: string | undefined, dec: string | undefined) => {
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    },
  );
  return entitiesDecoded.replace(
    /\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g,
    (full, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    },
  );
}

export function validateClientSvgSafety(
  rawSvg: string,
): { safe: true; content: string; lineCount: number; viewBox?: string } | { safe: false; reason: string } {
  const cleaned = rawSvg.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return { safe: false, reason: 'Empty SVG document' };
  if (!CLIENT_SVG_ROOT_RE.test(cleaned)) {
    return { safe: false, reason: 'Missing <svg> root element' };
  }
  if (CLIENT_SVG_ENTITY_DECL_RE.test(cleaned)) {
    return { safe: false, reason: '<!ENTITY> declarations are disallowed' };
  }
  if (CLIENT_SVG_SCRIPT_TAG_RE.test(cleaned)) {
    return { safe: false, reason: '<script> element is disallowed' };
  }
  if (CLIENT_SVG_FOREIGN_OBJECT_RE.test(cleaned)) {
    return { safe: false, reason: '<foreignObject> element is disallowed' };
  }
  if (CLIENT_SVG_ACTIVE_EMBED_TAG_RE.test(cleaned)) {
    return { safe: false, reason: 'Active embedded HTML/XML element is disallowed' };
  }
  if (CLIENT_SVG_EVENT_HANDLER_ATTR_RE.test(cleaned)) {
    return { safe: false, reason: 'Inline on* event handler attribute is disallowed' };
  }

  const decoded = decodeHtmlAndCssEscapesLinear(cleaned);
  // Strip ASCII control characters and whitespace for scheme inspection
  const compact = decoded.replace(/[\x00-\x20\x7f]+/g, '').toLowerCase();
  if (compact.includes('javascript:') || compact.includes('vbscript:')) {
    return { safe: false, reason: 'Script URI scheme (javascript:/vbscript:) is disallowed' };
  }
  if (
    compact.includes('data:text/html') ||
    compact.includes('data:application/xhtml+xml') ||
    compact.includes('data:image/svg+xml')
  ) {
    return { safe: false, reason: 'Active data: URI payload is disallowed' };
  }
  if (CLIENT_SVG_EXTERNAL_HREF_RE.test(decoded)) {
    return { safe: false, reason: 'External network reference inside SVG is disallowed' };
  }

  const viewBoxMatch = /\bviewBox\s*=\s*["']([^"']{1,80})["']/i.exec(cleaned);
  const lineCount = cleaned.split(/\r?\n/).length;
  return {
    safe: true,
    content: cleaned,
    lineCount,
    viewBox: viewBoxMatch?.[1],
  };
}
