const request = require('supertest');
const app = require('../app');

describe('legacy QR pairing routes', () => {
  test.each([
    ['post', '/api/v1/pair/verify'],
    ['post', '/api/v1/pair/confirm'],
    ['get', '/api/v1/pair/status/device-123'],
  ])('%s %s is not mounted', async (method, path) => {
    const response = await request(app)[method](path).send({});

    expect(response.status).toBe(404);
  });
});
