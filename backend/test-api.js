/**
 * Direct API test - bypasses httpClient to check raw access
 * Run: node test-api.js
 */

// Test 1: Using Node.js built-in fetch (Node 18+)
async function testWithFetch() {
    console.log('\n📡 TEST 1: Native fetch to Sofascore API\n');
    
    const url = 'https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-05-10';
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.sofascore.com/',
                'Origin': 'https://www.sofascore.com'
            }
        });
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Headers: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`\n✅ SUCCESS! Found ${data.events?.length || 0} events`);
            if (data.events?.length > 0) {
                console.log(`First event: ${data.events[0].homeTeam?.name} vs ${data.events[0].awayTeam?.name}`);
            }
        } else {
            console.log(`\n❌ Failed with status ${response.status}`);
            const text = await response.text();
            console.log(`Response: ${text.substring(0, 500)}`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    }
}

// Test 2: Using https module directly
async function testWithHttps() {
    console.log('\n\n📡 TEST 2: Node.js https module\n');
    
    const https = require('https');
    const url = 'https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-05-10';
    
    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.sofascore.com/',
            }
        }, (res) => {
            console.log(`Status: ${res.statusCode}`);
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const json = JSON.parse(data);
                    console.log(`✅ SUCCESS! Found ${json.events?.length || 0} events`);
                } else {
                    console.log(`❌ Failed: ${data.substring(0, 300)}`);
                }
                resolve();
            });
        }).on('error', (err) => {
            console.error(`❌ Error: ${err.message}`);
            resolve();
        });
    });
}

// Test 3: Alternative URLs
async function testAlternativeUrls() {
    console.log('\n\n📡 TEST 3: Alternative API URLs\n');
    
    const urls = [
        'https://api.sofascore.com/api/v1/sport/football/scheduled-events/2026-05-10',
        'https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-05-10',
        'https://sofascore.com/api/v1/sport/football/scheduled-events/2026-05-10',
    ];
    
    for (const url of urls) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            console.log(`  ${response.status} - ${url.substring(0, 60)}...`);
        } catch (error) {
            console.log(`  ERROR - ${url.substring(0, 60)}...: ${error.message}`);
        }
    }
}

// Run all tests
(async () => {
    console.log('🧪 SOFASCORE API ACCESS TEST');
    console.log('═'.repeat(50));
    
    await testWithFetch();
    await testWithHttps();
    await testAlternativeUrls();
    
    console.log('\n✅ Tests complete\n');
})();