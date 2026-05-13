/**
 * Season Events Collector (Direct Events endpoint)
 * Endpoint: /tournament/{tournamentId}/season/{seasonId}/events
 * 
 * Fetches ALL matches for a tournament season in a single API call
 * Optimized rate limiting to prevent 403 errors
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class SeasonEventsCollector {
    constructor() {
        this.collectorName = 'season_events_collector';
        this.stats = {
            tournaments: { inserted: 0, updated: 0 },
            teams: { inserted: 0, updated: 0 },
            seasons: { inserted: 0, updated: 0 },
            matches: { inserted: 0, updated: 0, failed: 0, rateLimited: 0, skipped: 0 }
        };
        
        // More conservative rate limiting
        this.config = {
            requestsPerMinute: 10,      // Conservative rate
            delayBetweenRequests: 6000,  // 6 seconds between requests
            retryDelay: 15000,           // 15 seconds retry delay
            maxRetries: 2,               // Max 2 retries
            batchSize: 2,                // Process 2 tournaments at a time
            batchPause: 90000,           // 90 seconds between batches
            errorCooldown: 180000,       // 3 minutes cooldown on errors
            requestSpread: 3000          // Spread requests over time
        };
        
        this.requestTimestamps = [];
        this.isRateLimited = false;
        this.errorCount = 0;
        this.unavailableSeasons = new Set(); // Cache for 404s
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { 
        return new Promise(r => setTimeout(r, ms)); 
    }

    /**
     * Smart rate limiter with jitter to avoid pattern detection
     */
    async waitForRateLimit() {
        if (this.isRateLimited) {
            console.log(`      🚫 In cooldown period, waiting...`);
            await this.delay(5000);
            return;
        }
        
        const now = Date.now();
        const windowStart = now - 60000; // Last 60 seconds
        
        // Clean old timestamps
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > windowStart);
        
        if (this.requestTimestamps.length >= this.config.requestsPerMinute) {
            const oldest = this.requestTimestamps[0];
            const waitTime = (oldest + 60000) - now;
            if (waitTime > 0) {
                const jitter = Math.random() * 2000; // Add random jitter
                const totalWait = waitTime + jitter;
                console.log(`      ⏸️ Rate limit (${this.requestTimestamps.length}/${this.config.requestsPerMinute}), waiting ${Math.ceil(totalWait/1000)}s...`);
                await this.delay(totalWait);
            }
        }
        
        this.requestTimestamps.push(now);
    }

    /**
     * Make API request with retry logic for 403/429 errors
     */
    async makeRequestWithRetry(endpoint, retryCount = 0) {
        try {
            await this.waitForRateLimit();
            const response = await httpClient.get(endpoint);
            this.errorCount = 0;
            return response;
        } catch (error) {
            const isRateLimit = error.message.includes('403') || 
                               error.message.includes('429') || 
                               error.message.includes('too many requests');
            
            if (isRateLimit && retryCount < this.config.maxRetries) {
                this.stats.rateLimited++;
                this.errorCount++;
                
                // Exponential backoff
                const waitTime = this.config.retryDelay * Math.pow(2, retryCount);
                console.log(`      ⚠️ Rate limited, retry ${retryCount + 1}/${this.config.maxRetries} in ${waitTime/1000}s...`);
                
                // If this is the second retry, trigger cooldown
                if (retryCount >= 1) {
                    this.isRateLimited = true;
                    setTimeout(() => { this.isRateLimited = false; }, this.config.errorCooldown);
                }
                
                await this.delay(waitTime);
                return this.makeRequestWithRetry(endpoint, retryCount + 1);
            }
            
            throw error;
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
        
        const countryName = tournamentData.category?.country?.name || t.country?.name || null;
        const countryAlpha2 = tournamentData.category?.country?.alpha2 || t.country?.alpha2 || null;
        
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
                    countryAlpha2,
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
     * Upsert Match - Handles matches that may not have scores yet
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

        const existing = await db.query(
            'SELECT id, status, home_score, away_score FROM matches WHERE sofascore_match_id = ?',
            [event.id]
        );

        if (existing.length > 0) {
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
                    has_lineups = ?, has_statistics = ?, has_incidents = ?,
                    updated_at = NOW()
                    WHERE id = ?`,
                    [
                        tournamentId, seasonId, homeTeamId, awayTeamId,
                        uniqueTournamentId,
                        matchDate, matchDateTime, status, statusDesc,
                        roundInfo, homeScore, awayScore,
                        homeScoreHT, awayScoreHT,
                        event.customId || null,
                        hasLineups, hasStatistics, hasIncidents,
                        current.id
                    ]
                );
                this.stats.matches.updated++;
            }
        } else {
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
        }
    }

    /**
     * Collect ALL events for a tournament season in ONE API call
     */
    async collectForSeason(tournamentId, seasonId, dbTournamentId, dbSeasonId, tournamentName, seasonName) {
    const startTime = Date.now();
    try {
        await this.initialize();
        
        const endpoint = `/tournament/${tournamentId}/season/${seasonId}/events`;
        
        // Use retry logic for the API call
        const response = await this.makeRequestWithRetry(endpoint);
        
        if (!response || !response.events || response.events.length === 0) {
            console.log(`      ⚠️ No events found for this season`);
            return { success: false, error: 'No events', skipped: true };
        }

        const events = response.events;
        const totalSeasonMatches = events.length;
        console.log(`      📊 Season has ${totalSeasonMatches} total matches`);
        
        // Check existing matches count
        let existingMatchCount = 0;
        let needFullUpdate = false;
        
        if (dbTournamentId && dbSeasonId) {
            const existingMatches = await db.query(
                'SELECT COUNT(*) as count FROM matches WHERE tournament_id = ? AND season_id = ?',
                [dbTournamentId, dbSeasonId]
            );
            existingMatchCount = existingMatches[0]?.count || 0;
            
            console.log(`      📊 Already have ${existingMatchCount}/${totalSeasonMatches} matches in DB`);
            
            // If we already have all matches, skip (but still check for updates)
            if (existingMatchCount >= totalSeasonMatches && existingMatchCount > 0) {
                // Still need to update existing matches for score/status changes
                console.log(`      🔄 Updating existing matches (scores, status, etc.)...`);
                needFullUpdate = true; // Process all to update statuses
            } else if (existingMatchCount > 0) {
                console.log(`      🔄 Partial data found, fetching missing matches...`);
                needFullUpdate = true;
            } else {
                console.log(`      🆕 New season, fetching all matches...`);
                needFullUpdate = true;
            }
        } else {
            console.log(`      🆕 New tournament/season, fetching all matches...`);
            needFullUpdate = true;
        }
        
        if (!needFullUpdate) {
            console.log(`      ✅ Season already complete, skipping API call`);
            return { success: true, total: totalSeasonMatches, processed: 0, skipped: totalSeasonMatches };
        }
        
        let processed = 0;
        
        for (const event of events) {
            try {
                const homeTeamId = await this.upsertTeam(event.homeTeam);
                const awayTeamId = await this.upsertTeam(event.awayTeam);
                
                if (dbTournamentId && homeTeamId && awayTeamId && dbSeasonId) {
                    await this.upsertMatch(event, dbTournamentId, dbSeasonId, homeTeamId, awayTeamId);
                    processed++;
                } else {
                    this.stats.matches.failed++;
                }
            } catch (error) {
                this.stats.matches.failed++;
                console.error(`         ❌ Failed match ${event.id}: ${error.message}`);
            }
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`      ✅ Processed ${processed}/${totalSeasonMatches} matches | +${this.stats.matches.inserted} new, ${this.stats.matches.updated} updated (${duration}s)`);
        
        return { success: true, total: totalSeasonMatches, processed };

    } catch (error) {
        // Handle 404 specifically - season doesn't exist yet
        if (error.message.includes('404')) {
            console.log(`      ⏭️ Season endpoint not available yet (404) - skipping`);
            return { success: false, error: 'Season not available', skipped: true };
        }
        if (error.message.includes('403')) {
            console.log(`      🚫 403 Forbidden - Rate limited`);
            this.isRateLimited = true;
            setTimeout(() => { this.isRateLimited = false; }, this.config.errorCooldown);
            return { success: false, error: 'Rate limited', retry: true };
        }
        console.error(`      ❌ ${error.message}`);
        return { success: false, error: error.message };
    }
}

    /**
     * Get active tournaments with priority scoring
     */
    async getActiveTournaments() {
        const tournaments = await db.query(
            `SELECT DISTINCT
                t.id AS tournament_id,
                t.unique_tournament_id,
                t.name AS tournament_name,
                t.priority_score,
                s.id AS season_id,
                s.sofascore_season_id,
                s.name AS season_name,
                s.is_current,
                COUNT(m.id) as match_count,
                MAX(m.match_date) as last_match_date
            FROM tournaments t
            JOIN seasons s ON t.id = s.tournament_id
            LEFT JOIN matches m ON m.tournament_id = t.id AND m.season_id = s.id
            WHERE s.is_current = 1 
               OR m.match_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
               OR m.match_date >= CURDATE()
            GROUP BY t.id, t.unique_tournament_id, t.name, t.priority_score,
                     s.id, s.sofascore_season_id, s.name, s.is_current
            ORDER BY 
                t.priority_score DESC,
                match_count DESC,
                last_match_date DESC
            LIMIT 50`
        );
        
        return tournaments;
    }

    /**
     * Collect current seasons with smart batching and rate limiting
     */
    async collectCurrentSeasons() {
        const startTime = Date.now();
        await this.initialize();
        
        this.stats = {
            tournaments: { inserted: 0, updated: 0 },
            teams: { inserted: 0, updated: 0 },
            seasons: { inserted: 0, updated: 0 },
            matches: { inserted: 0, updated: 0, failed: 0, rateLimited: 0 }
        };
        
        // Get tournaments with priority scoring
        const tournaments = await this.getActiveTournaments();

        if (tournaments.length === 0) {
            console.log('\n⚠️ No active tournaments found.\n');
            await db.close();
            return [];
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📅 ACTIVE TOURNAMENTS: ${tournaments.length} tournaments`);
        console.log(`${'═'.repeat(60)}\n`);

        let processed = 0;
        let consecutiveErrors = 0;
        
        // Process in batches with pauses
        for (let i = 0; i < tournaments.length; i += this.config.batchSize) {
            if (this.isRateLimited) {
                console.log(`\n   🚫 Rate limited, cooling down for ${this.config.errorCooldown/1000}s...`);
                await this.delay(this.config.errorCooldown);
                this.isRateLimited = false;
                consecutiveErrors = 0;
            }
            
            const batch = tournaments.slice(i, Math.min(i + this.config.batchSize, tournaments.length));
            console.log(`\n📦 BATCH ${Math.floor(i/this.config.batchSize)+1}/${Math.ceil(tournaments.length/this.config.batchSize)} (${batch.length} tournaments)`);
            console.log(`${'─'.repeat(40)}`);
            
            for (let j = 0; j < batch.length; j++) {
                const t = batch[j];
                console.log(`\n   [${i+j+1}/${tournaments.length}] ${t.tournament_name} - ${t.season_name}`);
                
                const result = await this.collectForSeason(
                    t.unique_tournament_id,
                    t.sofascore_season_id,
                    t.tournament_id,
                    t.season_id,
                    t.tournament_name,
                    t.season_name
                );
                
                if (result.success) {
                    processed++;
                    consecutiveErrors = 0;
                } else {
                    consecutiveErrors++;
                    
                    // If we get multiple errors, increase delay
                    if (consecutiveErrors >= 3) {
                        console.log(`   ⚠️ Multiple errors detected, pausing for 30s...`);
                        await this.delay(30000);
                    }
                }
                
                // Delay between tournaments (unless it's the last in batch)
                if (j < batch.length - 1) {
                    await this.delay(this.config.delayBetweenRequests);
                }
            }
            
            // Pause between batches
            if (i + this.config.batchSize < tournaments.length) {
                console.log(`\n   ⏸️ Batch complete, pausing ${this.config.batchPause/1000}s before next batch...`);
                await this.delay(this.config.batchPause);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`\n${'═'.repeat(60)}`);
        console.log('📊 COLLECTION SUMMARY');
        console.log('═'.repeat(60));
        console.log(`   Tournaments:       +${this.stats.tournaments.inserted} inserted, ${this.stats.tournaments.updated} updated`);
        console.log(`   Teams:             +${this.stats.teams.inserted} inserted, ${this.stats.teams.updated} updated`);
        console.log(`   Seasons:           +${this.stats.seasons.inserted} inserted, ${this.stats.seasons.updated} updated`);
        console.log(`   Matches:           +${this.stats.matches.inserted} inserted, ${this.stats.matches.updated} updated, ${this.stats.matches.failed} failed`);
        console.log(`   Rate Limited:      ${this.stats.rateLimited} times`);
        console.log(`   ─────────────────`);
        console.log(`   Processed:         ${processed}/${tournaments.length} tournaments`);
        console.log(`   Duration:          ${duration}s`);
        console.log('═'.repeat(60) + '\n');

        await db.close();
        return this.stats;
    }

 /**
 * Collect for a specific date - With tournament/season discovery and direct collection
 */
async collectForDate(date, specificTournamentId = null, specificSeasonId = null) {
    const startTime = Date.now();
    await this.initialize();
    
    // Reset rate limiting state
    this.isRateLimited = false;
    this.errorCount = 0;
    this.requestTimestamps = [];
    
    this.stats = {
        tournaments: { inserted: 0, updated: 0 },
        teams: { inserted: 0, updated: 0 },
        seasons: { inserted: 0, updated: 0 },
        matches: { inserted: 0, updated: 0, failed: 0, rateLimited: 0, skipped: 0, complete: 0, apiCalls: 0 }
    };
    
    // Store discovered tournament-season pairs for logging
    const discoveredPairs = [];
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📅 COLLECTING FROM: ${date}`);
    console.log(`${'═'.repeat(60)}\n`);
    
    try {
        let tournaments = [];
        
        // If specific tournament/season provided, use that directly
        if (specificTournamentId && specificSeasonId) {
            console.log(`🎯 Direct collection mode:`);
            console.log(`   Category Tournament ID: ${specificTournamentId}`);
            console.log(`   Season ID: ${specificSeasonId}`);
            
            // Try to get tournament info from DB first
            let tournamentName = `Tournament ${specificTournamentId}`;
            let uniqueTournamentId = null;
            let tournamentData = null;
            let seasonData = null;
            let dbTournamentId = null;
            
            // Check if tournament exists in DB by category_tournament_id
            const existingTournament = await db.query(
                'SELECT * FROM tournaments WHERE category_tournament_id = ?',
                [specificTournamentId]
            );
            
            if (existingTournament.length > 0) {
                dbTournamentId = existingTournament[0].id;
                tournamentName = existingTournament[0].name;
                uniqueTournamentId = existingTournament[0].unique_tournament_id;
                console.log(`   ✅ Found tournament in DB: ${tournamentName} (ID: ${dbTournamentId})`);
            } else {
                // Try to fetch from API to get tournament info
                try {
                    const tournamentInfoEndpoint = `/tournament/${specificTournamentId}`;
                    const tournamentInfo = await this.makeRequestWithRetry(tournamentInfoEndpoint);
                    this.stats.apiCalls++;
                    
                    if (tournamentInfo) {
                        uniqueTournamentId = tournamentInfo?.uniqueTournament?.id;
                        tournamentName = tournamentInfo?.uniqueTournament?.name || 
                                        tournamentInfo?.name || 
                                        tournamentName;
                        tournamentData = tournamentInfo;
                        console.log(`   ✅ Fetched tournament: ${tournamentName}`);
                        console.log(`   Unique Tournament ID: ${uniqueTournamentId}`);
                    }
                } catch (error) {
                    console.log(`   ⚠️ Could not fetch tournament info: ${error.message}`);
                }
            }
            
            // Try to get season info
            try {
                const seasonInfoEndpoint = `/tournament/${specificTournamentId}/season/${specificSeasonId}`;
                const seasonInfo = await this.makeRequestWithRetry(seasonInfoEndpoint);
                this.stats.apiCalls++;
                
                if (seasonInfo) {
                    seasonData = seasonInfo;
                    console.log(`   ✅ Found season: ${seasonInfo.name || specificSeasonId}`);
                }
            } catch (error) {
                console.log(`   ⚠️ Could not fetch season info: ${error.message}`);
            }
            
            tournaments = [{
                category_tournament_id: parseInt(specificTournamentId),
                unique_tournament_id: uniqueTournamentId,
                season_id: parseInt(specificSeasonId),
                tournament_name: tournamentName,
                season_name: seasonData?.name || `Season ${specificSeasonId}`,
                tournament_data: tournamentData,
                season_data: seasonData,
                db_tournament_id: dbTournamentId  // Pass existing DB ID if found
            }];
            
        } else {
            // Normal discovery mode - get scheduled events (same as before)
            // ... (keep existing discovery code)
        }
        
        // Collection phase
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🔄 COLLECTING MATCH DATA`);
        console.log(`${'═'.repeat(60)}\n`);
        
        let processedTournaments = 0;
        let skippedTournaments = 0;
        let totalMatchesFetched = 0;
        
        for (let i = 0; i < tournaments.length; i++) {
            const tournament = tournaments[i];
            
            console.log(`\n${'═'.repeat(40)}`);
            console.log(`   [${i+1}/${tournaments.length}] ${tournament.tournament_name}`);
            console.log(`   Season: ${tournament.season_name}`);
            console.log(`   Category Tournament ID: ${tournament.category_tournament_id}`);
            console.log(`   Season ID: ${tournament.season_id}`);
            
            // Get or create tournament in DB using category_tournament_id
            let dbTournamentId = tournament.db_tournament_id;
            let dbSeasonId = null;
            let existingMatchCount = 0;
            let completedMatchesCount = 0;
            
            // If we don't have DB tournament ID, try to find or create it
            if (!dbTournamentId) {
                // First try to find by category_tournament_id
                const existingByCategory = await db.query(
                    'SELECT id FROM tournaments WHERE category_tournament_id = ?',
                    [tournament.category_tournament_id]
                );
                
                if (existingByCategory.length > 0) {
                    dbTournamentId = existingByCategory[0].id;
                    console.log(`   ✅ Found existing tournament by category_tournament_id: ${dbTournamentId}`);
                } else if (tournament.unique_tournament_id) {
                    // Try by unique_tournament_id
                    const existingByUnique = await db.query(
                        'SELECT id FROM tournaments WHERE unique_tournament_id = ?',
                        [tournament.unique_tournament_id]
                    );
                    if (existingByUnique.length > 0) {
                        dbTournamentId = existingByUnique[0].id;
                        console.log(`   ✅ Found existing tournament by unique_tournament_id: ${dbTournamentId}`);
                    }
                }
            }
            
            // Create tournament if it doesn't exist
            if (!dbTournamentId) {
                if (tournament.tournament_data) {
                    const tournamentDataForUpsert = {
                        uniqueTournament: { 
                            id: tournament.unique_tournament_id || tournament.category_tournament_id,
                            name: tournament.tournament_name 
                        },
                        id: tournament.category_tournament_id,
                        category: { 
                            name: tournament.tournament_data?.category?.name || null 
                        }
                    };
                    dbTournamentId = await this.upsertTournament(tournamentDataForUpsert);
                } else {
                    // Create minimal tournament with category_tournament_id
                    const result = await db.query(
                        `INSERT INTO tournaments 
                        (sofascore_tournament_id, unique_tournament_id, category_tournament_id, name, slug)
                        VALUES (?, ?, ?, ?, ?)`,
                        [
                            tournament.category_tournament_id,
                            tournament.unique_tournament_id || tournament.category_tournament_id,
                            tournament.category_tournament_id,
                            tournament.tournament_name,
                            tournament.tournament_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                        ]
                    );
                    dbTournamentId = result.insertId;
                    this.stats.tournaments.inserted++;
                }
                console.log(`   ✅ Created tournament in DB (ID: ${dbTournamentId}) with category_tournament_id: ${tournament.category_tournament_id}`);
            }
            
            if (!dbTournamentId) {
                console.log(`   ❌ Cannot process - failed to create/get tournament`);
                continue;
            }
            
            // Find or create season
            const existingSeason = await db.query(
                'SELECT id FROM seasons WHERE tournament_id = ? AND sofascore_season_id = ?',
                [dbTournamentId, tournament.season_id]
            );
            
            if (existingSeason.length > 0) {
                dbSeasonId = existingSeason[0].id;
                
                // Get match counts
                const matchStats = await db.query(
                    `SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status IN (100, 101, 102, 103, 104, 105) THEN 1 ELSE 0 END) as completed
                     FROM matches 
                     WHERE tournament_id = ? AND season_id = ?`,
                    [dbTournamentId, dbSeasonId]
                );
                existingMatchCount = matchStats[0]?.total || 0;
                completedMatchesCount = matchStats[0]?.completed || 0;
                
                console.log(`   📊 DB has ${existingMatchCount} matches (${completedMatchesCount} completed)`);
            } else if (tournament.season_data) {
                dbSeasonId = await this.upsertSeason(dbTournamentId, tournament.season_data);
                console.log(`   ✅ Created season in DB (ID: ${dbSeasonId})`);
            } else {
                // Create minimal season
                const result = await db.query(
                    `INSERT INTO seasons (tournament_id, sofascore_season_id, name, year, unique_tournament_id)
                    VALUES (?, ?, ?, ?, 
                        (SELECT unique_tournament_id FROM tournaments WHERE id = ?))`,
                    [dbTournamentId, tournament.season_id, tournament.season_name, null, dbTournamentId]
                );
                dbSeasonId = result.insertId;
                this.stats.seasons.inserted++;
                console.log(`   ✅ Created minimal season in DB (ID: ${dbSeasonId})`);
            }
            
            // Make API call to get season data using category_tournament_id
            const endpoint = `/tournament/${tournament.category_tournament_id}/season/${tournament.season_id}/events`;
            console.log(`   🌐 Fetching: ${endpoint}`);
            
            try {
                const seasonResponse = await this.makeRequestWithRetry(endpoint);
                this.stats.apiCalls++;
                
                if (!seasonResponse || !seasonResponse.events || seasonResponse.events.length === 0) {
                    console.log(`   ⚠️ No events found`);
                    continue;
                }
                
                const seasonEvents = seasonResponse.events;
                const totalApiMatches = seasonEvents.length;
                console.log(`   📊 API has ${totalApiMatches} total matches`);
                
                // Check if complete
                if (dbSeasonId && existingMatchCount === totalApiMatches && completedMatchesCount === totalApiMatches) {
                    console.log(`   ✅ SEASON COMPLETE - Skipping`);
                    this.stats.matches.complete++;
                    this.stats.matches.skipped += totalApiMatches;
                    skippedTournaments++;
                    continue;
                }
                
                // Process matches
                let processed = 0;
                let inserted = 0;
                let updated = 0;
                
                for (const event of seasonEvents) {
                    try {
                        const existingMatch = await db.query(
                            'SELECT id, status FROM matches WHERE sofascore_match_id = ? AND season_id = ?',
                            [event.id, dbSeasonId]
                        );
                        
                        if (existingMatch.length > 0 && [100, 101, 102, 103, 104, 105].includes(existingMatch[0].status)) {
                            this.stats.matches.skipped++;
                            processed++;
                            continue;
                        }
                        
                        const homeTeamId = await this.upsertTeam(event.homeTeam);
                        const awayTeamId = await this.upsertTeam(event.awayTeam);
                        
                        if (homeTeamId && awayTeamId) {
                            const beforeInsert = this.stats.matches.inserted;
                            const beforeUpdate = this.stats.matches.updated;
                            
                            await this.upsertMatch(event, dbTournamentId, dbSeasonId, homeTeamId, awayTeamId);
                            
                            if (this.stats.matches.inserted > beforeInsert) {
                                inserted++;
                            } else if (this.stats.matches.updated > beforeUpdate) {
                                updated++;
                            }
                            processed++;
                        } else {
                            this.stats.matches.failed++;
                            console.log(`         ⚠️ Failed to get team IDs for match ${event.id}`);
                        }
                    } catch (error) {
                        this.stats.matches.failed++;
                        console.error(`         ❌ Match ${event.id} failed: ${error.message}`);
                    }
                }
                
                console.log(`   ✅ Processed ${processed}/${totalApiMatches} matches (${inserted} new, ${updated} updated)`);
                totalMatchesFetched += processed;
                
            } catch (error) {
                console.error(`   ❌ Failed to fetch season: ${error.message}`);
                if (error.message.includes('403')) {
                    console.log(`   🚫 Rate limit - taking 30s break`);
                    await this.delay(30000);
                } else if (error.message.includes('404')) {
                    console.log(`   ⚠️ Season not found (404) - skipping`);
                }
            }
            
            // Short delay between tournaments
            if (i < tournaments.length - 1) {
                await this.delay(2000);
            }
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`\n${'═'.repeat(60)}`);
        console.log('📊 COLLECTION SUMMARY');
        console.log('═'.repeat(60));
        console.log(`   Target:              ${specificTournamentId ? `Tournament ${specificTournamentId}` : date}`);
        console.log(`   Tournaments Processed: ${tournaments.length - skippedTournaments}/${tournaments.length}`);
        console.log(`   API Calls:           ${this.stats.apiCalls}`);
        console.log(`   ─────────────────`);
        console.log(`   Tournaments:         +${this.stats.tournaments.inserted} inserted, ${this.stats.tournaments.updated} updated`);
        console.log(`   Teams:               +${this.stats.teams.inserted} inserted, ${this.stats.teams.updated} updated`);
        console.log(`   Seasons:             +${this.stats.seasons.inserted} inserted, ${this.stats.seasons.updated} updated`);
        console.log(`   Matches:             +${this.stats.matches.inserted} inserted, ${this.stats.matches.updated} updated`);
        console.log(`   Matches Skipped:     ${this.stats.matches.skipped}`);
        console.log(`   Matches Failed:      ${this.stats.matches.failed}`);
        console.log(`   ─────────────────`);
        console.log(`   Duration:            ${duration}s`);
        console.log('═'.repeat(60) + '\n');
        
        await db.close();
        
        return { 
            success: true, 
            tournamentsProcessed: tournaments.length - skippedTournaments,
            matchesFetched: totalMatchesFetched,
            stats: this.stats 
        };
        
    } catch (error) {
        console.error(`\n❌ Fatal error:`, error.message);
        console.error(error.stack);
        await db.close();
        return { success: false, error: error.message, discoveredPairs: [] };
    }
}
/**
 * Collect a specific tournament-season pair directly
 */
async collectTournamentSeason(tournamentId, seasonId) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎯 DIRECT COLLECTION MODE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Tournament ID: ${tournamentId}`);
    console.log(`   Season ID: ${seasonId}`);
    console.log(`${'═'.repeat(60)}\n`);
    
    // Use today's date as placeholder for discovery
    const today = new Date().toISOString().split('T')[0];
    return await this.collectForDate(today, tournamentId, seasonId);
}
/**
 * Get current round for a tournament (for updating purposes)
 */
async getCurrentRound(uniqueTournamentId, seasonId) {
    try {
        const endpoint = `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/rounds`;
        const response = await this.makeRequestWithRetry(endpoint);
        
        if (response && response.currentRound) {
            return response.currentRound.round;
        }
        return null;
    } catch (error) {
        // Rounds endpoint might not be available for all tournaments
        return null;
    }
}
}

// CLI
// CLI
if (require.main === module) {
    const collector = new SeasonEventsCollector();
    const args = process.argv.slice(2);

    (async () => {
        try {
            if (args.includes('--tournament') && args.includes('--season')) {
                const tournamentIdx = args.indexOf('--tournament');
                const seasonIdx = args.indexOf('--season');
                const tournamentId = args[tournamentIdx + 1];
                const seasonId = args[seasonIdx + 1];
                
                if (tournamentId && seasonId) {
                    await collector.collectTournamentSeason(tournamentId, seasonId);
                } else {
                    console.log('❌ Please provide both --tournament and --season values');
                    console.log('   Example: node collectors/seasonEventsCollector.js --tournament 83 --season 72034');
                }
            } 
            else if (args.includes('--date') && args.length >= 2) {
                const dateIdx = args.indexOf('--date');
                const date = args[dateIdx + 1];
                
                // Check if specific tournament/season also provided
                if (args.includes('--tournament') && args.includes('--season')) {
                    const tournamentIdx = args.indexOf('--tournament');
                    const seasonIdx = args.indexOf('--season');
                    const tournamentId = args[tournamentIdx + 1];
                    const seasonId = args[seasonIdx + 1];
                    await collector.collectForDate(date, tournamentId, seasonId);
                } else {
                    await collector.collectForDate(date);
                }
            } 
            else if (args.includes('--current')) {
                await collector.collectCurrentSeasons();
            } 
            else if (args.includes('--discover') && args.length >= 2) {
                const discoverIdx = args.indexOf('--discover');
                const date = args[discoverIdx + 1];
                console.log(`🔍 Discovery mode - only show tournaments, don't collect data`);
                // Create a temporary collector just for discovery
                await collector.initialize();
                const scheduleEndpoint = `/sport/football/scheduled-events/${date}`;
                const response = await collector.makeRequestWithRetry(scheduleEndpoint);
                
                if (response && response.events) {
                    const tournaments = new Map();
                    for (const event of response.events) {
                        if (event.tournament?.id && event.season?.id) {
                            const key = `${event.tournament.id}_${event.season.id}`;
                            if (!tournaments.has(key)) {
                                tournaments.set(key, {
                                    tournament_id: event.tournament.id,
                                    unique_tournament_id: event.tournament.uniqueTournament?.id,
                                    season_id: event.season.id,
                                    tournament_name: event.tournament.uniqueTournament?.name || event.tournament.name,
                                    season_name: event.season.name,
                                    match_count: 0,
                                    sample_match: `${event.homeTeam?.name} vs ${event.awayTeam?.name}`
                                });
                            }
                            const t = tournaments.get(key);
                            t.match_count++;
                        }
                    }
                    
                    console.log(`\n📋 TOURNAMENTS WITH MATCHES ON ${date}:`);
                    console.log('═'.repeat(70));
                    const sorted = Array.from(tournaments.values()).sort((a,b) => a.tournament_name.localeCompare(b.tournament_name));
                    sorted.forEach((t, idx) => {
                        console.log(`\n${idx+1}. ${t.tournament_name}`);
                        console.log(`   Tournament ID: ${t.tournament_id}`);
                        console.log(`   Season ID: ${t.season_id}`);
                        console.log(`   Season: ${t.season_name}`);
                        console.log(`   Matches on ${date}: ${t.match_count}`);
                        console.log(`   Example: ${t.sample_match}`);
                        console.log(`   Command: node collectors/seasonEventsCollector.js --tournament ${t.tournament_id} --season ${t.season_id}`);
                    });
                    console.log('\n' + '═'.repeat(70));
                }
                await db.close();
            }
            else {
                console.log('Usage:');
                console.log('');
                console.log('  # Discover tournaments for a date:');
                console.log('  node collectors/seasonEventsCollector.js --discover 2025-08-09');
                console.log('');
                console.log('  # Collect all tournaments for a date:');
                console.log('  node collectors/seasonEventsCollector.js --date 2025-08-09');
                console.log('');
                console.log('  # Collect specific tournament-season:');
                console.log('  node collectors/seasonEventsCollector.js --tournament 83 --season 72034');
                console.log('');
                console.log('  # Collect specific tournament-season for a date:');
                console.log('  node collectors/seasonEventsCollector.js --date 2025-08-09 --tournament 83 --season 72034');
                console.log('');
                console.log('  # Collect current seasons:');
                console.log('  node collectors/seasonEventsCollector.js --current');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
        }
        process.exit(0);
    })();
}

module.exports = new SeasonEventsCollector();