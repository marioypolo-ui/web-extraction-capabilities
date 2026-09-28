import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { classifyProblem, reproduceProblem } from '../src/index.mjs';

test('site and application failures stay local even with a claimed parser failure', () => {
  for (const code of ['HTTP_ERROR', 'FETCH_FAILED', 'RATE_LIMITED', 'NETWORK_TIMEOUT']) {
    const result = classifyProblem({ diagnosticCodes: [code], reproduction: { status: 'reproduced' } });
    assert.equal(result.category, 'site-network-failure');
    assert.equal(result.autoSubmit, false);
    assert.equal(result.owner, 'application');
    assert.equal(result.verifiedContribution, false);
  }
  for (const code of ['AUTH_REQUIRED', 'CAPABILITY_DEPENDENCY_MISSING', 'INVALID_CONFIGURATION']) {
    assert.equal(classifyProblem({ diagnosticCodes: [code] }).category, 'application-problem');
  }
});

test('unknown causes, unknown diagnostics and self-reported success never become verified contributions', () => {
  for (const value of [{}, { passed: true }, { applicationVerification: { passed: true } },
    { reproduction: { status: 'not-reproduced' } },
    { diagnosticCodes: ['UNKNOWN_NEW_FAILURE'], reproduction: { status: 'reproduced' } }]) {
    const result = classifyProblem(value);
    assert.equal(result.category, 'unknown');
    assert.equal(result.verifiedContribution, false);
    assert.equal(result.autoSubmit, false);
  }
});

test('an actual offline mismatch is a local capability gap, not a central repair ticket', async () => {
  const report = JSON.parse(await fs.readFile(new URL('../examples/problem-feedback/list.json', import.meta.url), 'utf8'));
  const reproduction = await reproduceProblem(report);
  assert.equal(reproduction.status, 'reproduced');
  const result = classifyProblem({ reproduction });
  assert.equal(result.category, 'reproduced-capability-gap');
  assert.equal(result.nextAction, 'resolve-and-verify-in-application');
  assert.equal(result.owner, 'application');
  assert.equal(result.autoSubmit, false);
  assert.equal(result.verifiedContribution, false);
  assert.equal(JSON.stringify(result).includes(report.sample.content), false);
});

test('business/configuration causes override an offline mismatch; incomplete evidence remains unknown', () => {
  assert.equal(classifyProblem({ applicationIssue: true, reproduction: { status: 'reproduced' } }).category, 'application-problem');
  assert.equal(classifyProblem({ reproduction: { status: 'reproduced' } }).category, 'unknown');
});
