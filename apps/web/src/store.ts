// ═══════════════════════════════════════════════════════════════════════════════
// 🔥 REQUEST MEMOIZATION WITH TTL — PREVENTS DUPLICATE API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

const requestCache = new Map<string, { data: any; expires: number }>();

export function memoizedRequest<T>(
    key: string,
    ttlMs: number,
    requestFn: () => Promise<T>
): Promise<T> {
    const cached = requestCache.get(key);
    
    if (cached && cached.expires > Date.now()) {
        console.log(`[CACHE HIT] ${key.substring(0, 50)}...`);
        return Promise.resolve(cached.data as T);
    }
    
    return requestFn().then(data => {
        requestCache.set(key, { data, expires: Date.now() + ttlMs });
        
        // Auto-cleanup old entries
        if (requestCache.size > 100) {
            const now = Date.now();
            requestCache.forEach((v, k) => {
                if (v.expires < now) requestCache.delete(k);
            });
        }
        
        return data;
    });
}