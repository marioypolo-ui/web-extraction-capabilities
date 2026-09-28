import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewContributionDisclosure, disclosureDigest } from '../src/contribution-privacy.mjs';

const safe = () => [{ path: 'fixture.html', content: Buffer.from('<article>Synthetic article</article>') }];
const approval = (files) => ({ schemaVersion: 1, authorization: 'public-contribution',
  contentSha256: disclosureDigest(files), reviewed: true, containsPrivateData: false });

test('local contributions never imply permission to publish, including public site lists', () => {
  const files = safe();
  assert.equal(reviewContributionDisclosure({ files }).status, 'local-only');
  files[0].content = Buffer.from('https://www.example.org/procurement/');
  assert.equal(reviewContributionDisclosure({ files }).publicReady, false);
});

test('publication review covers exact paths and bytes; additions and edits revoke it', () => {
  const files = safe(); const review = approval(files);
  assert.equal(reviewContributionDisclosure({ files, review }).publicReady, true);
  files[0].content = Buffer.from('Changed business scope');
  assert.equal(reviewContributionDisclosure({ files, review }).publicReady, false);
  files[0].content = safe()[0].content; files[0].path = 'other.html';
  assert.equal(reviewContributionDisclosure({ files, review }).publicReady, false);
});

test('sensitive data is rejected even when marked reviewed; errors contain no sample or filename', () => {
  const fragments = [
    '<!-- token=' + 'SYNTHETIC_PRIVATE_VALUE' + ' -->',
    '<script>{"email":"synthetic.person@private.invalid"}</script>',
    '<div data-phone="138' + '00123456' + '">Synthetic person</div>',
    'https://example.test/a?sig=' + 'SYNTHETIC_PRIVATE_VALUE',
    'http://192.168.22.3/private',
    'C:\\Users\\SyntheticPerson\\Private\\report.html',
    '{"customerName":"SYNTHETIC_PRIVATE_VALUE"}',
    '&#116;oken=' + 'SYNTHETIC_PRIVATE_VALUE'
  ];
  for (const text of fragments) {
    const files = [{ path: 'private-customer.html', content: Buffer.from(text) }];
    const result = reviewContributionDisclosure({ files, review: approval(files) });
    assert.equal(result.status, 'rejected', text);
    assert.equal(result.publicReady, false);
    const output = JSON.stringify(result);
    assert.equal(output.includes('SYNTHETIC_PRIVATE_VALUE'), false);
    assert.equal(output.includes('private-customer'), false);
  }
});

test('screenshots/binary material require separate sanitization instead of silently bypassing text checks', () => {
  const files = [{ path: 'page.png', content: Buffer.from([137, 80, 78, 71, 0]) }];
  assert.equal(reviewContributionDisclosure({ files, review: approval(files) }).status, 'rejected');
});
