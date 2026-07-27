import http from 'node:http';
import https from 'node:https';
import { parseLikelyPublicationDate, parsePublicationDate } from './date-parse.mjs';
import { normalizeText } from './matching.mjs';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

export async function fetchText(url, options = {}) {
  const result = await fetchTextWithDiagnostics(url, options);
  return result.text;
}

export async function fetchTextWithDiagnostics(url, options = {}) {
  const requestUrl = rewriteKnownMovedUrl(url);
  const timeoutMs = options.timeoutMs || 30000;
  const retries = options.retries ?? 2;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestHeaders = {
        'user-agent': options.userAgent || DEFAULT_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'upgrade-insecure-requests': '1',
        cookie: options.cookie || defaultCookieForUrl(requestUrl)
      };
      const response = options.resolveIp
        ? await fetchWithFixedResolve(requestUrl, {
            signal: controller.signal,
            headers: requestHeaders,
            resolveIp: options.resolveIp
          })
        : await fetch(requestUrl, {
            signal: controller.signal,
            headers: requestHeaders
          });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const buffer = response.buffer || Buffer.from(await response.arrayBuffer());
      const text = decodeResponse(buffer, response.headers.get('content-type') || '');
      const diagnostics = [];
      return {
        text: await hydrateDynamicList(requestUrl, text, diagnostics),
        diagnostics
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw enrichFetchError(lastError);
}

function rewriteKnownMovedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'gxmzyy.gxrb.com.cn') {
      parsed.hostname = 'www.gxmzyy.cn';
      return parsed.toString();
    }
  } catch {
    // Keep the original URL and let fetch report the useful error.
  }
  return url;
}

function enrichFetchError(error) {
  if (!error) {
    return new Error('fetch failed');
  }

  const parts = [error.message || String(error)];
  const cause = error.cause;
  if (cause?.code) {
    parts.push(cause.code);
  }
  if (cause?.message && cause.message !== error.message) {
    parts.push(cause.message);
  }

  const enriched = new Error([...new Set(parts)].join(': '));
  enriched.cause = error;
  return enriched;
}

function fetchWithFixedResolve(rawUrl, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const headers = {
      ...options.headers,
      host: parsed.host
    };

    const request = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers,
        servername: parsed.hostname,
        lookup(_hostname, lookupOptions, callback) {
          const family = options.resolveIp.includes(':') ? 6 : 4;
          if (lookupOptions?.all) {
            callback(null, [{ address: options.resolveIp, family }]);
            return;
          }
          callback(null, options.resolveIp, family);
        }
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
          response.resume();
          const redirectUrl = new URL(location, rawUrl).toString();
          fetchWithFixedResolve(redirectUrl, options, redirectCount + 1).then(resolve, reject);
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const headerMap = new Map(
            Object.entries(response.headers).map(([key, value]) => [
              key.toLowerCase(),
              Array.isArray(value) ? value.join(', ') : String(value || '')
            ])
          );
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusMessage || '',
            buffer: Buffer.concat(chunks),
            headers: {
              get(name) {
                return headerMap.get(String(name).toLowerCase()) || null;
              }
            }
          });
        });
      }
    );

    request.on('error', reject);
    options.signal?.addEventListener(
      'abort',
      () => {
        request.destroy(new Error('The operation was aborted'));
      },
      { once: true }
    );
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultCookieForUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.gxzyy.com.cn') {
      return `visited=1; Waf_Tag=${Date.now()}`;
    }
  } catch {
    // Fall through to the generic cookie.
  }
  return 'visited=1';
}

function addDiagnostic(diagnostics, message) {
  if (!diagnostics) {
    return;
  }
  if (!diagnostics.some((item) => item.message === message)) {
    diagnostics.push({ type: 'warning', message });
  }
}

function dynamicFailureMessage(sourceName, error) {
  return `${sourceName}动态接口失败：${error.message || String(error)}`;
}

async function hydrateDynamicList(url, html, diagnostics = []) {
  if (isCtzcNoticeDetail(url)) {
    return hydrateCtzcNoticeDetail(url, html, diagnostics);
  }

  if (isCtzcNoticeList(url)) {
    return hydrateCtzcNoticeList(url, html, diagnostics);
  }

  if (isGxmuyfyAnnouncementList(url)) {
    return hydrateGxmuyfyAnnouncementList(url, html, diagnostics);
  }

  if (isGxmuyfyAnnouncementInfo(url)) {
    return hydrateGxmuyfyAnnouncementInfo(url, html, diagnostics);
  }

  if (isCcgpGuangxiFrameworkCategory(url)) {
    return hydrateCcgpGuangxiFrameworkCategory(url, html, diagnostics);
  }

  if (isCcgpGuangxiDetail(url)) {
    return hydrateCcgpGuangxiDetail(url, html, diagnostics);
  }

  if (isGxmzuPurchaseList(url)) {
    return hydrateGxmzuPurchaseList(url, html, diagnostics);
  }

  if (!isGxufeLevelPage(url, html)) {
    return html;
  }

  try {
    const apiItems = await fetchGxufeInformationList(url, html);
    if (apiItems.length === 0) {
      addDiagnostic(diagnostics, '广西财经学院动态接口未返回公告数据');
      return html;
    }
    const synthesized = apiItems
      .map((item) => {
        const title = escapeHtml(item.title || '');
        const href = escapeHtml(item.url || buildGxufeDetailUrl(url, item));
        const date = escapeHtml(parseGxufeDate(item.datetime || ''));
        return `<li><span class="date">${date}</span><a href="${href}"><h3>${title}</h3></a></li>`;
      })
      .join('\n');
    return `${html}\n<ul data-dynamic-source="gxufe">${synthesized}</ul>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('广西财经学院', error));
    return html;
  }
}

async function hydrateCtzcNoticeList(url, html, diagnostics = []) {
  try {
    const apiItems = await fetchCtzcNoticeList(url);
    if (apiItems.length === 0) {
      addDiagnostic(diagnostics, '南宁产投动态接口未返回公告数据');
      return html;
    }
    const synthesized = apiItems
      .map((item) => {
        const title = escapeHtml(item.title || '');
        const href = escapeHtml(buildCtzcNoticeDetailUrl(url, item));
        const date = escapeHtml(parseCtzcDate(item.publishTime || item.createDatetime || item.updateDatetime || ''));
        return `<li><span class="date">${date}</span><a href="${href}"><h3>${title}</h3></a></li>`;
      })
      .join('\n');
    return `${html}\n<ul data-dynamic-source="ctzc-notice">${synthesized}</ul>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('南宁产投', error));
    return html;
  }
}

async function hydrateCtzcNoticeDetail(url, html, diagnostics = []) {
  try {
    const detail = await fetchCtzcNoticeDetail(url);
    if (!detail?.title && !detail?.content) {
      addDiagnostic(diagnostics, '南宁产投详情动态接口未返回公告正文');
      return html;
    }

    const title = escapeHtml(detail.title || '');
    const publishDate = escapeHtml(parseCtzcDate(detail.publishTime || detail.createDatetime || detail.updateDatetime || ''));
    const content = String(detail.content || '');
    return `${html}\n<article data-dynamic-source="ctzc-notice-detail"><h1>${title}</h1><div class="date">${publishDate}</div><div>${content}</div></article>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('南宁产投详情', error));
    return html;
  }
}

function isCtzcNoticeList(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'ctzc.nncytz.com' && /^#\/notice\/?$/.test(parsed.hash || '#/notice');
  } catch {
    return false;
  }
}

function isCtzcNoticeDetail(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'ctzc.nncytz.com' && /^#\/notice\/detail\/[^/?#]+/.test(parsed.hash);
  } catch {
    return false;
  }
}

async function fetchCtzcNoticeList(url) {
  const parsed = new URL(url);
  const response = await fetch(new URL('/ctzc/service/notice/pageList', parsed.origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    },
    body: JSON.stringify({
      pageNum: 0,
      pageSize: 100,
      condition: {
        title: 'like',
        dataSource: 'ne',
        type: 'ne'
      },
      sorts: [{ field: 'createDatetime', asc: false }],
      queryParameter: {
        noticeType: 'zc',
        isPublish: 1,
        dataSource: 'GR',
        type: ['jjjg', 'jjjgbg']
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : [];
}

async function fetchCtzcNoticeDetail(url) {
  const parsed = new URL(url);
  const id = /^#\/notice\/detail\/([^/?#]+)/.exec(parsed.hash)?.[1] || '';
  if (!id) {
    return null;
  }

  const response = await fetch(new URL(`/ctzc/service/notice/get/${encodeURIComponent(id)}`, parsed.origin), {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body?.data || null;
}

function buildCtzcNoticeDetailUrl(listUrl, item) {
  const parsed = new URL(listUrl);
  const type = item.type ? `?type=${encodeURIComponent(item.type)}` : '';
  return `${parsed.origin}/#/notice/detail/${encodeURIComponent(item._id || '')}${type}`;
}

function parseCtzcDate(value) {
  if (typeof value === 'number' || /^\d{11,}$/.test(String(value || ''))) {
    return formatChinaDate(value);
  }
  return parsePublicationDate(value) || String(value || '').slice(0, 10);
}

async function hydrateGxmuyfyAnnouncementList(url, html, diagnostics = []) {
  try {
    const apiItems = await fetchGxmuyfyBulletinList(url);
    if (apiItems.length === 0) {
      addDiagnostic(diagnostics, '医科大采购平台动态接口未返回公告数据');
      return html;
    }
    const synthesized = apiItems
      .map((item) => {
        const title = escapeHtml(item.title || '');
        const href = escapeHtml(buildGxmuyfyDetailUrl(url, item));
        const date = escapeHtml(parseGxmuyfyDate(item.publishTime || ''));
        return `<li><span class="date">${date}</span><a href="${href}"><h3>${title}</h3></a></li>`;
      })
      .join('\n');
    return `${html}\n<ul data-dynamic-source="gxmuyfy">${synthesized}</ul>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('医科大采购平台', error));
    return html;
  }
}

async function hydrateGxmuyfyAnnouncementInfo(url, html, diagnostics = []) {
  try {
    const detail = await fetchGxmuyfyBulletinDetail(url);
    if (!detail?.title && !detail?.content) {
      addDiagnostic(diagnostics, '医科大采购平台详情动态接口未返回公告正文');
      return html;
    }

    const title = escapeHtml(detail.title || '');
    const publishTime = escapeHtml(detail.publishTime || '');
    const content = String(detail.content || '');
    return `${html}\n<article data-dynamic-source="gxmuyfy-detail"><h1>${title}</h1><div class="date">发布时间：${publishTime}</div><div>${content}</div></article>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('医科大采购平台详情', error));
    return html;
  }
}

function isGxmuyfyAnnouncementList(url) {
  try {
    const parsed = new URL(url);
    return /^\/researchApp\/announcementList(?:\/[^/]+)?\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isGxmuyfyAnnouncementInfo(url) {
  try {
    const parsed = new URL(url);
    return /^\/researchApp\/announcementInfo\/[^/]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function fetchGxmuyfyBulletinList(url) {
  const parsed = new URL(url);
  const apiUrl = new URL('/api/business/open/api/pageSupplierBulletin', parsed.origin);
  apiUrl.searchParams.set('pageNo', '1');
  apiUrl.searchParams.set('pageSize', '100');
  apiUrl.searchParams.set('queryType', '');
  apiUrl.searchParams.set('type', getGxmuyfyAnnouncementType(parsed));

  const response = await fetch(apiUrl, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return Array.isArray(body?.result?.records) ? body.result.records : [];
}

async function fetchGxmuyfyBulletinDetail(url) {
  const parsed = new URL(url);
  const route = parseGxmuyfyDetailRoute(parsed);
  if (!route.id) {
    return null;
  }

  const apiUrl = new URL('/api/business/open/api/queryBulletinDetail', parsed.origin);
  apiUrl.searchParams.set('id', route.id);
  if (route.bizCode) {
    apiUrl.searchParams.set('bizCode', route.bizCode);
  }
  if (route.bizType) {
    apiUrl.searchParams.set('bizType', route.bizType);
  }

  const response = await fetch(apiUrl, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body?.result || null;
}

function getGxmuyfyAnnouncementType(parsedUrl) {
  const routeType = /^\/researchApp\/announcementList\/([^/]+)\/?$/.exec(parsedUrl.pathname)?.[1];
  return parsedUrl.searchParams.get('type') || routeType || 'tender';
}

function parseGxmuyfyDetailRoute(parsedUrl) {
  const [, id = '', bizCode = '', bizType = ''] =
    /^\/researchApp\/announcementInfo\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(parsedUrl.pathname) || [];
  return {
    id: decodeURIComponent(id),
    bizCode: decodeURIComponent(bizCode),
    bizType: decodeURIComponent(bizType)
  };
}

function buildGxmuyfyDetailUrl(listUrl, item) {
  const base = new URL(listUrl);
  const path = ['researchApp', 'announcementInfo', item.id || '', item.bizCode || '', item.bizType || '']
    .map((part) => encodeURIComponent(part))
    .join('/');
  return new URL(`/${path}`, base.origin).toString();
}

function parseGxmuyfyDate(value) {
  return parsePublicationDate(value) || String(value || '').slice(0, 10);
}

async function hydrateCcgpGuangxiFrameworkCategory(url, html, diagnostics = []) {
  try {
    const apiItems = await fetchCcgpGuangxiFrameworkList(url);
    if (apiItems.length === 0) {
      addDiagnostic(diagnostics, '广西政府采购网动态接口未返回公告数据');
      return html;
    }
    const synthesized = apiItems
      .map((item) => {
        const title = escapeHtml(item.title || '');
        const href = escapeHtml(buildCcgpGuangxiDetailUrl(url, item));
        const date = escapeHtml(formatChinaDate(item.publishDate));
        return `<li><span class="date">${date}</span><a href="${href}"><h3>${title}</h3></a></li>`;
      })
      .join('\n');
    return `${html}\n<ul data-dynamic-source="ccgp-guangxi">${synthesized}</ul>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('广西政府采购网', error));
    return html;
  }
}

async function hydrateCcgpGuangxiDetail(url, html, diagnostics = []) {
  try {
    const detail = await fetchCcgpGuangxiDetail(url);
    if (!detail?.title && !detail?.content) {
      addDiagnostic(diagnostics, '广西政府采购网详情动态接口未返回公告正文');
      return html;
    }

    const title = escapeHtml(detail.title || '');
    const publishDate = escapeHtml(formatChinaDate(detail.publishDate));
    const content = String(detail.content || '');
    return `${html}\n<article data-dynamic-source="ccgp-guangxi-detail"><h1>${title}</h1><div class="date">发布时间：${publishDate}</div><div>${content}</div></article>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('广西政府采购网详情', error));
    return html;
  }
}

function isCcgpGuangxiFrameworkCategory(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.ccgp-guangxi.gov.cn' &&
      parsed.pathname === '/site/category' &&
      parsed.searchParams.get('parentId') === '66485' &&
      parsed.searchParams.get('childrenCode') === 'ZcyAnnouncement'
    );
  } catch {
    return false;
  }
}

function isCcgpGuangxiDetail(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.ccgp-guangxi.gov.cn' && parsed.pathname === '/site/detail';
  } catch {
    return false;
  }
}

async function fetchCcgpGuangxiFrameworkList(url) {
  const parsed = new URL(url);
  const response = await fetch(new URL('/portal/category', parsed.origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    },
    body: JSON.stringify({
      pageNo: 1,
      pageSize: 100,
      categoryCode: 'ZcyAnnouncement20',
      _t: Date.now()
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return Array.isArray(body?.result?.data?.data) ? body.result.data.data : [];
}

async function fetchCcgpGuangxiDetail(url) {
  const parsed = new URL(url);
  const articleId = (parsed.searchParams.get('articleId') || '').replace(/ /g, '+');
  if (!articleId) {
    return null;
  }

  const apiUrl = new URL('/portal/detail', parsed.origin);
  apiUrl.searchParams.set('articleId', articleId);
  apiUrl.searchParams.set('parentId', parsed.searchParams.get('parentId') || '66485');

  const response = await fetch(apiUrl, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: url
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body?.result?.data || null;
}

function buildCcgpGuangxiDetailUrl(listUrl, item) {
  const parsed = new URL(listUrl);
  const detailUrl = new URL('/site/detail', parsed.origin);
  detailUrl.searchParams.set('parentId', parsed.searchParams.get('parentId') || '66485');
  detailUrl.searchParams.set('articleId', item.articleId || '');
  return detailUrl.toString();
}

function formatChinaDate(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return parsePublicationDate(value) || String(value || '').slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

async function hydrateGxmzuPurchaseList(url, html, diagnostics = []) {
  try {
    const apiItems = await fetchGxmzuPurchaseItems(url);
    if (apiItems.length === 0) {
      addDiagnostic(diagnostics, '广西民族大学采购平台动态接口未返回公告数据');
      return html;
    }
    const synthesized = apiItems
      .map((item) => {
        const title = escapeHtml(buildGxmzuPurchaseTitle(item));
        const href = escapeHtml(buildGxmzuPurchaseDetailUrl(url, item));
        const date = escapeHtml(parsePublicationDate(item.GGFBRQ || '') || String(item.GGFBRQ || '').slice(0, 10));
        return `<li><span class="date">${date}</span><a href="${href}"><h3>${title}</h3></a></li>`;
      })
      .join('\n');
    return `${html}\n<ul data-dynamic-source="gxmzu-purchase">${synthesized}</ul>`;
  } catch (error) {
    addDiagnostic(diagnostics, dynamicFailureMessage('广西民族大学采购平台', error));
    return html;
  }
}

function isGxmzuPurchaseList(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'purchase.gxmzu.edu.cn' && parsed.pathname === '/cgpt/web/goEjflPage';
  } catch {
    return false;
  }
}

async function fetchGxmzuPurchaseItems(url) {
  const parsed = new URL(url);
  const lx = getGxmzuPurchaseLx(parsed);
  if (!lx) {
    return [];
  }

  const items = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 10); page += 1) {
    const body = new URLSearchParams({
      num: String(page),
      lx,
      cgzzxs: parsed.searchParams.get('cgzzxs') || '03'
    }).toString();
    const response = await fetch(new URL('/cgpt/web/getZbggListCkByLx', parsed.origin), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': DEFAULT_USER_AGENT,
        accept: 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        referer: url
      },
      body
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = JSON.parse(await response.text());
    const pageItems = Array.isArray(payload?.data) ? payload.data : [];
    items.push(...pageItems);
    totalPages = Number(payload?.counts) || totalPages;
    if (pageItems.length === 0 || page >= totalPages) {
      break;
    }
  }

  return items;
}

function getGxmzuPurchaseLx(parsedUrl) {
  const classtype = parsedUrl.searchParams.get('classtype') || '';
  const classid = parsedUrl.searchParams.get('classid') || '';
  const map = {
    zbgg: '01',
    jggg: '02',
    xejjgs: '03',
    zzgg: '04',
    ygg: '06'
  };
  return map[classtype] || (classid === 'gg01' ? '01' : '');
}

function buildGxmzuPurchaseTitle(item) {
  const title = item.ZBGGMC || item.XMMC || '';
  const projectCode = item.XMBH ? `(${item.XMBH})` : '';
  const suffix = item.B1 === '01' ? `${item.CGFSMC || ''}公告` : item.GGLX || '公告';
  return `${title}${projectCode}项目的${suffix}`;
}

function buildGxmzuPurchaseDetailUrl(listUrl, item) {
  const parsed = new URL(listUrl);
  const detailUrl = new URL('/cgpt/web/getWzxx', parsed.origin);
  detailUrl.searchParams.set('id', item.ID || item.ZBGGBH || '');
  detailUrl.searchParams.set('sjmenu', parsed.searchParams.get('sjmenu') || 'cjgg');
  detailUrl.searchParams.set('classid', parsed.searchParams.get('classid') || 'gg01');
  detailUrl.searchParams.set('mc', encodeURI('采购公告'));
  detailUrl.searchParams.set('classtype', parsed.searchParams.get('classtype') || 'zbgg');
  return detailUrl.toString();
}

function isGxufeLevelPage(url, html) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.gxufe.edu.cn' &&
      parsed.pathname.endsWith('/level.html') &&
      html.includes('data-infoListBy-forSearch')
    );
  } catch {
    return false;
  }
}

async function fetchGxufeInformationList(url, html) {
  const parsed = new URL(url);
  const listAttr = /data-infoListBy-forSearch=["']([^"']+)["']/i.exec(html)?.[1] || '$typeid,25,$page';
  const parts = listAttr.split(',').map((part) => part.trim());
  const typeid = resolveGxufeParam(parts[0], parsed) || parsed.searchParams.get('typeid') || '';
  const recordnumber = parts[1] || '25';
  const page = resolveGxufeParam(parts[2], parsed) || '1';
  const typeid00 = parsed.searchParams.get('typeid0')?.slice(0, 3) || 'www';

  const response = await fetch('https://www.gxufe.edu.cn/wwwservice/fetchInformationListBy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'user-agent': DEFAULT_USER_AGENT
    },
    body: JSON.stringify({
      typeid,
      recordnumber,
      page,
      typeid00,
      title: null,
      bmmc: null,
      includeThumbnail: false,
      typeid0: ''
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  if (body?.code !== '0') {
    throw new Error(`接口返回异常：${body?.message || body?.msg || body?.code}`);
  }
  return body.data?.content || [];
}

function resolveGxufeParam(value, parsedUrl) {
  if (!value) {
    return '';
  }
  if (value.startsWith('$')) {
    const key = value.slice(1);
    return parsedUrl.searchParams.get(key) || (key === 'page' ? '1' : '');
  }
  return value;
}

function buildGxufeDetailUrl(listUrl, item) {
  const parsed = new URL(listUrl);
  const typeid = item?.typeid?.typeid || parsed.searchParams.get('typeid') || '';
  return new URL(`informationShow.html?informationid=${item.id}&typeid=${typeid}`, listUrl).toString();
}

function parseGxufeDate(value) {
  return String(value || '').split(',')[0].trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeResponse(buffer, contentType) {
  const headerMatch = /charset\s*=\s*([^;\s]+)/i.exec(contentType);
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, 4096));
  const metaMatch = /<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i.exec(head);
  const charset = (headerMatch?.[1] || metaMatch?.[1] || 'utf-8').toLowerCase();

  const label = charset.includes('gb') ? 'gb18030' : charset;
  try {
    return new TextDecoder(label, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

export function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(?:br|p|div|li|tr|td|th|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getAttr(attrs, name) {
  const regex = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = regex.exec(attrs);
  return match ? match[2] || match[3] || match[4] || '' : '';
}

function cleanAnchorText(html, attrs = '') {
  const attrTitle = cleanMetadataTitle(decodeEntities(getAttr(attrs, 'title') || getAttr(attrs, 'aria-label')).trim());
  if (attrTitle && !isSkippableTitle(attrTitle)) {
    return normalizeTitle(attrTitle);
  }

  const headingMatch = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html);
  if (headingMatch) {
    return normalizeTitle(htmlToText(headingMatch[1]));
  }

  const imageAlt = cleanMetadataTitle(decodeEntities(getAttr(html, 'alt')).trim());
  if (imageAlt && !isSkippableTitle(imageAlt)) {
    return normalizeTitle(imageAlt);
  }

  const text = htmlToText(html);
  const firstLine = text
    .split(/\n+/)
    .map((line) => normalizeTitle(line))
    .find((line) => line && !isSkippableTitle(line));
  return firstLine || normalizeTitle(text);
}

function cleanMetadataTitle(value) {
  const text = String(value || '').trim();
  const titleMatch = /(?:^|\n)\s*(?:\u6807\u9898|title)\s*[：:]\s*([^\n\r]+)/i.exec(text);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  return text;
}

function normalizeTitle(value) {
  return normalizeText(value)
    .replace(/\s*(发布时间|发布日期|发表时间)\s*[：:]\s*\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?\s*$/u, '')
    .trim();
}

function isSkippableHref(href) {
  return !href || href.startsWith('#') || /^javascript:/i.test(href) || /^mailto:/i.test(href);
}

function isSkippableAnchor(attrs) {
  const className = getAttr(attrs, 'class');
  return /\b(?:newt_dtis|summary|desc|intro|excerpt)\b/i.test(className);
}

function isSkippableTitle(title) {
  return (
    title.length < 4 ||
    ['更多', '更多>>', 'more', '详情', '查看详情', '点击查看详情', '点击查看'].includes(title.toLowerCase())
  );
}

export function extractAnnouncementCandidates(html, pageUrl, now = new Date(), diagnostics = []) {
  const candidates = [];
  const seenUrlIndexes = new Map();
  const sourceHtml = findAnnouncementListScope(html) || html;
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of sourceHtml.matchAll(anchorRegex)) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const href = decodeEntities(getAttr(attrs, 'href')).trim();
    if (isSkippableAnchor(attrs)) {
      continue;
    }

    if (isSkippableHref(href)) {
      const title = cleanAnchorText(inner, attrs);
      if (title && !isSkippableTitle(title) && looksLikeAnnouncementTitle(title) && !looksLikeTemplateCode(title)) {
        addDiagnostic(diagnostics, `公告链接无法解析，可能需要人工验证：${truncateDiagnostic(title, 80)}`);
      }
      continue;
    }

    const title = cleanAnchorText(inner, attrs);
    if (isSkippableTitle(title)) {
      continue;
    }

    let url;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }

    const contextHtml = findContainingBlock(sourceHtml, match.index, match[0].length);
    const context = htmlToText(contextHtml);
    const publishedDate =
      extractDateFromContext(contextHtml, now) || parseLikelyPublicationDate(`${title} ${context}`, now);
    const existingIndex = seenUrlIndexes.get(url);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex];
      if (isBetterTitle(title, existing.title)) {
        existing.title = title;
      }
      if (!existing.publishedDate && publishedDate) {
        existing.publishedDate = publishedDate;
      }
      continue;
    }
    seenUrlIndexes.set(url, candidates.length);

    candidates.push({ title, url, publishedDate });
  }

  return candidates;
}

function truncateDiagnostic(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function looksLikeAnnouncementTitle(title) {
  return /(?:公告|公示|招标|采购|磋商|谈判|询价|遴选|比选|竞价|征集|成交|中标|结果|更正|控制价|造价|审计|预算|结算|评审|招租|notice|tender|procurement|bid|audit)/i.test(
    title
  );
}

function looksLikeTemplateCode(title) {
  return /(?:data\[|function|var |let |const |\+\s*data|"\s*\+)/i.test(title);
}

function isBetterTitle(candidate, current) {
  const candidateHasEllipsis = /(?:\.\.\.|…)$/u.test(candidate);
  const currentHasEllipsis = /(?:\.\.\.|…)$/u.test(current);
  if (currentHasEllipsis && !candidateHasEllipsis) {
    return true;
  }
  return candidate.length > current.length + 4;
}

function findAnnouncementListScope(html) {
  const classListRegex = /<ul\b[^>]*class=["'][^"']*\b(?:newsList|news_list|news-ul-list|newt_dul|article_list|ul_article_list|more-list|info-list|oneList|list_box_news|label_ul_b)\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi;
  const matches = [...html.matchAll(classListRegex)]
    .map((match) => match[0])
    .filter((matchHtml) => /<a\b/i.test(matchHtml));
  if (matches.length > 0) {
    return matches.join('\n');
  }

  const newsCenterMatch = /<div\b[^>]*class=["'][^"']*\bnews-center\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\bpagination\b/i.exec(html);
  if (newsCenterMatch) {
    return newsCenterMatch[0];
  }

  return '';
}

function extractDateFromContext(contextHtml, now) {
  const dateBoxMatch = /<div\b[^>]*class=["'][^"']*\bdate_box\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(contextHtml);
  if (dateBoxMatch) {
    const dateBox = dateBoxMatch[1];
    const day = /<p\b[^>]*class=["'][^"']*\bdd\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(dateBox)?.[1];
    const yearMonth = /<p\b[^>]*class=["'][^"']*\bym\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(dateBox)?.[1];
    if (day && yearMonth) {
      const date = parsePublicationDate(`${htmlToText(yearMonth)}-${htmlToText(day)}`, now);
      if (date) {
        return date;
      }
    }
  }

  const nTimeMatch = /<div\b[^>]*class=["'][^"']*\bnTime\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(contextHtml);
  if (nTimeMatch) {
    const timeBox = nTimeMatch[1];
    const day = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(timeBox)?.[1];
    const yearMonth = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(timeBox)?.[1];
    if (day && yearMonth) {
      const date = parsePublicationDate(`${htmlToText(yearMonth)}-${htmlToText(day)}`, now);
      if (date) {
        return date;
      }
    }
  }

  const yearMonthDayMatch = /<div\b[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(contextHtml);
  if (yearMonthDayMatch) {
    const dateBox = yearMonthDayMatch[1];
    const year = /<div\b[^>]*class=["'][^"']*\bday\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(dateBox)?.[1];
    const monthDay = /<div\b[^>]*class=["'][^"']*\byear-month\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(dateBox)?.[1];
    if (year && monthDay) {
      const date = parsePublicationDate(`${htmlToText(year)}-${htmlToText(monthDay)}`, now);
      if (date) {
        return date;
      }
    }
  }

  const smallDateMatch = /<small\b[^>]*>([\s\S]*?)<\/small>/i.exec(contextHtml);
  if (smallDateMatch) {
    const date = parsePublicationDate(htmlToText(smallDateMatch[1]), now);
    if (date) {
      return date;
    }
  }

  const classDateMatch = /<[^>]*class=["'][^"']*(?:date|time|newsTime|article-date)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(contextHtml);
  if (classDateMatch) {
    const date = parsePublicationDate(htmlToText(classDateMatch[1]), now);
    if (date) {
      return date;
    }
  }

  return '';
}

function findContainingBlock(html, anchorIndex, anchorLength) {
  for (const tagName of ['li', 'tr']) {
    const openIndex = html.toLowerCase().lastIndexOf(`<${tagName}`, anchorIndex);
    const previousCloseIndex = html.toLowerCase().lastIndexOf(`</${tagName}>`, anchorIndex);
    const closeIndex = html.toLowerCase().indexOf(`</${tagName}>`, anchorIndex + anchorLength);
    if (openIndex !== -1 && closeIndex !== -1 && openIndex > previousCloseIndex) {
      return html.slice(openIndex, closeIndex + tagName.length + 3);
    }
  }

  const start = Math.max(0, anchorIndex - 300);
  const end = Math.min(html.length, anchorIndex + anchorLength + 300);
  return html.slice(start, end);
}

export function extractDetailPreview(html, keywords, maxChars = 500) {
  const text = htmlToText(html).replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  const lowerText = text.toLowerCase();
  let firstIndex = -1;
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword).toLowerCase();
    if (!normalized) {
      continue;
    }
    const index = lowerText.indexOf(normalized);
    if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  if (firstIndex === -1) {
    return text.slice(0, maxChars);
  }

  const start = Math.max(0, firstIndex - 180);
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
