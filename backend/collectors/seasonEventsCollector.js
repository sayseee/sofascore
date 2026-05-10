/**
 * Season Events Collector
 * Endpoint: /tournament/{uniqueTournamentId}/season/{seasonId}/events
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

    async collectForSeason(uniqueTournamentId, sofascoreSeasonId, dbTournamentId, dbSeasonId) {
        const startTime = Date.now();
        
        try {
            await this.initialize();
            
            // ✅ Uses /tournament/ NOT /unique-tournament/
            const endpoint = `/tournament/${uniqueTournamentId}/season/${sofascoreSeasonId}/events`;
            console.log(`📅 Events: Tournament ${uniqueTournamentId}, Season ${sofascoreSeasonId}`);
            
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
                if (i + 20 < events.length) await new Promise(r => setTimeout(r, 500));
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`   ✅ +${this.stats.matches.inserted} inserted, ${this.stats.matches.updated} updated (${duration}s)`);

            return { success: true, total: events.length, ...this.stats.matches };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processEvent(event, dbTournamentId, dbSeasonId) {
        // Upsert home team
        let homeTeamId = null;
        if (event.homeTeam?.id) {
            const existing = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.homeTeam.id]);
            if (existing.length > 0) {
                homeTeamId = existing[0].id;
            } else {
                const result = await db.query(
                    `INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        event.homeTeam.id,
                        event.homeTeam.name || 'Unknown',
                        event.homeTeam.shortName || event.homeTeam.name?.substring(0, 3),
                        event.homeTeam.slug || '',
                        event.homeTeam.country?.name || null,
                        event.homeTeam.country?.alpha2 || null
                    ]
                );
                homeTeamId = result.insertId;
                this.stats.teams.inserted++;
            }
        }

        // Upsert away team
        let awayTeamId = null;
        if (event.awayTeam?.id) {
            const existing = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.awayTeam.id]);
            if (existing.length > 0) {
                awayTeamId = existing[0].id;
            } else {
                const result = await db.query(
                    `INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        event.awayTeam.id,
                        event.awayTeam.name || 'Unknown',
                        event.awayTeam.shortName || event.awayTeam.name?.substring(0, 3),
                        event.awayTeam.slug || '',
                        event.awayTeam.country?.name || null,
                        event.awayTeam.country?.alpha2 || null
                    ]
                );
                awayTeamId = result.insertId;
                this.stats.teams.inserted++;
            }
        }

        if (!homeTeamId || !awayTeamId) return;

        // Upsert match
        const matchDateTime = event.startTimestamp ? new Date(event.startTimestamp * 1000) : null;
        const matchDate = matchDateTime ? matchDateTime.toISOString().split('T')[0] : null;

        const existing = await db.query('SELECT id FROM matches WHERE sofascore_match_id = ?', [event.id]);

        const matchData = {
            tournament_id: dbTournamentId,
            season_id: dbSeasonId,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            match_date: matchDate,
            match_datetime: matchDateTime,
            status: event.status?.code || 0,
            status_description: event.status?.description || null,
            round_info: event.roundInfo?.round ? `Round ${event.roundInfo.round}` : null,
            home_score: event.homeScore?.current ?? null,
            away_score: event.awayScore?.current ?? null,
            home_score_halftime: event.homeScore?.period1 ?? null,
            away_score_halftime: event.awayScore?.period1 ?? null,
            custom_id: event.customId || null
        };

        if (existing.length > 0) {
            const sets = Object.keys(matchData).map(k => `${k} = ?`).join(', ');
            await db.query(
                `UPDATE matches SET ${sets}, updated_at = NOW() WHERE id = ?`,
                [...Object.values(matchData), existing[0].id]
            );
            this.stats.matches.updated++;
        } else {
            const cols = Object.keys(matchData).join(', ');
            const placeholders = Object.keys(matchData).map(() => '?').join(', ');
            await db.query(
                `INSERT INTO matches (sofascore_match_id, ${cols}) VALUES (?, ${placeholders})`,
                [event.id, ...Object.values(matchData)]
            );
            this.stats.matches.inserted++;
        }
    }

    async collectCurrentSeasons() {
        await this.initialize();

        const currentSeasons = await db.query(
            `SELECT s.id as season_id, s.sofascore_season_id, s.name,
                    t.id as tournament_id, t.unique_tournament_id, t.name as tournament_name
            FROM seasons s
            JOIN tournaments t ON s.tournament_id = t.id
            WHERE s.is_current = 1
            ORDER BY t.name LIMIT 10`
        );

        console.log(`\n📅 Collecting events for ${currentSeasons.length} current seasons:\n`);

        for (const s of currentSeasons) {
            console.log(`\n🏆 ${s.tournament_name} - ${s.name}`);
            await this.collectForSeason(s.unique_tournament_id, s.sofascore_season_id, s.tournament_id, s.season_id);
            await new Promise(r => setTimeout(r, 3000));
        }

        console.log(`\n✅ Current seasons complete`);
        await db.close();
    }

    async collectHistoricalSeasons(uniqueTournamentId, dbTournamentId, maxSeasons = 3) {
        await this.initialize();

        const seasons = await db.query(
            `SELECT id, sofascore_season_id, name FROM seasons 
            WHERE tournament_id = ? ORDER BY year DESC LIMIT ?`,
            [dbTournamentId, maxSeasons]
        );

        for (const season of seasons) {
            console.log(`\n   Season: ${season.name}`);
            await this.collectForSeason(uniqueTournamentId, season.sofascore_season_id, dbTournamentId, season.id);
            await new Promise(r => setTimeout(r, 3000));
        }

        await db.close();
    }
}

if (require.main === module) {
    const collector = new SeasonEventsCollector();
    const arg = process.argv[2];

    (async () => {
        if (arg === '--current') await collector.collectCurrentSeasons();
        else if (arg === '--historical') await collector.collectHistoricalSeasons(17, 1, 3);
        else console.log('Usage: --current | --historical');
        process.exit(0);
    })();
}

module.exports = new SeasonEventsCollector();