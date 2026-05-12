/**
 * Season Events Collector (Rounds-based)
 * Endpoints:
 *   /unique-tournament/{id}/season/{id}/rounds - Get available rounds
 *   /unique-tournament/{id}/season/{id}/events/round/{round} - Get events per round
 * 
 * Much faster and avoids 403 errors from the season events endpoint
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class SeasonEventsCollector {
    constructor() {
        this.collectorName = 'season_events_collector';
        this.stats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    /**
     * Get available rounds for a tournament season
     */
    async getRounds(uniqueTournamentId, seasonId) {
        try {
            const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/rounds`;
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.rounds) return [];
            
            const currentRound = response.currentRound?.round || 0;
            console.log(`      📋 Current round: ${currentRound}, Total rounds: ${response.rounds.length}`);
            
            return {
                currentRound,
                rounds: response.rounds.map(r => r.round)
            };
        } catch (error) {
            console.error(`      ❌ Rounds error: ${error.message}`);
            return null;
        }
    }

    /**
     * Collect events for a specific round
     */
    async collectForRound(uniqueTournamentId, seasonId, round, dbTournamentId, dbSeasonId) {
        const startTime = Date.now();
        try {
            await this.initialize();
            
            const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/events/round/${round}`;
            console.log(`      📅 Round ${round}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.events || response.events.length === 0) {
                console.log('         ⚠️ No events');
                return { success: false, error: 'No events' };
            }

            const events = response.events;
            let inserted = 0, updated = 0, skipped = 0;

            for (const event of events) {
                const result = await this.processEvent(event, dbTournamentId, dbSeasonId);
                if (result === 'inserted') inserted++;
                else if (result === 'updated') updated++;
                else if (result === 'skipped') skipped++;
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`         ✅ +${inserted} new, ${updated} updated, ${skipped} exist (${events.length} events, ${duration}s)`);
            return { success: true, total: events.length, inserted, updated, skipped };

        } catch (error) {
            console.error(`         ❌ ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processEvent(event, dbTournamentId, dbSeasonId) {
        let homeTeamId = null;
        if (event.homeTeam?.id) {
            const row = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.homeTeam.id]);
            if (row.length > 0) homeTeamId = row[0].id;
            else {
                const r = await db.query(
                    'INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code) VALUES (?,?,?,?,?,?)',
                    [event.homeTeam.id, event.homeTeam.name || 'Unknown', (event.homeTeam.shortName || 'UNK').substring(0, 10),
                     event.homeTeam.slug || '', event.homeTeam.country?.name || null, event.homeTeam.country?.alpha2 || null]
                );
                homeTeamId = r.insertId;
            }
        }

        let awayTeamId = null;
        if (event.awayTeam?.id) {
            const row = await db.query('SELECT id FROM teams WHERE sofascore_team_id = ?', [event.awayTeam.id]);
            if (row.length > 0) awayTeamId = row[0].id;
            else {
                const r = await db.query(
                    'INSERT INTO teams (sofascore_team_id, name, short_name, slug, country, country_code) VALUES (?,?,?,?,?,?)',
                    [event.awayTeam.id, event.awayTeam.name || 'Unknown', (event.awayTeam.shortName || 'UNK').substring(0, 10),
                     event.awayTeam.slug || '', event.awayTeam.country?.name || null, event.awayTeam.country?.alpha2 || null]
                );
                awayTeamId = r.insertId;
            }
        }

        if (!homeTeamId || !awayTeamId) return 'skipped';

        const existing = await db.query('SELECT id FROM matches WHERE sofascore_match_id = ?', [event.id]);

        const matchData = {
            tournament_id: dbTournamentId,
            unique_tournament_id: event.tournament?.uniqueTournament?.id || null,
            season_id: dbSeasonId,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            match_date: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString().split('T')[0] : null,
            match_datetime: event.startTimestamp ? new Date(event.startTimestamp * 1000) : null,
            status: event.status?.code || 0,
            status_description: event.status?.description || null,
            round_info: event.roundInfo?.round ? 'Round ' + event.roundInfo.round : null,
            home_score: event.homeScore?.current ?? null,
            away_score: event.awayScore?.current ?? null,
            home_score_halftime: event.homeScore?.period1 ?? null,
            away_score_halftime: event.awayScore?.period1 ?? null,
            custom_id: event.customId || null
        };

        if (existing.length > 0) {
            const sets = Object.keys(matchData).map(k => `${k} = ?`).join(', ');
            await db.query(`UPDATE matches SET ${sets}, updated_at = NOW() WHERE id = ?`, [...Object.values(matchData), existing[0].id]);
            return 'updated';
        } else {
            const cols = Object.keys(matchData).join(', ');
            const vals = Object.values(matchData);
            const ph = vals.map(() => '?').join(', ');
            await db.query(`INSERT INTO matches (sofascore_match_id, ${cols}) VALUES (?, ${ph})`, [event.id, ...vals]);
            return 'inserted';
        }
    }

    /**
     * Collect current round + last 2 rounds for a tournament
     */
    async collectForTournament(t) {
    console.log(`\n   🏆 ${t.tournament_name} - ${t.season_name}`);
    
    let currentRound = 0;
    let roundsFetched = false;

    // Try 1: Get current round from tournaments table
    const tournRow = await db.query('SELECT current_round FROM tournaments WHERE id = ?', [t.tournament_id]);
    currentRound = tournRow[0]?.current_round || 0;

    // Try 2: Fetch rounds from API
    if (currentRound === 0) {
        const roundsData = await this.getRounds(t.unique_tournament_id, t.sofascore_season_id);
        if (roundsData) {
            currentRound = roundsData.currentRound;
            roundsFetched = true;
            await db.query('UPDATE tournaments SET current_round = ? WHERE id = ?', [currentRound, t.tournament_id]);
        }
    }

    // Try 3: Use scheduled events round info from matches on this date
    if (currentRound === 0) {
        const matchRound = await db.query(
            `SELECT round_info FROM matches WHERE tournament_id = ? AND season_id = ? AND round_info IS NOT NULL ORDER BY match_datetime DESC LIMIT 1`,
            [t.tournament_id, t.season_id]
        );
        if (matchRound[0]?.round_info) {
            const match = matchRound[0].round_info.match(/Round (\d+)/);
            if (match) currentRound = parseInt(match[1]);
        }
    }

    // If we still don't have a round, skip
    if (currentRound === 0) {
        console.log(`      ⚠️ Could not determine current round, skipping`);
        return { success: false, error: 'No round info' };
    }

    console.log(`      📋 Current round: ${currentRound}${roundsFetched ? ' (from API)' : ' (from DB)'}`);

    // Fetch current round + last 2 rounds
    const roundsToFetch = [];
    for (let r = Math.max(1, currentRound - 2); r <= currentRound; r++) {
        roundsToFetch.push(r);
    }

    let totalInserted = 0, totalUpdated = 0, failedRounds = 0;

    for (const round of roundsToFetch) {
        const result = await this.collectForRound(
            t.unique_tournament_id,
            t.sofascore_season_id,
            round,
            t.tournament_id,
            t.season_id
        );
        
        if (result.success) {
            totalInserted += (result.inserted || 0);
            totalUpdated += (result.updated || 0);
        } else if (result.skipped) {
            // 403/404 - round endpoint not available, stop trying more rounds
            failedRounds++;
            if (failedRounds >= 2) {
                console.log(`      ⚠️ Multiple round failures, skipping remaining rounds`);
                break;
            }
        }
        
        await this.delay(2000);
    }

    if (totalInserted > 0 || totalUpdated > 0) {
        console.log(`      ✅ +${totalInserted} new, ${totalUpdated} updated`);
    }
    return { success: true, inserted: totalInserted, updated: totalUpdated };
}

async collectForRound(uniqueTournamentId, seasonId, round, dbTournamentId, dbSeasonId) {
    const startTime = Date.now();
    try {
        await this.initialize();
        
        const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/events/round/${round}`;
        console.log(`      📅 Round ${round}`);
        
        const response = await httpClient.get(endpoint);
        
        if (!response || !response.events || response.events.length === 0) {
            console.log('         ⚠️ No events');
            return { success: false, error: 'No events', skipped: true };
        }

        const events = response.events;
        let inserted = 0, updated = 0, skipped = 0;

        for (const event of events) {
            const result = await this.processEvent(event, dbTournamentId, dbSeasonId);
            if (result === 'inserted') inserted++;
            else if (result === 'updated') updated++;
            else if (result === 'skipped') skipped++;
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`         ✅ +${inserted} new, ${updated} updated (${events.length} events, ${duration}s)`);
        return { success: true, total: events.length, inserted, updated, skipped };

    } catch (error) {
        if (error.message.includes('404') || error.message.includes('403')) {
            console.log(`         ⏭️ Not available (${error.message.includes('403') ? '403' : '404'})`);
            return { success: false, error: 'Not available', skipped: true };
        }
        console.error(`         ❌ ${error.message}`);
        return { success: false, error: error.message };
    }
}

async getRounds(uniqueTournamentId, seasonId) {
    try {
        const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/rounds`;
        const response = await httpClient.get(endpoint);
        
        if (!response || !response.rounds) return null;
        
        return {
            currentRound: response.currentRound?.round || 0,
            rounds: response.rounds.map(r => r.round)
        };
    } catch (error) {
        // 403/404 = rounds endpoint not available for this tournament
        return null;
    }
}

    async collectCurrentSeasons() {
        await this.initialize();
        
        const seasons = await db.query(
            `SELECT s.id AS season_id, s.sofascore_season_id, s.name AS season_name,
                    t.id AS tournament_id, t.unique_tournament_id, t.name AS tournament_name
            FROM seasons s JOIN tournaments t ON s.tournament_id = t.id
            WHERE s.is_current = 1 ORDER BY t.name LIMIT 15`
        );

        if (seasons.length === 0) {
            console.log('\n⚠️ No seasons marked as current.\n');
            await db.close();
            return [];
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`📅 CURRENT SEASONS (Rounds): ${seasons.length} tournaments`);
        console.log(`${'═'.repeat(55)}`);

        this.stats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

        const BATCH_SIZE = 3, BATCH_DELAY = 5000;

        for (let bs = 0; bs < seasons.length; bs += BATCH_SIZE) {
            const be = Math.min(bs + BATCH_SIZE, seasons.length);
            const batch = seasons.slice(bs, be);
            
            for (const t of batch) {
                const result = await this.collectForTournament(t);
                if (result.success) {
                    this.stats.inserted += (result.inserted || 0);
                    this.stats.updated += (result.updated || 0);
                    this.stats.skipped += (result.skipped || 0);
                } else {
                    this.stats.failed++;
                }
                await this.delay(3000);
            }
            
            if (be < seasons.length) {
                console.log(`\n   ⏸️  Pausing ${BATCH_DELAY/1000}s...\n`);
                await this.delay(BATCH_DELAY);
            }
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`📊 TOTAL: +${this.stats.inserted} new, ${this.stats.updated} updated, ${this.stats.skipped} exist`);
        console.log(`${'═'.repeat(55)}\n`);

        await db.close();
        return this.stats;
    }

    async collectForDate(date) {
        await this.initialize();
        
        const seasons = await db.query(
            `SELECT DISTINCT t.id AS tournament_id, t.unique_tournament_id, t.name AS tournament_name,
                    s.id AS season_id, s.sofascore_season_id, s.name AS season_name
            FROM matches m
            JOIN tournaments t ON m.tournament_id = t.id
            JOIN seasons s ON m.season_id = s.id
            WHERE m.match_date = ?
            AND t.unique_tournament_id IS NOT NULL
            AND s.sofascore_season_id IS NOT NULL`,
            [date]
        );

        if (seasons.length === 0) {
            console.log(`\n⚠️ No tournaments for ${date}\n`);
            await db.close();
            return [];
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`📅 SEASON EVENTS (Rounds) for: ${date}`);
        console.log(`   Tournaments: ${seasons.length}`);
        console.log(`${'═'.repeat(55)}`);

        this.stats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

        for (const t of seasons) {
            const result = await this.collectForTournament(t);
            if (result.success) {
                this.stats.inserted += (result.inserted || 0);
                this.stats.updated += (result.updated || 0);
                this.stats.skipped += (result.skipped || 0);
            } else {
                this.stats.failed++;
            }
            await this.delay(3000);
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`📊 TOTAL: +${this.stats.inserted} new, ${this.stats.updated} updated`);
        console.log(`${'═'.repeat(55)}\n`);

        await db.close();
        return this.stats;
    }
}

// CLI
if (require.main === module) {
    const collector = new SeasonEventsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--date') && args.length >= 2) {
                await collector.collectForDate(args[args.indexOf('--date') + 1]);
            } else if (args.includes('--current')) {
                await collector.collectCurrentSeasons();
            } else {
                console.log('Usage:');
                console.log('  node collectors/seasonEventsCollector.js --current');
                console.log('  node collectors/seasonEventsCollector.js --date YYYY-MM-DD');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
        }
        process.exit(0);
    })();
}

module.exports = new SeasonEventsCollector();