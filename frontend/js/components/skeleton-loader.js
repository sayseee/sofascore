export default class SkeletonLoader {
    static dashboard() {
        return `
            <div class="skeleton-dashboard">
                <div class="stats-row">
                    ${Array(4).fill('').map(() => `
                        <div class="stat-card skeleton">
                            <div class="skeleton-line w-20 mb-1"></div>
                            <div class="skeleton-line w-40 mb-1" style="height:32px;"></div>
                            <div class="skeleton-line w-30"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="skeleton-panel" style="margin-bottom:20px;padding:16px;">
                    <div class="skeleton-line w-30 mb-3"></div>
                    <div style="display:flex;gap:16px;">
                        ${Array(3).fill('').map(() => `
                            <div class="match-card-horizontal skeleton" style="min-width:300px;height:140px;"></div>
                        `).join('')}
                    </div>
                </div>
                <div class="skeleton-panel" style="margin-bottom:20px;padding:16px;">
                    <div class="skeleton-line w-30 mb-3"></div>
                    ${Array(5).fill('').map(() => `
                        <div class="skeleton-line w-100 mb-2"></div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    static liveMatches() {
        return `
            <div class="skeleton-line w-30 mb-3" style="height:32px;"></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">
                ${Array(6).fill('').map(() => `
                    <div class="match-card-horizontal skeleton" style="height:140px;"></div>
                `).join('')}
            </div>
        `;
    }
}

