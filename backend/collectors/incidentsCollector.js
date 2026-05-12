/**
 * Incidents Collector
 * Endpoint: /event/{eventId}/incidents
 * 
 * Expected Response:
 * { incidents: [{ incidentType, minute, player, team, ... }] }
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class IncidentsCollector {
    constructor() {
        this.collectorName = 'incidents_collector';
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async collectForMatch(matchId) {
        try {
            await this.initialize();
            const matches = await db.query(
                'SELECT id, sofascore_match_id, home_team_id, away_team_id FROM matches WHERE id = ?',
                [matchId]
            );
            if (matches.length === 0) return { success: false, error: 'Match not found' };

            const match = matches[0];
            const endpoint = `/event/${match.sofascore_match_id}/incidents`;
            console.log(`📋 Incidents: Match ${matchId}`);
            
            const response = await httpClient.get(endpoint);
            if (!response || !response.incidents) return { success: false, error: 'No data' };

            let inserted = 0;
            for (const incident of response.incidents) {
                await this.storeIncident(matchId, incident, match.home_team_id, match.away_team_id);
                inserted++;
            }

            // Mark match
            await db.query('UPDATE matches SET has_incidents = 1 WHERE id = ?', [matchId]);

            // Summary
            const goals = response.incidents.filter(i => i.incidentType === 'goal').length;
            const cards = response.incidents.filter(i => i.incidentType === 'card' || i.incidentType === 'yellowCard').length;
            const redCards = response.incidents.filter(i => i.incidentType === 'redCard').length;
            const subs = response.incidents.filter(i => i.incidentType === 'substitution').length;
            
            console.log(`   ✅ ${inserted} incidents: ${goals}⚽ ${cards}🟨 ${redCards}🟥 ${subs}🔄`);
            return { success: true, inserted, summary: { goals, cards, redCards, subs } };

        } catch (error) {
            if (error.message.includes('404') || error.message.includes('403')) {
                return { success: false, error: 'Not available', skipped: true };
            }
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async storeIncident(matchId, incident, homeTeamId, awayTeamId) {
        // Determine which team the incident belongs to
        let teamId = null;
        if (incident.team?.id === homeTeamId) teamId = homeTeamId;
        else if (incident.team?.id === awayTeamId) teamId = awayTeamId;

        await db.query(
            `INSERT INTO incidents (match_id, incident_type, minute, extra_minute, team_id, player_id, player_name, incident_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE incident_data = VALUES(incident_data)`,
            [
                matchId,
                incident.incidentType || 'unknown',
                incident.minute || 0,
                incident.extraMinute || null,
                teamId,
                incident.player?.id || null,
                incident.player?.name || null,
                JSON.stringify(incident)
            ]
        );
    }

    async collectForDate(date, limit = 30) {
        await this.initialize();
        const matches = await db.query(
            `SELECT m.id FROM matches m
            WHERE m.match_date = ? AND m.has_incidents = 0
            AND m.status IN (100, 101, 102)
            AND m.id NOT IN (SELECT match_id FROM incidents)
            LIMIT ${parseInt(limit)}`,
            [date]
        );

        console.log(`\n📋 INCIDENTS: ${date} - ${matches.length} matches\n`);

        let success = 0, skipped = 0, totalGoals = 0;
        for (let i = 0; i < matches.length; i++) {
            console.log(`   [${i+1}/${matches.length}]`);
            const result = await this.collectForMatch(matches[i].id);
            if (result.success) { success++; totalGoals += (result.summary?.goals || 0); }
            else if (result.skipped) skipped++;
            await this.delay(1500);
        }

        console.log(`\n✅ ${success} ok, ${skipped} skipped, ${totalGoals} goals`);
        await db.close();
        return { success, skipped, totalGoals };
    }
}

if (require.main === module) {
    const collector = new IncidentsCollector();
    const arg = process.argv[2];
    (async () => {
        if (arg === '--date' && process.argv[3]) {
            await collector.collectForDate(process.argv[3], process.argv[4] || 30);
        } else if (arg && !isNaN(arg)) {
            const r = await collector.collectForMatch(parseInt(arg));
            console.log(JSON.stringify(r, null, 2));
        } else {
            console.log('Usage: node collectors/incidentsCollector.js <matchId>');
            console.log('       node collectors/incidentsCollector.js --date YYYY-MM-DD [limit]');
        }
        process.exit(0);
    })();
}

module.exports = new IncidentsCollector();