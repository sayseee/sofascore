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
            console.log(`\n📊 Winning Odds - Match ${matchId} (Event: ${match.sofascore_match_id})`);

            // Fetch from API - use web URL
            const endpoint = `/event/${match.sofascore_match_id}/provider/1/winning-odds`;
            console.log(`   Endpoint: ${endpoint}`);

            const response = await httpClient.get(endpoint, true);

            if (!response || (!response.home && !response.away)) {
                console.log('   ⚠️  No winning odds data');
                console.log('   Raw:', JSON.stringify(response).substring(0, 200));
                return { success: false, error: 'No winning odds data' };
            }

            // Extract data
            const home = response.home || {};
            const away = response.away || {};

            // Convert fractional to decimal
            const homeDecimal = this.fractionalToDecimal(home.fractionalValue);
            const awayDecimal = this.fractionalToDecimal(away.fractionalValue);

            // Values are percentages (33 = 33%)
            const homeExpected = home.expected || 0;
            const homeActual = home.actual || 0;
            const awayExpected = away.expected || 0;
            const awayActual = away.actual || 0;

            // Edge = actual - expected (percentage points)
            const homeEdge = homeActual - homeExpected;
            const awayEdge = awayActual - awayExpected;

            // Edge type
            const getEdgeType = (edge) => {
                if (edge > 2) return 'positive';   // Yellow - team outperforms
                if (edge < -2) return 'negative';   // Gray - team underperforms
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
            const marketGap = Math.max(0, 100 - totalExpected);
            console.log(`\n   📈 Market: Total Expected ${totalExpected}% | Draw Implied ${marketGap}%`);

            // Insert into database - matching EXACT table columns
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
                    home_actual_probability = VALUES(home_actual_probability),
                    home_edge_percentage = VALUES(home_edge_percentage),
                    home_edge_type = VALUES(home_edge_type),
                    home_is_value = VALUES(home_is_value),
                    away_expected_probability = VALUES(away_expected_probability),
                    away_actual_probability = VALUES(away_actual_probability),
                    away_edge_percentage = VALUES(away_edge_percentage),
                    away_edge_type = VALUES(away_edge_type),
                    away_is_value = VALUES(away_is_value),
                    updated_at = NOW()
            `;

            await db.query(sql, [
                matchId,
                // Home
                (homeExpected / 100).toFixed(4),     // probability 0-1
                (homeActual / 100).toFixed(4),       // probability 0-1
                homeDecimal,                          // decimal odds
                null,                                 // actual_decimal (not provided)
                home.fractionalValue || null,         // fractional
                homeEdge,                             // edge %
                getEdgeType(homeEdge),                // positive/negative/neutral
                homeEdge > 2 ? 1 : 0,                 // is_value
                // Away
                (awayExpected / 100).toFixed(4),
                (awayActual / 100).toFixed(4),
                awayDecimal,
                null,
                away.fractionalValue || null,
                awayEdge,
                getEdgeType(awayEdge),
                awayEdge > 2 ? 1 : 0,
                // Market
                (totalExpected / 100).toFixed(4),
                (marketGap / 100).toFixed(4)
            ]);

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
            [limit]
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

        const successful = results.filter(r => r.success);
        const valueBets = successful.filter(r => r.homeValue || r.awayValue);

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
}

// CLI
if (require.main === module) {
    const collector = new WinningOddsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--upcoming')) {
                const idx = args.indexOf('--upcoming');
                const limit = parseInt(args[idx + 1]) || 10;
                await collector.collectForUpcoming(limit);
            } else if (args[0] && !isNaN(args[0])) {
                await collector.initialize();
                const result = await collector.collectForMatch(parseInt(args[0]));
                console.log('\nResult:', JSON.stringify(result, null, 2));
            } else {
                console.log('Usage:');
                console.log('  node collectors/winningOddsCollector.js <matchId>');
                console.log('  node collectors/winningOddsCollector.js --upcoming [limit]');
                console.log('');
                console.log('Examples:');
                console.log('  node collectors/winningOddsCollector.js 1');
                console.log('  node collectors/winningOddsCollector.js --upcoming 10');
            }
            process.exit(0);
        } catch (error) {
            console.error('Fatal error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = new WinningOddsCollector();