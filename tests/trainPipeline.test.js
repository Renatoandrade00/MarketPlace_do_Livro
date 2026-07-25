import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const tf = require('@tensorflow/tfjs');
const {
  trainModel,
  predictAll,
  popularityFallback,
  loadMetadata,
  generateSamples,
  seededRandom,
  NEGATIVE_RATIO
} = require('../src/ai/trainPipeline.js');
const { loadModel } = require('../src/ai/recommendationModel.js');

const TEST_MODEL_DIR = path.join(__dirname, '..', 'data', 'model_pipeline_test');

// ── Dataset mínimo para treino rápido ──────────────────────────
const mockUsers = [
  { id: 1, nome: 'Alice', idade: 25, sexo: 'F', pais: 'brasil', cidade: 'São Paulo' },
  { id: 2, nome: 'Bob', idade: 40, sexo: 'M', pais: 'brasil', cidade: 'Rio de Janeiro' },
  { id: 3, nome: 'Carol', idade: 55, sexo: 'F', pais: 'usa', cidade: 'New York' },
  { id: 4, nome: 'Dave', idade: 30, sexo: 'M', pais: 'brasil', cidade: 'Curitiba' }
];

const mockBooks = [
  { id: 10, isbn: '001', nome: 'Livro A', autor: 'Autor A', ano: 1990, genero: 'Ficção' },
  { id: 20, isbn: '002', nome: 'Livro B', autor: 'Autor B', ano: 2000, genero: 'Romance' },
  { id: 30, isbn: '003', nome: 'Livro C', autor: 'Autor C', ano: 2010, genero: 'Fantasia' },
  { id: 40, isbn: '004', nome: 'Livro D', autor: 'Autor D', ano: 2020, genero: 'Ficção' },
  { id: 50, isbn: '005', nome: 'Livro E', autor: 'Autor E', ano: 2015, genero: 'Romance' },
  { id: 60, isbn: '006', nome: 'Livro F', autor: 'Autor F', ano: 2005, genero: 'Fantasia' }
];

const mockPurchases = [
  { userId: 1, bookId: 10 },
  { userId: 1, bookId: 20 },
  { userId: 2, bookId: 30 },
  { userId: 2, bookId: 40 },
  { userId: 3, bookId: 10 },
  { userId: 3, bookId: 50 },
  { userId: 4, bookId: 20 },
  { userId: 4, bookId: 60 }
];

describe('Training Pipeline Tests - Step 2.3', () => {

  afterAll(async () => {
    if (fs.existsSync(TEST_MODEL_DIR)) {
      fs.rmSync(TEST_MODEL_DIR, { recursive: true, force: true });
    }
  });

  // ── seededRandom ────────────────────────────────────────────
  test('seededRandom should produce deterministic sequence', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  test('seededRandom should produce values in [0, 1)', () => {
    const rng = seededRandom(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // ── generateSamples ─────────────────────────────────────────
  test('generateSamples should create positive + negative pairs', () => {
    const rng = seededRandom(42);
    const allBookIds = mockBooks.map(b => b.id);
    const samples = generateSamples(mockPurchases, allBookIds, NEGATIVE_RATIO, rng);

    const positives = samples.filter(s => s.label === 1);
    const negatives = samples.filter(s => s.label === 0);

    expect(positives.length).toBe(mockPurchases.length); // 8 positivos
    expect(negatives.length).toBeGreaterThan(0);
    // Ratio: ~4 negativos por positivo
    expect(negatives.length).toBeLessThanOrEqual(mockPurchases.length * NEGATIVE_RATIO);
  });

  test('negative samples should not contain existing purchases', () => {
    const rng = seededRandom(42);
    const allBookIds = mockBooks.map(b => b.id);
    const samples = generateSamples(mockPurchases, allBookIds, NEGATIVE_RATIO, rng);

    // Construir set de compras existentes
    const purchaseSet = new Set(mockPurchases.map(p => `${p.userId}-${p.bookId}`));

    const negatives = samples.filter(s => s.label === 0);
    for (const neg of negatives) {
      expect(purchaseSet.has(`${neg.userId}-${neg.bookId}`)).toBe(false);
    }
  });

  // ── trainModel (integração completa) ────────────────────────
  test('trainModel should train and return model with history', async () => {
    const result = await trainModel({
      users: mockUsers,
      books: mockBooks,
      purchases: mockPurchases,
      modelDir: TEST_MODEL_DIR
    });

    expect(result.model).toBeDefined();
    expect(result.history).toBeDefined();
    expect(result.history.epochs).toBeGreaterThan(0);
    expect(result.history.finalLoss).toBeDefined();
    expect(typeof result.history.finalLoss).toBe('number');
    expect(result.history.finalValLoss).toBeDefined();
    expect(result.vocab).toBeDefined();
    expect(result.normStats).toBeDefined();

    // Limpar modelo da memória
    result.model.dispose();
  }, 30000); // timeout alto para treino

  test('trainModel should persist model, vocab and normStats to disk', () => {
    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'model.json'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'weights.bin'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'vocab.json'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'normStats.json'))).toBe(true);
  });

  // ── loadMetadata ────────────────────────────────────────────
  test('loadMetadata should restore vocab and normStats', () => {
    const meta = loadMetadata(TEST_MODEL_DIR);
    expect(meta).not.toBeNull();
    expect(meta.vocab.cidades).toBeDefined();
    expect(meta.vocab.userIndex).toBeDefined();
    expect(meta.normStats.idadeMin).toBeDefined();
    expect(meta.normStats.anoMax).toBeDefined();
  });

  test('loadMetadata should return null for non-existent path', () => {
    const meta = loadMetadata('/caminho/inexistente/fantasma');
    expect(meta).toBeNull();
  });

  // ── predictAll ──────────────────────────────────────────────
  test('predictAll should return scored books sorted desc', async () => {
    const model = await loadModel(TEST_MODEL_DIR);
    expect(model).not.toBeNull();

    const meta = loadMetadata(TEST_MODEL_DIR);
    const results = predictAll(model, mockUsers[0], mockBooks, meta.vocab, meta.normStats);

    expect(results.length).toBeGreaterThan(0);
    // Verificar que cada resultado tem bookId e score
    for (const r of results) {
      expect(r.bookId).toBeDefined();
      expect(typeof r.score).toBe('number');
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }

    // Verificar ordenação decrescente
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }

    model.dispose();
  });

  test('predictAll should return empty array for unknown user (cold start)', async () => {
    const model = await loadModel(TEST_MODEL_DIR);
    const meta = loadMetadata(TEST_MODEL_DIR);

    const unknownUser = { id: 9999, idade: 30, sexo: 'M', cidade: 'Nowhere' };
    const results = predictAll(model, unknownUser, mockBooks, meta.vocab, meta.normStats);

    expect(results).toEqual([]); // usuário não no vocab → vazio
    model.dispose();
  });

  // ── popularityFallback ──────────────────────────────────────
  test('popularityFallback should rank books by purchase count', () => {
    const results = popularityFallback(mockBooks, mockPurchases);

    expect(results.length).toBe(mockBooks.length);
    // bookId 10 e 20 aparecem 2 vezes cada → score = 1.0
    expect(results[0].score).toBe(1.0);
    // Todos os scores devem estar entre 0 e 1
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }

    // Verificar ordenação decrescente
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test('popularityFallback should handle books with zero purchases', () => {
    const extraBooks = [...mockBooks, { id: 99, isbn: '099', nome: 'Novo', autor: 'X', ano: 2023, genero: 'Ficção' }];
    const results = popularityFallback(extraBooks, mockPurchases);

    const newBookResult = results.find(r => r.bookId === 99);
    expect(newBookResult).toBeDefined();
    expect(newBookResult.score).toBe(0); // zero compras
  });
});
