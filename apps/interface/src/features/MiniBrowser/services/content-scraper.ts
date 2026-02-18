export type ScrapedLink = { text: string; href: string };
export type ScrapedHeading = { level: number; text: string };
export type ScrapedData = {
  title: string;
  url: string;
  headings: ScrapedHeading[];
  links: ScrapedLink[];
  textContent: string;
};

export class ContentScraper {
  constructor(private readonly baseUrl: string = 'https://example.com') {}

  async scrapeFromUrl(targetUrl: string): Promise<ScrapedData> {
    const absoluteUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
    const response = await fetch(absoluteUrl, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    const html = await response.text();
    return this.scrapeFromHtml(html, absoluteUrl);
  }

  async scrapeFromHtml(html: string, url: string): Promise<ScrapedData> {
    const title = this.extractTitle(html) || url;
    const headings = this.extractHeadings(html);
    const links = this.extractLinks(html, url);
    const textContent = this.extractText(html);
    return { title, url, headings, links, textContent };
  }

  private extractTitle(html: string): string | null {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? this.decodeHtml(m[1].trim()) : null;
  }

  private extractHeadings(html: string): ScrapedHeading[] {
    const out: ScrapedHeading[] = [];
    for (let i = 1; i <= 6; i++) {
      const regex = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = regex.exec(html))) {
        out.push({ level: i, text: this.cleanText(m[1]) });
      }
    }
    return out;
  }

  private extractLinks(html: string, base: string): ScrapedLink[] {
    const out: ScrapedLink[] = [];
    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html))) {
      const href = m[1].trim();
      const text = this.cleanText(m[2]);
      try {
        const abs = new URL(href, base).href;
        out.push({ text, href: abs });
      } catch {}
      if (out.length >= 500) break;
    }
    return out;
  }

  private extractText(html: string): string {
    const blocks: string[] = [];
    const paraRegex = /<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = paraRegex.exec(html))) {
      const text = this.cleanText(m[2]);
      if (text) blocks.push(text);
      if (blocks.length >= 200) break;
    }
    return blocks.join('\n');
  }

  private cleanText(input: string): string {
    return this.decodeHtml(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  private decodeHtml(html: string): string {
    const entities: Record<string, string> = {
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    };
    return html.replace(/&[a-zA-Z#0-9]+;/g, (m) => entities[m] || m);
  }
}


