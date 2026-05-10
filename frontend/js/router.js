/**
 * SPA Router - Client-side routing with History API
 */
export default class Router {
    constructor() {
        this.routes = new Map();
        this.notFoundHandler = null;
    }

    addRoute(pattern, handler) {
        const paramNames = [];
        const regexStr = pattern
            .replace(/\//g, '\\/')
            .replace(/:(\w+)/g, (_, name) => {
                paramNames.push(name);
                return '([^/]+)';
            });
        
        this.routes.set(new RegExp(`^${regexStr}$`), { handler, paramNames });
    }

    setNotFound(handler) {
        this.notFoundHandler = handler;
    }

    start() {
        this.handleRoute(window.location.pathname);
        window.addEventListener('popstate', () => {
            this.handleRoute(window.location.pathname);
        });
        document.addEventListener('click', (e) => {
            const link = e.target.closest('[data-link]');
            if (link) {
                e.preventDefault();
                this.navigate(link.getAttribute('href'));
            }
        });
    }

    navigate(path) {
        window.history.pushState({}, '', path);
        this.handleRoute(path);
        window.scrollTo(0, 0);
    }

    async handleRoute(path) {
        for (const [regex, route] of this.routes) {
            const match = path.match(regex);
            if (match) {
                const params = {};
                route.paramNames.forEach((name, i) => {
                    params[name] = match[i + 1];
                });
                await route.handler(params);
                return;
            }
        }
        if (this.notFoundHandler) await this.notFoundHandler();
    }
}

