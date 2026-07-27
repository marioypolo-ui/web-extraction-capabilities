const PLACEHOLDER_PATTERN =
  /(?:your[-_ ]?(?:token|key|secret)|replace[-_ ]?me|example|dummy|<[^>]+>|\$\{[^}]+\})/i;
const PATTERNS = [
  { code: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { code: 'GITHUB_TOKEN', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { code: 'GITHUB_TOKEN', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { code: 'OPENAI_API_KEY', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  {
    code: 'ASSIGNED_SECRET',
    pattern:
      /\b(?:APP_SECRET|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|LARK_TOKEN|PASSWORD)\s*[:=]\s*["']?([^\s"'#]{8,})/gi
  }
];

export function scanTextForSecrets(file, text) {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (PLACEHOLDER_PATTERN.test(line)) {
      return;
    }
    for (const rule of PATTERNS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        findings.push({
          code: rule.code,
          file,
          line: index + 1,
          message: 'Credential-shaped content detected; value redacted.'
        });
      }
    }
  });
  return findings;
}
