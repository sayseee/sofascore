const router = require('express').Router();
const ctrl = require('../controllers/oddsController');

router.get('/match/:matchId', ctrl.getMatchOdds);
router.get('/winning/:matchId', ctrl.getWinningOdds);
router.get('/winning/:matchId/history', ctrl.getWinningOddsHistory);
router.get('/winning/edges', ctrl.getMatchesWithEdges);
router.get('/compare/:matchId', ctrl.compareOdds);

module.exports = router;

