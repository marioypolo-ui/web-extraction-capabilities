import { diagnostic } from './result.mjs';

function valueAtPath(value, path) {
  if (!path) {
    return value;
  }
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], value);
}

export function extractJsonApi({ json, url, config = {} }) {
  if (!config.itemsPath || !config.fields?.title) {
    return {
      records: [],
      diagnostics: [
        diagnostic(
          'CONFIG_REQUIRED',
          'json-api-list requires itemsPath and a fields.title mapping.',
          { severity: 'error' }
        )
      ]
    };
  }

  const items = valueAtPath(json, config.itemsPath);
  if (!Array.isArray(items)) {
    return {
      records: [],
      diagnostics: [
        diagnostic('API_RESPONSE_SHAPE_MISMATCH', `Expected an array at ${config.itemsPath}.`, {
          severity: 'error'
        })
      ]
    };
  }

  const records = items.map((item) => ({
    title: valueAtPath(item, config.fields.title),
    url: valueAtPath(item, config.fields.url) || url,
    publishedAt: valueAtPath(item, config.fields.publishedAt) || null,
    summary: valueAtPath(item, config.fields.summary) || '',
    raw: config.includeRaw ? item : {}
  }));
  return { records, diagnostics: [] };
}
