/**
 * Winning Odds Collector - Expected vs Actual Win Probabilities
 * 
 * Endpoint: GET /api/v1/event/{eventId}/provider/1/winning-odds
 * 
 * API Response:
 * {
 *   "home": {
 *     "fractionalValue": "2/1",
 *     "expected": 33,      // Percentage (33%)
 *     "actual": 38,        // Percentage (38%)
 *     "id": 21909457
 *   },
 *   "away": {
 *     "fractionalValue": "27/20",
 *     "expected": 43,
 *     "actual": 29,
 *     "id": 21909458
 *   }
 * }
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class WinningOddsCollector {
    constructor() {
        this.collectorName = 'winning_odds_collector';
        this.debug = false;
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    async collectForMatch(matchId) {
        try {
            await this.initialize();
            const matches = await db.query(
                'SELECT id, sofascore_match_id FROM matches WHERE id = ?',
                [matchId]
            );
            if (matches.length === 0) {
                return { success: false, error: 'Match not found' };
            }

            const match = matches[0];
            const endpoint = `/event/${match.sofascore_match_id}/provider/1/winning-odds`;
            
            console.log(`   API: https://api.sofascore.com/api/v1${endpoint}`);
            
            let response;
            try {
                response = await httpClient.get(endpoint);
            } catch (httpError) {
                console.log(`   HTTP Error: ${httpError.message}`);
                if (httpError.message.includes('404') || httpError.message.includes('403')) {
                    return { success: false, error: 'Not available', skipped: true };
                }
                throw httpError;
            }

            // Debug raw response
            console.log(`   Response keys: ${response ? Object.keys(response).join(', ') : 'null'}`);
            
            if (!response || (!response.home && !response.away)) {
                console.log(`   No home/away data in response`);
                return { success: false, error: 'No data', skipped: true };
            }

        const home = response.home || {};
        const away = response.away || {};
        const homeDecimal = this.fractionalToDecimal(home.fractionalValue);
        const awayDecimal = this.fractionalToDecimal(away.fractionalValue);
        const homeExpected = home.expected || 0;
        const homeActual = home.actual || 0;
        const awayExpected = away.expected || 0;
        const awayActual = away.actual || 0;
        const homeEdge = homeActual - homeExpected;
        const awayEdge = awayActual - awayExpected;

        const getEdgeType = (edge) => {
            if (edge > 2) return 'positive';
            if (edge < -2) return 'negative';
            return 'neutral';
        };

        const totalExpected = homeExpected + awayExpected;
        const marketGap = Math.max(0, 100 - totalExpected);

        await db.query(
            `INSERT INTO winning_odds (
                match_id, provider_id,
                home_expected_probability, home_actual_probability,
                home_expected_decimal, home_actual_decimal,
                home_expected_fractional,
                home_edge_percentage, home_edge_type, home_is_value,
                away_expected_probability, away_actual_probability,
                away_expected_decimal, away_actual_decimal,
                away_expected_fractional,
                away_edge_percentage, away_edge_type, away_is_value,
                total_expected_probability, market_efficiency_gap,
                timestamp_recorded
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                home_edge_percentage = VALUES(home_edge_percentage),
                home_edge_type = VALUES(home_edge_type),
                home_is_value = VALUES(home_is_value),
                away_edge_percentage = VALUES(away_edge_percentage),
                away_edge_type = VALUES(away_edge_type),
                away_is_value = VALUES(away_is_value),
                updated_at = NOW()`,
            [
                matchId,
                (homeExpected / 100).toFixed(4),
                (homeActual / 100).toFixed(4),
                homeDecimal, null,
                home.fractionalValue || null,
                homeEdge, getEdgeType(homeEdge), homeEdge > 2 ? 1 : 0,
                (awayExpected / 100).toFixed(4),
                (awayActual / 100).toFixed(4),
                awayDecimal, null,
                away.fractionalValue || null,
                awayEdge, getEdgeType(awayEdge), awayEdge > 2 ? 1 : 0,
                (totalExpected / 100).toFixed(4),
                (marketGap / 100).toFixed(4)
            ]
        );

        return { 
            success: true, matchId,
            homeEdge, awayEdge,
            homeValue: homeEdge > 2,
            awayValue: awayEdge > 2
        };

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return { success: true, matchId, note: 'Already exists' };
        }
        // ⚡ Skip 404/403 at any level
        if (error.message.includes('404') || error.message.includes('403')) {
            return { success: false, error: 'Not available', skipped: true };
        }
        return { success: false, matchId, error: error.message };
    }
}

    // ⚡ NEW: Batch for date range
    async collectDateRange(startDate, endDate, limit) {
    await this.initialize();
    const max = (limit === 'all' || limit === '0' || !limit) ? 999999 : parseInt(limit);
    
    const matches = await db.query(
        `SELECT m.id, m.sofascore_match_id, ht.name AS home_name, at.name AS away_name, m.match_date
        FROM matches m
        JOIN teams ht ON m.home_team_id = ht.id
        JOIN teams at ON m.away_team_id = at.id
        WHERE m.match_date BETWEEN ? AND ?
        AND m.id NOT IN (SELECT match_id FROM winning_odds)
        ORDER BY m.match_date, m.match_datetime ASC
        LIMIT ${max}`,
        [startDate, endDate]
    );

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 WINNING ODDS: ${startDate} → ${endDate}`);
    console.log(`   Matches: ${matches.length}`);
    console.log(`${'═'.repeat(60)}\n`);

    let success = 0, failed = 0, skipped = 0, valueBets = 0;
    
    // ⚡ BATCH PROCESSING: 10 matches per batch, 5 second pause between batches
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 5000; // 5 seconds between batches
    const MATCH_DELAY = 1500;  // 1.5 seconds between individual matches

    for (let batchStart = 0; batchStart < matches.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, matches.length);
        const batch = matches.slice(batchStart, batchEnd);
        
        console.log(`\n   ── Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(matches.length / BATCH_SIZE)} (${batch.length} matches) ──\n`);
        
        for (let i = 0; i < batch.length; i++) {
            const m = batch[i];
            const globalIndex = batchStart + i + 1;
            
            console.log(`   [${globalIndex}/${matches.length}] ${m.match_date} | ${m.home_name} vs ${m.away_name}`);
            
            const result = await this.collectForMatch(m.id);
            
            if (result.success) {
                success++;
                if (result.homeValue || result.awayValue) {
                    valueBets++;
                    console.log(`      💎 VALUE BET | H:${result.homeEdge > 0 ? '+' : ''}${result.homeEdge}% | A:${result.awayEdge > 0 ? '+' : ''}${result.awayEdge}%`);
                } else if (result.homeEdge !== undefined) {
                    console.log(`      H:${result.homeEdge > 0 ? '+' : ''}${result.homeEdge}% | A:${result.awayEdge > 0 ? '+' : ''}${result.awayEdge}%`);
                }
            } else if (result.skipped) {
                skipped++;
                console.log(`      ⏭️ Not available`);
            } else {
                failed++;
                console.log(`      ⚠️ ${result.error}`);
            }
            
            // ⚡ Delay between individual matches
            await this.delay(MATCH_DELAY);
        }
        
        // ⚡ Pause between batches (except after the last batch)
        if (batchEnd < matches.length) {
            console.log(`\n   ⏸️  Batch complete. Pausing ${BATCH_DELAY / 1000}s to avoid rate limiting...`);
            await this.delay(BATCH_DELAY);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 WINNING ODDS SUMMARY`);
    console.log(`   Total:    ${matches.length}`);
    console.log(`   Success:  ${success}`);
    console.log(`   Skipped:  ${skipped} (not available)`);
    console.log(`   Failed:   ${failed}`);
    console.log(`   💎 Value: ${valueBets}`);
    console.log(`${'═'.repeat(60)}\n`);

    await db.close();
    return { startDate, endDate, total: matches.length, success, failed, skipped, valueBets };
}

    // ⚡ NEW: Today only
    async collectToday(limit) {
        const today = new Date().toISOString().split('T')[0];
        return this.collectDateRange(today, today, limit || 30);
    }

    // ⚡ NEW: Upcoming matches
    async collectUpcoming(days, limit) {
        await this.initialize();
        const d = parseInt(days) || 7;
        const max = parseInt(limit) || 30;

        const matches = await db.query(
            `SELECT m.id, m.sofascore_match_id, ht.name AS home_name, at.name AS away_name, m.match_date
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_datetime > NOW()
            AND m.match_datetime < DATE_ADD(NOW(), INTERVAL ${d} DAY)
            AND m.id NOT IN (SELECT match_id FROM winning_odds WHERE timestamp_recorded > DATE_SUB(NOW(), INTERVAL 6 HOUR))
            ORDER BY m.match_datetime ASC
            LIMIT ${max}`
        );

        console.log(`\n📊 WINNING ODDS: Next ${d} days - ${matches.length} matches\n`);

        let success = 0, failed = 0, valueBets = 0;

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            console.log(`   [${i+1}/${matches.length}] ${m.match_date} | ${m.home_name} vs ${m.away_name}`);
            
            // In collectDateRange, collectToday, collectUpcoming - update the logging:
            const result = await this.collectForMatch(m.id);
            if (result.success) {
                success++;
                if (result.homeValue || result.awayValue) valueBets++;
                if (result.homeEdge !== undefined) {
                    console.log(`      H:${result.homeEdge > 0 ? '+' : ''}${result.homeEdge}% | A:${result.awayEdge > 0 ? '+' : ''}${result.awayEdge}%`);
                }
            } else if (result.skipped) {
                // ⚡ Silently skip unavailable matches
                console.log(`      ⏭️ Skipped (not available)`);
            } else {
                failed++;
                console.log(`      ⚠️ ${result.error}`);
            }
            await this.delay(1500);
        }

        console.log(`\n✅ ${success} ok, ${failed} failed, ${valueBets} value bets`);
        await db.close();
        return { success, failed, valueBets };
    }
}

// CLI
// CLI Entry Point
if (require.main === module) {
    const collector = new WinningOddsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            // ⚡ Check --range first (both with and without limit)
            if (args.includes('--range')) {
                const rangeIndex = args.indexOf('--range');
                const startDate = args[rangeIndex + 1];
                const endDate = args[rangeIndex + 2];
                const limit = args[rangeIndex + 3] || 50;
                
                if (!startDate || !endDate) {
                    console.log('Usage: --range YYYY-MM-DD YYYY-MM-DD [limit]');
                    process.exit(1);
                }
                
                console.log(`\n📅 Date range: ${startDate} → ${endDate} (limit: ${limit})\n`);
                await collector.collectDateRange(startDate, endDate, limit);
                
            } else if (args.includes('--window')) {
                const windowIndex = args.indexOf('--window');
                const forwardDays = parseInt(args[windowIndex + 1]) || 2;
                const backwardDays = parseInt(args[windowIndex + 2]) || 5;
                const limit = args[windowIndex + 3] || 50;
                
                const today = new Date();
                const startDate = new Date(today);
                startDate.setDate(today.getDate() - backwardDays);
                const endDate = new Date(today);
                endDate.setDate(today.getDate() + forwardDays);
                
                console.log(`\n🪟 Window: ${backwardDays}d back + ${forwardDays}d forward (limit: ${limit})`);
                console.log(`   ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}\n`);
                
                await collector.collectDateRange(
                    startDate.toISOString().split('T')[0],
                    endDate.toISOString().split('T')[0],
                    limit
                );
                
            } else if (args.includes('--days')) {
                const daysIndex = args.indexOf('--days');
                const days = parseInt(args[daysIndex + 1]) || 7;
                const limit = args[daysIndex + 2] || 50;
                
                const today = new Date();
                const endDate = new Date();
                endDate.setDate(today.getDate() + days);
                
                console.log(`\n📅 Next ${days} days (limit: ${limit})\n`);
                await collector.collectDateRange(
                    today.toISOString().split('T')[0],
                    endDate.toISOString().split('T')[0],
                    limit
                );
                
            } else if (args.includes('--today')) {
                const todayIndex = args.indexOf('--today');
                const limit = args[todayIndex + 1] || 50;
                await collector.collectToday(limit);
                
            } else if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
                const date = args[0];
                const limit = args[1] || 50;
                await collector.collectDateRange(date, date, limit);
                
            } else if (args[0] && !isNaN(args[0])) {
                await collector.initialize();
                const result = await collector.collectForMatch(parseInt(args[0]));
                console.log('Result:', JSON.stringify(result, null, 2));
                await db.close();
                
            } else {
                // Default: 5 days back + 2 days forward, 30 limit
                const today = new Date();
                const startDate = new Date(today);
                startDate.setDate(today.getDate() - 5);
                const endDate = new Date(today);
                endDate.setDate(today.getDate() + 2);
                
                console.log(`\n📅 Default: 5d back + 2d forward (limit: 30)\n`);
                await collector.collectDateRange(
                    startDate.toISOString().split('T')[0],
                    endDate.toISOString().split('T')[0],
                    30
                );
            }
            
            process.exit(0);
        } catch (error) {
            console.error('\n❌ Fatal error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = new WinningOddsCollector();