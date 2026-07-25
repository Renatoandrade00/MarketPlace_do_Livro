import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const testDbUrl = 'file:./test.db';

// Ensure we use the test database
process.env.DATABASE_URL = testDbUrl;

const { PrismaClient } = require('@prisma/client');
let prisma;

describe('Database Tests - Step 1.2', () => {
  beforeAll(() => {
    // Sync schema to the test database
    execSync('npx prisma db push --accept-data-loss', {
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
  });

  afterAll(async () => {
    if (prisma) {
      // Clean up database records
      await prisma.purchase.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.book.deleteMany({});
      await prisma.$disconnect();
    }
    
    // Clean up test database file
    const fs = require('fs');
    const dbPath = path.join(__dirname, '../prisma/test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (err) {
        // Ignorar se estiver travado
      }
    }
  });

  test('Should insert a new User', async () => {
    const user = await prisma.user.create({
      data: {
        nome: 'João da Silva',
        idade: 25,
        sexo: 'M',
        pais: 'Brasil',
        cidade: 'São Paulo'
      }
    });

    expect(user.id).toBeDefined();
    expect(user.nome).toBe('João da Silva');
  });

  test('Should insert a new Book', async () => {
    const book = await prisma.book.create({
      data: {
        isbn: '1234567890',
        nome: 'Introdução ao TypeScript',
        autor: 'Autor Exemplo',
        ano: 2023,
        genero: 'Tecnologia'
      }
    });

    expect(book.id).toBeDefined();
    expect(book.isbn).toBe('1234567890');
  });

  test('Should record a purchase', async () => {
    const user = await prisma.user.findFirst();
    const book = await prisma.book.findFirst();

    const purchase = await prisma.purchase.create({
      data: {
        userId: user.id,
        bookId: book.id
      }
    });

    expect(purchase.id).toBeDefined();
    expect(purchase.userId).toBe(user.id);
    expect(purchase.bookId).toBe(book.id);
  });

  test('Should enforce uniqueness on [userId, bookId]', async () => {
    const user = await prisma.user.findFirst();
    const book = await prisma.book.findFirst();

    // Trying to create a duplicate purchase should fail
    await expect(
      prisma.purchase.create({
        data: {
          userId: user.id,
          bookId: book.id
        }
      })
    ).rejects.toThrow();
  });
});
