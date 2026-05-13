/**
 * Team Strength Service
 * Calculates real-time team strength from lineups + player stats
 */
const db = require('../config/database');

class TeamStrengthService {

    /**
     * Calculate team strength for a specific match
     */
    async calculateMatchStrength(matchId) {
    console.log(`\n🔍 [STRENGTH DEBUG] Starting strength calculation for match ID: ${matchId}`);
    
    try {
        // Try by database ID first, then by Sofascore ID
        console.log(`📝 [STRENGTH DEBUG] Looking up match ${matchId}...`);
        let match = await db.query(`
            SELECT m.*, ht.name AS home_name, at.name AS away_name
            FROM matches m
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            WHERE m.id = ?
        `, [matchId]);

        if (match.length === 0) {
            console.log(`⚠️ [STRENGTH DEBUG] Match not found by ID, trying Sofascore ID...`);
            match = await db.query(`
                SELECT m.*, ht.name AS home_name, at.name AS away_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                WHERE m.sofascore_match_id = ?
            `, [matchId]);
        }

        if (match.length === 0) {
            console.log(`❌ [STRENGTH DEBUG] Match ${matchId} not found in database`);
            return null;
        }
        
        const m = match[0];
        console.log(`✅ [STRENGTH DEBUG] Found match: ${m.home_name} vs ${m.away_name} (ID: ${m.id})`);
        console.log(`   Tournament: ${m.tournament_name}, Date: ${m.match_date}`);

        // Check if lineups exist
        console.log(`🔍 [STRENGTH DEBUG] Checking for lineups in match ${m.id}...`);
        const lineupCheck = await db.query(
            'SELECT COUNT(*) as c FROM lineups WHERE match_id = ?',
            [m.id]
        );
        
        const lineupCount = lineupCheck[0]?.c || 0;
        console.log(`📊 [STRENGTH DEBUG] Found ${lineupCount} lineup records for match ${m.id}`);
        
        // If no lineups, try to calculate strength from team statistics
        if (lineupCount === 0) {
            console.log(`⚠️ [STRENGTH DEBUG] No lineups found, falling back to team statistics calculation`);
            return await this.calculateStrengthFromTeamStats(m.id, m.home_team_id, m.away_team_id, m);
        }

        console.log(`✅ [STRENGTH DEBUG] Lineups found, calculating detailed strength...`);
        
        // Get lineups with player stats
        console.log(`📊 [STRENGTH DEBUG] Calculating home team strength for ${m.home_name}...`);
        const homeStrength = await this.calculateTeamStrength(m.id, m.home_team_id);
        console.log(`   Home strength result:`, homeStrength);
        
        console.log(`📊 [STRENGTH DEBUG] Calculating away team strength for ${m.away_name}...`);
        const awayStrength = await this.calculateTeamStrength(m.id, m.away_team_id);
        console.log(`   Away strength result:`, awayStrength);

        // Get missing players
        console.log(`🔍 [STRENGTH DEBUG] Checking for missing players...`);
        const homeMissing = await this.getMissingPlayers(m.id, m.home_team_id) || [];
        const awayMissing = await this.getMissingPlayers(m.id, m.away_team_id) || [];
        console.log(`   Home missing: ${homeMissing.length} players`, homeMissing);
        console.log(`   Away missing: ${awayMissing.length} players`, awayMissing);

        // Get formation effectiveness
        console.log(`🔍 [STRENGTH DEBUG] Checking formation data...`);
        const formationData = await this.getFormationMatchup(m.id);
        console.log(`   Formation data:`, formationData);

        // Calculate adjusted strength
        const homeTotal = parseFloat(homeStrength.total) || 0;
        const awayTotal = parseFloat(awayStrength.total) || 0;
        
        const homePenalty = homeMissing.length * 1.5;
        const awayPenalty = awayMissing.length * 1.5;
        const homeBonus = 2.0;
        
        const homeAdjusted = homeTotal - homePenalty + homeBonus;
        const awayAdjusted = awayTotal - awayPenalty;

        const strengthDiff = homeAdjusted - awayAdjusted;
        const adjustedHomeProb = Math.min(Math.max(0.15, 0.35 + strengthDiff / 100), 0.55);
        
        console.log(`📊 [STRENGTH DEBUG] Final calculations:`);
        console.log(`   Home total: ${homeTotal}, Penalty: ${homePenalty}, Bonus: ${homeBonus}, Adjusted: ${homeAdjusted}`);
        console.log(`   Away total: ${awayTotal}, Penalty: ${awayPenalty}, Adjusted: ${awayAdjusted}`);
        console.log(`   Strength diff: ${strengthDiff}, Home prob: ${adjustedHomeProb}`);

        const result = {
            matchId: m.id,
            home: {
                team: m.home_name,
                startingXIStrength: homeStrength.averageRating,
                totalStrength: homeAdjusted.toFixed(1),
                keyPlayers: homeStrength.topPlayers || [],
                missingPlayers: homeMissing,
                formation: formationData?.home_formation,
                formationWinRate: formationData?.home_formation_win_rate
            },
            away: {
                team: m.away_name,
                startingXIStrength: awayStrength.averageRating,
                totalStrength: awayAdjusted.toFixed(1),
                keyPlayers: awayStrength.topPlayers || [],
                missingPlayers: awayMissing,
                formation: formationData?.away_formation,
                formationWinRate: formationData?.away_formation_win_rate
            },
            analysis: {
                strengthDifference: strengthDiff.toFixed(1),
                homeAdvantage: homeAdjusted > awayAdjusted ? 'Stronger' : 'Weaker',
                adjustedHomeProbability: (adjustedHomeProb * 100).toFixed(1) + '%',
                confidence: Math.abs(strengthDiff) > 15 ? 'high' : Math.abs(strengthDiff) > 7 ? 'medium' : 'low'
            }
        };
        
        console.log(`✅ [STRENGTH DEBUG] Final result:`, JSON.stringify(result, null, 2));
        return result;
        
    } catch (error) {
        console.error(`❌ [STRENGTH DEBUG] Error in calculateMatchStrength:`, error.message);
        console.error(error.stack);
        return null;
    }
}

    /**
     * Calculate strength from team statistics when lineups aren't available
     */
    async calculateStrengthFromTeamStats(matchId, homeTeamId, awayTeamId, match) {
    console.log(`📊 [STRENGTH DEBUG] Calculating from team stats for match ${matchId}`);
    
    try {
        // Get team statistics from matches
        const [homeStats, awayStats] = await Promise.all([
            this.getTeamOverallStats(homeTeamId),
            this.getTeamOverallStats(awayTeamId)
        ]);
        
        console.log(`   Home stats:`, homeStats);
        console.log(`   Away stats:`, awayStats);
        
        // Calculate strength based on form and performance
        const homeWinRate = homeStats.winRate || 0;
        const awayWinRate = awayStats.winRate || 0;
        const homePPG = homeStats.ppg || 0;
        const awayPPG = awayStats.ppg || 0;
        const homeGoalsAvg = homeStats.avgGoalsScored || 0;
        const awayGoalsAvg = awayStats.avgGoalsScored || 0;
        
        // Calculate strength scores (0-100 scale)
        const homeStrength = Math.min(100, Math.round(
            (homeWinRate * 60) + (homePPG * 10) + (homeGoalsAvg * 10)
        ));
        
        const awayStrength = Math.min(100, Math.round(
            (awayWinRate * 60) + (awayPPG * 10) + (awayGoalsAvg * 10)
        ));
        
        const strengthDiff = homeStrength - awayStrength;
        const homeAdvantage = 2.0; // Home field advantage
        const homeAdjusted = homeStrength + homeAdvantage;
        const awayAdjusted = awayStrength;
        const adjustedHomeProb = Math.min(Math.max(0.15, 0.35 + (homeAdjusted - awayAdjusted) / 100), 0.55);
        
        console.log(`   Calculated strengths - Home: ${homeStrength}, Away: ${awayStrength}`);
        console.log(`   Adjusted - Home: ${homeAdjusted}, Away: ${awayAdjusted}`);
        
        return {
            matchId: parseInt(matchId),
            home: {
                team: match.home_name,
                startingXIStrength: 'From Stats',
                totalStrength: homeAdjusted.toFixed(1),
                keyPlayers: [],
                missingPlayers: [],
                formation: homeStats.mostUsedFormation || 'Unknown',
                formationWinRate: homeStats.formationWinRate || null
            },
            away: {
                team: match.away_name,
                startingXIStrength: 'From Stats',
                totalStrength: awayAdjusted.toFixed(1),
                keyPlayers: [],
                missingPlayers: [],
                formation: awayStats.mostUsedFormation || 'Unknown',
                formationWinRate: awayStats.formationWinRate || null
            },
            analysis: {
                strengthDifference: (homeAdjusted - awayAdjusted).toFixed(1),
                homeAdvantage: homeAdjusted > awayAdjusted ? 'Stronger' : 'Weaker',
                adjustedHomeProbability: (adjustedHomeProb * 100).toFixed(1) + '%',
                confidence: Math.abs(strengthDiff) > 15 ? 'high' : Math.abs(strengthDiff) > 7 ? 'medium' : 'low',
                note: 'Calculated from team statistics (no lineup data available)'
            }
        };
    } catch (error) {
        console.error(`❌ [STRENGTH DEBUG] Error in calculateStrengthFromTeamStats:`, error.message);
        // Return basic fallback
        return {
            matchId: parseInt(matchId),
            home: {
                team: match.home_name,
                startingXIStrength: 'N/A',
                totalStrength: '50',
                keyPlayers: [],
                missingPlayers: [],
                formation: null,
                formationWinRate: null
            },
            away: {
                team: match.away_name,
                startingXIStrength: 'N/A',
                totalStrength: '50',
                keyPlayers: [],
                missingPlayers: [],
                formation: null,
                formationWinRate: null
            },
            analysis: {
                strengthDifference: '0',
                homeAdvantage: 'Even',
                adjustedHomeProbability: '33.3%',
                confidence: 'low',
                note: 'Limited data available'
            }
        };
    }
}

    /**
     * Get overall team statistics
     */
    async getTeamOverallStats(teamId) {
    console.log(`   📊 Getting overall stats for team ${teamId}`);
    
    try {
        // Get recent matches (last 10)
        const matches = await db.query(`
            SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score,
                   m.match_datetime
            FROM matches m
            WHERE (m.home_team_id = ? OR m.away_team_id = ?)
            AND m.status IN (100, 101, 102)
            AND m.home_score IS NOT NULL
            ORDER BY m.match_datetime DESC
            LIMIT 10
        `, [teamId, teamId]);
        
        console.log(`      Found ${matches.length} recent matches for team ${teamId}`);
        
        if (matches.length === 0) {
            return { winRate: 0, ppg: 0, avgGoalsScored: 0, avgGoalsConceded: 0 };
        }
        
        let wins = 0, draws = 0, losses = 0;
        let goalsScored = 0, goalsConceded = 0;
        
        for (const m of matches) {
            const isHome = m.home_team_id === teamId;
            const scored = isHome ? m.home_score : m.away_score;
            const conceded = isHome ? m.away_score : m.home_score;
            
            goalsScored += scored;
            goalsConceded += conceded;
            
            if (scored > conceded) wins++;
            else if (scored < conceded) losses++;
            else draws++;
        }
        
        const totalMatches = matches.length;
        const winRate = (wins / totalMatches) * 100;
        const ppg = ((wins * 3) + draws) / totalMatches;
        const avgGoalsScored = goalsScored / totalMatches;
        const avgGoalsConceded = goalsConceded / totalMatches;
        
        console.log(`      Stats - Wins: ${wins}, Draws: ${draws}, Losses: ${losses}`);
        console.log(`      Win Rate: ${winRate.toFixed(1)}%, PPG: ${ppg.toFixed(2)}`);
        console.log(`      Goals - Scored: ${avgGoalsScored.toFixed(2)}, Conceded: ${avgGoalsConceded.toFixed(2)}`);
        
        // Try to get most used formation
        let mostUsedFormation = null;
        let formationWinRate = null;
        
        try {
            const formationStats = await db.query(`
                SELECT formation, COUNT(*) as count, 
                       SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) as wins
                FROM match_formations mf
                JOIN matches m ON mf.match_id = m.id
                WHERE (mf.home_team_id = ? OR mf.away_team_id = ?)
                AND m.status IN (100, 101, 102)
                GROUP BY formation
                ORDER BY count DESC
                LIMIT 1
            `, [teamId, teamId]);
            
            if (formationStats.length > 0) {
                mostUsedFormation = formationStats[0].formation;
                const total = formationStats[0].count;
                const winsCount = formationStats[0].wins || 0;
                formationWinRate = ((winsCount / total) * 100).toFixed(1) + '%';
                console.log(`      Most used formation: ${mostUsedFormation} (${formationWinRate} win rate)`);
            }
        } catch (err) {
            console.log(`      Could not get formation data: ${err.message}`);
        }
        
        return {
            winRate: winRate,
            ppg: ppg,
            avgGoalsScored: avgGoalsScored,
            avgGoalsConceded: avgGoalsConceded,
            totalMatches: totalMatches,
            wins: wins,
            draws: draws,
            losses: losses,
            mostUsedFormation: mostUsedFormation,
            formationWinRate: formationWinRate
        };
        
    } catch (error) {
        console.error(`      Error getting team stats:`, error.message);
        return { winRate: 0, ppg: 0, avgGoalsScored: 0, avgGoalsConceded: 0 };
    }
}

    /**
     * Calculate team strength from starting XI
     */
    /**
 * Calculate team strength from starting XI using player_strength_view
 */
async calculateTeamStrength(matchId, teamId) {
    console.log(`      🔍 Querying players for match ${matchId}, team ${teamId}`);
    
    // First get the starting XI players from lineups
    const startingPlayers = await db.query(`
        SELECT l.player_id, l.is_starting
        FROM lineups l
        WHERE l.match_id = ? AND l.team_id = ? AND l.is_starting = 1
    `, [matchId, teamId]);

    console.log(`      Found ${startingPlayers.length} starting player IDs`);
    
    if (startingPlayers.length === 0) {
        console.log(`      ⚠️ No starting players found, returning default`);
        return { averageRating: '0.00', total: '0.0', topPlayers: [] };
    }

    // Now get their strengths from the view
    const playerIds = startingPlayers.map(p => p.player_id);
    const placeholders = playerIds.map(() => '?').join(',');
    
    const players = await db.query(`
        SELECT 
            psv.player_id,
            psv.name,
            psv.position,
            psv.avg_rating,
            psv.total_goals,
            psv.total_assists,
            psv.appearances,
            psv.position_weight
        FROM player_strength_view psv
        WHERE psv.player_id IN (${placeholders})
    `, playerIds);

    console.log(`      Found ${players.length} players with strength data`);
    
    if (players.length === 0) {
        console.log(`      ⚠️ No strength data found for players`);
        return { averageRating: '0.00', total: '0.0', topPlayers: [] };
    }

    let totalRating = 0;
    let totalStrength = 0;
    const playerDetails = [];

    players.forEach(p => {
        const rating = parseFloat(p.avg_rating) || 6.0;
        const positionWeight = parseFloat(p.position_weight) || this.getPositionWeight(p.position);
        const goals = parseInt(p.total_goals) || 0;
        const assists = parseInt(p.total_assists) || 0;
        const appearances = parseInt(p.appearances) || 1;
        
        // Calculate experience bonus (capped at 0.3)
        const experienceBonus = Math.min(appearances / 100, 0.3);
        
        // Calculate goal contribution (capped at 2.0)
        const goalContribution = Math.min((goals + assists * 0.7) / Math.max(appearances, 1), 2.0);
        
        // Calculate player strength (base rating * position weight + bonuses)
        const playerStrength = Math.min(rating * positionWeight + experienceBonus + goalContribution, 12.0);
        
        totalRating += rating;
        totalStrength += playerStrength;
        
        playerDetails.push({
            name: p.name,
            position: p.position,
            rating: rating.toFixed(1),
            strength: playerStrength.toFixed(2),
            goals: goals,
            assists: assists,
            appearances: appearances
        });
        
        console.log(`         ${p.name} (${p.position}): rating=${rating}, weight=${positionWeight}, strength=${playerStrength.toFixed(2)}`);
    });

    const averageRating = (totalRating / players.length).toFixed(1);
    const avgStrength = totalStrength / players.length;
    const total = Math.round((avgStrength / 10) * 100); // Scale to 0-100

    // Top 3 key players (by rating)
    const topPlayers = playerDetails
        .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
        .slice(0, 3)
        .map(p => ({ 
            name: p.name, 
            position: p.position, 
            rating: p.rating,
            strength: p.strength
        }));

    console.log(`      Team strength result: avgRating=${averageRating}, total=${total}, topPlayers=${topPlayers.length}`);
    
    return { 
        averageRating, 
        total: total.toString(), 
        topPlayers,
        playerDetails 
    };
}

    /**
     * Get missing players for a match
     */
    async getMissingPlayers(matchId, teamId) {
        console.log(`      🔍 Checking missing players for match ${matchId}, team ${teamId}`);
        const result = await db.query(`
            SELECT player_name, reason, description
            FROM match_missing_players
            WHERE match_id = ? AND team_id = ?
        `, [matchId, teamId]);
        console.log(`      Found ${result.length} missing players`);
        return result;
    }

    /**
 * Get formation matchup data
 */
async getFormationMatchup(matchId) {
    console.log(`      🔍 Getting formation data for match ${matchId}`);
    
    try {
        // Try to get formation from match_formations table
        const result = await db.query(`
            SELECT home_formation, away_formation
            FROM match_formations
            WHERE match_id = ?
        `, [matchId]);
        
        if (result.length > 0 && (result[0].home_formation || result[0].away_formation)) {
            console.log(`      Found formation data: Home=${result[0].home_formation}, Away=${result[0].away_formation}`);
            return {
                home_formation: result[0].home_formation,
                away_formation: result[0].away_formation,
                home_formation_win_rate: null,
                away_formation_win_rate: null
            };
        }
        
        // If no formation data, try to infer from player positions
        console.log(`      No formation data in match_formations, trying to infer from lineups...`);
        
        // Get positions of starting players
        const homePositions = await db.query(`
            SELECT p.position, COUNT(*) as count
            FROM lineups l
            JOIN players p ON l.player_id = p.id
            WHERE l.match_id = ? AND l.team_id = (SELECT home_team_id FROM matches WHERE id = ?) AND l.is_starting = 1
            GROUP BY p.position
        `, [matchId, matchId]);
        
        const awayPositions = await db.query(`
            SELECT p.position, COUNT(*) as count
            FROM lineups l
            JOIN players p ON l.player_id = p.id
            WHERE l.match_id = ? AND l.team_id = (SELECT away_team_id FROM matches WHERE id = ?) AND l.is_starting = 1
            GROUP BY p.position
        `, [matchId, matchId]);
        
        // Infer formation from position counts
        const homeFormation = this.inferFormation(homePositions);
        const awayFormation = this.inferFormation(awayPositions);
        
        console.log(`      Inferred formations: Home=${homeFormation}, Away=${awayFormation}`);
        
        return {
            home_formation: homeFormation,
            away_formation: awayFormation,
            home_formation_win_rate: null,
            away_formation_win_rate: null
        };
        
    } catch (error) {
        console.error(`      Error getting formation:`, error.message);
        return null;
    }
}
/**
 * Infer formation from position counts
 */
inferFormation(positions) {
    const posMap = {};
    positions.forEach(p => {
        posMap[p.position] = parseInt(p.count);
    });
    
    const defenders = posMap['D'] || 0;
    const midfielders = posMap['M'] || 0;
    const forwards = posMap['F'] || 0;
    const goalkeeper = posMap['G'] || 1;
    
    // Common formations
    if (defenders === 4 && midfielders === 4 && forwards === 2) return '4-4-2';
    if (defenders === 4 && midfielders === 3 && forwards === 3) return '4-3-3';
    if (defenders === 4 && midfielders === 5 && forwards === 1) return '4-5-1';
    if (defenders === 3 && midfielders === 5 && forwards === 2) return '3-5-2';
    if (defenders === 3 && midfielders === 4 && forwards === 3) return '3-4-3';
    if (defenders === 5 && midfielders === 3 && forwards === 2) return '5-3-2';
    if (defenders === 4 && midfielders === 2 && forwards === 4) return '4-2-4';
    
    return `${defenders}-${midfielders}-${forwards}`;
}

    /**
     * Adjust strength based on missing players and formation
     */
    adjustStrength(strength, missingPlayers, venue) {
        let adjustedTotal = parseFloat(strength.total) || 0;
        
        // Penalty for missing players
        if (missingPlayers.length > 0) {
            const penalty = missingPlayers.length * 1.5;
            adjustedTotal -= penalty;
        }

        // Home advantage
        if (venue === 'home') {
            adjustedTotal += 2.0;
        }

        return {
            total: adjustedTotal.toFixed(1),
            base: strength.total,
            missingPenalty: missingPlayers.length * 1.5,
            homeBonus: venue === 'home' ? 2.0 : 0
        };
    }

    /**
     * Position weight multiplier
     */
    getPositionWeight(position) {
        const weights = {
            'F': 1.3,   // Forward - highest impact on scoring
            'M': 1.1,   // Midfielder
            'D': 0.9,   // Defender
            'G': 0.8    // Goalkeeper
        };
        return weights[position] || 1.0;
    }
}

module.exports = new TeamStrengthService();