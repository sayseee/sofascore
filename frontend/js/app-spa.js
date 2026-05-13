import ApiClient from './api-client.js';
import AIAssistant from './modules/ai-assistant.js';  // ← Must be exactly this path

class App {
    constructor() {
        this.apiClient = new ApiClient('http://localhost:3000/api');
        this.aiAssistant = new AIAssistant(this.apiClient);  // ← ADD THIS LINE
        this.currentDate = new Date().toISOString().split('T')[0];
        this.matches = [];
        this.selectedMatchId = null;
        this.init();
    }

    async init() {
        console.log('⚽ Sofascore Analytics Initializing...');
        this.setupEventListeners();
        this.aiAssistant.init();  // ← ADD THIS LINE
        await this.ensureDataAvailable(this.currentDate);
        await this.loadMatches(this.currentDate);
        await this.loadValueBets();
        await this.loadSidebarData();
        console.log('✅ Ready');
    }

    async ensureDataAvailable(date) {
        try {
            const res = await this.apiClient.getPipelineStatus(date);
            const status = res.data || res;
            console.log(`📊 Data: ${status.progress}% (${status.tables?.matches || 0} matches)`);
            
            if (status.progress < 50 || !status.tables?.matches) {
                this.showPipelineOverlay(date);
                await this.apiClient.triggerPipeline(date);
                await this.pollPipelineProgress(date);
                this.hidePipelineOverlay();
            }
        } catch (e) {
            console.warn('Pipeline check failed, proceeding:', e.message);
        }
    }

    showPipelineOverlay(date) {
        const overlay = document.getElementById('pipelineOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
            document.getElementById('pipelineDate').textContent = date;
        }
    }

    hidePipelineOverlay() {
        const overlay = document.getElementById('pipelineOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    async pollPipelineProgress(date) {
        const maxAttempts = 60;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 3000));
            
            try {
                // Get running job info
                const progRes = await this.apiClient.get('/pipeline/progress');
                const jobs = progRes.data || [];
                
                // ⚡ Find the job for THIS date
                const currentJob = jobs.find(j => j.date === date) || jobs[0];
                
                // Get data completion status
                const res = await this.apiClient.getPipelineStatus(date);
                const status = res.data || res;
                
                // Update progress bar
                const fill = document.getElementById('pipelineProgressFill');
                const percent = document.getElementById('pipelinePercent');
                const step = document.getElementById('pipelineStep');
                
                // Use job progress if available, otherwise data status
                const displayProgress = currentJob?.progress || status.progress || 0;
                
                if (fill) fill.style.width = `${displayProgress}%`;
                if (percent) percent.textContent = `${displayProgress}%`;
                
                // Show current step from running job
                if (currentJob && currentJob.currentStep) {
                    let stepText = currentJob.currentStep;
                    
                    // Add details if available
                    if (currentJob.details) {
                        const d = currentJob.details;
                        if (d.matches) stepText = `✅ Found ${d.matches} matches`;
                        if (d.bettingEdges) stepText = `✅ ${d.bettingEdges} value bets found`;
                    }
                    
                    if (step) step.textContent = stepText;
                    
                    // Update phase indicators
                    const currentPhase = currentJob.currentPhase || 0;
                    
                    document.querySelectorAll('.phase').forEach(el => {
                        const phase = parseInt(el.dataset.phase);
                        const statusEl = el.querySelector('.phase-status');
                        
                        el.classList.remove('complete', 'active');
                        
                        if (phase < currentPhase) {
                            el.classList.add('complete');
                            if (statusEl) statusEl.textContent = '✅';
                        } else if (phase === currentPhase) {
                            el.classList.add('active');
                            if (statusEl) statusEl.textContent = '🔄';
                        } else {
                            if (statusEl) statusEl.textContent = '⏳';
                        }
                    });
                }
                
                // Also update from data status
                if (status.progress >= 80 || displayProgress >= 100) {
                    // Mark all complete
                    document.querySelectorAll('.phase').forEach(el => {
                        el.classList.add('complete');
                        const s = el.querySelector('.phase-status');
                        if (s) s.textContent = '✅';
                    });
                    if (fill) fill.style.width = '100%';
                    if (percent) percent.textContent = '100%';
                    if (step) step.textContent = '✅ All data collected!';
                    await new Promise(r => setTimeout(r, 1000));
                    return;
                }
                
            } catch (e) {
                console.warn('Progress check:', e.message);
            }
            attempts++;
        }
        
        // Timeout - hide overlay and load whatever we have
        console.log('⏰ Pipeline timeout, loading available data');
    }

    setupEventListeners() {
    // Set date picker to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayFormatted = `${yyyy}-${mm}-${dd}`;
    
    document.getElementById('datePicker').value = todayFormatted;
    this.currentDate = todayFormatted;
    document.getElementById('statusDate').textContent = todayFormatted;
    document.getElementById('rowStatusDate').textContent = todayFormatted;

    // ⚡ Load button - reload everything for new date
    document.getElementById('loadDateBtn').addEventListener('click', async () => {
        const newDate = document.getElementById('datePicker').value;
        if (newDate && newDate !== this.currentDate) {
            this.currentDate = newDate;
            document.getElementById('statusDate').textContent = newDate;
            document.getElementById('rowStatusDate').textContent = newDate;
            
            // Show loading state in both panels
            document.getElementById('matchTableBody').innerHTML = 
                '<tr><td colspan="11" class="loading-text">Loading matches for ' + newDate + '...</td></tr>';
            
            document.getElementById('valueBetsHigh').innerHTML = 
                '<div class="loading-text" style="font-size:9px;padding:8px;">Loading...</div>';
            document.getElementById('valueBetsMedium').innerHTML = 
                '<div class="loading-text" style="font-size:9px;padding:8px;">Loading...</div>';
            document.getElementById('valueBetsLow').innerHTML = 
                '<div class="loading-text" style="font-size:9px;padding:8px;">Loading...</div>';
            
            // ⚡ Check if data exists for this date
            await this.ensureDataAvailable(newDate);
            
            // ⚡ Reload BOTH matches AND value bets
            await this.loadMatches(newDate);
            await this.loadValueBets();
            await this.loadSidebarData();
        }
    });

    // Refresh button - reload current date
    document.getElementById('refreshBtn').addEventListener('click', () => {
        this.loadMatches(this.currentDate);
        this.loadValueBets();
    });

    // Status filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.filterByStatus(btn.dataset.filter);
        });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', e => {
        this.filterMatches(e.target.value);
    });
    document.getElementById('searchInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') this.filterMatches(e.target.value);
    });

    // Modal
    document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
    document.getElementById('matchModal').addEventListener('click', e => {
        if (e.target === document.getElementById('matchModal')) this.closeModal();
    });
}

    async loadMatches(date) {
        const tbody = document.getElementById('matchTableBody');
        tbody.innerHTML = '<tr><td colspan="11" class="loading-text">Loading...</td></tr>';
        try {
            const response = await this.apiClient.get('/matches/with-odds', { date });
            this.matches = response.data || response || [];
            document.getElementById('matchCount').textContent = `${this.matches.length} matches`;
            document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
            document.getElementById('statusDate').textContent = date;
            this.renderMatches(this.matches);
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="11" class="loading-text">Failed to load</td></tr>';
        }
    }

    async loadSidebarData() {
        try {
            const response = await this.apiClient.get('/matches/with-odds', { date: this.currentDate });
            const matches = response.data || response || [];
            const uniqueTournaments = [...new Set(matches.map(m => m.tournament).filter(Boolean))];
            const filterDiv = document.getElementById('tournamentFilters');
            filterDiv.innerHTML = `
                <label class="filter-item active"><input type="radio" name="tournament" value="all" checked> All</label>
                ${uniqueTournaments.map(t => `<label class="filter-item"><input type="radio" name="tournament" value="${t}"> ${t}</label>`).join('')}
            `;
            document.querySelectorAll('input[name="tournament"]').forEach(radio => {
                radio.addEventListener('change', () => this.filterMatches(this.getSearchTerm()));
            });
        } catch(e) {}
    }

    async loadValueBets(date = null) {
    const highEl = document.getElementById('valueBetsHigh');
    const medEl = document.getElementById('valueBetsMedium');
    const lowEl = document.getElementById('valueBetsLow');
    const countEl = document.getElementById('valueBetCount');
    
    if (!highEl || !medEl || !lowEl) return;
    
    [highEl, medEl, lowEl].forEach(el => 
        el.innerHTML = '<div class="loading-text" style="font-size:9px;padding:8px;">Loading...</div>'
    );
    
    try {
        const queryDate = date || this.currentDate;
        // ⚡ Pass date to API
        const res = await this.apiClient.getValueBets(queryDate);
        const bets = res.data || res || [];
        
        const high = bets.filter(b => b.confidence_level === 'high');
        const medium = bets.filter(b => b.confidence_level === 'medium');
        const low = bets.filter(b => b.confidence_level === 'low');
        
        if (countEl) countEl.textContent = `${bets.length} bets (${high.length}H/${medium.length}M/${low.length}L)`;
        document.getElementById('valueCount').textContent = `${bets.length} value bets`;
        
        highEl.innerHTML = this.renderBetPanel(high, 'high');
        medEl.innerHTML = this.renderBetPanel(medium, 'medium');
        lowEl.innerHTML = this.renderBetPanel(low, 'low');
        
    } catch(e) {
        [highEl, medEl, lowEl].forEach(el => 
            el.innerHTML = '<div class="text-muted" style="font-size:9px;padding:8px;">Failed</div>'
        );
    }
}

    renderBetPanel(bets, level) {
    if (bets.length === 0) return `<div class="text-muted" style="font-size:9px;padding:8px;">None</div>`;
    
    return bets.map(bet => `
        <div class="value-bet-mini" onclick="window.app.openMatchModal(${bet.match_id})" style="cursor:pointer;padding:3px 6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:9px;flex:1;">
                    <strong>${bet.home_team_name||'?'}</strong> vs ${bet.away_team_name||'?'}
                </span>
                <span style="font-size:8px;color:var(--accent-primary);font-weight:600;">+${bet.edge_percentage}%</span>
            </div>
            <div style="font-size:8px;color:var(--text-tertiary);margin-top:1px;">
                ${bet.selection} @ ${bet.bookmaker_odds} | EV: ${bet.expected_value > 0 ? '+' : ''}${(bet.expected_value * 100).toFixed(1)}%
            </div>
        </div>
    `).join('');
}

    renderMatches(matches) {
        const tbody = document.getElementById('matchTableBody');
        if (matches.length === 0) { tbody.innerHTML = '<tr><td colspan="11" class="loading-text">No matches</td></tr>'; return; }
        tbody.innerHTML = matches.map(m => this.createMatchRow(m)).join('');
        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => { this.selectedMatchId = row.dataset.matchId; this.selectMatch(row.dataset.matchId); });
            row.ondblclick = () => this.openMatchModal(row.dataset.matchId);
        });
    }

    createMatchRow(match) {
        const time = match.match_datetime ? new Date(match.match_datetime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '--:--';
        const statusClass = [6,7,31,32,33].includes(match.status) ? 'live' : [100,101,102].includes(match.status) ? 'finished' : 'scheduled';
        const oddsHome = match.odds_home ? Number(match.odds_home).toFixed(2) : '-';
        const oddsDraw = match.odds_draw ? Number(match.odds_draw).toFixed(2) : '-';
        const oddsAway = match.odds_away ? Number(match.odds_away).toFixed(2) : '-';
        let edgeHtml = '-';
        if (match.home_edge_percentage !== null && match.home_edge_percentage !== undefined) {
            const hE = parseFloat(match.home_edge_percentage), aE = parseFloat(match.away_edge_percentage||0);
            if (hE > 2) edgeHtml = `<span class="edge-positive">H+${hE}%</span>`;
            else if (aE > 2) edgeHtml = `<span class="edge-positive">A+${aE}%</span>`;
            else edgeHtml = `<span>${hE}%/${aE}%</span>`;
        }
        const hProb = match.home_actual_probability ? `${(match.home_actual_probability*100).toFixed(0)}%` : '-';
        const aProb = match.away_actual_probability ? `${(match.away_actual_probability*100).toFixed(0)}%` : '-';
        return `<tr data-match-id="${match.id}" class="${match.id===this.selectedMatchId?'selected':''}">
            <td><span class="tag ${statusClass}">${time}</span></td>
            <td class="team-cell">${match.home_team||'Home'}</td>
            <td class="score-cell">${match.home_score!==null?`${match.home_score}-${match.away_score}`:'vs'}</td>
            <td class="team-cell">${match.away_team||'Away'}</td>
            <td style="font-size:10px;color:var(--text-tertiary);">${match.tournament||'-'}</td>
            <td class="odds-cell">${oddsHome}</td><td class="odds-cell">${oddsDraw}</td><td class="odds-cell">${oddsAway}</td>
            <td>${edgeHtml}</td><td>${hProb}</td><td>${aProb}</td></tr>`;
    }

    selectMatch(matchId) {
        document.querySelectorAll('#matchTableBody tr').forEach(r => r.classList.toggle('selected', r.dataset.matchId == matchId));
        const match = this.matches.find(m => m.id == matchId);
        if (match) this.loadStandings(match.tournament_id);
    }

    async loadStandings(tournamentId) {
        const content = document.getElementById('standingsContent');
        content.innerHTML = '<p class="loading-text">Loading...</p>';
        try {
            const res = await this.apiClient.get('/analytics/standings', { tournamentId });
            const st = res.data || [];
            if (!st.length) { content.innerHTML = '<p class="text-muted">No standings</p>'; return; }
            content.innerHTML = `<table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>
                ${st.map(s => `<tr><td>${s.position}</td><td>${s.team_name}</td><td>${s.matches_played}</td><td>${s.wins}</td><td>${s.draws}</td><td>${s.losses}</td><td>${s.goal_difference>0?'+':''}${s.goal_difference}</td><td><strong>${s.points}</strong></td></tr>`).join('')}
            </tbody></table>`;
        } catch(e) { content.innerHTML = '<p class="text-muted">Failed</p>'; }
    }

    // Update the openMatchModal method - the strength parameter is already being passed correctly
async openMatchModal(matchId) {
    const modal = document.getElementById('matchModal');
    const body = document.getElementById('modalBody');
    modal.style.display = 'flex';
    body.innerHTML = '<div class="loading-text">Loading full analysis...</div>';

    try {
        const match = await this.apiClient.getMatchById(matchId);
        
        const homeTeamId = match.home_team_id || match.homeTeam?.id || match.home_team;
        const awayTeamId = match.away_team_id || match.awayTeam?.id || match.away_team;
        
        // ⚡ Load all data in parallel
        const [h2hRes, formHomeRes, formAwayRes, standingsRes, strengthRes] = await Promise.allSettled([
            this.apiClient.getH2HComparison(homeTeamId, awayTeamId),
            this.apiClient.get(`/analytics/team/${match.home_team_id}/form`),
            this.apiClient.get(`/analytics/team/${match.away_team_id}/form`),
            this.apiClient.get('/analytics/standings', { tournamentId: match.tournament_id }),
            this.apiClient.get(`/analytics/match/${matchId}/strength`)  // This is correct
        ]);

        const h2h = h2hRes.status === 'fulfilled' ? h2hRes.value : null;
        const formHome = formHomeRes.status === 'fulfilled' ? formHomeRes.value : null;
        const formAway = formAwayRes.status === 'fulfilled' ? formAwayRes.value : null;
        const standings = standingsRes.status === 'fulfilled' ? standingsRes.value : null;
        
        // ⚡ FIX: Extract the strength data correctly
        let strength = null;
        if (strengthRes.status === 'fulfilled' && strengthRes.value) {
            strength = strengthRes.value.data || strengthRes.value;
        }

        document.getElementById('modalTitle').textContent = 
            `${match.home_team_name || 'Home'} vs ${match.away_team_name || 'Away'}`;
        
        // ⚡ PASS strength to the render function (6 parameters)
        body.innerHTML = this.renderFullMatchAnalysis(match, h2h, formHome, formAway, standings, strength);

        // Setup tab switching
        body.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                body.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                body.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tabId = 'tab-' + btn.dataset.tab;
                const tabContent = body.querySelector('#' + tabId);
                if (tabContent) tabContent.classList.add('active');
            });
        });

    } catch(e) {
        console.error('Modal error:', e);
        body.innerHTML = '<p class="loading-text">Failed to load analysis</p>';
    }
}

// UPDATE the renderFullMatchAnalysis to accept 6 parameters (add strength)
renderFullMatchAnalysis(match, h2h, formHome, formAway, standings, strength) {
    const homeForm = formHome?.data?.formString || formHome?.formString || '-----';
    const awayForm = formAway?.data?.formString || formAway?.formString || '-----';
    const homePPG = formHome?.data?.ppg || formHome?.ppg || '-';
    const awayPPG = formAway?.data?.ppg || formAway?.ppg || '-';
    const homeWins = formHome?.data?.wins || formHome?.wins || 0;
    const awayWins = formAway?.data?.wins || formAway?.wins || 0;
    const homeDraws = formHome?.data?.draws || formHome?.draws || 0;
    const awayDraws = formAway?.data?.draws || formAway?.draws || 0;
    const homeLosses = formHome?.data?.losses || formHome?.losses || 0;
    const awayLosses = formAway?.data?.losses || formAway?.losses || 0;

    // H2H stats
    let h2hStats = { team1Wins: 0, draws: 0, team2Wins: 0, matches: [] };
    const h2hData = h2h?.data || h2h;
    if (h2hData?.matches) {
        const h2hMatches = h2hData.matches;
        h2hStats.matches = h2hMatches;
        h2hMatches.forEach(h => {
            if ((h.home_team_id === match.home_team_id && h.home_score > h.away_score) ||
                (h.away_team_id === match.home_team_id && h.away_score > h.home_score)) {
                h2hStats.team1Wins++;
            } else if (h.home_score === h.away_score) {
                h2hStats.draws++;
            } else {
                h2hStats.team2Wins++;
            }
        });
    }
    const h2hTotal = h2hData?.totalMatches || 0;

    return `
    <div class="analysis-tabs">
        <button class="tab-btn active" data-tab="overview">📊 Overview</button>
        <button class="tab-btn" data-tab="h2h">⚔️ H2H</button>
        <button class="tab-btn" data-tab="form">📈 Form</button>
        <button class="tab-btn" data-tab="strength">💪 Strength</button>
    </div>

    <!-- OVERVIEW TAB -->
    <div class="tab-content active" id="tab-overview">
        <div class="analysis-grid">
            <div class="analysis-section">
                <h4>📊 Match Info</h4>
                <div style="font-size:10px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                    <div>🏆 ${match.tournament_name || 'N/A'}</div>
                    <div>📅 ${match.match_date || 'N/A'}</div>
                    <div>🏟️ ${match.venue_name || 'TBD'}</div>
                    <div>👨‍⚖️ ${match.referee_name || 'TBD'}</div>
                </div>
                ${match.home_score !== null ? 
                    `<div style="text-align:center;margin:12px 0;">
                        <span style="font-size:28px;font-weight:700;">${match.home_score} - ${match.away_score}</span>
                        <div style="font-size:10px;color:var(--text-tertiary);">${match.status_description || 'Final'}</div>
                    </div>` : ''}
            </div>

            <div class="analysis-section">
                <h4>🎲 Match Odds</h4>
                ${match.odds?.length ? match.odds.filter(o => o.market_group === '1X2' || o.selection_name === '1' || o.selection_name === 'X' || o.selection_name === '2').slice(0, 3).map(o => `
                    <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;">
                        <span>${o.selection_name === '1' ? match.home_team_name : o.selection_name === '2' ? match.away_team_name : 'Draw'}</span>
                        <span class="odds-cell" style="font-weight:600;">${o.decimal_odds || o.home_value || o.away_value || '-'}</span>
                    </div>
                `).join('') : '<p class="text-muted">No odds available</p>'}
            </div>

            <div class="analysis-section">
                <h4>📈 Recent Form</h4>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:10px;">${match.home_team_name}</span>
                    <span style="font-family:monospace;font-size:12px;letter-spacing:2px;">${this.formatFormString(homeForm)}</span>
                    <span style="font-size:10px;color:var(--accent-primary);">PPG: ${homePPG}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:10px;">${match.away_team_name}</span>
                    <span style="font-family:monospace;font-size:12px;letter-spacing:2px;">${this.formatFormString(awayForm)}</span>
                    <span style="font-size:10px;color:var(--accent-primary);">PPG: ${awayPPG}</span>
                </div>
            </div>

            <div class="analysis-section">
                <h4>🏆 Standings</h4>
                ${standings?.data?.length ? `
                    <table class="standings-table">
                        <thead><tr><th>#</th><th>Team</th><th>Pts</th></tr></thead>
                        <tbody>${standings.data.slice(0, 6).map(s => `
                            <tr>
                                <td>${s.position}</td><td>${s.team_name}</td><td><strong>${s.points}</strong></td>
                            </tr>`).join('')}</tbody>
                    </table>
                ` : '<p class="text-muted">No standings</p>'}
            </div>
        </div>
    </div>

    <!-- STRENGTH TAB -->
    <div class="tab-content" id="tab-strength">
        ${strength?.home ? `
            <div class="analysis-section">
                <h4>${strength.home.team} Strength: ${strength.home.totalStrength}</h4>
                <p>Starting XI Avg Rating: ${strength.home.startingXIStrength || 'N/A'}</p>
                <p>Key Players: ${strength.home.keyPlayers?.map(p => p.name).join(', ') || 'None listed'}</p>
                ${strength.home.missingPlayers?.length > 0 ? 
                    `<p style="color:var(--accent-danger);">⚠️ Missing: ${strength.home.missingPlayers.map(m => m.player_name || m.name).join(', ')}</p>` : 
                    '<p>✅ Full squad available</p>'}
                ${strength.home.formation ? `<p>Formation: ${strength.home.formation}</p>` : ''}
            </div>
            <div class="analysis-section">
                <h4>${strength.away.team} Strength: ${strength.away.totalStrength}</h4>
                <p>Starting XI Avg Rating: ${strength.away.startingXIStrength || 'N/A'}</p>
                <p>Key Players: ${strength.away.keyPlayers?.map(p => p.name).join(', ') || 'None listed'}</p>
                ${strength.away.missingPlayers?.length > 0 ? 
                    `<p style="color:var(--accent-danger);">⚠️ Missing: ${strength.away.missingPlayers.map(m => m.player_name || m.name).join(', ')}</p>` : 
                    '<p>✅ Full squad available</p>'}
                ${strength.away.formation ? `<p>Formation: ${strength.away.formation}</p>` : ''}
            </div>
            ${strength?.analysis ? `
                <div class="analysis-section">
                    <h4>📊 Analysis</h4>
                    <p>Strength Difference: ${strength.analysis.strengthDifference || '0'}</p>
                    <p>Home Advantage: ${strength.analysis.homeAdvantage || 'Even'}</p>
                    <p>Adjusted Home Probability: ${strength.analysis.adjustedHomeProbability || 'N/A'}</p>
                    <p>Confidence: ${strength.analysis.confidence || 'low'}</p>
                </div>
                ` : `
                <div class="analysis-section">
                    <p class="text-muted">No analysis available. Lineup data required for strength calculation.</p>
                </div>
                `}
        ` : strength?.message ? `
            <div class="analysis-section">
                <p class="text-muted">${strength.message}</p>
            </div>
        ` : `
            <div class="analysis-section">
                <p class="text-muted">No strength data available. Lineups may not be available for this match.</p>
            </div>
        `}
    </div>

    <!-- H2H TAB -->
    <div class="tab-content" id="tab-h2h">
        <div class="analysis-section">
            <h4>⚔️ Head-to-Head History</h4>
            ${h2hTotal > 0 ? `
                <div style="display:flex;justify-content:space-around;text-align:center;margin:12px 0;">
                    <div><span style="font-size:20px;font-weight:700;">${h2hStats.team1Wins}</span><br><span style="font-size:9px;">${match.home_team_name}</span></div>
                    <div><span style="font-size:20px;font-weight:700;">${h2hStats.draws}</span><br><span style="font-size:9px;">Draws</span></div>
                    <div><span style="font-size:20px;font-weight:700;">${h2hStats.team2Wins}</span><br><span style="font-size:9px;">${match.away_team_name}</span></div>
                </div>
                <div style="max-height:200px;overflow-y:auto;">
                ${h2hStats.matches.slice(0, 10).map(h => `
                    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-primary);font-size:10px;">
                        <span>${h.match_date || ''}</span>
                        <span>${h.home_score} - ${h.away_score}</span>
                        <span style="color:var(--text-tertiary);">${h.tournament_name || ''}</span>
                    </div>
                `).join('')}
                </div>
            ` : '<p class="text-muted">No H2H data available</p>'}
        </div>
    </div>

    <!-- FORM TAB -->
    <div class="tab-content" id="tab-form">
        <div class="analysis-grid">
            <div class="analysis-section">
                <h4>${match.home_team_name}</h4>
                <div style="font-family:monospace;font-size:20px;letter-spacing:4px;text-align:center;margin:10px 0;">
                    ${this.formatFormString(homeForm)}
                </div>
                <div style="text-align:center;font-size:10px;color:var(--text-tertiary);">
                    ${homeWins}W ${homeDraws}D ${homeLosses}L | PPG: ${homePPG}
                </div>
            </div>
            <div class="analysis-section">
                <h4>${match.away_team_name}</h4>
                <div style="font-family:monospace;font-size:20px;letter-spacing:4px;text-align:center;margin:10px 0;">
                    ${this.formatFormString(awayForm)}
                </div>
                <div style="text-align:center;font-size:10px;color:var(--text-tertiary);">
                    ${awayWins}W ${awayDraws}D ${awayLosses}L | PPG: ${awayPPG}
                </div>
            </div>
        </div>
    </div>`;
}

formatFormString(form) {
    if (!form) return '-----';
    return form.split('').map(c => {
        if (c === 'W') return '<span style="color:var(--accent-success);">W</span>';
        if (c === 'L') return '<span style="color:var(--accent-danger);">L</span>';
        return '<span style="color:var(--text-tertiary);">D</span>';
    }).join('');
}

    getIncidentIcon(type) {
        const icons = { 'goal': '⚽', 'card': '🟨', 'substitution': '🔄', 'period': '⏱️', 'var': '📺', 'injuryTime': '⏰' };
        return icons[type] || '●';
    }

    closeModal() { document.getElementById('matchModal').style.display = 'none'; }

    getSearchTerm() { return document.getElementById('searchInput').value; }

    filterMatches(term) {
        let filtered = this.matches;
        if (term) { const t = term.toLowerCase(); filtered = filtered.filter(m => (m.home_team||'').toLowerCase().includes(t) || (m.away_team||'').toLowerCase().includes(t)); }
        const tf = document.querySelector('input[name="tournament"]:checked')?.value;
        if (tf && tf !== 'all') filtered = filtered.filter(m => m.tournament === tf);
        document.getElementById('matchCount').textContent = `${filtered.length} matches`;
        this.renderMatches(filtered);
    }

    filterByStatus(sf) {
        let filtered = this.matches;
        if (sf === 'live') filtered = filtered.filter(m => [6,7,31,32,33].includes(m.status));
        else if (sf === 'finished') filtered = filtered.filter(m => [100,101,102].includes(m.status));
        else if (sf === 'scheduled') filtered = filtered.filter(m => ![6,7,31,32,33,100,101,102].includes(m.status));
        document.getElementById('matchCount').textContent = `${filtered.length} matches`;
        this.renderMatches(filtered);
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
export default App;