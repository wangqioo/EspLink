const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: process.env.DB_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
