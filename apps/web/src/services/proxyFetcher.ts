import { LogEntry } from "../types";

// 🛡️ ENTERPRISE PROXY LAYER v5.2
// Prioritize CodeTabs for POST stability

const PROXY_STRATEGIES = [
  // Strategy A: CodeTabs (Most reliable for POST data/JSON)
  {
    name: 'CodeTabs',
    supportsBody: true,
    fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  },
  // Strategy B: CorsProxy.io (Fast, but sometimes strict on headers)
  { 
    name: 'CorsProxy.io', 
    supportsBody: true,
    fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` 
  },
  // Strategy C: ThingProxy (Fallback)
  {
    name: 'ThingProxy',
    supportsBody: true,
    fn: (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
  },
  // Strategy D: AllOrigins (GET only, last resort)
  { 
    name: 'AllOrigins', 
    supportsBody: false,
    fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` 
  }
];

const TIMEOUT_MS = 30000;

export async function fetchWithSmartProxy(
  targetUrl: string, 
  options: RequestInit = {}, 
  _onLog?: (log: LogEntry) => void
): Promise<{ text: string; status: number; ok: boolean }> {
  let lastError: any;
  const isBodyRequest = options.method === 'POST' || options.method === 'PUT';

  // 1. PROXY ROTATION
  for (const strategy of PROXY_STRATEGIES) {
    if (isBodyRequest && !strategy.supportsBody) continue;
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const proxyUrl = strategy.fn(targetUrl);
      
      const controller = new AbortController();
      if (options.signal) {
         options.signal.addEventListener('abort', () => controller.abort());
      }
      
      // Proxies can be slow, give them time
      const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), TIMEOUT_MS);

      const response = await fetch(proxyUrl, { 
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      // VALIDATION: Many proxies return 200 OK even if they failed internally, 
      // but send back HTML (like "Status: 403 Forbidden" text). 
      // We are expecting JSON or XML mostly.
      const contentType = response.headers.get('content-type');
      const text = await response.text();

      // If we got a 429 or 403 from the PROXY itself (often indicated by specific headers or small HTML bodies)
      // we should skip to the next proxy.
      const isProxyError = response.status === 429 || 
                          (response.status === 403 && !text.includes('google') && !text.includes('IndexNow')) ||
                          (response.status === 500 && text.includes('proxy'));

      if (isProxyError) {
          // console.warn(`Proxy ${strategy.name} failed: ${response.status}`);
          continue; 
      }
      
      return { text, status: response.status, ok: response.ok };

    } catch (e: any) {
      if (e.name === 'AbortError' && options.signal?.aborted) throw e;
      lastError = e;
      // Small delay before next proxy to let network settle
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 2. LAST RESORT: DIRECT ATTEMPT
  // (Only works if the API supports CORS, unlikely for Indexing API but possible for others)
  try {
     if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
     const response = await fetch(targetUrl, options);
     const text = await response.text();
     return { text, status: response.status, ok: response.ok };
  } catch (e) {
     // Ignore direct failure if proxies already failed
  }

  throw lastError || new Error(`Network Error: Unable to reach ${targetUrl} via any proxy.`);
}