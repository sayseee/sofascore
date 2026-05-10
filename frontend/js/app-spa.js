/**
 * Sofascore Analytics - SPA Application
 * Main entry point with routing
 */

import Router from './router.js';
import Dashboard from './modules/dashboard.js';
import LiveMatches from './modules/live-matches.js';
import Predictions from './modules/predictions.js';
import BettingIntelligence from './modules/betting-intelligence.js';
import OddsDashboard from './modules/odds-dashboard.js';
import H2HComparison from './modules/h2h-comparison.js';
import AIAssistant from './modules/ai-assistant.js';
import ApiClient from './api-client.js';
import AutoRefresh from './utils/auto-refresh.js';
import DataPreloader from './services/data-preloader.js';
import SkeletonLoader from './components/skeleton-loader.js';

class App {
    constructor() {
        // ⚡ FIXED: Point to backend API
        this.apiClient = new ApiClient('http://localhost:3000/api');
        this.router = new Router();
        this.autoRefresh = new AutoRefresh(30);
        this.preloader = DataPreloader;
        this.modules = {};
        this.currentState = {};
        
        this.init();
    }

    async init() {
        console.log('⚽ Sofascore Analytics SPA Initializing...');
        
        this.initModules();
        this.setupRoutes();
        this.renderNavigation();
        this.router.start();
        this.startLiveUpdates();
        this.modules.aiAssistant.init();
        
        console.log('✅ SPA Ready');
    }

    initModules() {
        this.modules = {
            dashboard: new Dashboard(this.apiClient),
            liveMatches: new LiveMatches(this.apiClient),
            predictions: new Predictions(this.apiClient),
            bettingIntelligence: new BettingIntelligence(this.apiClient),
            oddsDashboard: new OddsDashboard(this.apiClient),
            h2hComparison: new H2HComparison(this.apiClient),
            aiAssistant: new AIAssistant(this.apiClient)
        };
    }

    setupRoutes() {
        this.router.addRoute('/', () => this.renderDashboard());
        this.router.addRoute('/dashboard', () => this.renderDashboard());
        this.router.addRoute('/live', () => this.renderLiveMatches());
        this.router.addRoute('/upcoming', () => this.renderUpcomingMatches());
        this.router.addRoute('/odds', () => this.renderOdds());
        this.router.addRoute('/h2h', () => this.renderH2H());
        this.router.addRoute('/predictions', () => this.renderPredictions());
        this.router.addRoute('/betting', () => this.renderBetting());
        this.router.addRoute('/match/:id', (p) => this.renderMatchDetail(p.id));
        this.router.setNotFound(() => this.render404());
    }

    renderNavigation() {
        const app = document.getElementById('app');
        app.innerHTML = `
            <nav class="navbar">
                <div class="nav-brand">
                    <a href="/" data-link>
                        <span class="nav-title">⚽ Sofascore Analytics</span>
                        <span class="nav-badge">AI</span>
                    </a>
                </div>
                <div class="nav-tabs">
                    <a href="/dashboard" class="nav-tab" data-link>📊 Dashboard</a>
                    <a href="/live" class="nav-tab" data-link>🔴 Live</a>
                    <a href="/upcoming" class="nav-tab" data-link>📅 Upcoming</a>
                    <a href="/odds" class="nav-tab" data-link>🎲 Odds</a>
                    <a href="/h2h" class="nav-tab" data-link>⚔️ H2H</a>
                    <a href="/predictions" class="nav-tab" data-link>🤖 Predictions</a>
                    <a href="/betting" class="nav-tab" data-link>💎 Value Bets</a>
                </div>
                <div class="nav-actions">
                    <span class="auto-refresh-indicator">
                        <span class="loading-dot"></span> Auto-refresh
                    </span>
                    <button class="btn-icon" id="refreshBtn" title="Refresh">🔄</button>
                </div>
            </nav>
            <main class="main-content" id="main-content"></main>
            <div id="aiAssistantContainer"></div>
        `;

        document.getElementById('refreshBtn').addEventListener('click', () => {
            const btn = document.getElementById('refreshBtn');
            btn.style.animation = 'spin 0.5s linear';
            this.router.navigate(window.location.pathname);
            setTimeout(() => btn.style.animation = '', 500);
        });

        this.highlightActiveNav();
        window.addEventListener('popstate', () => this.highlightActiveNav());
    }

    highlightActiveNav() {
        const path = window.location.pathname;
        document.querySelectorAll('.nav-tab').forEach(tab => {
            const href = tab.getAttribute('href');
            tab.classList.toggle('active', path.startsWith(href) && href !== '/');
        });
    }

    async renderDashboard() {
        const main = document.getElementById('main-content');
        main.innerHTML = SkeletonLoader.dashboard();

        try {
            const cached = this.preloader.getCachedData();
            if (cached) {
                main.innerHTML = this.modules.dashboard.renderWithCache(cached);
            }

            const fresh = await this.modules.dashboard.fetchDashboardData();
            main.innerHTML = this.modules.dashboard.render(fresh);
            this.preloader.setCachedData(fresh);

        } catch (error) {
            console.error('Dashboard error:', error);
            main.innerHTML = '<div class="error-state"><p>Failed to load dashboard</p><a href="/" class="btn" data-link>Retry</a></div>';
        }
    }

    async renderLiveMatches() {
        const main = document.getElementById('main-content');
        main.innerHTML = SkeletonLoader.liveMatches();
        
        try {
            const matches = await this.apiClient.getLiveMatches();
            main.innerHTML = this.modules.liveMatches.render(matches);
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Failed to load live matches</p></div>';
        }
    }

    async renderUpcomingMatches() {
        const main = document.getElementById('main-content');
        main.innerHTML = '<div class="loading">Loading upcoming matches...</div>';
        
        try {
            const matches = await this.apiClient.getUpcomingMatches(7);
            main.innerHTML = this.modules.liveMatches.renderUpcoming(matches);
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Failed to load matches</p></div>';
        }
    }

    async renderOdds() {
        const main = document.getElementById('main-content');
        main.innerHTML = '<div class="loading">Loading odds...</div>';
        
        try {
            const edges = await this.apiClient.get('/odds/winning/edges');
            main.innerHTML = this.modules.oddsDashboard.render(edges);
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Failed to load odds</p></div>';
        }
    }

    async renderH2H() {
        const main = document.getElementById('main-content');
        main.innerHTML = this.modules.h2hComparison.render();
        this.modules.h2hComparison.init();
    }

    async renderPredictions() {
        const main = document.getElementById('main-content');
        main.innerHTML = '<div class="loading">Generating predictions...</div>';
        
        try {
            const predictions = await this.apiClient.getUpcomingPredictions();
            main.innerHTML = this.modules.predictions.render(predictions);
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Failed to load predictions</p></div>';
        }
    }

    async renderBetting() {
        const main = document.getElementById('main-content');
        main.innerHTML = '<div class="loading">Scanning for value bets...</div>';
        
        try {
            const valueBets = await this.apiClient.getValueBets();
            main.innerHTML = this.modules.bettingIntelligence.render(valueBets);
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Failed to load value bets</p></div>';
        }
    }

    async renderMatchDetail(matchId) {
        const main = document.getElementById('main-content');
        main.innerHTML = '<div class="loading">Loading match details...</div>';
        
        try {
            const match = await this.apiClient.getMatchById(matchId);
            main.innerHTML = `
                <a href="/live" data-link style="display:block;margin-bottom:16px;">← Back</a>
                ${this.modules.dashboard.renderMatchDetail(match)}
            `;
        } catch (error) {
            main.innerHTML = '<div class="error-state"><p>Match not found</p></div>';
        }
    }

    render404() {
        document.getElementById('main-content').innerHTML = `
            <div style="text-align:center;padding:80px 20px;">
                <h1 style="font-size:72px;color:var(--text-tertiary);">404</h1>
                <p style="margin:16px 0;">Page not found</p>
                <a href="/" class="btn" data-link>Go to Dashboard</a>
            </div>
        `;
    }

    startLiveUpdates() {
        this.autoRefresh.start(async () => {
            const path = window.location.pathname;
            if (path === '/' || path === '/dashboard' || path === '/live') {
                try {
                    const matches = await this.apiClient.getLiveMatches();
                    this.currentState.liveMatches = matches;
                } catch (e) {}
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

export default App;