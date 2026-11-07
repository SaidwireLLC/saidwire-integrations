// Reads a podcast feed. Enough XML handling for the fields needed here, with no dependencies.
const unwrap = (s) => s.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

export function parseFeed(xml) {
  const show = unwrap(xml.split('<item')[0].match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? 'Podcast');
  const episodes = [];
  for (const [, item] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const enclosure = item.match(/<enclosure\b[^>]*\burl=["']([^"']+)["']/)?.[1];
    if (!enclosure) continue;
    episodes.push({
      title: unwrap(item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? 'Episode'),
      url: unwrap(enclosure),
      date: unwrap(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ''),
    });
  }
  return { show, episodes };
}

export const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'episode';
