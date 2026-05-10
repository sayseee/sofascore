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
        // 1. Handle Tournament
        const tournamentId = await this.upsertTournament(event.tournament);

        // 2. Handle Home Team
        const homeTeamId = await this.upsertTeam(event.homeTeam);

        // 3. Handle Away Team
        const awayTeamId = await this.upsertTeam(event.awayTeam);

        // 4. Handle Season
        const seasonId = await this.upsertSeason(tournamentId, event.season);

        // 5. Handle Match
        if (tournamentId && homeTeamId && awayTeamId) {
            await this.upsertMatch(event, tournamentId, seasonId, homeTeamId, awayTeamId);
        }
    }

    /**
     * Upsert Tournament
     */
    async upsertTournament(tournamentData) {
    if (!tournamentData?.uniqueTournament?.id) return null;

    const t = tournamentData.uniqueTournament;
    const uniqueId = t.id;
    const categoryId = tournamentData.id || null;
    
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
                t.country?.name || null,
                t.country?.alpha2 || null,
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
             t.country?.name || null, t.country?.alpha2 || null, tournamentData.category?.name || null]
        );
        this.stats.tournaments.inserted++;
        return result.insertId;
    }
}

    /**
     * Upsert Team
     */
    async upsertTeam(teamData) {
        if (!teamData?.id) return null;

        const existing = await db.query(
            'SELECT id FROM teams WHERE sofascore_team_id = ?',
            [teamData.id]
        );

        const name = teamData.name || 'Unknown Team';
        const shortName = teamData.shortName || name.substring(0, 3).toUpperCase();
        const country = teamData.country?.name || null;
        const countryCode = teamData.country?.alpha2 || null;

        if (existing.length > 0) {
            // Update
            await db.query(
                `UPDATE teams SET 
                name = ?, short_name = ?, slug = ?, country = ?, country_code = ?,
                updated_at = NOW()
                WHERE id = ?`,
                [name, shortName, teamData.slug || '', country, countryCode, existing[0].id]
            );
            this.stats.teams.updated++;
            return existing[0].id;
        } else {
            // Insert
            const result = await db.query(
                `INSERT INTO teams 
                (sofascore_team_id, name, short_name, slug, country, country_code)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [teamData.id, name, shortName, teamData.slug || '', country, countryCode]
            );
            this.stats.teams.inserted++;
            return result.insertId;
        }
    }

    /**
     * Upsert Season
     */
    async upsertSeason(tournamentId, seasonData) {
        if (!seasonData?.id || !tournamentId) return null;

        const existing = await db.query(
            'SELECT id FROM seasons WHERE tournament_id = ? AND sofascore_season_id = ?',
            [tournamentId, seasonData.id]
        );

        if (existing.length > 0) {
            await db.query(
                `UPDATE seasons SET name = ?, year = ?, updated_at = NOW() WHERE id = ?`,
                [seasonData.name || 'Unknown Season', seasonData.year || null, existing[0].id]
            );
            this.stats.seasons.updated++;
            return existing[0].id;
        } else {
            const result = await db.query(
                `INSERT INTO seasons (tournament_id, sofascore_season_id, name, year)
                VALUES (?, ?, ?, ?)`,
                [
                    tournamentId,
                    seasonData.id,
                    seasonData.name || 'Unknown Season',
                    seasonData.year || null
                ]
            );
            this.stats.seasons.inserted++;
            return result.insertId;
        }
    }

    /**
     * Upsert Match - The core function that saves match data
     */
    async upsertMatch(event, tournamentId, seasonId, homeTeamId, awayTeamId) {
        // Parse match date/time from timestamp
        const matchDateTime = event.startTimestamp 
            ? new Date(event.startTimestamp * 1000)
            : null;
        const matchDate = matchDateTime 
            ? matchDateTime.toISOString().split('T')[0]
            : null;

        // Current scores (may be null for scheduled matches)
        const homeScore = event.homeScore?.current ?? null;
        const awayScore = event.awayScore?.current ?? null;
        const homeScoreHT = event.homeScore?.period1 ?? null;
        const awayScoreHT = event.awayScore?.period1 ?? null;

        // Status
        const status = event.status?.code || 'scheduled';
        const statusDesc = event.status?.description || null;

        // Round info
        const roundInfo = event.roundInfo?.round 
            ? `Round ${event.roundInfo.round}` 
            : null;

        // Check if match already exists
        const existing = await db.query(
            'SELECT id, status, home_score, away_score FROM matches WHERE sofascore_match_id = ?',
            [event.id]
        );

        if (existing.length > 0) {
            const current = existing[0];
            
            // Only update if status changed or scores changed
            const statusChanged = current.status !== status;
            const scoreChanged = current.home_score !== homeScore || current.away_score !== awayScore;
            
            if (statusChanged || scoreChanged) {
                await db.query(
                    `UPDATE matches SET
                    tournament_id = ?, season_id = ?, home_team_id = ?, away_team_id = ?,
                    match_date = ?, match_datetime = ?, status = ?, status_description = ?,
                    round_info = ?, home_score = ?, away_score = ?,
                    home_score_halftime = ?, away_score_halftime = ?,
                    custom_id = COALESCE(custom_id, ?),
                    updated_at = NOW()
                    WHERE id = ?`,
                    [
                        tournamentId, seasonId, homeTeamId, awayTeamId,
                        matchDate, matchDateTime, status, statusDesc,
                        roundInfo, homeScore, awayScore,
                        homeScoreHT, awayScoreHT,
                        event.customId || null,
                        current.id
                    ]
                );
                this.stats.matches.updated++;
                
                if (scoreChanged) {
                    console.log(`    🔄 Updated: ${event.homeTeam?.name || '?'} ${homeScore}-${awayScore} ${event.awayTeam?.name || '?'} (${status})`);
                }
            }
            // If no changes, don't count as updated
        } else {
            // Insert new match
            await db.query(
                `INSERT INTO matches 
                (sofascore_match_id, custom_id, tournament_id, season_id,
                 home_team_id, away_team_id, match_date, match_datetime,
                 status, status_description, round_info,
                 home_score, away_score, home_score_halftime, away_score_halftime)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.id,
                    event.customId || null,
                    tournamentId,
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
                    awayScoreHT
                ]
            );
            this.stats.matches.inserted++;
            
            console.log(`    ➕ Inserted: ${event.homeTeam?.name || '?'} vs ${event.awayTeam?.name || '?'} (${matchDate})`);
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
if (require.main === module) {
    const collector = new ScheduledEventsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--days')) {
                // Collect next N days
                const daysIndex = args.indexOf('--days');
                const days = parseInt(args[daysIndex + 1]) || 7;
                console.log(`\n📅 Collecting matches for next ${days} days...\n`);
                const results = await collector.collectNextDays(days);
                console.log('\n✅ Multi-day collection complete!');
                console.log(`   ${results.length} days processed`);
            } 
            else if (args.includes('--range') && args.length >= 4) {
                // Collect date range
                const rangeIndex = args.indexOf('--range');
                const startDate = args[rangeIndex + 1];
                const endDate = args[rangeIndex + 2];
                const results = await collector.collectDateRange(startDate, endDate);
                console.log('\n✅ Range collection complete!');
            }
            else if (args.includes('--today')) {
                // Force today
                const today = new Date().toISOString().split('T')[0];
                await collector.collectForDate(today);
            }
            else if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
                // Specific date provided
                await collector.collectForDate(args[0]);
            }
            else {
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