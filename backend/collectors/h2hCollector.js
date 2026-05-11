/**
 * H2H Collector - With Debug Logging
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
        this.debug = true; // ⚡ Enable debug mode
    }

    log(msg, data) {
        if (this.debug) {
            if (data) {
                console.log(`   [DEBUG] ${msg}:`, typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data);
            } else {
                console.log(`   [DEBUG] ${msg}`);
            }
        }
    }

    async initialize() {
        if (!db.isConnected) {
            this.log('Initializing database connection');
            await db.initialize();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async collectSummary(eventId) {
        try {
            await this.initialize();
            const endpoint = `/event/${eventId}/h2h`;
            this.log(`Fetching summary: ${endpoint}`);
            const response = await httpClient.get(endpoint);
            if (!response) {
                this.log('No summary data returned');
                return { success: false, error: 'No data' };
            }
            this.log('Summary fetched successfully', response);
            return { success: true, data: response };
        } catch (error) {
            this.log(`Summary error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async collectEvents(customId, homeDbTeamId, awayDbTeamId) {
        try {
            await this.initialize();
            
            const endpoint = `/event/${customId}/h2h/events`;
            this.log(`Fetching events: ${endpoint}`);
            this.log(`Params: customId=${customId}, homeDb=${homeDbTeamId}, awayDb=${awayDbTeamId}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.events || response.events.length === 0) {
                this.log('No H2H events found');
                return { success: false, error: 'No H2H events' };
            }

            this.log(`Found ${response.events.length} H2H events`);
            
            const pairKey = [homeDbTeamId, awayDbTeamId].sort((a, b) => a - b).join('_');
            this.log(`Pair key: H2H_${pairKey}`);
            
            let inserted = 0;
            let skipped = 0;

            for (const event of response.events) {
                this.log(`Processing event: ${event.id}`);
                
                // Check if match exists
                const existing = await db.query(
                    'SELECT id FROM matches WHERE sofascore_match_id = ?',
                    [event.id]
                );
                
                if (existing.length === 0) {
                    this.log(`Match ${event.id} not in DB, skipping`);
                    skipped++;
                    continue;
                }
                
                this.log(`Match found in DB: id=${existing[0].id}`);

                // Resolve home team
                let dbHomeId = null;
                if (event.homeTeam?.id) {
                    const ht = await db.query(
                        'SELECT id FROM teams WHERE sofascore_team_id = ?',
                        [event.homeTeam.id]
                    );
                    dbHomeId = ht[0]?.id || null;
                    this.log(`Home team: sofascore=${event.homeTeam.id}, db=${dbHomeId}`);
                }

                // Resolve away team
                let dbAwayId = null;
                if (event.awayTeam?.id) {
                    const at = await db.query(
                        'SELECT id FROM teams WHERE sofascore_team_id = ?',
                        [event.awayTeam.id]
                    );
                    dbAwayId = at[0]?.id || null;
                    this.log(`Away team: sofascore=${event.awayTeam.id}, db=${dbAwayId}`);
                }

                if (!dbHomeId || !dbAwayId) {
                    this.log('Missing team IDs, skipping');
                    skipped++;
                    continue;
                }

                const matchDate = event.startTimestamp 
                    ? new Date(event.startTimestamp * 1000).toISOString().split('T')[0] 
                    : null;
                const homeScore = event.homeScore?.current ?? null;
                const awayScore = event.awayScore?.current ?? null;
                const tournamentName = event.tournament?.name || null;

                // ⚡ Debug the SQL parameters
                const sqlParams = [
                    'H2H_' + pairKey,
                    existing[0].id,
                    dbHomeId,
                    dbAwayId,
                    matchDate,
                    homeScore,
                    awayScore,
                    tournamentName
                ];
                this.log(`SQL params (${sqlParams.length}): [${sqlParams.join(', ')}]`);

                try {
                    const result = await db.query(
                        'INSERT INTO h2h_matches (pair_key, match_id, home_team_id, away_team_id, match_date, home_score, away_score, tournament_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE home_score = VALUES(home_score), away_score = VALUES(away_score)',
                        sqlParams
                    );
                    this.log(`Insert result: ${JSON.stringify(result)}`);
                    inserted++;
                } catch (sqlError) {
                    this.log(`SQL Error: ${sqlError.message}`);
                    console.error(`   ❌ SQL Error for event ${event.id}: ${sqlError.message}`);
                }
            }

            this.log(`Done: ${inserted} inserted, ${skipped} skipped`);
            return { success: true, inserted, skipped };

        } catch (error) {
            this.log(`Events error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async collectForMatch(matchId) {
        await this.initialize();
        this.log(`Collecting H2H for match ${matchId}`);
        
        const match = await db.query(
            'SELECT id, sofascore_match_id, custom_id, home_team_id, away_team_id FROM matches WHERE id = ?',
            [matchId]
        );
        
        if (match.length === 0) {
            this.log('Match not found');
            return { success: false, error: 'Match not found' };
        }

        const m = match[0];
        this.log(`Match data: sofascore_id=${m.sofascore_match_id}, custom_id=${m.custom_id}`);

        if (m.sofascore_match_id) {
            await this.collectSummary(m.sofascore_match_id);
            await this.delay(1000);
        }

        if (m.custom_id) {
            await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
        } else {
            this.log('No custom_id available');
        }

        return { success: true };
    }

    async collectForDate(date, limit) {
    await this.initialize();
    const max = parseInt(limit) || 50;
    
    this.log(`Batch H2H for date=${date}, limit=${max}`);
    
    // ⚡ FIX: Hardcode LIMIT instead of using ? placeholder
    const sql = `SELECT m.id, m.sofascore_match_id, m.custom_id, m.home_team_id, m.away_team_id, ht.name AS home_name, at.name AS away_name FROM matches m JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id WHERE m.match_date = ? AND m.custom_id IS NOT NULL LIMIT ${max}`;
    
    this.log(`SQL: ${sql}`);
    this.log(`Param: [${date}]`);
    
    const matches = await db.query(sql, [date]);

    console.log(`\n⚔️ BATCH H2H for ${date}: ${matches.length} matches\n`);

    let success = 0, failed = 0, totalInserted = 0;

    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        console.log(`   [${i + 1}/${matches.length}] ${m.home_name} vs ${m.away_name}`);
        
        try {
            const result = await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
            if (result.success) {
                success++;
                totalInserted += (result.inserted || 0);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
            console.log(`      ❌ ${e.message}`);
        }
        
        await this.delay(1500);
    }

    console.log(`\n📊 H2H BATCH: ${success} ok, ${failed} failed, ${totalInserted} rows`);
    await db.close();
    return { date, total: matches.length, success, failed, totalInserted };
}

    async collectUpcoming(days, limit) {
    await this.initialize();
    const d = parseInt(days) || 7;
    const max = parseInt(limit) || 30;
    
    // ⚡ FIX: Hardcode LIMIT and INTERVAL
    const sql = `SELECT m.id, m.sofascore_match_id, m.custom_id, m.home_team_id, m.away_team_id, ht.name AS home_name, at.name AS away_name, m.match_date FROM matches m JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id WHERE m.match_datetime > NOW() AND m.match_datetime < DATE_ADD(NOW(), INTERVAL ${d} DAY) AND m.custom_id IS NOT NULL AND m.id NOT IN (SELECT DISTINCT match_id FROM h2h_matches) ORDER BY m.match_datetime ASC LIMIT ${max}`;
    
    const matches = await db.query(sql, []);

    console.log(`\n⚔️ BATCH H2H upcoming: ${matches.length} matches\n`);

    let success = 0, failed = 0;

    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        console.log(`   [${i + 1}/${matches.length}] ${m.home_name} vs ${m.away_name} (${m.match_date})`);
        
        try {
            const result = await this.collectEvents(m.custom_id, m.home_team_id, m.away_team_id);
            if (result.success) success++;
            else failed++;
        } catch (e) {
            failed++;
            console.log(`      ❌ ${e.message}`);
        }
        
        await this.delay(1500);
    }

    console.log(`\n✅ H2H batch: ${success} ok, ${failed} failed`);
    await db.close();
    return { success, failed };
}
}

// CLI
if (require.main === module) {
    const collector = new H2HCollector();
    const arg = process.argv[2];
    const arg2 = process.argv[3];

    (async () => {
        try {
            if (arg === '--date' && arg2) {
                await collector.collectForDate(arg2, process.argv[4]);
            } else if (arg === '--upcoming') {
                await collector.collectUpcoming(arg2, process.argv[4]);
            } else if (arg && !isNaN(arg)) {
                const result = await collector.collectForMatch(parseInt(arg));
                console.log('Result:', JSON.stringify(result, null, 2));
            } else {
                console.log('Usage:');
                console.log('  Single:  node collectors/h2hCollector.js <matchId>');
                console.log('  Batch:   node collectors/h2hCollector.js --date 2026-05-10 [limit]');
                console.log('  Upcoming: node collectors/h2hCollector.js --upcoming [days] [limit]');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
            console.error(e.stack);
        }
        process.exit(0);
    })();
}

module.exports = new H2HCollector();