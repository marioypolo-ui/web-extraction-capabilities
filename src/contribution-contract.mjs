import { isBoundedPlainJson, isPublicUrlWithoutCredentials, hasSafePublicStrings, pathMapping, selector } from './problem-feedback.mjs';

export const CONTRIBUTION_PROTOCOL = Object.freeze({ schemaVersion: 1,
  kinds: ['capability', 'website-reference'],
  changeTypes: ['new-capability', 'capability-fix', 'website-reference'],
  entrySignature: 'input-v1', defaultDisclosure: 'local-only',
  contractSchema: 'schemas/contribution.schema.json',
  disclosureSchema: 'schemas/contribution-disclosure.schema.json',
  receiptSchema: 'schemas/contribution-receipt.schema.json',
  publicationSchema: 'schemas/contribution-publication.schema.json' });

export function safeContributionPath(value) {
  return typeof value === 'string' && value.length <= 200 &&
    value.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) &&
      !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

const version = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v);
const identifier = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const strings = (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 &&
  v.every((s) => typeof s === 'string' && s.trim() && s.length <= 2000);
const fields = (v, required, optional = []) => v && typeof v === 'object' && !Array.isArray(v) &&
  required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => [...required, ...optional].includes(k));

function offlineConfig(config) {
  if (!fields(config, [], ['mode', 'contentSelector', 'titleSelector', 'dateSelector', 'itemsPath', 'itemPath',
    'fields', 'contentFormat', 'actionUrlTemplate'])) return false;
  return Object.entries(config).every(([key, value]) => {
    if (key === 'mode') return ['auto', 'static', 'json'].includes(value);
    if (key.endsWith('Selector')) return selector(value);
    if (key === 'itemsPath' || key === 'itemPath') return (key === 'itemPath' && value === '') || pathMapping(value);
    if (key === 'contentFormat') return ['text', 'html'].includes(value);
    if (key === 'fields') return fields(value, [], ['title', 'url', 'publishedAt', 'summary', 'content']) &&
      Object.values(value).every(pathMapping);
    return typeof value === 'string' && value.length <= 2048 && (value.match(/\{id\}/g) || []).length === 1 &&
      isPublicUrlWithoutCredentials(value.replace('{id}', 'synthetic-id'));
  });
}

function documentExpectation(value) {
  if (value === null) return true;
  if (!fields(value, ['title', 'url', 'publishedAt', 'contentText', 'tables', 'images', 'attachments']) ||
    typeof value.title !== 'string' || typeof value.contentText !== 'string' ||
    !isPublicUrlWithoutCredentials(value.url) || (value.publishedAt !== null && typeof value.publishedAt !== 'string') ||
    !['tables', 'images', 'attachments'].every((key) => Array.isArray(value[key]))) return false;
  if (!value.tables.every((table) => fields(table, ['caption', 'rows']) && typeof table.caption === 'string' &&
    Array.isArray(table.rows) && table.rows.every((row) => Array.isArray(row) && row.every((cell) =>
      fields(cell, ['text', 'rowSpan', 'colSpan', 'header']) && typeof cell.text === 'string' &&
      Number.isInteger(cell.rowSpan) && cell.rowSpan >= 0 && Number.isInteger(cell.colSpan) && cell.colSpan >= 1 &&
      typeof cell.header === 'boolean')))) return false;
  return [['images', 'alt'], ['attachments', 'title']].every(([key, label]) => value[key].every((resource) =>
    fields(resource, ['url', label]) && isPublicUrlWithoutCredentials(resource.url) && typeof resource[label] === 'string'));
}

export function validateContributionContract(value) {
  const fail = (reasons, status = 'rejected') => ({ ok: false, status, reasons: [...new Set(reasons)] });
  if (value === null || value === undefined) return fail(['CONTRIBUTION_CONTRACT_REQUIRED'], 'needs-evidence');
  if (!isBoundedPlainJson(value, 16) || JSON.stringify(value).length > 200000) return fail(['CONTRACT_INVALID_DATA']);
  const reasons = [];
  if (!fields(value, ['schemaVersion', 'changeType', 'base', 'targetType', 'appliesTo', 'notAppliesTo',
    'conditions', 'dependencies', 'verification'], ['entryPoint']) || value.schemaVersion !== 1) {
    return fail(['CONTRACT_SCHEMA_INVALID']);
  }
  if (!CONTRIBUTION_PROTOCOL.changeTypes.includes(value.changeType)) reasons.push('CHANGE_TYPE_INVALID');
  if (!fields(value.base, ['capabilityId', 'capabilityVersion', 'libraryVersion']) ||
    !identifier(value.base.capabilityId) || !version(value.base.capabilityVersion) || !version(value.base.libraryVersion)) reasons.push('BASE_INVALID');
  if (!identifier(value.targetType) || !strings(value.appliesTo) || !strings(value.notAppliesTo)) reasons.push('SCOPE_REQUIRED');
  if (!fields(value.conditions, ['network', 'governmentDirect', 'login', 'human']) ||
    value.conditions.network !== 'offline' || value.conditions.governmentDirect !== true ||
    typeof value.conditions.login !== 'boolean' || typeof value.conditions.human !== 'boolean') reasons.push('CONDITIONS_INVALID');
  // External dependencies require a separately reviewed, pinned runner image.
  // No package installation or dependency resolution from untrusted submissions.
  if (!Array.isArray(value.dependencies) || value.dependencies.length) reasons.push('DEPENDENCY_REVIEW_REQUIRED');
  if (value.changeType === 'website-reference') {
    if (value.entryPoint !== undefined) reasons.push('REFERENCE_MUST_USE_EXISTING_IMPLEMENTATION');
  } else if (!fields(value.entryPoint, ['file', 'export', 'signature']) ||
    !safeContributionPath(value.entryPoint.file) || !value.entryPoint.file.endsWith('.mjs') ||
    !/^[A-Za-z_$][\w$]*$/.test(value.entryPoint.export) || value.entryPoint.signature !== 'input-v1') reasons.push('ENTRY_POINT_INVALID');
  const verification = value.verification;
  if (!fields(verification, ['command', 'cases'])) return fail([...reasons, 'VERIFICATION_REQUIRED']);
  const command = verification.command;
  if (!Array.isArray(command) || command.length < 3 || command[0] !== 'node' || command[1] !== '--test' ||
    !command.slice(2).every((item) => safeContributionPath(item) && item.endsWith('.test.mjs'))) reasons.push('TEST_COMMAND_INVALID');
  if (!Array.isArray(verification.cases) || !verification.cases.length || verification.cases.length > 100) return fail([...reasons, 'CASES_REQUIRED']);
  const ids = new Set();
  for (const item of verification.cases) {
    if (!fields(item, ['id', 'fixture', 'operation', 'url', 'expected', 'baselineExpectation'], ['config'])) {
      reasons.push('CASE_SCHEMA_INVALID'); continue;
    }
    if (!identifier(item.id) || ids.has(item.id)) reasons.push('CASE_ID_INVALID');
    ids.add(item.id);
    if (!safeContributionPath(item.fixture) || !/\.(html|json)$/.test(item.fixture)) reasons.push('FIXTURE_PATH_INVALID');
    if (!isPublicUrlWithoutCredentials(item.url)) reasons.push('CASE_URL_INVALID');
    if (item.config !== undefined && !offlineConfig(item.config)) reasons.push('CASE_CONFIG_INVALID');
    if (!['passes', 'fails'].includes(item.baselineExpectation)) reasons.push('BASELINE_EXPECTATION_INVALID');
    const expected = item.expected;
    if (item.operation === 'list') {
      if (!fields(expected, ['records', 'diagnosticCodes']) || !Array.isArray(expected.records) ||
        expected.records.some((r) => !fields(r, ['title', 'url'], ['publishedAt', 'summary']) ||
          typeof r.title !== 'string' || !r.title.trim() || !isPublicUrlWithoutCredentials(r.url) ||
          (r.publishedAt !== undefined && r.publishedAt !== null && typeof r.publishedAt !== 'string') ||
          (r.summary !== undefined && typeof r.summary !== 'string'))) reasons.push('RECORD_EXPECTATION_INVALID');
    } else if (item.operation === 'detail') {
      if (!fields(expected, ['document', 'diagnosticCodes']) || !documentExpectation(expected.document)) reasons.push('DOCUMENT_EXPECTATION_INVALID');
    } else reasons.push('OPERATION_INVALID');
    if (!Array.isArray(expected?.diagnosticCodes) || !expected.diagnosticCodes.every((code) =>
      typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code))) reasons.push('DIAGNOSTIC_EXPECTATION_REQUIRED');
  }
  const before = verification.cases.map((item) => item?.baselineExpectation);
  if (value.changeType === 'website-reference' ? before.some((x) => x !== 'passes') : !before.includes('fails')) reasons.push('BASELINE_FAILURE_REQUIRED');
  if (value.changeType === 'capability-fix' && !before.includes('passes')) reasons.push('OLD_BEHAVIOUR_CASE_REQUIRED');
  if (!hasSafePublicStrings(value, 'https://example.test/')) reasons.push('PRIVATE_DATA_DETECTED');
  return reasons.length ? fail(reasons) : { ok: true, status: 'ready-for-independent-validation', reasons: [] };
}
