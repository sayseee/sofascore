/**
 * Populate betting_edges from winning_odds data
 * Run: node jobs/populateBettingEdges.js
 *       node jobs/populateBettingEdges.js --date 2026-05-12
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');

async function populateBettingEdges(date = null) {
    await db.initialize();
    
    const dateFilter = date ? 'AND m.match_date = ?' : '';
    const params = date ? [date, date] : [];
    
    console.log(`💎 Populating betting_edges from winning_odds...`);
    if (date) console.log(`   Date: ${date}\n`);
    else console.log(`   All dates\n`);

    // Insert home value bets
    const homeBets = await db.query(`
        INSERT INTO betting_edges (
            match_id, market_type, selection, bookmaker_odds,
            model_probability, expected_value, edge_percentage,
            kelly_criterion, is_value_bet, confidence_level,
            timestamp_calculated
        )
        SELECT 
            wo.match_id,
            '1X2',
            'home',
            wo.home_expected_decimal,
            wo.home_actual_probability,
            (wo.home_actual_probability * wo.home_expected_decimal) - 1,
            wo.home_edge_percentage,
            CASE 
                WHEN wo.home_expected_decimal > 1 
                THEN wo.home_actual_probability - ((1 - wo.home_actual_probability) / (wo.home_expected_decimal - 1))
                ELSE 0 
            END,
            1,
            CASE 
                WHEN wo.home_edge_percentage > 15 THEN 'high'
                WHEN wo.home_edge_percentage > 8 THEN 'medium'
                ELSE 'low'
            END,
            NOW()
        FROM winning_odds wo
        JOIN matches m ON wo.match_id = m.id
        WHERE wo.home_is_value = 1
        AND wo.home_edge_percentage > 2
        ${dateFilter}
        AND wo.match_id NOT IN (
            SELECT match_id FROM betting_edges WHERE market_type = '1X2' AND selection = 'home'
        )
    `, params);
    console.log(`   ✅ Home value bets: ${homeBets.affectedRows || 0}`);

    // Insert away value bets
    const awayBets = await db.query(`
        INSERT INTO betting_edges (
            match_id, market_type, selection, bookmaker_odds,
            model_probability, expected_value, edge_percentage,
            kelly_criterion, is_value_bet, confidence_level,
            timestamp_calculated
        )
        SELECT 
            wo.match_id,
            '1X2',
            'away',
            wo.away_expected_decimal,
            wo.away_actual_probability,
            (wo.away_actual_probability * wo.away_expected_decimal) - 1,
            wo.away_edge_percentage,
            CASE 
                WHEN wo.away_expected_decimal > 1 
                THEN wo.away_actual_probability - ((1 - wo.away_actual_probability) / (wo.away_expected_decimal - 1))
                ELSE 0 
            END,
            1,
            CASE 
                WHEN wo.away_edge_percentage > 15 THEN 'high'
                WHEN wo.away_edge_percentage > 8 THEN 'medium'
                ELSE 'low'
            END,
            NOW()
        FROM winning_odds wo
        JOIN matches m ON wo.match_id = m.id
        WHERE wo.away_is_value = 1
        AND wo.away_edge_percentage > 2
        ${dateFilter}
        AND wo.match_id NOT IN (
            SELECT match_id FROM betting_edges WHERE market_type = '1X2' AND selection = 'away'
        )
    `, params);
    console.log(`   ✅ Away value bets: ${awayBets.affectedRows || 0}`);

    // Update confidence levels
    await db.query(`
        UPDATE betting_edges 
        SET confidence_level = 
            CASE 
                WHEN edge_percentage > 15 THEN 'high'
                WHEN edge_percentage > 8 THEN 'medium'
                ELSE 'low'
            END
        WHERE confidence_level IS NULL
    `);

    const total = await db.query('SELECT COUNT(*) as cnt FROM betting_edges WHERE is_value_bet = 1');
    console.log(`\n✅ Betting edges: ${total[0]?.cnt || 0} total value bets`);
    await db.close();
}

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    let date = null;
    
    if (args.includes('--date') && args.length >= 2) {
        date = args[args.indexOf('--date') + 1];
    }
    
    populateBettingEdges(date)
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = populateBettingEdges;