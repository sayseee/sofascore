/**
 * Scheduled Events Collector
 * Fetches ALL matches for a given date from Sofascore API
 * Handles: tournaments, teams, seasons, and match records
 * 
 * Usage: 
 *   node collectors/scheduledEventsCollector.js                    # Today
 *   node collectors/scheduledEventsCollector.js 2025-01-25        # Specific date
 *   node collectors/scheduledEventsCollector.js --days 7           # Next 7 days
 *   node collectors/scheduledEventsCollector.js --range 2025-01-20 2025-01-25  # Date range
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');
const SOFASCORE_CONFIG = require('../config/sofascore');

class ScheduledEventsCollector {
    constructor() {
        this.collectorName = 'scheduled_events_collector';
        this.stats = {
            tournaments: { inserted: 0, updated: 0 },
            teams: { inserted: 0, updated: 0 },
            seasons: { inserted: 0, updated: 0 },
            matches: { inserted: 0, updated: 0, failed: 0 }
        };
    }

    async initialize() {
        if (!db.isConnected) {
            await db.initialize();
        }
    }

    /**
     * Collect all matches for a specific date
     */
    async collectForDate(date) {
        const startTime = Date.now();
        console.log(`\n📅 Collecting ALL matches for: ${date}`);
        console.log('═'.repeat(60));

        try {
            await this.initialize();

            // Fetch from Sofascore API
            const endpoint = SOFASCORE_CONFIG.ENDPOINTS.SCHEDULED_EVENTS(date);
            console.log(`🌐 Fetching: ${SOFASCORE_CONFIG.BASE_URL}${endpoint}`);
            

            const data = await httpClient.get(endpoint);
             
            if (!data || !data.events || data.events.length === 0) {
                console.log(`⚠️  No events found for ${date}`);
                return this.summarize(startTime);
            }

            const events = data.events;
            console.log(`📊 Found ${events.length} events for ${date}\n`);

            // Process events in batches to avoid overwhelming the database
            const batchSize = 20;
            for (let i = 0; i < events.length; i += batchSize) {
                const batch = events.slice(i, i + batchSize);
                console.log(`  Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(events.length / batchSize)} (${batch.length} events)...`);
                
                for (const event of batch) {
                    try {
                        await this.processEvent(event);
                    } catch (error) {
                        this.stats.matches.failed++;
                        console.error(`    ❌ Failed event ${event.id}: ${error.message}`);
                    }
                }
                
                // Rate limiting between batches
                if (i + batchSize < events.length) {
                    await this.delay(1000);
                }
            }

            return this.summarize(startTime, events.length);

        } catch (error) {
            console.error(`\n❌ Failed to collect events for ${date}:`, error.message);
            await this.logIngestion('FAILED', events?.length || 0, Date.now() - startTime, error.message);
            throw error;
        } finally {
            await db.close();
        }
    }

    /**
     * Process a single event and all its related data
     */
    async processEvent(event) {
    const tournamentId = await this.upsertTournament(event.tournament);
    const homeTeamId = await this.upsertTeam(event.homeTeam);
    const awayTeamId = await this.upsertTeam(event.awayTeam);
    const seasonId = await this.upsertSeason(tournamentId, event.season);

    // ⚡ Store round info for this tournament
    if (tournamentId && event.roundInfo?.round) {
        await this.updateTournamentRound(tournamentId, event.roundInfo.round);
    }

    if (tournamentId && homeTeamId && awayTeamId) {
        await this.upsertMatch(event, tournamentId, seasonId, homeTeamId, awayTeamId);
    }
}

    /**
     * Update tournament with current round info
     */
    async updateTournamentRound(tournamentId, round) {
        await db.query(
            `UPDATE tournaments SET current_round = ? WHERE id = ? AND (current_round IS NULL OR current_round < ?)`,
            [round, tournamentId, round]
        );
    }
 async collectForTournament(t) {
    console.log(`\n   🏆 ${t.tournament_name} - ${t.season_name}`);
    
    // ⚡ Get current round from tournaments table (stored by scheduledEvents)
    const tournRow = await db.query('SELECT current_round FROM tournaments WHERE id = ?', [t.tournament_id]);
    const currentRound = tournRow[0]?.current_round || 0;
    
    if (currentRound === 0) {
        // Fallback: fetch rounds from API if not stored
        const roundsData = await this.getRounds(t.unique_tournament_id, t.sofascore_season_id);
        if (!roundsData) return { success: false };
        const cr = roundsData.currentRound;
        
        // Store for next time
        await db.query('UPDATE tournaments SET current_round = ? WHERE id = ?', [cr, t.tournament_id]);
        
        return this.fetchRounds(t, cr);
    }
    
    console.log(`      📋 Current round: ${currentRound} (from DB)`);
    return this.fetchRounds(t, currentRound);
}

async fetchRounds(t, currentRound) {
    // Get current round + last 2 rounds
    const roundsToFetch = [];
    for (let r = Math.max(1, currentRound - 2); r <= currentRound; r++) {
        roundsToFetch.push(r);
    }

    console.log(`      📋 Fetching rounds: ${roundsToFetch.join(', ')}`);

    let totalInserted = 0, totalUpdated = 0;

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
        }
        await this.delay(2000);
    }

    console.log(`      ✅ +${totalInserted} new, ${totalUpdated} updated`);
    return { success: true, inserted: totalInserted, updated: totalUpdated };
}
     /**
     * Upsert Tournament - Fixed country/alpha extraction
     */
    async upsertTournament(tournamentData) {
        if (!tournamentData?.uniqueTournament?.id) return null;

        const t = tournamentData.uniqueTournament;
        const uniqueId = t.id;
        const categoryId = tournamentData.id || null;
        
        // ⚡ FIX: Country comes from category.country, not t.country
        const countryName = tournamentData.category?.country?.name || t.country?.name || null;
        const countryAlpha2 = tournamentData.category?.country?.alpha2 || t.country?.alpha2 || null;
        const countryAlpha3 = tournamentData.category?.country?.alpha3 || null;
        
        const existing = await db.query(
            'SELECT id FROM tournaments WHERE sofascore_tournament_id = ?',
            [uniqueId]
        );

        if (existing.length > 0) {
            await db.query(
                `UPDATE tournaments SET 
                name = ?, slug = ?, country = ?, country_code = ?, 
                category = ?, unique_tournament_id = ?, category_tournament_id = ?,
                updated_at = NOW()
                WHERE id = ?`,
                [
                    t.name || 'Unknown',
                    t.slug || '',
                    countryName,
                    countryAlpha2,        // alpha2 e.g., "EN"
                    tournamentData.category?.name || null,
                    uniqueId,
                    categoryId,
                    existing[0].id
                ]
            );
            this.stats.tournaments.updated++;
            return existing[0].id;
        } else {
            const result = await db.query(
                `INSERT INTO tournaments 
                (sofascore_tournament_id, unique_tournament_id, category_tournament_id, 
                name, slug, country, country_code, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uniqueId, uniqueId, categoryId, t.name || 'Unknown', t.slug || '',
                countryName, countryAlpha2, tournamentData.category?.name || null]
            );
            this.stats.tournaments.inserted++;
            return result.insertId;
        }
    }

    /**
     * Upsert Team - Fixed country/alpha extraction
     */
    async upsertTeam(teamData) {
        if (!teamData?.id) return null;

        const existing = await db.query(
            'SELECT id FROM teams WHERE sofascore_team_id = ?',
            [teamData.id]
        );

        const name = teamData.name || 'Unknown Team';
        const shortName = teamData.shortName || name.substring(0, 3).toUpperCase();
        
        // ⚡ FIX: country.alpha2, not just country.name
        const countryName = teamData.country?.name || null;
        const countryCode = teamData.country?.alpha2 || teamData.country?.alpha3 || null;

        if (existing.length > 0) {
            await db.query(
                `UPDATE teams SET 
                name = ?, short_name = ?, slug = ?, country = ?, country_code = ?,
                updated_at = NOW()
                WHERE id = ?`,
                [name, shortName, teamData.slug || '', countryName, countryCode, existing[0].id]
            );
            this.stats.teams.updated++;
            return existing[0].id;
        } else {
            const result = await db.query(
                `INSERT INTO teams 
                (sofascore_team_id, name, short_name, slug, country, country_code)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [teamData.id, name, shortName, teamData.slug || '', countryName, countryCode]
            );
            this.stats.teams.inserted++;
            return result.insertId;
        }
    }

        
    /**
     * Upsert Season
     */
    async upsertSeason(dbTournamentId, seasonData) {
    if (!seasonData?.id || !dbTournamentId) return null;

    // ⚡ FIX: Match on BOTH tournament_id AND sofascore_season_id
    const existing = await db.query(
        'SELECT id FROM seasons WHERE tournament_id = ? AND sofascore_season_id = ?',
        [dbTournamentId, seasonData.id]
    );

    if (existing.length > 0) {
        await db.query(
            `UPDATE seasons SET name = ?, year = ?, is_current = ?, 
             unique_tournament_id = (SELECT unique_tournament_id FROM tournaments WHERE id = ?),
             updated_at = NOW() 
             WHERE id = ?`,
            [seasonData.name || 'Unknown Season', seasonData.year || null, 0, dbTournamentId, existing[0].id]
        );
        this.stats.seasons.updated++;
        return existing[0].id;
    } else {
        const result = await db.query(
            `INSERT INTO seasons (tournament_id, sofascore_season_id, name, year, is_current, unique_tournament_id)
            SELECT ?, ?, ?, ?, 0, unique_tournament_id FROM tournaments WHERE id = ?`,
            [dbTournamentId, seasonData.id, seasonData.name || 'Unknown Season', seasonData.year || null, dbTournamentId]
        );
        this.stats.seasons.inserted++;
        return result.insertId;
    }
}

    /**
     * Upsert Match - The core function that saves match data
     */
    async upsertMatch(event, tournamentId, seasonId, homeTeamId, awayTeamId) {
    const matchDateTime = event.startTimestamp 
        ? new Date(event.startTimestamp * 1000)
        : null;
    const matchDate = matchDateTime 
        ? matchDateTime.toISOString().split('T')[0]
        : null;

    const homeScore = event.homeScore?.current ?? null;
    const awayScore = event.awayScore?.current ?? null;
    const homeScoreHT = event.homeScore?.period1 ?? null;
    const awayScoreHT = event.awayScore?.period1 ?? null;

    const status = event.status?.code || 0;
    const statusDesc = event.status?.description || null;
    const roundInfo = event.roundInfo?.round ? `Round ${event.roundInfo.round}` : null;
    const uniqueTournamentId = event.tournament?.uniqueTournament?.id || null;

    const hasLineups = event.hasEventPlayerStatistics || event.hasXg ? 1 : 0;
    const hasStatistics = event.hasXg || event.hasEventPlayerStatistics ? 1 : 0;
    const hasIncidents = event.hasGlobalHighlights || event.status?.code === 100 ? 1 : 0;

    // ⚡ PRIMARY KEY: sofascore_match_id should be unique
    // Check if match exists by sofascore_match_id first
    let existing = await db.query(
        'SELECT id, status, home_score, away_score, custom_id FROM matches WHERE sofascore_match_id = ?',
        [event.id]
    );

    // If not found, check for potential duplicates by custom_id + teams (postponed matches)
    if (existing.length === 0 && event.customId) {
        // Check if there's a match with same custom_id, teams, but different sofascore_match_id
        // This handles the case where API might change the match ID (unlikely but possible)
        const potentialDuplicate = await db.query(
            `SELECT id, sofascore_match_id, status 
             FROM matches 
             WHERE custom_id = ? 
               AND home_team_id = ? 
               AND away_team_id = ?
               AND match_date = ?
             LIMIT 1`,
            [event.customId, homeTeamId, awayTeamId, matchDate]
        );
        
        if (potentialDuplicate.length > 0) {
            console.log(`      🔄 Match may have been rescheduled. Old ID: ${potentialDuplicate[0].sofascore_match_id}, New ID: ${event.id}`);
            existing = potentialDuplicate;
            
            // Update the sofascore_match_id to the new one
            await db.query(
                'UPDATE matches SET sofascore_match_id = ? WHERE id = ?',
                [event.id, existing[0].id]
            );
        }
    }

    if (existing.length > 0) {
        // UPDATE existing match
        const current = existing[0];
        const statusChanged = current.status !== status;
        const scoreChanged = current.home_score !== homeScore || current.away_score !== awayScore;
        
        if (statusChanged || scoreChanged) {
            await db.query(
                `UPDATE matches SET
                tournament_id = ?, season_id = ?, home_team_id = ?, away_team_id = ?,
                unique_tournament_id = ?,
                match_date = ?, match_datetime = ?, status = ?, status_description = ?,
                round_info = ?, home_score = ?, away_score = ?,
                home_score_halftime = ?, away_score_halftime = ?,
                custom_id = COALESCE(custom_id, ?),
                has_lineups = CASE WHEN has_lineups = 1 THEN 1 ELSE has_lineups END,
                has_statistics = CASE WHEN has_statistics = 1 THEN 1 ELSE has_statistics END,
                has_incidents = CASE WHEN has_incidents = 1 THEN 1 ELSE has_incidents END,
                updated_at = NOW()
                WHERE id = ?`,
                [
                    tournamentId, seasonId, homeTeamId, awayTeamId,
                    uniqueTournamentId,
                    matchDate, matchDateTime, status, statusDesc,
                    roundInfo, homeScore, awayScore,
                    homeScoreHT, awayScoreHT,
                    event.customId || null,
                    current.id
                ]
            );
            this.stats.matches.updated++;
            
            if (statusChanged && [100, 101, 102].includes(status)) {
                console.log(`      ✅ Match finished! Final score: ${homeScore}-${awayScore}`);
            }
        }
    } else {
        // INSERT new match
        try {
            // Verify sofascore_match_id is not already used (safety check)
            const idCheck = await db.query(
                'SELECT id FROM matches WHERE sofascore_match_id = ?',
                [event.id]
            );
            
            if (idCheck.length > 0) {
                console.log(`      ⚠️ Match ID ${event.id} already exists, updating instead`);
                await db.query(
                    `UPDATE matches SET 
                     home_score = ?, away_score = ?, status = ?, status_description = ?,
                     updated_at = NOW()
                     WHERE sofascore_match_id = ?`,
                    [homeScore, awayScore, status, statusDesc, event.id]
                );
                this.stats.matches.updated++;
                return;
            }
            
            // Insert new match
            await db.query(
                `INSERT INTO matches 
                (sofascore_match_id, custom_id, tournament_id, unique_tournament_id, season_id,
                home_team_id, away_team_id, match_date, match_datetime,
                status, status_description, round_info,
                home_score, away_score, home_score_halftime, away_score_halftime,
                has_lineups, has_statistics, has_incidents)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.id,
                    event.customId || null,
                    tournamentId,
                    uniqueTournamentId,
                    seasonId,
                    homeTeamId,
                    awayTeamId,
                    matchDate,
                    matchDateTime,
                    status,
                    statusDesc,
                    roundInfo,
                    homeScore,
                    awayScore,
                    homeScoreHT,
                    awayScoreHT,
                    hasLineups,
                    hasStatistics,
                    hasIncidents
                ]
            );
            this.stats.matches.inserted++;
            
            if (this.stats.matches.inserted % 10 === 0) {
                console.log(`      📝 Inserted ${this.stats.matches.inserted} new matches so far`);
            }
            
        } catch (error) {
            // Handle duplicate entry errors
            if (error.code === 'ER_DUP_ENTRY') {
                if (error.message.includes('custom_id')) {
                    // Custom ID duplicate - this is expected for home/away legs
                    // Just log and continue, don't count as failure
                    console.log(`      ℹ️ Duplicate custom_id ${event.customId} (expected for H2H legs)`);
                    this.stats.matches.updated++; // Count as "updated" since it's not a failure
                } else if (error.message.includes('sofascore_match_id')) {
                    // This shouldn't happen with our safety check above
                    console.log(`      ⚠️ Duplicate sofascore_match_id ${event.id} - updating instead`);
                    await db.query(
                        `UPDATE matches SET 
                         home_score = ?, away_score = ?, status = ?, status_description = ?,
                         updated_at = NOW()
                         WHERE sofascore_match_id = ?`,
                        [homeScore, awayScore, status, statusDesc, event.id]
                    );
                    this.stats.matches.updated++;
                } else {
                    console.error(`      ❌ Duplicate entry error: ${error.message}`);
                    this.stats.matches.failed++;
                }
            } else {
                console.error(`      ❌ Insert failed: ${error.message}`);
                this.stats.matches.failed++;
            }
        }
    }
}

    /**
     * Collect for a range of dates
     */
    async collectDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const results = [];

        console.log(`\n📅 Collecting matches from ${startDate} to ${endDate}\n`);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            try {
                const result = await this.collectForDate(dateStr);
                results.push({ date: dateStr, ...result });
            } catch (error) {
                console.error(`Failed for ${dateStr}: ${error.message}`);
                results.push({ date: dateStr, error: error.message });
            }
            
            // Re-initialize DB connection for next date
            await this.initialize();
            await this.delay(2000);
        }

        return results;
    }

    /**
     * Collect for next N days
     */
    async collectNextDays(days = 7) {
        const today = new Date();
        const endDate = new Date();
        endDate.setDate(today.getDate() + days);
        
        return this.collectDateRange(
            today.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
        );
    }

    /**
     * Log ingestion to database
     */
    async logIngestion(status, totalEvents, durationMs, errorMessage = null) {
        try {
            if (!db.isConnected) await this.initialize();
            
            await db.query(
                `INSERT INTO ingestion_logs 
                (collector_name, status, records_processed, records_inserted, 
                 records_updated, records_failed, error_message, processing_time_ms,
                 started_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    this.collectorName,
                    status,
                    totalEvents,
                    this.stats.matches.inserted,
                    this.stats.matches.updated,
                    this.stats.matches.failed,
                    errorMessage?.substring(0, 500) || null,
                    Math.round(durationMs)
                ]
            );
        } catch (error) {
            console.error('Failed to log ingestion:', error.message);
        }
    }

    /**
     * Print summary
     */
    summarize(startTime, totalEvents = 0) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log('\n' + '═'.repeat(60));
        console.log('📊 COLLECTION SUMMARY');
        console.log('═'.repeat(60));
        console.log(`   Events processed:  ${totalEvents}`);
        console.log(`   ─────────────────`);
        console.log(`   Tournaments:       +${this.stats.tournaments.inserted} inserted, ${this.stats.tournaments.updated} updated`);
        console.log(`   Teams:             +${this.stats.teams.inserted} inserted, ${this.stats.teams.updated} updated`);
        console.log(`   Seasons:           +${this.stats.seasons.inserted} inserted, ${this.stats.seasons.updated} updated`);
        console.log(`   Matches:           +${this.stats.matches.inserted} inserted, ${this.stats.matches.updated} updated, ${this.stats.matches.failed} failed`);
        console.log(`   ─────────────────`);
        console.log(`   Duration:          ${duration}s`);
        console.log('═'.repeat(60) + '\n');

        this.logIngestion('SUCCESS', totalEvents, Date.now() - startTime);

        return {
            totalEvents,
            duration: `${duration}s`,
            tournaments: this.stats.tournaments,
            teams: this.stats.teams,
            seasons: this.stats.seasons,
            matches: this.stats.matches
        };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI Entry Point
// CLI Entry Point
if (require.main === module) {
    const collector = new ScheduledEventsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            // ⚡ Check for flags properly
            if (args.includes('--range') && args.length >= 4) {
                const rangeIndex = args.indexOf('--range');
                const startDate = args[rangeIndex + 1];
                const endDate = args[rangeIndex + 2];
                console.log(`\n📅 Collecting matches from ${startDate} to ${endDate}\n`);
                const results = await collector.collectDateRange(startDate, endDate);
                console.log('\n✅ Range collection complete!');
                console.log(`   ${results.length} days processed`);
                
            } else if (args.includes('--days')) {
                const daysIndex = args.indexOf('--days');
                const days = parseInt(args[daysIndex + 1]) || 7;
                console.log(`\n📅 Collecting matches for next ${days} days...\n`);
                const results = await collector.collectNextDays(days);
                console.log('\n✅ Multi-day collection complete!');
                console.log(`   ${results.length} days processed`);
                
            } else if (args.includes('--today')) {
                const today = new Date().toISOString().split('T')[0];
                console.log(`\n📅 Collecting matches for today: ${today}\n`);
                await collector.collectForDate(today);
                
            } else if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
                // Specific date like 2026-05-10
                console.log(`\n📅 Collecting matches for: ${args[0]}\n`);
                await collector.collectForDate(args[0]);
                
            } else {
                // Default: collect today
                const today = new Date().toISOString().split('T')[0];
                console.log(`📅 No date specified, collecting for today: ${today}`);
                await collector.collectForDate(today);
            }
            
            process.exit(0);
        } catch (error) {
            console.error('\n❌ Fatal error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = new ScheduledEventsCollector();