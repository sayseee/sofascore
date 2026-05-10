-- ============================================
-- 002: Odds & Winning Odds Tables
-- ============================================

CREATE TABLE IF NOT EXISTS bookmakers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sofascore_bookmaker_id INT UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_odds (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    bookmaker_id INT NOT NULL,
    market_type VARCHAR(50) NOT NULL,
    market_name VARCHAR(100),
    home_value DECIMAL(10,3),
    draw_value DECIMAL(10,3),
    away_value DECIMAL(10,3),
    over_value DECIMAL(10,3),
    under_value DECIMAL(10,3),
    handicap_value DECIMAL(10,3),
    timestamp_recorded DATETIME NOT NULL,
    is_closing TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (bookmaker_id) REFERENCES bookmakers(id) ON DELETE CASCADE,
    INDEX idx_match_market (match_id, market_type),
    INDEX idx_bookmaker_match (bookmaker_id, match_id),
    INDEX idx_timestamp (timestamp_recorded)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS winning_odds (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    provider_id INT DEFAULT 1,
    home_expected_probability DECIMAL(6,4) COMMENT 'Probability from bookmaker odds',
    home_actual_probability DECIMAL(6,4) COMMENT 'Historical win rate at these odds',
    home_expected_decimal DECIMAL(10,3),
    home_actual_decimal DECIMAL(10,3),
    home_expected_fractional VARCHAR(20),
    home_edge_percentage DECIMAL(6,2) COMMENT 'Actual - Expected edge',
    home_edge_type ENUM('positive', 'negative', 'neutral'),
    home_is_value TINYINT(1) DEFAULT 0,
    away_expected_probability DECIMAL(6,4),
    away_actual_probability DECIMAL(6,4),
    away_expected_decimal DECIMAL(10,3),
    away_actual_decimal DECIMAL(10,3),
    away_expected_fractional VARCHAR(20),
    away_edge_percentage DECIMAL(6,2),
    away_edge_type ENUM('positive', 'negative', 'neutral'),
    away_is_value TINYINT(1) DEFAULT 0,
    total_expected_probability DECIMAL(6,4),
    market_efficiency_gap DECIMAL(6,4) COMMENT 'Draw implied probability',
    timestamp_recorded DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    INDEX idx_match_timestamp (match_id, timestamp_recorded),
    INDEX idx_home_edge (home_edge_percentage),
    INDEX idx_away_edge (away_edge_percentage),
    INDEX idx_value_bets (home_is_value, away_is_value),
    INDEX idx_efficiency (market_efficiency_gap)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS odds_movements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    match_id INT NOT NULL,
    bookmaker_id INT NOT NULL,
    market_type VARCHAR(50) NOT NULL,
    previous_home DECIMAL(10,3),
    current_home DECIMAL(10,3),
    previous_draw DECIMAL(10,3),
    current_draw DECIMAL(10,3),
    previous_away DECIMAL(10,3),
    current_away DECIMAL(10,3),
    movement_direction VARCHAR(20),
    movement_percentage DECIMAL(5,2),
    timestamp_recorded DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (bookmaker_id) REFERENCES bookmakers(id) ON DELETE CASCADE,
    INDEX idx_match_movement (match_id, market_type),
    INDEX idx_timestamp (timestamp_recorded)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

