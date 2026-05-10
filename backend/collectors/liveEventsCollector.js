/**
 * Live Events Collector
 * Fetches currently live matches
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');
const SOFASCORE_CONFIG = require('../config/sofascore');

class LiveEventsCollector {
    constructor() {
        this.collectorName = 'live_events_collector';
    }

    async initialize() {
        if (!db.isConnected) {
            await db.initialize();
        }
    }

    async collect() {
        try {
            await this.initialize();
            console.log('🔴 Collecting live events...');

            const data = await httpClient.get(SOFASCORE_CONFIG.ENDPOINTS.LIVE_EVENTS);

            if (!data || !data.events) {
                console.log('No live events found');
                return { total: 0, updated: 0 };
            }

            console.log(`Found ${data.events.length} live events`);
            let updated = 0;

            for (const event of data.events) {
                try {
                    await db.query(
                        `UPDATE matches 
                        SET status = ?, home_score = ?, away_score = ?, updated_at = NOW()
                        WHERE sofascore_match_id = ?`,
                        [
                            event.status?.code || 'inprogress',
                            event.homeScore?.current ?? null,
                            event.awayScore?.current ?? null,
                            event.id
                        ]
                    );
                    updated++;
                } catch (error) {
                    console.error(`Failed to update event ${event.id}:`, error.message);
                }
            }

            console.log(`✅ Updated ${updated} live matches`);
            return { total: data.events.length, updated };

        } catch (error) {
            console.error('❌ Live events collection failed:', error.message);
            throw error;
        } finally {
            await db.close();
        }
    }
}

if (require.main === module) {
    const collector = new LiveEventsCollector();
    collector.collect()
        .then(r => { console.log('Done:', r); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = new LiveEventsCollector();