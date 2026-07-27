import { diagnostic } from './result.mjs';

const CHALLENGE_PATTERN =
  /(?:captcha|验证码|滑块|拖动.{0,8}(?:验证|滑块)|访问过于频繁|安全验证|人机验证)/i;
const LOGIN_PATTERN = /(?:登录|sign[\s-]?in|log[\s-]?in|账号|用户名|password|密码)/i;
const SPA_PATTERN =
  /(?:<div[^>]+id=["'](?:app|root)["'][^>]*>\s*(?:loading[^<]*)?<\/div>|webpack|__NEXT_DATA__|vite)/i;
const ACTION_LINK_PATTERN = /(?:href=["']javascript:|onclick\s*=|data-id\s*=)/i;

export function containsHumanChallenge(html = '') {
  return CHALLENGE_PATTERN.test(String(html));
}

export async function detectCapabilities({ url = '', html = '' } = {}) {
  const source = String(html || '');
  const recommendations = [];
  const diagnostics = [];

  if (containsHumanChallenge(source)) {
    recommendations.push({ capabilityId: 'human-verification', confidence: 1 });
    diagnostics.push(
      diagnostic(
        'HUMAN_VERIFICATION_REQUIRED',
        'The page contains a CAPTCHA or slider challenge and requires an authorized human handoff.'
      )
    );
    return { url, recommendations, diagnostics };
  }

  if (LOGIN_PATTERN.test(source)) {
    recommendations.push({ capabilityId: 'authenticated-session', confidence: 0.9 });
    diagnostics.push(
      diagnostic('AUTH_SESSION_REQUIRED', 'The page appears to require an application-owned login session.')
    );
  }

  const hasUsableLinks = /<a\b[^>]+href=["'](?!javascript:|#)[^"']+["']/i.test(source);
  const hasListItems = /<(?:li|article)\b/i.test(source);
  if (hasUsableLinks && hasListItems) {
    recommendations.push({ capabilityId: 'static-html-list', confidence: 0.85 });
  }

  if (SPA_PATTERN.test(source) && !hasListItems) {
    recommendations.push({ capabilityId: 'spa-api', confidence: 0.8 });
    recommendations.push({ capabilityId: 'complex-js-browser', confidence: 0.65 });
    diagnostics.push(
      diagnostic(
        'DYNAMIC_RENDERING_REQUIRED',
        'The HTML is an application shell; use a documented API or a browser capability.'
      )
    );
  }

  if (ACTION_LINK_PATTERN.test(source)) {
    recommendations.push({ capabilityId: 'action-link-resolution', confidence: 0.7 });
  }

  if (recommendations.length === 0) {
    diagnostics.push(
      diagnostic('UNSUPPORTED_STRUCTURE', 'No known extraction structure was detected.', {
        severity: 'error'
      })
    );
  }

  recommendations.sort((left, right) => right.confidence - left.confidence);
  return { url, recommendations, diagnostics };
}
