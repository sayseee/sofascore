const db = require('../config/database');
const cache = require('../middleware/cache');

class MatchController {
    async getLiveMatches(req, res, next) {
        try {
            const cacheKey = 'live_matches';
            const matches = await cache.getOrSet(cacheKey, async () => {
                return db.query(`
                    SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                           t.name as tournament_name
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id
                    JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    WHERE m.status IN ('6', '7', 'inprogress', 'halftime', 'live')
                    ORDER BY m.match_datetime ASC LIMIT 50
                `);
            }, 60);
            res.json({ success: true, data: matches || [] });
        } catch (error) { next(error); }
    }

    async getMatchesByDate(req, res, next) {
        try {
            const { date } = req.query;
            const matchDate = date || new Date().toISOString().split('T')[0];
            
            const matches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE m.match_date = ?
                ORDER BY m.match_datetime ASC
            `, [matchDate]);
            
            res.json({ success: true, data: matches || [] });
        } catch (error) { next(error); }
    }

    async getUpcomingMatches(req, res, next) {
        try {
            const { days = 7 } = req.query;
            const matches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE m.match_datetime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
                AND m.status NOT IN ('100', 'finished', 'cancelled', 'postponed', 'Ended')
                ORDER BY m.match_datetime ASC LIMIT 100
            `, [parseInt(days)]);
            
            res.json({ success: true, data: matches || [] });
        } catch (error) { next(error); }
    }

    async getRecentMatches(req, res, next) {
        try {
            const { limit = 20 } = req.query;
            const matches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE (m.status = '100' OR m.status = 'finished' OR m.status_description = 'Ended')
                AND m.home_score IS NOT NULL
                ORDER BY m.match_datetime DESC LIMIT ?
            `, [parseInt(limit)]);
            
            res.json({ success: true, data: matches || [] });
        } catch (error) { next(error); }
    }

    async searchMatches(req, res, next) {
        try {
            const { q } = req.query;
            const searchTerm = `%${q}%`;
            const matches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                WHERE ht.name LIKE ? OR at.name LIKE ?
                ORDER BY m.match_datetime DESC LIMIT 30
            `, [searchTerm, searchTerm]);
            
            res.json({ success: true, data: matches || [] });
        } catch (error) { next(error); }
    }

    async getMatchById(req, res, next) {
        try {
            const matchId = parseInt(req.params.id);
            const matches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name, s.name as season_name
                FROM matches m
                LEFT JOIN teams ht ON m.home_team_id = ht.id
                LEFT JOIN teams at ON m.away_team_id = at.id
                LEFT JOIN tournaments t ON m.tournament_id = t.id
                LEFT JOIN seasons s ON m.season_id = s.id
                WHERE m.id = ?
            `, [matchId]);

            if (matches.length === 0) {
                return res.status(404).json({ success: false, error: 'Match not found' });
            }

            res.json({ success: true, data: matches[0] });
        } catch (error) { next(error); }
    }
}

module.exports = new MatchController();