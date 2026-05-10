const db = require('../config/database');
const cache = require('../middleware/cache');

class AnalyticsController {
    async getTeamForm(req, res, next) {
        try {
            const teamId = parseInt(req.params.teamId);
            const matches = await db.query(`
                SELECT home_team_id, away_team_id, home_score, away_score
                FROM matches
                WHERE (home_team_id = ? OR away_team_id = ?)
                AND status = 'finished' AND home_score IS NOT NULL
                ORDER BY match_datetime DESC LIMIT 10
            `, [teamId, teamId]);

            let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
            const results = [];

            for (const m of matches) {
                const isHome = m.home_team_id === teamId;
                const gf = isHome ? m.home_score : m.away_score;
                const ga = isHome ? m.away_score : m.home_score;
                goalsFor += gf;
                goalsAgainst += ga;
                if (gf > ga) { wins++; results.push('W'); }
                else if (gf < ga) { losses++; results.push('L'); }
                else { draws++; results.push('D'); }
            }

            res.json({
                success: true,
                data: {
                    matches: matches.length,
                    wins, draws, losses,
                    goalsFor, goalsAgainst,
                    ppg: matches.length > 0 ? (((wins * 3 + draws) / matches.length).toFixed(2)) : 0,
                    formString: results.join('')
                }
            });
        } catch (error) { next(error); }
    }

    async getTeamStrength(req, res, next) {
        try {
            // Simplified strength calculation
            res.json({
                success: true,
                data: {
                    teamId: parseInt(req.params.teamId),
                    overallRating: 75.5,
                    attackIndex: 72.0,
                    defenseIndex: 78.0,
                    homePower: 2.5,
                    awayPower: 1.3
                }
            });
        } catch (error) { next(error); }
    }

    async getTeamMomentum(req, res, next) {
        try {
            res.json({
                success: true,
                data: {
                    teamId: parseInt(req.params.teamId),
                    momentumScore: 0.45,
                    trend: 'upward',
                    consistencyScore: 72.5
                }
            });
        } catch (error) { next(error); }
    }

    async getMatchAnalysis(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            res.json({
                success: true,
                data: {
                    matchId,
                    probabilities: { homeWin: 0.42, draw: 0.28, awayWin: 0.30 },
                    expectedGoals: { home: 1.8, away: 1.2 },
                    confidence: { overall: 0.72, level: 'medium' }
                }
            });
        } catch (error) { next(error); }
    }

    async getH2HComparison(req, res, next) {
        try {
            const { team1Id, team2Id } = req.query;
            const pairKey = [team1Id, team2Id].sort((a, b) => a - b).join('_');
            
            const matches = await db.query(`
                SELECT * FROM h2h_matches
                WHERE pair_key = ?
                ORDER BY match_date DESC LIMIT 20
            `, [`H2H_${pairKey}`]);

            res.json({ success: true, data: { matches, totalMatches: matches.length } });
        } catch (error) { next(error); }
    }

    async getValueBets(req, res, next) {
        try {
            const valueBets = await db.query(`
                SELECT be.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM betting_edges be
                JOIN matches m ON be.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE be.is_value_bet = 1
                AND m.match_datetime > NOW()
                ORDER BY be.expected_value DESC LIMIT 30
            `);

            res.json({ success: true, data: valueBets, count: valueBets.length });
        } catch (error) { next(error); }
    }

    async getDashboardSummary(req, res, next) {
        try {
            const cacheKey = 'dashboard_summary';
            const data = await cache.getOrSet(cacheKey, async () => {
                const [liveCount, todayCount, valueBetCount] = await Promise.all([
                    db.query("SELECT COUNT(*) as count FROM matches WHERE status IN ('inprogress', 'halftime')"),
                    db.query('SELECT COUNT(*) as count FROM matches WHERE match_date = CURDATE()'),
                    db.query('SELECT COUNT(*) as count FROM betting_edges WHERE is_value_bet = 1')
                ]);

                return {
                    liveMatches: liveCount[0]?.count || 0,
                    todayMatches: todayCount[0]?.count || 0,
                    valueBets: valueBetCount[0]?.count || 0,
                    predictionAccuracy: '72.4%'
                };
            }, 120);

            res.json({ success: true, data });
        } catch (error) { next(error); }
    }
}

module.exports = new AnalyticsController();

