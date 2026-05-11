/**
 * Browser-mimicking HTTP Client
 * Sofascore blocks Node.js default headers but allows browser requests
 */
const https = require('https');

class HttpClient {
    constructor() {
        this.lastRequestTime = 0;
        this.minDelay = 2000;
    }

    async get(endpoint, useWebUrl = false) {
        const baseUrl = 'https://api.sofascore.com/api/v1';
        const url = `${baseUrl}${endpoint}`;
        
        // Rate limiting
        const elapsed = Date.now() - this.lastRequestTime;
        if (elapsed < this.minDelay) {
            await new Promise(r => setTimeout(r, this.minDelay - elapsed));
        }
        this.lastRequestTime = Date.now();

        // ⚡ Use native https module with browser-like headers
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            
            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Referer': 'https://www.sofascore.com/',
                    'Origin': 'https://www.sofascore.com',
                    'Connection': 'keep-alive',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-site',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            resolve(json);
                        } catch (e) {
                            resolve(data);
                        }
                    } else if (res.statusCode === 403) {
                        reject(new Error(`Access forbidden (403)`));
                    } else if (res.statusCode === 404) {
                        reject(new Error(`Not found (404)`));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }
}

module.exports = new HttpClient();