/**
 * Team Players & Injuries Collector
 * Endpoint: /team/{teamId}/players
 * 
 * Response: { players: [{ player: { name, position, injury: {...} } }] }
 * Injuries are embedded in player objects when present
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class TeamPlayersCollector {
    constructor() {
        this.collectorName = 'team_players_collector';
    }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async collectForTeam(teamId) {
        try {
            await this.initialize();
            
            const teams = await db.query(
                'SELECT id, sofascore_team_id, name FROM teams WHERE id = ?',
                [teamId]
            );
            if (teams.length === 0) return { success: false, error: 'Team not found' };

            const team = teams[0];
            const endpoint = `/team/${team.sofascore_team_id}/players`;
            console.log(`👥 Players: ${team.name} (ID: ${team.sofascore_team_id})`);
            
            const response = await httpClient.get(endpoint);
            if (!response || !response.players) {
                console.log('   No players data');
                return { success: false, error: 'No data' };
            }

            let playersInserted = 0;
            let injuriesInserted = 0;

            // Clear old injuries for this team
            await db.query('DELETE FROM injuries WHERE team_id = ?', [teamId]);

            for (const entry of response.players) {
                const player = entry.player;
                if (!player || !player.id) continue;

                // Upsert player
                await db.query(
                    `INSERT INTO players (sofascore_player_id, team_id, name, position, jersey_number, 
                    height_cm, preferred_foot, birth_date, country)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    name = VALUES(name), position = VALUES(position), 
                    jersey_number = VALUES(jersey_number), team_id = VALUES(team_id)`,
                    [
                        player.id,
                        teamId,
                        player.name || 'Unknown',
                        player.position || null,
                        player.jerseyNumber || player.shirtNumber || null,
                        player.height || null,
                        player.preferredFoot || null,
                        player.dateOfBirth ? player.dateOfBirth.split('T')[0] : null,
                        player.country?.name || null
                    ]
                );
                playersInserted++;

                // Check for injury data
                if (player.injury) {
                    const injury = player.injury;
                    
                    // Get the player's database ID
                    const playerRow = await db.query(
                        'SELECT id FROM players WHERE sofascore_player_id = ?',
                        [player.id]
                    );
                    const playerDbId = playerRow[0]?.id || null;

                    await db.query(
                        `INSERT INTO injuries (team_id, player_id, player_name, injury_type, 
                        injury_description, expected_return_date, status, severity, recorded_date)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
                        [
                            teamId,
                            playerDbId,
                            player.name || 'Unknown',
                            injury.reason || injury.type || 'Unknown',
                            injury.reason || null,
                            injury.expectedReturnDateData 
                                ? `${injury.expectedReturnDateData.year}-${String(injury.expectedReturnDateData.month).padStart(2, '0')}-01`
                                : null,
                            injury.status === 'out' ? 'active' : 'doubtful',
                            injury.expectedReturn && injury.expectedReturn > 30 ? 'severe' : 
                            injury.expectedReturn && injury.expectedReturn > 14 ? 'medium' : 'minor'
                        ]
                    );
                    injuriesInserted++;
                }
            }

            console.log(`   ✅ ${playersInserted} players, ${injuriesInserted} injuries`);
            
            // Update matches_played count for injured players
            if (injuriesInserted > 0) {
                await db.query(
                    `UPDATE injuries i
                    JOIN players p ON i.player_id = p.id
                    SET i.matches_missed = (
                        SELECT COUNT(*) FROM matches m
                        WHERE (m.home_team_id = i.team_id OR m.away_team_id = i.team_id)
                        AND m.match_date > i.recorded_date
                        AND m.status IN (100, 101, 102)
                    )
                    WHERE i.team_id = ? AND i.status = 'active'`,
                    [teamId]
                );
            }

            return { success: true, playersInserted, injuriesInserted };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async collectAllTeams() {
        await this.initialize();
        const teams = await db.query('SELECT id, name FROM teams ORDER BY name');
        
        console.log(`\n👥 Collecting players for ${teams.length} teams\n`);
        
        let totalPlayers = 0, totalInjuries = 0;
        
        for (const team of teams) {
            const result = await this.collectForTeam(team.id);
            if (result.success) {
                totalPlayers += result.playersInserted;
                totalInjuries += result.injuriesInserted;
            }
            await this.delay(2000);
        }
        
        console.log(`\n✅ ${totalPlayers} players, ${totalInjuries} injuries`);
        await db.close();
    }

    async collectForUpcomingMatches() {
        await this.initialize();
        
        const teams = await db.query(
            `SELECT DISTINCT t.id, t.name
            FROM matches m
            JOIN teams t ON (m.home_team_id = t.id OR m.away_team_id = t.id)
            WHERE m.match_datetime > NOW()
            AND m.match_datetime < DATE_ADD(NOW(), INTERVAL 7 DAY)
            ORDER BY t.name`
        );

        console.log(`\n👥 Players for ${teams.length} teams with upcoming matches\n`);

        for (const team of teams) {
            await this.collectForTeam(team.id);
            await this.delay(2000);
        }

        await db.close();
    }
}

if (require.main === module) {
    const collector = new TeamPlayersCollector();
    const arg = process.argv[2];
    (async () => {
        if (arg === '--all') {
            await collector.collectAllTeams();
        } else if (arg === '--upcoming') {
            await collector.collectForUpcomingMatches();
        } else if (arg && !isNaN(arg)) {
            const r = await collector.collectForTeam(parseInt(arg));
            console.log(JSON.stringify(r));
        } else {
            console.log('Usage:');
            console.log('  node collectors/teamPlayersCollector.js <teamId>');
            console.log('  node collectors/teamPlayersCollector.js --all');
            console.log('  node collectors/teamPlayersCollector.js --upcoming');
        }
        process.exit(0);
    })();
}

module.exports = new TeamPlayersCollector();