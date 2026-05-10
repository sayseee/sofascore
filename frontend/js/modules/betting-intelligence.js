export default class BettingIntelligence {
    constructor(apiClient) { this.apiClient = apiClient; }

    render(valueBets) {
        if (!valueBets || valueBets.length === 0) {
            return `
                <h1>💎 Betting Intelligence</h1>
                <div class="empty-state">
                    <div style="font-size:48px;">💎</div>
                    <p>No value bets detected right now</p>
                    <p style="font-size:12px;color:var(--text-tertiary);">
                        Value bets appear when our model probability exceeds market implied probability by >2%
                    </p>
                </div>
            `;
        }

        return `
            <h1 style="margin-bottom:20px;">💎 Value Bets (Edge > 2%)</h1>
            <p style="color:var(--text-tertiary);margin-bottom:20px;">
                Found ${valueBets.length} value opportunities where historical results exceed market expectations
            </p>
            ${valueBets.map(vb => this.card(vb)).join('')}
        `;
    }

    card(bet) {
        return `
            <div class="value-bet-card">
                <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                    <span class="confidence-badge ${bet.confidence_level || 'medium'}">${(bet.confidence_level || 'medium').toUpperCase()}</span>
                    <span style="font-size:12px;color:var(--text-tertiary);">${bet.market_type}</span>
                </div>
                <h3>${bet.selection} @ ${bet.bookmaker_odds}</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
                    <div><small>EV:</small> ${bet.expected_value > 0 ? '+' : ''}${(bet.expected_value * 100).toFixed(1)}%</div>
                    <div><small>Edge:</small> +${bet.edge_percentage}%</div>
                    <div><small>Model:</small> ${(bet.model_probability * 100).toFixed(0)}%</div>
                    <div><small>Kelly:</small> ${(bet.kelly_criterion * 100).toFixed(1)}%</div>
                </div>
            </div>
        `;
    }
}

