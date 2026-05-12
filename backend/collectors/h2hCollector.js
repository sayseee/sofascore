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
    constructor() { 
        this.collectorName = 'h2h_collector';
        this.debug = false;
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async collectSummary(eventId) {
        try {
            await this.initialize();
            const response = await httpClient.get(`/event/${eventId}/h2h`);
            if (!response) return { success: false, error: 'No data' };
            console.log(`      📊 H2H Summary: ${response.teamDuel?.homeWins || 0}W-${response.teamDuel?.draws || 0}D-${response.teamDuel?.awayWins || 0}W`);
            return { success: true, data: response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async collectEvents(customId, homeDbTeamId, awayDbTeamId) {
    try {
        await this.initialize();
        
        const response = await httpClient.get(`/event/${customId}/h2h/events`);
        
        if (!response || !response.events || response.events.length === 0) {
            return { success: false, error: 'No H2H events' };
        }

        const pairKey = [homeDbTeamId, awayDbTeamId].sort((a, b) => a - b).join('_');
        let inserted = 0, inDb = 0, notInDb = 0;

        for (const event of response.events) {
            const existing = await db.query('SELECT id FROM matches WHERE sofascore_match_id = ?', [event.id]);
            
            if (existing.length === 0) { notInDb++; continue; }
            inDb++;

            // Resolve team IDs
            let dbHomeId = null, dbAwayId = null;
            if (event.homeTeam?.id) {
                const ht = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.homeTeam.id]);
                dbHomeId = ht[0]?.id || null;
            }
            if (event.awayTeam?.id) {
                const at = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.awayTeam.id]);
                dbAwayId = at[0]?.id || null;
            }

            if (!dbHomeId || !dbAwayId) continue;

            // ⚡ Check if the current home team is playing at home in this H2H event
            const isCurrentHomeTeamHome = (event.homeTeam?.id === homeDbTeamId || dbHomeId === homeDbTeamId) ? 1 : 0;

            const matchDate = event.startTimestamp 
                ? new Date(event.startTimestamp * 1000).toISOString().split('T')[0] 
                : null;
            const homeScore = event.homeScore?.current ?? null;
            const awayScore = event.awayScore?.current ?? null;
            const homeScoreHT = event.homeScore?.period1 ?? null;
            const awayScoreHT = event.awayScore?.period1 ?? null;

            try {
                await db.query(
                    `INSERT INTO h2h_matches (
                        pair_key, match_id, home_team_id, away_team_id, 
                        match_date, home_score, away_score, 
                        home_score_halftime, away_score_halftime,
                        tournament_name, is_home_team_current_home,
                        home_team_sofascore_id, away_team_sofascore_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                        home_score = VALUES(home_score), 
                        away_score = VALUES(away_score),
                        home_score_halftime = VALUES(home_score_halftime),
                        away_score_halftime = VALUES(away_score_halftime)`,
                    [
                        'H2H_' + pairKey,
                        existing[0].id,
                        dbHomeId,
                        dbAwayId,
                        matchDate,
                        homeScore,
                        awayScore,
                        homeScoreHT,
                        awayScoreHT,
                        event.tournament?.name || null,
                        isCurrentHomeTeamHome,
                        event.homeTeam?.id || null,
                        event.awayTeam?.id || null
                    ]
                );
                inserted++;
            } catch (e) {
                if (e.code !== 'ER_DUP_ENTRY') console.error(`      SQL: ${e.message}`);
            }
        }

        console.log(`      ✅ ${inserted} stored (${inDb} in DB, ${notInDb} historical)`);
        return { success: true, inserted, inDb, notInDb };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

    async collectForMatch(matchId) {
        await this.initialize();
        const match = await db.query(
            'SELECT id, sofascore_match_id, custom_id, home_team_id, away_team_id FROM matches WHERE id = ?',
            [matchId]
        );
        if (match.length === 0) return { success: false, error: 'Match not found' };

        const m = match[0];
        if (m.sofascore_match_id) await this.collectSummary(m.sofascore_match_id);
        if (m.custom_id) await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
        return { success: true };
    }

    async collectForDate(date, limit = 50) {
        await this.initialize();
        const max = parseInt(limit) || 50;
        
        const matches = await db.query(
            `SELECT m.id, m.custom_id, m.home_team_id, m.away_team_id, ht.name AS home, at.name AS away
            FROM matches m JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_date = ? AND m.custom_id IS NOT NULL LIMIT ${max}`,
            [date]
        );

        if (matches.length === 0) {
            console.log(`\n⚔️ No matches with H2H data for ${date}\n`);
            await db.close();
            return [];
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`⚔️ H2H BATCH: ${date} - ${matches.length} matches`);
        console.log(`${'═'.repeat(55)}\n`);

        let ok = 0, fail = 0, total = 0;

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            console.log(`   [${i+1}/${matches.length}] ${m.home} vs ${m.away}`);
            const r = await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
            if (r.success) { ok++; total += (r.inserted||0); }
            else { fail++; console.log(`      ⚠️ ${r.error}`); }
            await this.delay(1500);
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`📊 ${ok} ok, ${fail} failed | ${total} H2H rows`);
        console.log(`${'═'.repeat(55)}\n`);
        await db.close();
        return { date, total: matches.length, ok, fail, inserted: total };
    }

    async collectUpcoming(days = 7, limit = 30) {
        await this.initialize();
        const d = parseInt(days) || 7;
        const max = parseInt(limit) || 30;
        
        const matches = await db.query(
            `SELECT m.id, m.custom_id, m.home_team_id, m.away_team_id, ht.name AS home, at.name AS away, m.match_date
            FROM matches m JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_datetime > NOW() AND m.match_datetime < DATE_ADD(NOW(), INTERVAL ${d} DAY)
            AND m.custom_id IS NOT NULL
            AND m.id NOT IN (SELECT DISTINCT match_id FROM h2h_matches)
            ORDER BY m.match_datetime ASC LIMIT ${max}`
        );

        console.log(`\n⚔️ H2H UPCOMING: ${matches.length} matches\n`);
        let ok = 0, fail = 0;
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            console.log(`   [${i+1}/${matches.length}] ${m.home} vs ${m.away} (${m.match_date})`);
            const r = await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
            if (r.success) ok++; else fail++;
            await this.delay(1500);
        }
        console.log(`\n✅ ${ok} ok, ${fail} failed`);
        await db.close();
        return { ok, fail };
    }
}

// CLI
if (require.main === module) {
    const collector = new H2HCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args[0] === '--date' && args[1]) {
                await collector.collectForDate(args[1], args[2] || 50);
            } else if (args[0] === '--upcoming') {
                await collector.collectUpcoming(args[1], args[2]);
            } else if (args[0] && !isNaN(args[0])) {
                await collector.initialize();
                console.log(JSON.stringify(await collector.collectForMatch(parseInt(args[0])), null, 2));
                await db.close();
            } else {
                console.log('Usage:');
                console.log('  node collectors/h2hCollector.js --date YYYY-MM-DD [limit]');
                console.log('  node collectors/h2hCollector.js --upcoming [days] [limit]');
                console.log('  node collectors/h2hCollector.js <matchId>');
            }
        } catch (e) { console.error('Fatal:', e.message); }
        process.exit(0);
    })();
}

module.exports = new H2HCollector();