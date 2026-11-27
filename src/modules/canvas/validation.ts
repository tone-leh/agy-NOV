const SAFE_IMAGE_DATA_URI_PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;
const BASE64_PAYLOAD_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Validate that an image source is an inline base64 raster data URI.
 * Rejects SVG data URIs and external http(s) URLs.
 */
export function isSafeImageDataUri(src: string): boolean {
  if (typeof src !== 'string') return false;
  const trimmed = src.trim();
  if (!SAFE_IMAGE_DATA_URI_PREFIX.test(trimmed)) return false;
  const commaIdx = trimmed.indexOf(',');
  const payload = trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
  return payload.length > 0 && BASE64_PAYLOAD_RE.test(payload);
}

/**
 * Wrap raw SVG markup inside a locked-down HTML document intended for
 * an <iframe sandbox="" /> element (zero script execution, opaque origin).
 */
export function buildSafeSvgSrcDoc(svgContent: string): string {
  const cspMeta = [
    '<meta',
    'http-equiv="Content-Security-Policy"',
    'content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:;"',
    '/>',
  ].join(' ');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    cspMeta,
    '<style>',
    'html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #090e17; overflow: auto; }',
    'body { display: flex; align-items: center; justify-content: center; padding: 14px; box-sizing: border-box; }',
    '.svg-stage { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }',
    '.svg-stage svg { max-width: 100%; max-height: 100%; display: block; }',
    '</style>',
    '</head>',
    `<body><div class="svg-stage">${svgContent}</div></body>`,
    '</html>',
  ].join('');
}
