/**
 * FULL DATA COLLECTION - Fixed connection management
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');
const scheduledEventsCollector = require('../collectors/scheduledEventsCollector');
const oddsCollector = require('../collectors/oddsCollector');
const winningOddsCollector = require('../collectors/winningOddsCollector');
const standingsCollector = require('../collectors/standingsCollector');

function getDateFromArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--today') {
        return new Date().toISOString().split('T')[0];
    }
    if (args[0] && args[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
        return args[0];
    }
    return new Date().toISOString().split('T')[0];
}

async function dailyCollection(date) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🚀 DAILY COLLECTION FOR: ${date}`);
    console.log(`${'═'.repeat(70)}\n`);

    // ⚡ Each step initializes and closes its own connection

    // Step 1: Collect scheduled events
    console.log('📅 STEP 1/5: Collecting scheduled events...');
    try {
        await scheduledEventsCollector.collectForDate(date);
    } catch (error) {
        console.error(`   ⚠️ Scheduled events failed: ${error.message}`);
    }

    // Step 2: Collect odds
    console.log('\n🎲 STEP 2/5: Collecting match odds...');
    try {
        await oddsCollector.collectForDate(date);
    } catch (error) {
        console.error(`   ⚠️ Odds collection failed: ${error.message}`);
    }

    // Step 3: Collect standings (uses web URL to avoid 403)
    console.log('\n🏆 STEP 3/5: Collecting standings...');
    try {
        await db.initialize();
        const seasons = await db.query(
            `SELECT s.sofascore_season_id, t.unique_tournament_id, t.name
            FROM seasons s
            JOIN tournaments t ON s.tournament_id = t.id
            WHERE s.is_current = 1 LIMIT 5`
        );
        await db.close();

        for (const s of seasons) {
            try {
                await standingsCollector.collectForTournament(
                    s.unique_tournament_id, 
                    s.sofascore_season_id
                );
            } catch (e) {
                console.log(`   ⚠️ Standings failed for ${s.name}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    } catch (error) {
        console.error(`   ⚠️ Standings error: ${error.message}`);
    }

    // Step 4: Collect winning odds
    console.log('\n📊 STEP 4/5: Collecting winning odds...');
    try {
        await db.initialize();
        const upcomingMatches = await db.query(
            `SELECT id FROM matches 
            WHERE match_datetime > NOW() 
            AND match_datetime < DATE_ADD(NOW(), INTERVAL 3 DAY)
            ORDER BY match_datetime ASC LIMIT 10`
        );
        await db.close();

        for (const match of upcomingMatches) {
            try {
                await winningOddsCollector.collectForMatch(match.id);
            } catch (e) {
                // Skip matches without winning odds
            }
            await new Promise(r => setTimeout(r, 1500));
        }
        console.log(`   ✅ Processed ${upcomingMatches.length} matches`);
    } catch (error) {
        console.error(`   ⚠️ Winning odds error: ${error.message}`);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ DAILY COLLECTION COMPLETE FOR ${date}`);
    console.log(`${'═'.repeat(70)}\n`);
}

const date = getDateFromArgs();
console.log(`📅 Date resolved to: ${date}`);
dailyCollection(date).catch(console.error);