/**
 * API Client for backend communication
 */
export default class ApiClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
    }

    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                headers: { 'Content-Type': 'application/json', ...options.headers },
                ...options
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async get(endpoint, params = {}) {
        const qs = new URLSearchParams(params).toString();
        const url = qs ? `${endpoint}?${qs}` : endpoint;
        return this.request(url);
    }

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getLiveMatches() {
        const res = await this.get('/matches/live');
        return res.data || [];
    }

    async getMatchesByDate(date) {
        const res = await this.get('/matches/date', { date });
        return res.data || [];
    }

    async getUpcomingMatches(days = 7) {
        const res = await this.get('/matches/upcoming', { days });
        return res.data || [];
    }

    async getRecentMatches(limit = 10) {
        const res = await this.get('/matches/recent', { limit });
        return res.data || [];
    }

    async getMatchById(id) {
        const res = await this.get(`/matches/${id}`);
        return res.data;
    }

    async getUpcomingPredictions() {
        const res = await this.get('/predictions/upcoming');
        return res.data || [];
    }

    async getValueBets() {
        const res = await this.get('/analytics/value-bets');
        return res.data || [];
    }

    async getTeamById(id) {
        const res = await this.get(`/teams/${id}`);
        return res.data;
    }

    async searchTeams(query) {
        const res = await this.get('/teams/search', { q: query });
        return res.data || [];
    }

    async getH2HComparison(team1Id, team2Id) {
        const res = await this.get('/analytics/h2h', { team1Id, team2Id });
        return res.data;
    }

    async getDashboardSummary() {
        const res = await this.get('/analytics/summary');
        return res.data;
    }
}

