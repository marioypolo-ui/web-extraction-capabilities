export function extractCards({ html = '', url }) {
  const records = [...html.matchAll(/<(?:card data-href|a href)="([^"]+)"[^>]*>([^<]+)<\/(?:card|a)>/g)]
    .map((match) => ({ title: match[2].trim(), url: new URL(match[1], url).href }));
  return { records, diagnostics: records.length ? [] : [{ code: 'ZERO_RECORDS' }] };
}
