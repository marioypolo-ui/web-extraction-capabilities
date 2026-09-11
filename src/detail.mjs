import { extractWithBrowser } from './browser.mjs';
import { extractHtmlDetail } from './detail-html.mjs';
import { fetchResource } from './http.mjs';
import { fetchKnownPlatformDetail } from './migrated/html.mjs';
import { diagnostic, LIBRARY_VERSION } from './result.mjs';

const MODES = ['auto', 'static', 'json', 'platform', 'browser'];
const empty = (code, message) => ({ document: null,
  diagnostics: [diagnostic(code, message, { severity: 'error' })] });

function httpUrl(value, base) {
  try {
    const parsed = new URL(value, base);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.href : null;
  } catch { return null; }
}

function valueAtPath(value, path) {
  if (!path) return value;
  return String(path).split('.').reduce((item, key) =>
    item && typeof item === 'object' && Object.hasOwn(item, key) ? item[key] : undefined, value);
}

function resources(value, baseUrl, label, diagnostics) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('API_RESPONSE_SHAPE_MISMATCH', `${label} must be an array.`));
    return [];
  }
  const seen = new Set();
  return value.flatMap((item) => {
    const rawUrl = typeof item === 'string' ? item : item?.url;
    const url = typeof rawUrl === 'string' && rawUrl.trim() ? httpUrl(rawUrl, baseUrl) : null;
    if (!url) {
      diagnostics.push(diagnostic('INVALID_RESOURCE_URL', 'An unsupported resource URL was omitted.'));
      return [];
    }
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ url, [label]: typeof item?.[label] === 'string' ? item[label] : '' }];
  });
}

function jsonDetail({ json, url, config }) {
  if (!config.fields || typeof config.fields.content !== 'string' || !config.fields.content) {
    return empty('CONFIG_REQUIRED', 'JSON detail requires a fields.content mapping.');
  }
  const item = valueAtPath(json, config.itemPath);
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return empty('API_RESPONSE_SHAPE_MISMATCH', 'JSON detail must resolve to one object.');
  }
  const content = valueAtPath(item, config.fields.content);
  if (typeof content !== 'string' || !content.trim()) {
    return empty('DETAIL_CONTENT_NOT_FOUND', 'The mapped detail content is missing or empty.');
  }
  const field = (name) => config.fields[name] ? valueAtPath(item, config.fields[name]) : undefined;
  const diagnostics = [];
  const mappedUrl = field('url');
  const documentUrl = typeof mappedUrl === 'string' ? httpUrl(mappedUrl, url) : url;
  if (!documentUrl) return empty('CONFIG_INVALID', 'The mapped document URL must use HTTP or HTTPS without credentials.');
  let document;
  if (config.contentFormat === 'html') {
    const parsed = extractHtmlDetail({ html: `<article>${content}</article>`, url: documentUrl,
      config: { contentSelector: 'article' } });
    if (!parsed.document) return parsed;
    document = parsed.document;
    diagnostics.push(...parsed.diagnostics);
  } else {
    document = { title: '', url: documentUrl, publishedAt: null, contentText: content.trim(),
      tables: [], images: [], attachments: [] };
  }
  if (typeof field('title') === 'string') document.title = field('title').trim();
  if (typeof field('publishedAt') === 'string' && field('publishedAt').trim()) {
    document.publishedAt = field('publishedAt').trim();
  }
  for (const [name, label] of [['images', 'alt'], ['attachments', 'title']]) {
    const extra = resources(field(name), documentUrl, label, diagnostics);
    document[name] = [...new Map([...document[name], ...extra].map((entry) => [entry.url, entry])).values()];
  }
  return { document, diagnostics };
}

async function browserDetail(input) {
  return extractWithBrowser(input,
    input.config.requireAuthentication ? 'authenticated-session' : 'complex-js-browser', extractHtmlDetail);
}

async function runDetail(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    (input.config !== undefined && (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)))) {
    return empty('CONFIG_INVALID', 'Detail input and config must be objects.');
  }
  if (input.html !== undefined && input.json !== undefined) {
    return empty('CONFIG_INVALID', 'Provide only one of html or json.');
  }
  const config = input.config || {};
  const mode = config.mode || 'auto';
  if (!MODES.includes(mode) || (config.contentFormat && !['text', 'html'].includes(config.contentFormat))) {
    return empty('CONFIG_INVALID', 'Unsupported detail mode or contentFormat.');
  }
  if (!httpUrl(input.url)) return empty('CONFIG_INVALID', 'Detail requires an HTTP or HTTPS page URL without credentials.');
  input = { ...input, config };
  if (mode === 'browser') return browserDetail(input);

  if (input.json !== undefined) {
    if (!['auto', 'json'].includes(mode)) return empty('CONFIG_INVALID', 'JSON input requires auto or json mode.');
    return jsonDetail(input);
  }
  if (input.html !== undefined) {
    if (typeof input.html !== 'string' || mode === 'json') {
      return empty('CONFIG_INVALID', 'Saved HTML input must be text and cannot use json mode.');
    }
    return extractHtmlDetail(input);
  }

  if (mode === 'json' || config.apiUrl) {
    const apiUrl = config.apiUrl ? httpUrl(config.apiUrl, input.url) : input.url;
    if (!apiUrl) return empty('CONFIG_INVALID', 'apiUrl must use HTTP or HTTPS without credentials.');
    const fetched = await fetchResource(apiUrl, { ...config.http, accept: 'application/json' });
    if (fetched.diagnostics.length) return { document: null, diagnostics: fetched.diagnostics };
    let json = fetched.json;
    if (json === null) {
      try { json = JSON.parse(fetched.text); }
      catch { return empty('INVALID_JSON', 'The detail endpoint did not return valid JSON.'); }
    }
    return jsonDetail({ ...input, json });
  }

  if (mode === 'auto' || mode === 'platform') {
    const platform = await fetchKnownPlatformDetail(input.url, config.http || {});
    if (platform.matched) {
      if (platform.diagnostics.length) return { document: null, diagnostics: platform.diagnostics };
      return extractHtmlDetail({ ...input, html: platform.html });
    }
    if (mode === 'platform') return empty('UNSUPPORTED_STRUCTURE', 'No verified platform detail route matches this URL.');
  }

  const fetched = await fetchResource(input.url, config.http);
  if (fetched.diagnostics.length) return { document: null, diagnostics: fetched.diagnostics };
  const contentType = fetched.contentType.split(';')[0].trim().toLowerCase();
  if (fetched.json !== null) return jsonDetail({ ...input, json: fetched.json });
  if (contentType && !['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) {
    return empty('UNSUPPORTED_CONTENT_TYPE', 'This response is not an HTML detail page; attachment bodies are not parsed.');
  }
  return extractHtmlDetail({ ...input, url: fetched.resolvedUrl, html: fetched.text });
}

export async function extractDetail(input = {}) {
  let result;
  try {
    result = await runDetail(input);
    const retryable = new Set(['DYNAMIC_RENDERING_REQUIRED', 'DETAIL_CONTENT_NOT_FOUND', 'LOW_CONFIDENCE_CONTENT']);
    if (!result.document && input?.config?.browserFallback === true &&
      (!input.config.mode || input.config.mode === 'auto') && result.diagnostics.length &&
      result.diagnostics.some((item) => item.code === 'DYNAMIC_RENDERING_REQUIRED') &&
      result.diagnostics.every((item) => retryable.has(item.code))) {
      result = await browserDetail({ ...input, config: input.config || {} });
    }
  } catch {
    result = empty('DETAIL_EXTRACTION_FAILED', 'Detail extraction could not complete; check the input and configuration.');
  }
  return {
    document: result.document || null,
    diagnostics: result.diagnostics || [],
    capabilityId: 'web-page-detail',
    capabilityVersion: LIBRARY_VERSION
  };
}
