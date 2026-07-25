import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const testDbUrl = 'file:./test.db';

// Force test database
process.env.DATABASE_URL = testDbUrl;

const { PrismaClient } = require('@prisma/client');
const seedDatabase = require('../prisma/seed.js');
let prisma;

describe('Database Seeding Tests - Step 1.5', () => {
  beforeAll(async () => {
    // Reset test database schema
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: 'inherit'
    });

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDbUrl
        }
      }
    });

    // Run the seed programmatically
    await seedDatabase();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.purchase.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.book.deleteMany({});
      await prisma.$disconnect();
    }

    const dbPath = path.join(__dirname, '../prisma/test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (err) {
        // Ignore if locked
      }
    }
  });

  test('Should have seeded the correct number of users', async () => {
    const userCount = await prisma.user.count();
    const usersRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/processed/users_raw.json'), 'utf8'));
    
    expect(userCount).toBe(usersRaw.length);
    expect(userCount).toBe(136);
  });

  test('Should have seeded the correct number of books', async () => {
    const bookCount = await prisma.book.count();
    const booksRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/processed/books.json'), 'utf8'));
    
    expect(bookCount).toBe(booksRaw.length);
    expect(bookCount).toBe(260);
  });

  test('Should have seeded the correct number of purchases', async () => {
    const purchaseCount = await prisma.purchase.count();
    
    // Total purchases mapped correctly from clean input
    expect(purchaseCount).toBe(5183);
  });
});
