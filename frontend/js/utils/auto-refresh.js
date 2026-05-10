export default class AutoRefresh {
    constructor(intervalSeconds = 30) {
        this.interval = intervalSeconds;
        this.timeLeft = intervalSeconds;
        this.timer = null;
        this.callback = null;
    }

    start(callback) {
        this.callback = callback;
        this.timer = setInterval(() => {
            this.timeLeft--;
            if (this.timeLeft <= 0) {
                if (this.callback) this.callback();
                this.timeLeft = this.interval;
            }
        }, 1000);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
    }

    getTimeLeft() { return this.timeLeft; }
}

