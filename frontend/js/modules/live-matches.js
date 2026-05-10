export default class LiveMatches {
    constructor(apiClient) { this.apiClient = apiClient; }

    render(matches) {
        return `
            <h1 style="margin-bottom:20px;">🔴 Live Matches</h1>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px;">
                ${matches.map(m => this.card(m)).join('')}
            </div>
        `;
    }

    renderUpcoming(matches) {
        return `
            <h1 style="margin-bottom:20px;">📅 Upcoming Matches</h1>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px;">
                ${matches.map(m => this.card(m)).join('')}
            </div>
        `;
    }

    card(m) {
        return `
            <a href="/match/${m.id}" class="match-card-horizontal" data-link style="display:block;">
                <div class="match-status ${m.status}">${m.status}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0;">
                    <span style="font-weight:500;">${m.home_team_name}</span>
                    <span style="font-size:22px;font-weight:700;">${m.home_score ?? '-'}:${m.away_score ?? '-'}</span>
                    <span style="font-weight:500;">${m.away_team_name}</span>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);">
                    ${m.tournament_name} · ${new Date(m.match_datetime).toLocaleString()}
                </div>
            </a>
        `;
    }
}

