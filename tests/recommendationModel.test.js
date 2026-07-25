import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const tf = require('@tensorflow/tfjs');
const { buildModel, saveModel, loadModel, predict, EMBEDDING_DIM } = require('../src/ai/recommendationModel.js');

// Configuração mínima representativa
const MODEL_PARAMS = {
  numUsers: 10,
  numBooks: 15,
  userFeatureDim: 8,  // ex.: 1(idade) + 3(sexo) + 4(cidade)
  itemFeatureDim: 5   // ex.: 1(ano) + 4(genero)
};

const TEST_MODEL_DIR = path.join(__dirname, '..', 'data', 'model_test');

let model;

describe('Recommendation Model Tests - Step 2.2', () => {

  beforeAll(() => {
    model = buildModel(MODEL_PARAMS);
  });

  afterAll(async () => {
    // Limpar diretório de modelo de teste, se existir
    if (fs.existsSync(TEST_MODEL_DIR)) {
      fs.rmSync(TEST_MODEL_DIR, { recursive: true, force: true });
    }
    if (model) model.dispose();
  });

  // ── Construção do Modelo ──────────────────────────────────────

  test('buildModel should return a tf.LayersModel', () => {
    expect(model).toBeDefined();
    expect(model.predict).toBeDefined(); // é um LayersModel
    expect(model.name).toBe('TwoTowerRecommender');
  });

  test('Model should have 4 inputs (userId, userFeatures, bookId, bookFeatures)', () => {
    expect(model.inputs.length).toBe(4);
  });

  test('Model should have 1 output with shape [null, 1]', () => {
    expect(model.outputs.length).toBe(1);
    const outputShape = model.outputs[0].shape;
    expect(outputShape[outputShape.length - 1]).toBe(1); // sigmoid → 1 unit
  });

  test('Model should contain user and book embedding layers', () => {
    const layerNames = model.layers.map(l => l.name);
    expect(layerNames).toContain('userEmbedding');
    expect(layerNames).toContain('bookEmbedding');
  });

  test('Embedding dimension should be 16', () => {
    expect(EMBEDDING_DIM).toBe(16);
    const userEmbLayer = model.getLayer('userEmbedding');
    expect(userEmbLayer.outputDim).toBe(16);
  });

  // ── Inferência (predict) ──────────────────────────────────────

  test('predict should return a number between 0 and 1', () => {
    const userInput = {
      userIdx: 0,
      features: new Array(MODEL_PARAMS.userFeatureDim).fill(0.5)
    };
    const itemInput = {
      bookIdx: 0,
      features: new Array(MODEL_PARAMS.itemFeatureDim).fill(0.5)
    };

    const score = predict(model, userInput, itemInput);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('predict should not leak tensors (memory management)', () => {
    const before = tf.memory().numTensors;

    const userInput = {
      userIdx: 1,
      features: new Array(MODEL_PARAMS.userFeatureDim).fill(0.3)
    };
    const itemInput = {
      bookIdx: 2,
      features: new Array(MODEL_PARAMS.itemFeatureDim).fill(0.7)
    };

    predict(model, userInput, itemInput);
    const after = tf.memory().numTensors;
    expect(after).toBe(before); // tf.tidy deve limpar tudo
  });

  // ── Save / Load ───────────────────────────────────────────────

  test('saveModel should persist model files to disk', async () => {
    await saveModel(model, TEST_MODEL_DIR);

    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'model.json'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_MODEL_DIR, 'weights.bin'))).toBe(true);
  });

  test('loadModel should restore a working model from disk', async () => {
    const loaded = await loadModel(TEST_MODEL_DIR);
    expect(loaded).not.toBeNull();

    // Confirmar que a inferência funciona no modelo carregado
    const userInput = {
      userIdx: 0,
      features: new Array(MODEL_PARAMS.userFeatureDim).fill(0.5)
    };
    const itemInput = {
      bookIdx: 0,
      features: new Array(MODEL_PARAMS.itemFeatureDim).fill(0.5)
    };

    const score = predict(loaded, userInput, itemInput);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);

    loaded.dispose();
  });

  test('loadModel should return null for non-existent path', async () => {
    const result = await loadModel('/caminho/inexistente/modelo_fantasma');
    expect(result).toBeNull();
  });
});
