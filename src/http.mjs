import http from 'node:http';
import https from 'node:https';

import { diagnostic } from './result.mjs';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36';

function decodeBody(buffer, contentType = '') {
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function fetchWithFixedResolve(rawUrl, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers: { ...options.headers, host: parsed.host },
        servername: parsed.hostname,
        lookup(_hostname, lookupOptions, callback) {
          const family = options.resolveIp.includes(':') ? 6 : 4;
          if (lookupOptions?.all) {
            callback(null, [{ address: options.resolveIp, family }]);
          } else {
            callback(null, options.resolveIp, family);
          }
        }
      },
      (response) => {
        const status = response.statusCode || 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location &&
          redirectCount < 5
        ) {
          response.resume();
          fetchWithFixedResolve(
            new URL(response.headers.location, rawUrl).toString(),
            options,
            redirectCount + 1
          ).then(resolve, reject);
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusMessage || '',
            buffer: Buffer.concat(chunks),
            contentType: String(response.headers['content-type'] || '')
          })
        );
      }
    );
    request.on('error', reject);
    request.setTimeout(options.timeoutMs || 30000, () =>
      request.destroy(new Error(`request timed out after ${options.timeoutMs || 30000}ms`))
    );
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function rewriteUrl(rawUrl, rewriteMap = {}) {
  const parsed = new URL(rawUrl);
  const replacement = rewriteMap[parsed.hostname];
  if (replacement) {
    parsed.hostname = replacement;
  }
  return parsed.toString();
}

export async function fetchResource(rawUrl, options = {}) {
  const url = rewriteUrl(rawUrl, options.rewriteMap);
  const headers = {
    'user-agent': options.userAgent || DEFAULT_USER_AGENT,
    accept: options.accept || 'text/html,application/json;q=0.9,*/*;q=0.8',
    'accept-language': options.acceptLanguage || 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(options.headers || {})
  };

  try {
    let response;
    if (options.resolveIp) {
      response = await fetchWithFixedResolve(url, { ...options, headers });
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
      try {
        const nativeResponse = await fetch(url, {
          method: options.method || 'GET',
          headers,
          body: options.body,
          signal: controller.signal
        });
        response = {
          ok: nativeResponse.ok,
          status: nativeResponse.status,
          statusText: nativeResponse.statusText,
          buffer: Buffer.from(await nativeResponse.arrayBuffer()),
          contentType: nativeResponse.headers.get('content-type') || ''
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (!response.ok) {
      return {
        text: '',
        json: null,
        diagnostics: [
          diagnostic('HTTP_ERROR', `HTTP ${response.status} ${response.statusText}`.trim(), {
            severity: 'error',
            details: { url }
          })
        ]
      };
    }

    const text = decodeBody(response.buffer, response.contentType);
    let json = null;
    if (/json/i.test(response.contentType)) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        return {
          text,
          json: null,
          diagnostics: [
            diagnostic('INVALID_JSON', error.message, { severity: 'error', details: { url } })
          ]
        };
      }
    }
    return { text, json, diagnostics: [], resolvedUrl: url };
  } catch (error) {
    const cause = error.cause?.code || error.cause?.message;
    return {
      text: '',
      json: null,
      diagnostics: [
        diagnostic('FETCH_FAILED', [error.message, cause].filter(Boolean).join(': '), {
          severity: 'error',
          details: { url }
        })
      ]
    };
  }
}
