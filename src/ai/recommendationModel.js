/**
 * recommendationModel.js — Arquitetura Two-Tower (Step 2.2)
 *
 * Rede neural de duas torres para recomendação de livros:
 *
 *   User Tower:  userIdEmb(16) + userFeatures  → Dense(32,relu) → Dense(16,relu) → userVec(16)
 *   Item Tower:  bookIdEmb(16) + bookFeatures  → Dense(32,relu) → Dense(16,relu) → itemVec(16)
 *   Fusion:      concat(userVec, itemVec)(32)   → Dense(16,relu) → Dense(1,sigmoid) → score
 *
 * Usa a Functional API do TensorFlow.js para suportar múltiplos inputs.
 */

const tf = require('@tensorflow/tfjs');
const fs = require('fs');
const path = require('path');

const EMBEDDING_DIM = 16;

/**
 * Constrói o modelo Two-Tower com a Functional API do TensorFlow.js.
 *
 * @param {Object} params
 * @param {number} params.numUsers        - Total de usuários no vocabulário
 * @param {number} params.numBooks        - Total de livros no vocabulário
 * @param {number} params.userFeatureDim  - Dimensão do vetor de features do usuário (encoder)
 * @param {number} params.itemFeatureDim  - Dimensão do vetor de features do livro (encoder)
 * @returns {tf.LayersModel}
 */
function buildModel({ numUsers, numBooks, userFeatureDim, itemFeatureDim }) {
  // ── Inputs ──────────────────────────────────────────────────
  const userIdInput = tf.input({ shape: [1], name: 'userId', dtype: 'int32' });
  const userFeatureInput = tf.input({ shape: [userFeatureDim], name: 'userFeatures' });
  const bookIdInput = tf.input({ shape: [1], name: 'bookId', dtype: 'int32' });
  const bookFeatureInput = tf.input({ shape: [itemFeatureDim], name: 'bookFeatures' });

  // ── User Tower ──────────────────────────────────────────────
  const userEmbedding = tf.layers.embedding({
    inputDim: numUsers,
    outputDim: EMBEDDING_DIM,
    name: 'userEmbedding'
  }).apply(userIdInput);
  const userEmbFlat = tf.layers.flatten({ name: 'userEmbFlatten' }).apply(userEmbedding);
  const userConcat = tf.layers.concatenate({ name: 'userConcat' }).apply([userEmbFlat, userFeatureInput]);
  const userDense1 = tf.layers.dense({ units: 32, activation: 'relu', name: 'userDense1' }).apply(userConcat);
  const userVector = tf.layers.dense({ units: 16, activation: 'relu', name: 'userDense2' }).apply(userDense1);

  // ── Item Tower ──────────────────────────────────────────────
  const bookEmbedding = tf.layers.embedding({
    inputDim: numBooks,
    outputDim: EMBEDDING_DIM,
    name: 'bookEmbedding'
  }).apply(bookIdInput);
  const bookEmbFlat = tf.layers.flatten({ name: 'bookEmbFlatten' }).apply(bookEmbedding);
  const bookConcat = tf.layers.concatenate({ name: 'bookConcat' }).apply([bookEmbFlat, bookFeatureInput]);
  const bookDense1 = tf.layers.dense({ units: 32, activation: 'relu', name: 'bookDense1' }).apply(bookConcat);
  const itemVector = tf.layers.dense({ units: 16, activation: 'relu', name: 'bookDense2' }).apply(bookDense1);

  // ── Camada de Fusão ─────────────────────────────────────────
  const merged = tf.layers.concatenate({ name: 'fusionConcat' }).apply([userVector, itemVector]);
  const fusionDense1 = tf.layers.dense({ units: 16, activation: 'relu', name: 'fusionDense1' }).apply(merged);
  const output = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'output' }).apply(fusionDense1);

  // ── Montagem ────────────────────────────────────────────────
  const model = tf.model({
    inputs: [userIdInput, userFeatureInput, bookIdInput, bookFeatureInput],
    outputs: output,
    name: 'TwoTowerRecommender'
  });

  return model;
}

/**
 * Salva o modelo treinado em disco usando serialização manual.
 * Compatível com @tensorflow/tfjs puro (sem tfjs-node).
 *
 * @param {tf.LayersModel} model
 * @param {string} dirPath - Caminho relativo ou absoluto (default: 'data/model')
 */
async function saveModel(model, dirPath = 'data/model') {
  const absPath = path.resolve(dirPath);
  if (!fs.existsSync(absPath)) {
    fs.mkdirSync(absPath, { recursive: true });
  }

  // Salvar topologia (sem weightsManifest para evitar URL fetch)
  const topology = JSON.parse(model.toJSON());
  fs.writeFileSync(
    path.join(absPath, 'model.json'),
    JSON.stringify({ modelTopology: topology }, null, 2)
  );

  // Salvar pesos como JSON com dados brutos
  const weightData = [];
  for (const w of model.getWeights()) {
    const data = await w.data();
    weightData.push({
      name: w.name,
      shape: w.shape,
      dtype: w.dtype,
      data: Array.from(data)
    });
  }
  fs.writeFileSync(path.join(absPath, 'weights.bin'), JSON.stringify(weightData));
}

/**
 * Carrega um modelo salvo em disco.
 * Retorna null de forma amigável se o modelo não existir — nunca lança exceção.
 *
 * @param {string} dirPath - Caminho relativo ou absoluto (default: 'data/model')
 * @returns {Promise<tf.LayersModel|null>}
 */
async function loadModel(dirPath = 'data/model') {
  const absPath = path.resolve(dirPath);
  const modelJsonPath = path.join(absPath, 'model.json');
  const weightsPath = path.join(absPath, 'weights.bin');

  if (!fs.existsSync(modelJsonPath) || !fs.existsSync(weightsPath)) {
    return null;
  }

  try {
    const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));
    const weightData = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));

    // Reconstruir modelo a partir da topologia (sem weightsManifest)
    const model = await tf.models.modelFromJSON(modelJson);

    // Restaurar pesos manualmente
    const tensors = weightData.map(w => tf.tensor(w.data, w.shape, w.dtype));
    model.setWeights(tensors);
    tensors.forEach(t => t.dispose());

    return model;
  } catch (_err) {
    return null;
  }
}

/**
 * Executa inferência para um par (usuário, livro) e retorna a probabilidade de compra.
 *
 * Os tensores são criados e descartados automaticamente dentro de tf.tidy()
 * para evitar vazamento de memória.
 *
 * @param {tf.LayersModel} model
 * @param {{ userIdx: number, features: number[] }} userInput
 * @param {{ bookIdx: number, features: number[] }} itemInput
 * @returns {number} Score entre 0.0 e 1.0
 */
function predict(model, userInput, itemInput) {
  return tf.tidy(() => {
    const userIdTensor = tf.tensor2d([[userInput.userIdx]], [1, 1], 'int32');
    const userFeatureTensor = tf.tensor2d([userInput.features], [1, userInput.features.length]);
    const bookIdTensor = tf.tensor2d([[itemInput.bookIdx]], [1, 1], 'int32');
    const bookFeatureTensor = tf.tensor2d([itemInput.features], [1, itemInput.features.length]);

    const prediction = model.predict([userIdTensor, userFeatureTensor, bookIdTensor, bookFeatureTensor]);
    return prediction.dataSync()[0];
  });
}

module.exports = {
  buildModel,
  saveModel,
  loadModel,
  predict,
  EMBEDDING_DIM
};
