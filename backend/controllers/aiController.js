const db = require('../config/database');

class AIController {

    async askQuestion(req, res, next) {
        try {
            const { question } = req.body;
            
            if (!question) {
                return res.status(400).json({ success: false, error: 'Question is required' });
            }

            const q = question.toLowerCase();
            let data = null;
            let responseText = '';
            let suggestions = [];

            // Match queries about winning odds with specific values
            if (q.includes('winning odds') || q.includes('edge') || q.includes('expected') || q.includes('actual')) {
                data = await this.queryWinningOdds(q);
                responseText = this.formatWinningOddsResponse(data, q);
                suggestions = ['Show top value bets', 'Find highest edge matches', 'Show negative edges to fade'];
            }
            // Query value bets
            else if (q.includes('value bet') || q.includes('value')) {
                data = await this.queryValueBets(q);
                responseText = this.formatValueBetsResponse(data, q);
                suggestions = ['Show high confidence only', 'Show by edge percentage', 'Show upcoming value bets'];
            }
            // Query team form
            else if (q.includes('form') || q.includes('streak') || q.includes('recent')) {
                data = await this.queryTeamForm(q);
                responseText = this.formatTeamFormResponse(data, q);
                suggestions = ['Compare with opponent form', 'Show home vs away form', 'Show goal trends'];
            }
            // Query H2H
            else if (q.includes('h2h') || q.includes('head to head') || q.includes('vs')) {
                data = await this.queryH2H(q);
                responseText = this.formatH2HResponse(data, q);
                suggestions = ['Show recent H2H matches', 'H2H goal statistics', 'H2H at this venue'];
            }
            // Query match predictions
            else if (q.includes('predict') || q.includes('prediction') || q.includes('who wins')) {
                data = await this.queryPredictions(q);
                responseText = this.formatPredictionResponse(data, q);
                suggestions = ['Show confidence levels', 'Explain prediction factors', 'Compare with odds'];
            }
            // Query standings
            else if (q.includes('standings') || q.includes('table') || q.includes('position') || q.includes('league')) {
                data = await this.queryStandings(q);
                responseText = this.formatStandingsResponse(data, q);
                suggestions = ['Show top scorers', 'Show home vs away table', 'Recent form table'];
            }
            // General query
            else {
                data = await this.queryGeneral(q);
                responseText = this.formatGeneralResponse(data, q);
                suggestions = ['Find winning odds > 50% expected', 'Show high edge matches', 'Compare team forms'];
            }

            res.json({
                success: true,
                data: {
                    question,
                    response: responseText,
                    queryResults: data ? data.slice(0, 10) : [],
                    suggestions,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) { 
            console.error('AI query error:', error.message);
            res.json({ 
                success: true, 
                data: { 
                    question: req.body.question,
                    response: 'I had trouble processing that query. Try asking about winning odds, value bets, team form, or H2H comparisons.',
                    suggestions: ['Find high edge matches', 'Show value bets', 'Compare team forms']
                }
            });
        }
    }

    /**
     * Query winning odds with filters from natural language
     */
    async queryWinningOdds(question) {
        let conditions = [];
        let params = [];

        // Extract numeric thresholds from question
        const homeExpMatch = question.match(/home expected.*?(\d+)/i);
        const homeActMatch = question.match(/home actual.*?(\d+)/i);
        const awayExpMatch = question.match(/away expected.*?(\d+)/i);
        const awayActMatch = question.match(/away actual.*?(\d+)/i);
        const edgeMatch = question.match(/edge.*?(\d+)/i);
        const minEdgeMatch = question.match(/(?:above|over|greater than|>)\s*(\d+)/i);
        
        if (homeExpMatch) { conditions.push('wo.home_expected_percentage >= ?'); params.push(parseInt(homeExpMatch[1])); }
        if (homeActMatch) { conditions.push('wo.home_actual_percentage >= ?'); params.push(parseInt(homeActMatch[1])); }
        if (awayExpMatch) { conditions.push('wo.away_expected_percentage >= ?'); params.push(parseInt(awayExpMatch[1])); }
        if (awayActMatch) { conditions.push('wo.away_actual_percentage >= ?'); params.push(parseInt(awayActMatch[1])); }
        if (minEdgeMatch) { conditions.push('(wo.home_edge_percentage >= ? OR wo.away_edge_percentage >= ?)'); params.push(parseInt(minEdgeMatch[1]), parseInt(minEdgeMatch[1])); }

        // Default: show positive edges if no filters
        if (conditions.length === 0) {
            conditions.push('(wo.home_is_value = 1 OR wo.away_is_value = 1)');
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        return db.query(`
            SELECT 
                ht.name AS home_team, at.name AS away_team,
                t.name AS tournament, m.match_date, m.match_datetime,
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
            ${whereClause}
            ORDER BY GREATEST(ABS(wo.home_edge_percentage), ABS(wo.away_edge_percentage)) DESC
            LIMIT 15
        `, params);
    }

    async queryValueBets(question) {
        const confMatch = question.match(/(high|medium|low)/i);
        const minEdgeMatch = question.match(/(\d+)\s*%/);
        
        let conditions = ['be.is_value_bet = 1'];
        let params = [];

        if (confMatch) { conditions.push('be.confidence_level = ?'); params.push(confMatch[1].toLowerCase()); }
        if (minEdgeMatch) { conditions.push('be.edge_percentage >= ?'); params.push(parseInt(minEdgeMatch[1])); }

        return db.query(`
            SELECT be.*, ht.name AS home_team_name, at.name AS away_team_name,
                   t.name AS tournament_name, m.match_date
            FROM betting_edges be
            JOIN matches m ON be.match_id = m.id
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            JOIN tournaments t ON m.tournament_id = t.id
            WHERE ${conditions.join(' AND ')}
            ORDER BY be.expected_value DESC
            LIMIT 15
        `, params);
    }

    async queryTeamForm(question) {
        // Try to extract team name
        const teamNameMatch = question.match(/(?:form|streak|recent)(?:\s+(?:of|for))?\s+([A-Za-z\s]+?)(?:\s+(?:in|at|vs|$))/i);
        
        if (!teamNameMatch) {
            return db.query(`
                SELECT ht.name AS team, t.name AS tournament,
                       COUNT(*) AS played,
                       SUM(CASE WHEN (m.home_team_id = ht.id AND m.home_score > m.away_score) OR (m.away_team_id = ht.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) AS draws,
                       SUM(CASE WHEN (m.home_team_id = ht.id AND m.home_score < m.away_score) OR (m.away_team_id = ht.id AND m.away_score < m.home_score) THEN 1 ELSE 0 END) AS losses,
                       ROUND(100.0 * SUM(CASE WHEN (m.home_team_id = ht.id AND m.home_score > m.away_score) OR (m.away_team_id = ht.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN tournaments t ON m.tournament_id = t.id
                WHERE m.status IN (100, 101, 102)
                AND m.match_date > DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                GROUP BY ht.id, t.id
                ORDER BY win_rate DESC
                LIMIT 10
            `);
        }

        const teamName = teamNameMatch[1].trim();
        return db.query(`
            SELECT home_team_id, away_team_id, home_score, away_score, match_date, match_datetime,
                   t.name AS tournament
            FROM matches m
            JOIN tournaments t ON m.tournament_id = t.id
            WHERE (home_team_id IN (SELECT id FROM teams WHERE name LIKE ?) OR away_team_id IN (SELECT id FROM teams WHERE name LIKE ?))
            AND status IN (100, 101, 102)
            AND home_score IS NOT NULL
            ORDER BY match_datetime DESC LIMIT 10
        `, [`%${teamName}%`, `%${teamName}%`]);
    }

    async queryH2H(question) {
        const teamsMatch = question.match(/([A-Za-z\s]+?)\s+(?:vs|versus|against)\s+([A-Za-z\s]+)/i);
        
        if (!teamsMatch) {
            return db.query(`
                SELECT ht.name AS home_team, at.name AS away_team,
                       COUNT(*) AS matches,
                       SUM(CASE WHEN h.home_score > h.away_score THEN 1 ELSE 0 END) AS home_wins,
                       SUM(CASE WHEN h.home_score = h.away_score THEN 1 ELSE 0 END) AS draws,
                       SUM(CASE WHEN h.away_score > h.home_score THEN 1 ELSE 0 END) AS away_wins
                FROM h2h_matches h
                JOIN teams ht ON h.home_team_id = ht.id
                JOIN teams at ON h.away_team_id = at.id
                GROUP BY h.pair_key
                ORDER BY matches DESC
                LIMIT 10
            `);
        }

        const team1 = teamsMatch[1].trim();
        const team2 = teamsMatch[2].trim();

        return db.query(`
            SELECT h.*, ht.name AS home_name, at.name AS away_name
            FROM h2h_matches h
            JOIN teams ht ON h.home_team_id = ht.id
            JOIN teams at ON h.away_team_id = at.id
            WHERE ht.name LIKE ? AND at.name LIKE ?
            ORDER BY h.match_date DESC LIMIT 15
        `, [`%${team1}%`, `%${team2}%`]);
    }

    async queryPredictions(question) {
        return db.query(`
            SELECT pr.*, ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_datetime
            FROM prediction_results pr
            JOIN matches m ON pr.match_id = m.id
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            JOIN tournaments t ON m.tournament_id = t.id
            WHERE m.match_datetime > NOW()
            ORDER BY pr.confidence_score DESC
            LIMIT 10
        `);
    }

    async queryStandings(question) {
        const leagueMatch = question.match(/(?:in|for)\s+([A-Za-z\s]+?)(?:\s+(?:league|table|standings)|$)/i);
        
        let conditions = [];
        let params = [];
        if (leagueMatch) {
            conditions.push('t.name LIKE ?');
            params.push(`%${leagueMatch[1].trim()}%`);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        return db.query(`
            SELECT st.position, st.points, st.matches_played, st.wins, st.draws, st.losses,
                   st.goals_for, st.goals_against, st.goal_difference,
                   t_team.name AS team_name, t.name AS tournament_name
            FROM standings st
            JOIN teams t_team ON st.team_id = t_team.id
            JOIN tournaments t ON st.tournament_id = t.id
            ${whereClause}
            ORDER BY st.position ASC
            LIMIT 15
        `, params);
    }

    async queryGeneral(question) {
        return db.query(`
            SELECT ht.name AS home_team, at.name AS away_team,
                   t.name AS tournament, m.match_date,
                   wo.home_edge_percentage, wo.away_edge_percentage,
                   wo.home_edge_type, wo.away_edge_type
            FROM winning_odds wo
            JOIN matches m ON wo.match_id = m.id
            JOIN teams ht ON m.home_team_id = ht.id
            JOIN teams at ON m.away_team_id = at.id
            JOIN tournaments t ON m.tournament_id = t.id
            WHERE (wo.home_is_value = 1 OR wo.away_is_value = 1)
            AND m.match_datetime > DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY GREATEST(wo.home_edge_percentage, wo.away_edge_percentage) DESC
            LIMIT 10
        `);
    }

    // Formatting helpers
    formatWinningOddsResponse(data, question) {
        if (!data || data.length === 0) return 'No matches found matching those criteria.';
        
        let response = `📊 **Winning Odds Analysis** (${data.length} matches found)\n\n`;
        
        data.slice(0, 5).forEach((m, i) => {
            response += `${i+1}. **${m.home_team} vs ${m.away_team}**\n`;
            response += `   📅 ${m.match_date} | 🏆 ${m.tournament}\n`;
            response += `   🏠 Home: ${m.home_expected_percentage}% expected → ${m.home_actual_percentage}% actual (${m.home_edge_percentage > 0 ? '+' : ''}${m.home_edge_percentage}% edge) ${m.home_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
            response += `   🛫 Away: ${m.away_expected_percentage}% expected → ${m.away_actual_percentage}% actual (${m.away_edge_percentage > 0 ? '+' : ''}${m.away_edge_percentage}% edge) ${m.away_edge_type === 'positive' ? '🟡' : '⚫'}\n`;
            response += `   🎲 Odds: Home ${m.home_decimal_odds} | Away ${m.away_decimal_odds}\n\n`;
        });

        return response;
    }

    formatValueBetsResponse(data, question) {
        if (!data || data.length === 0) return 'No value bets found.';
        
        let response = `💎 **Value Bets Found** (${data.length})\n\n`;
        
        data.slice(0, 5).forEach((b, i) => {
            response += `${i+1}. **${b.home_team_name} vs ${b.away_team_name}**\n`;
            response += `   Selection: ${b.selection} @ ${b.bookmaker_odds}\n`;
            response += `   Edge: +${b.edge_percentage}% | EV: ${b.expected_value > 0 ? '+' : ''}${(b.expected_value * 100).toFixed(1)}%\n`;
            response += `   Confidence: ${(b.confidence_level || 'low').toUpperCase()}\n\n`;
        });

        return response;
    }

    formatTeamFormResponse(data, question) { /* ... similar formatting ... */ return 'Form data displayed'; }
    formatH2HResponse(data, question) { /* ... similar formatting ... */ return 'H2H data displayed'; }
    formatPredictionResponse(data, question) { /* ... similar formatting ... */ return 'Predictions displayed'; }
    formatStandingsResponse(data, question) { /* ... similar formatting ... */ return 'Standings displayed'; }
    formatGeneralResponse(data, question) { /* ... similar formatting ... */ return 'General results displayed'; }

    async getMatchInsights(req, res, next) {
        try {
            const matchId = parseInt(req.params.matchId);
            
            const data = await db.query(`
                SELECT m.*, ht.name AS home_team, at.name AS away_team, t.name AS tournament,
                       wo.home_edge_percentage, wo.away_edge_percentage,
                       wo.home_expected_percentage, wo.home_actual_percentage,
                       wo.away_expected_percentage, wo.away_actual_percentage
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                JOIN tournaments t ON m.tournament_id = t.id
                LEFT JOIN winning_odds wo ON m.id = wo.match_id
                WHERE m.id = ?
            `, [matchId]);

            if (!data.length) return res.status(404).json({ success: false, error: 'Match not found' });

            const m = data[0];
            const insights = [];

            if (m.home_edge_percentage) {
                if (m.home_edge_percentage > 10) insights.push(`🔥 ${m.home_team} has a strong positive edge of +${m.home_edge_percentage}% (actual ${m.home_actual_percentage}% vs expected ${m.home_expected_percentage}%)`);
                if (m.away_edge_percentage < -10) insights.push(`⚠️ ${m.away_team} underperforms with ${m.away_edge_percentage}% edge at these odds`);
            }

            if (m.home_score !== null) {
                insights.push(`Final score: ${m.home_team} ${m.home_score} - ${m.away_score} ${m.away_team}`);
            }

            res.json({ success: true, data: { matchId, insights } });
        } catch (error) { next(error); }
    }

    async explainPrediction(req, res, next) {
        try {
            const predictionId = parseInt(req.params.predictionId);
            
            const data = await db.query(`
                SELECT pr.*, ht.name AS home_team, at.name AS away_team
                FROM prediction_results pr
                JOIN matches m ON pr.match_id = m.id
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                WHERE pr.id = ?
            `, [predictionId]);

            if (!data.length) return res.status(404).json({ success: false, error: 'Not found' });

            const p = data[0];
            
            res.json({
                success: true,
                data: {
                    predictionId,
                    match: `${p.home_team} vs ${p.away_team}`,
                    probabilities: {
                        home: `${(p.home_win_prob * 100).toFixed(0)}%`,
                        draw: `${(p.draw_prob * 100).toFixed(0)}%`,
                        away: `${(p.away_win_prob * 100).toFixed(0)}%`
                    },
                    factors: [
                        { name: 'Winning Odds Edge', impact: 'high', description: 'Historical performance vs odds expectations' },
                        { name: 'Team Form', impact: 'high', description: 'Recent match results weighted by recency' },
                        { name: 'Market Odds', impact: 'medium', description: 'Bookmaker implied probabilities' }
                    ],
                    confidence: `${(p.confidence_score * 100).toFixed(0)}% (${p.confidence_level})`
                }
            });
        } catch (error) { next(error); }
    }
}

module.exports = new AIController();