import { LogEntry } from "../types";

// 🛡️ ENTERPRISE PROXY LAYER v4.1
// robust-rotation | post-support | timeout-handling | abort-support

const PROXY_STRATEGIES = [
  // Strategy A: CorsProxy.io (Fast, usually supports POST)
  { 
    name: 'CorsProxy.io', 
    fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` 
  },
  // Strategy B: CodeTabs (Reliable for POST)
  {
    name: 'CodeTabs',
    fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  },
  // Strategy C: AllOrigins (GET only usually, fallback)
  { 
    name: 'AllOrigins', 
    fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` 
  }
];

const TIMEOUT_MS = 25000;

export async function fetchWithSmartProxy(
  targetUrl: string, 
  options: RequestInit = {}, 
  _onLog?: (log: LogEntry) => void
): Promise<{ text: string; status: number; ok: boolean }> {
  let lastError: any;

  // 1. DIRECT ATTEMPT
  try {
    // If an external signal is provided, use it. Otherwise create a timeout signal.
    const controller = new AbortController();
    const externalSignal = options.signal;
    
    if (externalSignal) {
        if (externalSignal.aborted) throw new DOMException('Aborted', 'AbortError');
        externalSignal.addEventListener('abort', () => controller.abort());
    }

    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const response = await fetch(targetUrl, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status !== 0) {
      const text = await response.text();
      return { text, status: response.status, ok: response.ok };
    }
  } catch (e: any) {
    if (e.name === 'AbortError') throw e; // Propagate aborts immediately
  }

  // 2. PROXY ROTATION
  for (const strategy of PROXY_STRATEGIES) {
    // Check abort before trying next proxy
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const proxyUrl = strategy.fn(targetUrl);
      
      const controller = new AbortController();
      const externalSignal = options.signal;
      
      if (externalSignal) {
         externalSignal.addEventListener('abort', () => controller.abort());
      }
      
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(proxyUrl, { 
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.status === 429) {
          continue; 
      }
      
      const text = await response.text();
      return { text, status: response.status, ok: response.ok };

    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      lastError = e;
    }
  }

  throw new Error(`Connection Failed: ${lastError?.message || 'All proxies exhausted'}`);
}