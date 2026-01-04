import { LogEntry, SitemapUrl } from "../types";
import { fetchWithSmartProxy } from "./proxyFetcher";

export class SitemapStreamer {
  private onLog: (log: LogEntry) => void;
  private onUrlFound: (count: number) => void;
  private visitedSitemaps = new Set<string>();
  private signal?: AbortSignal;

  constructor(
      onLog: (log: LogEntry) => void, 
      onUrlFound: (count: number) => void,
      signal?: AbortSignal
  ) {
    this.onLog = onLog;
    this.onUrlFound = onUrlFound;
    this.signal = signal;
  }

  private log(level: LogEntry['level'], message: string, module: LogEntry['module'] = 'STREAM') {
    this.onLog({
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      level,
      message,
      module
    });
  }

  async streamParse(url: string): Promise<SitemapUrl[]> {
    this.visitedSitemaps.clear();
    try {
        new URL(url);
    } catch {
        throw new Error(`Invalid URL format: ${url}`);
    }

    const results = await this.fetchSitemapRecursive(url);
    return results;
  }

  private async fetchSitemapRecursive(url: string): Promise<SitemapUrl[]> {
    if (this.signal?.aborted) throw new DOMException('Job Aborted', 'AbortError');
    
    // Deduplication check
    if (this.visitedSitemaps.has(url)) {
        return [];
    }
    this.visitedSitemaps.add(url);

    try {
      // 1. ROBUST FETCH VIA SHARED PROXY
      const { text: xmlText, ok } = await fetchWithSmartProxy(url, {
          headers: { 'Accept': 'application/xml, text/xml, */*' },
          signal: this.signal
      }, this.onLog);

      if (!ok) throw new Error("Failed to fetch sitemap content");
      
      // 2. DOM PARSING
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        if (xmlText.trim().length > 0) {
             this.log('warn', `XML Parse Warning: ${parserError.textContent?.slice(0, 50)}... attempting recovery.`, 'WORKER');
        } else {
             throw new Error("Invalid XML structure");
        }
      }

      // 3. INTELLIGENT DISCOVERY
      const allUrls: SitemapUrl[] = [];
      const sitemapIndex = xmlDoc.querySelector("sitemapindex");
      const urlSet = xmlDoc.querySelector("urlset");
      const rss = xmlDoc.querySelector("rss") || xmlDoc.querySelector("feed");

      if (sitemapIndex) {
        const childNodes = Array.from(xmlDoc.querySelectorAll("sitemap > loc"));
        this.log('info', `Detected Sitemap Index. Found ${childNodes.length} child sitemaps.`, 'WORKER');

        let processed = 0;
        for (const node of childNodes) {
          if (this.signal?.aborted) throw new DOMException('Job Aborted', 'AbortError');
          
          const childUrl = node.textContent?.trim();
          if (childUrl) {
            processed++;
            this.log('info', `Processing child ${processed}/${childNodes.length}: ${childUrl.split('/').pop()}`, 'WORKER');
            const children = await this.fetchSitemapRecursive(childUrl);
            allUrls.push(...children);
          }
        }

      } else if (urlSet) {
        const urlNodes = xmlDoc.querySelectorAll("url");
        const parsedBatch: SitemapUrl[] = [];
        
        urlNodes.forEach((node) => {
          const loc = node.querySelector("loc")?.textContent?.trim();
          const lastmod = node.querySelector("lastmod")?.textContent?.trim();
          
          if (loc) {
            parsedBatch.push({ loc, lastmod });
          }
        });

        if (parsedBatch.length > 0) {
            this.log('success', `Extracted ${parsedBatch.length} URLs from ${url.split('/').pop()}`, 'WORKER');
            this.onUrlFound(parsedBatch.length);
            allUrls.push(...parsedBatch);
        } else {
            this.log('warn', `Sitemap ${url} is valid XML but contained 0 URLs.`, 'WORKER');
        }

      } else if (rss) {
        const items = xmlDoc.querySelectorAll("item > link, entry > link");
        const parsedBatch: SitemapUrl[] = [];
        items.forEach(node => {
             const loc = node.textContent?.trim() || node.getAttribute('href');
             if(loc) parsedBatch.push({ loc });
        });
        if (parsedBatch.length > 0) {
            this.log('info', `Extracted ${parsedBatch.length} links (RSS/Atom Feed detected)`, 'WORKER');
            this.onUrlFound(parsedBatch.length);
            allUrls.push(...parsedBatch);
        }
      }

      return allUrls;

    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      this.log('error', `FETCH FAILURE on ${url}: ${(error as Error).message}`, 'WORKER');
      if (this.visitedSitemaps.size === 1) throw error; 
      return [];
    }
  }
}