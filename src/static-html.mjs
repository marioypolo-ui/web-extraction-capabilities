import { parseLikelyPublicationDate } from './migrated/date-parse.mjs';
import { diagnostic } from './result.mjs';

const NAVIGATION_TITLE_PATTERN =
  /^(?:mobile version|\u624b\u673a\u7248|\u8df3\u8f6c|鎵嬫満鐗坾jump|璺宠浆|first|first page|棣栭〉|previous|prev|previous page|涓婁竴椤祙next|next page|涓嬩竴椤祙last|last page|灏鹃〉|鏈〉|绗?\s*\d+\s*椤祙\d+)$/i;
const PAGINATION_HANDLER_PATTERN =
  /(?:^|[.\s_])(go|goto|change|turn|jump|set|simple_list_goto)?page(?:_fun)?\s*\(|_simple_list_gotopage_fun\s*\(/i;
const CONTENT_HANDLER_PATTERN = /(?:open|show|view|detail|article|notice)\w*\s*\(/i;

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

function isNavigationActionControl({ block, attributes, title }) {
  const handler = attribute(attributes, 'onclick');
  const hasTime = /<time\b/i.test(block);
  const hasDate = Boolean(parseLikelyPublicationDate(textContent(block)));
  const hasDataId = Boolean(
    attribute(attributes, 'data-id') ||
      attribute(block.match(/^<[^>]+/i)?.[0] || '', 'data-id')
  );
  const hasContentHandler = CONTENT_HANDLER_PATTERN.test(handler);
  const hasRecordMetadata = hasTime || hasDate || hasDataId || hasContentHandler;

  if (hasRecordMetadata) {
    return false;
  }
  return NAVIGATION_TITLE_PATTERN.test(title) || PAGINATION_HANDLER_PATTERN.test(handler);
}

export function extractStaticHtml({ html, url, config = {} }) {
  const diagnostics = [];
  const records = [];
  const blocks = [...String(html || '').matchAll(/<(?:li|article)\b[\s\S]*?<\/(?:li|article)>/gi)].map(
    (match) => match[0]
  );

  for (const block of blocks) {
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) {
      continue;
    }
    const attributes = anchor[1];
    const title = chooseTitle(attributes, anchor[2]);
    let href = attribute(attributes, 'href');
    const actionOnly = !href || href === '#' || /^javascript:/i.test(href);
    if (actionOnly) {
      href = resolveActionUrl(block, attributes, config, url);
      if (!href) {
        if (isNavigationActionControl({ block, attributes, title })) {
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
