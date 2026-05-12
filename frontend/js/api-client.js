export default class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || 'http://localhost:3000/api';
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        try {
            const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error.message);
            return { success: false, data: [] };
        }
    }

    async get(endpoint, params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.request(qs ? `${endpoint}?${qs}` : endpoint);
    }

    async post(endpoint, data) {
        return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
    }

    async getLiveMatches() { const r = await this.get('/matches/live'); return r.data || []; }
    async getMatchesByDate(date) { const r = await this.get('/matches/date', { date }); return r.data || []; }
    async getUpcomingMatches(days = 7) { const r = await this.get('/matches/upcoming', { days }); return r.data || []; }
    async getRecentMatches(limit = 10) { const r = await this.get('/matches/recent', { limit }); return r.data || []; }
    async getMatchById(id) { const r = await this.get(`/matches/${id}`); return r.data; }
    async getUpcomingPredictions() { const r = await this.get('/predictions/upcoming'); return r.data || []; }
    async getPrediction(matchId) { const r = await this.get(`/predictions/match/${matchId}`); return r.data; }
    async getValueBets(date = null) {
    const params = date ? { date } : {};
    const r = await this.get('/analytics/value-bets', params);
    return r.data || [];
}
    async getTeamById(id) { const r = await this.get(`/teams/${id}`); return r.data; }
    async searchTeams(query) { const r = await this.get('/teams/search', { q: query }); return r.data || []; }
    async getH2HComparison(t1, t2) { const r = await this.get('/analytics/h2h', { team1Id: t1, team2Id: t2 }); return r.data; }
    async getDashboardSummary() { const r = await this.get('/analytics/summary'); return r.data; }
    async getPipelineStatus(date) { return this.get(`/pipeline/status/${date}`); }
    async triggerPipeline(date) { return this.post(`/pipeline/collect/${date}`); }
}