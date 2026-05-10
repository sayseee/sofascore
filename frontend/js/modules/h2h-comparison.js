export default class H2HComparison {
    constructor(apiClient) { this.apiClient = apiClient; }

    render() {
        return `
            <h1 style="margin-bottom:20px;">⚔️ Head-to-Head Comparison</h1>
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:24px;">
                <input type="text" id="team1Search" placeholder="Search Team 1..." class="search-input">
                <span style="font-size:24px;font-weight:700;color:var(--text-tertiary);">VS</span>
                <input type="text" id="team2Search" placeholder="Search Team 2..." class="search-input">
                <button class="btn" id="compareBtn">Compare</button>
            </div>
            <div id="h2hResults">
                <div class="empty-state">Search and select two teams to compare their head-to-head history</div>
            </div>
        `;
    }

    init() {
        document.getElementById('compareBtn')?.addEventListener('click', () => {
            const t1 = document.getElementById('team1Search').value;
            const t2 = document.getElementById('team2Search').value;
            document.getElementById('h2hResults').innerHTML = `
                <div class="panel">
                    <div class="panel-header"><h2>${t1} vs ${t2}</h2></div>
                    <div class="panel-body">
                        <p>Search for exact team names to see detailed head-to-head statistics.</p>
                        <p style="color:var(--text-tertiary);font-size:12px;">
                            Use the search endpoint: GET /api/teams/search?q=team_name
                        </p>
                    </div>
                </div>
            `;
        });
    }
}

