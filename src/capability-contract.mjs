const REQUIRED_STRINGS = ['id', 'version', 'type', 'scope', 'status', 'implementation'];
const REQUIRED_ARRAYS = ['detection', 'appliesTo', 'notAppliesTo', 'fixtures', 'tests'];
const SCOPES = ['generic', 'platform-family', 'site-specific'];
const STATUSES = ['supported', 'conditional', 'human-required', 'unsupported'];

function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[a-z]:/i.test(value) &&
    !value.split(/[\\/]/).includes('..')
  );
}

export function validateCapabilityManifest(manifest) {
  const errors = [];
  for (const field of REQUIRED_STRINGS) {
    if (typeof manifest?.[field] !== 'string' || !manifest[field].trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  for (const field of REQUIRED_ARRAYS) {
    if (!Array.isArray(manifest?.[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  if (!/^[a-z0-9-]+$/.test(manifest?.id || '')) {
    errors.push('id must use lowercase letters, digits, and hyphens');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest?.version || '')) {
    errors.push('version must be semantic version text');
  }
  if (!SCOPES.includes(manifest?.scope)) {
    errors.push(`scope must be one of: ${SCOPES.join(', ')}`);
  }
  if (!STATUSES.includes(manifest?.status)) {
    errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  }
  if (!manifest?.requirements || typeof manifest.requirements !== 'object') {
    errors.push('requirements must be an object');
  }
  for (const value of [
    manifest?.implementation,
    ...(manifest?.fixtures || []),
    ...(manifest?.tests || [])
  ]) {
    const pathValue = String(value || '').split('#')[0];
    if (!isSafeRelativePath(pathValue)) {
      errors.push(`referenced path must be relative and stay inside the project: ${value}`);
    }
  }
  return errors;
}
