import { LogEntry } from "../types";

// 🛡️ ENTERPRISE PROXY LAYER v5.0
// robust-rotation | post-support | timeout-handling | abort-support

const PROXY_STRATEGIES = [
  // Strategy A: CorsProxy.io (Fast, usually supports POST)
  { 
    name: 'CorsProxy.io', 
    supportsBody: true,
    fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` 
  },
  // Strategy B: CodeTabs (Reliable for POST)
  {
    name: 'CodeTabs',
    supportsBody: true,
    fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  },
  // Strategy C: AllOrigins (GET only usually, fallback)
  { 
    name: 'AllOrigins', 
    supportsBody: false, // AllOrigins often fails with POST bodies
    fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` 
  }
];

const TIMEOUT_MS = 30000; // Increased to 30s

export async function fetchWithSmartProxy(
  targetUrl: string, 
  options: RequestInit = {}, 
  _onLog?: (log: LogEntry) => void
): Promise<{ text: string; status: number; ok: boolean }> {
  let lastError: any;
  const isBodyRequest = options.method === 'POST' || options.method === 'PUT';

  // 1. DIRECT ATTEMPT (Standard Browser Fetch)
  try {
    const controller = new AbortController();
    // Link external signal to this controller
    if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
    }

    // Set timeout
    const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), TIMEOUT_MS);
    
    const response = await fetch(targetUrl, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    // If direct fetch works (status is not 0), return it. 
    if (response.status !== 0) {
      const text = await response.text();
      return { text, status: response.status, ok: response.ok };
    }
  } catch (e: any) {
    // If it was a timeout, throw specific error so App.tsx knows it wasn't the user
    if (e === 'TIMEOUT' || (e.name === 'AbortError' && !options.signal?.aborted)) {
        // Fallthrough to proxies instead of crashing immediately on timeout
    } else if (e.name === 'AbortError') {
        throw e; // Real user abort
    }
  }

  // 2. PROXY ROTATION
  for (const strategy of PROXY_STRATEGIES) {
    // Skip proxies that don't support bodies if we are sending data
    if (isBodyRequest && !strategy.supportsBody) continue;
    
    // Check abort before trying next proxy
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const proxyUrl = strategy.fn(targetUrl);
      
      const controller = new AbortController();
      if (options.signal) {
         options.signal.addEventListener('abort', () => controller.abort());
      }
      
      const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), TIMEOUT_MS);

      const response = await fetch(proxyUrl, { 
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      // If proxy returns 429 (Rate Limit) or 403 (Forbidden by proxy), try next
      if (response.status === 429 || (response.status === 403 && !response.headers.get('x-google-original-status'))) {
          continue; 
      }
      
      const text = await response.text();
      return { text, status: response.status, ok: response.ok };

    } catch (e: any) {
      if (e.name === 'AbortError' && options.signal?.aborted) throw e;
      if (e === 'TIMEOUT' || (e.name === 'AbortError' && !options.signal?.aborted)) {
         lastError = new Error("Network Timeout");
      } else {
         lastError = e;
      }
    }
  }

  throw lastError || new Error(`Network/CORS Error: Could not reach ${targetUrl}.`);
}