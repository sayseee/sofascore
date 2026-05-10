/**
 * Simple in-memory cache for API responses
 */
const NodeCache = require('node-cache');

class CacheManager {
    constructor() {
        this.cache = new NodeCache({
            stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 300,
            checkperiod: 120,
            useClones: false
        });
        this.stats = { hits: 0, misses: 0 };
    }

    async getOrSet(key, fetchFn, ttl = null) {
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            this.stats.hits++;
            return cached;
        }

        this.stats.misses++;
        const data = await fetchFn();
        this.cache.set(key, data, ttl || undefined);
        return data;
    }

    get(key) { return this.cache.get(key); }
    set(key, value, ttl) { return this.cache.set(key, value, ttl || undefined); }
    del(key) { return this.cache.del(key); }
    flush() { this.cache.flushAll(); }
}

module.exports = new CacheManager();

