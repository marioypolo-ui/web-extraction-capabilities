import { parseLikelyPublicationDate } from './migrated/date-parse.mjs';
import { diagnostic } from './result.mjs';

const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const OMIT_TAGS = new Set('head script style template noscript nav aside footer form button input select textarea svg iframe object embed'.split(' '));
const BLOCK_TAGS = new Set('article main section div p h1 h2 h3 h4 h5 h6 blockquote pre ul ol li dl dt dd table caption tr thead tbody tfoot header address figure figcaption'.split(' '));
const OPTIONAL_END_TAGS = new Set('html head body p li dt dd tr td th thead tbody tfoot option colgroup'.split(' '));
const CHROME_TOKEN = /(?:^|[\s_-])(?:nav|navigation|menu|sidebar|breadcrumb|footer|related|recommend|comments?|pagination|pager|toolbar|share)(?:$|[\s_-])/i;
const CMS_TOKEN = /^(?:trs_editor|v_news_content|rich_media_content|article[-_]content|entry[-_]content|news[-_]content|detail[-_]content)$/i;
const FILE_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|od[ts]|rtf|txt|csv|zip|rar|7z|tar|gz|wps|et|epub)(?:$|[?#])/i;
const ATTACHMENT_TEXT = /附件|下载|attachment|download/i;
const NON_PUBLICATION = /截止|开标|报名|递交|投标|提交|开启|deadline|closing|due\s+date/i;
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷'
};

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '�';
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function normalizeText(value) {
  return String(value || '').replace(/[\t\f\v \u00a0]+/g, ' ')
    .replace(/ *\r?\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function readTag(source, start) {
  const opening = /^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i.exec(source.slice(start));
  if (!opening) return null;
  let quote = '';
  for (let cursor = start + opening[0].length; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return { tag: opening[2].toLowerCase(), closing: Boolean(opening[1]),
        attributes: source.slice(start + opening[0].length, cursor), end: cursor + 1 };
    }
  }
  return null;
}

function attributes(source) {
  const values = Object.create(null);
  const pattern = /([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!(name in values)) values[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return values;
}

// A bounded HTML tree tokenizer: no scripts, stylesheet evaluation, network, or browser DOM repair.
function parseHtml(source) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const nodes = [root];
  const stack = [root];
  const lower = source.toLowerCase();
  let malformed = false;
  let index = 0;
  const appendText = (text, raw = false) => {
    if (text) stack.at(-1).children.push({ text: raw ? text : decodeEntities(text) });
  };
  const closeImplied = (tags, boundaries = []) => {
    for (let i = stack.length - 1; i > 0; i -= 1) {
      if (boundaries.includes(stack[i].tag)) return;
      if (tags.includes(stack[i].tag)) { stack.length = i; return; }
    }
  };
  while (index < source.length) {
    if (lower.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end === -1) { malformed = true; break; }
      index = end + 3;
      continue;
    }
    if (source[index] !== '<') {
      const end = source.indexOf('<', index);
      appendText(source.slice(index, end === -1 ? source.length : end));
      index = end === -1 ? source.length : end;
      continue;
    }
    if (/^<!doctype\b/i.test(source.slice(index))) {
      const end = source.indexOf('>', index + 2);
      if (end === -1) { malformed = true; break; }
      index = end + 1;
      continue;
    }
    const token = readTag(source, index);
    if (!token) {
      if (/^<\/?[a-z!]/i.test(source.slice(index))) malformed = true;
      appendText('<');
      index += 1;
      continue;
    }
    index = token.end;
    if (token.closing) {
      const matchIndex = stack.findLastIndex((node) => node.tag === token.tag);
      if (matchIndex < 1) {
        if (!VOID_TAGS.has(token.tag) && !OPTIONAL_END_TAGS.has(token.tag)) malformed = true;
      } else {
        if (stack.slice(matchIndex + 1).some((node) => !OPTIONAL_END_TAGS.has(node.tag))) malformed = true;
        stack.length = matchIndex;
      }
      continue;
    }
    if (!['head', 'base', 'link', 'meta', 'title', 'script', 'style', 'noscript', 'template'].includes(token.tag)) closeImplied(['head']);
    if (BLOCK_TAGS.has(token.tag)) closeImplied(['p'], ['table', 'article']);
    if (token.tag === 'li') closeImplied(['li'], ['ul', 'ol']);
    if (['dt', 'dd'].includes(token.tag)) closeImplied(['dt', 'dd'], ['dl']);
    if (token.tag === 'tr') closeImplied(['tr'], ['table']);
    if (['td', 'th'].includes(token.tag)) closeImplied(['td', 'th'], ['tr', 'table']);
    if (['thead', 'tbody', 'tfoot'].includes(token.tag)) closeImplied(['thead', 'tbody', 'tfoot'], ['table']);
    const node = { tag: token.tag, attrs: attributes(token.attributes), children: [], parent: stack.at(-1) };
    node.parent.children.push(node);
    nodes.push(node);
    if (VOID_TAGS.has(node.tag)) continue;
    stack.push(node);
    if (RAW_TAGS.has(node.tag)) {
      let end = lower.indexOf(`</${node.tag}`, index);
      let closing = null;
      while (end !== -1) {
        closing = readTag(source, end);
        if (closing?.closing && closing.tag === node.tag) break;
        end = lower.indexOf(`</${node.tag}`, end + 2);
      }
      if (end === -1) {
        appendText(source.slice(index), ['script', 'style'].includes(node.tag));
        malformed = true;
        index = source.length;
      } else {
        appendText(source.slice(index, end), ['script', 'style'].includes(node.tag));
        index = closing.end;
      }
      stack.pop();
    }
  }
  if (stack.slice(1).some((node) => !OPTIONAL_END_TAGS.has(node.tag))) malformed = true;
  for (const node of nodes) {
    const identity = `${node.attrs.class || ''} ${node.attrs.id || ''} ${node.attrs.role || ''}`;
    node.hidden = Boolean(node.parent?.hidden || 'hidden' in node.attrs || 'inert' in node.attrs ||
      node.attrs['aria-hidden']?.toLowerCase() === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(node.attrs.style || '') ||
      /(?:^|\s)(?:hidden|d-none|is-hidden)(?:\s|$)/i.test(node.attrs.class || ''));
    node.inArticle = node.tag === 'article' || Boolean(node.parent?.inArticle);
    node.excluded = Boolean(node.parent?.excluded || node.hidden || OMIT_TAGS.has(node.tag) ||
      CHROME_TOKEN.test(identity) || (node.tag === 'header' && !node.inArticle));
    node.metadata = /^h[1-6]$/.test(node.tag) || node.tag === 'time' || Boolean(node.parent?.metadata);
  }
  return { root, nodes, malformed };
}

function descendants(root, { includeExcluded = false } = {}) {
  const result = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node.tag || node.hidden || (!includeExcluded && node.excluded)) continue;
    result.push(node);
    for (let i = node.children.length - 1; i >= 0; i -= 1) pending.push(node.children[i]);
  }
  return result;
}

function textContent(root, { metadata = false } = {}) {
  const parts = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (typeof node === 'string') { parts.push(node); continue; }
    if ('text' in node) { parts.push(node.text.replace(/\s+/g, ' ')); continue; }
    if (node.hidden || (!metadata && node.excluded)) continue;
    const block = BLOCK_TAGS.has(node.tag);
    if (block || node.tag === 'br') parts.push('\n');
    if (block) pending.push('\n');
    if (['td', 'th'].includes(node.tag)) pending.push('\t');
    for (let i = node.children.length - 1; i >= 0; i -= 1) pending.push(node.children[i]);
  }
  return normalizeText(parts.join('')).replace(/\n{2,}/g, '\n');
}

// Supported CSS subset: compound tag/#id/.class/[attr]/[attr=value] and descendant spaces.
function parseSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) return null;
  const parts = [];
  let index = 0;
  while (index < selector.length) {
    while (/\s/.test(selector[index] || '') && index < selector.length) index += 1;
    if (index >= selector.length) break;
    const part = [];
    const tag = /^[a-z][\w-]*/i.exec(selector.slice(index));
    if (tag) { part.push({ kind: 'tag', value: tag[0].toLowerCase() }); index += tag[0].length; }
    while (index < selector.length && !/\s/.test(selector[index])) {
      const identifier = /^([#.])([\w-]+)/.exec(selector.slice(index));
      if (identifier) {
        part.push({ kind: identifier[1] === '#' ? 'id' : 'class', value: identifier[2] });
        index += identifier[0].length;
        continue;
      }
      const attribute = /^\[\s*([a-z_][\w:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w:/.#-]+))\s*)?\]/i.exec(selector.slice(index));
      if (!attribute) return null;
      part.push({ kind: 'attribute', name: attribute[1].toLowerCase(), value: attribute[2] ?? attribute[3] ?? attribute[4] });
      index += attribute[0].length;
    }
    if (!part.length) return null;
    parts.push(part);
  }
  return parts.length ? parts : null;
}

function matchesPart(node, part) {
  return part.every((item) => {
    if (item.kind === 'tag') return node.tag === item.value;
    if (item.kind === 'id') return node.attrs.id === item.value;
    if (item.kind === 'class') return (node.attrs.class || '').split(/\s+/).includes(item.value);
    return item.name in node.attrs && (item.value === undefined || node.attrs[item.name] === item.value);
  });
}

function select(nodes, parts) {
  return nodes.find((node) => {
    if (node.hidden || !matchesPart(node, parts.at(-1))) return false;
    let ancestor = node.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (ancestor && !matchesPart(ancestor, parts[i])) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  }) || null;
}

function safeUrl(value, base) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim(), base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function attachment(node) {
  return node.tag === 'a' && ('download' in node.attrs || FILE_EXTENSION.test(node.attrs.href || '') ||
    ATTACHMENT_TEXT.test(`${textContent(node)} ${node.attrs.title || ''}`));
}

function measure(nodes) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const stats = { length: 0, link: 0, body: 0, paragraphs: 0, media: 0, deferred: 0 };
    if (!node.excluded) {
      for (const child of node.children) {
        if ('text' in child) {
          const length = compactText(child.text).length;
          stats.length += length;
          if (!node.metadata) stats.body += length;
        } else {
          for (const key of Object.keys(stats)) stats[key] += child.stats[key];
        }
      }
      if (node.tag === 'a') { stats.link = stats.length; stats.body = 0; }
      if (node.tag === 'p' && stats.body) stats.paragraphs += 1;
      if (node.tag === 'img' || attachment(node) || (node.tag === 'table' && stats.length)) stats.media += 1;
      if (node.tag === 'a' && (/^javascript:/i.test(node.attrs.href || '') ||
        ((!node.attrs.href || node.attrs.href === '#') && node.attrs.onclick))) stats.deferred += 1;
    }
    if (!node.hidden && !node.parent?.excluded && ['iframe', 'object', 'embed'].includes(node.tag)) stats.deferred += 1;
    node.stats = stats;
  }
}

function useful(node) {
  return node.stats.media > 0 || node.stats.deferred > 0 || (node.stats.body > 0 && node.stats.link < node.stats.length * 0.65);
}

function chooseContent(nodes) {
  const eligible = nodes.filter((node) => !node.excluded && useful(node));
  const best = (candidates) => candidates.sort((left, right) =>
    right.stats.body + right.stats.media * 40 - left.stats.body - left.stats.media * 40)[0] || null;
  const cms = best(eligible.filter((node) =>
    `${node.attrs.id || ''} ${node.attrs.class || ''}`.split(/\s+/).some((token) => CMS_TOKEN.test(token)) ||
    (node.attrs.itemprop || '').split(/\s+/).includes('articleBody')));
  if (cms) return cms;
  return best(eligible.filter((node) => node.tag === 'article')) ||
    best(eligible.filter((node) => node.tag === 'main' || node.attrs.role === 'main'));
}

function genericContent(nodes) {
  const candidates = nodes.filter((node) => !node.excluded && ['div', 'section', 'td'].includes(node.tag) &&
    node.stats.body >= 120 && node.stats.link < node.stats.length * 0.3 &&
    (node.stats.paragraphs >= 2 || node.stats.body >= 240));
  // Equal-content nested wrappers prefer the innermost body, avoiding global chrome.
  return candidates.sort((left, right) => right.stats.body - left.stats.body || nodes.indexOf(right) - nodes.indexOf(left))[0] || null;
}

function articleIdentity(value, pageUrl) {
  const raw = typeof value === 'string' ? value : value?.['@id'] || value?.url;
  const resolved = safeUrl(raw, pageUrl);
  if (!resolved) return null;
  const identity = new URL(resolved);
  if (!/^#!?\//.test(identity.hash)) identity.hash = '';
  return identity.toString();
}

function readStructuredData(nodes, pageUrl, diagnostics) {
  const articles = [];
  for (const node of nodes.filter((item) => item.tag === 'script' && item.attrs.type?.toLowerCase() === 'application/ld+json')) {
    let data;
    try { data = JSON.parse(node.children.map((item) => item.text || '').join('')); }
    catch {
      diagnostics.push(diagnostic('STRUCTURED_DATA_INVALID', 'An application/ld+json block could not be parsed.'));
      continue;
    }
    const pending = [data];
    while (pending.length) {
      const item = pending.pop();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item)) {
        for (let i = item.length - 1; i >= 0; i -= 1) pending.push(item[i]);
        continue;
      }
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (types.some((type) => /^(?:(?:https?:\/\/)?schema\.org\/)?(?:Article|NewsArticle|BlogPosting)$/.test(type)) &&
        typeof item.articleBody === 'string' && item.articleBody.trim()) articles.push(item);
      if (item['@graph']) pending.push(item['@graph']);
      if (item.mainEntity) pending.push(item.mainEntity);
    }
  }
  if (!articles.length) return null;
  const pageIdentity = articleIdentity(pageUrl, pageUrl);
  const identified = articles.map((article) => ({ article, identities:
    [article.url, article['@id'], article.mainEntityOfPage].map((value) => articleIdentity(value, pageUrl)).filter(Boolean) }));
  const matching = identified.filter((item) => item.identities.includes(pageIdentity));
  const candidates = matching.length ? matching : identified;
  const unique = [...new Map(candidates.map((item) => [
    JSON.stringify([item.article.articleBody, item.article.headline, item.article.datePublished]), item
  ])).values()];
  if (unique.length > 1) {
    diagnostics.push(diagnostic('STRUCTURED_DATA_AMBIGUOUS', 'Multiple structured articles could not be uniquely associated with the current page; no structured body was selected.'));
    return null;
  }
  if (!matching.length && unique[0].identities.length) {
    diagnostics.push(diagnostic('STRUCTURED_DATA_URL_MISMATCH', 'The structured article identifies another page; its body was not selected.'));
    return null;
  }
  return unique[0].article;
}

function parseDate(value) {
  return typeof value === 'string' ? parseLikelyPublicationDate(value) || null : null;
}

function metadata(nodes, selected, structured, selectors, diagnostics) {
  const configured = (key) => {
    if (!selectors[key]) return null;
    const node = select(nodes, selectors[key]);
    if (!node) diagnostics.push(diagnostic('SELECTOR_NO_MATCH', `The configured ${key} did not match a visible element.`));
    return node;
  };
  let title = '';
  if (selectors.titleSelector) {
    const node = configured('titleSelector');
    title = node ? compactText(node.attrs.content || textContent(node, { metadata: true })) : '';
  } else {
    const localHeading = selected && descendants(selected).find((node) => node.tag === 'h1');
    const pageHeading = nodes.find((node) => node.tag === 'h1' && !node.excluded);
    const ogTitle = nodes.find((node) => node.tag === 'meta' && node.attrs.property?.toLowerCase() === 'og:title');
    const pageTitle = nodes.find((node) => node.tag === 'title');
    title = compactText((localHeading && textContent(localHeading)) ||
      (!selected && structured?.headline) || (pageHeading && textContent(pageHeading)) ||
      ogTitle?.attrs.content || (pageTitle && textContent(pageTitle, { metadata: true })) ||
      (typeof structured?.headline === 'string' ? structured.headline : '') || '');
  }
  let publishedAt = null;
  if (selectors.dateSelector) {
    const node = configured('dateSelector');
    if (node) publishedAt = parseDate(node.attrs.datetime || node.attrs.content || textContent(node, { metadata: true }));
  } else {
    const dateMeta = nodes.find((node) => node.tag === 'meta' && node.attrs.property?.toLowerCase() === 'article:published_time');
    publishedAt = parseDate(dateMeta?.attrs.content) || (!selected ? parseDate(structured?.datePublished) : null);
    if (!publishedAt) {
      const times = [...(selected ? descendants(selected) : []), ...nodes].filter((node) => node.tag === 'time' && !node.excluded);
      for (const node of times) {
        if (/dateModified|dateCreated/i.test(node.attrs.itemprop || '')) continue;
        const text = textContent(node);
        const parentText = node.parent && ['p', 'div', 'span'].includes(node.parent.tag) ? textContent(node.parent) : '';
        const explicitPublication = node.attrs.itemprop === 'datePublished' || 'pubdate' in node.attrs;
        if (!explicitPublication && (NON_PUBLICATION.test(text) || (parentText.length < 180 && NON_PUBLICATION.test(parentText)))) continue;
        publishedAt = parseDate(node.attrs.datetime || text);
        if (publishedAt) break;
      }
    }
    publishedAt ||= parseDate(structured?.datePublished);
  }
  return { title, publishedAt };
}

function sourceSet(value) {
  return String(value || '').split(',').map((item) => {
    const match = /^\s*(\S+)(?:\s+(\d+(?:\.\d+)?)[wx])?\s*$/.exec(item);
    return match ? { url: match[1], weight: Number(match[2] || 1) } : null;
  }).filter(Boolean).sort((left, right) => right.weight - left.weight).map((item) => item.url);
}

function resources(selected, base, diagnostics) {
  const images = [];
  const attachments = [];
  const imageUrls = new Set();
  const attachmentUrls = new Set();
  let invalid = false;
  let action = false;
  for (const node of descendants(selected)) {
    if (node.tag === 'img') {
      const candidates = [node.attrs['data-src'], node.attrs['data-original'], node.attrs['data-lazy-src'], node.attrs['data-url'],
        ...sourceSet(node.attrs['data-srcset']), ...sourceSet(node.attrs.srcset), node.attrs.src].filter(Boolean);
      const resolved = candidates.map((candidate) => safeUrl(candidate, base)).find(Boolean);
      if (resolved && !imageUrls.has(resolved)) {
        imageUrls.add(resolved);
        images.push({ url: resolved, alt: compactText(node.attrs.alt || '') });
      } else if (!resolved && candidates.length) invalid = true;
    }
    if (node.tag !== 'a') continue;
    const href = (node.attrs.href || '').trim();
    const actionOnly = /^javascript:/i.test(href) || ((!href || href === '#') && (node.attrs.onclick || attachment(node)));
    if (actionOnly) { action = true; continue; }
    if (!attachment(node)) continue;
    const resolved = safeUrl(href, base);
    if (!resolved || href.startsWith('#')) { invalid = true; continue; }
    if (!attachmentUrls.has(resolved)) {
      attachmentUrls.add(resolved);
      attachments.push({ url: resolved, title: compactText(textContent(node) || node.attrs.title || node.attrs.download || '') });
    }
  }
  if (invalid) diagnostics.push(diagnostic('INVALID_RESOURCE_URL', 'An image or attachment URL was omitted because it is not a usable HTTP(S) URL without credentials.'));
  if (action) diagnostics.push(diagnostic('ACTION_LINK_REQUIRES_CONFIGURATION', 'A content action link requires a configured URL mapping or a browser workflow.'));
  return { images, attachments };
}

function nearest(node, tag) {
  let parent = node.parent;
  while (parent && parent.tag !== tag) parent = parent.parent;
  return parent;
}

function spanValue(value, allowZero) {
  if (!/^\d+$/.test(value || '')) return 1;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= (allowZero ? 0 : 1) ? number : 1;
}

function tables(selected) {
  return descendants(selected).filter((node) => node.tag === 'table').map((table) => {
    const members = descendants(table);
    const caption = members.find((node) => node.tag === 'caption' && nearest(node, 'table') === table);
    return {
      caption: caption ? compactText(textContent(caption)) : '',
      rows: members.filter((node) => node.tag === 'tr' && nearest(node, 'table') === table).map((row) =>
        descendants(row).filter((node) => ['td', 'th'].includes(node.tag) && nearest(node, 'tr') === row && nearest(node, 'table') === table)
          .map((cell) => ({ text: compactText(textContent(cell)), rowSpan: spanValue(cell.attrs.rowspan, true),
            colSpan: spanValue(cell.attrs.colspan, false), header: cell.tag === 'th' })))
    };
  });
}

function completeness(selected, nodes, diagnostics) {
  const scoped = descendants(selected, { includeExcluded: true });
  if (scoped.some((node) => ['iframe', 'object', 'embed'].includes(node.tag))) {
    diagnostics.push(diagnostic('EMBEDDED_CONTENT_NOT_EXTRACTED', 'The selected body contains embedded content that was not extracted.'));
  }
  if (scoped.some((node) => node.tag === 'a' && (/\bnext\b/i.test(node.attrs.rel || '') ||
    /^(?:下一页|下页|next(?:\s+page)?|[›»])$/i.test(compactText(textContent(node, { metadata: true }))))) ||
    nodes.some((node) => node.tag === 'link' && /\bnext\b/i.test(node.attrs.rel || ''))) {
    diagnostics.push(diagnostic('MULTIPAGE_CONTENT_DETECTED', 'Additional body pages are linked; this result contains the current HTML page only.'));
  }
}

function pageGate(nodes) {
  const visible = nodes.filter((node) => !node.hidden);
  const challenge = visible.some((node) =>
    /(?:^|\s)(?:g-recaptcha|h-captcha|cf-turnstile)(?:\s|$)/i.test(node.attrs.class || '') ||
    (node.tag === 'input' && /captcha|verifycode|verificationcode/i.test(`${node.attrs.name || ''} ${node.attrs.id || ''}`) && nearest(node, 'form')) ||
    (node.tag === 'form' && /challenge|captcha/i.test(`${node.attrs.id || ''} ${node.attrs.action || ''}`)));
  if (challenge) return 'challenge';
  if (visible.some((node) => node.tag === 'input' && node.attrs.type?.toLowerCase() === 'password' && nearest(node, 'form'))) return 'authentication';
  return null;
}

function isGateContent(selected) {
  if (!selected) return false;
  const gate = pageGate(descendants(selected, { includeExcluded: true }));
  if (!gate) return false;
  if (!selected.stats.body) return true;
  const body = textContent(selected);
  if (gate === 'authentication') return /please\s+(?:log|sign)\s*in|(?:log|sign)\s*in\s+to\s+(?:continue|view|read|access)|authentication\s+required|请(?:先)?登录|登录后(?:可|查看)|账号登录|用户登录/i.test(body);
  return gate === 'challenge' && /complete\s+(?:the\s+)?(?:captcha|verification)|verify\s+(?:you\s+are|that\s+you)|checking\s+(?:your\s+)?browser|just\s+a\s+moment|人机验证|请.{0,15}(?:验证码|验证)|安全验证|正在.{0,12}(?:检查|验证).{0,12}浏览器/i.test(body);
}

function missingContent(nodes, diagnostics) {
  const visible = nodes.filter((node) => !node.hidden);
  const gate = pageGate(nodes);
  if (gate === 'challenge') diagnostics.push(diagnostic('HUMAN_VERIFICATION_REQUIRED', 'The page contains a verification challenge without an extractable body; human action is required.', { severity: 'error' }));
  else if (gate === 'authentication') {
    diagnostics.push(diagnostic('AUTH_SESSION_REQUIRED', 'The page contains a sign-in form without an extractable body; an authorized authenticated session is required.', { severity: 'error' }));
  } else if (visible.some((node) => ['app', 'root', '__next', '__nuxt'].includes(node.attrs.id) || node.tag === 'app-root') ||
    (visible.some((node) => node.tag === 'script' && node.attrs.src) && visible.some((node) =>
      node.tag === 'noscript' && /(?:enable|requires?|need).{0,30}javascript|javascript.{0,30}(?:required|enabled)|请.{0,12}(?:启用|开启).{0,12}javascript/i.test(textContent(node, { metadata: true }))))) {
    diagnostics.push(diagnostic('DYNAMIC_RENDERING_REQUIRED', 'The HTML appears to be an application shell without a static body; rendered browser content may be required.'));
  }
  diagnostics.push(diagnostic('DETAIL_CONTENT_NOT_FOUND', 'No usable detail body, table, image, or attachment was found.', { severity: 'error' }));
}

/**
 * Extract full visible detail content from already obtained HTML without runtime dependencies.
 * Selectors support tag, #id, .class, [attr], [attr=value], compounds and descendant spaces.
 * Explicit selectors never fall back; unsupported syntax returns CONFIG_INVALID.
 */
export function extractHtmlDetail({ html, url, config = {} } = {}) {
  const diagnostics = [];
  const pageUrl = safeUrl(url);
  if (typeof html !== 'string' || !pageUrl || !config || typeof config !== 'object' || Array.isArray(config)) {
    return { document: null, diagnostics: [diagnostic('CONFIG_INVALID', 'HTML must be a string, config must be an object, and url must be an absolute HTTP(S) URL without credentials.', { severity: 'error' })] };
  }
  const selectors = {};
  for (const key of ['contentSelector', 'titleSelector', 'dateSelector']) {
    if (!(key in config)) continue;
    selectors[key] = parseSelector(config[key]);
    if (!selectors[key]) return { document: null, diagnostics: [diagnostic('CONFIG_INVALID', `The configured ${key} uses unsupported or invalid selector syntax.`, { severity: 'error' })] };
  }
  const { nodes, malformed } = parseHtml(html);
  if (malformed) diagnostics.push(diagnostic('MALFORMED_HTML', 'The HTML contains incomplete or mismatched markup; available content was recovered with a limited parser.'));
  measure(nodes);
  const structured = readStructuredData(nodes, pageUrl, diagnostics);
  let selected = selectors.contentSelector ? select(nodes, selectors.contentSelector) : chooseContent(nodes);
  if (selectors.contentSelector && !selected) {
    diagnostics.push(diagnostic('SELECTOR_NO_MATCH', 'The configured contentSelector did not match a visible element.', { severity: 'error' }));
    missingContent(nodes, diagnostics);
    return { document: null, diagnostics };
  }
  if (!selected && !structured && !selectors.contentSelector) {
    selected = genericContent(nodes);
    if (selected) diagnostics.push(diagnostic('LOW_CONFIDENCE_CONTENT', 'The body was selected by prose length and link density; verify its boundaries or configure contentSelector.'));
  }
  if (isGateContent(selected)) {
    if (selectors.contentSelector) {
      missingContent(nodes, diagnostics);
      return { document: null, diagnostics };
    }
    selected = null;
  }
  if (!selected && !structured) {
    missingContent(nodes, diagnostics);
    return { document: null, diagnostics };
  }
  const metadataResult = metadata(nodes, selected, structured, selectors, diagnostics);
  let base = pageUrl;
  const baseElement = nodes.find((node) => node.tag === 'base' && node.attrs.href);
  if (baseElement) {
    const resolved = safeUrl(baseElement.attrs.href, pageUrl);
    if (resolved) base = resolved;
    else diagnostics.push(diagnostic('INVALID_RESOURCE_URL', 'An invalid HTML base URL was ignored.'));
  }
  const document = { ...metadataResult, url: pageUrl,
    contentText: selected ? textContent(selected) : normalizeText(structured.articleBody),
    tables: selected ? tables(selected) : [],
    ...(selected ? resources(selected, base, diagnostics) : { images: [], attachments: [] }) };
  if (selected) completeness(selected, nodes, diagnostics);
  const usableTable = document.tables.some((table) => table.caption || table.rows.some((row) => row.some((cell) => cell.text)));
  if (selected && ((!selected.stats.body && !usableTable && !document.images.length && !document.attachments.length) ||
    (!document.contentText && !document.tables.length && !document.images.length && !document.attachments.length))) {
    missingContent(nodes, diagnostics);
    return { document: null, diagnostics };
  }
  return { document, diagnostics };
}
