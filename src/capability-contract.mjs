import { isIP } from 'node:net';

const REQUIRED_STRINGS = ['id', 'version', 'type', 'scope', 'status', 'implementation'];
const REQUIRED_ARRAYS = [
  'detection',
  'appliesTo',
  'notAppliesTo',
  'verifiedTargets',
  'fixtures',
  'tests'
];
const SCOPES = ['generic', 'platform-family', 'site-specific'];
const STATUSES = ['supported', 'conditional', 'human-required', 'unsupported'];
const TARGET_VERIFICATIONS = ['fixture-tested', 'live-tested', 'reported'];

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

function isPrivateHost(value) {
  const host = String(value || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (isIP(host) === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }
  return false;
}

export function validateVerifiedTarget(target, prefix = 'verifiedTarget') {
  const errors = [];
  if (!target || typeof target !== 'object') {
    return [`${prefix} must be an object`];
  }
  if (typeof target.name !== 'string' || !target.name.trim()) {
    errors.push(`${prefix}.name must be a non-empty string`);
  }
  let referenceUrl;
  try {
    referenceUrl = new URL(target.referenceUrl);
    if (!['http:', 'https:'].includes(referenceUrl.protocol)) {
      errors.push(`${prefix}.referenceUrl must use http or https`);
    }
    if (referenceUrl.username || referenceUrl.password || isPrivateHost(referenceUrl.hostname)) {
      errors.push(`${prefix}.referenceUrl must be a public URL without credentials`);
    }
  } catch {
    errors.push(`${prefix}.referenceUrl must be an absolute URL`);
  }
  if (!target.match || typeof target.match !== 'object') {
    errors.push(`${prefix}.match must be an object`);
  } else {
    if (typeof target.match.host !== 'string' || !target.match.host.trim()) {
      errors.push(`${prefix}.match.host must be a non-empty string`);
    } else if (
      referenceUrl &&
      referenceUrl.hostname.toLowerCase() !== target.match.host.toLowerCase()
    ) {
      errors.push(`${prefix}.match.host must match referenceUrl`);
    }
    if (
      target.match.pathPrefix !== undefined &&
      (typeof target.match.pathPrefix !== 'string' || !target.match.pathPrefix.startsWith('/'))
    ) {
      errors.push(`${prefix}.match.pathPrefix must be a string starting with /`);
    }
    if (
      target.match.hashPrefix !== undefined &&
      (typeof target.match.hashPrefix !== 'string' || !target.match.hashPrefix.startsWith('#'))
    ) {
      errors.push(`${prefix}.match.hashPrefix must be a string starting with #`);
    }
  }
  if (!TARGET_VERIFICATIONS.includes(target.verification)) {
    errors.push(`${prefix}.verification must be one of: ${TARGET_VERIFICATIONS.join(', ')}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target.verifiedAt || '')) {
    errors.push(`${prefix}.verifiedAt must use YYYY-MM-DD`);
  }
  if (!Array.isArray(target.evidence)) {
    errors.push(`${prefix}.evidence must be an array`);
  } else if (target.verification !== 'reported' && target.evidence.length === 0) {
    errors.push(`${prefix}.evidence is required for reusable references`);
  }
  return errors;
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
  for (const [index, target] of (manifest?.verifiedTargets || []).entries()) {
    errors.push(...validateVerifiedTarget(target, `verifiedTargets[${index}]`));
  }
  for (const value of [
    manifest?.implementation,
    ...(manifest?.fixtures || []),
    ...(manifest?.tests || []),
    ...(manifest?.verifiedTargets || []).flatMap((target) => target?.evidence || [])
  ]) {
    const pathValue = String(value || '').split('#')[0];
    if (!isSafeRelativePath(pathValue)) {
      errors.push(`referenced path must be relative and stay inside the project: ${value}`);
    }
  }
  return errors;
}
