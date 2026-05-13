/**
 * Lineups Collector
 * Endpoint: /event/{eventId}/lineups
 * 
 * Response structure:
 * {
 *   confirmed: false,
 *   home: {
 *     formation: "4-2-3-1",
 *     players: [{ player: {...}, position, shirtNumber, substitute, captain }],
 *     missingPlayers: [{ player: {...}, type, reason, description, expectedEndDate }],
 *     supportStaff: [...]
 *   },
 *   away: { ... same },
 *   statisticalVersion: 3
 * }
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class LineupsCollector {
    constructor() {
        this.collectorName = 'lineups_collector';
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async collectForMatch(matchId) {
        try {
            await this.initialize();
            const matches = await db.query(
                'SELECT id, sofascore_match_id, home_team_id, away_team_id FROM matches WHERE id = ?',
                [matchId]
            );
            if (matches.length === 0) return { success: false, error: 'Match not found' };

            const match = matches[0];
            const endpoint = `/event/${match.sofascore_match_id}/lineups`;
            console.log(`📋 Lineups: Match ${matchId}`);
            
            const response = await httpClient.get(endpoint);
            if (!response) return { success: false, error: 'No data' };

            let stats = { players: 0, missing: 0, formations: {} };

            // Process home
            if (response.home) {
                stats.formations.home = response.home.formation || 'Unknown';
                
                // Store formation
                await this.storeFormation(matchId, match.home_team_id, response.home.formation, 'home');
                
                // Store players
                if (response.home.players) {
                    for (const entry of response.home.players) {
                        await this.storePlayer(matchId, match.home_team_id, entry, true);
                        stats.players++;
                    }
                }
                
                // Store missing players (injuries/suspensions specific to this match)
                if (response.home.missingPlayers) {
                    for (const missing of response.home.missingPlayers) {
                        await this.storeMissingPlayer(matchId, match.home_team_id, missing, 'home');
                        stats.missing++;
                    }
                }
            }

            // Process away
            if (response.away) {
                stats.formations.away = response.away.formation || 'Unknown';
                
                await this.storeFormation(matchId, match.away_team_id, response.away.formation, 'away');
                
                if (response.away.players) {
                    for (const entry of response.away.players) {
                        await this.storePlayer(matchId, match.away_team_id, entry, false);
                        stats.players++;
                    }
                }
                
                if (response.away.missingPlayers) {
                    for (const missing of response.away.missingPlayers) {
                        await this.storeMissingPlayer(matchId, match.away_team_id, missing, 'away');
                        stats.missing++;
                    }
                }
            }

            // Store formation matchup
            if (response.home?.formation && response.away?.formation) {
                await this.storeFormationMatchup(matchId, match.home_team_id, match.away_team_id, 
                    response.home.formation, response.away.formation);
            }

            await db.query('UPDATE matches SET has_lineups = 1 WHERE id = ?', [matchId]);

            console.log(`   ✅ ${stats.formations.home} vs ${stats.formations.away} | ${stats.players} players | ${stats.missing} missing`);
            return { success: true, ...stats };

        } catch (error) {
            if (error.message.includes('404') || error.message.includes('403')) {
                return { success: false, error: 'Not available', skipped: true };
            }
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async storeFormation(matchId, teamId, formation, venue) {
        const existing = await db.query(
            'SELECT id, home_team_id, away_team_id FROM match_formations WHERE match_id = ?',
            [matchId]
        );

        if (existing.length === 0) {
            // First time - insert with only the known side
            if (venue === 'home') {
                await db.query(
                    `INSERT INTO match_formations (match_id, home_team_id, home_formation)
                    VALUES (?, ?, ?)`,
                    [matchId, teamId, formation]
                );
            } else {
                await db.query(
                    `INSERT INTO match_formations (match_id, away_team_id, away_formation)
                    VALUES (?, ?, ?)`,
                    [matchId, teamId, formation]
                );
            }
        } else {
            // Update existing record
            if (venue === 'home') {
                await db.query(
                    'UPDATE match_formations SET home_team_id = ?, home_formation = ? WHERE match_id = ?',
                    [teamId, formation, matchId]
                );
            } else {
                await db.query(
                    'UPDATE match_formations SET away_team_id = ?, away_formation = ? WHERE match_id = ?',
                    [teamId, formation, matchId]
                );
            }
        }
    }

    async storePlayer(matchId, teamId, entry, isHome) {
        const player = entry.player || entry;
        if (!player.id) return;

        // Upsert player
        const existing = await db.query('SELECT id FROM players WHERE sofascore_player_id = ?', [player.id]);
        let playerId;
        
        if (existing.length > 0) {
            playerId = existing[0].id;
            await db.query(
                'UPDATE players SET name = ?, position = ?, team_id = ?, jersey_number = ?, country = ? WHERE id = ?',
                [player.name || 'Unknown', entry.position || player.position || null, teamId,
                 entry.shirtNumber || player.shirtNumber || null, player.country?.name || null, playerId]
            );
        } else {
            const result = await db.query(
                `INSERT INTO players (sofascore_player_id, team_id, name, position, jersey_number, country)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [player.id, teamId, player.name || 'Unknown', entry.position || null,
                 entry.shirtNumber || null, player.country?.name || null]
            );
            playerId = result.insertId;
        }

        // Store lineup entry
        if (playerId) {
            await db.query(
                `INSERT INTO lineups (match_id, team_id, player_id, player_name, is_starting, 
                position_lineup, formation_zone, shirt_number, is_captain, is_substitute)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                is_starting = VALUES(is_starting), 
                position_lineup = VALUES(position_lineup),
                shirt_number = VALUES(shirt_number),
                is_captain = VALUES(is_captain),
                is_substitute = VALUES(is_substitute)`,
                [
                    matchId, teamId, playerId, player.name || 'Unknown',
                    entry.substitute ? 0 : 1,
                    entry.position || null,
                    null,
                    entry.shirtNumber || null,
                    entry.captain ? 1 : 0,
                    entry.substitute ? 1 : 0
                ]
            );
        }
    }

    async storeMissingPlayer(matchId, teamId, missing, venue) {
        const player = missing.player || {};
        
        // Store as a match-specific absence record
        await db.query(
            `INSERT INTO match_missing_players (match_id, team_id, player_name, reason, 
            description, expected_return_date, venue)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            reason = VALUES(reason),
            description = VALUES(description),
            expected_return_date = VALUES(expected_return_date)`,
            [
                matchId,
                teamId,
                player.name || player.shortName || 'Unknown',
                missing.reason || missing.type || 'unknown',
                missing.description || null,
                missing.expectedEndDate ? missing.expectedEndDate.split('T')[0] : null,
                venue
            ]
        );

        // Also add to injuries table if it's an injury and injuries table exists
        if (missing.description && (
            missing.description.toLowerCase().includes('injury') || 
            missing.description.toLowerCase().includes('muscle') || 
            missing.description.toLowerCase().includes('ligament')
        )) {
            let playerDbId = null;
            if (player.id) {
                const row = await db.query('SELECT id FROM players WHERE sofascore_player_id = ?', [player.id]);
                playerDbId = row[0]?.id || null;
            }

            // Check if injuries table exists
            const tableCheck = await db.query(
                "SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'injuries'"
            );
            
            if (tableCheck.length > 0) {
                await db.query(
                    `INSERT INTO injuries (team_id, player_id, player_name, injury_type, 
                    injury_description, expected_return_date, status, severity, recorded_date)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', 'medium', CURDATE())
                    ON DUPLICATE KEY UPDATE 
                    expected_return_date = VALUES(expected_return_date),
                    injury_description = VALUES(injury_description)`,
                    [
                        teamId,
                        playerDbId,
                        player.name || 'Unknown',
                        missing.description,
                        missing.description,
                        missing.expectedEndDate ? missing.expectedEndDate.split('T')[0] : null
                    ]
                );
            }
        }
    }
    

    async storeFormationMatchup(matchId, homeTeamId, awayTeamId, homeFormation, awayFormation) {
        const existing = await db.query('SELECT id FROM match_formations WHERE match_id = ?', [matchId]);
        
        if (existing.length === 0) {
            // Insert fresh record with both teams
            await db.query(
                `INSERT INTO match_formations (match_id, home_team_id, away_team_id, home_formation, away_formation)
                VALUES (?, ?, ?, ?, ?)`,
                [matchId, homeTeamId, awayTeamId, homeFormation, awayFormation]
            );
        } else {
            // Update existing
            await db.query(
                `UPDATE match_formations 
                SET home_team_id = ?, away_team_id = ?, home_formation = ?, away_formation = ?
                WHERE match_id = ?`,
                [homeTeamId, awayTeamId, homeFormation, awayFormation, matchId]
            );
        }
    }

    /**
 * Collect player stats for a single player (fire & forget)
 * This runs silently in the background while lineups are collected
 */
async collectPlayerStatsAsync(player, dbPlayerId) {
    if (!player?.id || !dbPlayerId) return;
    
    try {
        // Check if stats already exist
        const existing = await db.query(
            'SELECT COUNT(*) as c FROM player_statistics WHERE player_id = ?',
            [dbPlayerId]
        );
        if (existing[0]?.c > 0) return;

        const endpoint = `/player/${player.id}/statistics`;
        const response = await httpClient.get(endpoint);
        
        if (!response || !response.seasons) return;

        for (const seasonData of response.seasons) {
            if (!seasonData.statistics) continue;

            const stats = seasonData.statistics;
            
            try {
                await db.query(
                    `INSERT INTO player_statistics (
                        player_id, year, appearances, minutes_played, rating,
                        goals, assists, goals_assists_sum, expected_goals, expected_assists,
                        total_shots, shots_on_target,
                        key_passes, total_passes, accurate_passes,
                        tackles, interceptions, yellow_cards, red_cards,
                        saves, goals_conceded, clean_sheet, stat_type
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        rating = VALUES(rating), goals = VALUES(goals), assists = VALUES(assists),
                        appearances = VALUES(appearances), minutes_played = VALUES(minutes_played),
                        updated_at = NOW()`,
                    [
                        dbPlayerId,
                        seasonData.year || null,
                        stats.appearances || 0,
                        stats.minutesPlayed || 0,
                        stats.rating || null,
                        stats.goals || 0,
                        stats.assists || 0,
                        stats.goalsAssistsSum || 0,
                        stats.expectedGoals || null,
                        stats.expectedAssists || null,
                        stats.totalShots || 0,
                        stats.shotsOnTarget || 0,
                        stats.keyPasses || 0,
                        stats.totalPasses || 0,
                        stats.accuratePasses || 0,
                        stats.tackles || 0,
                        stats.interceptions || 0,
                        stats.yellowCards || 0,
                        stats.redCards || 0,
                        stats.saves || 0,
                        stats.goalsConceded || 0,
                        stats.cleanSheet || 0,
                        stats.type || 'overall'
                    ]
                );
            } catch (e) {
                if (e.code !== 'ER_DUP_ENTRY') {
                    // Silently fail - don't slow down lineup collection
                }
            }
        }
    } catch (error) {
        // Silently fail
    }
}

    async collectForDate(date, limit = 30) {
        await this.initialize();
        const max = parseInt(limit) || 30;
        
        console.log(`   Date: ${date}, Limit: ${max}`);
        
        // ⚡ Get matches that don't have lineups YET (check both flag and actual data)
        const matches = await db.query(
            `SELECT m.id, ht.name AS home, at.name AS away
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.match_date = ?
            AND m.id NOT IN (SELECT DISTINCT match_id FROM lineups WHERE match_id IS NOT NULL)
            AND m.id NOT IN (SELECT DISTINCT match_id FROM match_formations WHERE match_id IS NOT NULL 
                            AND home_formation IS NOT NULL AND away_formation IS NOT NULL)
            ORDER BY m.match_datetime ASC
            LIMIT ${max}`,
            [date]
        );

        if (matches.length === 0) {
            console.log(`   All matches have lineups for ${date}`);
            await db.close();
            return [];
        }

        console.log(`\n📋 LINEUPS: ${date} - ${matches.length} matches need lineups\n`);

        let success = 0, skipped = 0;
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            console.log(`   [${i+1}/${matches.length}] ${m.home} vs ${m.away}`);
            const result = await this.collectForMatch(m.id);
            if (result.success) success++;
            else if (result.skipped) skipped++;
            await this.delay(2000);
        }

        console.log(`\n✅ ${success} collected, ${skipped} skipped`);
        await db.close();
        return { success, skipped };
    }
}

if (require.main === module) {
    const collector = new LineupsCollector();
    const args = process.argv.slice(2);
    (async () => {
        try {
            if (args.includes('--date')) {
                const dateIndex = args.indexOf('--date');
                const date = args[dateIndex + 1];
                const limit = args[dateIndex + 2] || 30;
                await collector.collectForDate(date, limit);
            } else if (args[0] && !isNaN(parseInt(args[0]))) {
                const r = await collector.collectForMatch(parseInt(args[0]));
                console.log(JSON.stringify(r, null, 2));
            } else {
                console.log('Usage:');
                console.log('  node collectors/lineupsCollector.js <matchId>');
                console.log('  node collectors/lineupsCollector.js --date YYYY-MM-DD [limit]');
                console.log('Example:');
                console.log('  node collectors/lineupsCollector.js --date 2026-05-10 30');
            }
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
        process.exit(0);
    })();
}

module.exports = new LineupsCollector();