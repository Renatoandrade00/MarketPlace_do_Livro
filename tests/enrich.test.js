import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import mapSubjectToGenre directly from enrichGenre.js
const { mapSubjectToGenre } = require('../prisma/enrichGenre.js');

const PROCESSED_DIR = path.join(__dirname, '../data/processed');

describe('Genre Enrichment Tests - Step 1.4', () => {
  test('mapSubjectToGenre should map English subjects to Portuguese genres correctly', () => {
    // Fantasy keywords
    expect(mapSubjectToGenre([{ name: 'Science Fiction' }])).toBe('Fantasia');
    expect(mapSubjectToGenre([{ name: 'Vampires' }])).toBe('Fantasia');

    // Romance keywords
    expect(mapSubjectToGenre([{ name: 'Historical Romance' }])).toBe('Romance');
    expect(mapSubjectToGenre([{ name: 'Love stories' }])).toBe('Romance');

    // Biography keywords
    expect(mapSubjectToGenre([{ name: 'Biography & Autobiography' }])).toBe('Biografia');

    // Juvenile/Children keywords
    expect(mapSubjectToGenre([{ name: 'Juvenile Fiction' }])).toBe('Infantojuvenil');
    expect(mapSubjectToGenre([{ name: 'Teen Fiction' }])).toBe('Infantojuvenil');

    // Nonfiction keywords
    expect(mapSubjectToGenre([{ name: 'History' }])).toBe('Não-ficção');
    expect(mapSubjectToGenre([{ name: 'Self-Help' }])).toBe('Não-ficção');

    // Fiction keywords
    expect(mapSubjectToGenre([{ name: 'Mystery' }])).toBe('Ficção');
    expect(mapSubjectToGenre([{ name: 'Literature' }])).toBe('Ficção');

    // Fallback
    expect(mapSubjectToGenre([])).toBe('Não classificado');
    expect(mapSubjectToGenre(null)).toBe('Não classificado');
    expect(mapSubjectToGenre([{ name: 'random subject' }])).toBe('Não classificado');
  });

  test('Should have generated books.json with enriched genres', () => {
    expect(fs.existsSync(path.join(PROCESSED_DIR, 'books.json'))).toBe(true);
    
    const books = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'books.json'), 'utf8'));
    expect(Array.isArray(books)).toBe(true);
    expect(books.length).toBeGreaterThan(0);

    const validGenres = new Set([
      'Ficção',
      'Romance',
      'Fantasia',
      'Biografia',
      'Infantojuvenil',
      'Não-ficção',
      'Não classificado'
    ]);

    for (const book of books) {
      expect(book.genero).toBeDefined();
      expect(typeof book.genero).toBe('string');
      expect(validGenres.has(book.genero)).toBe(true);
    }
  });

  test('Should have generated generos.json cache file', () => {
    expect(fs.existsSync(path.join(PROCESSED_DIR, 'generos.json'))).toBe(true);
    
    const cache = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'generos.json'), 'utf8'));
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBeGreaterThan(0);
  });
});
