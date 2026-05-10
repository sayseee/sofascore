const db = require('../config/database');

class OddsController {
    async getMatchOdds(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            const odds = await db.query(`
                SELECT mo.*, b.name as bookmaker_name
                FROM match_odds mo
                JOIN bookmakers b ON mo.bookmaker_id = b.id
                WHERE mo.match_id = ?
                ORDER BY mo.timestamp_recorded DESC LIMIT 20
            `, [matchId]);
            res.json({ success: true, data: odds });
        } catch (error) { next(error); }
    }

    async getWinningOdds(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            const odds = await db.query(`
                SELECT * FROM winning_odds
                WHERE match_id = ?
                ORDER BY timestamp_recorded DESC LIMIT 1
            `, [matchId]);

            if (odds.length === 0) {
                return res.json({ success: true, data: { message: 'No winning odds available' } });
            }

            const data = odds[0];
            res.json({
                success: true,
                data: {
                    matchId,
                    home: {
                        expectedProbability: data.home_expected_probability,
                        actualProbability: data.home_actual_probability,
                        edge: `${data.home_edge_percentage > 0 ? '+' : ''}${data.home_edge_percentage}%`,
                        edgeType: data.home_edge_type,
                        isValue: data.home_is_value === 1
                    },
                    away: {
                        expectedProbability: data.away_expected_probability,
                        actualProbability: data.away_actual_probability,
                        edge: `${data.away_edge_percentage > 0 ? '+' : ''}${data.away_edge_percentage}%`,
                        edgeType: data.away_edge_type,
                        isValue: data.away_is_value === 1
                    }
                }
            });
        } catch (error) { next(error); }
    }

    async getWinningOddsHistory(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            const history = await db.query(`
                SELECT timestamp_recorded, home_edge_percentage, away_edge_percentage,
                       home_edge_type, away_edge_type
                FROM winning_odds
                WHERE match_id = ?
                ORDER BY timestamp_recorded DESC LIMIT 30
            `, [matchId]);
            res.json({ success: true, data: history });
        } catch (error) { next(error); }
    }

    async getMatchesWithEdges(req, res, next) {
        try {
            const matches = await db.query(`
                SELECT wo.*, m.id as match_id,
                       ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name, m.match_datetime
                FROM winning_odds wo
                JOIN matches m ON wo.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE (wo.home_is_value = 1 OR wo.away_is_value = 1)
                AND wo.timestamp_recorded > DATE_SUB(NOW(), INTERVAL 12 HOUR)
                AND m.match_datetime > NOW()
                ORDER BY GREATEST(wo.home_edge_percentage, wo.away_edge_percentage) DESC
                LIMIT 20
            `);

            res.json({
                success: true,
                data: matches.map(m => ({
                    matchId: m.match_id,
                    homeTeam: m.home_team_name,
                    awayTeam: m.away_team_name,
                    tournament: m.tournament_name,
                    matchDatetime: m.match_datetime,
                    homeEdge: `${m.home_edge_percentage > 0 ? '+' : ''}${m.home_edge_percentage}%`,
                    awayEdge: `${m.away_edge_percentage > 0 ? '+' : ''}${m.away_edge_percentage}%`
                }))
            });
        } catch (error) { next(error); }
    }

    async compareOdds(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            const [winningOdds, matchOdds] = await Promise.all([
                db.query('SELECT * FROM winning_odds WHERE match_id = ? ORDER BY timestamp_recorded DESC LIMIT 1', [matchId]),
                db.query('SELECT AVG(home_value) as home, AVG(draw_value) as draw, AVG(away_value) as away FROM match_odds WHERE match_id = ?', [matchId])
            ]);

            res.json({
                success: true,
                data: {
                    winningOdds: winningOdds[0] || null,
                    averageOdds: matchOdds[0] || null
                }
            });
        } catch (error) { next(error); }
    }
}

module.exports = new OddsController();

