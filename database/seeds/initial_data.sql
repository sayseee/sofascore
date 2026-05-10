-- ============================================
-- Seed Data: Common Tournaments & Teams
-- ============================================

INSERT IGNORE INTO tournaments (sofascore_tournament_id, name, country, country_code, category)
VALUES 
    (17, 'Premier League', 'England', 'GB', 'domestic'),
    (8, 'La Liga', 'Spain', 'ES', 'domestic'),
    (23, 'Serie A', 'Italy', 'IT', 'domestic'),
    (35, 'Bundesliga', 'Germany', 'DE', 'domestic'),
    (34, 'Ligue 1', 'France', 'FR', 'domestic'),
    (7, 'UEFA Champions League', 'Europe', 'EU', 'international'),
    (679, 'UEFA Europa League', 'Europe', 'EU', 'international');

-- Insert common bookmakers
INSERT IGNORE INTO bookmakers (sofascore_bookmaker_id, name, slug)
VALUES 
    (1, 'bet365', 'bet365'),
    (2, 'William Hill', 'william-hill'),
    (3, 'Betfair', 'betfair'),
    (8, 'Pinnacle', 'pinnacle'),
    (14, '1xBet', '1xbet');

