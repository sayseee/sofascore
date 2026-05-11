/**
 * Sofascore API Configuration
 */
module.exports = {
    BASE_URL: 'https://api.sofascore.com/api/v1',
    WEB_BASE_URL: 'https://www.sofascore.com/api/v1',

    ENDPOINTS: {
        SCHEDULED_EVENTS: (date) => `/sport/football/scheduled-events/${date}`,
        LIVE_EVENTS: '/sport/football/events/live',
        EVENT_DETAILS: (eventId) => `/event/${eventId}`,
        EVENT_ODDS: (eventId) => `/event/${eventId}/odds/1/all`,
        WINNING_ODDS: (eventId) => `/event/${eventId}/provider/1/winning-odds`,
        H2H_EVENTS: (customId) => `/event/${customId}/h2h/events`,
        TEAM_DETAILS: (teamId) => `/team/${teamId}`,
        TEAM_LAST_EVENTS: (teamId, page = 0) => `/team/${teamId}/events/last/${page}`,
        TEAM_NEXT_EVENTS: (teamId, page = 0) => `/team/${teamId}/events/next/${page}`,
        TEAM_FORM: (teamId) => `/team/${teamId}/form`,
        TOURNAMENT_STANDINGS: (tournamentId, seasonId) =>
            `/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`,
        TOURNAMENT_SEASONS: (tournamentId) => `/unique-tournament/${tournamentId}/seasons`,
        SEASON_EVENTS: (tournamentId, seasonId) =>
            `/unique-tournament/${tournamentId}/season/${seasonId}/events`,
        MATCH_STATISTICS: (eventId) => `/event/${eventId}/statistics`,
        MATCH_GRAPH: (eventId) => `/event/${eventId}/graph`,
        PLAYER_STATISTICS: (eventId) => `/event/${eventId}/player-statistics`,
        HEATMAP: (eventId) => `/event/${eventId}/heatmap`,
        LINEUPS: (eventId) => `/event/${eventId}/lineups`,
        TEAM_PLAYERS: (teamId) => `/team/${teamId}/players`,
        TEAM_INJURIES: (teamId) => `/team/${teamId}/injuries`,
        INCIDENTS: (eventId) => `/event/${eventId}/incidents`
    },

    RATE_LIMITS: {
        REQUESTS_PER_MINUTE: 60,
        REQUESTS_PER_DAY: 10000,
        BURST_SIZE: 10,
        COOLDOWN_MS: 200
    },

    RETRY_POLICY: {
        MAX_ATTEMPTS: 3,
        INITIAL_DELAY_MS: 1000,
        MAX_DELAY_MS: 30000,
        BACKOFF_MULTIPLIER: 2
    }
};

