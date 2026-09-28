import { createHash } from 'node:crypto';
import { hasSafePublicStrings } from './problem-feedback.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Identity is used for review freshness only; a hash does not anonymize a website.
export function disclosureDigest(files) {
  return digest(JSON.stringify(files.map(({ path, content }) => ({ path, sha256: digest(content) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}

function decoded(text) {
  return text.replace(/\\u([\da-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '';
    });
}

function sensitive(text) {
  const value = decoded(decoded(text));
  return !hasSafePublicStrings(value, 'https://example.test/') ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /(?:^|\D)1[3-9]\d{9}(?:\D|$)/.test(value) ||
    /(?:^|\D)\d{17}[0-9X](?:\D|$)/i.test(value) ||
    /[A-Z]:[\\/](?:Users|Documents and Settings)[\\/]/i.test(value) ||
    /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//.test(value) ||
    /["']?(?:customerName|clientName|applicationName|sourceApplication|身份证|客户名称|联系人|家庭住址)["']?\s*[:=]\s*["']?[^\s"'<>]+/i.test(value);
}

export function reviewContributionDisclosure({ files, review } = {}) {
  const reasons = [];
  if (!Array.isArray(files) || !files.length || files.length > 200) {
    return { publicReady: false, status: 'rejected', reasons: ['DISCLOSURE_FILES_INVALID'] };
  }
  let total = 0;
  for (const file of files) {
    if (typeof file?.path !== 'string' || !Buffer.isBuffer(file.content)) {
      reasons.push('DISCLOSURE_FILES_INVALID'); continue;
    }
    total += file.content.length;
    if (file.content.length > 1024 * 1024 || total > 5 * 1024 * 1024) reasons.push('DISCLOSURE_SIZE_LIMIT');
    if (!/\.(?:mjs|json|html|md|txt)$/.test(file.path) || file.content.includes(0)) {
      reasons.push('BINARY_OR_UNREVIEWABLE_CONTENT'); continue;
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.content); }
    catch { reasons.push('INVALID_TEXT_ENCODING'); continue; }
    if (sensitive(text) || sensitive(file.path)) reasons.push('PRIVATE_DATA_DETECTED');
  }
  if (reasons.length) return { publicReady: false, status: 'rejected', reasons: [...new Set(reasons)] };
  const contentSha256 = disclosureDigest(files);
  if (!review) return { publicReady: false, status: 'local-only', reasons: ['PUBLICATION_REVIEW_REQUIRED'], contentSha256 };
  if (review.schemaVersion !== 1 || review.authorization !== 'public-contribution' ||
    review.reviewed !== true || review.containsPrivateData !== false || review.contentSha256 !== contentSha256 ||
    Object.keys(review).some((key) => !['schemaVersion', 'authorization', 'reviewed', 'containsPrivateData', 'contentSha256'].includes(key))) {
    return { publicReady: false, status: 'local-only', reasons: ['PUBLICATION_REVIEW_INVALID_OR_STALE'], contentSha256 };
  }
  // This is an operator's disclosure attestation, not proof of user consent or
  // of complete anonymization. Independent code validation is still required.
  return { publicReady: true, status: 'reviewed-for-publication', reasons: [], contentSha256 };
}
