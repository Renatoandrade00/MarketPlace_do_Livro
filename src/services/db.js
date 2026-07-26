const { PrismaClient } = require('@prisma/client');

let prisma;

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (tursoUrl && tursoToken) {
  const { createClient } = require('@libsql/client');
  const { PrismaLibSQL } = require('@prisma/adapter-libsql');

  const libsql = createClient({
    url: tursoUrl,
    authToken: tursoToken,
  });

  const adapter = new PrismaLibSQL(libsql);
  prisma = new PrismaClient({ adapter });
} else {
  prisma = new PrismaClient();
}

module.exports = prisma;
