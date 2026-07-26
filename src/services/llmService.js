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
    const popularGenreResult = await prisma.$queryRaw`
      SELECT B.genero, COUNT(*) as count
      FROM Purchase P
      JOIN Book B ON P.bookId = B.id
      GROUP BY B.genero
      ORDER BY count DESC
      LIMIT 1
    `;
    const generoMaisPopular = popularGenreResult[0]?.genero || "Ficção";

    // 2. Autor mais lido
    const popularAuthorResult = await prisma.$queryRaw`
      SELECT B.autor, COUNT(*) as count
      FROM Purchase P
      JOIN Book B ON P.bookId = B.id
      GROUP BY B.autor
      ORDER BY count DESC
      LIMIT 1
    `;
    const autorMaisLido = popularAuthorResult[0]?.autor || "Não classificado";

    // 3. Faixa etária predominante dos compradores
    const predominantAgeResult = await prisma.$queryRaw`
      SELECT 
        CASE 
          WHEN U.idade < 18 THEN '0-17'
          WHEN U.idade >= 18 AND U.idade <= 24 THEN '18-24'
          WHEN U.idade >= 25 AND U.idade <= 34 THEN '25-34'
          WHEN U.idade >= 35 AND U.idade <= 44 THEN '35-44'
          WHEN U.idade >= 45 AND U.idade <= 54 THEN '45-54'
          ELSE '55+'
        END as ageGroup,
        COUNT(*) as count
      FROM User U
      WHERE EXISTS (SELECT 1 FROM Purchase P WHERE P.userId = U.id)
      GROUP BY ageGroup
      ORDER BY count DESC
      LIMIT 1
    `;
    const faixaEtariaPredominante = predominantAgeResult[0]?.ageGroup || "25-34";

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
function getDynamicFallback(book, scorePercent) {
  const templates = [
    `Este livro de ${book.genero} tem ${scorePercent}% de compatibilidade com o seu perfil de leitura.`,
    `Com base nas suas preferências, "${book.nome}" possui ${scorePercent}% de compatibilidade com você.`,
    `Recomendamos este livro de ${book.autor} (${scorePercent}% de compatibilidade) com base no seu histórico.`,
    `Que tal explorar "${book.nome}"? A IA calculou ${scorePercent}% de compatibilidade com o seu perfil.`,
    `Afinidade de ${scorePercent}% de compatibilidade detectada para este livro do gênero ${book.genero}.`
  ];
  const index = book.id % templates.length;
  return templates[index];
}

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

  const fallbackText = getDynamicFallback(book, scorePercent);

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
