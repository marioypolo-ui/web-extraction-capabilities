import { parseLikelyPublicationDate } from './migrated/date-parse.mjs';
import { diagnostic } from './result.mjs';

const NAVIGATION_TITLE_PATTERN =
  /^(?:mobile version|\u624b\u673a\u7248|\u8df3\u8f6c|\u9996\u9875|\u4e0a\u4e00\u9875|\u4e0b\u4e00\u9875|\u5c3e\u9875|\u672b\u9875|\u7b2c\s*\d+\s*\u9875|first|first page|previous|prev|previous page|next|next page|last|last page)$/i;
const NAVIGATION_ATTRIBUTE_PATTERN =
  /(?:^|[^a-z0-9])(?:nav(?:igation)?|menu|header|breadcrumb|pagination|pager)(?:$|[^a-z0-9])/i;
const CONTENT_HANDLER_PATTERN = /(?:open|show|view|detail|article|notice)\w*\s*\(/i;
const VOID_ELEMENT_PATTERN =
  /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

const ACTION_TITLE_PATTERN = /^(?:点击查看详情|查看详情|详情|more|read more)$/i;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function textContent(value) {
  return decodeEntities(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' '))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    attributes || ''
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function readTagAt(value, index) {
  const match = /^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i.exec(value.slice(index));
  if (!match) {
    return null;
  }

  let quote = '';
  for (let cursor = index + match[0].length; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (quote) {
      if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      const attributes = value.slice(index + match[0].length, cursor);
      return {
        attributes,
        closing: Boolean(match[1]),
        endIndex: cursor,
        selfClosing: /\/\s*$/.test(attributes),
        tagName: match[2].toLowerCase()
      };
    }
  }
  return null;
}

function rawTextEnd(value, lowerValue, tagName, startIndex) {
  const marker = `</${tagName}`;
  let index = startIndex;

  while (index < value.length) {
    const candidate = lowerValue.indexOf(marker, index);
    if (candidate === -1) {
      return value.length;
    }
    const tag = readTagAt(value, candidate);
    if (tag?.closing && tag.tagName === tagName) {
      return tag.endIndex + 1;
    }
    index = candidate + marker.length;
  }
  return value.length;
}

function maskHtmlComments(value) {
  const source = String(value || '');
  const lowerSource = source.toLowerCase();
  const masked = source.split('');
  let index = 0;

  while (index < source.length) {
    if (lowerSource.startsWith('<!--', index)) {
      const commentEnd = lowerSource.indexOf('-->', index + 4);
      if (commentEnd !== -1) {
        masked.fill(' ', index, commentEnd + 3);
        index = commentEnd + 3;
        continue;
      }
      index += 4;
      continue;
    }
    if (source[index] !== '<') {
      index += 1;
      continue;
    }

    const tag = readTagAt(source, index);
    if (!tag) {
      index += 1;
      continue;
    }
    index = tag.endIndex + 1;
    if (
      !tag.closing &&
      !tag.selfClosing &&
      (tag.tagName === 'script' || tag.tagName === 'style')
    ) {
      index = rawTextEnd(source, lowerSource, tag.tagName, index);
    }
  }

  return masked.join('');
}

function elementAttributes(value) {
  const source = String(value || '');
  const lowerSource = source.toLowerCase();
  const results = [];
  let index = 0;

  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1) {
      break;
    }
    const tag = readTagAt(source, tagStart);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }
    index = tag.endIndex + 1;
    if (!tag.closing) {
      results.push(tag.attributes);
    }
    if (
      !tag.closing &&
      !tag.selfClosing &&
      (tag.tagName === 'script' || tag.tagName === 'style')
    ) {
      index = rawTextEnd(source, lowerSource, tag.tagName, index);
    }
  }

  return results;
}

function hasNavigationAttributes(attributes) {
  return ['class', 'id', 'role'].some((name) =>
    NAVIGATION_ATTRIBUTE_PATTERN.test(attribute(attributes, name))
  );
}

function chooseTitle(attributes, innerHtml) {
  const metadataTitle = attribute(attributes, 'title').replace(
    /^(?:标题|题名)\s*[:：]\s*/i,
    ''
  );
  const visibleTitle = textContent(innerHtml);
  if (metadataTitle && !ACTION_TITLE_PATTERN.test(metadataTitle)) {
    return metadataTitle;
  }
  return visibleTitle;
}

function resolveActionUrl(block, attributes, config, baseUrl) {
  if (!config?.actionUrlTemplate) {
    return '';
  }
  const id =
    attribute(attributes, 'data-id') ||
    attribute(block.match(/^<[^>]+/i)?.[0] || '', 'data-id') ||
    /(?:openNotice|detail|open)\s*\(\s*['"]([^'"]+)/i.exec(attributes)?.[1] ||
    /data-id\s*=\s*["']([^"']+)/i.exec(block)?.[1] ||
    '';
  if (!id) {
    return '';
  }
  return new URL(config.actionUrlTemplate.replaceAll('{id}', encodeURIComponent(id)), baseUrl).toString();
}

function hasNavigationAncestor(html, blockIndex) {
  const ancestors = [];
  const tags = String(html || '')
    .slice(0, blockIndex)
    .matchAll(/<(\/)?([a-z][\w:-]*)([^>]*)>/gi);

  for (const tagMatch of tags) {
    const tagName = tagMatch[2].toLowerCase();
    if (tagMatch[1]) {
      for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        if (ancestors[index].tagName === tagName) {
          ancestors.length = index;
          break;
        }
      }
      continue;
    }
    if (!VOID_ELEMENT_PATTERN.test(tagName) && !/\/\s*$/.test(tagMatch[3])) {
      ancestors.push({ tagName, attributes: tagMatch[3] });
    }
  }

  return ancestors.some(({ tagName, attributes }) => {
    if (tagName === 'nav') {
      return true;
    }
    return hasNavigationAttributes(attributes);
  });
}

function isNavigationActionControl({ block, attributesList, title, navigationContext }) {
  const hasTime = /<time\b/i.test(block);
  const hasDate = Boolean(parseLikelyPublicationDate(textContent(block)));
  const hasDataId = attributesList.some((attributes) => attribute(attributes, 'data-id'));
  const hasContentHandler = attributesList.some(
    (attributes) =>
      CONTENT_HANDLER_PATTERN.test(attribute(attributes, 'href')) ||
      CONTENT_HANDLER_PATTERN.test(attribute(attributes, 'onclick'))
  );
  const hasRecordMetadata = hasTime || hasDate || hasDataId || hasContentHandler;

  if (hasRecordMetadata) {
    return false;
  }
  return !title || NAVIGATION_TITLE_PATTERN.test(title) || navigationContext;
}

export function extractStaticHtml({ html, url, config = {} }) {
  const diagnostics = [];
  const records = [];
  const structuralHtml = maskHtmlComments(html);
  const blocks = [
    ...structuralHtml.matchAll(/<(?:li|article)\b[\s\S]*?<\/(?:li|article)>/gi)
  ];

  for (const blockMatch of blocks) {
    const block = blockMatch[0];
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) {
      continue;
    }
    const attributes = anchor[1];
    const title = chooseTitle(attributes, anchor[2]);
    const attributesList = elementAttributes(block);
    const blockAttributes = /^<(?:li|article)\b([^>]*)>/i.exec(block)?.[1] || '';
    let href = attribute(attributes, 'href');
    const actionOnly = !href || href === '#' || /^javascript:/i.test(href);
    if (actionOnly) {
      href = resolveActionUrl(block, attributes, config, url);
      if (!href) {
        if (
          isNavigationActionControl({
            block,
            attributesList,
            title,
            navigationContext:
              hasNavigationAttributes(blockAttributes) ||
              hasNavigationAncestor(structuralHtml, blockMatch.index || 0)
          })
        ) {
          continue;
        }
        diagnostics.push(
          diagnostic(
            'ACTION_LINK_REQUIRES_CONFIGURATION',
            'A javascript, onclick, or data-id link needs an actionUrlTemplate or browser workflow.'
          )
        );
        continue;
      }
    }

    if (!title) {
      continue;
    }

    const datetime = attribute(/<time\b([^>]*)>/i.exec(block)?.[1] || '', 'datetime');
    const publishedAt =
      parseLikelyPublicationDate(datetime) || parseLikelyPublicationDate(textContent(block)) || null;
    const summary = textContent(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '');
    records.push({ title, url: href, publishedAt, summary, raw: {} });
  }

  const unique = [];
  const seen = new Set();
  for (const record of records) {
    const key = `${record.url}\n${record.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(record);
    }
  }
  return { records: unique, diagnostics };
}
