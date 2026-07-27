import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  extractAnnouncementCandidates,
  extractDetailPreview,
  fetchText,
  fetchTextWithDiagnostics,
  htmlToText
} from '../src/migrated/html.mjs';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

test('从公告列表 HTML 提取标题、链接和发布日期', () => {
  const html = fs.readFileSync(path.join(fixtureDir, 'list.html'), 'utf8');
  const items = extractAnnouncementCandidates(html, 'https://example.edu.cn/zbcg/index.html');
  assert.deepEqual(items.slice(0, 2), [
    {
      title: '智慧校园平台升级采购公告',
      url: 'https://example.edu.cn/zbcg/2026/0514/1.html',
      publishedDate: '2026-05-14'
    },
    {
      title: '实验室服务器采购结果公告',
      url: 'https://example.edu.cn/zbcg/2026/0510/2.html',
      publishedDate: '2026-05-10'
    }
  ]);
});

test('详情预览优先截取关键词附近内容', () => {
  const html = '<html><body><p>本项目采购内容包括网络设备、智慧校园平台、实施服务和培训。</p></body></html>';
  assert.match(extractDetailPreview(html, ['智慧校园']), /智慧校园平台/);
});

test('公告卡片只用标题元素，不把摘要并入标题', () => {
  const html = `
    <ul>
      <li>
        <a href="/notice/1.html">
          <div>
            <h3>广西壮族自治区生殖医院洁净层流空调管道维修服务采购公告</h3>
            <p>项目预算金额：31000.00元，按实际供货数量结算。</p>
            <span>发布时间：2026-05-14</span>
          </div>
        </a>
      </li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'https://example.com/notice/');
  assert.equal(item.title, '广西壮族自治区生殖医院洁净层流空调管道维修服务采购公告');
  assert.equal(item.publishedDate, '2026-05-14');
});

test('分离的年月和日期优先作为公告发布日期', () => {
  const html = `
    <li>
      <div class="date_box"><p class="dd">14</p><p class="ym">2026-05</p></div>
      <a href="/notice/2.html" title="互联网+大学生安全教育采购项目竞争性磋商公告">互联网+大学生安全教育采购项目竞争性磋商公告</a>
      <div class="intro">响应文件提交截止时间：2026年5月25日15时00分</div>
    </li>`;
  const [item] = extractAnnouncementCandidates(html, 'https://example.com/list/');
  assert.equal(item.title, '互联网+大学生安全教育采购项目竞争性磋商公告');
  assert.equal(item.publishedDate, '2026-05-14');
});

test('list item small date wins over deadline date in summary', () => {
  const html = `
    <ul>
      <li class="noTxt"><a href="/notice/notice_zbcg/15308.html">
        <div class="nTime"><p>15</p><span>2026/06</span></div>
        <div class="nRight">
          <div class="tTxt">
            <h3>Audit service competitive negotiation notice</h3>
            <p>Suppliers should submit response documents before 2026-06-23 09:30.</p>
            <small>2026-06-15</small>
          </div>
        </div>
      </a></li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'https://www.gxmush.cn/notice/notice_zbcg.html');
  assert.equal(item.url, 'https://www.gxmush.cn/notice/notice_zbcg/15308.html');
  assert.equal(item.publishedDate, '2026-06-15');
});

test('deadline-only dates are not treated as publication dates', () => {
  const html = `
    <ul>
      <li>
        <a href="/notice/a.html">
          <h3>Audit service procurement notice</h3>
          <p>响应文件提交截止时间：2026年5月25日15时00分</p>
        </a>
      </li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'https://example.com/list/');
  assert.equal(item.title, 'Audit service procurement notice');
  assert.equal(item.publishedDate, '');
});

test('action title metadata does not override real heading', () => {
  const html = `
    <ul>
      <li>
        <a href="/notice/a.html" title="点击查看详情">
          <h3>Audit service procurement notice</h3>
          <span class="date">2026-06-20</span>
        </a>
      </li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'https://example.com/list/');
  assert.equal(item.title, 'Audit service procurement notice');
});

test('javascript announcement links produce parser diagnostics', () => {
  const diagnostics = [];
  const html = `
    <ul>
      <li><a href="javascript:void(0)" onclick="openNotice('1')"><h3>Audit service notice</h3></a></li>
    </ul>`;
  const items = extractAnnouncementCandidates(html, 'https://example.com/list/', new Date(), diagnostics);
  assert.equal(items.length, 0);
  assert.match(diagnostics[0].message, /公告链接无法解析/);
  assert.match(diagnostics[0].message, /Audit service notice/);
});

test('广西财经学院动态接口列表可合成为公告候选', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('level.html')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxufe-level.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('fetchInformationListBy')) {
      assert.equal(JSON.parse(options.body).typeid, 'www010e');
      return new Response(
        JSON.stringify({
          code: '0',
          data: {
            content: [
              {
                id: '1',
                title: '广西财经学院施工图设计和招标控制价编制服务项目竞争性磋商公告',
                url: 'https://example.com/notice/1',
                datetime: '2026-05-15,10:00:00'
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const html = await fetchText('https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01');
    const [item] = extractAnnouncementCandidates(
      html,
      'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01'
    );
    assert.equal(item.title, '广西财经学院施工图设计和招标控制价编制服务项目竞争性磋商公告');
    assert.equal(item.publishedDate, '2026-05-15');
    assert.equal(item.url, 'https://example.com/notice/1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dynamic list API failure is returned as diagnostics instead of silent empty candidates', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('level.html')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxufe-level.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('fetchInformationListBy')) {
      return new Response('server error', { status: 500, statusText: 'Internal Server Error' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const result = await fetchTextWithDiagnostics(
      'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01'
    );
    assert.match(result.diagnostics[0].message, /动态接口失败/);
    assert.equal(
      extractAnnouncementCandidates(
        result.text,
        'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01'
      ).length,
      0
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gxmuyfy announcement list API is synthesized into notice candidates', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/researchApp/announcementList')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxmuyfy-announcement-list.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/api/business/open/api/pageSupplierBulletin')) {
      const apiUrl = new URL(String(url));
      assert.equal(apiUrl.searchParams.get('type'), 'tender');
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            records: [
              {
                id: '2055206693603700738',
                title: '广西医科大学第一附属医院招标控制价编制服务采购询比公告',
                publishTime: '2026-05-15 17:20:17',
                bizCode: 'xbgg',
                bizType: 'common'
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url = 'https://cg.gxmuyfy.cn/researchApp/announcementList';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, '广西医科大学第一附属医院招标控制价编制服务采购询比公告');
    assert.equal(item.publishedDate, '2026-05-15');
    assert.equal(
      item.url,
      'https://cg.gxmuyfy.cn/researchApp/announcementInfo/2055206693603700738/xbgg/common'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gxmuyfy announcement detail API is synthesized into preview text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/researchApp/announcementInfo/2055206693603700738/xbgg/common')) {
      return new Response('<html><body><div id="app">loading</div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/api/business/open/api/queryBulletinDetail')) {
      const apiUrl = new URL(String(url));
      assert.equal(apiUrl.searchParams.get('id'), '2055206693603700738');
      assert.equal(apiUrl.searchParams.get('bizCode'), 'xbgg');
      assert.equal(apiUrl.searchParams.get('bizType'), 'common');
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            title: '广西医科大学第一附属医院招标控制价编制服务采购询比公告',
            publishTime: '2026-05-15 17:20:17',
            content: '<p>本项目需要招标控制价编制服务，欢迎供应商报名。</p>'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const html = await fetchText('https://cg.gxmuyfy.cn/researchApp/announcementInfo/2055206693603700738/xbgg/common');
    assert.match(htmlToText(html), /发布时间：2026-05-15 17:20:17/);
    assert.match(extractDetailPreview(html, ['控制价']), /招标控制价编制服务/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('researchApp announcement platform supports IP host deployments', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/researchApp/announcementList')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxmuyfy-announcement-list.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/api/business/open/api/pageSupplierBulletin')) {
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            records: [
              {
                id: '100',
                title: 'Hospital audit service notice',
                publishTime: '2026-05-18 09:00:00',
                bizCode: 'xbgg',
                bizType: 'common'
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url = 'http://124.227.108.205:9810/researchApp/announcementList';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, 'Hospital audit service notice');
    assert.equal(item.publishedDate, '2026-05-18');
    assert.equal(item.url, 'http://124.227.108.205:9810/researchApp/announcementInfo/100/xbgg/common');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ctzc notice list API is synthesized into notice candidates', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('ctzc.nncytz.com/#/notice')) {
      return new Response('<html><body><div id="app">loading</div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/ctzc/service/notice/pageList')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.queryParameter.noticeType, 'zc');
      assert.equal(body.queryParameter.isPublish, 1);
      return new Response(
        JSON.stringify({
          code: 0,
          data: [
            {
              _id: '709203555952623616',
              title: 'Nanning industry control price procurement notice',
              type: 'cggg',
              publishTime: 1780048490398,
              createDatetime: '2026-05-29 17:54:50'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url = 'https://ctzc.nncytz.com/#/notice';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, 'Nanning industry control price procurement notice');
    assert.equal(item.publishedDate, '2026-05-29');
    assert.equal(item.url, 'https://ctzc.nncytz.com/#/notice/detail/709203555952623616?type=cggg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ctzc notice detail API is synthesized into preview text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('ctzc.nncytz.com/#/notice/detail/709203555952623616')) {
      return new Response('<html><body><div id="app">loading detail</div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/ctzc/service/notice/get/709203555952623616')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            _id: '709203555952623616',
            title: 'Nanning industry control price procurement notice',
            publishTime: 1780048490398,
            content: '<p>This notice includes budget and control price requirements.</p>'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const html = await fetchText('https://ctzc.nncytz.com/#/notice/detail/709203555952623616');
    assert.match(htmlToText(html), /2026-05-29/);
    assert.match(extractDetailPreview(html, ['control price']), /control price requirements/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ccgp guangxi framework category API is synthesized into notice candidates', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/site/category')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'ccgp-guangxi-category.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/portal/category')) {
      const body = JSON.parse(options.body);
      assert.equal(body.categoryCode, 'ZcyAnnouncement20');
      assert.equal(body.pageNo, 1);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            data: {
              data: [
                {
                  articleId: 'abc+123==',
                  title: 'Framework control price service notice',
                  publishDate: 1779092383000
                }
              ]
            }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url =
      'http://www.ccgp-guangxi.gov.cn/site/category?parentId=66485&childrenCode=ZcyAnnouncement';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, 'Framework control price service notice');
    assert.equal(item.publishedDate, '2026-05-18');
    assert.equal(
      item.url,
      'http://www.ccgp-guangxi.gov.cn/site/detail?parentId=66485&articleId=abc%2B123%3D%3D'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ccgp guangxi detail API is synthesized into preview text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/site/detail')) {
      return new Response('<html><body><div id="app">loading detail</div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/portal/detail')) {
      const apiUrl = new URL(String(url));
      assert.equal(apiUrl.searchParams.get('articleId'), 'abc+123==');
      assert.equal(apiUrl.searchParams.get('parentId'), '66485');
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            data: {
              title: 'Framework control price service notice',
              publishDate: 1779092383000,
              content: '<p>This notice includes control price and audit service requirements.</p>'
            }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const html = await fetchText(
      'http://www.ccgp-guangxi.gov.cn/site/detail?parentId=66485&articleId=abc%2B123%3D%3D'
    );
    assert.match(htmlToText(html), /2026-05-18/);
    assert.match(extractDetailPreview(html, ['control price']), /control price and audit service/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gxmzu purchase list API is synthesized into notice candidates', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/cgpt/web/goEjflPage')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxmzu-purchase.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/cgpt/web/getZbggListCkByLx')) {
      assert.equal(options.method, 'POST');
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('num'), '1');
      assert.equal(params.get('lx'), '01');
      assert.equal(params.get('cgzzxs'), '03');
      return new Response(
        JSON.stringify({
          counts: 1,
          data: [
            {
              ID: '002748',
              XMBH: '2026042590',
              ZBGGMC: 'Campus audit service',
              B1: '01',
              CGFSMC: 'Review',
              GGFBRQ: '2026-05-12'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url =
      'https://purchase.gxmzu.edu.cn/cgpt/web/goEjflPage?sjmenu=gg01&classid=gg01&classtype=zbgg&cgzzxs=03';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, 'Campus audit service(2026042590)\u9879\u76ee\u7684Review\u516c\u544a');
    assert.equal(item.publishedDate, '2026-05-12');
    const itemUrl = new URL(item.url);
    assert.equal(itemUrl.pathname, '/cgpt/web/getWzxx');
    assert.equal(itemUrl.searchParams.get('id'), '002748');
    assert.equal(itemUrl.searchParams.get('mc'), '%E9%87%87%E8%B4%AD%E5%85%AC%E5%91%8A');
    assert.equal(itemUrl.searchParams.get('classtype'), 'zbgg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform pagination is not truncated by an application-specific age policy', async () => {
  const originalFetch = globalThis.fetch;
  let listRequestCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/cgpt/web/goEjflPage')) {
      return new Response(fs.readFileSync(path.join(fixtureDir, 'gxmzu-purchase.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (String(url).includes('/cgpt/web/getZbggListCkByLx')) {
      listRequestCount += 1;
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('num'), String(listRequestCount));
      return new Response(
        JSON.stringify({
          counts: 3,
          data: [
            {
              ID: 'old-1',
              XMBH: '2026010101',
              ZBGGMC: 'Old audit service',
              B1: '01',
              CGFSMC: 'Review',
              GGFBRQ: '2000-01-01'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url =
      'https://purchase.gxmzu.edu.cn/cgpt/web/goEjflPage?sjmenu=gg01&classid=gg01&classtype=zbgg&cgzzxs=03';
    const html = await fetchText(url);
    const items = extractAnnouncementCandidates(html, url);
    assert.equal(listRequestCount, 3);
    assert.equal(items.length, 1);
    assert.equal(items[0].publishedDate, '2000-01-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('newsList scope ignores breadcrumb links and cleans title metadata', () => {
  const html = `
    <div class="path">
      <a href="/xwzx" title="News Center">News Center</a>
    </div>
    <ul class="newsList">
      <li>
        <span class="date">2026.05.18</span>
        <a href="/xwzx/tzgg/content_1" title="&#x6807;&#x9898;&#xFF1A;Campus procurement notice&#xD;&#xA;&#x70B9;&#x51FB;&#x6570;&#xFF1A;8&#xD;&#xA;&#x53D1;&#x8868;&#x65F6;&#x95F4;&#xFF1A;2026-05-18">
          Campus procurement notice
        </a>
      </li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'https://example.edu.cn/xwzx/tzgg_1');
  assert.equal(item.title, 'Campus procurement notice');
  assert.equal(item.publishedDate, '2026-05-18');
  assert.equal(item.url, 'https://example.edu.cn/xwzx/tzgg/content_1');
});

test('more-list scope ignores header links', () => {
  const html = `
    <div class="head-bar">
      <a href="https://example.com/media">Government media</a>
    </div>
    <ul class="more-list">
      <li>
        <span>2026-04-29</span>
        <a href="./t1.shtml" title="Rail media placement tender notice">Rail media placement tender notice</a>
      </li>
    </ul>`;
  const [item] = extractAnnouncementCandidates(html, 'http://example.gov.cn/cgztbxx/');
  assert.equal(item.title, 'Rail media placement tender notice');
  assert.equal(item.publishedDate, '2026-04-29');
  assert.equal(item.url, 'http://example.gov.cn/cgztbxx/t1.shtml');
});

test('gxzyy WAF cookie and info-list scope are supported', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('gxzyy.com.cn/public_cggg')) {
      assert.match(options.headers['user-agent'], /Chrome\/\d+/);
      assert.match(options.headers['accept-language'], /zh-CN/);
      assert.match(options.headers.cookie, /visited=1/);
      assert.match(options.headers.cookie, /Waf_Tag=\d+/);
      return new Response(
        `<html><body>
          <a href="/yzxx/">Header link</a>
          <ul class="info-list">
            <li><a href="https://www.gxzyy.com.cn/public_cggg/2026/a.html">Tender notice</a><span>2026-05-12</span></li>
          </ul>
        </body></html>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const url = 'https://www.gxzyy.com.cn/public_cggg/';
    const html = await fetchText(url);
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, 'Tender notice');
    assert.equal(item.publishedDate, '2026-05-12');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('固定解析 IP 连接指定地址并保留原始 Host', async () => {
  let port = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.host, `example.test:${port}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`
      <ul class="news-ul-list">
        <li>
          <div class="news-ul-date"><span>05-15</span>2026</div>
          <a href="/info/1240/35338.htm" title="广西科技大学文昌校区学生服务中心主楼一楼房屋招租项目交易公告">标题被截断</a>
        </li>
      </ul>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  try {
    const url = `http://example.test:${port}/xwzx/zbgs.htm`;
    const html = await fetchText(url, { resolveIp: '127.0.0.1', retries: 0 });
    const [item] = extractAnnouncementCandidates(html, url);
    assert.equal(item.title, '广西科技大学文昌校区学生服务中心主楼一楼房屋招租项目交易公告');
    assert.equal(item.publishedDate, '2026-05-15');
    assert.equal(item.url, `http://example.test:${port}/info/1240/35338.htm`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetch errors include the underlying network cause', async () => {
  const originalFetch = globalThis.fetch;
  const cause = new Error('connect ECONNRESET 10.0.0.1:443');
  cause.code = 'ECONNRESET';
  const error = new TypeError('fetch failed');
  error.cause = cause;
  globalThis.fetch = async () => {
    throw error;
  };

  try {
    await assert.rejects(
      () => fetchTextWithDiagnostics('https://example.com/list.html', { retries: 0 }),
      /fetch failed: ECONNRESET: connect ECONNRESET 10\.0\.0\.1:443/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('newt_dul list scope extracts hospital announcement cards', () => {
  const html = `
    <div class="ried">
      <a href="/html/yygkp/yyjj/">医院概况</a>
      <a href="/html/yydt/">医院动态</a>
    </div>
    <ul class="newt_dul clearfix">
      <li class="clearfix newt_dlifl1">
        <a href="http://www.mzyyh.com/html/2026/yygg_0529/655.html" class="newt_dimg"><img src="/cover.png"></a>
        <div class="newt_dfr">
          <a href="http://www.mzyyh.com/html/2026/yygg_0529/655.html" class="newt_dtit">崇左市荣军优抚医院公开征集拟采购医疗设备参数及询价的公告</a>
          <a href="http://www.mzyyh.com/html/2026/yygg_0529/655.html" class="newt_dtis">这是一段摘要，不应当作标题</a>
          <p class="newt_dtime">
            <span class="newt_ytime"><span class="newt_yym">2026-05</span><span>-</span><span class="newt_ys">29</span></span>
          </p>
        </div>
      </li>
    </ul>`;
  const items = extractAnnouncementCandidates(html, 'http://www.mzyyh.com/html/yygg/');
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.title, '崇左市荣军优抚医院公开征集拟采购医疗设备参数及询价的公告');
  assert.equal(item.publishedDate, '2026-05-29');
  assert.equal(item.url, 'http://www.mzyyh.com/html/2026/yygg_0529/655.html');
});

test('label_ul_b scope extracts gxjmxy procurement notices and ignores navigation', () => {
  const html = `
    <div class="fr">
      <a href="http://jw.gxjmxy.com/jwglxt/" title="教务系统">教务系统</a>
    </div>
    <div class="main4">
      <div>
        <ul class="label_ul_b">
          <li>
            <span class="label_datatime">2026-06-30</span>
            <a href="/www/cwccggg/24897.jhtml" title="广西机电设备招标有限公司关于2026-2028年五合校区医务室医疗保健及新生体检服务采购竞争性磋商公告">
              <span class="ctgName">[采购公告]-</span>
              广西机电设备招标有限公司关于2026-2028年五合校区医务室医疗保健及新生体检服务采...
            </a>
          </li>
        </ul>
      </div>
      <div>
        <ul class="label_ul_b">
          <li>
            <span class="label_datatime">2026-06-25</span>
            <a href="/www/cwccggg/24862.jhtml" title="广西两仪工程管理咨询有限公司关于2026年职业技能培训及认定服务竞争性谈判公告">
              <span class="ctgName">[采购公告]-</span>
              广西两仪工程管理咨询有限公司关于2026年职业技能培训及认定服务...
            </a>
          </li>
        </ul>
      </div>
    </div>`;

  const items = extractAnnouncementCandidates(html, 'https://www.gxjmxy.edu.cn/www/cwccggg/index.jhtml');

  assert.equal(items.length, 2);
  assert.equal(
    items[0].title,
    '广西机电设备招标有限公司关于2026-2028年五合校区医务室医疗保健及新生体检服务采购竞争性磋商公告'
  );
  assert.equal(items[0].publishedDate, '2026-06-30');
  assert.equal(items[0].url, 'https://www.gxjmxy.edu.cn/www/cwccggg/24897.jhtml');
  assert.equal(items[1].publishedDate, '2026-06-25');
});

test('moved gxmzyy old domain is fetched from the current domain', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://www.gxmzyy.cn/ywgk/zbxx/index.html');
    return new Response('<html><body>ok</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  };

  try {
    const html = await fetchText('https://gxmzyy.gxrb.com.cn/ywgk/zbxx/index.html');
    assert.equal(html, '<html><body>ok</body></html>');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('news-center scope extracts gxmzyy procurement notices and dates', () => {
  const html = `
    <div class="nav">
      <a href="https://www.gxmzyy.cn/yygk/yyjj/index.html">医院概况</a>
      <a href="https://www.gxmzyy.cn/xwzx/index.html">新闻中心</a>
    </div>
    <div class="news-center">
      <h3>招标采购</h3>
      <ul>
        <li>
          <div class="date">
            <div class="day">2026</div>
            <div class="year-month">06-22</div>
          </div>
          <div class="news-content">
            <dl>
              <dt>
                <a href="https://www.gxmzyy.cn/ywgk/zbxx/635112.html" target="_blank">广西壮族自治区民族医院关于取材台自行采购公告（第二次）</a>
              </dt>
              <dd>摘要内容</dd>
            </dl>
          </div>
        </li>
        <li>
          <div class="date">
            <div class="day">2026</div>
            <div class="year-month">06-15</div>
          </div>
          <div class="news-content">
            <dl>
              <dt>
                <a href="https://www.gxmzyy.cn/ywgk/zbxx/633677.html" target="_blank">广西壮族自治区民族医院关于净水机维保服务自行采购公告</a>
              </dt>
              <dd>摘要内容</dd>
            </dl>
          </div>
        </li>
      </ul>
      <div class="pagination" id="pages"></div>
    </div>`;

  const items = extractAnnouncementCandidates(html, 'https://gxmzyy.gxrb.com.cn/ywgk/zbxx/index.html');

  assert.equal(items.length, 2);
  assert.equal(items[0].title, '广西壮族自治区民族医院关于取材台自行采购公告（第二次）');
  assert.equal(items[0].publishedDate, '2026-06-22');
  assert.equal(items[0].url, 'https://www.gxmzyy.cn/ywgk/zbxx/635112.html');
  assert.equal(items[1].publishedDate, '2026-06-15');
});

test('oneList scope extracts main hospital list and deduplicates image links', () => {
  const html = `
    <div class="subThree">
      <a class="aNews" href="/info/infozbcg/23848.html">Nav consumables notice</a>
    </div>
    <ul class="oneList oneListTxt">
      <li>
        <div class="newsTxt fr" style="width: 100%;">
          <h3><a href="/info/infozbcg/23848.html">Hospital consumables shortlist notice</a></h3>
          <p>Summary text</p>
          <div class="newsInfo"><span class="newsTime">发布时间：2026-05-29</span></div>
        </div>
      </li>
      <li>
        <div class="newsImg img_hover fl">
          <a href="/info/infozbcg/23853.html">
            <img src="/upload/shoes.jpg" alt="Hospital nurse shoes procurement research notice">
          </a>
        </div>
        <div class="newsTxt fr">
          <h3><a href="/info/infozbcg/23853.html">Hospital nurse shoes procurement...</a></h3>
          <p>Summary text</p>
          <div class="newsInfo"><span class="newsTime">发布时间：2026-05-29</span></div>
        </div>
      </li>
      <li>
        <div class="newsImg img_hover fl">
          <a href="/info/infozbcg/23845.html">
            <img src="/upload/device.jpg" alt="Hospital ultrafiltration device market research notice">
          </a>
        </div>
        <div class="newsTxt fr">
          <h3><a href="/info/infozbcg/23845.html">Hospital ultrafiltration device...</a></h3>
          <p>Summary text</p>
          <div class="newsInfo"><span class="newsTime">发布时间：2026-05-28</span></div>
        </div>
      </li>
    </ul>`;
  const items = extractAnnouncementCandidates(html, 'https://www.gxzyefy.cn/info/infozbcg.html');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Hospital consumables shortlist notice');
  assert.equal(items[0].publishedDate, '2026-05-29');
  assert.equal(items[1].title, 'Hospital nurse shoes procurement research notice');
  assert.equal(items[1].publishedDate, '2026-05-29');
  assert.equal(items[2].title, 'Hospital ultrafiltration device market research notice');
  assert.equal(items[2].publishedDate, '2026-05-28');
});

test('list_box_news scope ignores category navigation', () => {
  const html = `
    <ul class="n_left_list">
      <li><a href="../jyyw.htm" title="News">News</a></li>
      <li><a href="../zbgg.htm" title="Tender notices">Tender notices</a></li>
    </ul>
    <ul class="list_box_news">
      <li>
        <a href="../../info/1181/11563.htm" title="Website monitoring service inquiry notice">
          <font>Website monitoring service inquiry notice</font>
          <div class="date">2026-06-05</div>
        </a>
      </li>
      <li>
        <a href="../../info/1181/11534.htm" title="Website monitoring service repeat inquiry notice">
          <font>Website monitoring service repeat inquiry notice</font>
          <div class="date">2026-05-28</div>
        </a>
      </li>
    </ul>`;
  const items = extractAnnouncementCandidates(
    html,
    'https://www.gxjtc.edu.cn/xwjj/zbgg/a2_5wy_bh_xmxjgg.htm'
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Website monitoring service inquiry notice');
  assert.equal(items[0].publishedDate, '2026-06-05');
  assert.equal(items[0].url, 'https://www.gxjtc.edu.cn/info/1181/11563.htm');
  assert.equal(items[1].publishedDate, '2026-05-28');
});
