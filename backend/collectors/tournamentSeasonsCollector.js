/**
 * Tournament Seasons Collector
 * Endpoint: /unique-tournament/{uniqueTournamentId}/seasons
 * 
 * Gets ALL seasons for a tournament and stores them
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const httpClient = require('../utils/httpClient');
const db = require('../config/database');

class TournamentSeasonsCollector {
    constructor() { this.collectorName = 'tournament_seasons_collector'; }

    async initialize() {
        if (!db.isConnected) await db.initialize();
    }

    async collectForTournament(uniqueTournamentId, dbTournamentId) {
        try {
            await this.initialize();
            
            const endpoint = `/unique-tournament/${uniqueTournamentId}/seasons`;
            console.log(`📅 Seasons: Tournament ${uniqueTournamentId}`);
            
            const response = await httpClient.get(endpoint);
            
            if (!response || !response.seasons) {
                console.log('   No seasons data');
                return { success: false, error: 'No data' };
            }

            let inserted = 0, updated = 0;
            const now = new Date();
            const currentYear = now.getFullYear();

            for (const season of response.seasons) {
                const isCurrent = season.year?.includes(currentYear.toString()) ? 1 : 0;
                
                const existing = await db.query(
                    'SELECT id FROM seasons WHERE tournament_id = ? AND sofascore_season_id = ?',
                    [dbTournamentId, season.id]
                );

                if (existing.length > 0) {
                    await db.query(
                        `UPDATE seasons SET is_current = ?, year = ?, name = ?, 
                         unique_tournament_id = ?, updated_at = NOW() WHERE id = ?`,
                        [isCurrent, season.year || null, season.name, uniqueTournamentId, existing[0].id]
                    );
                    updated++;
                } else {
                    await db.query(
                        `INSERT INTO seasons (tournament_id, unique_tournament_id, sofascore_season_id, name, year, is_current)
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [dbTournamentId, uniqueTournamentId, season.id, season.name, season.year || null, isCurrent]
                    );
                    inserted++;
                }
            }

            console.log(`   ✅ +${inserted} new, ${updated} updated`);
            return { success: true, inserted, updated, total: response.seasons.length };

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async collectAllTournaments() {
        await this.initialize();
        
        const tournaments = await db.query(
            'SELECT id, unique_tournament_id, name FROM tournaments WHERE is_active = 1 ORDER BY name'
        );

        console.log(`\n📅 Collecting seasons for ${tournaments.length} tournaments:\n`);

        for (const t of tournaments) {
            console.log(`🏆 ${t.name} (ID: ${t.unique_tournament_id})`);
            await this.collectForTournament(t.unique_tournament_id, t.id);
            await new Promise(r => setTimeout(r, 1000));
        }

        await db.close();
    }
}

if (require.main === module) {
    new TournamentSeasonsCollector().collectAllTournaments()
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = new TournamentSeasonsCollector();