export const LIBRARY_VERSION = '0.1.3';

export function diagnostic(code, message, options = {}) {
  return {
    code,
    severity: options.severity || 'warning',
    message,
    ...(options.details ? { details: options.details } : {})
  };
}

export function normalizeRecord(record, baseUrl) {
  const title = String(record?.title || '').replace(/\s+/g, ' ').trim();
  const rawUrl = String(record?.url || '').trim();
  let url = rawUrl;

  if (rawUrl && baseUrl) {
    try {
      url = new URL(rawUrl, baseUrl).toString();
    } catch {
      url = rawUrl;
    }
  }

  return {
    title,
    url,
    publishedAt: record?.publishedAt || null,
    summary: String(record?.summary || '').replace(/\s+/g, ' ').trim(),
    raw: record?.raw && typeof record.raw === 'object' ? record.raw : {}
  };
}

export function createResult(capabilityId, records = [], diagnostics = [], baseUrl) {
  const normalizedRecords = records
    .map((record) => normalizeRecord(record, baseUrl))
    .filter((record) => record.title);
  const normalizedDiagnostics = [...diagnostics];

  if (
    normalizedRecords.length === 0 &&
    !normalizedDiagnostics.some((item) => item.code === 'ZERO_RECORDS')
  ) {
    normalizedDiagnostics.push(
      diagnostic('ZERO_RECORDS', 'The extraction completed without any records; verify the page structure.')
    );
  }

  return {
    records: normalizedRecords,
    diagnostics: normalizedDiagnostics,
    capabilityId,
    capabilityVersion: LIBRARY_VERSION
  };
}
