/**
 * server.js — Servidor REST do Marketplace do Livro (Step 3.1)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('./services/db');
const path = require('path');
const app = express();

const {
  loadModel,
  predict
} = require('./ai/recommendationModel');
const {
  trainModel,
  predictAll,
  popularityFallback,
  loadMetadata,
  DEFAULT_MODEL_DIR
} = require('./ai/trainPipeline');
const {
  getJustification,
  refreshStoreContext,
  getStoreContext
} = require('./services/llmService');

// Configurações básicas
app.use(helmet());
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do frontend (Fase 4)
app.use(express.static(path.join(__dirname, '../public')));

// Estado global do treinamento em memória
let isTraining = false;
let modelStatus = {
  status: "never_trained", // idle | training | never_trained
  lastTrainedAt: null,
  metrics: null
};

// Instância ativa do modelo e metadados
let activeModel = null;
let activeVocab = null;
let activeNormStats = null;

// Rate Limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 requisições por IP
  message: { error: "Muitas requisições feitas a partir deste IP, por favor tente novamente mais tarde." }
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // limite estrito de 5 requisições por minuto por IP para rotas admin
  message: { error: "Muitas requisições nas rotas administrativas. Limite de 5 por minuto." }
});

// Middleware para verificar token administrativo simples (opcional/mitigação de abuso)
function requireAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  const expectedToken = process.env.ADMIN_TOKEN;
  
  if (expectedToken && token !== expectedToken) {
    return res.status(403).json({ error: "Acesso negado. Token administrativo inválido." });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROTAS REST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/users
 * Retorna todos os usuários cadastrados.
 */
app.get('/api/users', generalLimiter, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { nome: 'asc' }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Erro interno ao buscar usuários." });
  }
});

/**
 * GET /api/recommendations/:userId
 * Retorna recomendações para o cliente.
 */
app.get('/api/recommendations/:userId', generalLimiter, async (req, res) => {
  try {
    const userIdResult = z.coerce.number().int().positive().safeParse(req.params.userId);
    if (!userIdResult.success) {
      return res.status(400).json({ error: "ID do usuário inválido." });
    }
    const userId = userIdResult.data;

    // Verificar se o usuário existe
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    // Buscar todos os livros e as compras já feitas pelo usuário (para filtrar ou marcar)
    const books = await prisma.book.findMany();
    const userPurchases = await prisma.purchase.findMany({
      where: { userId }
    });
    const purchasedBookIds = new Set(userPurchases.map(p => p.bookId));

    let recommendations = [];
    let usingFallback = false;

    // Condições para Fallback: sem modelo, usuário cold start, ou usuário não cadastrado no vocabulário
    const isColdStart = purchasedBookIds.size === 0;
    const isNotInVocab = !activeVocab || activeVocab.userIndex[userId] === undefined;

    if (!activeModel || isColdStart || isNotInVocab) {
      usingFallback = true;
      const allPurchases = await prisma.purchase.findMany();
      recommendations = popularityFallback(books, allPurchases);
    } else {
      recommendations = predictAll(activeModel, user, books, activeVocab, activeNormStats);
    }

    // Gerar as justificativas e montar a resposta
    
    // Suportar limit via query parameter (default 10, máximo 50)
    let limit = 10;
    if (req.query.limit) {
      const parsedLimit = parseInt(req.query.limit, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 50);
      }
    }

    const topRecommendations = recommendations.slice(0, limit);

    const recommendedBooksRaw = await Promise.all(topRecommendations.map(async (rec) => {
      const book = books.find(b => b.id === rec.bookId);
      if (!book) return null;

      const scorePercent = Math.round(rec.score * 100);
      const isPurchased = purchasedBookIds.has(book.id);

      // Gerar justificativa via LLM (com cache e fallback integrados)
      const justificativa = await getJustification({
        userId,
        user,
        book,
        score: rec.score,
        usingFallback
      });

      return {
        bookId: book.id,
        nome: book.nome,
        autor: book.autor,
        ano: book.ano,
        genero: book.genero,
        score: parseFloat(rec.score.toFixed(4)),
        scorePercent,
        isPurchased,
        justificativa
      };
    }));

    const recommendedBooks = recommendedBooksRaw.filter(b => b !== null);

    res.json({
      userId,
      generatedAt: new Date().toISOString(),
      usingFallback,
      books: recommendedBooks
    });
  } catch (error) {
    console.error("Erro ao gerar recomendações:", error);
    res.status(500).json({ error: "Erro interno ao gerar recomendações." });
  }
});

/**
 * POST /api/purchases
 * Registra a compra de um livro.
 */
app.post('/api/purchases', generalLimiter, async (req, res) => {
  try {
    const bodySchema = z.object({
      userId: z.coerce.number().int().positive(),
      bookId: z.coerce.number().int().positive()
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Campos 'userId' e 'bookId' são obrigatórios e devem ser inteiros positivos." });
    }

    const { userId, bookId } = parsed.data;

    // Verificar se usuário e livro existem
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    const bookExists = await prisma.book.findUnique({ where: { id: bookId } });
    if (!bookExists) {
      return res.status(404).json({ error: "Livro não encontrado." });
    }

    // Verificar se a compra já existe (unique constraint)
    const existingPurchase = await prisma.purchase.findUnique({
      where: {
        userId_bookId: { userId, bookId }
      }
    });
    if (existingPurchase) {
      return res.status(409).json({ error: "Este usuário já adquiriu este livro." });
    }

    // Criar a compra
    const purchase = await prisma.purchase.create({
      data: { userId, bookId }
    });

    res.status(201).json(purchase);
  } catch (error) {
    console.error("Erro ao registrar compra:", error);
    res.status(500).json({ error: "Erro interno ao registrar compra." });
  }
});

/**
 * DELETE /api/purchases/:id
 * Cancela/deleta uma compra de livro.
 */
app.delete('/api/purchases/:id', generalLimiter, async (req, res) => {
  try {
    const idResult = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!idResult.success) {
      return res.status(400).json({ error: "ID da compra inválido." });
    }
    const id = idResult.data;

    const purchase = await prisma.purchase.findUnique({ where: { id } });
    if (!purchase) {
      return res.status(404).json({ error: "Registro de compra não encontrado." });
    }

    await prisma.purchase.delete({ where: { id } });
    res.json({ deleted: true, id });
  } catch (error) {
    res.status(500).json({ error: "Erro interno ao cancelar compra." });
  }
});

/**
 * GET /api/purchases/user/:userId
 * Retorna as compras de um usuário específico.
 */
app.get('/api/purchases/user/:userId', generalLimiter, async (req, res) => {
  try {
    const userIdResult = z.coerce.number().int().positive().safeParse(req.params.userId);
    if (!userIdResult.success) {
      return res.status(400).json({ error: "ID do usuário inválido." });
    }
    const userId = userIdResult.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    const purchases = await prisma.purchase.findMany({
      where: { userId },
      include: { book: true },
      orderBy: { createdAt: 'desc' }
    });

    const formattedPurchases = purchases.map(p => ({
      purchaseId: p.id,
      bookId: p.bookId,
      nome: p.book?.nome || "Desconhecido",
      autor: p.book?.autor || "Desconhecido",
      createdAt: p.createdAt.toISOString()
    }));

    res.json(formattedPurchases);
  } catch (error) {
    res.status(500).json({ error: "Erro interno ao buscar histórico de compras." });
  }
});

/**
 * POST /api/model/train
 * Dispara de forma assíncrona o retreino do modelo.
 */
app.post('/api/model/train', adminLimiter, requireAdminToken, async (req, res) => {
  if (isTraining) {
    return res.status(409).json({ error: "Já existe um treinamento do modelo em andamento." });
  }

  isTraining = true;
  modelStatus.status = "training";

  const startedAt = new Date().toISOString();

  // Executar retreino em segundo plano sem bloquear a resposta REST
  (async () => {
    try {
      console.log("[Treino] Iniciando retreino sob demanda...");
      const users = await prisma.user.findMany();
      const books = await prisma.book.findMany();
      const purchases = await prisma.purchase.findMany();

      const result = await trainModel({
        users,
        books,
        purchases,
        modelDir: DEFAULT_MODEL_DIR
      });

      // Atualizar a referência em memória
      activeModel = result.model;
      activeVocab = result.vocab;
      activeNormStats = result.normStats;

      modelStatus.status = "idle";
      modelStatus.lastTrainedAt = new Date().toISOString();
      modelStatus.metrics = {
        loss: parseFloat(result.history.finalLoss.toFixed(4)),
        valLoss: parseFloat(result.history.finalValLoss.toFixed(4)),
        epochs: result.history.epochs
      };
      console.log("[Treino] Retreino concluído com sucesso!");
    } catch (err) {
      console.error("[Treino] Falha no retreino do modelo:", err);
      modelStatus.status = activeModel ? "idle" : "never_trained";
    } finally {
      isTraining = false;
    }
  })();

  res.status(202).json({
    status: "training_started",
    startedAt
  });
});

/**
 * GET /api/model/status
 * Retorna as métricas e o status atual do modelo.
 */
app.get('/api/model/status', generalLimiter, (req, res) => {
  res.json({
    status: modelStatus.status,
    lastTrainedAt: modelStatus.lastTrainedAt,
    metrics: modelStatus.metrics
  });
});

/**
 * POST /api/llm/refresh-context
 * Recalcula as estatísticas agregadas no LLM Service.
 */
app.post('/api/llm/refresh-context', adminLimiter, requireAdminToken, async (req, res) => {
  try {
    const context = await refreshStoreContext(prisma);
    res.json({
      updatedAt: new Date().toISOString(),
      context
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar contexto da loja no LLM." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP E INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  // 1. Iniciar servidor Express imediatamente para liberar a porta no Render
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });

  // Executar inicialização pesada em background sem travar o boot do Render
  (async () => {
    // 2. Tentar carregar modelo existente em disco
    console.log("Tentando carregar modelo salvo anteriormente...");
    const model = await loadModel(DEFAULT_MODEL_DIR);
    const meta = loadMetadata(DEFAULT_MODEL_DIR);

    if (model && meta) {
      activeModel = model;
      activeVocab = meta.vocab;
      activeNormStats = meta.normStats;
      modelStatus.status = "idle";
      modelStatus.lastTrainedAt = new Date().toISOString(); // simulado do boot
      console.log("Modelo Two-Tower carregado com sucesso a partir de disco!");
    } else {
      // 3. Se não existir, rodar o treino automático no boot (necessário em produção/reboot)
      console.log("Nenhum modelo válido encontrado no disco. Iniciando treino automático de boot...");
      try {
        const users = await prisma.user.findMany();
        const books = await prisma.book.findMany();
        const purchases = await prisma.purchase.findMany();

        if (users.length > 0 && books.length > 0 && purchases.length > 0) {
          const result = await trainModel({
            users,
            books,
            purchases,
            modelDir: DEFAULT_MODEL_DIR
          });

          activeModel = result.model;
          activeVocab = result.vocab;
          activeNormStats = result.normStats;

          modelStatus.status = "idle";
          modelStatus.lastTrainedAt = new Date().toISOString();
          modelStatus.metrics = {
            loss: parseFloat(result.history.finalLoss.toFixed(4)),
            valLoss: parseFloat(result.history.finalValLoss.toFixed(4)),
            epochs: result.history.epochs
          };
          console.log("Treino automático de boot finalizado. Modelo Two-Tower inicializado.");
        } else {
          console.log("Banco de dados sem dados suficientes para treinar. Modelo não carregado.");
        }
      } catch (err) {
        console.error("Falha ao rodar o treino automático de boot:", err);
      }
    }

    // 4. Inicializar estatísticas agregadas do LLM Service
    console.log("Calculando contexto agregador inicial para o serviço de LLM...");
    try {
      await refreshStoreContext(prisma);
    } catch (err) {
      console.error("Falha ao inicializar contexto do LLM:", err);
    }
  })();
}

// Iniciar bootstrap se não estiver rodando em ambiente de teste
if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

module.exports = app;
