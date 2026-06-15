const { v4: uuidv4 } = require('uuid');

const generateApiKey = () => `sk-${uuidv4().replace(/-/g, '')}`;
const generateUUID = () => uuidv4();
const generateRequestId = () => `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

module.exports = { generateApiKey, generateUUID, generateRequestId };
