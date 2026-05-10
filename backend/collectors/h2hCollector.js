/**
 * H2H Collector
 * Endpoints:
 *   /event/{customId}/h2h/events   - H2H match history
 *   /event/{eventId}/h2h            - H2H summary
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class H2HCollector {
    constructor() { this.collectorName = 'h2h_collector'; }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    /**
     * Collect H2H summary using event ID
     * GET /event/{eventId}/h2h
     * Returns: { teamDuel: { homeWins, awayWins, draws }, managerDuel: { ... } }
     */
    async collectSummary(eventId) {
        try {
            await this.initialize();
            
            const endpoint = `/event/${eventId}/h2h`;
            console.log(`⚔️ H2H Summary: Event ${eventId}`);
            
            const response = await httpClient.get(endpoint, true);
            
            if (!response) {
                return { success: false, error: 'No data' };
            }

            console.log('   Team Duel:', JSON.stringify(response.teamDuel));
            console.log('   Manager Duel:', JSON.stringify(response.managerDuel));
            
            return { success: true, data: response };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Collect H2H events using custom ID
     * GET /event/{customId}/h2h/events
     * Returns: { events: [ ... past matches ... ] }
     */
    async collectEvents(customId, homeTeamId, awayTeamId) {
        try {
            await this.initialize();
            
            const endpoint = `/event/${customId}/h2h/events`;
            console.log(`⚔️ H2H Events: customId=${customId}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.events || response.events.length === 0) {
                return { success: false, error: 'No H2H events' };
            }

            const pairKey = [homeTeamId, awayTeamId].sort((a, b) => a - b).join('_');
            let inserted = 0;

            for (const event of response.events) {
                // Check if match exists in our DB
                const existing = await db.query(
                    'SELECT id FROM matches WHERE sofascore_match_id = ?',
                    [event.id]
                );

                if (existing.length > 0) {
                    await db.query(
                        `INSERT INTO h2h_matches (pair_key, match_id, home_team_id, away_team_id, 
                         match_date, home_score, away_score, tournament_name)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE home_score = VALUES(home_score)`,
                        [
                            `H2H_${pairKey}`, existing[0].id,
                            event.homeTeam?.id === homeTeamId ? homeTeamId : awayTeamId,
                            event.awayTeam?.id === awayTeamId ? awayTeamId : homeTeamId,
                            event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString().split('T')[0] : null,
                            event.homeScore?.current, event.awayScore?.current,
                            event.tournament?.name || null
                        ]
                    );
                    inserted++;
                }
            }

            console.log(`   ✅ ${inserted} H2H matches stored`);
            return { success: true, inserted };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Collect H2H for a match using both endpoints
     */
    async collectForMatch(matchId) {
        await this.initialize();
        
        const match = await db.query(
            `SELECT m.id, m.sofascore_match_id, m.custom_id,
                    m.home_team_id, m.away_team_id,
                    ht.sofascore_team_id as home_sofascore_id,
                    at.sofascore_team_id as away_sofascore_id
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.id = ?`,
            [matchId]
        );

        if (match.length === 0) return { success: false, error: 'Match not found' };

        const m = match[0];

        // Get H2H summary using event ID
        if (m.sofascore_match_id) {
            await this.collectSummary(m.sofascore_match_id);
        }

        // Get H2H events using custom ID
        if (m.custom_id) {
            await this.collectEvents(m.custom_id, m.home_sofascore_id, m.away_sofascore_id);
        }

        await db.close();
    }
}

if (require.main === module) {
    const collector = new H2HCollector();
    const matchId = parseInt(process.argv[2]);
    
    if (!matchId) {
        console.log('Usage: node collectors/h2hCollector.js <matchId>');
        process.exit(1);
    }

    collector.collectForMatch(matchId)
        .then(r => { console.log('\nDone:', r); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = new H2HCollector();