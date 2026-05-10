-- ============================================
-- Performance Indexes
-- ============================================

-- Match query optimization
CREATE INDEX idx_matches_date_status ON matches(match_date, status);
CREATE INDEX idx_matches_team_date ON matches(home_team_id, match_date);
CREATE INDEX idx_matches_status_datetime ON matches(status, match_datetime);

-- Odds optimization
CREATE INDEX idx_match_odds_match_bookmaker ON match_odds(match_id, bookmaker_id);
CREATE INDEX idx_match_odds_timestamp_match ON match_odds(timestamp_recorded, match_id);

-- Statistics optimization
CREATE INDEX idx_match_stats_match_team ON match_statistics(match_id, team_id);

-- Prediction optimization
CREATE INDEX idx_predictions_match_type ON prediction_results(match_id, prediction_type);
CREATE INDEX idx_predictions_created ON prediction_results(created_at);

-- Betting edges optimization
CREATE INDEX idx_betting_edges_match_value ON betting_edges(match_id, is_value_bet);
CREATE INDEX idx_betting_edges_timestamp ON betting_edges(timestamp_calculated);

-- Standings optimization
CREATE INDEX idx_standings_tournament_season ON standings(tournament_id, season_id);

-- System optimization
CREATE INDEX idx_ingestion_logs_collector ON ingestion_logs(collector_name, status);
CREATE INDEX idx_failed_jobs_status_retry ON failed_jobs(status, next_retry_at);
CREATE INDEX idx_retry_queue_status ON retry_queue(status, priority);

