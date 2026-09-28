import https from 'node:https';
import { getContributionStatus } from './contribution-intake.mjs';

const REPOSITORY = 'marioypolo-ui/web-extraction-capabilities';
const hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const blank = () => ({ publicationVersion: 1, ok: false, mergeStatus: 'unverified',
  releaseStatus: 'unverified', reusable: false, adopted: false, reasons: [] });
const bindingFields = ['contributionKey', 'packSha256', 'eventId', 'verificationDigest'];
const recordMatches = (record, binding) => record?.schemaVersion === 1 &&
  Object.keys(record).length === 5 && bindingFields.every((key) => hex(record[key]) && record[key] === binding[key]);

// Pure evidence interpretation for tests. Only the fixed-origin reader below
// establishes where evidence came from; arbitrary imported JSON is not authority.
export function evaluatePublicationEvidence({ binding, pullRequest, recordAtMerge, releaseTag,
  release, releaseCommit, comparison, recordAtRelease } = {}) {
  const result = blank();
  if (!binding || !bindingFields.every((key) => hex(binding[key]))) return { ...result, reasons: ['PUBLICATION_BINDING_INVALID'] };
  if (pullRequest?.base?.repo?.full_name !== REPOSITORY || !Number.isSafeInteger(pullRequest.number) ||
    !['open', 'closed'].includes(pullRequest.state) || typeof pullRequest.merged !== 'boolean') {
    return { ...result, reasons: ['PUBLICATION_PR_INVALID'] };
  }
  result.pullRequestNumber = pullRequest.number;
  if (!pullRequest.merged) return { ...result, ok: true, mergeStatus: pullRequest.state === 'open' ? 'pending' : 'closed-unmerged',
    releaseStatus: 'not-applicable' };
  if (pullRequest.state !== 'closed' || !sha(pullRequest.merge_commit_sha) || !pullRequest.merged_at || !recordMatches(recordAtMerge, binding)) {
    return { ...result, reasons: ['MERGE_CONTRIBUTION_BINDING_MISSING'] };
  }
  result.mergeStatus = 'merged'; result.mergeCommit = pullRequest.merge_commit_sha;
  if (!releaseTag) return { ...result, ok: true, releaseStatus: 'not-requested' };
  if (release?.tag_name !== releaseTag || release.draft !== false || release.prerelease !== false ||
    typeof release.published_at !== 'string' || !release.published_at) {
    return { ...result, reasons: ['STABLE_RELEASE_EVIDENCE_MISSING'] };
  }
  if (!sha(releaseCommit) || !['ahead', 'identical'].includes(comparison?.status) ||
    comparison.base_commit?.sha !== result.mergeCommit || !recordMatches(recordAtRelease, binding)) {
    return { ...result, reasons: ['RELEASE_CONTRIBUTION_BINDING_MISSING'] };
  }
  return { ...result, ok: true, releaseStatus: 'published', releaseTag, releaseCommit };
}

// Public GitHub only, explicit opt-in query. No authentication, registry config,
// user credentials, redirects, submitted URLs, or automatic runtime telemetry.
function githubJson(suffix) {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: 'api.github.com', port: 443,
      path: `/repos/${REPOSITORY}/${suffix}`, headers: {
        'user-agent': 'web-extraction-capabilities-publication-status', accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(response.statusCode === 404 ? 'PUBLICATION_EVIDENCE_NOT_FOUND' : 'PUBLICATION_FETCH_FAILED')); return;
      }
      let size = 0; const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(); reject(new Error('PUBLICATION_RESPONSE_LIMIT')); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('PUBLICATION_FETCH_FAILED')));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('PUBLICATION_RESPONSE_INVALID')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('PUBLICATION_TIMEOUT')), 15000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('PUBLICATION_FETCH_FAILED')));
  });
}

async function bindingFor({ storeDir, contributionKey, eventId }) {
  if (!hex(contributionKey) || !hex(eventId)) throw new Error('PUBLICATION_BINDING_INVALID');
  const status = await getContributionStatus({ storeDir, contributionKey });
  if (!status.ok) throw new Error('LOCAL_CONTRIBUTION_EVIDENCE_UNAVAILABLE');
  const event = status.events.find((item) => item.eventId === eventId);
  if (!event || event.receipt.status !== 'verified' || event.receipt.verifiedContribution !== true ||
    event.receipt.publicReady !== true) throw new Error('LOCAL_VERIFIED_CONTRIBUTION_REQUIRED');
  return Object.fromEntries(bindingFields.map((key) => [key, key === 'contributionKey' ? contributionKey : event[key]]));
}

export async function prepareContributionIntegration(options = {}) {
  try { return { ok: true, record: { schemaVersion: 1, ...await bindingFor(options) } }; }
  catch (error) { return { ok: false, reasons: [safeReason(error)] }; }
}

const safeReason = (error) => /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'PUBLICATION_STATUS_FAILED';

export async function getContributionPublicationStatus(options = {}) {
  let progress = blank();
  try {
    const { pullRequestNumber, releaseTag } = options;
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 ||
      (releaseTag !== undefined && !/^v\d+\.\d+\.\d+$/.test(releaseTag))) throw new Error('PUBLICATION_QUERY_INVALID');
    const binding = await bindingFor(options);
    const pullRequest = await githubJson(`pulls/${pullRequestNumber}`);
    if (pullRequest.number !== pullRequestNumber || pullRequest.base?.repo?.full_name !== REPOSITORY) throw new Error('PUBLICATION_PR_INVALID');
    const readRecord = async (ref) => {
      const record = await githubJson(`contents/contributions/accepted/${binding.packSha256}.json?ref=${encodeURIComponent(ref)}`);
      if (record?.type !== 'file' || record.encoding !== 'base64' || typeof record.content !== 'string' ||
        !Number.isSafeInteger(record.size) || record.size > 4096 || record.content.length > 8192) throw new Error('PUBLICATION_RECORD_INVALID');
      const content = Buffer.from(record.content, 'base64');
      if (content.length !== record.size) throw new Error('PUBLICATION_RECORD_INVALID');
      try { return JSON.parse(content.toString('utf8')); } catch { throw new Error('PUBLICATION_RECORD_INVALID'); }
    };
    if (!pullRequest.merged) return evaluatePublicationEvidence({ binding, pullRequest });
    if (!sha(pullRequest.merge_commit_sha)) throw new Error('PUBLICATION_PR_INVALID');
    const recordAtMerge = await readRecord(pullRequest.merge_commit_sha);
    progress = evaluatePublicationEvidence({ binding, pullRequest, recordAtMerge });
    if (!progress.ok || !releaseTag) return progress;
    const release = await githubJson(`releases/tags/${encodeURIComponent(releaseTag)}`);
    const tag = await githubJson(`git/ref/tags/${encodeURIComponent(releaseTag)}`);
    let object = tag.object;
    for (let depth = 0; object?.type === 'tag' && depth < 4; depth += 1) {
      if (!sha(object.sha)) throw new Error('RELEASE_TAG_INVALID');
      object = (await githubJson(`git/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || !sha(object.sha)) throw new Error('RELEASE_TAG_INVALID');
    const releaseCommit = object.sha;
    const comparison = await githubJson(`compare/${pullRequest.merge_commit_sha}...${releaseCommit}?per_page=1`);
    const recordAtRelease = await readRecord(releaseCommit);
    const finalTag = await githubJson(`git/ref/tags/${encodeURIComponent(releaseTag)}`);
    if (finalTag.object?.sha !== tag.object?.sha || finalTag.object?.type !== tag.object?.type) throw new Error('RELEASE_TAG_CHANGED');
    return evaluatePublicationEvidence({ binding, pullRequest, recordAtMerge, releaseTag, release, releaseCommit, comparison, recordAtRelease });
  } catch (error) { return { ...progress, ok: false, releaseStatus: 'unverified', reasons: [safeReason(error)] }; }
}
