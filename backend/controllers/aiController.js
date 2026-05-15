const db = require('../config/database');

class AIController {
    async askQuestion(req, res, next) {
        try {
            const { question, date } = req.body;
            console.log(`[AI] Question: "${question}" | Date: ${date || 'today'}`);
            
            if (!question) {
                return res.status(400).json({ success: false, error: 'Question is required' });
            }

            // ⚡ Dynamic date filter for ALL queries
            const dateFilter = date ? 'AND m.match_date = ?' : 'AND m.match_date >= CURDATE()';
            const dateParam = date ? [date] : [];
            
            const q = question.toLowerCase();
            let data = [];
            let responseText = '';

            // HIGH EXPECTED WIN PROBABILITY (>70%)
            if (q.includes('high expected') || q.includes('high win probability') || q.includes('favorite')) {
                data = await db.query(`
                    SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament,
                           m.match_date, wo.home_expected_probability, wo.home_actual_probability,
                           wo.home_edge_percentage, wo.home_edge_type,
                           wo.away_expected_probability, wo.away_actual_probability,
                           wo.home_expected_decimal, wo.away_expected_decimal
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id
                    JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    LEFT JOIN winning_odds wo ON m.id = wo.match_id
                    WHERE (wo.home_expected_probability > 0.70 OR wo.away_expected_probability > 0.70)
                        AND wo.home_expected_probability IS NOT NULL
                        ${dateFilter}
                    ORDER BY GREATEST(wo.home_expected_probability, wo.away_expected_probability) DESC LIMIT 10
                `, dateParam);
                
                responseText = data.length > 0 
                    ? `⭐ **${data.length} matches with high win probability (>70%):**\n\n` +
                      data.map((m, i) => {
                          const isHome = m.home_expected_probability > 0.70;
                          const fav = isHome ? m.home_team : m.away_team;
                          const expPct = ((isHome ? m.home_expected_probability : m.away_expected_probability) * 100).toFixed(1);
                          const actPct = ((isHome ? m.home_actual_probability : m.away_actual_probability) * 100).toFixed(1);
                          const odds = isHome ? m.home_expected_decimal : m.away_expected_decimal;
                          const edge = isHome ? m.home_edge_percentage : m.away_edge_percentage;
                          return `${i+1}. **${m.home_team} vs ${m.away_team}**\n   ⭐ ${fav}: ${expPct}% expected, ${actPct}% actual (${edge > 0 ? '+' : ''}${edge}%)\n   🎲 ${odds} | 🏆 ${m.tournament} | 📅 ${m.match_date}\n`;
                      }).join('\n')
                    : 'No matches found with >70% win probability.';
            }

            // Home Expected > 50% + Positive Edge
            else if (q.includes('home expected') || q.includes('positive edge') || (q.includes('home') && q.includes('edge'))) {
                data = await db.query(`
                    SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_date,
                           wo.home_expected_probability, wo.home_actual_probability,
                           wo.home_edge_percentage, wo.home_edge_type,
                           wo.home_expected_decimal
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id
                    JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    LEFT JOIN winning_odds wo ON m.id = wo.match_id
                    WHERE wo.home_expected_probability > 0.50 AND wo.home_edge_percentage > 0
                        ${dateFilter}
                    ORDER BY wo.home_edge_percentage DESC LIMIT 10
                `, dateParam);
                
                responseText = data.length > 0
                    ? `📊 **${data.length} matches with home expected >50% + positive edge:**\n\n` +
                      data.map((m, i) => {
                          const exp = (m.home_expected_probability * 100).toFixed(1);
                          const act = (m.home_actual_probability * 100).toFixed(1);
                          return `${i+1}. **${m.home_team} vs ${m.away_team}**\n   🏠 Expected ${exp}% → Actual ${act}% (+${m.home_edge_percentage}%) ✅\n   🎲 ${m.home_expected_decimal} | 🏆 ${m.tournament} | 📅 ${m.match_date}\n`;
                      }).join('\n')
                    : 'No matches found with home expected >50% and positive edge.';
            }

            // Value Bets
            else if (q.includes('value bet') || q.includes('high confidence') || (q.includes('value') && q.includes('bets'))) {
                data = await db.query(`
                    SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_date,
                           'home' as selection, wo.home_expected_decimal as odds,
                           wo.home_expected_probability as model_prob, wo.home_actual_probability as actual_prob,
                           wo.home_edge_percentage as edge, wo.home_edge_type as edge_type
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    LEFT JOIN winning_odds wo ON m.id = wo.match_id
                    WHERE wo.home_is_value = 1 ${dateFilter}
                    UNION ALL
                    SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_date,
                           'away' as selection, wo.away_expected_decimal as odds,
                           wo.away_expected_probability as model_prob, wo.away_actual_probability as actual_prob,
                           wo.away_edge_percentage as edge, wo.away_edge_type as edge_type
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    LEFT JOIN winning_odds wo ON m.id = wo.match_id
                    WHERE wo.away_is_value = 1 ${dateFilter}
                    ORDER BY edge DESC LIMIT 10
                `, [...dateParam, ...dateParam]);
                
                responseText = data.length > 0
                    ? `💎 **${data.length} Value Bets:**\n\n` +
                      data.map((b, i) => {
                          const team = b.selection === 'home' ? b.home_team : b.away_team;
                          return `${i+1}. **${b.home_team} vs ${b.away_team}**\n   🎯 ${team} @ ${b.odds} | +${b.edge}% edge | ${b.tournament} | ${b.match_date}\n`;
                      }).join('\n')
                    : 'No value bets found for this date.';
            }

            // Underdog Value
            else if (q.includes('underdog') || (q.includes('away') && q.includes('value'))) {
                data = await db.query(`
                    SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_date,
                           wo.away_expected_probability, wo.away_actual_probability,
                           wo.away_edge_percentage, wo.away_expected_decimal
                    FROM matches m
                    JOIN teams ht ON m.home_team_id = ht.id JOIN teams at ON m.away_team_id = at.id
                    JOIN tournaments t ON m.tournament_id = t.id
                    LEFT JOIN winning_odds wo ON m.id = wo.match_id
                    WHERE wo.away_is_value = 1 AND wo.away_edge_percentage > 0
                        AND wo.away_expected_probability < 0.45
                        ${dateFilter}
                    ORDER BY wo.away_edge_percentage DESC LIMIT 10
                `, dateParam);
                
                responseText = data.length > 0
                    ? `🦁 **${data.length} Underdog Value Bets:**\n\n` +
                      data.map((m, i) => {
                          const exp = (m.away_expected_probability * 100).toFixed(1);
                          const act = (m.away_actual_probability * 100).toFixed(1);
                          return `${i+1}. **${m.away_team}** @ ${m.home_team}\n   📊 ${exp}%→${act}% | +${m.away_edge_percentage}% | 🎲 ${m.away_expected_decimal} | ${m.tournament} | ${m.match_date}\n`;
                      }).join('\n')
                    : 'No underdog value bets found.';
            }

            // Standings (no date filter needed)
            else if (q.includes('standings') || q.includes('table')) {
                let leagueFilter = '';
                if (q.includes('premier')) leagueFilter = "AND t.name LIKE '%Premier%'";
                else if (q.includes('la liga')) leagueFilter = "AND t.name LIKE '%La Liga%'";
                else if (q.includes('bundesliga')) leagueFilter = "AND t.name LIKE '%Bundesliga%'";
                else if (q.includes('serie a')) leagueFilter = "AND t.name LIKE '%Serie A%'";
                
                data = await db.query(`
                    SELECT st.position, st.points, st.matches_played, st.wins, st.draws, st.losses,
                           st.goals_for, st.goals_against, st.goal_difference,
                           t_team.name AS team_name, t.name AS tournament_name
                    FROM standings st
                    JOIN teams t_team ON st.team_id = t_team.id
                    JOIN tournaments t ON st.tournament_id = t.id
                    WHERE 1=1 ${leagueFilter}
                    ORDER BY st.position ASC LIMIT 20
                `);
                
                responseText = data.length > 0
                    ? `🏆 **${data[0].tournament_name || 'League'} Standings:**\n\n` +
                      "```\nPos Team                     P  W  D  L  GF:GA  GD  Pts\n" +
                      "--- ----------------------- -- -- -- -- ----- --- ---\n" +
                      data.map(s => `${String(s.position).padStart(2)}. ${s.team_name.substring(0,24).padEnd(24)} ${String(s.matches_played).padStart(2)} ${String(s.wins).padStart(2)} ${String(s.draws).padStart(2)} ${String(s.losses).padStart(2)} ${s.goals_for}:${s.goals_against} ${String(s.goal_difference > 0 ? '+' + s.goal_difference : s.goal_difference).padStart(3)} ${String(s.points).padStart(3)}`).join('\n') + "\n```"
                    : 'No standings data available.';
            }

            // Top Form teams that are playing on selected date
else if (q.includes('form') || q.includes('best form')) {
    // Get the target date (selected date or today)
    const targetDate = date ? date : new Date().toISOString().split('T')[0];
    
    // First, find all teams playing on the target date
    const teamsPlayingOnDate = await db.query(`
        SELECT DISTINCT t_team.id, t_team.name
        FROM matches m
        JOIN teams t_team ON m.home_team_id = t_team.id OR m.away_team_id = t_team.id
        WHERE m.match_date = ?
    `, [targetDate]);
    
    if (teamsPlayingOnDate.length === 0) {
        const formattedDate = targetDate.split('-').reverse().join('/');
        responseText = `📅 No matches found on ${formattedDate}.`;
    } else {
        // Get form data only for teams playing on the target date
        // Looking at their last 5 matches BEFORE the target date
        const teamIds = teamsPlayingOnDate.map(t => t.id);
        const placeholders = teamIds.map(() => '?').join(',');
        
        data = await db.query(`
            SELECT t_team.name AS team, 
                   COUNT(*) AS played,
                   SUM(CASE WHEN (m.home_team_id = t_team.id AND m.home_score > m.away_score) OR 
                                 (m.away_team_id = t_team.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) AS draws,
                   ROUND(100.0 * SUM(CASE WHEN (m.home_team_id = t_team.id AND m.home_score > m.away_score) OR 
                                             (m.away_team_id = t_team.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate
            FROM matches m
            JOIN teams t_team ON m.home_team_id = t_team.id OR m.away_team_id = t_team.id
            WHERE t_team.id IN (${placeholders})
                AND m.status IN (100, 101, 102)
                AND m.match_date < ?
            GROUP BY t_team.id
            HAVING played >= 3
            ORDER BY win_rate DESC
        `, [...teamIds, targetDate]);
        
        const formattedDate = targetDate.split('-').reverse().join('/');
        
        // Filter for teams in excellent form (win_rate > 70%)
        const inFormTeams = data.filter(t => t.win_rate > 70);
        
        if (inFormTeams.length === 0) {
            responseText = `📊 No teams in excellent form (>70% win rate in last 3+ matches) playing on ${formattedDate}.`;
        } else {
            // Take only top 10
            const topInFormTeams = inFormTeams.slice(0, 10);
            
            responseText = `🔥 **HOT FORM TEAMS (>70% WIN RATE) PLAYING ON ${formattedDate}:**\n\n` +
                topInFormTeams.map((t, i) => {
                    const formIcon = t.win_rate >= 80 ? '💎' : '🔥';
                    const record = `${t.wins}W ${t.draws}D ${t.played - t.wins - t.draws}L`;
                    return `${i+1}. ${formIcon} **${t.team}** | Last ${t.played}: ${record} | **${t.win_rate}%** win rate`;
                }).join('\n');
        }
    }
}

            // Team search
            else if (q.includes('team') && (q.includes('expected') || q.includes('probability') || q.includes('odds'))) {
                const teamMatch = q.match(/team\s+([a-z\s]+?)(?:\s+(?:expected|probability|odds)|$)/i);
                const team = teamMatch ? teamMatch[1].trim() : null;
                
                if (team) {
                    data = await db.query(`
                        SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, m.match_date,
                               wo.home_expected_probability, wo.home_actual_probability, wo.home_edge_percentage,
                               wo.away_expected_probability, wo.away_actual_probability, wo.away_edge_percentage,
                               wo.home_expected_decimal, wo.away_expected_decimal
                        FROM matches m
                        JOIN teams ht ON m.home_team_id=ht.id JOIN teams at ON m.away_team_id=at.id
                        JOIN tournaments t ON m.tournament_id=t.id
                        LEFT JOIN winning_odds wo ON m.id=wo.match_id
                        WHERE (LOWER(ht.name) LIKE ? OR LOWER(at.name) LIKE ?) ${dateFilter}
                        ORDER BY m.match_date ASC LIMIT 5
                    `, [`%${team}%`, `%${team}%`, ...dateParam]);
                    
                    responseText = data.length > 0
                        ? `🔍 **Matches for ${team.toUpperCase()}:**\n\n` +
                          data.map((m, i) => `${i+1}. ${m.home_team} vs ${m.away_team}\n   🏆 ${m.tournament} | 📅 ${m.match_date}\n`).join('')
                        : `No matches found for "${team}".`;
                } else {
                    responseText = "Please specify a team name. Example: 'Team Chelsea expected probability'";
                }
            }

            // Default help
            else {
                responseText = `🤖 **I can help with:**\n• "high win probability"\n• "home expected >50%"\n• "value bets"\n• "underdog value"\n• "standings"\n• "best form"\n• "Team [name] expected"\n\nTry one of the preset buttons!`;
            }

            res.json({
                success: true,
                data: {
                    question,
                    response: responseText,
                    resultCount: data.length,
                    date: date || 'today',
                    suggestions: ['High win probability', 'Value bets', 'Home expected >50%', 'Standings', 'Best form'],
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('[AI] Error:', error.message);
            res.json({
                success: true,
                data: {
                    question: req.body.question,
                    response: '❌ Error processing query. Try "high win probability" or "value bets".',
                    suggestions: ['High win probability', 'Value bets']
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