export default class AIAssistant {
    constructor(apiClient) { this.apiClient = apiClient; }

    init() {
        const container = document.getElementById('aiAssistantContainer');
        if (!container) return;
        
        container.innerHTML = `
            <div style="position:fixed;bottom:0;right:20px;width:380px;background:var(--bg-secondary);
                        border:1px solid var(--border-primary);border-radius:16px 16px 0 0;
                        box-shadow:var(--shadow-lg);z-index:999;overflow:hidden;">
                <div id="aiToggle" style="padding:12px 20px;cursor:pointer;background:var(--gradient-accent);
                            color:white;font-weight:600;display:flex;justify-content:space-between;">
                    <span>🤖 AI Assistant</span><span>▼</span>
                </div>
                <div id="aiBody" style="display:none;height:400px;flex-direction:column;">
                    <div id="aiMessages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;">
                        <div style="background:var(--bg-tertiary);padding:10px 14px;border-radius:12px;max-width:85%;">
                            👋 Hello! I'm your AI football analytics assistant. Ask me anything!
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;padding:12px;border-top:1px solid var(--border-primary);">
                        <input id="aiInput" placeholder="Ask about predictions, form, H2H..." 
                               style="flex:1;padding:10px;background:var(--bg-tertiary);border:1px solid var(--border-secondary);
                                      border-radius:20px;color:var(--text-primary);font-size:13px;">
                        <button id="aiSendBtn" class="btn-sm">Send</button>
                    </div>
                </div>
            </div>
        `;

        const toggle = document.getElementById('aiToggle');
        const body = document.getElementById('aiBody');
        const input = document.getElementById('aiInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const messages = document.getElementById('aiMessages');

        toggle.addEventListener('click', () => {
            const isOpen = body.style.display === 'flex';
            body.style.display = isOpen ? 'none' : 'flex';
            toggle.querySelector('span:last-child').textContent = isOpen ? '▼' : '▲';
            if (!isOpen) input.focus();
        });

        const send = async () => {
            const text = input.value.trim();
            if (!text) return;
            
            messages.innerHTML += `<div style="background:var(--accent-primary);color:white;padding:10px 14px;border-radius:12px;max-width:85%;align-self:flex-end;">${text}</div>`;
            input.value = '';
            messages.scrollTop = messages.scrollHeight;

            const response = `
                <div style="background:var(--bg-tertiary);padding:10px 14px;border-radius:12px;max-width:85%;margin-top:12px;">
                    I analyzed your question: "${text.substring(0, 50)}..."<br><br>
                    I can help with predictions, form analysis, value bets, and H2H comparisons. 
                    Please check the relevant tabs for detailed data!
                </div>
            `;
            messages.innerHTML += response;
            messages.scrollTop = messages.scrollHeight;
        };

        sendBtn.addEventListener('click', send);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
    }
}

