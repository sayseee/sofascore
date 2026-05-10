const db = require('../config/database');

class TeamController {
    async getTeamById(req, res, next) {
        try {
            const teamId = parseInt(req.params.id);
            const teams = await db.query('SELECT * FROM teams WHERE id = ?', [teamId]);

            if (teams.length === 0) {
                return res.status(404).json({ success: false, error: 'Team not found' });
            }

            const team = teams[0];

            // Get recent matches
            team.recentMatches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE (m.home_team_id = ? OR m.away_team_id = ?)
                AND m.status = 'finished'
                ORDER BY m.match_datetime DESC LIMIT 10
            `, [teamId, teamId]);

            // Get upcoming matches
            team.upcomingMatches = await db.query(`
                SELECT m.*, ht.name as home_team_name, at.name as away_team_name,
                       t.name as tournament_name
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE (m.home_team_id = ? OR m.away_team_id = ?)
                AND m.match_datetime > NOW()
                ORDER BY m.match_datetime ASC LIMIT 5
            `, [teamId, teamId]);

            res.json({ success: true, data: team });
        } catch (error) { next(error); }
    }

    async searchTeams(req, res, next) {
        try {
            const { q } = req.query;
            const searchTerm = `%${q}%`;
            const teams = await db.query(
                'SELECT * FROM teams WHERE name LIKE ? OR short_name LIKE ? ORDER BY name LIMIT 20',
                [searchTerm, searchTerm]
            );
            res.json({ success: true, data: teams });
        } catch (error) { next(error); }
    }
}

module.exports = new TeamController();

