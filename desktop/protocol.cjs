const path = require('node:path');

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

function assetPath(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'mvcad:' || url.host !== 'app' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return file;
  } catch {
    return null;
  }
}
module.exports = { assetPath, CSP };
