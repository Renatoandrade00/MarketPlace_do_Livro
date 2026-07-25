/**
 * llmService.js — Módulo de Explicabilidade via LLM (Step 3.2)
 *
 * Responsável por gerar justificativas personalizadas para recomendações de livros
 * utilizando a API do Google Gemini.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Inicialização da API do Gemini
const geminiApiKey = process.env.GEMINI_API_KEY;
let genAI = null;
if (geminiApiKey) {
  genAI = new GoogleGenerativeAI(geminiApiKey);
}

const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

// Cache em memória para justificativas
const justificationCache = new Map();

// Contexto global analítico da loja (padrões iniciais)
let storeContext = {
  generoMaisPopular: "Ficção",
  faixaEtariaPredominante: "25-34",
  autorMaisLido: "Não classificado"
};

/**
 * Sanitiza strings removendo quebras de linha para evitar injeção de prompt.
 *
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  if (!str) return "";
  return str.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Recalcula o contexto agregado da loja (estatísticas).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<Object>} O contexto recalculado
 */
async function refreshStoreContext(prisma) {
  try {
    // 1. Gênero mais popular (com mais compras)
    const genrePurchases = await prisma.purchase.findMany({
      include: { book: true }
    });

    const genreCounts = {};
    const authorCounts = {};
    for (const p of genrePurchases) {
      if (p.book) {
        const gen = p.book.genero || "Não classificado";
        genreCounts[gen] = (genreCounts[gen] || 0) + 1;

        const auth = p.book.autor || "Desconhecido";
        authorCounts[auth] = (authorCounts[auth] || 0) + 1;
      }
    }

    let generoMaisPopular = "Ficção";
    let maxGenreCount = 0;
    for (const [gen, count] of Object.entries(genreCounts)) {
      if (count > maxGenreCount) {
        maxGenreCount = count;
        generoMaisPopular = gen;
      }
    }

    let autorMaisLido = "Desconhecido";
    let maxAuthorCount = 0;
    for (const [auth, count] of Object.entries(authorCounts)) {
      if (count > maxAuthorCount) {
        maxAuthorCount = count;
        autorMaisLido = auth;
      }
    }

    // 2. Faixa etária predominante dos compradores
    const usersWithPurchases = await prisma.user.findMany({
      where: { purchases: { some: {} } }
    });

    const ageGroups = {
      "0-17": 0,
      "18-24": 0,
      "25-34": 0,
      "35-44": 0,
      "45-54": 0,
      "55+": 0
    };

    for (const u of usersWithPurchases) {
      const age = u.idade;
      if (age < 18) ageGroups["0-17"]++;
      else if (age <= 24) ageGroups["18-24"]++;
      else if (age <= 34) ageGroups["25-34"]++;
      else if (age <= 44) ageGroups["35-44"]++;
      else if (age <= 54) ageGroups["45-54"]++;
      else ageGroups["55+"]++;
    }

    let faixaEtariaPredominante = "25-34";
    let maxAgeCount = 0;
    for (const [group, count] of Object.entries(ageGroups)) {
      if (count > maxAgeCount) {
        maxAgeCount = count;
        faixaEtariaPredominante = group;
      }
    }

    storeContext = {
      generoMaisPopular,
      faixaEtariaPredominante,
      autorMaisLido
    };

    return storeContext;
  } catch (error) {
    console.error("Erro ao atualizar contexto da loja:", error);
    return storeContext;
  }
}

/**
 * Obtém a justificativa para a recomendação de um livro.
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {Object} params.user - { idade, sexo, cidade, pais }
 * @param {Object} params.book - { id, nome, autor, ano, genero }
 * @param {number} params.score - Score decimal (0.0 a 1.0)
 * @param {boolean} params.usingFallback - Se está usando fallback de popularidade
 * @returns {Promise<string>} A justificativa
 */
async function getJustification({ userId, user, book, score, usingFallback }) {
  const scorePercent = Math.round(score * 100);

  // Se usar fallback de popularidade, retornar justificativa estática
  if (usingFallback) {
    return "Recomendado por ser um dos livros mais populares da loja.";
  }

  // Chave de cache arredondada em passos de 5% (score * 20)
  const cacheKey = `${userId}-${book.id}-${Math.round(score * 20)}`;
  if (justificationCache.has(cacheKey)) {
    return justificationCache.get(cacheKey).texto;
  }

  const fallbackText = `Este livro tem ${scorePercent}% de compatibilidade com o seu perfil, com base no seu histórico de compras.`;

  // Se a API Key do Gemini não estiver configurada, retornar fallback imediatamente
  if (!genAI) {
    return fallbackText;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 100
      }
    });

    const systemInstruction = `Você é um assistente de recomendação de livros. Gere uma justificativa curta (1 a 2 frases), amigável e em português, explicando por que um livro foi recomendado a um cliente, com base no perfil dele e no score calculado por um modelo de IA. Não invente informações que não estejam nos dados fornecidos.`;

    const sanitizedNome = sanitize(book.nome);
    const sanitizedAutor = sanitize(book.autor);
    const sanitizedCidade = sanitize(user.cidade);

    const prompt = `Perfil do cliente: ${user.idade} anos, sexo ${user.sexo}, mora em ${sanitizedCidade}, ${user.pais}.
Livro: "${sanitizedNome}" de ${sanitizedAutor} (${book.ano}), gênero ${book.genero}.
Score de interesse calculado pela IA: ${scorePercent}%.
Contexto da loja: gênero mais popular é ${storeContext.generoMaisPopular}; faixa etária predominante é ${storeContext.faixaEtariaPredominante}.
Gere a justificativa.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }]
    });

    const text = result.response.text().trim();
    if (text) {
      justificationCache.set(cacheKey, { texto: text, geradoEm: new Date() });
      return text;
    }

    return fallbackText;
  } catch (error) {
    console.error("Erro na chamada da API do Gemini:", error.message);
    return fallbackText;
  }
}

/**
 * Retorna o contexto atual da loja.
 */
function getStoreContext() {
  return storeContext;
}

/**
 * Limpa o cache de justificativas.
 */
function clearCache() {
  justificationCache.clear();
}

module.exports = {
  getJustification,
  refreshStoreContext,
  getStoreContext,
  clearCache
};
