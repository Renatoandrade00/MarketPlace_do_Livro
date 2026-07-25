/**
 * encoder.js — Módulo de Pré-processamento e Codificação (Step 2.1)
 *
 * Responsável por:
 * 1. Construir vocabulários dinâmicos a partir dos dados do banco (buildVocab)
 * 2. Calcular estatísticas de normalização min-max (computeNormStats)
 * 3. Codificar usuários e livros em vetores numéricos (encodeUser / encodeBook)
 *
 * Os vocabulários e stats são recalculados a cada treinamento — nunca hardcoded.
 */

/**
 * Gera um vetor one-hot de tamanho `size`.
 * Se `value` não estiver no `mapping`, cai no último slot ("Outro/Outra").
 *
 * @param {string|number} value   - O valor a codificar.
 * @param {Object} mapping        - Mapa { valor: índice } (índices 0..size-2).
 * @param {number} size           - Tamanho total do vetor (inclui slot "Outro").
 * @returns {number[]}            - Vetor one-hot de comprimento `size`.
 */
function onehot(value, mapping, size) {
  const vec = new Array(size).fill(0);
  const idx = mapping.hasOwnProperty(value) ? mapping[value] : size - 1;
  vec[idx] = 1;
  return vec;
}

/**
 * Normalização min-max: retorna valor entre 0.0 e 1.0.
 * Se min === max, retorna 0.5 para evitar divisão por zero.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalize(value, min, max) {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Constrói vocabulários a partir dos dados extraídos do banco.
 *
 * @param {Array<{id: number, cidade: string, sexo: string}>} users
 * @param {Array<{id: number, genero: string}>} books
 * @returns {{ cidades: string[], generos: string[], sexos: string[],
 *             cidadeMap: Object, generoMap: Object, sexoMap: Object,
 *             userIndex: Object, bookIndex: Object,
 *             numUsers: number, numBooks: number }}
 */
function buildVocab(users, books) {
  // Extrair valores distintos e ordenar para reprodutibilidade
  const cidadesSet = new Set();
  const sexosSet = new Set();
  const generosSet = new Set();

  for (const u of users) {
    if (u.cidade) cidadesSet.add(u.cidade);
    if (u.sexo) sexosSet.add(u.sexo);
  }
  for (const b of books) {
    if (b.genero) generosSet.add(b.genero);
  }

  const cidades = [...cidadesSet].sort();
  const sexos = [...sexosSet].sort();
  const generos = [...generosSet].sort();

  // Mapas valor → índice (o último slot é implícito para "Outro")
  const cidadeMap = {};
  cidades.forEach((c, i) => { cidadeMap[c] = i; });

  const sexoMap = {};
  sexos.forEach((s, i) => { sexoMap[s] = i; });

  const generoMap = {};
  generos.forEach((g, i) => { generoMap[g] = i; });

  // Índices densos para embeddings: id do Prisma → 0, 1, 2, ...
  const userIndex = {};
  users.forEach((u, i) => { userIndex[u.id] = i; });

  const bookIndex = {};
  books.forEach((b, i) => { bookIndex[b.id] = i; });

  return {
    cidades,
    generos,
    sexos,
    cidadeMap,
    generoMap,
    sexoMap,
    userIndex,
    bookIndex,
    numUsers: users.length,
    numBooks: books.length
  };
}

/**
 * Calcula as estatísticas de normalização min-max para idade e ano.
 *
 * @param {Array<{idade: number}>} users
 * @param {Array<{ano: number}>} books
 * @returns {{ idadeMin: number, idadeMax: number, anoMin: number, anoMax: number }}
 */
function computeNormStats(users, books) {
  let idadeMin = Infinity, idadeMax = -Infinity;
  let anoMin = Infinity, anoMax = -Infinity;

  for (const u of users) {
    if (u.idade < idadeMin) idadeMin = u.idade;
    if (u.idade > idadeMax) idadeMax = u.idade;
  }

  for (const b of books) {
    if (b.ano < anoMin) anoMin = b.ano;
    if (b.ano > anoMax) anoMax = b.ano;
  }

  return { idadeMin, idadeMax, anoMin, anoMax };
}

/**
 * Codifica um usuário em um vetor de features numéricas.
 *
 * Layout do vetor:
 *   [idade_norm(1)] + [sexo_onehot(numSexos+1)] + [cidade_onehot(numCidades+1)]
 *
 * @param {Object} user     - { idade, sexo, cidade }
 * @param {Object} vocab    - Vocabulário retornado por buildVocab
 * @param {Object} normStats - Estatísticas retornadas por computeNormStats
 * @returns {number[]}
 */
function encodeUser(user, vocab, normStats) {
  const idadeNorm = normalize(user.idade, normStats.idadeMin, normStats.idadeMax);
  const sexoVec = onehot(user.sexo, vocab.sexoMap, vocab.sexos.length + 1);
  const cidadeVec = onehot(user.cidade, vocab.cidadeMap, vocab.cidades.length + 1);
  return [idadeNorm, ...sexoVec, ...cidadeVec];
}

/**
 * Codifica um livro em um vetor de features numéricas.
 *
 * Layout do vetor:
 *   [ano_norm(1)] + [genero_onehot(numGeneros+1)]
 *
 * @param {Object} book     - { ano, genero }
 * @param {Object} vocab    - Vocabulário retornado por buildVocab
 * @param {Object} normStats - Estatísticas retornadas por computeNormStats
 * @returns {number[]}
 */
function encodeBook(book, vocab, normStats) {
  const anoNorm = normalize(book.ano, normStats.anoMin, normStats.anoMax);
  const generoVec = onehot(book.genero, vocab.generoMap, vocab.generos.length + 1);
  return [anoNorm, ...generoVec];
}

/**
 * Calcula a dimensão total do vetor de features de um usuário.
 *
 * @param {Object} vocab
 * @returns {number}
 */
function getUserFeatureDim(vocab) {
  // idade_norm(1) + sexo_onehot(numSexos+1) + cidade_onehot(numCidades+1)
  return 1 + (vocab.sexos.length + 1) + (vocab.cidades.length + 1);
}

/**
 * Calcula a dimensão total do vetor de features de um livro.
 *
 * @param {Object} vocab
 * @returns {number}
 */
function getItemFeatureDim(vocab) {
  // ano_norm(1) + genero_onehot(numGeneros+1)
  return 1 + (vocab.generos.length + 1);
}

module.exports = {
  onehot,
  normalize,
  buildVocab,
  computeNormStats,
  encodeUser,
  encodeBook,
  getUserFeatureDim,
  getItemFeatureDim
};
