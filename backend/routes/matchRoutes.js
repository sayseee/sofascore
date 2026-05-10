const router = require('express').Router();
const ctrl = require('../controllers/matchController');

router.get('/live', ctrl.getLiveMatches);
router.get('/date', ctrl.getMatchesByDate);
router.get('/upcoming', ctrl.getUpcomingMatches);
router.get('/recent', ctrl.getRecentMatches);
router.get('/search', ctrl.searchMatches);
router.get('/:id', ctrl.getMatchById);

module.exports = router;

