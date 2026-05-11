/**
 * Season Events Collector
 * Endpoint: /tournament/{categoryTournamentId}/season/{sofascoreSeasonId}/events
 * 
 * Gets ALL matches for a tournament+season
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class SeasonEventsCollector {
    constructor() {
        this.collectorName = 'season_events_collector';
        this.stats = { teams: { inserted: 0, updated: 0 }, matches: { inserted: 0, updated: 0, failed: 0 } };
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async collectForSeason(categoryTournamentId, sofascoreSeasonId, dbTournamentId, dbSeasonId) {
        const startTime = Date.now();
        try {
            await this.initialize();
            
            const endpoint = `/tournament/${categoryTournamentId}/season/${sofascoreSeasonId}/events`;
            console.log(`📅 Events: tournament.id=${categoryTournamentId}, season=${sofascoreSeasonId}`);
            console.log(`   Endpoint: ${endpoint}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.events || response.events.length === 0) {
                console.log('   No events found');
                return { success: false, error: 'No events' };
            }

            const events = response.events;
            console.log(`   Found ${events.length} events`);

            for (let i = 0; i < events.length; i += 20) {
                const batch = events.slice(i, i + 20);
                for (const event of batch) {
                    try {
                        await this.processEvent(event, dbTournamentId, dbSeasonId);
                    } catch (error) {
                        this.stats.matches.failed++;
                    }
                }
                if (i + 20 < events.length) await this.delay(500);
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`   ✅ +${this.stats.matches.inserted} inserted, ${this.stats.matches.updated} updated (${duration}s)`);
            return { success: true, total: events.length };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processEvent(event, dbTournamentId, dbSeasonId) {
        // Upsert home team
        let homeTeamId = null;
        if (event.homeTeam && event.homeTeam.id) {
            const row = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.homeTeam.id]);
            if (row.length > 0) {
                homeTeamId = row[0].id;
                this.stats.teams.updated++;
            } else {
                const r = await db.query(
                    'INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code) VALUES (?, ?, ?, ?, ?, ?)',
                    [event.homeTeam.id, event.homeTeam.name || 'Unknown', (event.homeTeam.shortName || event.homeTeam.name || 'UNK').substring(0, 10), event.homeTeam.slug || '', event.homeTeam.country?.name || null, event.homeTeam.country?.alpha2 || null]
                );
                homeTeamId = r.insertId;
                this.stats.teams.inserted++;
            }
        }

        // Upsert away team
        let awayTeamId = null;
        if (event.awayTeam && event.awayTeam.id) {
            const row = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.awayTeam.id]);
            if (row.length > 0) {
                awayTeamId = row[0].id;
                this.stats.teams.updated++;
            } else {
                const r = await db.query(
                    'INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code) VALUES (?, ?, ?, ?, ?, ?)',
                    [event.awayTeam.id, event.awayTeam.name || 'Unknown', (event.awayTeam.shortName || event.awayTeam.name || 'UNK').substring(0, 10), event.awayTeam.slug || '', event.awayTeam.country?.name || null, event.awayTeam.country?.alpha2 || null]
                );
                awayTeamId = r.insertId;
                this.stats.teams.inserted++;
            }
        }

        if (!homeTeamId || !awayTeamId) return;

        const uniqueTournamentId = event.tournament?.uniqueTournament?.id || null;
        const matchDateTime = event.startTimestamp ? new Date(event.startTimestamp * 1000) : null;
        const matchDate = matchDateTime ? matchDateTime.toISOString().split('T')[0] : null;
        const statusCode = event.status?.code || 0;
        const statusDesc = event.status?.description || null;
        const roundInfo = event.roundInfo?.round ? 'Round ' + event.roundInfo.round : null;
        const homeScore = event.homeScore?.current ?? null;
        const awayScore = event.awayScore?.current ?? null;
        const homeScoreHT = event.homeScore?.period1 ?? null;
        const awayScoreHT = event.awayScore?.period1 ?? null;
        const customId = event.customId || null;

        const existing = await db.query('SELECT id FROM matches WHERE sofascore_match_id = ?', [event.id]);

        if (existing.length > 0) {
            await db.query(
                `UPDATE matches SET 
                    tournament_id=?, unique_tournament_id=?, season_id=?,
                    home_team_id=?, away_team_id=?, match_date=?, match_datetime=?,
                    status=?, status_description=?, round_info=?,
                    home_score=?, away_score=?, home_score_halftime=?, away_score_halftime=?,
                    custom_id=COALESCE(custom_id,?), updated_at=NOW()
                WHERE id=?`,
                [dbTournamentId, uniqueTournamentId, dbSeasonId, homeTeamId, awayTeamId,
                 matchDate, matchDateTime, statusCode, statusDesc, roundInfo,
                 homeScore, awayScore, homeScoreHT, awayScoreHT, customId, existing[0].id]
            );
            this.stats.matches.updated++;
        } else {
            await db.query(
                `INSERT INTO matches (
                    sofascore_match_id, custom_id, tournament_id, unique_tournament_id, season_id,
                    home_team_id, away_team_id, match_date, match_datetime,
                    status, status_description, round_info,
                    home_score, away_score, home_score_halftime, away_score_halftime
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [event.id, customId, dbTournamentId, uniqueTournamentId, dbSeasonId,
                 homeTeamId, awayTeamId, matchDate, matchDateTime,
                 statusCode, statusDesc, roundInfo,
                 homeScore, awayScore, homeScoreHT, awayScoreHT]
            );
            this.stats.matches.inserted++;
        }
    }

    async collectCurrentSeasons() {
        await this.initialize();
        
        // Step 1: First, collect seasons for all tournaments
        console.log(`\n📅 Step 1: Collecting seasons for all tournaments...\n`);
        const tournaments = await db.query(
            'SELECT id, unique_tournament_id, category_tournament_id, name FROM tournaments WHERE unique_tournament_id IS NOT NULL'
        );
        
        console.log(`   Found ${tournaments.length} tournaments`);
        
        for (const t of tournaments) {
            try {
                const endpoint = `/unique-tournament/${t.unique_tournament_id}/seasons`;
                console.log(`   Fetching seasons: ${t.name} (ID: ${t.unique_tournament_id})`);
                
                const response = await httpClient.get(endpoint);
                
                if (response && response.seasons) {
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    
                    for (const season of response.seasons) {
                        const isCurrent = season.year?.includes(currentYear.toString()) ? 1 : 0;
                        
                        await db.query(
                            `INSERT INTO seasons (tournament_id, unique_tournament_id, sofascore_season_id, name, year, is_current)
                            VALUES (?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE name = VALUES(name), year = VALUES(year), is_current = VALUES(is_current), updated_at = NOW()`,
                            [t.id, t.unique_tournament_id, season.id, season.name, season.year || null, isCurrent]
                        );
                    }
                    console.log(`      ✅ ${response.seasons.length} seasons stored`);
                }
            } catch (e) {
                console.log(`      ⚠️ Failed: ${e.message}`);
            }
            await this.delay(2000); // Rate limit between tournaments
        }
        
        // Step 2: Now get all current seasons
        console.log(`\n📅 Step 2: Collecting events for current seasons...\n`);
        
        const currentSeasons = await db.query(
            `SELECT s.id AS season_id, s.sofascore_season_id, s.name,
                    t.id AS tournament_id, t.category_tournament_id, t.name AS tournament_name
            FROM seasons s 
            JOIN tournaments t ON s.tournament_id = t.id
            WHERE s.is_current = 1
            ORDER BY t.name`
        );
        
        if (currentSeasons.length === 0) {
            // Fallback: get seasons with current year in the name
            const fallback = await db.query(
                `SELECT s.id AS season_id, s.sofascore_season_id, s.name,
                        t.id AS tournament_id, t.category_tournament_id, t.name AS tournament_name
                FROM seasons s 
                JOIN tournaments t ON s.tournament_id = t.id
                WHERE s.year LIKE '%2026%' OR s.name LIKE '%2026%'
                ORDER BY t.name LIMIT 20`
            );
            
            if (fallback.length === 0) {
                console.log('   No seasons found. Run tournamentSeasonsCollector first.');
                await db.close();
                return;
            }
            
            console.log(`   Using fallback: ${fallback.length} seasons from 2026\n`);
            
            for (const s of fallback) {
                const apiId = s.category_tournament_id || s.tournament_id;
                console.log(`\n🏆 ${s.tournament_name} - ${s.name}`);
                console.log(`   API: tournament=${apiId}, season=${s.sofascore_season_id}`);
                console.log(`   DB: tournament_id=${s.tournament_id}, season_id=${s.season_id}`);
                
                await this.collectForSeason(apiId, s.sofascore_season_id, s.tournament_id, s.season_id);
                await this.delay(3000);
            }
        } else {
            console.log(`   Found ${currentSeasons.length} current seasons\n`);
            
            for (const s of currentSeasons) {
                const apiId = s.category_tournament_id || s.tournament_id;
                console.log(`\n🏆 ${s.tournament_name} - ${s.name}`);
                
                await this.collectForSeason(apiId, s.sofascore_season_id, s.tournament_id, s.season_id);
                await this.delay(3000);
            }
        }
        
        console.log(`\n✅ Current seasons complete`);
        await db.close();
    }
}

// CLI
// CLI
if (require.main === module) {
    const collector = new SeasonEventsCollector();
    const cmd = process.argv[2];

    (async () => {
        try {
            if (cmd === '--current') {
                // Process ALL current seasons across all tournaments
                await collector.collectCurrentSeasons();
                
            } else if (cmd === '--historical') {
                // Process historical seasons for ALL tournaments
                await collector.initialize();
                const tournaments = await db.query(
                    'SELECT id, category_tournament_id, name FROM tournaments WHERE category_tournament_id IS NOT NULL'
                );
                console.log(`\n📅 Collecting historical events for ${tournaments.length} tournaments:\n`);
                
                for (const t of tournaments) {
                    const apiId = t.category_tournament_id || t.id;
                    console.log(`\n${'═'.repeat(50)}`);
                    console.log(`🏆 ${t.name} (API ID: ${apiId}, DB ID: ${t.id})`);
                    await collector.collectHistoricalSeasons(apiId, t.id, 3);
                    await collector.delay(3000);
                }
                console.log(`\n✅ All historical seasons complete`);
                await db.close();
                
            } else if (cmd && !isNaN(cmd)) {
                // Single tournament by ID
                const tId = parseInt(cmd);
                await collector.initialize();
                const t = await db.query('SELECT id, category_tournament_id, name FROM tournaments WHERE id = ?', [tId]);
                if (t.length > 0) {
                    const apiId = t[0].category_tournament_id || t[0].id;
                    await collector.collectHistoricalSeasons(apiId, t[0].id, 3);
                }
                await db.close();
                
            } else {
                console.log('Usage:');
                console.log('  --current      Process all current seasons');
                console.log('  --historical   Process historical for all tournaments');
                console.log('  [tournamentId] Process single tournament by DB ID');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
        }
        process.exit(0);
    })();
} 

module.exports = new SeasonEventsCollector();