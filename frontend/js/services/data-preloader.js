class DataPreloader {
    constructor() {
        this.cacheKey = 'sofascore_cache';
        this.cacheDuration = 5 * 60 * 1000;
    }

    getCachedData() {
        try {
            const cached = localStorage.getItem(this.cacheKey);
            if (!cached) return null;
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < this.cacheDuration) {
                console.log('📦 Using cached data');
                return data;
            }
            return null;
        } catch { return null; }
    }

    setCachedData(data) {
        try {
            localStorage.setItem(this.cacheKey, JSON.stringify({
                data,
                timestamp: Date.now(),
                version: '1.0'
            }));
        } catch {}
    }

    clearCache() {
        localStorage.removeItem(this.cacheKey);
    }
}

export default new DataPreloader();

