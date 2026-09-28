import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { extractDetail } from './detail.mjs';
import { extract } from './extract.mjs';
import { extractJsonApi } from './json-api.mjs';
import { LIBRARY_VERSION } from './result.mjs';
import { extractStaticHtml } from './static-html.mjs';
import { normalizeUrl } from './url.mjs';

const SYMPTOMS = ['missing-record', 'missing-title', 'missing-link', 'wrong-date', 'missing-body', 'missing-table', 'missing-image', 'missing-attachment'];
const ROOT_FIELDS = ['schemaVersion', 'sanitized', 'operation', 'symptom', 'pageUrl', 'libraryVersion', 'capabilityId', 'capabilityVersion', 'target', 'sample', 'config', 'expected'];
const CONFIG_FIELDS = ['contentSelector', 'titleSelector', 'dateSelector', 'itemsPath', 'itemPath', 'contentFormat', 'fields', 'actionUrlTemplate'];
const MAPPING_FIELDS = ['title', 'url', 'publishedAt', 'summary', 'content', 'images', 'attachments'];
const EXPECTED_FIELDS = ['contentIncludes', 'tableTextIncludes', 'imageUrls', 'attachmentUrls', 'publishedAt'];
const REQUIRED_EXPECTATION = { 'missing-body': 'contentIncludes', 'missing-table': 'tableTextIncludes',
  'missing-image': 'imageUrls', 'missing-attachment': 'attachmentUrls', 'wrong-date': 'publishedAt' };
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{8,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|["']?\b(?:token|access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|api[_-]?key|password|passwd|authorization|cookie|session[_-]?id)["']?\s*[:=]\s*["']?[^\s"'<>]+/i;
const PASSWORD_VALUE = /<input\b(?=[^>]*\btype\s*=\s*["']?password\b)(?=[^>]*\bvalue\s*=\s*["']?[^"'\s>])[^>]*>/i;

function plainJson(value, maxDepth = 8) {
  const pending = [{ value, depth: 0 }];
  const seen = new Set();
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    count += 1;
    if (current.depth > maxDepth || count > 10000) return false;
    if (current.value === null || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'string') { if (current.value.length > 40000) return false; continue; }
    if (typeof current.value === 'number') { if (!Number.isFinite(current.value)) return false; continue; }
    if (typeof current.value !== 'object' || seen.has(current.value)) return false;
    seen.add(current.value);
    const array = Array.isArray(current.value);
    const prototype = Object.getPrototypeOf(current.value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    if (array && current.value.length > 5000) return false;
    for (const key of Reflect.ownKeys(current.value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return false;
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return true;
}

function privateHost(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || /\.(?:localhost|local|internal|lan|home)$/.test(host)) return true;
  if (isIP(host) === 4) {
    const [a, b, c] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113);
  }
  if (isIP(host) === 6) {
    const [first, second] = host.split(':').map((part) => Number.parseInt(part || '0', 16));
    return first < 0x2000 || first > 0x3fff || first === 0x2002 ||
      (first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  return !host.includes('.');
}

function credentialQuery(key) {
  let decoded = key;
  for (let i = 0; i < 2; i += 1) {
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  const name = decoded.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /token|secret|password|passwd|credential|authorization|cookie/.test(name) ||
    ['auth', 'apikey', 'key', 'pwd', 'session', 'sessionid', 'sid', 'signature', 'sig', 'samlresponse', 'code'].includes(name) ||
    name.startsWith('xamz') || name.startsWith('xgoog');
}

function publicUrl(value, base) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value, base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || privateHost(parsed.hostname)) return false;
    const hashQuery = parsed.hash.slice(1).replace(/^.*\?/, '');
    return [...parsed.searchParams.keys(), ...new URLSearchParams(hashQuery).keys()].every((key) => !credentialQuery(key));
  } catch { return false; }
}

function decodedText(value) {
  return value.replace(/\\\//g, '/').replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity[2]?.toLowerCase() === 'x';
    const number = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '�';
  });
}

function safeStrings(value, base) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') {
      const text = decodedText(decodedText(current));
      if (SECRET.test(text) || PASSWORD_VALUE.test(text)) return false;
      for (const match of text.matchAll(/(?:https?:)?\/\/[^\s"'<>`\\]+/gi)) {
        if (!publicUrl(match[0], base)) return false;
      }
    } else if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        if (SECRET.test(`${key}=${typeof item === 'string' ? item : ''}`)) return false;
        pending.push(item);
      }
    }
  }
  return true;
}

// Shared strict data checks; these do not grant publication permission.
export { plainJson as isBoundedPlainJson, publicUrl as isPublicUrlWithoutCredentials,
  safeStrings as hasSafePublicStrings };

function objectFields(value, allowed, required, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${label} must be an object.`); return false; }
  if (Object.keys(value).some((key) => !allowed.includes(key))) errors.push(`${label} contains an unsupported field.`);
  if (required.some((key) => !Object.hasOwn(value, key))) errors.push(`${label} is missing a required field.`);
  return true;
}

function nonempty(value, maximum) {
  return typeof value === 'string' && value.length <= maximum && Boolean(value.trim());
}

export function pathMapping(value) {
  return nonempty(value, 200) && value.split('.').every((part) =>
    /^(?:[A-Za-z_$][\w$]*|\d+)$/.test(part) && !['__proto__', 'prototype', 'constructor'].includes(part));
}

export function selector(value) {
  if (!nonempty(value, 500)) return false;
  const compound = /^(?:[A-Za-z][\w-]*)?(?:(?:[.#][\w-]+)|(?:\[\s*[A-Za-z_][\w:-]*\s*(?:=\s*(?:"[^"]*"|'[^']*'|[\w:/.#-]+)\s*)?\]))*/;
  let remaining = value.trim();
  while (remaining) {
    const match = compound.exec(remaining)?.[0];
    if (!match) return false;
    remaining = remaining.slice(match.length);
    if (remaining && !/^\s/.test(remaining)) return false;
    remaining = remaining.trimStart();
  }
  return true;
}

function keyFor(report) {
  return createHash('sha256').update(JSON.stringify([
    normalizeUrl(report.pageUrl), normalizeUrl(report.target.url), report.operation, report.symptom
  ])).digest('hex');
}

function inspect(report) {
  const errors = [];
  if (!plainJson(report)) return { errors: ['Report must contain only bounded plain JSON data.'] };
  const serialized = JSON.stringify(report);
  if (serialized.length > 60000) return { errors: ['Serialized report exceeds 60000 characters.'] };
  const value = JSON.parse(serialized);
  if (!objectFields(value, ROOT_FIELDS, ROOT_FIELDS.filter((key) => !['config', 'expected'].includes(key)), 'report', errors)) return { errors };
  if (value.schemaVersion !== 1 || value.sanitized !== true) errors.push('schemaVersion must be 1 and sanitized must be true.');
  if (!['list', 'detail'].includes(value.operation)) errors.push('operation must be list or detail.');
  if (!SYMPTOMS.includes(value.symptom) || (value.operation === 'list' && !SYMPTOMS.slice(0, 4).includes(value.symptom)) ||
    (value.operation === 'detail' && value.symptom === 'missing-record')) errors.push('symptom is not supported for this operation.');
  for (const name of ['libraryVersion', 'capabilityVersion']) {
    if (!nonempty(value[name], 64) || !SEMVER.test(value[name])) errors.push(`${name} must be semantic version text.`);
  }
  if (!nonempty(value.capabilityId, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.capabilityId)) errors.push('capabilityId must be a lowercase capability identifier.');
  if (!publicUrl(value.pageUrl)) errors.push('pageUrl must be a public HTTP(S) URL without credentials.');
  if (objectFields(value.target, ['title', 'url'], ['title', 'url'], 'target', errors)) {
    if (!nonempty(value.target.title, 500)) errors.push('target.title must contain at most 500 characters of non-empty text.');
    if (!publicUrl(value.target.url)) errors.push('target.url must be a public HTTP(S) URL without credentials.');
  }
  let json;
  if (objectFields(value.sample, ['format', 'stage', 'content'], ['format', 'stage', 'content'], 'sample', errors)) {
    if (!['html', 'json'].includes(value.sample.format)) errors.push('sample.format must be html or json.');
    if (!(value.sample.format === 'html' ? ['static', 'rendered'] : ['api']).includes(value.sample.stage)) errors.push('sample.stage must match its HTML or JSON format.');
    if (typeof value.sample.content !== 'string' || value.sample.content.length > 40000) errors.push('sample.content must be a string of at most 40000 characters.');
    else if (value.sample.format === 'json') {
      try {
        json = JSON.parse(value.sample.content);
        if (!plainJson(json, 20)) errors.push('JSON sample exceeds the supported data depth or size.');
      } catch { errors.push('sample.content is not valid JSON.'); }
    }
  }
  if (Object.hasOwn(value, 'config') && objectFields(value.config, CONFIG_FIELDS, [], 'config', errors)) {
    for (const [name, item] of Object.entries(value.config)) {
      if (['contentSelector', 'titleSelector', 'dateSelector'].includes(name) && !selector(item)) errors.push('config contains an invalid or unsupported selector.');
      if (['itemsPath', 'itemPath'].includes(name) && !(name === 'itemPath' && item === '') && !pathMapping(item)) errors.push('config contains an invalid data path.');
      if (name === 'contentFormat' && !['text', 'html'].includes(item)) errors.push('config.contentFormat must be text or html.');
      if (name === 'actionUrlTemplate' && (!nonempty(item, 2048) || (item.match(/\{id\}/g) || []).length !== 1 ||
        !publicUrl(item.replace('{id}', 'synthetic-id'), value.pageUrl))) errors.push('config.actionUrlTemplate must be a public URL template with one {id} placeholder.');
      if (name === 'fields' && objectFields(item, MAPPING_FIELDS, [], 'config.fields', errors) &&
        Object.values(item).some((mapping) => !pathMapping(mapping))) errors.push('config.fields must contain safe string data paths.');
    }
  }
  if (value.sample?.format === 'json') {
    if (value.operation === 'detail' && !pathMapping(value.config?.fields?.content)) errors.push('JSON detail reports require config.fields.content.');
    if (value.operation === 'list' && (!pathMapping(value.config?.itemsPath) || !pathMapping(value.config?.fields?.title))) errors.push('JSON list reports require config.itemsPath and config.fields.title.');
  }
  if (Object.hasOwn(value, 'expected') && objectFields(value.expected, EXPECTED_FIELDS, [], 'expected', errors)) {
    for (const [name, item] of Object.entries(value.expected)) {
      if (!EXPECTED_FIELDS.includes(name)) continue;
      if (value.operation === 'list' && name !== 'publishedAt') errors.push('List reports only support a publishedAt expectation beyond target title and URL.');
      if (name === 'publishedAt') {
        if (!nonempty(item, 64)) errors.push('expected.publishedAt must contain at most 64 characters of non-empty text.');
      } else if (!Array.isArray(item) || item.length < 1 || item.length > 20 ||
        item.some((entry) => ['imageUrls', 'attachmentUrls'].includes(name) ? !publicUrl(entry) : !nonempty(entry, 1000))) {
        errors.push('expected arrays must contain 1 to 20 bounded non-empty strings or public resource URLs.');
      }
    }
  }
  const required = REQUIRED_EXPECTATION[value.symptom];
  if (required && (!value.expected || !Object.hasOwn(value.expected, required))) errors.push('The reported symptom requires its corresponding expected assertion.');
  if (!safeStrings(value, value.pageUrl) || (json !== undefined && !safeStrings(json, value.pageUrl))) errors.push('Report contains credential-shaped content or a non-public URL; remove it before submission.');
  return { errors: [...new Set(errors)].slice(0, 20), report: value, json };
}

export function validateProblemReport(report) {
  try {
    const checked = inspect(report);
    return checked.errors.length ? { ok: false, errors: checked.errors } : { ok: true, errors: [], problemKey: keyFor(checked.report) };
  } catch { return { ok: false, errors: ['Report could not be safely validated as bounded plain JSON data.'] }; }
}

export function problemKey(report) {
  return validateProblemReport(report).problemKey || null;
}

function replayMode(report) {
  if (report.sample.format === 'json') return 'json-api';
  if (report.operation === 'list' && report.capabilityId === 'tender-platform-families') return 'platform-html';
  return report.sample.stage === 'rendered' ? 'html-rendered-snapshot' : 'html-static';
}

function matchedUrl(actual, expected, base) {
  if (typeof actual !== 'string' || !publicUrl(actual, base)) return false;
  try { return normalizeUrl(new URL(actual, base).href) === normalizeUrl(expected); } catch { return false; }
}

function title(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function resultChecks(report, result) {
  const checks = [];
  const check = (field, passed) => checks.push({ field, passed: Boolean(passed) });
  let item = result.document;
  if (report.operation === 'list') {
    const records = Array.isArray(result.records) ? result.records : [];
    item = records.find((record) => matchedUrl(record.url, report.target.url, report.pageUrl) && title(record.title) === title(report.target.title)) ||
      records.find((record) => matchedUrl(record.url, report.target.url, report.pageUrl)) ||
      records.find((record) => title(record.title) === title(report.target.title));
  }
  check('target.title', title(item?.title) === title(report.target.title));
  check('target.url', matchedUrl(item?.url, report.target.url, report.pageUrl));
  for (const [field, expected] of Object.entries(report.expected || {})) {
    if (field === 'publishedAt') { check('expected.publishedAt', item?.publishedAt === expected); continue; }
    expected.forEach((value, index) => {
      let passed = false;
      if (field === 'contentIncludes') passed = typeof item?.contentText === 'string' && item.contentText.includes(value);
      if (field === 'tableTextIncludes') passed = item?.tables?.some((table) =>
        [table.caption, ...(table.rows || []).flatMap((row) => row.map((cell) => cell.text))].join(' ').includes(value));
      if (field === 'imageUrls' || field === 'attachmentUrls') passed = item?.[field === 'imageUrls' ? 'images' : 'attachments']?.some((resource) =>
        matchedUrl(resource.url, value, item?.url || report.pageUrl));
      check(`expected.${field}[${index}]`, passed);
    });
  }
  return checks;
}

export async function reproduceProblem(report) {
  let checked;
  try { checked = inspect(report); }
  catch { checked = { errors: ['Report could not be safely validated as bounded plain JSON data.'] }; }
  const value = checked.report;
  const valid = checked.errors.length === 0;
  const receipt = { ok: false, problemKey: valid ? keyFor(value) : null, status: 'invalid',
    reportedVersion: valid ? value.libraryVersion : null, testedVersion: LIBRARY_VERSION,
    operation: valid ? value.operation : null, symptom: valid ? value.symptom : null,
    replayMode: valid ? replayMode(value) : null, checks: [], diagnosticCodes: [] };
  if (!valid) return { ...receipt, errors: checked.errors };
  try {
    const config = { ...(value.config || {}) };
    let result;
    if (value.operation === 'detail') {
      result = await extractDetail({ url: value.pageUrl,
        ...(value.sample.format === 'json' ? { json: checked.json } : { html: value.sample.content }),
        config: { ...config, mode: value.sample.format === 'json' ? 'json' : 'static' } });
    } else if (value.sample.format === 'json') {
      result = extractJsonApi({ url: value.pageUrl, json: checked.json, config });
    } else if (value.capabilityId === 'tender-platform-families') {
      result = await extract({ capabilityId: 'tender-platform-families', url: value.pageUrl, html: value.sample.content, config });
    } else {
      result = extractStaticHtml({ url: value.pageUrl, html: value.sample.content, config });
    }
    receipt.diagnosticCodes = [...new Set((result.diagnostics || []).map((entry) => entry.code)
      .filter((code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)))].slice(0, 50);
    if (receipt.diagnosticCodes.includes('DETAIL_EXTRACTION_FAILED')) {
      return { ...receipt, status: 'needs-maintainer', errors: ['The offline parser could not complete; a maintainer must inspect the sanitized reproduction.'] };
    }
    receipt.checks = resultChecks(value, result);
    return { ...receipt, ok: true, status: receipt.checks.every((check) => check.passed) ? 'not-reproduced' : 'reproduced' };
  } catch {
    return { ...receipt, status: 'needs-maintainer', errors: ['The offline parser could not complete; a maintainer must inspect the sanitized reproduction.'] };
  }
}
