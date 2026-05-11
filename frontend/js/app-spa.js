/**
 * Sofascore Analytics - Scheduled Events with Odds & Winning Odds
 */
import ApiClient from './api-client.js';

class App {
    constructor() {
        this.apiClient = new ApiClient('http://localhost:3000/api');
        this.currentDate = new Date().toISOString().split('T')[0];
        this.matches = [];
        this.selectedMatchId = null;
        
        this.init();
    }

    async init() {
        console.log('⚽ Sofascore Analytics Initializing...');
        this.setupEventListeners();
        await this.loadMatches(this.currentDate);
        await this.loadSidebarData();
        console.log('✅ Ready');
    }

    setupEventListeners() {
        document.getElementById('datePicker').value = this.currentDate;
        
        document.getElementById('loadDateBtn').addEventListener('click', () => {
            this.currentDate = document.getElementById('datePicker').value;
            this.loadMatches(this.currentDate);
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadMatches(this.currentDate);
        });

            // ⚡ Status filter buttons (in the status bar)
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filterByStatus(btn.dataset.filter);
            });
        });


        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterMatches(e.target.value);
        });

        document.querySelectorAll('input[name="status"]').forEach(radio => {
            radio.addEventListener('change', () => this.filterMatches(this.getSearchTerm()));
        });

        document.querySelectorAll('input[name="tournament"]').forEach(radio => {
            radio.addEventListener('change', () => this.filterMatches(this.getSearchTerm()));
        });

        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.filterMatches(e.target.value);
        });
    }

    getSearchTerm() {
        return document.getElementById('searchInput').value;
    }

    /**
     * Load matches with odds and winning odds in ONE call
     */
    async loadMatches(date) {
    const tbody = document.getElementById('matchTableBody');
    tbody.innerHTML = '<tr><td colspan="10" class="loading-text">Loading matches...</td></tr>';

    try {
        const response = await this.apiClient.get('/matches/with-odds', { date });
        // ⚡ FIX: Extract data from response
        this.matches = response.data || response || [];
        
        document.getElementById('matchCount').textContent = `${this.matches.length} matches`;
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
        
        this.renderMatches(this.matches);
    } catch (error) {
        console.error('Failed to load matches:', error);
        tbody.innerHTML = '<tr><td colspan="10" class="loading-text">Failed to load matches</td></tr>';
    }
}

async loadSidebarData() {
    try {
        const response = await this.apiClient.get('/matches/with-odds', { date: this.currentDate });
        // ⚡ FIX: Extract data from response
        const matches = response.data || response || [];
        
        const uniqueTournaments = [...new Set(matches.map(m => m.tournament).filter(Boolean))];
        
        const filterDiv = document.getElementById('tournamentFilters');
        filterDiv.innerHTML = `
            <label class="filter-item active">
                <input type="radio" name="tournament" value="all" checked> All
            </label>
            ${uniqueTournaments.map(t => `
                <label class="filter-item">
                    <input type="radio" name="tournament" value="${t}"> ${t}
                </label>
            `).join('')}
        `;

        document.querySelectorAll('input[name="tournament"]').forEach(radio => {
            radio.addEventListener('change', () => this.filterMatches(this.getSearchTerm()));
        });

        try {
            const valueBetsRes = await this.apiClient.getValueBets();
            const valueBets = valueBetsRes.data || valueBetsRes || [];
            document.getElementById('valueCount').textContent = `${valueBets.length} value bets`;
        } catch (e) {}
    } catch (error) {
        console.error('Failed to load sidebar:', error);
    }
}

    renderMatches(matches) {
        const tbody = document.getElementById('matchTableBody');
        
        if (matches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading-text">No matches found for this date</td></tr>';
            return;
        }

        tbody.innerHTML = matches.map(match => this.createMatchRow(match)).join('');

        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => {
                const matchId = row.dataset.matchId;
                this.selectMatch(matchId);
            });
        });
    }

    createMatchRow(match) {
        const time = match.match_datetime 
            ? new Date(match.match_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '--:--';
        
        const statusClass = [6, 7, 31, 32, 33].includes(match.status) ? 'live' : 
                           [100, 101, 102].includes(match.status) ? 'finished' : 'scheduled';
        
        // ⚡ Odds with fallback
        const oddsHome = match.odds_home ? Number(match.odds_home).toFixed(2) : '-';
        const oddsDraw = match.odds_draw ? Number(match.odds_draw).toFixed(2) : '-';
        const oddsAway = match.odds_away ? Number(match.odds_away).toFixed(2) : '-';

        // ⚡ Winning odds edge
        let edgeHtml = '-';
        if (match.home_edge_percentage !== null && match.home_edge_percentage !== undefined) {
            const edge = parseFloat(match.home_edge_percentage);
            if (edge > 2) {
                edgeHtml = `<span class="edge-positive">H+${edge}%</span>`;
            } else if (match.away_edge_percentage > 2) {
                edgeHtml = `<span class="edge-positive">A+${match.away_edge_percentage}%</span>`;
            } else if (edge < -5) {
                edgeHtml = `<span class="edge-negative">${edge}%</span>`;
            }
        }

        return `
            <tr data-match-id="${match.id}" class="${match.id === this.selectedMatchId ? 'selected' : ''}">
                <td><span class="tag ${statusClass}">${time}</span></td>
                <td class="team-cell">${match.home_team || 'Home'}</td>
                <td class="score-cell">
                    ${match.home_score !== null ? `${match.home_score} - ${match.away_score}` : 'vs'}
                </td>
                <td class="team-cell">${match.away_team || 'Away'}</td>
                <td style="font-size:10px;color:var(--text-tertiary);">${match.tournament || '-'}</td>
                <td class="odds-cell">${oddsHome}</td>
                <td class="odds-cell">${oddsDraw}</td>
                <td class="odds-cell">${oddsAway}</td>
                <td>${edgeHtml}</td>
            </tr>
        `;
    }

    async selectMatch(matchId) {
        this.selectedMatchId = matchId;
        
        document.querySelectorAll('#matchTableBody tr').forEach(row => {
            row.classList.toggle('selected', row.dataset.matchId == matchId);
        });

        const panel = document.getElementById('detailPanel');
        panel.innerHTML = '<p class="loading-text">Loading...</p>';

        try {
            const match = await this.apiClient.getMatchById(matchId);
            panel.innerHTML = this.renderMatchDetail(match);
        } catch (error) {
            panel.innerHTML = '<p class="loading-text">Failed to load details</p>';
        }
    }

    renderMatchDetail(match) {
        if (!match) return '<p>Match not found</p>';
        
        let oddsHtml = '';
        if (match.odds && match.odds.length > 0) {
            oddsHtml = `
                <div style="margin-top:8px;">
                    <h5 style="font-size:10px;color:var(--text-tertiary);margin:0 0 4px 0;">🎲 ODDS</h5>
                    ${match.odds.filter(o => o.market_group === '1X2').map(o => `
                        <div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;">
                            <span>${o.selection_name}</span>
                            <span style="font-weight:600;">${o.decimal_odds}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        return `
            <div style="padding:8px;">
                <h4 style="margin:0 0 4px 0;font-size:12px;">${match.home_team_name} vs ${match.away_team_name}</h4>
                <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:6px;">
                    ${match.tournament_name || ''} · ${match.match_date || ''}
                </div>
                ${[100, 101, 102].includes(match.status) ? `
                    <div style="font-size:20px;font-weight:700;text-align:center;margin:6px 0;">
                        ${match.home_score} - ${match.away_score}
                    </div>
                ` : ''}
                <div style="font-size:10px;color:var(--text-tertiary);">
                    Status: ${match.status_description || match.status || 'Unknown'}
                </div>
                ${oddsHtml}
            </div>
        `;
    }

    filterMatches(searchTerm) {
        const statusFilter = document.querySelector('input[name="status"]:checked')?.value || 'all';
        const tournamentFilter = document.querySelector('input[name="tournament"]:checked')?.value || 'all';
        
        let filtered = this.matches;
        
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(m => 
                (m.home_team || '').toLowerCase().includes(term) ||
                (m.away_team || '').toLowerCase().includes(term)
            );
        }
        
        if (tournamentFilter !== 'all') {
            filtered = filtered.filter(m => m.tournament === tournamentFilter);
        }
        
        if (statusFilter !== 'all') {
            if (statusFilter === 'live') {
                filtered = filtered.filter(m => [6, 7, 31, 32, 33].includes(m.status));
            } else if (statusFilter === 'finished') {
                filtered = filtered.filter(m => [100, 101, 102].includes(m.status));
            } else if (statusFilter === 'scheduled') {
                filtered = filtered.filter(m => ![6, 7, 31, 32, 33, 100, 101, 102].includes(m.status));
            }
        }
        
        document.getElementById('matchCount').textContent = `${filtered.length} matches`;
        this.renderMatches(filtered);
    }

    // New method for status filter
    filterByStatus(statusFilter) {
        let filtered = this.matches;
        
        if (statusFilter === 'live') {
            filtered = filtered.filter(m => [6, 7, 31, 32, 33].includes(m.status));
        } else if (statusFilter === 'finished') {
            filtered = filtered.filter(m => [100, 101, 102].includes(m.status));
        } else if (statusFilter === 'scheduled') {
            filtered = filtered.filter(m => ![6, 7, 31, 32, 33, 100, 101, 102].includes(m.status));
        }
        // 'all' = no filter
        
        document.getElementById('matchCount').textContent = `${filtered.length} matches`;
        this.renderMatches(filtered);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

export default App;