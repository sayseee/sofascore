const router = require('express').Router();
const ctrl = require('../controllers/ingestionController');

router.post('/scheduled/:date', ctrl.triggerScheduledEvents);
router.post('/odds/:matchId', ctrl.triggerOddsForMatch);
router.post('/odds/upcoming', ctrl.triggerOddsForUpcoming);
router.post('/standings', ctrl.triggerStandings);
router.post('/statistics', ctrl.triggerStatistics);
router.get('/status', ctrl.getIngestionStatus);

module.exports = router;

