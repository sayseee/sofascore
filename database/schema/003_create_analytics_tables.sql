-- ============================================
-- 003: Analytics, Predictions & System Tables
-- ============================================

CREATE TABLE IF NOT EXISTS match_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    team_id INT NOT NULL,
    period VARCHAR(20) DEFAULT 'ALL',
    possession_percentage DECIMAL(5,2),
    shots_on_target INT DEFAULT 0,
    shots_off_target INT DEFAULT 0,
    total_shots INT DEFAULT 0,
    blocked_shots INT DEFAULT 0,
    corner_kicks INT DEFAULT 0,
    offsides INT DEFAULT 0,
    fouls INT DEFAULT 0,
    yellow_cards INT DEFAULT 0,
    red_cards INT DEFAULT 0,
    attacks INT DEFAULT 0,
    dangerous_attacks INT DEFAULT 0,
    passes INT DEFAULT 0,
    accurate_passes INT DEFAULT 0,
    pass_percentage DECIMAL(5,2),
    tackles INT DEFAULT 0,
    clearances INT DEFAULT 0,
    saves INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE KEY uk_match_team_period (match_id, team_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS standings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tournament_id INT NOT NULL,
    season_id INT NOT NULL,
    team_id INT NOT NULL,
    position INT,
    points INT DEFAULT 0,
    matches_played INT DEFAULT 0,
    wins INT DEFAULT 0,
    draws INT DEFAULT 0,
    losses INT DEFAULT 0,
    goals_for INT DEFAULT 0,
    goals_against INT DEFAULT 0,
    goal_difference INT DEFAULT 0,
    home_wins INT DEFAULT 0,
    home_draws INT DEFAULT 0,
    home_losses INT DEFAULT 0,
    away_wins INT DEFAULT 0,
    away_draws INT DEFAULT 0,
    away_losses INT DEFAULT 0,
    form_string VARCHAR(10),
    last_updated DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tournament_season_team (tournament_id, season_id, team_id),
    INDEX idx_position (position),
    INDEX idx_points (points DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS h2h_matches (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pair_key VARCHAR(50) NOT NULL,
    match_id INT NOT NULL,
    home_team_id INT NOT NULL,
    away_team_id INT NOT NULL,
    match_date DATE,
    home_score INT,
    away_score INT,
    tournament_name VARCHAR(255),
    is_home_team_current_home TINYINT(1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    INDEX idx_pair_key (pair_key),
    INDEX idx_match_date (match_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prediction_results (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    prediction_type VARCHAR(50) DEFAULT 'comprehensive',
    home_win_prob DECIMAL(5,4),
    draw_prob DECIMAL(5,4),
    away_win_prob DECIMAL(5,4),
    predicted_home_score DECIMAL(5,2),
    predicted_away_score DECIMAL(5,2),
    over_15_prob DECIMAL(5,4),
    over_25_prob DECIMAL(5,4),
    over_35_prob DECIMAL(5,4),
    btts_prob DECIMAL(5,4),
    confidence_score DECIMAL(5,4),
    confidence_level VARCHAR(20),
    prediction_features JSON,
    model_version VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    INDEX idx_match_prediction (match_id, prediction_type),
    INDEX idx_confidence (confidence_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS betting_edges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    market_type VARCHAR(50) NOT NULL,
    bookmaker_id INT,
    selection VARCHAR(50),
    bookmaker_odds DECIMAL(10,3),
    model_probability DECIMAL(5,4),
    expected_value DECIMAL(10,4),
    edge_percentage DECIMAL(5,2),
    kelly_criterion DECIMAL(5,4),
    is_value_bet TINYINT(1) DEFAULT 0,
    confidence_level VARCHAR(20),
    timestamp_calculated DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    INDEX idx_value_bets (is_value_bet, edge_percentage DESC),
    INDEX idx_match (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingestion_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    collector_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    records_processed INT DEFAULT 0,
    records_inserted INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    records_failed INT DEFAULT 0,
    error_message TEXT,
    batch_size INT DEFAULT 0,
    processing_time_ms INT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_collector_status (collector_name, status),
    INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS failed_jobs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    job_type VARCHAR(100) NOT NULL,
    reference_id VARCHAR(100),
    error_message TEXT,
    stack_trace TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    status VARCHAR(20) DEFAULT 'PENDING',
    next_retry_at DATETIME,
    failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retry_queue (
    id INT PRIMARY KEY AUTO_INCREMENT,
    job_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    priority INT DEFAULT 5,
    status VARCHAR(20) DEFAULT 'QUEUED',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    next_retry_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status_priority (status, priority, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

