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
    }

    async initialize() {
        if (!db.isConnected) {
            await db.initialize();
        }
    }

    /**
     * Convert fractional odds to decimal
     * "2/1"   → 3.000
     * "27/20" → 2.350
     */
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
     * Collect winning odds for a single match (by DB match ID)
     */
    async collectForMatch(matchId) {
        try {
            await this.initialize();

            // Get the Sofascore event ID
            const matches = await db.query(
                'SELECT id, sofascore_match_id, home_team_id, away_team_id FROM matches WHERE id = ?',
                [matchId]
            );

            if (matches.length === 0) {
                console.log(`❌ Match ID ${matchId} not found in database`);
                console.log('   Run scheduledEventsCollector first to populate matches');
                return { success: false, error: 'Match not found' };
            }

            const match = matches[0];
            const endpoint = `/event/${match.sofascore_match_id}/provider/1/winning-odds`;
            
            let response;
            try {
                response = await httpClient.get(endpoint);
            } catch (httpError) {
                // ⚡ Skip 404/403 silently
                if (httpError.message.includes('404') || httpError.message.includes('403')) {
                    return { success: false, error: 'Not available', skipped: true };
                }
                throw httpError;
            }

            if (!response || (!response.home && !response.away)) {
                return { success: false, error: 'No data', skipped: true };
            }

            // Extract data
            const home = response.home || {};
            const away = response.away || {};

            // Convert fractional to decimal
            const homeDecimal = this.fractionalToDecimal(home.fractionalValue);
            const awayDecimal = this.fractionalToDecimal(away.fractionalValue);

            // Values are percentages (33 = 33%)
            const homeExpected = home.expected || 0;
            const homeActual   = home.actual   || 0;
            const awayExpected = away.expected || 0;
            const awayActual   = away.actual   || 0;

            // Edge = actual - expected (percentage points)
            const homeEdge = homeActual - homeExpected;
            const awayEdge = awayActual - awayExpected;

            // Edge type
            const getEdgeType = (edge) => {
                if (edge > 2)  return 'positive';  // team outperforms
                if (edge < -2) return 'negative';  // team underperforms
                return 'neutral';
            };

            // Display
            console.log(`\n   🏠 HOME:`);
            console.log(`      Fractional: ${home.fractionalValue}`);
            console.log(`      Decimal:    ${homeDecimal}`);
            console.log(`      Expected:   ${homeExpected}%`);
            console.log(`      Actual:     ${homeActual}%`);
            console.log(`      Edge:       ${homeEdge > 0 ? '+' : ''}${homeEdge}% (${getEdgeType(homeEdge)})`);
            console.log(`      Value Bet:  ${homeEdge > 2 ? 'YES ✅' : 'No'}`);

            console.log(`\n   🛫 AWAY:`);
            console.log(`      Fractional: ${away.fractionalValue}`);
            console.log(`      Decimal:    ${awayDecimal}`);
            console.log(`      Expected:   ${awayExpected}%`);
            console.log(`      Actual:     ${awayActual}%`);
            console.log(`      Edge:       ${awayEdge > 0 ? '+' : ''}${awayEdge}% (${getEdgeType(awayEdge)})`);
            console.log(`      Value Bet:  ${awayEdge > 2 ? 'YES ✅' : 'No'}`);

            // Total expected and market efficiency gap
            const totalExpected = homeExpected + awayExpected;
            const marketGap     = Math.max(0, 100 - totalExpected);
            console.log(`\n   📈 Market: Total Expected ${totalExpected}% | Draw Implied ${marketGap}%`);

            // Insert into database 
            const sql = `
                INSERT INTO winning_odds (
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
                ) VALUES (
                    ?, 1,
                    ?, ?,
                    ?, ?,
                    ?,
                    ?, ?, ?,
                    ?, ?,
                    ?, ?,
                    ?,
                    ?, ?, ?,
                    ?, ?,
                    NOW()
                )
                ON DUPLICATE KEY UPDATE
                    home_expected_probability = VALUES(home_expected_probability),
                    home_actual_probability   = VALUES(home_actual_probability),
                    home_expected_decimal     = VALUES(home_expected_decimal),
                    home_actual_decimal       = VALUES(home_actual_decimal),
                    home_expected_fractional  = VALUES(home_expected_fractional),
                    home_edge_percentage      = VALUES(home_edge_percentage),
                    home_edge_type            = VALUES(home_edge_type),
                    home_is_value             = VALUES(home_is_value),
                    away_expected_probability = VALUES(away_expected_probability),
                    away_actual_probability   = VALUES(away_actual_probability),
                    away_expected_decimal     = VALUES(away_expected_decimal),
                    away_actual_decimal       = VALUES(away_actual_decimal),
                    away_expected_fractional  = VALUES(away_expected_fractional),
                    away_edge_percentage      = VALUES(away_edge_percentage),
                    away_edge_type            = VALUES(away_edge_type),
                    away_is_value             = VALUES(away_is_value),
                    total_expected_probability = VALUES(total_expected_probability),
                    market_efficiency_gap     = VALUES(market_efficiency_gap),
                    timestamp_recorded        = NOW()
            `;

            // Count the ? placeholders: Let me count them...
            // VALUES clause has: ?(matchId), ?(homeExpected), ?(homeActual), ?(homeDecimal), ?(homeActualDecimal),
            //                    ?(homeFractional), ?(homeEdge), ?(homeEdgeType), ?(homeIsValue),
            //                    ?(awayExpected), ?(awayActual), ?(awayDecimal), ?(awayActualDecimal),
            //                    ?(awayFractional), ?(awayEdge), ?(awayEdgeType), ?(awayIsValue),
            //                    ?(totalExpected), ?(marketGap)
            // That's 18 parameters

            const params = [
                matchId,                                           // 1

                // HOME
                parseFloat((homeExpected / 100).toFixed(4)),       // 2
                parseFloat((homeActual   / 100).toFixed(4)),       // 3
                homeDecimal || null,                               // 4
                null,                                              // 5 (home_actual_decimal)
                home.fractionalValue || null,                      // 6
                parseFloat(homeEdge.toFixed(2)),                   // 7
                getEdgeType(homeEdge),                             // 8
                homeEdge > 2 ? 1 : 0,                             // 9

                // AWAY
                parseFloat((awayExpected / 100).toFixed(4)),       // 10
                parseFloat((awayActual   / 100).toFixed(4)),       // 11
                awayDecimal || null,                               // 12
                null,                                              // 13 (away_actual_decimal)
                away.fractionalValue || null,                      // 14
                parseFloat(awayEdge.toFixed(2)),                   // 15
                getEdgeType(awayEdge),                             // 16
                awayEdge > 2 ? 1 : 0,                             // 17

                // MARKET
                parseFloat((totalExpected / 100).toFixed(4)),      // 18
                parseFloat((marketGap     / 100).toFixed(4))       // 19
            ];

            console.log(`   SQL params count: ${params.length}`); // Debug line - should be 19

console.log('Parameter count:', params.length);
console.log('Parameters:', params);
            await db.query(sql, params);

            console.log(`   ✅ Saved to database`);
            return {
                success: true,
                matchId,
                homeEdge,
                awayEdge,
                homeValue: homeEdge > 2,
                awayValue: awayEdge > 2
            };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            if (error.code === 'ER_DUP_ENTRY') {
                console.log('   (Duplicate entry - already exists)');
                return { success: true, matchId, note: 'Already exists' };
            }
            return { success: false, matchId, error: error.message };
        }
    }

    /**
     * Collect for multiple upcoming matches
     */
    async collectForUpcoming(limit = 10) {
        await this.initialize();

        const safeLimit = parseInt(limit, 10) || 10;

        const matches = await db.query(
            `SELECT m.id, m.sofascore_match_id,
                    ht.name as home_team, at.name as away_team,
                    m.match_datetime
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_datetime > NOW()
            AND m.match_datetime < DATE_ADD(NOW(), INTERVAL 7 DAY)
            AND m.id NOT IN (
                SELECT match_id FROM winning_odds
                WHERE timestamp_recorded > DATE_SUB(NOW(), INTERVAL 6 HOUR)
            )
            ORDER BY m.match_datetime ASC
            LIMIT ?`,
            [safeLimit]
        );

        if (matches.length === 0) {
            console.log('✅ All upcoming matches already have recent winning odds');
            await db.close();
            return [];
        }

        console.log(`\n📊 Collecting winning odds for ${matches.length} matches:\n`);

        const results = [];
        for (const match of matches) {
            console.log(`${'─'.repeat(60)}`);
            console.log(`⚽ ${match.home_team} vs ${match.away_team} (${new Date(match.match_datetime).toLocaleDateString()})`);

            const result = await this.collectForMatch(match.id);
            results.push({
                matchId: match.id,
                teams: `${match.home_team} vs ${match.away_team}`,
                ...result
            });

            await new Promise(r => setTimeout(r, 1500));
        }

        const successful  = results.filter(r => r.success);
        const valueBets   = successful.filter(r => r.homeValue || r.awayValue);

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📊 WINNING ODDS SUMMARY`);
        console.log(`   Total:        ${results.length}`);
        console.log(`   Successful:   ${successful.length}`);
        console.log(`   Failed:       ${results.length - successful.length}`);
        console.log(`   Value Bets:   ${valueBets.length}`);
        console.log(`${'═'.repeat(60)}\n`);

        await db.close();
        return results;
    }

    /**
     * Collect winning odds for matches in a date range
     */
    async collectDateRange(startDate, endDate, limit = 50) {
    await this.initialize();

    // Force limit to be a proper integer
    
    const safeLimit = Math.floor(Number(limit)) || 50;

    // Add check for existing recent data (like collectForUpcoming does)
    const matches = await db.query(
        `SELECT m.id, m.sofascore_match_id,
                ht.name as home_team,
                at.name as away_team,
                m.match_datetime
         FROM matches m
         JOIN teams ht ON m.home_team_id = ht.id
         JOIN teams at ON m.away_team_id = at.id
         WHERE m.match_datetime >= ?
           AND m.match_datetime < DATE_ADD(?, INTERVAL 1 DAY)
           AND m.id NOT IN (
               SELECT match_id FROM winning_odds
               WHERE timestamp_recorded > DATE_SUB(NOW(), INTERVAL 6 HOUR)
           )
         ORDER BY m.match_datetime ASC
         LIMIT ${safeLimit}`,
        [startDate, endDate]
    );

    if (matches.length === 0) {
        console.log(`❌ No matches found between ${startDate} and ${endDate}`);
        await db.close();
        return [];
    }

    console.log(`📊 Found ${matches.length} matches\n`);

    const results = [];

    for (const match of matches) {
        console.log(`${'─'.repeat(60)}`);
        console.log(`⚽ ${match.home_team} vs ${match.away_team}`);

        const result = await this.collectForMatch(match.id);

        results.push({
            matchId: match.id,
            teams: `${match.home_team} vs ${match.away_team}`,
            ...result
        });

        await new Promise(r => setTimeout(r, 1200));
    }

    await db.close();
    return results;
}

    /**
     * Collect today's matches
     */
    async collectToday(limit = 50) {
        const today = new Date().toISOString().split('T')[0];
        return await this.collectDateRange(today, today, limit);
    }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────
if (require.main === module) {
    const collector = new WinningOddsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--range')) {
                const idx       = args.indexOf('--range');
                const startDate = args[idx + 1];
                const endDate   = args[idx + 2];
                const limit     = parseInt(args[idx + 3], 10) || 50;

                if (!startDate || !endDate) {
                    console.log('Usage: --range YYYY-MM-DD YYYY-MM-DD [limit]');
                    process.exit(1);
                }

                console.log(`\n📅 Date range: ${startDate} → ${endDate} (limit: ${limit})\n`);
                await collector.collectDateRange(startDate, endDate, limit);

            } else if (args.includes('--window')) {
                const idx          = args.indexOf('--window');
                const forwardDays  = parseInt(args[idx + 1], 10) || 2;
                const backwardDays = parseInt(args[idx + 2], 10) || 5;
                const limit        = parseInt(args[idx + 3], 10) || 50;

                const today     = new Date();
                const startDate = new Date(today);
                startDate.setDate(today.getDate() - backwardDays);
                const endDate   = new Date(today);
                endDate.setDate(today.getDate() + forwardDays);

                console.log(`\n🪟 Window: ${backwardDays}d back + ${forwardDays}d forward (limit: ${limit})`);
                console.log(`   ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}\n`);

                await collector.collectDateRange(
                    startDate.toISOString().split('T')[0],
                    endDate.toISOString().split('T')[0],
                    limit
                );

            } else if (args.includes('--days')) {
                const idx   = args.indexOf('--days');
                const days  = parseInt(args[idx + 1], 10) || 7;
                const limit = parseInt(args[idx + 2], 10) || 50;

                const today   = new Date();
                const endDate = new Date();
                endDate.setDate(today.getDate() + days);

                console.log(`\n📅 Next ${days} days (limit: ${limit})\n`);
                await collector.collectDateRange(
                    today.toISOString().split('T')[0],
                    endDate.toISOString().split('T')[0],
                    limit
                );

            } else if (args.includes('--today')) {
                const idx   = args.indexOf('--today');
                const limit = parseInt(args[idx + 1], 10) || 50;
                await collector.collectToday(limit);

            } else if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
                const date  = args[0];
                const limit = parseInt(args[1], 10) || 50;
                await collector.collectDateRange(date, date, limit);

            } else if (args[0] && !isNaN(args[0])) {
                await collector.initialize();
                const result = await collector.collectForMatch(parseInt(args[0], 10));
                console.log('Result:', JSON.stringify(result, null, 2));
                await db.close();

            } else {
                // Default: 5 days back + 2 days forward, limit 30
                const today     = new Date();
                const startDate = new Date(today);
                startDate.setDate(today.getDate() - 5);
                const endDate   = new Date(today);
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