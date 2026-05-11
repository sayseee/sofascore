/**
 * Populate betting_edges from winning_odds data
 * Run: node jobs/populateBettingEdges.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');

async function populateBettingEdges() {
    await db.initialize();
    console.log('💎 Populating betting_edges from winning_odds...\n');

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
        WHERE wo.home_is_value = 1
        AND wo.home_edge_percentage > 2
        AND wo.match_id NOT IN (
            SELECT match_id FROM betting_edges WHERE market_type = '1X2' AND selection = 'home'
        )
    `);
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
        WHERE wo.away_is_value = 1
        AND wo.away_edge_percentage > 2
        AND wo.match_id NOT IN (
            SELECT match_id FROM betting_edges WHERE market_type = '1X2' AND selection = 'away'
        )
    `);
    console.log(`   ✅ Away value bets: ${awayBets.affectedRows || 0}`);

    // Update confidence levels for existing bets
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

    console.log(`\n✅ Betting edges populated successfully`);
    await db.close();
}

if (require.main === module) {
    populateBettingEdges().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = populateBettingEdges;