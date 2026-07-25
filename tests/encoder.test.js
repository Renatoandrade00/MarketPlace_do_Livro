import { describe, test, expect, beforeAll } from 'vitest';

const {
  onehot,
  normalize,
  buildVocab,
  computeNormStats,
  encodeUser,
  encodeBook,
  getUserFeatureDim,
  getItemFeatureDim
} = require('../src/ai/encoder.js');

// Dados mock representativos
const mockUsers = [
  { id: 1, nome: 'Alice', idade: 25, sexo: 'F', pais: 'brasil', cidade: 'São Paulo' },
  { id: 2, nome: 'Bob', idade: 40, sexo: 'M', pais: 'brasil', cidade: 'Rio de Janeiro' },
  { id: 3, nome: 'Carol', idade: 55, sexo: 'F', pais: 'usa', cidade: 'New York' }
];

const mockBooks = [
  { id: 10, isbn: '000001', nome: 'Livro A', autor: 'Autor A', ano: 1990, genero: 'Ficção' },
  { id: 20, isbn: '000002', nome: 'Livro B', autor: 'Autor B', ano: 2010, genero: 'Romance' },
  { id: 30, isbn: '000003', nome: 'Livro C', autor: 'Autor C', ano: 2020, genero: 'Fantasia' }
];

let vocab, normStats;

beforeAll(() => {
  vocab = buildVocab(mockUsers, mockBooks);
  normStats = computeNormStats(mockUsers, mockBooks);
});

describe('Encoder Tests - Step 2.1', () => {

  // ---- onehot ----
  test('onehot should return vector with single 1 at correct index', () => {
    const mapping = { 'a': 0, 'b': 1, 'c': 2 };
    const result = onehot('b', mapping, 4); // size 4 = 3 known + 1 "Outro"
    expect(result).toEqual([0, 1, 0, 0]);
    expect(result.length).toBe(4);
  });

  test('onehot should fall back to last slot for unknown value', () => {
    const mapping = { 'a': 0, 'b': 1 };
    const result = onehot('desconhecido', mapping, 3);
    expect(result).toEqual([0, 0, 1]); // último slot = "Outro"
  });

  // ---- normalize ----
  test('normalize should return value between 0 and 1', () => {
    expect(normalize(50, 0, 100)).toBe(0.5);
    expect(normalize(0, 0, 100)).toBe(0);
    expect(normalize(100, 0, 100)).toBe(1);
  });

  test('normalize should return 0.5 when min === max', () => {
    expect(normalize(42, 42, 42)).toBe(0.5);
  });

  // ---- buildVocab ----
  test('buildVocab should create sorted city, genre, and sex lists', () => {
    expect(vocab.cidades).toEqual(['New York', 'Rio de Janeiro', 'São Paulo']);
    expect(vocab.generos).toEqual(['Fantasia', 'Ficção', 'Romance']);
    expect(vocab.sexos).toEqual(['F', 'M']);
  });

  test('buildVocab should create correct user/book index mappings', () => {
    expect(vocab.userIndex).toEqual({ '1': 0, '2': 1, '3': 2 });
    expect(vocab.bookIndex).toEqual({ '10': 0, '20': 1, '30': 2 });
    expect(vocab.numUsers).toBe(3);
    expect(vocab.numBooks).toBe(3);
  });

  test('buildVocab should create correct value-to-index maps', () => {
    expect(vocab.cidadeMap['São Paulo']).toBe(2); // sorted alphabetically
    expect(vocab.generoMap['Ficção']).toBe(1);
    expect(vocab.sexoMap['F']).toBe(0);
    expect(vocab.sexoMap['M']).toBe(1);
  });

  // ---- computeNormStats ----
  test('computeNormStats should extract min/max for age and year', () => {
    expect(normStats.idadeMin).toBe(25);
    expect(normStats.idadeMax).toBe(55);
    expect(normStats.anoMin).toBe(1990);
    expect(normStats.anoMax).toBe(2020);
  });

  // ---- encodeUser ----
  test('encodeUser should return a correctly-sized numeric vector', () => {
    const vec = encodeUser(mockUsers[0], vocab, normStats);
    const expectedDim = getUserFeatureDim(vocab);
    expect(vec.length).toBe(expectedDim);
    // All values must be numbers
    vec.forEach(v => expect(typeof v).toBe('number'));
  });

  test('encodeUser should normalize age correctly', () => {
    // Alice: age 25, min=25, max=55 → (25-25)/(55-25) = 0.0
    const vec = encodeUser(mockUsers[0], vocab, normStats);
    expect(vec[0]).toBeCloseTo(0.0, 5);

    // Carol: age 55 → (55-25)/(55-25) = 1.0
    const vec2 = encodeUser(mockUsers[2], vocab, normStats);
    expect(vec2[0]).toBeCloseTo(1.0, 5);
  });

  test('encodeUser should use fallback slot for unknown city', () => {
    const unknownUser = { idade: 30, sexo: 'M', cidade: 'Narnia' };
    const vec = encodeUser(unknownUser, vocab, normStats);
    // The city one-hot portion is at the end; last element should be 1 (unknown)
    const cityStart = 1 + (vocab.sexos.length + 1); // after age_norm + sexo_onehot
    const cityEnd = cityStart + vocab.cidades.length + 1;
    const cityVec = vec.slice(cityStart, cityEnd);
    expect(cityVec[cityVec.length - 1]).toBe(1); // last slot = "Outra"
  });

  // ---- encodeBook ----
  test('encodeBook should return a correctly-sized numeric vector', () => {
    const vec = encodeBook(mockBooks[0], vocab, normStats);
    const expectedDim = getItemFeatureDim(vocab);
    expect(vec.length).toBe(expectedDim);
    vec.forEach(v => expect(typeof v).toBe('number'));
  });

  test('encodeBook should normalize year correctly', () => {
    // Livro A: ano 1990, min=1990, max=2020 → 0.0
    const vec = encodeBook(mockBooks[0], vocab, normStats);
    expect(vec[0]).toBeCloseTo(0.0, 5);

    // Livro C: ano 2020 → 1.0
    const vec2 = encodeBook(mockBooks[2], vocab, normStats);
    expect(vec2[0]).toBeCloseTo(1.0, 5);
  });

  test('encodeBook should use fallback slot for unknown genre', () => {
    const unknownBook = { ano: 2000, genero: 'Autoajuda' };
    const vec = encodeBook(unknownBook, vocab, normStats);
    // Genre one-hot starts at index 1 (after ano_norm)
    const genreVec = vec.slice(1);
    expect(genreVec[genreVec.length - 1]).toBe(1); // last slot = "Outro"
  });

  // ---- Feature dimensions ----
  test('getUserFeatureDim should match actual encoded vector length', () => {
    const dim = getUserFeatureDim(vocab);
    const vec = encodeUser(mockUsers[0], vocab, normStats);
    expect(dim).toBe(vec.length);
    // 1 (age) + 3 (sexo: F,M + Outro) + 4 (cidade: 3 + Outra) = 8
    expect(dim).toBe(8);
  });

  test('getItemFeatureDim should match actual encoded vector length', () => {
    const dim = getItemFeatureDim(vocab);
    const vec = encodeBook(mockBooks[0], vocab, normStats);
    expect(dim).toBe(vec.length);
    // 1 (year) + 4 (genero: 3 + Outro) = 5
    expect(dim).toBe(5);
  });
});
