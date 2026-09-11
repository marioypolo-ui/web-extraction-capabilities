import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { extractHtmlDetail } from '../src/detail-html.mjs';

const url = 'https://example.test/news/item.html';
const extract = (html, config) => extractHtmlDetail({ html, url, config });
const codes = (result) => result.diagnostics.map((item) => item.code);

test('extracts scoped full article, structured tables and absolute media URLs', async () => {
  const html = await fs.readFile(new URL('../fixtures/detail-article.html', import.meta.url), 'utf8');
  const result = extract(html);
  assert.equal(result.document.title, 'Notice heading');
  assert.equal(result.document.url, url);
  assert.equal(result.document.publishedAt, '2026-09-11');
  assert.match(result.document.contentText, /First important paragraph with <limits> & details\./);
  assert.match(result.document.contentText, /Nested paragraph/);
  assert.doesNotMatch(result.document.contentText, /secret|distraction|Script fake|Style fake|footer|Home|Global|Comment-only/);
  assert.deepEqual(result.document.tables, [{
    caption: 'Purchase quantities',
    rows: [
      [{ text: 'Item', rowSpan: 2, colSpan: 1, header: true }, { text: 'Quantity', rowSpan: 1, colSpan: 2, header: true }],
      [{ text: 'Low', rowSpan: 1, colSpan: 1, header: true }, { text: 'High', rowSpan: 1, colSpan: 1, header: true }],
      [{ text: 'Desk', rowSpan: 1, colSpan: 1, header: false }, { text: '2', rowSpan: 1, colSpan: 1, header: false }, { text: '4', rowSpan: 1, colSpan: 1, header: false }]
    ]
  }]);
  assert.deepEqual(result.document.images, [
    { url: 'https://example.test/img/chart.png', alt: 'Chart & values' },
    { url: 'https://example.test/img/large.png', alt: 'Diagram' }
  ]);
  assert.deepEqual(result.document.attachments.map((item) => item.url), [
    'https://example.test/files/spec.PDF?download=1',
    'https://example.test/download?id=42',
    'https://example.test/opaque?id=73'
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test('supports common CMS containers independently of surrounding page chrome', () => {
  for (const name of ['TRS_Editor', 'v_news_content', 'rich_media_content', 'article-content', 'entry-content', 'news-content', 'detail-content']) {
    const result = extract(`<h1>Title</h1><div id="${name}"><p>Actual body.</p></div><div>Unrelated surrounding text.</div>`);
    assert.equal(result.document.contentText, 'Actual body.');
    assert.equal(result.document.title, 'Title');
    assert.ok(!codes(result).includes('LOW_CONFIDENCE_CONTENT'), name);
  }
});

test('supports tag, id, class, attribute and descendant selectors with quoted spaces', () => {
  const result = extract('<main><h2 data-name="chosen title">Selected title</h2><div class="stamp" data-date="2026-08-09">2026年8月9日</div><section id="body" class="copy" data-kind="full text"><p>Chosen body</p></section></main>', {
    contentSelector: 'main section#body.copy[data-kind="full text"]',
    titleSelector: '[data-name="chosen title"]',
    dateSelector: 'main .stamp[data-date]'
  });
  assert.equal(result.document.title, 'Selected title');
  assert.equal(result.document.contentText, 'Chosen body');
  assert.equal(result.document.publishedAt, '2026-08-09');
});

test('unsupported and malformed selector configurations never silently fall back', () => {
  for (const selector of ['article > p', 'article, main', ':first-child', 'a[href^="/"]', '[', '', 42, 'article + p', 'article~p']) {
    const result = extract('<article><p>Real body.</p></article>', { contentSelector: selector });
    assert.equal(result.document, null, String(selector));
    assert.ok(codes(result).includes('CONFIG_INVALID'), String(selector));
  }
  for (const config of [null, [], 'article']) {
    assert.ok(codes(extract('<article>Body</article>', config)).includes('CONFIG_INVALID'));
  }
});

test('explicit unmatched content and metadata selectors do not silently use automatic sources', () => {
  const html = '<title>Fallback title</title><meta property="article:published_time" content="2026-09-11"><article><h1>Heading</h1><p>Body</p></article>';
  const missingContent = extract(html, { contentSelector: '#missing' });
  assert.equal(missingContent.document, null);
  assert.ok(codes(missingContent).includes('SELECTOR_NO_MATCH'));
  const missingMetadata = extract(html, { titleSelector: '.missing-title', dateSelector: '.missing-date' });
  assert.equal(missingMetadata.document.title, '');
  assert.equal(missingMetadata.document.publishedAt, null);
  assert.equal(codes(missingMetadata).filter((code) => code === 'SELECTOR_NO_MATCH').length, 2);
});

test('JSON-LD Article, NewsArticle and BlogPosting bodies are supported with metadata', () => {
  for (const type of ['Article', 'NewsArticle', 'BlogPosting']) {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': type, headline: 'Structured title', datePublished: '2026-09-10T12:00:00Z', articleBody: 'Structured body.\nSecond paragraph.' }] })}</script></head><body><div id="app"></div></body></html>`;
    const result = extract(html);
    assert.equal(result.document.title, 'Structured title');
    assert.equal(result.document.contentText, 'Structured body.\nSecond paragraph.');
    assert.equal(result.document.publishedAt, '2026-09-10');
  }
});

test('invalid JSON-LD is diagnosed without hiding a real visible article', () => {
  const result = extract('<script type="application/ld+json">{broken</script><article><p>Visible body.</p></article>');
  assert.equal(result.document.contentText, 'Visible body.');
  assert.ok(codes(result).includes('STRUCTURED_DATA_INVALID'));
});

test('a generic prose container is a diagnosed heuristic and navigation lists are rejected', () => {
  const prose = 'This is a long independent paragraph explaining the complete announcement and all relevant details. ';
  const result = extract(`<div class="layout"><nav>${prose.repeat(6)}</nav><div class="unknown-body"><p>${prose}</p><p>${prose}</p></div></div>`);
  assert.equal(result.document.contentText, `${prose.trim()}\n${prose.trim()}`);
  assert.ok(codes(result).includes('LOW_CONFIDENCE_CONTENT'));
  for (const wrapper of ['div', 'main', 'article']) {
    const list = extract(`<${wrapper}><h1>News list</h1><ul>${Array.from({ length: 8 }, (_, i) => `<li><a href="/${i}">Announcement number ${i} with a sufficiently descriptive title</a></li>`).join('')}</ul></${wrapper}>`);
    assert.equal(list.document, null, wrapper);
    assert.ok(codes(list).includes('DETAIL_CONTENT_NOT_FOUND'));
  }
});

test('full content is never truncated by default', () => {
  const body = 'Long complete paragraph. '.repeat(12000);
  assert.equal(extract(`<article><p>${body}</p></article>`).document.contentText, body.trim());
});

test('publication metadata does not use a deadline from ordinary body prose', () => {
  const result = extract('<title>Document title</title><article><p>Deadline: 2026-12-31. A login and CAPTCHA tutorial.</p><time>截止时间：2026-12-31</time></article>');
  assert.equal(result.document.publishedAt, null);
  assert.equal(result.document.title, 'Document title');
  assert.ok(!codes(result).includes('HUMAN_VERIFICATION_REQUIRED'));
  assert.ok(!codes(result).includes('AUTH_SESSION_REQUIRED'));
  assert.equal(extract('<article><time datetime="2026-09-07"></time><p>Body</p></article>').document.publishedAt, '2026-09-07');
});

test('recognizes actual challenge, authentication and dynamic shells without keyword false positives', () => {
  assert.ok(codes(extract('<form><label>验证码</label><input name="captcha"><button>验证</button></form>')).includes('HUMAN_VERIFICATION_REQUIRED'));
  assert.ok(codes(extract('<div class="g-recaptcha" data-sitekey="synthetic-public-widget"></div>')).includes('HUMAN_VERIFICATION_REQUIRED'));
  assert.ok(codes(extract('<main><h1>登录</h1><form><input type="password"><button>Login</button></form></main>')).includes('AUTH_SESSION_REQUIRED'));
  assert.ok(codes(extract('<div id="app"></div><script src="/app.js"></script>')).includes('DYNAMIC_RENDERING_REQUIRED'));
  assert.ok(codes(extract('<article><p>Readers can log in to discuss this CAPTCHA tutorial.</p><form><input type="password"></form></article>')).every((code) => !['AUTH_SESSION_REQUIRED', 'HUMAN_VERIFICATION_REQUIRED'].includes(code)));
});

test('unsafe resource URLs and action-only attachments remain explicit, scoped diagnostics', () => {
  const result = extract('<article><p>Visible body.</p><img src="https://user:pass@example.test/private.png"><img src="file:///secret.png"><a href="javascript:download(42)">下载附件</a><a href="https://user:pass@example.test/a.pdf">Private</a><a href="data:text/plain,x" download>Unsafe</a><a href="#" onclick="downloadFile()">附件</a></article>');
  assert.deepEqual(result.document.images, []);
  assert.deepEqual(result.document.attachments, []);
  assert.ok(codes(result).includes('INVALID_RESOURCE_URL'));
  assert.ok(codes(result).includes('ACTION_LINK_REQUIRES_CONFIGURATION'));
  assert.ok(!JSON.stringify(result.diagnostics).includes('user:pass'));
});

test('iframes and multi-page body links diagnose incomplete content', () => {
  const result = extract('<article><p>First page of body.</p><iframe src="/embedded"></iframe><div class="pagination"><a href="?page=2">下一页</a></div></article>');
  assert.ok(codes(result).includes('EMBEDDED_CONTENT_NOT_EXTRACTED'));
  assert.ok(codes(result).includes('MULTIPAGE_CONTENT_DETECTED'));
  assert.doesNotMatch(result.document.contentText, /下一页/);
});

test('comments, quoted angle brackets and script raw text cannot create false content nodes', () => {
  const result = extract(`<!-- <article>Fake body.</article> --><script>const a = '<article><p>Fake script</p></article><!--';</script><article><p title="a > b">Before <span>nested</span> after.</p><script>const b = '-->';</script><p>End &#x1F600; &#1114112; &#0;.</p></article>`);
  assert.equal(result.document.contentText, 'Before nested after.\nEnd 😀 � �.');
  assert.ok(!codes(result).includes('MALFORMED_HTML'));
});

test('optional HTML end tags and damaged markup preserve available text and table cells', () => {
  const optional = extract('<article><p>First<p>Second<table><tr><td>One<td colspan="2">Two</table></article>');
  assert.match(optional.document.contentText, /First\nSecond/);
  assert.equal(optional.document.tables[0].rows[0].length, 2);
  assert.equal(optional.document.tables[0].rows[0][1].colSpan, 2);
  const damaged = extract('<article><p>Available <b>bold</article>');
  assert.match(damaged.document.contentText, /Available bold/);
  assert.ok(codes(damaged).includes('MALFORMED_HTML'));
});

test('images-only or attachment-only articles remain useful and empty documents are diagnosed', () => {
  assert.equal(extract('<article><img src="/scan.png" alt="Scanned notice"></article>').document.images.length, 1);
  assert.equal(extract('<article><a href="/document.docx">Document</a></article>').document.attachments.length, 1);
  for (const html of ['', '<html><body></body></html>', '<article><h1>Only title</h1><p hidden>Hidden body</p></article>']) {
    const result = extract(html);
    assert.equal(result.document, null);
    assert.ok(codes(result).includes('DETAIL_CONTENT_NOT_FOUND'));
  }
});

test('nested tables remain separate with only their own rows and captions', () => {
  const result = extract('<article><table><caption>Outer</caption><tr><td>A<table><caption>Inner</caption><tr><th>B</th></tr></table></td></tr></table></article>');
  assert.equal(result.document.tables.length, 2);
  assert.equal(result.document.tables[0].caption, 'Outer');
  assert.equal(result.document.tables[0].rows.length, 1);
  assert.equal(result.document.tables[1].caption, 'Inner');
  assert.equal(result.document.tables[1].rows[0][0].header, true);
});

test('invalid page URL is diagnosed without throwing or including embedded credentials', () => {
  for (const invalidUrl of ['file:///private.html', 'https://user:pass@example.test/', 'not a URL']) {
    const result = extractHtmlDetail({ html: '<article><p>Body</p></article>', url: invalidUrl });
    assert.equal(result.document, null);
    assert.ok(codes(result).includes('CONFIG_INVALID'));
    assert.ok(!JSON.stringify(result).includes('user:pass'));
  }
});

test('an iframe-only or action-only body returns explicit incomplete-content diagnostics', () => {
  const embedded = extract('<article><h1>Embedded notice</h1><iframe src="/body"></iframe></article>');
  assert.equal(embedded.document, null);
  assert.ok(codes(embedded).includes('EMBEDDED_CONTENT_NOT_EXTRACTED'));
  const action = extract('<article><a href="javascript:loadBody()">加载全文</a></article>');
  assert.equal(action.document, null);
  assert.ok(codes(action).includes('ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('empty table shells are not reported as useful detail content', () => {
  const result = extract('<article><h1>Title</h1><table><tr><td></td></tr></table></article>');
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('DETAIL_CONTENT_NOT_FOUND'));
});

test('rowspan zero is preserved while invalid table spans normalize safely', () => {
  const result = extract('<article><table><tr><td rowspan="0" colspan="-2">A</td><td rowspan="invalid" colspan="3">B</td></tr></table></article>');
  assert.deepEqual(result.document.tables[0].rows[0], [
    { text: 'A', rowSpan: 0, colSpan: 1, header: false },
    { text: 'B', rowSpan: 1, colSpan: 3, header: false }
  ]);
});

test('a password form and sign-in instruction are a gate, while login tutorials remain content', () => {
  const result = extract('<main><h1>Sign in</h1><p>Please sign in to continue.</p><form><input type="password"></form></main>');
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('AUTH_SESSION_REQUIRED'));
  const challenge = extract('<main><p>Please complete the CAPTCHA to continue.</p><form><input name="captcha"></form></main>');
  assert.equal(challenge.document, null);
  assert.ok(codes(challenge).includes('HUMAN_VERIFICATION_REQUIRED'));
});

test('time metadata may be outside a CMS body and structured metadata can complement a visible article', () => {
  assert.equal(extract('<h1>Title</h1><time datetime="2026-09-04"></time><div class="TRS_Editor"><p>CMS body</p></div>').document.publishedAt, '2026-09-04');
  const html = '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Structured title","datePublished":"2026-09-05","articleBody":"Full text"}</script><article><p>Full text</p></article>';
  const result = extract(html);
  assert.equal(result.document.title, 'Structured title');
  assert.equal(result.document.publishedAt, '2026-09-05');
});

test('optional head closure and deeply nested elements do not hide or overflow body extraction', () => {
  const optional = extract('<html><head><title>Title</title><body><article><p>Body</p></article></body></html>');
  assert.equal(optional.document.contentText, 'Body');
  const deep = extract(`<article>${'<div>'.repeat(4000)}<p>Deep body</p>${'</div>'.repeat(4000)}</article>`);
  assert.equal(deep.document.contentText, 'Deep body');
});

test('relative resources obey a safe HTML base URL and unsafe bases are ignored', () => {
  const safe = extract('<base href="https://cdn.example.test/assets/"><article><img src="a.png"></article>');
  assert.equal(safe.document.images[0].url, 'https://cdn.example.test/assets/a.png');
  const unsafe = extract('<base href="https://user:pass@example.test/"><article><img src="a.png"></article>');
  assert.equal(unsafe.document.images[0].url, 'https://example.test/news/a.png');
  assert.ok(codes(unsafe).includes('INVALID_RESOURCE_URL'));
});

test('JSON-LD chooses the current article by URL rather than longest unrelated content', () => {
  for (const identity of [{ url }, { '@id': `${url}#article` }, { mainEntityOfPage: url }, { mainEntityOfPage: { '@id': url } }]) {
    const data = { '@graph': [
      { '@type': 'Article', headline: 'Unrelated', url: 'https://example.test/related', articleBody: 'Unrelated long body. '.repeat(40) },
      { '@type': 'NewsArticle', headline: 'Current page', articleBody: 'Current body.', ...identity }
    ] };
    const result = extract(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
    assert.equal(result.document.title, 'Current page');
    assert.equal(result.document.contentText, 'Current body.');
  }
});

test('ambiguous or explicitly unrelated structured articles are diagnosed without selecting one', () => {
  const data = [
    { '@type': 'Article', headline: 'One', articleBody: 'First body.' },
    { '@type': 'Article', headline: 'Two', articleBody: 'Second body, longer.' }
  ];
  const ambiguous = extract(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
  assert.equal(ambiguous.document, null);
  assert.ok(codes(ambiguous).includes('STRUCTURED_DATA_AMBIGUOUS'));
  const unrelated = extract('<script type="application/ld+json">{"@type":"Article","url":"https://example.test/other","articleBody":"Another page body."}</script>');
  assert.equal(unrelated.document, null);
  assert.ok(codes(unrelated).includes('STRUCTURED_DATA_URL_MISMATCH'));
  const visible = extract(`<script type="application/ld+json">${JSON.stringify(data)}</script><article><p>Visible body.</p></article>`);
  assert.equal(visible.document.contentText, 'Visible body.');
});

test('a plain error page with an analytics script is not classified as an application shell', () => {
  const result = extract('<html><body><h1>404 Not Found</h1><p>This page no longer exists.</p><script src="/analytics.js"></script></body></html>');
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('DETAIL_CONTENT_NOT_FOUND'));
  assert.ok(!codes(result).includes('DYNAMIC_RENDERING_REQUIRED'));
});

test('an explicit gated content selector does not fall back to unrelated structured content', () => {
  const html = '<script type="application/ld+json">{"@type":"Article","articleBody":"Structured body."}</script><main><p>Please sign in to continue.</p><form><input type="password"></form></main>';
  const result = extract(html, { contentSelector: 'main' });
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('AUTH_SESSION_REQUIRED'));
});

test('logos and challenge images cannot turn actual gate screens into successful detail content', () => {
  const cases = [
    ['<main><img src="/logo.png"><h1>Sign in</h1><p>Please sign in to continue.</p><form><input type="password"></form></main>', 'AUTH_SESSION_REQUIRED'],
    ['<main><p>Please complete the CAPTCHA to continue.</p><form><input name="captcha"></form><img src="/captcha.png"></main>', 'HUMAN_VERIFICATION_REQUIRED'],
    ['<main><h1>Just a moment...</h1><p>Checking your browser before accessing the website.</p><div class="cf-turnstile"></div></main>', 'HUMAN_VERIFICATION_REQUIRED'],
    ['<main><img src="/logo.png"><h1>Sign in</h1><form><input type="password"></form></main>', 'AUTH_SESSION_REQUIRED']
  ];
  for (const [html, expected] of cases) {
    const result = extract(html);
    assert.equal(result.document, null, html);
    assert.ok(codes(result).includes(expected), html);
  }
});

test('a login widget outside the selected article does not suppress an article mentioning sign-in', () => {
  for (const container of ['article', 'div class="TRS_Editor"']) {
    const tag = container.split(' ')[0];
    const html = `<main><${container}><h1>Password and CAPTCHA tutorial</h1><p>Please sign in to continue. This is the example prompt explained by this tutorial.</p></${tag}><aside><form><input type="password"></form></aside></main>`;
    const result = extract(html);
    assert.match(result.document.contentText, /tutorial/);
    assert.ok(!codes(result).includes('AUTH_SESSION_REQUIRED'));
    assert.ok(!codes(result).includes('HUMAN_VERIFICATION_REQUIRED'));
  }
});

test('long gate instructions cannot bypass authentication or CAPTCHA detection', () => {
  const explanation = 'Additional instructions explain the required verification step before this page becomes available. '.repeat(8);
  const cases = [
    [`<main><p>Please sign in to continue.</p><p>${explanation}</p><form><input type="password"></form></main>`, 'AUTH_SESSION_REQUIRED'],
    [`<main><p>Please complete the CAPTCHA to continue.</p><p>${explanation}</p><form><input name="captcha"></form></main>`, 'HUMAN_VERIFICATION_REQUIRED']
  ];
  for (const [html, expected] of cases) {
    const result = extract(html);
    assert.equal(result.document, null, expected);
    assert.ok(codes(result).includes(expected));
  }
});
