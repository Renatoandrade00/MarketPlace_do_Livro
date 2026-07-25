/**
 * trainPipeline.js — Pipeline de Treinamento e Inferência (Step 2.3)
 *
 * Orquestra o fluxo completo:
 *   1. Carrega dados do banco (users, books, purchases)
 *   2. Constrói vocabulário e normStats via encoder.js
 *   3. Gera exemplos positivos + negative sampling (1:4)
 *   4. Split treino/validação (80/20, seed fixa)
 *   5. Constrói e treina o modelo Two-Tower
 *   6. Persiste modelo, vocab e normStats em disco
 *
 * Hiperparâmetros conforme SPEC §4.2:
 *   batchSize=32, epochs=30, earlyStopPatience=3, lr=0.001, loss=binaryCrossentropy
 */

const tf = require('@tensorflow/tfjs');
const fs = require('fs');
const path = require('path');

const {
  buildVocab,
  computeNormStats,
  encodeUser,
  encodeBook,
  getUserFeatureDim,
  getItemFeatureDim
} = require('./encoder.js');

const {
  buildModel,
  saveModel,
  loadModel,
  predict
} = require('./recommendationModel.js');

// ── Configuração ──────────────────────────────────────────────
const DEFAULT_MODEL_DIR = path.join(__dirname, '..', '..', 'data', 'model');
const NEGATIVE_RATIO = 4;     // 1 positivo : 4 negativos (SPEC §4.1)
const TRAIN_SPLIT = 0.8;      // 80% treino, 20% validação (SPEC §4.2)
const BATCH_SIZE = 32;
const MAX_EPOCHS = 30;
const EARLY_STOP_PATIENCE = 3;
const LEARNING_RATE = 0.001;
const RANDOM_SEED = 42;       // seed fixa para reprodutibilidade

// ── PRNG com seed fixa ────────────────────────────────────────
/**
 * Gerador pseudoaleatório determinístico (Mulberry32).
 * Garante reprodutibilidade no negative sampling e no split.
 *
 * @param {number} seed
 * @returns {() => number} Função que retorna um float em [0, 1)
 */
function seededRandom(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle in-place com Fisher-Yates usando PRNG seeded.
 *
 * @param {Array} array
 * @param {() => number} rng
 * @returns {Array}
 */
function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ── Negative Sampling ─────────────────────────────────────────
/**
 * Gera pares negativos para treinamento.
 *
 * Para cada par positivo (userId, bookId), gera `k` pares negativos
 * onde o bookId aleatório NÃO está entre as compras do userId.
 *
 * @param {Array<{userId: number, bookId: number}>} purchases - Compras positivas
 * @param {number[]} allBookIds - Todos os bookIds disponíveis
 * @param {number} k - Ratio negativo (default: 4)
 * @param {() => number} rng - PRNG seeded
 * @returns {Array<{userId: number, bookId: number, label: number}>}
 */
function generateSamples(purchases, allBookIds, k = NEGATIVE_RATIO, rng) {
  // Mapear compras por usuário para busca rápida
  const userPurchases = new Map();
  for (const p of purchases) {
    if (!userPurchases.has(p.userId)) {
      userPurchases.set(p.userId, new Set());
    }
    userPurchases.get(p.userId).add(p.bookId);
  }

  const samples = [];

  // Exemplos positivos (label = 1)
  for (const p of purchases) {
    samples.push({ userId: p.userId, bookId: p.bookId, label: 1 });
  }

  // Exemplos negativos (label = 0)
  for (const p of purchases) {
    const purchasedBooks = userPurchases.get(p.userId);
    let generated = 0;

    // Tentar até k negativos por positivo (com limite de tentativas)
    let attempts = 0;
    const maxAttempts = k * 10;

    while (generated < k && attempts < maxAttempts) {
      const randomIdx = Math.floor(rng() * allBookIds.length);
      const candidateBookId = allBookIds[randomIdx];
      attempts++;

      if (!purchasedBooks.has(candidateBookId)) {
        samples.push({ userId: p.userId, bookId: candidateBookId, label: 0 });
        generated++;
      }
    }
  }

  return shuffle(samples, rng);
}

// ── Preparação de Tensores ────────────────────────────────────
/**
 * Converte amostras em tensores prontos para treino.
 *
 * @param {Array<{userId: number, bookId: number, label: number}>} samples
 * @param {Map<number, Object>} usersMap - Map de userId → user object
 * @param {Map<number, Object>} booksMap - Map de bookId → book object
 * @param {Object} vocab
 * @param {Object} normStats
 * @returns {{ userIds: tf.Tensor, userFeatures: tf.Tensor,
 *             bookIds: tf.Tensor, bookFeatures: tf.Tensor,
 *             labels: tf.Tensor }}
 */
function prepareTensors(samples, usersMap, booksMap, vocab, normStats) {
  const userIdArr = [];
  const userFeatArr = [];
  const bookIdArr = [];
  const bookFeatArr = [];
  const labelArr = [];

  for (const s of samples) {
    const userIdx = vocab.userIndex[s.userId];
    const bookIdx = vocab.bookIndex[s.bookId];

    // Pular amostras cujo userId ou bookId não estão no vocabulário
    if (userIdx === undefined || bookIdx === undefined) continue;

    const user = usersMap.get(s.userId);
    const book = booksMap.get(s.bookId);
    if (!user || !book) continue;

    userIdArr.push([userIdx]);
    userFeatArr.push(encodeUser(user, vocab, normStats));
    bookIdArr.push([bookIdx]);
    bookFeatArr.push(encodeBook(book, vocab, normStats));
    labelArr.push(s.label);
  }

  return {
    userIds: tf.tensor2d(userIdArr, [userIdArr.length, 1], 'int32'),
    userFeatures: tf.tensor2d(userFeatArr),
    bookIds: tf.tensor2d(bookIdArr, [bookIdArr.length, 1], 'int32'),
    bookFeatures: tf.tensor2d(bookFeatArr),
    labels: tf.tensor2d(labelArr.map(l => [l]), [labelArr.length, 1])
  };
}

// ── Treinamento ───────────────────────────────────────────────
/**
 * Executa o pipeline completo de treinamento.
 *
 * @param {Object} params
 * @param {Array} params.users      - Array de objetos User do Prisma
 * @param {Array} params.books      - Array de objetos Book do Prisma
 * @param {Array} params.purchases  - Array de objetos Purchase do Prisma
 * @param {string} [params.modelDir] - Diretório para salvar o modelo
 * @param {Function} [params.onEpochEnd] - Callback (epoch, logs) chamado ao final de cada época
 * @returns {Promise<{ model: tf.LayersModel, history: Object, vocab: Object, normStats: Object }>}
 */
async function trainModel({
  users,
  books,
  purchases,
  modelDir = DEFAULT_MODEL_DIR,
  onEpochEnd = null
}) {
  const rng = seededRandom(RANDOM_SEED);

  // 1. Construir vocabulário e normalização
  const vocab = buildVocab(users, books);
  const normStats = computeNormStats(users, books);
  const userFeatureDim = getUserFeatureDim(vocab);
  const itemFeatureDim = getItemFeatureDim(vocab);

  // 2. Gerar exemplos com negative sampling
  const allBookIds = books.map(b => b.id);
  const samples = generateSamples(purchases, allBookIds, NEGATIVE_RATIO, rng);

  // 3. Split treino/validação (80/20)
  const splitIdx = Math.floor(samples.length * TRAIN_SPLIT);
  const trainSamples = samples.slice(0, splitIdx);
  const valSamples = samples.slice(splitIdx);

  // 4. Criar Maps para acesso rápido
  const usersMap = new Map(users.map(u => [u.id, u]));
  const booksMap = new Map(books.map(b => [b.id, b]));

  // 5. Preparar tensores
  const trainTensors = prepareTensors(trainSamples, usersMap, booksMap, vocab, normStats);
  const valTensors = prepareTensors(valSamples, usersMap, booksMap, vocab, normStats);

  // 6. Construir e compilar modelo
  const model = buildModel({
    numUsers: vocab.numUsers,
    numBooks: vocab.numBooks,
    userFeatureDim,
    itemFeatureDim
  });

  model.compile({
    optimizer: tf.train.adam(LEARNING_RATE),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  // 7. Treinar com early stopping manual
  let bestValLoss = Infinity;
  let patienceCounter = 0;
  let bestEpoch = 0;
  const historyLog = { loss: [], val_loss: [], acc: [], val_acc: [] };

  for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
    const h = await model.fit(
      [trainTensors.userIds, trainTensors.userFeatures,
       trainTensors.bookIds, trainTensors.bookFeatures],
      trainTensors.labels,
      {
        batchSize: BATCH_SIZE,
        epochs: 1,
        validationData: [
          [valTensors.userIds, valTensors.userFeatures,
           valTensors.bookIds, valTensors.bookFeatures],
          valTensors.labels
        ],
        verbose: 0
      }
    );

    const loss = h.history.loss[0];
    const valLoss = h.history.val_loss[0];
    const acc = h.history.acc[0];
    const valAcc = h.history.val_acc[0];

    historyLog.loss.push(loss);
    historyLog.val_loss.push(valLoss);
    historyLog.acc.push(acc);
    historyLog.val_acc.push(valAcc);

    if (onEpochEnd) {
      onEpochEnd(epoch + 1, { loss, valLoss, acc, valAcc });
    }

    // Early stopping
    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      bestEpoch = epoch + 1;
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= EARLY_STOP_PATIENCE) {
        break; // Parar treino
      }
    }
  }

  // 8. Salvar modelo e metadados
  await saveModel(model, modelDir);

  // Salvar vocab e normStats junto com o modelo
  const metadataPath = path.resolve(modelDir);
  fs.writeFileSync(
    path.join(metadataPath, 'vocab.json'),
    JSON.stringify(vocab, null, 2)
  );
  fs.writeFileSync(
    path.join(metadataPath, 'normStats.json'),
    JSON.stringify(normStats, null, 2)
  );

  // 9. Limpar tensores de treino/validação
  Object.values(trainTensors).forEach(t => t.dispose());
  Object.values(valTensors).forEach(t => t.dispose());

  return {
    model,
    history: {
      epochs: historyLog.loss.length,
      bestEpoch,
      finalLoss: historyLog.loss[historyLog.loss.length - 1],
      finalValLoss: historyLog.val_loss[historyLog.val_loss.length - 1],
      finalAcc: historyLog.acc[historyLog.acc.length - 1],
      finalValAcc: historyLog.val_acc[historyLog.val_acc.length - 1],
      log: historyLog
    },
    vocab,
    normStats
  };
}

// ── Inferência Batch ──────────────────────────────────────────
/**
 * Gera scores de recomendação para TODOS os livros dado um userId.
 * Usado pela rota GET /api/recommendations/:userId.
 *
 * @param {tf.LayersModel} model
 * @param {Object} user       - Objeto do usuário { id, idade, sexo, cidade, ... }
 * @param {Array} books       - Array de todos os livros
 * @param {Object} vocab
 * @param {Object} normStats
 * @returns {Array<{bookId: number, score: number}>} Ordenado por score desc
 */
function predictAll(model, user, books, vocab, normStats) {
  const userIdx = vocab.userIndex[user.id];
  if (userIdx === undefined) return []; // cold start → fallback

  const userFeatures = encodeUser(user, vocab, normStats);
  const results = [];

  for (const book of books) {
    const bookIdx = vocab.bookIndex[book.id];
    if (bookIdx === undefined) continue; // livro novo, sem embedding

    const score = predict(model, { userIdx, features: userFeatures }, { bookIdx, features: encodeBook(book, vocab, normStats) });
    results.push({ bookId: book.id, score });
  }

  // Ordenar por score decrescente
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Fallback de Popularidade ──────────────────────────────────
/**
 * Retorna livros ordenados por popularidade (contagem de compras).
 * Usado como fallback para cold start e antes do primeiro treino.
 *
 * @param {Array} books      - Array de todos os livros
 * @param {Array} purchases  - Array de todas as compras
 * @returns {Array<{bookId: number, score: number}>}
 */
function popularityFallback(books, purchases) {
  // Contar compras por livro
  const counts = new Map();
  for (const p of purchases) {
    counts.set(p.bookId, (counts.get(p.bookId) || 0) + 1);
  }

  const maxCount = Math.max(...counts.values(), 1);

  return books
    .map(b => ({
      bookId: b.id,
      score: (counts.get(b.id) || 0) / maxCount // normalizado 0-1
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Carregar Metadados ────────────────────────────────────────
/**
 * Carrega vocab e normStats salvos junto com o modelo.
 *
 * @param {string} modelDir
 * @returns {{ vocab: Object, normStats: Object } | null}
 */
function loadMetadata(modelDir = DEFAULT_MODEL_DIR) {
  const absPath = path.resolve(modelDir);
  const vocabPath = path.join(absPath, 'vocab.json');
  const normStatsPath = path.join(absPath, 'normStats.json');

  if (!fs.existsSync(vocabPath) || !fs.existsSync(normStatsPath)) {
    return null;
  }

  try {
    return {
      vocab: JSON.parse(fs.readFileSync(vocabPath, 'utf8')),
      normStats: JSON.parse(fs.readFileSync(normStatsPath, 'utf8'))
    };
  } catch (_err) {
    return null;
  }
}

module.exports = {
  trainModel,
  predictAll,
  popularityFallback,
  loadMetadata,
  generateSamples,
  prepareTensors,
  seededRandom,
  shuffle,
  DEFAULT_MODEL_DIR,
  NEGATIVE_RATIO,
  TRAIN_SPLIT,
  BATCH_SIZE,
  MAX_EPOCHS,
  EARLY_STOP_PATIENCE,
  LEARNING_RATE
};
