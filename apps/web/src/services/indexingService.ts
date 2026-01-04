import { LogEntry } from "../types";
import { fetchWithSmartProxy } from "./proxyFetcher";

// 🔐 REAL BROWSER-BASED CRYPTO IMPLEMENTATION
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function strToBase64Url(str: string): string {
  const encoder = new TextEncoder();
  return arrayBufferToBase64Url(encoder.encode(str));
}

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class IndexingService {
  private onLog: (log: LogEntry) => void;

  constructor(onLog: (log: LogEntry) => void) {
    this.onLog = onLog;
  }

  private log(level: LogEntry['level'], message: string) {
    this.onLog({
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      level,
      message,
      module: 'API'
    });
  }

  async authenticate(serviceAccount: any): Promise<string> {
    try {
      this.log('info', 'Importing Private Key into WebCrypto Subsystem...');
      
      const binaryKey = pemToBinary(serviceAccount.private_key);
      const key = await window.crypto.subtle.importKey(
        "pkcs8",
        binaryKey,
        {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-256" },
        },
        false,
        ["sign"]
      );

      const now = Math.floor(Date.now() / 1000);
      const header = { alg: "RS256", typ: "JWT" };
      const claim = {
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/indexing",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      };

      const encodedHeader = strToBase64Url(JSON.stringify(header));
      const encodedClaim = strToBase64Url(JSON.stringify(claim));
      const data = `${encodedHeader}.${encodedClaim}`;

      const signature = await window.crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(data)
      );
      
      const signedJwt = `${data}.${arrayBufferToBase64Url(signature)}`;
      this.log('success', 'JWT Signed Successfully.');

      this.log('info', 'Exchanging JWT for Google Access Token...');
      const tokenUrl = "https://oauth2.googleapis.com/token";
      const params = new URLSearchParams();
      params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      params.append('assertion', signedJwt);

      const response = await fetchWithSmartProxy(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        throw new Error(`Token Exchange Failed: ${response.text}`);
      }

      const tokenData = JSON.parse(response.text);
      this.log('success', 'OAuth2 Access Token Acquired.');
      return tokenData.access_token;

    } catch (e: any) {
      this.log('error', `Authentication Failed: ${e.message}`);
      throw e;
    }
  }

  // ⚡ GOOGLE: Throttle requests + CIRCUIT BREAKER
  async submitGoogleUrls(accessToken: string, urls: string[], signal?: AbortSignal): Promise<{ submitted: number, errors: number, errorDetails: string[], abort?: boolean }> {
    let submitted = 0;
    let errors = 0;
    const errorDetails: string[] = [];
    const CHUNK_SIZE = 5;
    
    for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
      if (signal?.aborted) throw new DOMException('Job Aborted', 'AbortError');
      
      const chunk = urls.slice(i, i + CHUNK_SIZE);
      
      const promises = chunk.map(async (url) => {
        try {
          const res = await fetchWithSmartProxy(
            "https://indexing.googleapis.com/v3/urlNotifications:publish",
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ url: url, type: "URL_UPDATED" }),
              signal
            }
          );

          if (res.ok) {
            return { success: true };
          } else {
            // CRITICAL ERROR HANDLING
            if (res.status === 403) return { success: false, fatal: true, msg: '403 Forbidden (Verify GSC Owner)' };
            if (res.status === 429) return { success: false, fatal: true, msg: '429 Quota Exceeded (200/Day Limit Reached)' };
            return { success: false, msg: `HTTP ${res.status}` };
          }
        } catch (e: any) {
          if (e.name === 'AbortError') throw e;
          return { success: false, msg: e.message || 'Network Error' };
        }
      });

      const results = await Promise.all(promises);
      let fatalError = false;

      results.forEach(r => {
          if (r.success) {
              submitted++;
          } else {
              errors++;
              if (r.msg && !errorDetails.includes(r.msg)) errorDetails.push(r.msg);
              if (r.fatal) fatalError = true;
          }
      });

      if (fatalError) {
          return { submitted, errors, errorDetails, abort: true };
      }

      if (i + CHUNK_SIZE < urls.length) {
          await new Promise(r => setTimeout(r, 600)); // Increased throttle
      }
    }

    return { submitted, errors, errorDetails };
  }

  // 🚀 INDEXNOW: Adaptive Batch Splitting
  async submitIndexNowBulk(host: string, key: string, urls: string[], signal?: AbortSignal): Promise<{ submitted: number, errors: number }> {
     return this.attemptIndexNowBatch(host, key, urls, signal);
  }

  private async attemptIndexNowBatch(host: string, key: string, urls: string[], signal?: AbortSignal): Promise<{ submitted: number, errors: number }> {
    if (signal?.aborted) throw new DOMException('Job Aborted', 'AbortError');

    const body = {
        host,
        key,
        urlList: urls,
        keyLocation: `https://${host}/${key}.txt`
    };

    try {
        const res = await fetchWithSmartProxy(
            "https://api.indexnow.org/indexnow",
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(body),
                signal
            }
        );

        if (res.ok || res.status === 200 || res.status === 202) {
            this.log('success', `✔ IndexNow accepted batch of ${urls.length} URLs.`);
            return { submitted: urls.length, errors: 0 };
        } 
        
        // IF RATE LIMITED (429) OR UNPROCESSABLE (422), TRY SPLITTING
        if ((res.status === 429 || res.status === 422) && urls.length > 10) {
            this.log('warn', `IndexNow ${res.status} on batch of ${urls.length}. Splitting batch...`);
            
            const mid = Math.floor(urls.length / 2);
            const left = urls.slice(0, mid);
            const right = urls.slice(mid);
            
            await new Promise(r => setTimeout(r, 1000)); // Cool down
            
            const r1 = await this.attemptIndexNowBatch(host, key, left, signal);
            const r2 = await this.attemptIndexNowBatch(host, key, right, signal);
            
            return { submitted: r1.submitted + r2.submitted, errors: r1.errors + r2.errors };
        }

        this.log('error', `IndexNow Failed (${res.status}): ${res.text.substring(0, 100)}`);
        return { submitted: 0, errors: urls.length };

    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        this.log('error', `IndexNow Network Error: ${e.message}`);
        return { submitted: 0, errors: urls.length };
    }
  }
}