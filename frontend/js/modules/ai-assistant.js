/**
 * AI Assistant Module
 * Floating chat interface for football analytics queries
 */
export default class AIAssistant {
    constructor(apiClient) { 
        this.apiClient = apiClient; 
    }

    init() {
        const container = document.getElementById('aiAssistantContainer');
        if (!container) return;
        
        container.innerHTML = `
            <div style="position:fixed;bottom:0;right:20px;width:400px;background:var(--bg-secondary);
                        border:1px solid var(--border-primary);border-radius:12px 12px 0 0;
                        box-shadow:0 -4px 20px rgba(0,0,0,0.3);z-index:999;overflow:hidden;">
                <div id="aiToggle" style="padding:10px 16px;cursor:pointer;background:var(--bg-tertiary);
                            color:var(--text-primary);font-weight:600;display:flex;justify-content:space-between;
                            align-items:center;border-bottom:1px solid var(--border-primary);">
                    <span>🤖 AI Football Analyst</span>
                    <span id="aiToggleIcon" style="font-size:12px;">▼</span>
                </div>
                <div id="aiBody" style="display:none;height:450px;flex-direction:column;">
                    <div style="padding:8px 12px;border-bottom:1px solid var(--border-primary);display:flex;flex-wrap:wrap;gap:4px;">
                        <button class="ai-preset" data-prompt="Show matches with home expected > 50% and positive edge">🏠 Home Edge >50%</button>
                        <button class="ai-preset" data-prompt="Find value bets with high confidence">💎 High Value Bets</button>
                        <button class="ai-preset" data-prompt="Show matches with edge above 15%">🔥 Edge >15%</button>
                        <button class="ai-preset" data-prompt="Show standings for Premier League">🏆 PL Standings</button>
                        <button class="ai-preset" data-prompt="Which teams have the best form recently?">📈 Top Form</button>
                        <button class="ai-preset" data-prompt="Show away teams with positive edge">🛫 Away Value</button>
                    </div>
                    <div id="aiMessages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;font-size:12px;">
                        <div style="background:var(--bg-tertiary);padding:10px 12px;border-radius:10px;max-width:90%;line-height:1.4;">
                            👋 Hello! I'm your AI football analyst. I can query the database for winning odds, value bets, team form, H2H, and league standings.<br><br>Click a preset button or type your question!
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--border-primary);">
                        <input id="aiInput" placeholder="Ask about odds, form, value bets..." 
                               style="flex:1;padding:8px 12px;background:var(--input-bg);border:1px solid var(--border-secondary);
                                      border-radius:20px;color:var(--text-primary);font-size:12px;outline:none;">
                        <button id="aiSendBtn" style="padding:8px 14px;background:var(--accent-primary);color:#1a1a1a;
                                border:none;border-radius:20px;cursor:pointer;font-weight:600;font-size:11px;">Send</button>
                    </div>
                </div>
            </div>
        `;

        this.setupListeners();
    }

    setupListeners() {
        const toggle = document.getElementById('aiToggle');
        const body = document.getElementById('aiBody');
        const toggleIcon = document.getElementById('aiToggleIcon');
        const input = document.getElementById('aiInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const messages = document.getElementById('aiMessages');

        if (!toggle || !body) return;

        toggle.addEventListener('click', () => {
            const isOpen = body.style.display === 'flex';
            body.style.display = isOpen ? 'none' : 'flex';
            if (toggleIcon) toggleIcon.textContent = isOpen ? '▼' : '▲';
            if (!isOpen && input) input.focus();
        });

        document.querySelectorAll('.ai-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                if (prompt && input) {
                    input.value = prompt;
                    this.sendMessage(messages, input);
                }
            });
        });

        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage(messages, input));
        if (input) input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage(messages, input);
        });
    }

    async sendMessage(messages, input) {
        const text = input.value.trim();
        if (!text) return;
        
        messages.innerHTML += `
            <div style="background:var(--accent-primary);color:#1a1a1a;padding:8px 12px;
                        border-radius:10px;max-width:85%;align-self:flex-end;font-size:12px;">${text}</div>`;
        input.value = '';
        messages.scrollTop = messages.scrollHeight;

        const typingId = Date.now();
        messages.innerHTML += `
            <div id="typing-${typingId}" style="background:var(--bg-tertiary);padding:8px 12px;
                        border-radius:10px;max-width:85%;font-size:11px;color:var(--text-tertiary);">🤔 Analyzing...</div>`;
        messages.scrollTop = messages.scrollHeight;

        try {
            const res = await this.apiClient.post('/ai/ask', { question: text });
            const data = res.data || res;
            const typingEl = document.getElementById(`typing-${typingId}`);
            if (typingEl) typingEl.remove();

            messages.innerHTML += `
                <div style="background:var(--bg-tertiary);padding:10px 12px;border-radius:10px;
                            max-width:90%;line-height:1.5;font-size:12px;">
                    <div style="white-space:pre-line;">${data.response || 'No results found.'}</div>
                </div>`;
        } catch (error) {
            const typingEl = document.getElementById(`typing-${typingId}`);
            if (typingEl) typingEl.remove();
            messages.innerHTML += `
                <div style="background:var(--bg-tertiary);padding:10px 12px;border-radius:10px;
                            max-width:85%;font-size:12px;color:var(--accent-danger);">❌ Sorry, I couldn't process that.</div>`;
        }
        messages.scrollTop = messages.scrollHeight;
    }
}