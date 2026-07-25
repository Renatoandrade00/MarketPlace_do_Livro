import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { PrismaClient } = require('@prisma/client');
const {
  getJustification,
  refreshStoreContext,
  getStoreContext,
  clearCache
} = require('../src/services/llmService.js');

const prisma = new PrismaClient();

describe('LLM Service Tests - Step 3.2', () => {
  beforeAll(async () => {
    // Limpar o cache antes dos testes
    clearCache();
  });

  test('Should compute store context correctly from database', async () => {
    const context = await refreshStoreContext(prisma);
    expect(context).toBeDefined();
    expect(context.generoMaisPopular).toBeDefined();
    expect(context.faixaEtariaPredominante).toBeDefined();
    expect(context.autorMaisLido).toBeDefined();
  });

  test('Should return fallback justification when Gemini API key is missing or invalid', async () => {
    const user = { idade: 30, sexo: 'M', cidade: 'São Paulo', pais: 'Brasil' };
    const book = { id: 999, nome: 'Livro de Teste', autor: 'Autor Falso', ano: 2020, genero: 'Ficção' };
    
    // Sem passar a chave do Gemini correta no mock ou ambiente
    const justification = await getJustification({
      userId: 1,
      user,
      book,
      score: 0.85,
      usingFallback: false
    });

    expect(justification).toContain('85% de compatibilidade');
  });

  test('Should return popularity fallback justification when usingFallback is true', async () => {
    const user = { idade: 30, sexo: 'M', cidade: 'São Paulo', pais: 'Brasil' };
    const book = { id: 999, nome: 'Livro de Teste', autor: 'Autor Falso', ano: 2020, genero: 'Ficção' };

    const justification = await getJustification({
      userId: 1,
      user,
      book,
      score: 0.85,
      usingFallback: true
    });

    expect(justification).toBe('Recomendado por ser um dos livros mais populares da loja.');
  });
});
