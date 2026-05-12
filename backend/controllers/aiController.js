const db = require('../config/database');

class AIController {
    async askQuestion(req, res, next) {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ success: false, error: 'Question is required' });
        }

        const q = question.toLowerCase();
        let data = [];
        let responseText = '';

        // Home Expected > 50% + Positive Edge
        if (q.includes('home expected') || q.includes('positive edge')) {
            data = await db.query(`
                SELECT ht.name AS home_team, at.name AS away_team,
                       t.name AS tournament, m.match_date,
                       wo.home_expected_percentage, wo.home_actual_percentage,
                       wo.home_edge_percentage, wo.home_edge_type,
                       wo.away_expected_percentage, wo.away_actual_percentage,
                       wo.away_edge_percentage, wo.away_edge_type,
                       wo.home_decimal_odds, wo.away_decimal_odds,
                       wo.market_efficiency_gap
                FROM winning_odds wo
                JOIN matches m ON wo.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE wo.home_expected_percentage > 50 AND wo.home_edge_percentage > 0
                ORDER BY wo.home_edge_percentage DESC LIMIT 10
            `);
            
            if (data.length > 0) {
                responseText = `📊 **${data.length} matches with home expected >50% + positive edge:**\n\n`;
                data.forEach((m, i) => {
                    responseText += `${i+1}. **${m.home_team} vs ${m.away_team}**\n`;
                    responseText += `   🏠 HOME: Expected ${m.home_expected_percentage}% → Actual ${m.home_actual_percentage}% `;
                    responseText += `(${m.home_edge_percentage > 0 ? '+' : ''}${m.home_edge_percentage}% edge) ${m.home_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
                    responseText += `   🛫 AWAY: Expected ${m.away_expected_percentage}% → Actual ${m.away_actual_percentage}% `;
                    responseText += `(${m.away_edge_percentage > 0 ? '+' : ''}${m.away_edge_percentage}% edge) ${m.away_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
                    responseText += `   🎲 Odds: H ${m.home_decimal_odds} | A ${m.away_decimal_odds} | Draw implied: ${m.market_efficiency_gap ? (m.market_efficiency_gap*100).toFixed(0) : '?'}%\n`;
                    responseText += `   🏆 ${m.tournament} | 📅 ${m.match_date}\n\n`;
                });
            } else {
                responseText = 'No matches found with home expected >50% and positive edge.';
            }
        }

        // Value Bets
        else if (q.includes('value bet') || q.includes('high confidence')) {
            data = await db.query(`
                SELECT be.*, ht.name AS home_team_name, at.name AS away_team_name,
                       t.name AS tournament_name, m.match_date,
                       wo.home_expected_percentage, wo.home_actual_percentage,
                       wo.home_edge_percentage, wo.away_expected_percentage,
                       wo.away_actual_percentage, wo.away_edge_percentage
                FROM betting_edges be
                JOIN matches m ON be.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                LEFT JOIN winning_odds wo ON m.id = wo.match_id
                WHERE be.is_value_bet = 1
                ORDER BY be.expected_value DESC LIMIT 10
            `);
            
            if (data.length > 0) {
                responseText = `💎 **${data.length} Value Bets Found:**\n\n`;
                data.forEach((b, i) => {
                    responseText += `${i+1}. **${b.home_team_name} vs ${b.away_team_name}**\n`;
                    responseText += `   Pick: ${b.selection.toUpperCase()} @ ${b.bookmaker_odds}\n`;
                    responseText += `   Edge: +${b.edge_percentage}% | EV: ${b.expected_value > 0 ? '+' : ''}${(b.expected_value*100).toFixed(1)}%\n`;
                    responseText += `   Confidence: ${(b.confidence_level || 'low').toUpperCase()}\n`;
                    if (b.home_edge_percentage !== null) {
                        responseText += `   🏠 H: ${b.home_expected_percentage}%→${b.home_actual_percentage}% (${b.home_edge_percentage > 0 ? '+' : ''}${b.home_edge_percentage}%)\n`;
                        responseText += `   🛫 A: ${b.away_expected_percentage}%→${b.away_actual_percentage}% (${b.away_edge_percentage > 0 ? '+' : ''}${b.away_edge_percentage}%)\n`;
                    }
                    responseText += `   🏆 ${b.tournament_name} | 📅 ${b.match_date}\n\n`;
                });
            } else {
                responseText = 'No value bets found. Run: node jobs/populateBettingEdges.js';
            }
        }

        // Edge > 15%
        else if (q.includes('edge') && q.includes('15')) {
            data = await db.query(`
                SELECT ht.name AS home_team, at.name AS away_team,
                       t.name AS tournament, m.match_date,
                       wo.home_expected_percentage, wo.home_actual_percentage,
                       wo.home_edge_percentage, wo.home_edge_type,
                       wo.away_expected_percentage, wo.away_actual_percentage,
                       wo.away_edge_percentage, wo.away_edge_type,
                       wo.home_decimal_odds, wo.away_decimal_odds
                FROM winning_odds wo
                JOIN matches m ON wo.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE wo.home_edge_percentage > 15 OR wo.away_edge_percentage > 15
                ORDER BY GREATEST(wo.home_edge_percentage, wo.away_edge_percentage) DESC LIMIT 10
            `);
            
            if (data.length > 0) {
                responseText = `🔥 **${data.length} matches with edge >15%:**\n\n`;
                data.forEach((m, i) => {
                    responseText += `${i+1}. **${m.home_team} vs ${m.away_team}**\n`;
                    responseText += `   🏠 HOME: ${m.home_expected_percentage}%→${m.home_actual_percentage}% `;
                    responseText += `(${m.home_edge_percentage > 0 ? '+' : ''}${m.home_edge_percentage}%) ${m.home_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
                    responseText += `   🛫 AWAY: ${m.away_expected_percentage}%→${m.away_actual_percentage}% `;
                    responseText += `(${m.away_edge_percentage > 0 ? '+' : ''}${m.away_edge_percentage}%) ${m.away_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
                    responseText += `   🎲 Odds: H ${m.home_decimal_odds} | A ${m.away_decimal_odds}\n`;
                    responseText += `   🏆 ${m.tournament} | 📅 ${m.match_date}\n\n`;
                });
            } else {
                responseText = 'No matches found with edge above 15%.';
            }
        }

        // Away Value
        else if (q.includes('away') && (q.includes('value') || q.includes('edge') || q.includes('positive'))) {
            data = await db.query(`
                SELECT ht.name AS home_team, at.name AS away_team,
                       t.name AS tournament, m.match_date,
                       wo.away_expected_percentage, wo.away_actual_percentage,
                       wo.away_edge_percentage, wo.away_edge_type,
                       wo.home_expected_percentage, wo.home_actual_percentage,
                       wo.home_edge_percentage, wo.away_decimal_odds
                FROM winning_odds wo
                JOIN matches m ON wo.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE wo.away_is_value = 1 AND wo.away_edge_percentage > 0
                ORDER BY wo.away_edge_percentage DESC LIMIT 10
            `);
            
            if (data.length > 0) {
                responseText = `🛫 **${data.length} away teams with positive edge:**\n\n`;
                data.forEach((m, i) => {
                    responseText += `${i+1}. ${m.home_team} vs **${m.away_team}**\n`;
                    responseText += `   Away: ${m.away_expected_percentage}%→${m.away_actual_percentage}% `;
                    responseText += `(+${m.away_edge_percentage}% edge) 🟡\n`;
                    responseText += `   Odds: ${m.away_decimal_odds} | ${m.tournament} | ${m.match_date}\n\n`;
                });
            } else {
                responseText = 'No away value bets found.';
            }
        }

        // Standings
        else if (q.includes('standings') || q.includes('table') || q.includes('premier league')) {
            const leagueFilter = q.includes('premier') ? "AND t.name LIKE '%Premier%'" : '';
            data = await db.query(`
                SELECT st.position, st.points, st.matches_played, st.wins, st.draws, st.losses,
                       st.goals_for, st.goals_against, st.goal_difference,
                       t_team.name AS team_name, t.name AS tournament_name
                FROM standings st
                JOIN teams t_team ON st.team_id = t_team.id
                JOIN tournaments t ON st.tournament_id = t.id
                ${leagueFilter}
                ORDER BY st.position ASC LIMIT 20
            `);
            
            if (data.length > 0) {
                responseText = `🏆 **Standings:**\n\n`;
                responseText += `Pos | Team | P | W | D | L | GF:GA | GD | Pts\n`;
                responseText += `---|------|---|---|---|---|------|----|----\n`;
                data.forEach(s => {
                    responseText += `${s.position}. ${s.team_name} | ${s.matches_played} | ${s.wins} | ${s.draws} | ${s.losses} | ${s.goals_for}:${s.goals_against} | ${s.goal_difference > 0 ? '+' : ''}${s.goal_difference} | **${s.points}**\n`;
                });
            } else {
                responseText = 'No standings data available.';
            }
        }

        // Top Form
        else if (q.includes('form') || q.includes('best form')) {
            data = await db.query(`
                SELECT ht.name AS team, t.name AS tournament,
                       COUNT(*) AS played,
                       SUM(CASE WHEN (m.home_team_id=ht.id AND m.home_score>m.away_score) OR (m.away_team_id=ht.id AND m.away_score>m.home_score) THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN m.home_score=m.away_score THEN 1 ELSE 0 END) AS draws,
                       SUM(CASE WHEN (m.home_team_id=ht.id AND m.home_score<m.away_score) OR (m.away_team_id=ht.id AND m.away_score<m.home_score) THEN 1 ELSE 0 END) AS losses,
                       ROUND(100.0*SUM(CASE WHEN (m.home_team_id=ht.id AND m.home_score>m.away_score) OR (m.away_team_id=ht.id AND m.away_score>m.home_score) THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate
                FROM matches m
                JOIN teams ht ON m.home_team_id=ht.id
                JOIN tournaments t ON m.tournament_id=t.id
                WHERE m.status IN (100,101,102) AND m.match_date > DATE_SUB(CURDATE(), INTERVAL 60 DAY)
                GROUP BY ht.id, t.id HAVING played>=5
                ORDER BY win_rate DESC LIMIT 10
            `);
            
            if (data.length > 0) {
                responseText = `📈 **Top Form (last 60 days, min 5 matches):**\n\n`;
                data.forEach((t, i) => {
                    responseText += `${i+1}. ${t.team} | ${t.played}P ${t.wins}W ${t.draws}D ${t.losses}L | **${t.win_rate}%** | ${t.tournament}\n`;
                });
            } else {
                responseText = 'No form data available.';
            }
        }

        // Default
        else {
            responseText = `I can help with:\n• "home expected > 50% and positive edge"\n• "value bets high confidence"\n• "edge above 15%"\n• "away positive edge"\n• "standings" or "premier league table"\n• "best form"\n\nTry one of the preset buttons!`;
        }

        res.json({
            success: true,
            data: {
                question,
                response: responseText,
                resultCount: data.length,
                suggestions: ['Home Edge >50%', 'High Value Bets', 'Edge >15%', 'Away Value', 'Top Form', 'PL Standings'],
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('AI error:', error.message);
        res.json({
            success: true,
            data: {
                question: req.body.question,
                response: 'I had trouble with that query. Try: "home expected > 50%", "value bets", "edge above 15%", "standings", or "best form".',
                suggestions: ['Home Edge >50%', 'High Value Bets', 'Edge >15%', 'Top Form']
            }
        });
    }
}

    async getMatchInsights(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            const data = await db.query(`SELECT m.*, ht.name AS home_team, at.name AS away_team FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at ON m.away_team_id=at.id WHERE m.id=?`, [matchId]);
            if (!data.length) return res.status(404).json({ success: false });
            res.json({ success: true, data: { matchId, insights: [`${data[0].home_team} vs ${data[0].away_team}`, `Status: ${data[0].status_description || 'Unknown'}`, `Score: ${data[0].home_score ?? '?'}-${data[0].away_score ?? '?'}`] } });
        } catch (error) { next(error); }
    }

    async explainPrediction(req, res, next) {
        try {
            const predictionId = parseInt(req.params.predictionId);
            const data = await db.query('SELECT * FROM prediction_results WHERE id=?', [predictionId]);
            if (!data.length) return res.status(404).json({ success: false });
            const p = data[0];
            res.json({ success: true, data: { predictionId, probabilities: { home: `${(p.home_win_prob*100).toFixed(0)}%`, draw: `${(p.draw_prob*100).toFixed(0)}%`, away: `${(p.away_win_prob*100).toFixed(0)}%` }, confidence: `${(p.confidence_score*100).toFixed(0)}%` } });
        } catch (error) { next(error); }
    }
}

module.exports = new AIController();