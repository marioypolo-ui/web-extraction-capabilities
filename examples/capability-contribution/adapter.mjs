export function extractExampleCards(html, baseUrl) {
  return [...String(html).matchAll(/data-record[^>]*>\s*<a href="([^"]+)">([^<]+)<\/a>/g)].map(
    (match) => ({
      title: match[2].trim(),
      url: new URL(match[1], baseUrl).toString()
    })
  );
}
