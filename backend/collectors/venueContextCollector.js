/**
 * Venue Context Collector
 * Gets venue data from event details endpoint: /event/{eventId}
 * 
 * Extracts: venue coordinates, attendance, referee, city
 * Calculates: travel distance, derby detection, altitude
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class VenueContextCollector {
    constructor() {
        this.collectorName = 'venue_context_collector';
        // Known derbies for detection
        this.derbies = {
            city: [
                ['Arsenal', 'Tottenham'], ['Arsenal', 'Chelsea'], ['Chelsea', 'Fulham'],
                ['Liverpool', 'Everton'], ['Man City', 'Man United'],
                ['AC Milan', 'Inter Milan'], ['Roma', 'Lazio'],
                ['Real Madrid', 'Atletico Madrid'], ['Bayern Munich', '1860 Munich'],
                ['Benfica', 'Sporting Lisbon'], ['Fenerbahce', 'Galatasaray'],
                ['Inter Milan', 'AC Milan'], ['Lazio', 'Roma'],
                ['Nottingham', 'Notts County'], ['Sheffield United', 'Sheffield Wednesday']
            ],
            regional: [
                ['Barcelona', 'Real Madrid'], ['Liverpool', 'Man United'],
                ['Arsenal', 'Man United'], ['Dortmund', 'Bayern Munich'],
                ['PSG', 'Marseille'], ['Ajax', 'Feyenoord'],
                ['Celtic', 'Rangers'], ['Porto', 'Benfica'],
                ['Juventus', 'Inter Milan'], ['Atletico Madrid', 'Barcelona']
            ]
        };
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    calculateDistance(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return Math.round(R * c);
    }

    detectDerby(homeName, awayName) {
        for (const [t1, t2] of this.derbies.city) {
            if ((homeName.includes(t1) && awayName.includes(t2)) ||
                (homeName.includes(t2) && awayName.includes(t1))) {
                return { isDerby: true, type: 'city', name: 'City Derby' };
            }
        }
        for (const [t1, t2] of this.derbies.regional) {
            if ((homeName.includes(t1) && awayName.includes(t2)) ||
                (homeName.includes(t2) && awayName.includes(t1))) {
                return { isDerby: true, type: 'regional', name: `${homeName} vs ${awayName}` };
            }
        }
        return { isDerby: false, type: 'none', name: null };
    }

    async collectForMatch(matchId) {
        try {
            await this.initialize();
            
            const matches = await db.query(
                'SELECT id, sofascore_match_id, home_team_id, away_team_id FROM matches WHERE id = ?',
                [matchId]
            );
            if (matches.length === 0) return { success: false, error: 'Match not found' };

            const match = matches[0];
            
            // Check if venue context already exists
            const existing = await db.query(
                'SELECT id FROM match_venue_context WHERE match_id = ?',
                [matchId]
            );
            
            if (existing.length > 0) {
                console.log(`   ⏭️  Venue context already exists for match ${matchId}`);
                return { success: true, already_exists: true };
            }
            
            const endpoint = `/event/${match.sofascore_match_id}`;
            console.log(`📍 Venue: Match ${matchId} (Event: ${match.sofascore_match_id})`);
            
            const response = await httpClient.get(endpoint);
            if (!response || !response.event) return { success: false, error: 'No data' };

            const event = response.event;
            const homeTeam = event.homeTeam || {};
            const awayTeam = event.awayTeam || {};
            const venue = event.venue || {};

            // Get team names for derby detection
            const teamNames = await db.query(
                'SELECT name FROM teams WHERE id IN (?, ?)',
                [match.home_team_id, match.away_team_id]
            );
            
            const homeTeamName = teamNames[0]?.name || homeTeam.name || '';
            const awayTeamName = teamNames[1]?.name || awayTeam.name || '';

            // Extract venue coordinates from team venues
            const homeVenue = homeTeam.venue || {};
            const awayVenue = awayTeam.venue || {};
            const homeCoords = homeVenue.venueCoordinates || {};
            const awayCoords = awayVenue.venueCoordinates || {};

            // Update teams table with manager and venue info (using correct column names)
            if (homeTeam.manager?.name) {
                await db.query(
                    `UPDATE teams SET 
                        manager_name = ?,
                        venue_name = ?,
                        venue_city = ?,
                        venue_capacity = ?,
                        venue_country = ?
                    WHERE id = ?`,
                    [
                        homeTeam.manager.name, 
                        homeVenue.name || null, 
                        homeVenue.city?.name || null,
                        homeVenue.capacity || null, 
                        homeVenue.country?.name || null, 
                        match.home_team_id
                    ]
                );
            }
            if (awayTeam.manager?.name) {
                await db.query(
                    `UPDATE teams SET 
                        manager_name = ?,
                        venue_name = ?,
                        venue_city = ?,
                        venue_capacity = ?,
                        venue_country = ?
                    WHERE id = ?`,
                    [
                        awayTeam.manager.name, 
                        awayVenue.name || null, 
                        awayVenue.city?.name || null,
                        awayVenue.capacity || null, 
                        awayVenue.country?.name || null, 
                        match.away_team_id
                    ]
                );
            }

            // Update match with venue and referee
            await db.query(
                'UPDATE matches SET venue_name = ?, referee_name = ? WHERE id = ?',
                [venue.name || null, event.referee?.name || null, matchId]
            );

            // Calculate travel distance
            const distance = this.calculateDistance(
                homeCoords.latitude, homeCoords.longitude,
                awayCoords.latitude, awayCoords.longitude
            );

            // Detect derby
            const derby = this.detectDerby(homeTeamName, awayTeamName);
            
            // Check if same city/country
            const sameCity = (homeVenue.city?.name && awayVenue.city?.name && 
                             homeVenue.city.name === awayVenue.city.name) ? 1 : 0;
            const sameCountry = (homeVenue.country?.name && awayVenue.country?.name && 
                                homeVenue.country.name === awayVenue.country.name) ? 1 : 0;
            
            // Check if neutral venue
            const isNeutral = (!homeVenue.city?.name || !awayVenue.city?.name || 
                              homeVenue.city?.name === 'Neutral') ? 1 : 0;

            // Store venue context
            await db.query(
                `INSERT INTO match_venue_context (
                    match_id, home_team_id, away_team_id,
                    travel_distance_km, is_derby, derby_type,
                    same_city, same_region, same_country, is_neutral_venue,
                    altitude_meters, capacity
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    travel_distance_km = VALUES(travel_distance_km),
                    is_derby = VALUES(is_derby), 
                    derby_type = VALUES(derby_type),
                    same_city = VALUES(same_city),
                    same_region = VALUES(same_region),
                    same_country = VALUES(same_country),
                    is_neutral_venue = VALUES(is_neutral_venue),
                    capacity = VALUES(capacity)`,
                [
                    matchId, match.home_team_id, match.away_team_id,
                    distance, 
                    derby.isDerby ? 1 : 0, 
                    derby.name,
                    sameCity,
                    0, // same_region - would need region data
                    sameCountry,
                    isNeutral,
                    null, // altitude_meters - would need elevation API
                    venue.capacity || null
                ]
            );

            // Store manager info if manager_records table exists
            const tableCheck = await db.query(
                "SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'manager_records'"
            );
            
            if (tableCheck.length > 0) {
                if (homeTeam.manager?.name) {
                    await this.storeManagerInfo(match.home_team_id, homeTeam.manager, homeTeamName);
                }
                if (awayTeam.manager?.name) {
                    await this.storeManagerInfo(match.away_team_id, awayTeam.manager, awayTeamName);
                }
            }

            const derbyLabel = derby.isDerby ? `🔥 ${derby.name}` : 'Regular';
            const distanceLabel = distance ? `${distance}km` : 'Unknown';
            const venueLabel = venue.name || 'Unknown venue';
            
            console.log(`   🏟️ ${venueLabel} | ${derbyLabel} | ${distanceLabel} | 👔 ${homeTeam.manager?.name || '?'} vs ${awayTeam.manager?.name || '?'}`);
            
            return { 
                success: true, 
                venue: venue.name, 
                isDerby: derby.isDerby, 
                distance,
                homeManager: homeTeam.manager?.name,
                awayManager: awayTeam.manager?.name,
                attendance: event.attendance
            };

        } catch (error) {
            if (error.message.includes('404') || error.message.includes('403')) {
                return { success: false, error: 'Not available', skipped: true };
            }
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async storeManagerInfo(teamId, manager, teamName) {
        try {
            // Calculate manager performance from existing matches
            const stats = await db.query(
                `SELECT 
                    COUNT(*) AS matches,
                    SUM(CASE WHEN (home_team_id = ? AND home_score > away_score) 
                             OR (away_team_id = ? AND away_score > home_score) THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws,
                    SUM(CASE WHEN (home_team_id = ? AND home_score < away_score) 
                             OR (away_team_id = ? AND away_score < home_score) THEN 1 ELSE 0 END) AS losses
                FROM matches
                WHERE (home_team_id = ? OR away_team_id = ?)
                AND status IN (100, 101, 102)`,
                [teamId, teamId, teamId, teamId, teamId, teamId]
            );

            if (stats[0]?.matches > 0) {
                const s = stats[0];
                const winRate = ((s.wins / s.matches) * 100).toFixed(2);
                
                await db.query(
                    `INSERT INTO manager_records (
                        team_id, manager_name, matches_managed, 
                        wins, draws, losses, win_rate, is_current
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    ON DUPLICATE KEY UPDATE
                        manager_name = VALUES(manager_name),
                        matches_managed = VALUES(matches_managed), 
                        wins = VALUES(wins),
                        draws = VALUES(draws), 
                        losses = VALUES(losses),
                        win_rate = VALUES(win_rate), 
                        updated_at = NOW()`,
                    [teamId, manager.name, s.matches, s.wins, s.draws, s.losses, winRate]
                );
            } else {
                // Insert with zero stats
                await db.query(
                    `INSERT INTO manager_records (
                        team_id, manager_name, matches_managed, wins, draws, losses, win_rate, is_current
                    ) VALUES (?, ?, 0, 0, 0, 0, 0, 1)
                    ON DUPLICATE KEY UPDATE
                        manager_name = VALUES(manager_name),
                        updated_at = NOW()`,
                    [teamId, manager.name]
                );
            }
        } catch (error) {
            console.error(`Error storing manager info: ${error.message}`);
        }
    }

    async collectForDate(date, limit = 50) {
        await this.initialize();
        
        // Validate and sanitize inputs
        const validLimit = (!isNaN(parseInt(limit)) && parseInt(limit) > 0) ? parseInt(limit) : 50;
        
        // Validate date format
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error('Invalid date format. Use YYYY-MM-DD');
        }
        
        // First, get the count of matches that need processing
        const countResult = await db.query(
            `SELECT COUNT(*) AS total
            FROM matches m
            WHERE m.match_date = ?
            AND NOT EXISTS (SELECT 1 FROM match_venue_context WHERE match_id = m.id)`,
            [date]
        );
        
        const totalNeeded = countResult[0]?.total || 0;
        console.log(`📊 Found ${totalNeeded} matches without venue context for ${date}`);
        
        if (totalNeeded === 0) {
            console.log(`All matches have venue data for ${date}`);
            await db.close();
            return [];
        }
        
        // Get matches that need processing with proper limit
        const matches = await db.query(
            `SELECT m.id, ht.name AS home, at.name AS away
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_date = ?
            AND NOT EXISTS (SELECT 1 FROM match_venue_context WHERE match_id = m.id)
            LIMIT ${validLimit}`,
            [date]
        );

        if (matches.length === 0) {
            console.log(`No matches to process for ${date}`);
            await db.close();
            return [];
        }

        console.log(`\n📍 VENUE CONTEXT: ${date} - Processing ${matches.length} matches (limit: ${validLimit})\n`);

        let success = 0, derbies = 0, skipped = 0;
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            console.log(`   [${i+1}/${matches.length}] ${m.home} vs ${m.away}`);
            const result = await this.collectForMatch(m.id);
            if (result.success) { 
                success++; 
                if (result.isDerby) derbies++; 
            }
            else if (result.skipped) skipped++;
            await this.delay(1500);
        }

        console.log(`\n✅ ${success} processed, ${derbies} derbies, ${skipped} skipped`);
        await db.close();
        return { success, derbies, skipped };
    }
}

// CLI handling
if (require.main === module) {
    const collector = new VenueContextCollector();
    const args = process.argv.slice(2);
    
    (async () => {
        try {
            // Check for --date flag
            const dateIndex = args.indexOf('--date');
            if (dateIndex !== -1) {
                const date = args[dateIndex + 1];
                if (!date) {
                    throw new Error('Date is required after --date flag');
                }
                
                // Get limit from next argument after date (if it exists and is a number)
                let limit = 50;
                const limitArg = args[dateIndex + 2];
                if (limitArg && !isNaN(parseInt(limitArg))) {
                    limit = parseInt(limitArg);
                }
                
                console.log(`📅 Collecting venue context for date: ${date}, limit: ${limit}`);
                await collector.collectForDate(date, limit);
            } 
            // Check for single match ID
            else if (args[0] && !isNaN(parseInt(args[0]))) {
                await collector.initialize();
                const matchId = parseInt(args[0]);
                console.log(`🎯 Collecting venue context for match ID: ${matchId}`);
                const result = await collector.collectForMatch(matchId);
                console.log(JSON.stringify(result, null, 2));
                await db.close();
            } 
            else {
                console.log('═══════════════════════════════════════════════════════════');
                console.log('📍 VENUE CONTEXT COLLECTOR - Usage Guide');
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
                console.log('Examples:');
                console.log('  node collectors/venueContextCollector.js --date 2026-05-12');
                console.log('  node collectors/venueContextCollector.js --date 2026-05-12 100');
                console.log('  node collectors/venueContextCollector.js 12345');
                console.log('');
                console.log('Parameters:');
                console.log('  --date YYYY-MM-DD : Collect venue context for a specific date');
                console.log('  [limit]           : Maximum number of matches to process (default: 50)');
                console.log('  <matchId>         : Collect venue context for a single match');
                console.log('═══════════════════════════════════════════════════════════');
                process.exit(1);
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
        process.exit(0);
    })();
}

module.exports = new VenueContextCollector();