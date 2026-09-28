// Routing advice for local diagnostics, never proof of a verified contribution.
// This function neither uploads reports nor trusts application verification claims.
const SITE = new Set(['HTTP_ERROR', 'FETCH_FAILED', 'RATE_LIMITED', 'NETWORK_TIMEOUT']);
const APPLICATION = new Set(['AUTH_REQUIRED', 'AUTH_SESSION_REQUIRED', 'HUMAN_VERIFICATION_REQUIRED',
  'CAPABILITY_DEPENDENCY_MISSING', 'INVALID_CONFIGURATION', 'CONFIG_INVALID', 'CONFIG_REQUIRED',
  'DYNAMIC_CONFIGURATION_REQUIRED', 'ACTION_LINK_REQUIRES_CONFIGURATION', 'SELECTOR_NO_MATCH',
  'API_RESPONSE_SHAPE_MISMATCH']);
const PARSING = new Set(['ZERO_RECORDS', 'UNSUPPORTED_STRUCTURE', 'DETAIL_CONTENT_NOT_FOUND',
  'LOW_CONFIDENCE_CONTENT', 'MALFORMED_HTML', 'INVALID_RESOURCE_URL', 'STRUCTURED_DATA_INVALID',
  'STRUCTURED_DATA_AMBIGUOUS', 'STRUCTURED_DATA_URL_MISMATCH', 'EMBEDDED_CONTENT_NOT_EXTRACTED',
  'MULTIPAGE_CONTENT_DETECTED', 'MIGRATED_ADAPTER_WARNING']);

export function classifyProblem(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const reproduction = value.reproduction;
  const codes = [value.diagnosticCodes, reproduction?.diagnosticCodes]
    .flatMap((items) => Array.isArray(items) ? items : []);
  let category = 'unknown';
  let nextAction = 'diagnose-locally';
  if (codes.some((code) => SITE.has(code))) {
    category = 'site-network-failure';
    nextAction = 'restore-site-or-network';
  } else if (value.applicationIssue === true || codes.some((code) => APPLICATION.has(code))) {
    category = 'application-problem';
    nextAction = 'correct-application-configuration-or-policy';
  } else if (codes.every((code) => PARSING.has(code)) &&
    reproduction?.ok === true && reproduction.status === 'reproduced' &&
    Array.isArray(reproduction.checks) && reproduction.checks.some((check) => check?.passed === false)) {
    category = 'reproduced-capability-gap';
    nextAction = 'resolve-and-verify-in-application';
  }
  return { classificationVersion: 1, category, owner: 'application', nextAction,
    autoSubmit: false, verifiedContribution: false };
}
