// Standards validation uses separately acquired, pinned maintenance test tools.
// This never imports code from contribution directories.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packContribution, validateContribution, verifyContribution, receiveContribution, getContributionStatus,
  getContributionPublicationStatus, prepareContributionIntegration } from '../src/index.mjs';
import { inspectContributionTree } from '../src/contribution-validation.mjs';

let stage = 'tools';
try {
  const moduleDir = process.argv[2];
  if (!moduleDir || !path.isAbsolute(moduleDir)) throw new Error('PINNED_SCHEMA_TOOLS_REQUIRED');
  const require = createRequire(path.join(moduleDir, 'package.json'));
  assert.equal(require('ajv/package.json').version, '8.17.1');
  assert.equal(require('ajv-formats/package.json').version, '3.0.1');
  const Ajv = require('ajv/dist/2020').default;
  const addFormats = require('ajv-formats');
  // These strict lint options reject legitimate draft constructs (conditional
  // subschemas and tuple prefixes with rest items); core schema validation stays strict.
  const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, strictTuples: false });
  addFormats(ajv);
  const schemas = {};
  for (const name of ['detail-result', 'contribution', 'contribution-disclosure', 'contribution-receipt', 'contribution-publication']) {
    stage = `schema-${name}`;
    schemas[name] = JSON.parse(await fs.readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
    assert.equal(ajv.validateSchema(schemas[name]), true);
    ajv.addSchema(schemas[name]);
  }
  const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.getSchema(schema.$id)]));
  stage = 'behavior';
  let checks = 0;
  const check = (kind, value, expected = true) => {
    stage = `check-${checks}-${kind}`;
    assert.equal(validators[kind](value), expected, `SCHEMA_${kind.toUpperCase().replaceAll('-', '_')}_MISMATCH`);
    checks += 1;
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-schema-validation-'));
  for (const [index, example] of ['verified-capability-contribution', 'verified-website-reference-contribution'].entries()) {
    const sourceDir = fileURLToPath(new URL(`../examples/${example}/`, import.meta.url));
    const metadata = JSON.parse(await fs.readFile(path.join(sourceDir, 'contribution.json'), 'utf8'));
    check('contribution', metadata);
    const changed = structuredClone(metadata);
    changed.verification.command = ['node', '--test', '--test-name-pattern=green'];
    check('contribution', changed, false);
    if (metadata.changeType === 'new-capability') {
      const fix = structuredClone(metadata); fix.changeType = 'capability-fix';
      check('contribution', fix);
      fix.verification.cases = fix.verification.cases.filter((item) => item.baselineExpectation === 'fails');
      check('contribution', fix, false);
      const detail = structuredClone(metadata);
      detail.verification.cases = [detail.verification.cases[0]];
      const item = detail.verification.cases[0]; item.operation = 'detail';
      item.expected = { diagnosticCodes: [], document: { title: 'Synthetic', url: 'https://example.test/1', publishedAt: null,
        contentText: 'Full body', tables: [{ caption: 'Synthetic table', rows: [[{ text: 'Cell', rowSpan: 1, colSpan: 1, header: false }]] }], images: [], attachments: [] } };
      check('contribution', detail);
      item.expected.document.tables[0].rows[0][0].colSpan = 0;
      check('contribution', detail, false);
    }
    const contributionDir = path.join(root, `pack-${index}`);
    await packContribution({ sourceDir, outputDir: contributionDir });
    check('contribution-receipt', await validateContribution({ contributionDir }));
    check('contribution-receipt', await verifyContribution({ contributionDir }));
    const storeDir = path.join(root, `intake-${index}`);
    check('contribution-receipt', await receiveContribution({ storeDir, contributionDir }));
    const snapshot = await inspectContributionTree({ contributionDir });
    const publicationReview = { schemaVersion: 1, authorization: 'public-contribution', reviewed: true,
      containsPrivateData: false, contentSha256: snapshot.disclosure.contentSha256 };
    check('contribution-disclosure', publicationReview);
    check('contribution-disclosure', { ...publicationReview, reviewed: false }, false);
    const received = await receiveContribution({ storeDir, contributionDir, publicationReview });
    check('contribution-receipt', received);
    assert.equal(received.status, 'received');
    const queried = await getContributionStatus({ storeDir, contributionKey: received.contributionKey });
    check('contribution-receipt', queried);
    await fs.mkdir(path.join(storeDir, '.intake-lock'));
    check('contribution-receipt', await getContributionStatus({ storeDir, contributionKey: received.contributionKey }));
    await fs.rmdir(path.join(storeDir, '.intake-lock'));
    check('contribution-receipt', { ...queried, verifiedContribution: true }, false);
  }
  check('contribution-receipt', await validateContribution({ contributionDir: path.join(root, 'missing') }));
  check('contribution-receipt', await getContributionStatus({ storeDir: root, contributionKey: '../bad' }));
  check('contribution-publication', await getContributionPublicationStatus({ pullRequestNumber: -1 }));
  check('contribution-publication', await prepareContributionIntegration({ contributionKey: 'bad' }));
  // Synthetic shape checks, not fabricated evidence of a real published contribution.
  const published = { publicationVersion: 1, ok: true, mergeStatus: 'merged', releaseStatus: 'published',
    reusable: false, adopted: false, reasons: [], pullRequestNumber: 42,
    mergeCommit: 'a'.repeat(40), releaseCommit: 'b'.repeat(40), releaseTag: 'v0.3.0' };
  check('contribution-publication', published);
  check('contribution-publication', { ...published, mergeStatus: 'closed-unmerged' }, false);
  check('contribution-publication', { ...published, adopted: true }, false);
  const incomplete = { ...published }; delete incomplete.releaseCommit;
  check('contribution-publication', incomplete, false);
  console.log(JSON.stringify({ ok: true, schemaCount: Object.keys(schemas).length, checks, engine: 'ajv-8.17.1' }));
} catch (error) {
  const reason = /^[A-Z][A-Z0-9_]{0,99}$/.test(error?.message || '') ? error.message : 'SCHEMA_VALIDATION_FAILED';
  console.log(JSON.stringify({ ok: false, reason, stage }));
  process.exitCode = 1;
}
