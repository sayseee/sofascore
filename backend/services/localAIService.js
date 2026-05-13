/**
 * Local AI Service - Natural Language to SQL + Analysis
 * Uses Ollama to convert questions into database queries
 */
const db = require('../config/database');

class LocalAIService {
    constructor() {
        this.baseUrl = 'http://localhost:11434/api/generate';
        this.model = 'llama3.2:3b';
    }

    /**
     * Get database schema for the AI context
     */
    getSchemaContext() {
        return `
DATABASE SCHEMA:
- matches(id, sofascore_match_id, tournament_id, season_id, home_team_id, away_team_id, match_date, match_datetime, status, home_score, away_score, round_info, venue_name)
- teams(id, name, short_name, country)
- tournaments(id, name, country, unique_tournament_id)
- winning_odds(id, match_id, home_expected_percentage, home_actual_percentage, home_edge_percentage, home_edge_type, away_expected_percentage, away_actual_percentage, away_edge_percentage, away_edge_type, home_is_value, away_is_value, home_decimal_odds, away_decimal_odds)
- betting_edges(id, match_id, selection, bookmaker_odds, model_probability, expected_value, edge_percentage, is_value_bet, confidence_level)
- standings(id, tournament_id, season_id, team_id, position, points, matches_played, wins, draws, losses, goals_for, goals_against)
- h2h_matches(id, pair_key, match_id, home_team_id, away_team_id, match_date, home_score, away_score)
- player_statistics(id, player_id, season_id, goals, assists, rating, appearances, minutes_played)
- match_odds(id, match_id, market_group, selection_name, decimal_odds, fractional_odds)

STATUS CODES: 0=not started, 6/7=in progress, 31=halftime, 100/101/102=finished

EDGE TYPES: positive (team outperforms odds), negative (team underperforms), neutral
`;
    }

    /**
     * Convert natural language to SQL, execute it, and return results
     */
    async askQuestion(question) {
        try {
            // Step 1: Generate SQL from natural language
            const sql = await this.generateSQL(question);
            
            if (!sql || sql.trim().length === 0) {
                return this.ruleBasedQuery(question);
            }

            // Step 2: Execute the SQL safely
            let results;
            try {
                results = await db.query(sql);
            } catch (sqlError) {
                console.error('SQL execution failed:', sqlError.message);
                return this.ruleBasedQuery(question);
            }

            // Step 3: Format results into natural language response
            if (results.length === 0) {
                return `No results found for: "${question}". Try a different query.`;
            }

            // Step 4: Generate natural language summary
            const summary = await this.summarizeResults(question, results);
            return summary;

        } catch (error) {
            console.error('AI query error:', error.message);
            return this.ruleBasedQuery(question);
        }
    }

    /**
     * Generate SQL from natural language using local LLM
     */
    async generateSQL(question) {
        const prompt = `You are a MySQL expert. Convert this question into a SELECT query.

${this.getSchemaContext()}

RULES:
- Only output the SQL query, nothing else
- Use JOINs to include team/tournament names
- Include ht.name AS home_team, at.name AS away_team for match queries
- Limit results to 10
- Use proper MySQL syntax
- Use LIKE for partial name matches
- For percentage fields, they are stored as DECIMAL (e.g., 65.00 = 65%)

QUESTION: "${question}"

SQL QUERY:`;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false,
                    temperature: 0,
                    max_tokens: 300
                })
            });

            const result = await response.json();
            let sql = result.response.trim();
            
            // Clean up the SQL
            sql = sql.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();
            
            // Only allow SELECT queries for safety
            if (!sql.toUpperCase().startsWith('SELECT')) {
                throw new Error('Only SELECT queries allowed');
            }

            // Add LIMIT if not present
            if (!sql.toUpperCase().includes('LIMIT')) {
                sql += ' LIMIT 10';
            }

            console.log('Generated SQL:', sql);
            return sql;

        } catch (error) {
            console.error('SQL generation failed:', error.message);
            return null;
        }
    }

    /**
     * Summarize query results in natural language
     */
    async summarizeResults(question, results) {
        const resultSample = JSON.stringify(results.slice(0, 5)).substring(0, 500);
        const totalCount = results.length;

        const prompt = `You are a football analytics expert. Summarize these query results.

QUESTION: "${question}"
TOTAL RESULTS: ${totalCount}
SAMPLE DATA: ${resultSample}

Write a concise summary (3-5 sentences) highlighting the key findings. Include specific numbers and team names.`;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false,
                    temperature: 0.3,
                    max_tokens: 200
                })
            });

            const result = await response.json();
            return result.response.trim();

        } catch (error) {
            // Fallback: format results manually
            return this.formatResultsManually(results, totalCount);
        }
    }

    /**
     * Manual result formatting (fallback)
     */
    formatResultsManually(results, totalCount) {
        if (!results || results.length === 0) return 'No results found.';

        let response = `📊 Found ${totalCount} results:\n\n`;
        
        results.slice(0, 5).forEach((r, i) => {
            // Match data
            if (r.home_team && r.away_team) {
                response += `${i+1}. ${r.home_team} vs ${r.away_team}\n`;
                if (r.home_edge_percentage !== undefined) {
                    response += `   Home: ${r.home_expected_percentage}%→${r.home_actual_percentage}% (+${r.home_edge_percentage}%)\n`;
                    response += `   Away: ${r.away_expected_percentage}%→${r.away_actual_percentage}% (${r.away_edge_percentage}%)\n`;
                }
                if (r.tournament || r.tournament_name) {
                    response += `   🏆 ${r.tournament || r.tournament_name}\n`;
                }
                response += '\n';
            }
            // Standing data
            else if (r.position !== undefined && r.team_name) {
                response += `${r.position}. ${r.team_name} - ${r.points}pts\n`;
            }
            // Value bet data
            else if (r.selection) {
                response += `${i+1}. ${r.home_team_name} vs ${r.away_team_name} | ${r.selection} @ ${r.bookmaker_odds} (+${r.edge_percentage}%)\n`;
            }
        });

        if (totalCount > 5) {
            response += `\n... and ${totalCount - 5} more results.`;
        }

        return response;
    }

    /**
     * Rule-based fallback queries
     */
    ruleBasedQuery(question) {
        const q = question.toLowerCase();
        
        if (q.includes('home') && q.includes('actual') && q.match(/(\d+)/)) {
            const threshold = parseInt(q.match(/(\d+)/)[1]);
            return this.queryAndFormat(
                `SELECT ht.name AS home_team, at.name AS away_team, t.name AS tournament, wo.home_actual_percentage, wo.home_edge_percentage FROM winning_odds wo JOIN matches m ON wo.match_id=m.id JOIN teams ht ON m.home_team_id=ht.id JOIN teams at ON m.away_team_id=at.id JOIN tournaments t ON m.tournament_id=t.id WHERE wo.home_actual_percentage > ? ORDER BY wo.home_actual_percentage DESC LIMIT 5`,
                [threshold],
                `📊 Matches with home actual > ${threshold}%`
            );
        }
        
        if (q.includes('value bet') || q.includes('value')) {
            return this.queryAndFormat(
                `SELECT be.*, ht.name AS home_team_name, at.name AS away_team_name FROM betting_edges be JOIN matches m ON be.match_id=m.id JOIN teams ht ON m.home_team_id=ht.id JOIN teams at ON m.away_team_id=at.id WHERE be.is_value_bet=1 ORDER BY be.expected_value DESC LIMIT 5`,
                [],
                '💎 Top Value Bets'
            );
        }
        
        if (q.includes('standings') || q.includes('table') || q.includes('league')) {
            return this.queryAndFormat(
                `SELECT st.position, st.points, t_team.name AS team_name FROM standings st JOIN teams t_team ON st.team_id=t_team.id JOIN tournaments t ON st.tournament_id=t.id ORDER BY st.position ASC LIMIT 10`,
                [],
                '🏆 League Standings'
            );
        }

        return 'I can help analyze data. Try: "home actual > 70%", "value bets", "standings", or "teams with best form".';
    }

    async queryAndFormat(sql, params, title) {
        try {
            const results = await db.query(sql, params);
            if (results.length === 0) return `No results found for: ${title}`;
            return this.formatResultsManually(results, results.length);
        } catch (e) {
            return `Query failed: ${e.message}`;
        }
    }
}

module.exports = new LocalAIService();