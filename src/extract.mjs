import { extractWithBrowser } from './browser.mjs';
import { detectCapabilities } from './detect.mjs';
import { fetchResource } from './http.mjs';
import { extractJsonApi } from './json-api.mjs';
import {
  extractAnnouncementCandidates,
  fetchTextWithDiagnostics as fetchMigratedPlatformText
} from './migrated/html.mjs';
import { createResult, diagnostic } from './result.mjs';
import { extractStaticHtml } from './static-html.mjs';

async function staticInput(input, fetchOptions = {}) {
  if (typeof input.html === 'string') {
    return { html: input.html, diagnostics: [] };
  }
  const fetched = await fetchResource(input.url, fetchOptions);
  return { html: fetched.text, diagnostics: fetched.diagnostics };
}

async function extractJson(input) {
  if (input.json) {
    return extractJsonApi(input);
  }
  const fetched = await fetchResource(input.url, {
    ...(input.config?.http || {}),
    accept: 'application/json'
  });
  if (fetched.diagnostics.length) {
    return { records: [], diagnostics: fetched.diagnostics };
  }
  if (!fetched.json) {
    return {
      records: [],
      diagnostics: [
        diagnostic('INVALID_JSON', 'The endpoint did not return JSON.', { severity: 'error' })
      ]
    };
  }
  return extractJsonApi({ ...input, json: fetched.json });
}

async function extractMigratedPlatforms(input) {
  let html = input.html;
  let sourceDiagnostics = [];
  if (typeof html !== 'string') {
    try {
      const fetched = await fetchMigratedPlatformText(input.url, input.config?.http || {});
      html = fetched.text;
      sourceDiagnostics = fetched.diagnostics || [];
    } catch (error) {
      return {
        records: [],
        diagnostics: [
          diagnostic('FETCH_FAILED', error.message, {
            severity: 'error',
            details: { url: input.url }
          })
        ]
      };
    }
  }

  const parserDiagnostics = [];
  const candidates = extractAnnouncementCandidates(
    html,
    input.url,
    input.now || new Date(),
    parserDiagnostics
  );
  return {
    records: candidates.map((item) => ({
      title: item.title,
      url: item.url,
      publishedAt: item.publishedDate || null,
      summary: '',
      raw: item.dateOrigin ? { dateOrigin: item.dateOrigin } : {}
    })),
    diagnostics: [...sourceDiagnostics, ...parserDiagnostics].map((item) =>
      item.code
        ? item
        : diagnostic('MIGRATED_ADAPTER_WARNING', item.message || String(item))
    )
  };
}

export async function extract(input = {}) {
  let capabilityId = input.capabilityId;
  if (!capabilityId || capabilityId === 'auto') {
    const source = await staticInput(input, input.config?.http);
    const detected = await detectCapabilities({ url: input.url, html: source.html });
    capabilityId = detected.recommendations[0]?.capabilityId;
    if (!capabilityId) {
      return createResult('auto', [], [...source.diagnostics, ...detected.diagnostics], input.url);
    }
    input = { ...input, html: source.html };
  }

  let extracted;
  if (capabilityId === 'static-html-list' || capabilityId === 'action-link-resolution') {
    const source = await staticInput(input, input.config?.http);
    extracted = source.diagnostics.length
      ? { records: [], diagnostics: source.diagnostics }
      : extractStaticHtml({ ...input, html: source.html });
  } else if (capabilityId === 'json-api-list') {
    extracted = await extractJson(input);
  } else if (capabilityId === 'spa-api') {
    if (input.config?.apiUrl) {
      extracted = await extractJson({
        ...input,
        url: new URL(input.config.apiUrl, input.url).toString(),
        config: input.config.json || input.config
      });
    } else {
      extracted = {
        records: [],
        diagnostics: [
          diagnostic(
            'DYNAMIC_CONFIGURATION_REQUIRED',
            'SPA extraction requires a documented apiUrl mapping or a browser capability.'
          )
        ]
      };
    }
  } else if (
    ['browser-click', 'complex-js-browser', 'authenticated-session'].includes(capabilityId)
  ) {
    extracted = await extractWithBrowser(input, capabilityId);
  } else if (capabilityId === 'human-verification') {
    extracted = {
      records: [],
      diagnostics: [
        diagnostic(
          'HUMAN_VERIFICATION_REQUIRED',
          'An authorized human must complete the challenge; bypassing it is outside the library boundary.'
        )
      ]
    };
  } else if (capabilityId === 'fixed-dns-host') {
    if (!input.config?.resolveIp) {
      extracted = {
        records: [],
        diagnostics: [
          diagnostic('CONFIG_REQUIRED', 'fixed-dns-host requires config.resolveIp.', {
            severity: 'error'
          })
        ]
      };
    } else {
      const source = await staticInput(input, {
        ...(input.config.http || {}),
        resolveIp: input.config.resolveIp
      });
      extracted = source.diagnostics.length
        ? { records: [], diagnostics: source.diagnostics }
        : extractStaticHtml({ ...input, html: source.html });
    }
  } else if (capabilityId === 'domain-migration') {
    if (!input.config?.rewriteMap) {
      extracted = {
        records: [],
        diagnostics: [
          diagnostic('CONFIG_REQUIRED', 'domain-migration requires config.rewriteMap.', {
            severity: 'error'
          })
        ]
      };
    } else {
      const source = await staticInput(input, {
        ...(input.config.http || {}),
        rewriteMap: input.config.rewriteMap
      });
      extracted = source.diagnostics.length
        ? { records: [], diagnostics: source.diagnostics }
        : extractStaticHtml({ ...input, html: source.html });
    }
  } else if (capabilityId === 'tender-platform-families') {
    extracted = await extractMigratedPlatforms(input);
  } else {
    extracted = {
      records: [],
      diagnostics: [
        diagnostic('UNKNOWN_CAPABILITY', `Unknown capability: ${capabilityId}`, {
          severity: 'error'
        })
      ]
    };
  }

  return createResult(capabilityId, extracted.records, extracted.diagnostics, input.url);
}
