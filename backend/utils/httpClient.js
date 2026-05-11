const axios = require('axios');
const CONFIG = require('../config/sofascore');

class HttpClient {
    constructor() {
        this.client = axios.create({
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        this.requestCount = 0;
        this.lastReset = Date.now();
    }

    async get(endpoint, useWebUrl = false) {
        const baseUrl = useWebUrl ? CONFIG.WEB_BASE_URL : CONFIG.BASE_URL;
        const url = `${baseUrl}${endpoint}`;
        
        await this.checkRateLimit();
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await this.client.get(url);
                this.requestCount++;
                return response.data;
            } catch (error) {
                const status = error.response?.status;
                
                // ⚡ 404 = Not found, 403 = Forbidden - NO RETRY
                if (status === 404 || status === 403) {
                    throw new Error(`HTTP ${status} - Not available`);
                }
                
                // ⚡ 429 = Rate limited - wait longer
                if (status === 429) {
                    const waitTime = attempt * 5000;
                    console.log(`   Rate limited (429). Waiting ${waitTime/1000}s...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
                
                // ⚡ Server errors (500+) - retry
                if (status >= 500 && attempt < 3) {
                    console.log(`   Server error (${status}), retrying...`);
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                
                // ⚡ Network errors - retry
                if (!status && attempt < 3) {
                    console.log(`   Network error, retrying...`);
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                
                throw new Error(`Request failed: ${error.message}`);
            }
        }
    }

    async checkRateLimit() {
        const now = Date.now();
        if (now - this.lastReset >= 60000) {
            this.requestCount = 0;
            this.lastReset = now;
        }
        if (this.requestCount >= 60) {
            const waitTime = 60000 - (now - this.lastReset) + 1000;
            console.log(`   Rate limit reached, waiting ${waitTime}ms...`);
            await new Promise(r => setTimeout(r, waitTime));
            this.requestCount = 0;
            this.lastReset = Date.now();
        }
    }
}

module.exports = new HttpClient();