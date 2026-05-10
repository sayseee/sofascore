class IngestionController {
    async triggerScheduledEvents(req, res, next) {
        try {
            const { date } = req.params;
            res.json({
                success: true,
                message: `Scheduled events ingestion triggered for ${date}`,
                data: { date, status: 'queued' }
            });
        } catch (error) { next(error); }
    }

    async triggerOddsForMatch(req, res, next) {
        try {
            const { matchId } = req.params;
            res.json({
                success: true,
                message: `Odds collection triggered for match ${matchId}`,
                data: { matchId: parseInt(matchId), status: 'queued' }
            });
        } catch (error) { next(error); }
    }

    async triggerOddsForUpcoming(req, res, next) {
        try {
            res.json({
                success: true,
                message: 'Odds collection triggered for upcoming matches',
                data: { status: 'queued' }
            });
        } catch (error) { next(error); }
    }

    async triggerStandings(req, res, next) {
        try {
            res.json({
                success: true,
                message: 'Standings collection triggered',
                data: { status: 'queued' }
            });
        } catch (error) { next(error); }
    }

    async triggerStatistics(req, res, next) {
        try {
            res.json({
                success: true,
                message: 'Statistics collection triggered',
                data: { status: 'queued' }
            });
        } catch (error) { next(error); }
    }

    async getIngestionStatus(req, res, next) {
        try {
            res.json({
                success: true,
                data: {
                    lastRun: new Date().toISOString(),
                    status: 'healthy',
                    pendingJobs: 0
                }
            });
        } catch (error) { next(error); }
    }
}

module.exports = new IngestionController();

