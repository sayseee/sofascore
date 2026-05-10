const router = require('express').Router();
const ctrl = require('../controllers/teamController');

router.get('/search', ctrl.searchTeams);
router.get('/:id', ctrl.getTeamById);

module.exports = router;

