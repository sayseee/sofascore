/**
 * Standings Collector
 * Endpoint: /unique-tournament/{uniqueTournamentId}/season/{apiSeasonId}/standings/total
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class StandingsCollector {
    constructor() {
        this.collectorName = 'standings_collector';
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async collectForTournament(uniqueTournamentId, apiSeasonId, dbTournamentId, dbSeasonId) {
        try {
            await this.initialize();
            
            const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${apiSeasonId}/standings/total`;
            console.log(`   🏆 ${endpoint}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.standings) {
                console.log('      No standings data');
                return { success: false, error: 'No data' };
            }

            let inserted = 0;
            
            for (const standing of response.standings) {
                if (standing.type !== 'total') continue;
                
                for (const row of standing.rows || []) {
                    if (!row.team) continue;

                    const teamId = await this.upsertTeam(row.team);

                    if (teamId) {
                        try {
                            await db.query(
                                `INSERT INTO standings (
                                    tournament_id, season_id, team_id,
                                    position, points, matches_played, wins, draws, losses,
                                    goals_for, goals_against, goal_difference, last_updated
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                                ON DUPLICATE KEY UPDATE
                                    position = VALUES(position), points = VALUES(points),
                                    wins = VALUES(wins), draws = VALUES(draws), losses = VALUES(losses),
                                    goals_for = VALUES(goals_for), goals_against = VALUES(goals_against),
                                    goal_difference = VALUES(goal_difference),
                                    last_updated = NOW()`,
                                [
                                    dbTournamentId, dbSeasonId, teamId,
                                    row.position || 0, row.points || 0,
                                    row.matches || 0, row.wins || 0, row.draws || 0, row.losses || 0,
                                    row.scoresFor || 0, row.scoresAgainst || 0,
                                    parseInt(String(row.scoreDiffFormatted || '0').replace(/[+]/g, ''))
                                ]
                            );
                            inserted++;
                        } catch (err) {
                            if (err.code !== 'ER_DUP_ENTRY') {
                                console.error(`      SQL Error: ${err.message}`);
                            }
                        }
                    }
                }
            }

            console.log(`      ✅ ${inserted} rows`);
            return { success: true, inserted };
        } catch (error) {
            console.error(`      ❌ ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async upsertTeam(teamData) {
        if (!teamData?.id) return null;
        await db.query(
            `INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW()`,
            [teamData.id, teamData.name || 'Unknown', (teamData.shortName || teamData.name || 'UNK').substring(0, 10),
             teamData.slug || '', teamData.country?.name || null, teamData.country?.alpha2 || null]
        );
        const result = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [teamData.id]);
        return result[0]?.id || null;
    }

    async collectActiveTournaments() {
        await this.initialize();
        const seasons = await db.query(
            `SELECT s.id AS db_season_id, s.sofascore_season_id AS api_season_id, s.name AS season_name,
                    t.id AS db_tournament_id, t.unique_tournament_id, t.name AS tournament_name
            FROM seasons s JOIN tournaments t ON s.tournament_id = t.id
            WHERE s.is_current = 1 LIMIT 20`
        );
        console.log(`\n📊 Standings for ${seasons.length} active seasons:\n`);
        for (const s of seasons) {
            console.log(`   ${s.tournament_name} - ${s.season_name}`);
            await this.collectForTournament(s.unique_tournament_id || s.db_tournament_id, s.api_season_id, s.db_tournament_id, s.db_season_id);
            await this.delay(2000);
        }
        console.log(`\n✅ Standings collection complete`);
        await db.close();
    }

    /**
     * ⚡ NEW: Collect standings for tournaments that have matches on a specific date
     */
    async collectForDate(date) {
        await this.initialize();
        
        // Get unique tournaments from matches on this date
        const tournaments = await db.query(
            `SELECT DISTINCT t.id AS db_tournament_id, t.unique_tournament_id, t.name AS tournament_name,
                    s.id AS db_season_id, s.sofascore_season_id AS api_season_id, s.name AS season_name
            FROM matches m
            JOIN tournaments t ON m.tournament_id = t.id
            JOIN seasons s ON m.season_id = s.id
            WHERE m.match_date = ?
            AND t.unique_tournament_id IS NOT NULL
            AND s.sofascore_season_id IS NOT NULL`,
            [date]
        );

        if (tournaments.length === 0) {
            console.log(`\n📊 No tournaments found for ${date}\n`);
            await db.close();
            return [];
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📊 STANDINGS FOR: ${date}`);
        console.log(`   Tournaments: ${tournaments.length}`);
        console.log(`${'═'.repeat(60)}\n`);

        let success = 0, failed = 0;

        for (const t of tournaments) {
            console.log(`   ${t.tournament_name} - ${t.season_name}`);
            
            const result = await this.collectForTournament(
                t.unique_tournament_id,
                t.api_season_id,
                t.db_tournament_id,
                t.db_season_id
            );
            
            if (result.success) success++;
            else failed++;
            
            await this.delay(2000);
        }

        console.log(`\n✅ ${success} ok, ${failed} failed`);
        await db.close();
        return { success, failed };
    }
}

// CLI
if (require.main === module) {
    const collector = new StandingsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--date') && args.length >= 2) {
                const date = args[args.indexOf('--date') + 1];
                await collector.collectForDate(date);
            } else if (args.includes('--all')) {
                await collector.collectActiveTournaments();
            } else {
                console.log('Usage:');
                console.log('  node collectors/standingsCollector.js --all');
                console.log('  node collectors/standingsCollector.js --date YYYY-MM-DD');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
        }
        process.exit(0);
    })();
}

module.exports = new StandingsCollector();