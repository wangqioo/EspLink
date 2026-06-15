const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/health', require('./health'));
router.use('/tenants', require('./tenants'));
router.use('/keys', require('./keys'));
router.use('/devices', require('./devices'));
router.use('/usage', require('./usage'));
router.use('/operation', require('./operation'));
router.use('/llm', require('./llm'));
router.use('/firmware', require('./firmware'));

module.exports = router;
