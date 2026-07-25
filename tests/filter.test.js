import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROCESSED_DIR = path.join(__dirname, '../data/processed');

describe('Dataset Filtering Tests - Step 1.3', () => {
  test('Should have generated processed files', () => {
    expect(fs.existsSync(path.join(PROCESSED_DIR, 'users_raw.json'))).toBe(true);
    expect(fs.existsSync(path.join(PROCESSED_DIR, 'books_raw.json'))).toBe(true);
    expect(fs.existsSync(path.join(PROCESSED_DIR, 'purchases_raw.json'))).toBe(true);
  });

  test('Should contain valid arrays with correct bounds', () => {
    const users = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'users_raw.json'), 'utf8'));
    const books = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'books_raw.json'), 'utf8'));
    const purchases = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'purchases_raw.json'), 'utf8'));

    expect(Array.isArray(users)).toBe(true);
    expect(Array.isArray(books)).toBe(true);
    expect(Array.isArray(purchases)).toBe(true);

    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBeLessThanOrEqual(250);

    expect(books.length).toBeGreaterThan(0);
    expect(books.length).toBeLessThanOrEqual(350);

    expect(purchases.length).toBeGreaterThan(0);
  });

  test('Should verify referential integrity of purchases', () => {
    const users = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'users_raw.json'), 'utf8'));
    const books = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'books_raw.json'), 'utf8'));
    const purchases = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'purchases_raw.json'), 'utf8'));

    const userIds = new Set(users.map(u => u.id));
    const bookIsbns = new Set(books.map(b => b.isbn));

    for (const purchase of purchases) {
      expect(userIds.has(purchase.userId)).toBe(true);
      expect(bookIsbns.has(purchase.isbn)).toBe(true);
    }
  });

  test('Should verify data types and default values', () => {
    const users = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'users_raw.json'), 'utf8'));
    const books = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'books_raw.json'), 'utf8'));

    // Check first user
    const firstUser = users[0];
    expect(typeof firstUser.id).toBe('number');
    expect(typeof firstUser.nome).toBe('string');
    expect(typeof firstUser.idade).toBe('number');
    expect(firstUser.idade).toBeGreaterThan(0);
    expect(typeof firstUser.cidade).toBe('string');
    expect(typeof firstUser.pais).toBe('string');

    // Check first book
    const firstBook = books[0];
    expect(typeof firstBook.isbn).toBe('string');
    expect(typeof firstBook.nome).toBe('string');
    expect(typeof firstBook.autor).toBe('string');
    expect(typeof firstBook.ano).toBe('number');
    expect(firstBook.genero).toBe('Não classificado'); // Must be unclassified at this step
  });
});
