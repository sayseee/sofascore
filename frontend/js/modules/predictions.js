export default class Predictions {
    constructor(apiClient) { this.apiClient = apiClient; }

    render(predictions) {
        if (!predictions || predictions.length === 0) {
            return '<h1>🤖 Predictions</h1><div class="empty-state">No predictions available</div>';
        }

        return `
            <h1 style="margin-bottom:20px;">🤖 AI Predictions</h1>
            <div class="panel">
                <div class="panel-body both-scroll" style="padding:0;">
                    <div class="data-table-container">
                        <table class="data-table">
                            <thead><tr>
                                <th>Match</th><th>Tournament</th>
                                <th>1</th><th>X</th><th>2</th>
                                <th>O2.5</th><th>BTTS</th><th>Confidence</th>
                            </tr></thead>
                            <tbody>
                                ${predictions.map(p => `
                                    <tr>
                                        <td class="sticky-col">${p.home_team_name || 'Home'} vs ${p.away_team_name || 'Away'}</td>
                                        <td>${p.tournament_name || '-'}</td>
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
                </div>
            </div>
        `;
    }
}

