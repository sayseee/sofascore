/**
 * Standings Collector
 * Endpoint: /unique-tournament/{tournamentId}/season/{seasonId}/standings/total
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

    async collectForTournament(tournamentId, seasonId) {
        try {
            await this.initialize();
            
            const endpoint = `/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`;
            console.log(`🏆 Collecting standings: Tournament ${tournamentId}, Season ${seasonId}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.standings) {
                console.log('   No standings data');
                return { success: false, error: 'No data' };
            }

            let inserted = 0;
            
            for (const standing of response.standings) {
                if (standing.type !== 'total') continue;
                
                for (const row of standing.rows || []) {
                    if (!row.team) continue;

                    // Upsert team
                    const teamId = await this.upsertTeam(row.team);

                    // Upsert standing
                    if (teamId) {
                        // In the standing insert, add unique_tournament_id
                        await db.query(
                            `INSERT INTO standings (
                                tournament_id, unique_tournament_id, season_id, team_id, 
                                position, points, matches_played, wins, draws, losses,
                                goals_for, goals_against, goal_difference, last_updated
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                            ON DUPLICATE KEY UPDATE
                                position = VALUES(position), points = VALUES(points),
                                wins = VALUES(wins), draws = VALUES(draws), losses = VALUES(losses),
                                goals_for = VALUES(goals_for), goals_against = VALUES(goals_against),
                                goal_difference = VALUES(goal_difference),
                                unique_tournament_id = VALUES(unique_tournament_id),
                                last_updated = NOW()`,
                            [
                                dbTournamentId,      // tournament_id (internal FK)
                                tournamentId,         // unique_tournament_id (for API)
                                seasonId, 
                                teamId,
                                row.position || 0, row.points || 0,
                                row.matches || 0, row.wins || 0, row.draws || 0, row.losses || 0,
                                row.scoresFor || 0, row.scoresAgainst || 0,
                                parseInt(row.scoreDiffFormatted?.replace(/[+]/g, '') || '0'),
                            ]
                        );
                        inserted++;
                    }
                }
            }

            console.log(`   ✅ ${inserted} standings rows inserted`);
            return { success: true, inserted };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async upsertTeam(teamData) {
        if (!teamData?.id) return null;
        
        await db.query(
            `INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW()`,
            [
                teamData.id, teamData.name || 'Unknown',
                teamData.shortName || teamData.name?.substring(0, 3),
                teamData.slug || '',
                teamData.country?.name || null,
                teamData.country?.alpha2 || null
            ]
        );
        
        const result = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [teamData.id]);
        return result[0]?.id;
    }

    async collectActiveTournaments() {
    await this.initialize();
    
    const seasons = await db.query(
        `SELECT s.id as season_id, s.sofascore_season_id, s.name as season_name,
                t.id as tournament_id, t.unique_tournament_id, t.name as tournament_name
        FROM seasons s
        JOIN tournaments t ON s.tournament_id = t.id
        WHERE s.is_current = 1
        LIMIT 20`
    );

    console.log(`\n📊 Found ${seasons.length} active seasons:\n`);
    
    for (const s of seasons) {
        console.log(`   Tournament: ${s.tournament_name} (unique_id: ${s.unique_tournament_id})`);
        console.log(`   Season: ${s.season_name} (season_id: ${s.sofascore_season_id})`);
        console.log(`   API call: /unique-tournament/${s.unique_tournament_id}/season/${s.sofascore_season_id}/standings/total\n`);
        
        try {
            await this.collectForTournament(s.unique_tournament_id, s.sofascore_season_id);
        } catch (e) {
            console.log(`   ⚠️ Failed: ${e.message}\n`);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    
    await db.close();
}

    async collectForMatch(matchId) {
        await this.initialize();
        
        const match = await db.query(
            `SELECT m.tournament_id, m.season_id, t.sofascore_tournament_id, s.sofascore_season_id
            FROM matches m
            JOIN tournaments t ON m.tournament_id = t.id
            JOIN seasons s ON m.season_id = s.id
            WHERE m.id = ?`,
            [matchId]
        );

        if (match.length > 0) {
            const m = match[0];
            await this.collectForTournament(m.sofascore_tournament_id, m.sofascore_season_id);
        }
        
        await db.close();
    }
}

if (require.main === module) {
    const collector = new StandingsCollector();
    const arg = process.argv[2];
    
    (async () => {
        if (arg === '--all') {
            await collector.collectActiveTournaments();
        } else if (arg && !isNaN(arg)) {
            await collector.collectForMatch(parseInt(arg));
        } else {
            console.log('Usage: node collectors/standingsCollector.js [--all | matchId]');
        }
        process.exit(0);
    })();
}

module.exports = new StandingsCollector();