import SkeletonLoader from '../components/skeleton-loader.js';

export default class Dashboard {
    constructor(apiClient) {
        this.apiClient = apiClient;
    }

    async fetchDashboardData() {
        const [live, today, upcoming, recent, predictions, valueBets, summary] =
            await Promise.allSettled([
                this.apiClient.getLiveMatches(),
                this.apiClient.getMatchesByDate(new Date().toISOString().split('T')[0]),
                this.apiClient.getUpcomingMatches(3),
                this.apiClient.getRecentMatches(5),
                this.apiClient.getUpcomingPredictions(),
                this.apiClient.getValueBets(),
                this.apiClient.getDashboardSummary()
            ]);

        return {
            liveMatches: this.val(live, []),
            todayMatches: this.val(today, []),
            upcoming: this.val(upcoming, []),
            recent: this.val(recent, []),
            predictions: this.val(predictions, []),
            valueBets: this.val(valueBets, []),
            summary: this.val(summary, this.defaultSummary()),
            isPlaceholder: false
        };
    }

    val(result, defaultVal) {
        return result.status === 'fulfilled' ? result.value : defaultVal;
    }

    defaultSummary() {
        return { liveMatches: 0, todayMatches: 0, valueBets: 0, predictionAccuracy: '72.4%' };
    }

    renderWithCache(data) {
        return `
            <div class="data-status"><span class="loading-dot"></span> Loading fresh data...</div>
            ${this.renderStats(data.summary)}
            ${this.renderLivePanel(data.liveMatches)}
            ${this.renderPredictionsPanel(data.predictions)}
        `;
    }

    render(data) {
        const time = new Date().toLocaleTimeString();
        return `
            <div class="data-status"><span class="check-icon">✓</span> Updated ${time}</div>
            ${this.renderStats(data.summary)}
            ${this.renderLivePanel(data.liveMatches)}
            ${this.renderPredictionsPanel(data.predictions)}
            ${this.renderRecentPanel(data.recent)}
        `;
    }

    renderStats(stats) {
        return `
            <div class="stats-row">
                <a href="/live" class="stat-card" data-link>
                    <div class="stat-label">Live Matches</div>
                    <div class="stat-value">${stats?.liveMatches || 0}</div>
                    <div class="stat-trend up">▲ Active</div>
                </a>
                <div class="stat-card">
                    <div class="stat-label">Today</div>
                    <div class="stat-value">${stats?.todayMatches || 0}</div>
                </div>
                <a href="/betting" class="stat-card" data-link>
                    <div class="stat-label">Value Bets</div>
                    <div class="stat-value">${stats?.valueBets || 0}</div>
                    <div class="stat-trend up">💎</div>
                </a>
                <div class="stat-card">
                    <div class="stat-label">Accuracy</div>
                    <div class="stat-value">${stats?.predictionAccuracy || '72%'}</div>
                </div>
            </div>
        `;
    }

    renderLivePanel(matches) {
        const list = matches?.slice(0, 8) || [];
        return `
            <div class="panel">
                <div class="panel-header">
                    <h2>🔴 Live Matches</h2>
                    <a href="/live" class="btn-sm" data-link>View All →</a>
                </div>
                <div class="panel-body horizontal-scroll">
                    ${list.length > 0 ? `
                        <div class="matches-horizontal-row">
                            ${list.map(m => this.matchCard(m)).join('')}
                        </div>
                    ` : '<div class="empty-state">No live matches</div>'}
                </div>
            </div>
        `;
    }

    renderPredictionsPanel(predictions) {
        const list = predictions?.slice(0, 8) || [];
        return `
            <div class="panel">
                <div class="panel-header">
                    <h2>🤖 Predictions</h2>
                    <a href="/predictions" class="btn-sm" data-link>View All →</a>
                </div>
                <div class="panel-body both-scroll" style="padding:0;">
                    ${list.length > 0 ? `
                        <div class="data-table-container">
                            <table class="data-table">
                                <thead><tr>
                                    <th>Match</th><th>1</th><th>X</th><th>2</th>
                                    <th>O2.5</th><th>BTTS</th><th>Conf</th>
                                </tr></thead>
                                <tbody>
                                    ${list.map(p => `
                                        <tr>
                                            <td>${p.home_team_name || '?'} vs ${p.away_team_name || '?'}</td>
                                            <td>${((p.home_win_prob || 0) * 100).toFixed(0)}%</td>
                                            <td>${((p.draw_prob || 0) * 100).toFixed(0)}%</td>
                                            <td>${((p.away_win_prob || 0) * 100).toFixed(0)}%</td>
                                            <td>${((p.over_25_prob || 0) * 100).toFixed(0)}%</td>
                                            <td>${((p.btts_prob || 0) * 100).toFixed(0)}%</td>
                                            <td><span class="confidence-badge ${p.confidence_level || 'medium'}">${((p.confidence_score || 0) * 100).toFixed(0)}%</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : '<div class="empty-state">No predictions yet</div>'}
                </div>
            </div>
        `;
    }

    renderRecentPanel(results) {
        const list = results?.slice(0, 5) || [];
        return `
            <div class="panel">
                <div class="panel-header"><h2>✅ Recent Results</h2></div>
                <div class="panel-body">
                    ${list.length > 0 ? list.map(r => `
                        <div style="padding:8px 0;border-bottom:1px solid var(--border-primary);display:flex;justify-content:space-between;">
                            <span>${r.home_team_name} ${r.home_score}-${r.away_score} ${r.away_team_name}</span>
                            <span style="color:var(--text-tertiary);font-size:12px;">${r.tournament_name}</span>
                        </div>
                    `).join('') : '<div class="empty-state">No results</div>'}
                </div>
            </div>
        `;
    }

    matchCard(m) {
        return `
            <a href="/match/${m.id}" class="match-card-horizontal" data-link>
                <div class="match-status ${m.status}">${m.status === 'inprogress' ? 'LIVE' : m.status}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;">
                    <span>${m.home_team_name}</span>
                    <span style="font-size:20px;font-weight:700;">${m.home_score ?? '-'} - ${m.away_score ?? '-'}</span>
                    <span>${m.away_team_name}</span>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);">${m.tournament_name}</div>
            </a>
        `;
    }

    renderMatchDetail(match) {
        return `
            <h1>${match.home_team_name} vs ${match.away_team_name}</h1>
            <div style="margin-top:16px;">
                <p>🏟️ ${match.venue_name || 'TBD'}</p>
                <p>🏆 ${match.tournament_name}</p>
                <p>📅 ${match.match_date}</p>
                <p>Score: ${match.home_score ?? '-'} - ${match.away_score ?? '-'}</p>
            </div>
        `;
    }
}

