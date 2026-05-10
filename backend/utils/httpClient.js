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
                if (attempt === 3) {
                    throw new Error(`Request failed: ${error.message}`);
                }
                console.log(`Attempt ${attempt} failed, retrying in ${attempt * 2}s...`);
                await new Promise(r => setTimeout(r, attempt * 2000));
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
            console.log(`Rate limit reached, waiting ${waitTime}ms...`);
            await new Promise(r => setTimeout(r, waitTime));
            this.requestCount = 0;
            this.lastReset = Date.now();
        }
    }
}

module.exports = new HttpClient();