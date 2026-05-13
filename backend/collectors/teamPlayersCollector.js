/**
 * Team Players & Injuries Collector
 * Endpoint: /team/{teamId}/players
 * 
 * Flow: matches (for date) → teams → API → players & injuries
 * 
 * FOLLOWS SAME PATTERN AS PlayerStatisticsCollector:
 * - No complex rate limiting (just small delays)
 * - Simple batch processing
 * - Direct DB query to API call
 * - Smart skipping of already processed teams
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class TeamPlayersCollector {
    constructor() {
        this.collectorName = 'team_players_collector';
        this.stats = {
            success: 0,
            skipped: 0,
            failed: 0,
            totalPlayersInserted: 0,
            totalPlayersUpdated: 0,
            totalInjuriesFound: 0
        };
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    /**
     * Collect players for a specific team (same pattern as collectForPlayer)
     */
    async collectForTeam(sofascoreTeamId, dbTeamId, teamName) {
        try {
            const endpoint = `/team/${sofascoreTeamId}/players`;
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.players) {
                return { success: false, error: 'No data', skipped: true };
            }

            let playersInserted = 0;
            let playersUpdated = 0;
            let injuriesInserted = 0;
            let injuriesUpdated = 0;

            // Mark old injuries as recovered
            await db.query(
                `UPDATE injuries 
                 SET status = 'recovered', 
                     end_date = CURDATE(),
                     actual_return_date = CURDATE(),
                     updated_at = NOW()
                 WHERE team_id = ? AND status = 'active'`,
                [dbTeamId]
            );

            for (const entry of response.players) {
                const player = entry.player;
                if (!player || !player.id) continue;

                // Check if player exists
                const existingPlayer = await db.query(
                    'SELECT id FROM players WHERE sofascore_player_id = ?',
                    [player.id]
                );

                // Parse birth date
                let birthDate = null;
                if (player.dateOfBirth) {
                    const date = new Date(player.dateOfBirth);
                    if (!isNaN(date.getTime())) {
                        birthDate = date.toISOString().split('T')[0];
                    }
                }

                // Upsert player
                await db.query(
                    `INSERT INTO players (sofascore_player_id, team_id, name, position, jersey_number, 
                    height_cm, preferred_foot, birth_date, country)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    name = VALUES(name), 
                    position = VALUES(position), 
                    jersey_number = VALUES(jersey_number), 
                    team_id = VALUES(team_id),
                    height_cm = VALUES(height_cm), 
                    preferred_foot = VALUES(preferred_foot),
                    birth_date = VALUES(birth_date), 
                    country = VALUES(country),
                    updated_at = NOW()`,
                    [
                        player.id,
                        dbTeamId,
                        player.name || 'Unknown',
                        player.position || null,
                        player.jerseyNumber || player.shirtNumber || null,
                        player.height || null,
                        player.preferredFoot || null,
                        birthDate,
                        player.country?.name || null
                    ]
                );
                
                if (existingPlayer.length === 0) {
                    playersInserted++;
                } else {
                    playersUpdated++;
                }

                // Check for injury data
                if (player.injury) {
                    const injury = player.injury;
                    
                    // Get the player's database ID
                    const playerRow = await db.query(
                        'SELECT id FROM players WHERE sofascore_player_id = ?',
                        [player.id]
                    );
                    const playerDbId = playerRow[0]?.id || null;

                    // Parse expected return date
                    let expectedReturnDate = null;
                    if (injury.expectedReturnDateData) {
                        const { year, month, day } = injury.expectedReturnDateData;
                        expectedReturnDate = `${year}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`;
                    }

                    // Determine severity
                    let severity = 'minor';
                    if (injury.expectedReturn) {
                        if (injury.expectedReturn > 30) severity = 'severe';
                        else if (injury.expectedReturn > 14) severity = 'medium';
                    }

                    // Check if injury already exists
                    const existingInjury = await db.query(
                        `SELECT id FROM injuries 
                         WHERE player_id = ? AND status = 'active'`,
                        [playerDbId]
                    );

                    if (existingInjury.length > 0) {
                        await db.query(
                            `UPDATE injuries 
                             SET injury_type = ?,
                                 injury_description = ?,
                                 expected_return_date = ?,
                                 severity = ?,
                                 status = ?,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [
                                injury.reason || injury.type || 'Unknown',
                                injury.reason || null,
                                expectedReturnDate,
                                severity,
                                injury.status === 'out' ? 'active' : 'doubtful',
                                existingInjury[0].id
                            ]
                        );
                        injuriesUpdated++;
                    } else {
                        await db.query(
                            `INSERT INTO injuries (team_id, player_id, player_name, injury_type, 
                            injury_description, expected_return_date, status, severity, 
                            start_date, recorded_date, source, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), CURDATE(), 'sofascore_api', NOW(), NOW())`,
                            [
                                dbTeamId,
                                playerDbId,
                                player.name || 'Unknown',
                                injury.reason || injury.type || 'Unknown',
                                injury.reason || null,
                                expectedReturnDate,
                                injury.status === 'out' ? 'active' : 'doubtful',
                                severity
                            ]
                        );
                        injuriesInserted++;
                    }
                }
            }

            /* // Update matches missed count for injured players
            if (injuriesInserted > 0 || injuriesUpdated > 0) {
                await db.query(
                    `UPDATE injuries i
                     SET matches_missed = (
                         SELECT COUNT(*) FROM matches m
                         WHERE (m.home_team_id = i.team_id OR m.away_team_id = i.team_id)
                         AND m.match_date > i.start_date
                         AND m.status IN (100, 101, 102)
                     )
                     WHERE i.team_id = ? AND i.status = 'active'`,
                    [dbTeamId]
                );
            } */

            return { 
                success: true, 
                playersInserted, 
                playersUpdated, 
                injuriesInserted, 
                injuriesUpdated 
            };

        } catch (error) {
            if (error.message.includes('404') || error.message.includes('403')) {
                return { success: false, error: 'Not available', skipped: true };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Main method: Collect players for teams playing on a specific date
     * Follows same pattern as PlayerStatisticsCollector.collectForDate()
     */
    async collectForDate(date, limit = 100) {
        await this.initialize();
        const max = parseInt(limit) || 100;
        
        // Step 1: Debug - Check what data exists
        const matchCount = await db.query(
            'SELECT COUNT(*) as c FROM matches WHERE DATE(match_datetime) = ?',
            [date]
        );
        const teamCount = await db.query(
            `SELECT COUNT(DISTINCT t.id) as c 
             FROM matches m 
             JOIN teams t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
             WHERE DATE(m.match_datetime) = ?`,
            [date]
        );
        
        console.log(`\n   📊 ${date}: ${matchCount[0]?.c || 0} matches, ${teamCount[0]?.c || 0} teams involved`);
        
        // Step 2: Get teams that need player data (haven't been updated in 24 hours)
        const teams = await db.query(
            `SELECT DISTINCT 
                t.id AS db_team_id,
                t.name,
                t.sofascore_team_id,
                MAX(p.updated_at) AS last_player_update,
                COUNT(p.id) AS player_count
            FROM matches m
            JOIN teams t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
            LEFT JOIN players p ON t.id = p.team_id
            WHERE DATE(m.match_datetime) = ?
            AND t.sofascore_team_id IS NOT NULL
            AND t.sofascore_team_id > 0
            GROUP BY t.id, t.name, t.sofascore_team_id
            HAVING last_player_update IS NULL 
                OR last_player_update < DATE_SUB(NOW(), INTERVAL 24 HOUR)
                OR player_count = 0
            ORDER BY player_count ASC
            LIMIT ${max}`,
            [date]
        );

        if (teams.length === 0) {
            // Check if any teams exist at all
            const totalTeams = await db.query(
                `SELECT COUNT(DISTINCT t.id) as c 
                 FROM matches m 
                 JOIN teams t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
                 WHERE DATE(m.match_datetime) = ?
                 AND t.sofascore_team_id IS NOT NULL`,
                [date]
            );
            
            console.log(`\n   ℹ️  No teams need player data for ${date}`);
            console.log(`   Total teams with matches: ${totalTeams[0]?.c || 0}`);
            console.log(`   All teams have been updated in the last 24 hours`);
            
            await db.close();
            return { success: true, teamsProcessed: 0, teamsSkipped: totalTeams[0]?.c || 0 };
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`👥 TEAM PLAYERS: ${date} - ${teams.length} teams need updates`);
        console.log(`${'═'.repeat(60)}\n`);

        return this.processBatch(teams, date);
    }

    /**
     * Process a batch of teams - CONTINUOUS MODE (same as PlayerStatisticsCollector)
     * Small delay between each team to avoid rate limiting
     */
    async processBatch(teams, date) {
        this.stats = {
            success: 0,
            skipped: 0,
            failed: 0,
            totalPlayersInserted: 0,
            totalPlayersUpdated: 0,
            totalInjuriesFound: 0
        };

        const TEAM_DELAY = 2000; // 2 seconds between teams (same as player stats collector)

        for (let i = 0; i < teams.length; i++) {
            const team = teams[i];
            console.log(`   [${i+1}/${teams.length}] ${team.name} (Sofascore ID: ${team.sofascore_team_id})`);
            console.log(`      Current: ${team.player_count || 0} players, last update: ${team.last_player_update ? new Date(team.last_player_update).toLocaleDateString() : 'never'}`);
            
            const result = await this.collectForTeam(team.sofascore_team_id, team.db_team_id, team.name);
            
            if (result.success) {
                this.stats.success++;
                this.stats.totalPlayersInserted += result.playersInserted || 0;
                this.stats.totalPlayersUpdated += result.playersUpdated || 0;
                this.stats.totalInjuriesFound += result.injuriesInserted || 0;
                console.log(`      ✅ ${result.playersInserted} new, ${result.playersUpdated} updated players | ${result.injuriesInserted} new injuries`);
            } else if (result.skipped) {
                this.stats.skipped++;
                console.log(`      ⏭️ ${result.error}`);
            } else {
                this.stats.failed++;
                console.log(`      ❌ ${result.error}`);
            }
            
            // Small delay between each team (same as player stats collector)
            if (i < teams.length - 1) {
                await this.delay(TEAM_DELAY);
            }
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log('📊 COLLECTION SUMMARY');
        console.log('═'.repeat(60));
        console.log(`   Date:           ${date}`);
        console.log(`   Success:        ${this.stats.success} teams`);
        console.log(`   Skipped:        ${this.stats.skipped} teams`);
        console.log(`   Failed:         ${this.stats.failed} teams`);
        console.log(`   ─────────────────`);
        console.log(`   Players New:    ${this.stats.totalPlayersInserted}`);
        console.log(`   Players Updated: ${this.stats.totalPlayersUpdated}`);
        console.log(`   Injuries:       ${this.stats.totalInjuriesFound}`);
        console.log('═'.repeat(60) + '\n');
        
        await db.close();
        return this.stats;
    }

    /**
     * Check date to see what teams need updates (same pattern as checkDate)
     */
    async checkDate(date) {
        await this.initialize();
        
        const result = await db.query(
            `SELECT 
                COUNT(DISTINCT t.id) AS total_teams,
                SUM(CASE WHEN p.team_id IS NOT NULL AND p.updated_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS have_recent_players,
                SUM(CASE WHEN p.team_id IS NULL OR p.updated_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS need_update
            FROM matches m
            JOIN teams t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
            LEFT JOIN players p ON t.id = p.team_id
            WHERE DATE(m.match_datetime) = ?
            AND t.sofascore_team_id IS NOT NULL
            GROUP BY t.id`,
            [date]
        );
        
        // Aggregate results
        const totals = result.reduce((acc, row) => {
            acc.total_teams = (acc.total_teams || 0) + 1;
            if (row.have_recent_players > 0) acc.have_recent_players = (acc.have_recent_players || 0) + 1;
            if (row.need_update > 0) acc.need_update = (acc.need_update || 0) + 1;
            return acc;
        }, {});
        
        console.log(`\n📊 ${date}: ${totals.total_teams || 0} teams | ${totals.have_recent_players || 0} have recent players | ${totals.need_update || 0} need update\n`);
        
        await db.close();
        return totals;
    }

    /**
     * Collect for a specific team (by DB team ID)
     */
    async collectForTeamById(dbTeamId) {
        await this.initialize();
        
        const team = await db.query(
            'SELECT id, name, sofascore_team_id FROM teams WHERE id = ? AND sofascore_team_id IS NOT NULL',
            [dbTeamId]
        );
        
        if (team.length === 0) {
            console.log(`❌ Team ID ${dbTeamId} not found or has no sofascore_team_id`);
            await db.close();
            return { success: false };
        }
        
        console.log(`\n👥 Collecting players for: ${team[0].name}\n`);
        const result = await this.collectForTeam(team[0].sofascore_team_id, team[0].id, team[0].name);
        
        if (result.success) {
            console.log(`✅ ${result.playersInserted} new, ${result.playersUpdated} updated players | ${result.injuriesInserted} new injuries`);
        } else if (result.skipped) {
            console.log(`⏭️ ${result.error}`);
        } else {
            console.log(`❌ ${result.error}`);
        }
        
        await db.close();
        return result;
    }
}

// CLI (same pattern as PlayerStatisticsCollector)
if (require.main === module) {
    const collector = new TeamPlayersCollector();
    const args = process.argv.slice(2);
    
    (async () => {
        try {
            if (args.includes('--date') && args.length >= 2) {
                const i = args.indexOf('--date');
                await collector.collectForDate(args[i+1], args[i+2] || 100);
            } 
            else if (args.includes('--check') && args.length >= 2) {
                await collector.checkDate(args[args.indexOf('--check')+1]);
            }
            else if (args[0] && !isNaN(args[0])) {
                await collector.collectForTeamById(parseInt(args[0]));
            }
            else {
                console.log('Usage:');
                console.log('  node collectors/teamPlayersCollector.js --date YYYY-MM-DD [limit]');
                console.log('  node collectors/teamPlayersCollector.js --check YYYY-MM-DD');
                console.log('  node collectors/teamPlayersCollector.js <db_team_id>');
                console.log('');
                console.log('Examples:');
                console.log('  node collectors/teamPlayersCollector.js --date 2026-05-13');
                console.log('  node collectors/teamPlayersCollector.js --date 2026-05-13 50');
                console.log('  node collectors/teamPlayersCollector.js --check 2026-05-13');
                console.log('  node collectors/teamPlayersCollector.js 153');
            }
        } catch (e) {
            console.error('Fatal:', e.message);
        }
        process.exit(0);
    })();
}

module.exports = new TeamPlayersCollector();