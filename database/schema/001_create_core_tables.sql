-- ============================================
-- 001: Core Tables (Tournaments, Seasons, Teams, Matches)
-- ============================================

CREATE TABLE IF NOT EXISTS tournaments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sofascore_tournament_id INT UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    country VARCHAR(100),
    country_code VARCHAR(10),
    category VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tournament_name (name),
    INDEX idx_active_tournaments (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seasons (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tournament_id INT NOT NULL,
    sofascore_season_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    year VARCHAR(20),
    start_date DATE,
    end_date DATE,
    is_current TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tournament_season (tournament_id, sofascore_season_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sofascore_team_id INT UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50),
    slug VARCHAR(255),
    country VARCHAR(100),
    country_code VARCHAR(10),
    venue_name VARCHAR(255),
    venue_capacity INT,
    founded_year INT,
    logo_url VARCHAR(500),
    manager_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_team_name (name),
    INDEX idx_team_country (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sofascore_match_id INT UNIQUE NOT NULL,
    custom_id VARCHAR(50) UNIQUE,
    tournament_id INT NOT NULL,
    season_id INT NOT NULL,
    home_team_id INT NOT NULL,
    away_team_id INT NOT NULL,
    match_date DATE,
    match_datetime DATETIME,
    status VARCHAR(50) DEFAULT 'scheduled',
    status_description VARCHAR(100),
    round_info VARCHAR(100),
    home_score INT DEFAULT NULL,
    away_score INT DEFAULT NULL,
    home_score_halftime INT DEFAULT NULL,
    away_score_halftime INT DEFAULT NULL,
    venue_name VARCHAR(255),
    referee_name VARCHAR(255),
    has_odds TINYINT(1) DEFAULT 0,
    has_statistics TINYINT(1) DEFAULT 0,
    has_lineups TINYINT(1) DEFAULT 0,
    has_incidents TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
    INDEX idx_match_date (match_date),
    INDEX idx_match_status (status),
    INDEX idx_home_away (home_team_id, away_team_id),
    INDEX idx_match_datetime (match_datetime),
    INDEX idx_custom_id (custom_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

