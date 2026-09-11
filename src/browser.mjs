import { containsHumanChallenge } from './detect.mjs';
import { diagnostic } from './result.mjs';
import { extractStaticHtml } from './static-html.mjs';

export async function extractWithBrowser(input, capabilityId, parsePage = extractStaticHtml) {
  const config = input.config || {};
  if (
    capabilityId === 'authenticated-session' &&
    !config.storageStatePath &&
    !config.cdpEndpoint
  ) {
    return {
      records: [],
      diagnostics: [
        diagnostic(
          'AUTH_SESSION_REQUIRED',
          'Provide an application-owned storageStatePath or cdpEndpoint; credentials are never stored by the library.'
        )
      ]
    };
  }

  const moduleName = input.browserModule || config.browserModule || 'playwright';
  let playwright;
  try {
    playwright = await import(moduleName);
  } catch {
    return {
      records: [],
      diagnostics: [
        diagnostic(
          'CAPABILITY_DEPENDENCY_MISSING',
          `Browser extraction requires the mature "${moduleName}" driver. Install it in the consuming application.`
        )
      ]
    };
  }

  let browser;
  let context;
  let page;
  try {
    browser = config.cdpEndpoint
      ? await playwright.chromium.connectOverCDP(config.cdpEndpoint)
      : await playwright.chromium.launch({ headless: config.headless !== false });
    context = config.cdpEndpoint
      ? browser.contexts()[0]
      : await browser.newContext(
          config.storageStatePath ? { storageState: config.storageStatePath } : undefined
        );
    page = await context.newPage();
    let navigationResponse;
    if (parsePage !== extractStaticHtml) {
      page.on?.('response', (response) => {
        if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
          navigationResponse = response;
        }
      });
    }
    const httpFailure = () => parsePage !== extractStaticHtml && navigationResponse?.status() >= 400
      ? { records: [], diagnostics: [diagnostic('HTTP_ERROR',
        `HTTP ${navigationResponse.status()} ${navigationResponse.statusText()}`.trim(), { severity: 'error' })] }
      : null;
    navigationResponse = await page.goto(input.url, {
      waitUntil: config.waitUntil || 'networkidle',
      timeout: config.timeoutMs || 30000
    }) || navigationResponse;
    if (httpFailure()) return httpFailure();

    const clickSteps = Array.isArray(config.clicks)
      ? config.clicks
      : config.click
        ? [config.click]
        : [];
    for (const step of clickSteps) {
      if (step.text) {
        await page.getByText(step.text, { exact: step.exact !== false }).click();
      } else if (step.selector) {
        await page.locator(step.selector).click();
      }
      await page.waitForLoadState(step.waitUntil || 'networkidle');
      if (httpFailure()) return httpFailure();
    }

    const html = await page.content();
    if (parsePage === extractStaticHtml && containsHumanChallenge(html)) {
      return {
        records: [],
        diagnostics: [
          diagnostic(
            'HUMAN_VERIFICATION_REQUIRED',
            'The browser reached a CAPTCHA or slider challenge. Complete it in an authorized application session and resume.'
          )
        ]
      };
    }
    return parsePage({ html, url: page.url(), config });
  } catch (error) {
    return {
      records: [],
      diagnostics: [
        diagnostic('BROWSER_EXECUTION_FAILED', error.message, {
          severity: 'error',
          details: { url: input.url }
        })
      ]
    };
  } finally {
    if (browser && !config.keepBrowserOpen) {
      if (config.cdpEndpoint) {
        await page?.close().catch(() => {});
      }
      // For connectOverCDP, close disconnects this client and preserves the external browser.
      await browser.close().catch(() => {});
    }
  }
}
