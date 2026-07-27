export function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  const routeHash = /^#!?\//.test(url.hash) ? url.hash : '';
  url.hash = routeHash;
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  const params = [...url.searchParams.entries()]
    .filter(
      ([key]) => !/^utm_/i.test(key) && !['spm', 'from'].includes(key.toLowerCase())
    )
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`)
    );
  url.search = '';
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}
