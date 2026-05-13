/**
 * Player Statistics Collector
 * Endpoint: /player/{sofascorePlayerId}/statistics
 * 
 * Flow: matches (has_lineups=1) → lineups → players → API → player_statistics
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class PlayerStatisticsCollector {
    constructor() {
        this.collectorName = 'player_statistics_collector';
        this.stats = { success: 0, skipped: 0, failed: 0, totalInserted: 0 };
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async collectForPlayer(sofascorePlayerId) {
    try {
        await this.initialize();
        
        const endpoint = `/player/${sofascorePlayerId}/statistics`;
        const response = await httpClient.get(endpoint);
        
        if (!response || !response.seasons) {
            return { success: false, error: 'No data', skipped: true };
        }

        const playerRow = await db.query(
            'SELECT id FROM players WHERE sofascore_player_id = ?',
            [sofascorePlayerId]
        );
        const dbPlayerId = playerRow[0]?.id || null;
        if (!dbPlayerId) return { success: false, error: 'Player not in DB', skipped: true };

        let inserted = 0;

        // ⚡ Exact mapping: API field → DB column
        const fieldMap = {
            'appearances': 'appearances',
            'minutesPlayed': 'minutes_played',
            'rating': 'rating',
            'goals': 'goals',
            'assists': 'assists',
            'goalsAssistsSum': 'goals_assists_sum',
            'expectedGoals': 'expected_goals',
            'expectedAssists': 'expected_assists',
            'totalShots': 'total_shots',
            'shotsOnTarget': 'shots_on_target',
            'shotsFromInsideTheBox': 'shots_from_inside_box',
            'bigChancesCreated': 'big_chances_created',
            'bigChancesMissed': 'big_chances_missed',
            'keyPasses': 'key_passes',
            'totalPasses': 'total_passes',
            'accuratePasses': 'accurate_passes',
            'accuratePassesPercentage': 'accurate_passes_percentage',
            'totalCross': 'total_cross',
            'accurateCrosses': 'accurate_crosses',
            'accurateCrossesPercentage': 'accurate_crosses_percentage',
            'totalLongBalls': 'total_long_balls',
            'accurateLongBalls': 'accurate_long_balls',
            'accurateLongBallsPercentage': 'accurate_long_balls_percentage',
            'tackles': 'tackles',
            'interceptions': 'interceptions',
            'dribbledPast': 'dribbled_past',
            'aerialDuelsWon': 'aerial_duels_won',
            'blockedShots': 'blocked_shots',
            'yellowCards': 'yellow_cards',
            'redCards': 'red_cards',
            'errorLeadToGoal': 'error_lead_to_goal',
            'saves': 'saves',
            'goalsConceded': 'goals_conceded',
            'cleanSheet': 'clean_sheet',
        };

        for (const seasonData of response.seasons) {
            if (!seasonData.statistics) continue;

            const stats = seasonData.statistics;
            const tournament = seasonData.uniqueTournament || {};
            const season = seasonData.season || {};
            const team = seasonData.team || {};

            let seasonId = null, teamId = null;

            if (tournament.id) {
                const tRow = await db.query('SELECT id FROM tournaments WHERE unique_tournament_id = ?', [tournament.id]);
                if (tRow[0]?.id && season.id) {
                    const sRow = await db.query(
                        'SELECT id FROM seasons WHERE tournament_id = ? AND sofascore_season_id = ?',
                        [tRow[0].id, season.id]
                    );
                    seasonId = sRow[0]?.id || null;
                }
            }

            if (team.id) {
                const tRow = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [team.id]);
                teamId = tRow[0]?.id || null;
            }

            // Build fields from mapped data
            const fields = ['player_id', 'season_id', 'team_id', 'unique_tournament_id', 'year', 'stat_type'];
            const values = [dbPlayerId, seasonId, teamId, tournament.id || null, seasonData.year || null, stats.type || 'overall'];

            for (const [apiField, dbField] of Object.entries(fieldMap)) {
                if (stats[apiField] !== undefined && stats[apiField] !== null) {
                    fields.push(dbField);
                    values.push(stats[apiField]);
                }
            }

            const placeholders = fields.map(() => '?').join(', ');
            const sql = `INSERT INTO player_statistics (${fields.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE updated_at = NOW()`;

            try {
                await db.query(sql, values);
                inserted++;
            } catch (e) {
                if (e.code !== 'ER_DUP_ENTRY') {
                    console.error(`      SQL: ${e.message.substring(0, 120)}`);
                }
            }
        }

        return { success: true, inserted };
    } catch (error) {
        if (error.message.includes('404') || error.message.includes('403')) {
            return { success: false, error: 'Not available', skipped: true };
        }
        return { success: false, error: error.message };
    }
}

    /**
     * ⚡ matches → lineups → players → stats
     */
    async collectForDate(date, limit = 100) {
    await this.initialize();
    const max = parseInt(limit) || 100;
    
    // ⚡ Debug: Check what data exists first
    const matchCount = await db.query(
        'SELECT COUNT(*) as c FROM matches WHERE match_date = ?',
        [date]
    );
    const lineupCount = await db.query(
        'SELECT COUNT(DISTINCT l.match_id) as c FROM lineups l JOIN matches m ON l.match_id = m.id WHERE m.match_date = ?',
        [date]
    );
    const playerInLineups = await db.query(
        'SELECT COUNT(DISTINCT l.player_id) as c FROM lineups l JOIN matches m ON l.match_id = m.id WHERE m.match_date = ?',
        [date]
    );
    
    console.log(`   📊 ${date}: ${matchCount[0]?.c || 0} matches, ${lineupCount[0]?.c || 0} with lineups, ${playerInLineups[0]?.c || 0} players in lineups`);
    
    // Get players from lineups - don't require has_lineups flag (it might not be set)
    const players = await db.query(
        `SELECT DISTINCT p.sofascore_player_id, p.name, p.id AS db_player_id,
                COUNT(DISTINCT l.match_id) AS matches_played
        FROM lineups l
        JOIN players p ON l.player_id = p.id
        JOIN matches m ON l.match_id = m.id
        WHERE m.match_date = ?
        AND p.sofascore_player_id IS NOT NULL
        AND p.sofascore_player_id > 0
        AND p.id NOT IN (
            SELECT DISTINCT player_id FROM player_statistics WHERE player_id IS NOT NULL
        )
        GROUP BY p.sofascore_player_id, p.name, p.id
        ORDER BY matches_played DESC
        LIMIT ${max}`,
        [date]
    );

    if (players.length === 0) {
        // Check if player_statistics has any data at all
        const psCount = await db.query('SELECT COUNT(*) as c FROM player_statistics');
        const totalPlayers = await db.query('SELECT COUNT(*) as c FROM players WHERE sofascore_player_id IS NOT NULL AND sofascore_player_id > 0');
        
        console.log(`\n   ℹ️  No players need stats for ${date}`);
        console.log(`   player_statistics table has ${psCount[0]?.c || 0} rows`);
        console.log(`   players table has ${totalPlayers[0]?.c || 0} players with Sofascore IDs`);
        
        if (lineupCount[0]?.c > 0 && psCount[0]?.c === 0) {
            console.log(`   ⚠️ Lineups exist but player_statistics is empty! Running without NOT IN filter...`);
            
            // Fallback: Get ALL players from lineups without the NOT IN filter
            const allPlayers = await db.query(
                `SELECT DISTINCT p.sofascore_player_id, p.name, p.id AS db_player_id,
                        COUNT(DISTINCT l.match_id) AS matches_played
                FROM lineups l
                JOIN players p ON l.player_id = p.id
                JOIN matches m ON l.match_id = m.id
                WHERE m.match_date = ?
                AND p.sofascore_player_id IS NOT NULL
                AND p.sofascore_player_id > 0
                GROUP BY p.sofascore_player_id, p.name, p.id
                ORDER BY matches_played DESC
                LIMIT ${max}`,
                [date]
            );
            
            if (allPlayers.length > 0) {
                console.log(`   ✅ Found ${allPlayers.length} players from lineups (fallback mode)\n`);
                return this.processBatch(allPlayers, date);
            }
        }
        
        await db.close();
        return [];
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 PLAYER STATS: ${date} - ${players.length} players`);
    console.log(`${'═'.repeat(60)}\n`);

    return this.processBatch(players, date);
}

/**
 * Process a batch of players - CONTINUOUS MODE (no pauses to avoid 403)
 */
async processBatch(players, date) {
    this.stats = { success: 0, skipped: 0, failed: 0, totalInserted: 0 };

    const MATCH_DELAY = 2000; // Keep small delay between requests to avoid rate limiting

    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        console.log(`   [${i+1}/${players.length}] ${p.name} (Sofascore ID: ${p.sofascore_player_id})`);
        const r = await this.collectForPlayer(p.sofascore_player_id);
        if (r.success) { 
            this.stats.success++; 
            this.stats.totalInserted += (r.inserted||0); 
            console.log(`      ✅ ${r.inserted||0} seasons stored`);
        }
        else if (r.skipped) { this.stats.skipped++; console.log(`      ⏭️ ${r.error}`); }
        else { this.stats.failed++; console.log(`      ❌ ${r.error}`); }
        
        // Small delay between each player - no batch pausing
        await this.delay(MATCH_DELAY);
    }

    console.log(`\n✅ ${this.stats.success} ok, ${this.stats.skipped} skipped, ${this.stats.failed} failed | ${this.stats.totalInserted} rows`);
    await db.close();
    return this.stats;
}

    async checkDate(date) {
        await this.initialize();
        const r = await db.query(
            `SELECT COUNT(DISTINCT p.id) AS total,
                    COUNT(DISTINCT CASE WHEN ps.player_id IS NOT NULL THEN p.id END) AS have_stats,
                    COUNT(DISTINCT CASE WHEN ps.player_id IS NULL THEN p.id END) AS need_stats
            FROM matches m
            JOIN lineups l ON m.id = l.match_id
            JOIN players p ON l.player_id = p.id
            LEFT JOIN player_statistics ps ON p.id = ps.player_id
            WHERE m.match_date = ? AND m.has_lineups = 1 AND p.sofascore_player_id IS NOT NULL`,
            [date]
        );
        const d = r[0] || {};
        console.log(`\n📊 ${date}: ${d.total} players | ${d.have_stats} have stats | ${d.need_stats} need stats\n`);
        await db.close();
        return d;
    }
}

// CLI
if (require.main === module) {
    const collector = new PlayerStatisticsCollector();
    const args = process.argv.slice(2);
    (async () => {
        try {
            if (args.includes('--date') && args.length >= 2) {
                const i = args.indexOf('--date');
                await collector.collectForDate(args[i+1], args[i+2] || 100);
            } else if (args.includes('--check') && args.length >= 2) {
                await collector.checkDate(args[args.indexOf('--check')+1]);
            } else if (args[0] && !isNaN(args[0])) {
                await collector.initialize();
                console.log(JSON.stringify(await collector.collectForPlayer(parseInt(args[0])), null, 2));
                await db.close();
            } else {
                console.log('Usage: --date YYYY-MM-DD [limit] | --check YYYY-MM-DD | <sofascorePlayerId>');
            }
        } catch (e) { console.error('Fatal:', e.message); }
        process.exit(0);
    })();
}

module.exports = new PlayerStatisticsCollector();