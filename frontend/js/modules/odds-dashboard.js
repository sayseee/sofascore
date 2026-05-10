export default class OddsDashboard {
    constructor(apiClient) { this.apiClient = apiClient; }

    render(data) {
        const edges = data?.data || [];
        
        if (edges.length === 0) {
            return '<h1>🎲 Odds Dashboard</h1><div class="empty-state">No edge data available</div>';
        }

        return `
            <h1 style="margin-bottom:20px;">🎲 Winning Odds - Edge Analysis</h1>
            <p style="color:var(--text-tertiary);margin-bottom:20px;">
                🟡 Positive edge = Team historically wins more than odds suggest<br>
                ⚫ Negative edge = Team underperforms relative to odds
            </p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px;">
                ${edges.map(e => this.edgeCard(e)).join('')}
            </div>
        `;
    }

    edgeCard(match) {
        return `
            <div class="panel">
                <div class="panel-header">
                    <h3>${match.homeTeam} vs ${match.awayTeam}</h3>
                </div>
                <div class="panel-body">
                    <div class="edge-indicator ${match.homeEdge > 0 ? 'positive' : 'negative'}">
                        <span>🏠 Home: ${match.homeEdge}</span>
                    </div>
                    <div class="edge-indicator ${match.awayEdge > 0 ? 'positive' : 'negative'}" style="margin-top:8px;">
                        <span>🛫 Away: ${match.awayEdge}</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-tertiary);margin-top:12px;">
                        ${match.tournament} · ${new Date(match.matchDatetime).toLocaleString()}
                    </div>
                </div>
            </div>
        `;
    }
}

