import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createGitHubClient, parseFeedbackIssue, prepareProblem, publishProblem } from '../scripts/problem-intake.mjs';
import { runReproductionInput } from '../scripts/reproduce-problem.mjs';
import { validateProblemReport } from '../src/problem-feedback.mjs';
import { LIBRARY_VERSION } from '../src/result.mjs';

const repository = 'example/extraction-library';
const root = fileURLToPath(new URL('..', import.meta.url));
const report = {
  schemaVersion: 1, sanitized: true, operation: 'detail', symptom: 'missing-body',
  pageUrl: 'https://example.test/detail/1', libraryVersion: '0.2.0',
  capabilityId: 'web-page-detail', capabilityVersion: '0.2.0',
  target: { title: 'Synthetic notice', url: 'https://example.test/detail/1' },
  sample: { format: 'html', stage: 'static', content: '<article><h1>Synthetic notice</h1><p>Complete body.</p></article>' },
  expected: { contentIncludes: ['Complete body.'] }
};
const feedbackBody = (value = report) => `### Feedback JSON\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`;
const issue = (number, extra = {}) => ({ number, title: '[Extraction feedback] Missing body',
  body: feedbackBody(), state: 'open', labels: [{ name: 'feedback' }], ...extra });
const labelNames = (value) => value.labels.map((item) => typeof item === 'string' ? item : item.name);

function mockGitHub(initialIssues, initialComments = {}) {
  const issues = new Map(initialIssues.map((item) => [item.number, structuredClone(item)]));
  const comments = new Map(Object.entries(initialComments).map(([number, values]) => [Number(number), structuredClone(values)]));
  const labels = new Map();
  const calls = [];
  let nextComment = 1000;
  const client = { async request(method, route, body) {
    calls.push({ method, route, body: structuredClone(body) });
    const url = new URL(route, 'https://api.example.test/');
    const pathname = url.pathname.slice(1);
    const page = Number(url.searchParams.get('page') || 1);
    const slice = (values) => structuredClone(values.slice((page - 1) * 100, page * 100));
    if (pathname === 'labels') {
      if (method === 'GET') return slice([...labels.values()]);
      if (method === 'POST') { labels.set(body.name, structuredClone(body)); return body; }
    }
    if (pathname === 'issues' && method === 'GET') return slice([...issues.values()]);
    const issueMatch = /^issues\/(\d+)$/.exec(pathname);
    if (issueMatch) {
      const item = issues.get(Number(issueMatch[1]));
      assert.ok(item, `Unexpected issue route: ${route}`);
      if (method === 'GET') return structuredClone(item);
      if (method === 'PATCH') { Object.assign(item, structuredClone(body)); return structuredClone(item); }
    }
    const commentMatch = /^issues\/(\d+)\/comments$/.exec(pathname);
    if (commentMatch) {
      const number = Number(commentMatch[1]);
      const values = comments.get(number) || [];
      if (method === 'GET') return slice(values);
      if (method === 'POST') {
        const comment = { id: nextComment++, body: body.body, user: { login: 'github-actions[bot]' } };
        values.push(comment); comments.set(number, values); return structuredClone(comment);
      }
    }
    const updateComment = /^issues\/comments\/(\d+)$/.exec(pathname);
    if (updateComment && method === 'GET') {
      const comment = [...comments.values()].flat().find((item) => item.id === Number(updateComment[1]));
      assert.ok(comment); return structuredClone(comment);
    }
    if (updateComment && method === 'PATCH') {
      const comment = [...comments.values()].flat().find((item) => item.id === Number(updateComment[1]));
      assert.ok(comment); comment.body = body.body; return structuredClone(comment);
    }
    throw new Error(`Unexpected mock API request: ${method} ${route}`);
  } };
  return { client, issues, comments, labels, calls };
}

async function prepared({ status = 'reproduced', current = issue(10), comment, spawnSync, environment = {}, client } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'web-problem-intake-'));
  const outputDir = path.join(parent, 'receipt');
  const worker = spawnSync || ((_command, _args, options) => {
    const value = JSON.parse(options.input);
    return { status: 0, stdout: JSON.stringify({
      ok: true, problemKey: validateProblemReport(value).problemKey, status,
      reportedVersion: value.libraryVersion, testedVersion: LIBRARY_VERSION,
      operation: value.operation, symptom: value.symptom, replayMode: 'offline',
      checks: [{ field: 'contentIncludes', passed: status === 'not-reproduced' }], diagnosticCodes: []
    }) };
  });
  const receipt = await prepareProblem({ event: { issue: current, comment, repository: { full_name: repository } },
    repository, outputDir, environment, spawnSync: worker, client });
  return { outputDir, receipt };
}

test('feedback parsing accepts only one bounded JSON section and a feedback title', () => {
  assert.equal(parseFeedbackIssue(issue(1)).ok, true);
  for (const invalid of [
    issue(1, { title: 'Unrelated issue' }),
    issue(1, { body: `${feedbackBody()}\n${feedbackBody()}` }),
    issue(1, { body: '### Feedback JSON\n\n{"raw":"unfenced"}' }),
    issue(1, { body: '### Feedback JSON\n\n```json\n{broken}\n```' }),
    issue(1, { body: feedbackBody({ ...report, command: 'untrusted-command' }) }),
    issue(1, { body: `### Feedback JSON\n\n\`\`\`json\n${' '.repeat(60001)}\n\`\`\`` })
  ]) assert.equal(parseFeedbackIssue(invalid).ok, false);
});

test('prepare isolates the worker environment, bounds execution and preserves existing output', async () => {
  let calls = 0;
  const result = await prepared({ environment: { GH_TOKEN: 'synthetic-test-only', NODE_OPTIONS: '--inspect', SystemRoot: 'C:\\Windows' },
    spawnSync(command, args, options) {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [path.join(root, 'scripts', 'reproduce-problem.mjs')]);
      assert.equal(options.cwd, root);
      assert.deepEqual(options.env, { SystemRoot: 'C:\\Windows' });
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 1024 * 1024);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      return { status: null, error: { code: 'ETIMEDOUT', message: 'synthetic-test-only' } };
    }
  });
  assert.equal(result.receipt.status, 'needs-maintainer');
  assert.equal(JSON.stringify(result.receipt).includes('synthetic-test-only'), false);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.outputDir, 'report.json'), 'utf8')), report);
  const before = await fs.readFile(path.join(result.outputDir, 'receipt.json'), 'utf8');
  await assert.rejects(() => prepareProblem({ event: { issue: issue(10) }, repository,
    outputDir: result.outputDir, environment: {}, spawnSync() { throw new Error('Must not spawn'); } }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(result.outputDir, 'receipt.json'), 'utf8'), before);
  const task = await fs.readFile(path.join(result.outputDir, 'maintenance-task.md'), 'utf8');
  assert.match(task, /untrusted data/);
  assert.match(task, /npm test/);
  assert.match(task, /release link/);
  assert.match(task, /Do not automatically upgrade/);
});

test('invalid feedback writes no sample and never invokes the worker', async () => {
  const current = issue(10, { body: '### Feedback JSON\n\n```json\n{"private":"synthetic-sensitive-input"}\n```' });
  const { outputDir, receipt } = await prepared({ current, spawnSync() { assert.fail('Invalid reports must not execute'); } });
  assert.equal(receipt.status, 'invalid');
  await assert.rejects(() => fs.readFile(path.join(outputDir, 'report.json')), { code: 'ENOENT' });
  for (const name of ['receipt.json', 'maintenance-task.md', 'context.json']) {
    assert.ok(!(await fs.readFile(path.join(outputDir, name), 'utf8')).includes('synthetic-sensitive-input'));
  }
});

test('prepare executes the real offline worker with an empty environment and returns only its receipt', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'web-problem-real-worker-'));
  const receipt = await prepareProblem({ event: { issue: issue(10) }, repository,
    outputDir: path.join(parent, 'receipt'), environment: {} });
  assert.equal(receipt.status, 'not-reproduced');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.problemKey, validateProblemReport(report).problemKey);
  assert.ok(receipt.checks.length > 0);
  assert.ok(receipt.checks.every((check) => check.passed));
  assert.ok(!JSON.stringify(receipt).includes(report.sample.content));
});

test('workflow dispatch fetches exactly its numeric issue through the injected client', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'web-problem-dispatch-'));
  const api = mockGitHub([issue(42, { body: 'Invalid feedback' })]);
  const receipt = await prepareProblem({ event: { inputs: { issue_number: '42' } }, repository,
    outputDir: path.join(parent, 'result'), client: api.client, environment: {} });
  assert.equal(receipt.status, 'invalid');
  assert.deepEqual(api.calls, [{ method: 'GET', route: 'issues/42', body: undefined }]);
});

test('a new sample comment reopens its closed canonical issue without changing the original report body', async () => {
  const current = issue(10, { state: 'closed' });
  const sample = structuredClone(report);
  sample.sample.content = '<article><h1>Synthetic notice</h1><p>New sanitized sample with missing content.</p></article>';
  const comment = { id: 77, issue_url: `https://api.github.com/repos/${repository}/issues/10`,
    body: `${feedbackBody(sample)}\n### Sanitized checks\n\n- [x] The sample contains no credentials or private data.`, user: { login: 'reporter-without-edit-permission' } };
  const api = mockGitHub([current], { 10: [comment] });
  const { outputDir, receipt } = await prepared({ current, comment, client: api.client });
  assert.equal(receipt.status, 'reproduced');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'report.json'), 'utf8')), sample);
  const context = JSON.parse(await fs.readFile(path.join(outputDir, 'context.json'), 'utf8'));
  assert.equal(context.commentId, 77);
  assert.equal(context.sourceUrl, `https://github.com/${repository}/issues/10#issuecomment-77`);
  await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(api.issues.get(10).state, 'open');
  assert.equal(api.issues.get(10).body, current.body);
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.ok(api.comments.get(10).some((item) => item.user.login === 'github-actions[bot]' && item.body.includes('#issuecomment-77')));
  assert.ok(api.calls.filter((call) => call.method === 'PATCH' && call.route === 'issues/10').every((call) => !Object.hasOwn(call.body, 'body')));
});

test('comment feedback with another problem key is invalid and never replays the sample', async () => {
  const other = { ...report, pageUrl: 'https://example.test/different/2', target: { ...report.target, url: 'https://example.test/different/2' } };
  const current = issue(10);
  const comment = { id: 78, issue_url: `https://api.github.com/repos/${repository}/issues/10`, body: feedbackBody(other) };
  const api = mockGitHub([current], { 10: [comment] });
  const { receipt } = await prepared({ current, comment, client: api.client, spawnSync() { assert.fail('Different-key comments must not replay'); } });
  assert.equal(receipt.status, 'invalid');
  assert.match(receipt.errors[0], /open a new issue/);
});

test('comment feedback may match a trusted bot key when the original form is no longer available', async () => {
  const current = issue(10, { title: `[Extraction feedback ${validateProblemReport(report).problemKey.slice(0, 16)}] detail/missing-body`, body: 'Archived report summary' });
  const comment = { id: 79, issue_url: `https://api.github.com/repos/${repository}/issues/10`, body: feedbackBody() };
  const api = mockGitHub([current], { 10: [
    { id: 12, user: { login: 'github-actions[bot]' }, body: `<!-- extraction-feedback:v1 key=${validateProblemReport(report).problemKey} -->` }, comment
  ] });
  const { receipt } = await prepared({ current, comment, client: api.client });
  assert.equal(receipt.status, 'reproduced');
});

test('an invalid comment keeps the original bot identity receipt and pending maintenance state', async () => {
  const problemKey = validateProblemReport(report).problemKey;
  const current = issue(10, { body: 'Archived body', labels: [{ name: 'feedback' }, { name: 'feedback/needs-maintainer' }] });
  const originalReceipt = { id: 5, user: { login: 'github-actions[bot]' },
    body: `<!-- extraction-feedback:receipt v1 -->\n<!-- extraction-feedback:v1 key=${problemKey} -->\nOriginal valid receipt.` };
  const comment = { id: 81, issue_url: `https://api.github.com/repos/${repository}/issues/10`,
    body: '### Feedback JSON\n\n```json\n{invalid private-sample}\n```', user: { login: 'reporter' } };
  const api = mockGitHub([current], { 10: [originalReceipt, comment] });
  const { outputDir, receipt } = await prepared({ current, comment, client: api.client,
    spawnSync() { assert.fail('Invalid comment must not replay'); } });
  assert.equal(receipt.status, 'invalid');
  const options = { outputDir, regression: 'success', client: api.client, repository, environment: {} };
  await publishProblem(options);
  await publishProblem(options);
  assert.equal(api.comments.get(10).find((item) => item.id === 5).body, originalReceipt.body);
  assert.equal(api.comments.get(10).filter((item) => item.body.includes('extraction-feedback:receipt comment=81')).length, 1);
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.equal(api.issues.get(10).state, 'open');
  assert.ok(api.comments.get(10).filter((item) => item.user.login === 'github-actions[bot]').every((item) => !item.body.includes('private-sample')));
});

test('dispatch comment replay rejects a comment associated with another issue', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'web-problem-dispatch-comment-'));
  const comment = { id: 80, issue_url: `https://api.github.com/repos/${repository}/issues/999`, body: feedbackBody() };
  const api = mockGitHub([issue(10)], { 999: [comment] });
  await assert.rejects(() => prepareProblem({ event: { inputs: { issue_number: '10', comment_id: '80' } },
    repository, outputDir: path.join(parent, 'receipt'), client: api.client, environment: {},
    spawnSync() { assert.fail('Mismatched comment must not replay'); } }), /does not belong/);
});

test('new feedback receives a canonical title, standard labels and one updatable safe receipt', async () => {
  const current = issue(10, { labels: [{ name: 'feedback' }, { name: 'team-owned' }] });
  const api = mockGitHub([current]);
  const { outputDir, receipt } = await prepared({ current, environment: { GITHUB_RUN_ID: '123' } });
  const args = { outputDir, regression: 'success', client: api.client, repository, environment: {} };
  const result = await publishProblem(args);
  assert.equal(result.canonicalNumber, 10);
  assert.equal(api.issues.get(10).title, `[Extraction feedback ${receipt.problemKey.slice(0, 16)}] detail/missing-body`);
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.ok(labelNames(api.issues.get(10)).includes('team-owned'));
  assert.equal(api.labels.size, 5);
  assert.match(api.comments.get(10)[0].body, /extraction-feedback:v1 key=[a-f0-9]{64}/);
  assert.match(api.comments.get(10)[0].body, /actions\/runs\/123#artifacts/);
  assert.ok(!api.comments.get(10)[0].body.includes(report.sample.content));
  await publishProblem(args);
  assert.equal(api.comments.get(10).length, 1);
});

test('two valid reports without bot receipts choose the earlier issue without replaying its sample', async () => {
  const api = mockGitHub([issue(10), issue(4)]);
  const { outputDir } = await prepared();
  const result = await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(result.canonicalNumber, 4);
  assert.equal(api.issues.get(10).state, 'closed');
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/duplicate'));
  assert.equal(api.issues.get(4).state, 'open');
  assert.match(api.comments.get(10)[0].body, /#4/);
  assert.match(api.comments.get(4)[0].body, /Additional sample: #10/);
});

test('current issue remains canonical when the only equivalent issue is newer', async () => {
  const api = mockGitHub([issue(10), issue(20)]);
  const { outputDir } = await prepared();
  const result = await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(result.canonicalNumber, 10);
  assert.equal(api.issues.get(10).state, 'open');
});

test('an earlier corrected issue inherits pending evidence and closes every other active matching issue', async () => {
  const problemKey = validateProblemReport(report).problemKey;
  const corrected = issue(10, { state: 'closed', labels: [{ name: 'feedback' }, { name: 'feedback/invalid' }] });
  const originalReceipt = { id: 5, user: { login: 'github-actions[bot]' },
    body: `<!-- extraction-feedback:receipt v1 -->\n<!-- extraction-feedback:v1 key=${problemKey} -->\nPrior canonical reproduced this issue.` };
  const oldCanonical = issue(20, { labels: [{ name: 'feedback' }, { name: 'feedback/needs-maintainer' }, { name: 'team-owned' }] });
  const anotherActive = issue(30, { labels: [{ name: 'feedback' }] });
  const historical = issue(40, { state: 'closed', labels: [{ name: 'feedback' }, { name: 'feedback/duplicate' }] });
  const api = mockGitHub([corrected, oldCanonical, anotherActive, historical], { 20: [originalReceipt] });
  const { outputDir } = await prepared({ current: corrected, status: 'not-reproduced' });
  const result = await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(result.canonicalNumber, 10);
  assert.equal(api.issues.get(10).state, 'open');
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.deepEqual([...api.issues.values()].filter((item) => item.state === 'open').map((item) => item.number), [10]);
  for (const number of [20, 30]) {
    assert.equal(api.issues.get(number).state, 'closed');
    assert.ok(labelNames(api.issues.get(number)).includes('feedback/duplicate'));
    assert.ok(!labelNames(api.issues.get(number)).includes('feedback/needs-maintainer'));
    assert.ok(api.comments.get(number).some((item) => item.body.includes('Canonical maintenance issue: #10')));
    assert.ok(api.comments.get(10).some((item) => item.body.includes(`#${number}`)));
  }
  assert.ok(labelNames(api.issues.get(20)).includes('team-owned'));
  assert.equal(api.issues.get(20).body, oldCanonical.body);
  assert.equal(api.comments.get(20).find((item) => item.id === 5).body, originalReceipt.body);
  assert.ok(!api.calls.some((call) => call.method !== 'GET' && /^issues\/40(?:\/|$)/.test(call.route)));
});

test('canonical matching traverses issue and comment pages, trusts only bot markers, and ignores pull requests', async () => {
  const problemKey = validateProblemReport(report).problemKey;
  const fillers = Array.from({ length: 100 }, (_, index) => issue(index + 100, { body: 'Unrelated data' }));
  const comments = {
    1: [{ id: 1, user: { login: 'untrusted-author' }, body: `<!-- extraction-feedback:v1 key=${problemKey} -->` }],
    4: [...Array.from({ length: 100 }, (_, index) => ({ id: index + 10, user: { login: 'other' }, body: 'Other comment' })),
      { id: 999, user: { login: 'github-actions[bot]' }, body: `<!-- extraction-feedback:v1 key=${problemKey} -->` }]
  };
  const api = mockGitHub([...fillers, issue(10), issue(1, { body: 'Unrelated data' }),
    issue(2, { pull_request: {} }), issue(4, { title: 'Old canonical', body: 'Old report no longer in current form' })], comments);
  const { outputDir } = await prepared();
  const result = await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(result.canonicalNumber, 4);
  assert.ok(api.calls.some((call) => call.route === 'issues?state=all&labels=feedback&per_page=100&page=2'));
  assert.ok(api.calls.some((call) => call.route === 'issues/4/comments?per_page=100&page=2'));
});

for (const [status, regression] of [['reproduced', 'success'], ['needs-maintainer', 'success'], ['not-reproduced', 'failure']]) {
  test(`closed canonical reopens for ${status} with regression ${regression}`, async () => {
    const api = mockGitHub([issue(10), issue(4, { state: 'closed', labels: [{ name: 'feedback' }, { name: 'owned' }] })]);
    const { outputDir } = await prepared({ status });
    await publishProblem({ outputDir, regression, client: api.client, repository, environment: {} });
    assert.equal(api.issues.get(4).state, 'open');
    assert.ok(labelNames(api.issues.get(4)).includes('feedback/needs-maintainer'));
    assert.ok(labelNames(api.issues.get(4)).includes('owned'));
  });
}

for (const canonicalState of ['open', 'closed']) {
  test(`a non-reproducing sample preserves the ${canonicalState} canonical state and existing pending label`, async () => {
    const api = mockGitHub([issue(10), issue(4, { state: canonicalState, labels: [{ name: 'feedback' }, { name: 'feedback/needs-maintainer' }] })]);
    const { outputDir } = await prepared({ status: 'not-reproduced' });
    await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
    assert.equal(api.issues.get(4).state, canonicalState);
    assert.ok(labelNames(api.issues.get(4)).includes('feedback/needs-maintainer'));
  });
}

test('invalid edits do not close or clear an existing maintenance issue and never echo its raw body', async () => {
  const current = issue(10, { body: 'Invalid synthetic-private-body', labels: [{ name: 'feedback/needs-maintainer' }, { name: 'owned' }] });
  const api = mockGitHub([current]);
  const { outputDir } = await prepared({ current });
  await publishProblem({ outputDir, regression: 'success', client: api.client, repository, environment: {} });
  assert.equal(api.issues.get(10).state, 'open');
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/invalid'));
  assert.ok(labelNames(api.issues.get(10)).includes('owned'));
  assert.ok(!api.comments.get(10)[0].body.includes('synthetic-private-body'));
});

test('invalid issue-body receipts preserve the valid key for later comments and duplicate detection', async () => {
  const problemKey = validateProblemReport(report).problemKey;
  const current = issue(10, { body: 'The original report was removed.', labels: [{ name: 'feedback' }, { name: 'feedback/needs-maintainer' }] });
  const originalReceipt = { id: 5, user: { login: 'github-actions[bot]' },
    body: `<!-- extraction-feedback:receipt v1 -->\n<!-- extraction-feedback:v1 key=${problemKey} -->\nOriginal valid receipt.` };
  const api = mockGitHub([current], { 10: [originalReceipt] });
  const { outputDir } = await prepared({ current });
  const options = { outputDir, regression: 'success', client: api.client, repository, environment: {} };
  await publishProblem(options);
  await publishProblem(options);
  assert.equal(api.comments.get(10).find((item) => item.id === 5).body, originalReceipt.body);
  assert.equal(api.comments.get(10).filter((item) => item.body.includes('extraction-feedback:receipt invalid-body v1')).length, 1);
  assert.ok(labelNames(api.issues.get(10)).includes('feedback/needs-maintainer'));
  assert.equal(api.issues.get(10).state, 'open');

  const comment = { id: 82, issue_url: `https://api.github.com/repos/${repository}/issues/10`, body: feedbackBody() };
  const followup = await prepared({ current: api.issues.get(10), comment, client: api.client });
  assert.equal(followup.receipt.status, 'reproduced');
  assert.equal(followup.receipt.problemKey, problemKey);

  const duplicate = issue(20);
  api.issues.set(20, duplicate);
  const duplicatePrepared = await prepared({ current: duplicate });
  const published = await publishProblem({ outputDir: duplicatePrepared.outputDir, regression: 'success',
    client: api.client, repository, environment: {} });
  assert.equal(published.canonicalNumber, 10);
  assert.equal(api.issues.get(20).state, 'closed');
});

test('the HTTP client fixes the HTTPS API origin and fails without exposing server errors or authentication', async () => {
  const secret = 'synthetic-token-for-test';
  const client = createGitHubClient({ repository, token: secret, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/extraction-library/issues/10');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${secret}`);
    return { ok: false, status: 403, text: async () => secret };
  } });
  await assert.rejects(() => client.request('GET', 'issues/10'), (error) => error.message === 'GitHub request failed (HTTP 403).');
  await assert.rejects(() => client.request('GET', 'https://attacker.test/'), /Invalid GitHub API route/);
  const failed = createGitHubClient({ repository, token: secret, fetchImpl: async () => { throw new Error(secret); } });
  await assert.rejects(() => failed.request('GET', 'issues/10'), (error) => error.message === 'GitHub request failed.');
});

test('the worker rejects oversized or malformed input and does not evaluate sample JavaScript', async () => {
  for (const text of ['{invalid synthetic-private-input', ' '.repeat(60001)]) {
    const result = await runReproductionInput(text);
    assert.equal(result.status, 'invalid');
    assert.ok(!JSON.stringify(result).includes('synthetic-private-input'));
  }
  globalThis.feedbackSampleExecuted = false;
  const scripted = structuredClone(report);
  scripted.sample.content += '<script>globalThis.feedbackSampleExecuted = true</script>';
  const result = await runReproductionInput(JSON.stringify(scripted));
  assert.equal(globalThis.feedbackSampleExecuted, false);
  assert.ok(!JSON.stringify(result).includes(scripted.sample.content));
  delete globalThis.feedbackSampleExecuted;
});
