/**
 * Odds Collector - Keys in "odds" are Sofascore match/event IDs
 * 
 * Response structure:
 * {
 *   "odds": {
 *     "13980059": {         ← Sofascore EVENT/MATCH ID
 *       "sourceId": 193004735,  ← Bookmaker ID
 *       "marketId": 1,
 *       "marketName": "Full time",
 *       "marketGroup": "1X2",
 *       "choices": [...]
 *     }
 *   }
 * }
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class OddsCollector {
    constructor() {
        this.collectorName = 'odds_collector';
    }

    async initialize() {
        if (!db.isConnected) {
            await db.initialize();
        }
    }

    fractionalToDecimal(fractional) {
        if (!fractional) return null;
        const clean = fractional.trim().toLowerCase();
        if (clean === 'evs' || clean === 'evens') return 2.000;
        const parts = clean.split('/');
        if (parts.length === 2) {
            const num = parseFloat(parts[0]);
            const den = parseFloat(parts[1]);
            if (!isNaN(num) && !isNaN(den) && den !== 0) {
                return parseFloat(((num / den) + 1).toFixed(3));
            }
        }
        return null;
    }

    /**
     * Collect ALL odds for ALL matches on a specific date
     */
    async collectForDate(date) {
        const startTime = Date.now();
        const stats = { 
            inserted: 0, updated: 0, skipped: 0, 
            errors: 0, matchNotFound: 0, matchesFound: 0 
        };

        try {
            await this.initialize();

            console.log(`\n${'═'.repeat(70)}`);
            console.log(`🎲 COLLECTING ODDS FOR: ${date}`);
            console.log(`${'═'.repeat(70)}`);

            const endpoint = `/sport/football/odds/1/${date}`;
            console.log(`🌐 Endpoint: ${endpoint}\n`);

            const response = await httpClient.get(endpoint, true);

            if (!response || !response.odds) {
                console.log('⚠️  No odds data');
                return { success: false, error: 'No odds data' };
            }

            const oddsData = response.odds;
            const eventIds = Object.keys(oddsData);
            
            console.log(`📊 Found ${eventIds.length} events with odds\n`);

            // Pre-load all matches for this date into a lookup map
            const matches = await db.query(
                'SELECT id, sofascore_match_id FROM matches WHERE match_date = ?',
                [date]
            );
            
            const matchMap = {};
            for (const m of matches) {
                matchMap[m.sofascore_match_id] = m.id;
            }
            console.log(`   Pre-loaded ${matches.length} matches from DB for ${date}`);
            if (matches.length > 0) {
                console.log(`   Sample IDs: [${matches.slice(0, 5).map(m => m.sofascore_match_id).join(', ')}...]\n`);
            }

            let processed = 0;

            for (const [sofascoreEventId, marketData] of Object.entries(oddsData)) {
                processed++;

                // Find our DB match ID
                const dbMatchId = matchMap[parseInt(sofascoreEventId)];

                if (!dbMatchId) {
                    stats.matchNotFound++;
                    // Only log first 3 to avoid spam
                    if (stats.matchNotFound <= 3) {
                        console.log(`   ⚠️ Match not in DB: Event ${sofascoreEventId}`);
                    }
                    continue;
                }

                stats.matchesFound++;

                // Process the market data
                if (!marketData.choices || marketData.choices.length === 0) {
                    stats.skipped++;
                    continue;
                }

                // Skip Asian Handicap
                if (marketData.marketGroup === 'Asian Handicap') {
                    stats.skipped++;
                    continue;
                }

                const sourceId = marketData.sourceId || null;
                const isLive = marketData.isLive ? 1 : 0;
                const isSuspended = marketData.suspended ? 1 : 0;

                for (const choice of marketData.choices) {
                    const decimal = this.fractionalToDecimal(choice.fractionalValue);
                    if (!decimal) continue;

                    try {
                        await db.query(
                            `INSERT INTO match_odds (
                                match_id, sofascore_event_id, source_id,
                                market_name, market_group, market_period,
                                selection_name, fractional_odds, decimal_odds,
                                initial_fractional, initial_decimal,
                                odds_change, is_winning, is_suspended, is_live,
                                timestamp_recorded
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                            ON DUPLICATE KEY UPDATE
                                fractional_odds = VALUES(fractional_odds),
                                decimal_odds = VALUES(decimal_odds),
                                odds_change = VALUES(odds_change),
                                is_winning = VALUES(is_winning),
                                updated_at = NOW()`,
                            [
                                dbMatchId,
                                parseInt(sofascoreEventId),
                                sourceId,
                                marketData.marketName || '',
                                marketData.marketGroup || 'Unknown',
                                marketData.marketPeriod || 'Full-time',
                                choice.name,
                                choice.fractionalValue,
                                decimal,
                                choice.initialFractionalValue || null,
                                this.fractionalToDecimal(choice.initialFractionalValue),
                                choice.change || 0,
                                choice.winning ? 1 : 0,
                                isSuspended,
                                isLive
                            ]
                        );
                        stats.inserted++;
                    } catch (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                            stats.updated++;
                        } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
                            // Foreign key error - match doesn't exist
                            stats.matchNotFound++;
                        } else {
                            stats.errors++;
                            if (stats.errors <= 3) {
                                console.error(`   ❌ SQL Error: ${err.message}`);
                            }
                        }
                    }
                }

                // Progress every 200 events
                if (processed % 200 === 0) {
                    console.log(`   Progress: ${processed}/${eventIds.length} (${stats.inserted} inserted, ${stats.matchNotFound} not in DB)`);
                }
            }

            // ⚡ FIXED: Update has_odds without subquery on same table
            if (stats.inserted > 0) {
                const updatedMatches = await db.query(
                    `UPDATE matches m
                    INNER JOIN (
                        SELECT DISTINCT match_id FROM match_odds
                    ) mo ON m.id = mo.match_id
                    SET m.has_odds = 1
                    WHERE m.match_date = ? AND m.has_odds = 0`,
                    [date]
                );
                console.log(`   Matches marked as having odds: ${updatedMatches.affectedRows || 0}`);
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`\n${'═'.repeat(70)}`);
            console.log(`📊 ODDS COLLECTION SUMMARY - ${date}`);
            console.log(`${'═'.repeat(70)}`);
            console.log(`   Events in API:      ${eventIds.length}`);
            console.log(`   Matches in DB:      ${matches.length}`);
            console.log(`   Matches found:      ${stats.matchesFound}`);
            console.log(`   Not in DB:          ${stats.matchNotFound}`);
            console.log(`   Odds rows:          +${stats.inserted} inserted, ${stats.updated} updated`);
            console.log(`   Skipped:            ${stats.skipped}`);
            console.log(`   Errors:             ${stats.errors}`);
            console.log(`   Duration:           ${duration}s`);
            console.log(`${'═'.repeat(70)}\n`);

            // Log to ingestion_logs
            await this.logIngestion(date, stats, duration);

            return { success: true, date, ...stats, duration: `${duration}s` };

        } catch (error) {
            console.error(`\n❌ Failed for ${date}: ${error.message}`);
            await this.logIngestion(date, stats, '0', error.message);
            return { success: false, error: error.message };
        } finally {
            await db.close();
        }
    }

    async logIngestion(date, stats, duration, errorMsg = null) {
        try {
            if (!db.isConnected) await db.initialize();
            await db.query(
                `INSERT INTO ingestion_logs 
                (collector_name, status, records_processed, records_inserted, 
                 records_updated, records_failed, error_message, processing_time_ms,
                 started_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    this.collectorName,
                    errorMsg ? 'FAILED' : 'SUCCESS',
                    stats.matchesFound + stats.matchNotFound,
                    stats.inserted,
                    stats.updated,
                    stats.errors,
                    errorMsg?.substring(0, 500) || null,
                    Math.round(parseFloat(duration) * 1000)
                ]
            );
        } catch (err) {
            // Silently fail logging
        }
    }
}

// CLI
if (require.main === module) {
    const collector = new OddsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            let date;
            if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
                date = args[0];
            } else {
                date = new Date().toISOString().split('T')[0];
                console.log(`📅 No date specified, using today: ${date}\n`);
            }
            await collector.collectForDate(date);
            process.exit(0);
        } catch (error) {
            console.error('Fatal error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = new OddsCollector();