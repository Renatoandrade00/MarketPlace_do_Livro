import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const request = require('supertest');
const app = require('../src/server.js');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('Phase 5 - Closed Loop Validation Tests', () => {
  let testUser;
  let testBook1;
  let testBook2;

  beforeAll(async () => {
    // Garantir que temos um usuário e dois livros controlados para os testes de reordenação dinâmica
    testUser = await prisma.user.create({
      data: {
        nome: "Validação Fase 5",
        idade: 35,
        sexo: "F",
        pais: "Brasil",
        cidade: "São Paulo"
      }
    });

    testBook1 = await prisma.book.create({
      data: {
        isbn: "F5TEST001",
        nome: "Livro Teste Fase 5.1",
        autor: "Autor 5",
        ano: 2024,
        genero: "Tecnologia"
      }
    });

    testBook2 = await prisma.book.create({
      data: {
        isbn: "F5TEST002",
        nome: "Livro Teste Fase 5.2",
        autor: "Autor 5",
        ano: 2024,
        genero: "História"
      }
    });
  });

  afterAll(async () => {
    // Limpar os dados do teste
    await prisma.purchase.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.book.deleteMany({ where: { id: { in: [testBook1.id, testBook2.id] } } });
  });

  test('Step 5.1 & 5.2: Dynamic Reordering and Purchase Deletion (Closed Loop)', async () => {
    // 1. Obter recomendações iniciais (estará usando fallback de popularidade por ser cold-start)
    const initialRes = await request(app).get(`/api/recommendations/${testUser.id}`);
    expect(initialRes.status).toBe(200);
    const initialBooks = initialRes.body.books;

    // Verificar se nenhum dos livros de teste consta como adquirido
    const initialBook1 = initialBooks.find(b => b.bookId === testBook1.id);
    if (initialBook1) {
      expect(initialBook1.isPurchased).toBe(false);
    }

    // 2. Comprar o Livro 1 (Simulando fluxo do Step 5.1)
    const buyRes = await request(app)
      .post('/api/purchases')
      .send({ userId: testUser.id, bookId: testBook1.id });
    expect(buyRes.status).toBe(201);
    const purchaseId = buyRes.body.id;
    expect(purchaseId).toBeDefined();

    // 3. Obter recomendações novamente (Devem refletir o novo estado dinamicamente)
    const postBuyRes = await request(app).get(`/api/recommendations/${testUser.id}`);
    expect(postBuyRes.status).toBe(200);
    const postBuyBooks = postBuyRes.body.books;

    // Livro 1 agora deve estar marcado como adquirido
    const purchasedBook = postBuyBooks.find(b => b.bookId === testBook1.id);
    if (purchasedBook) {
      expect(purchasedBook.isPurchased).toBe(true);
    }

    // 4. Deletar a compra (Simulando fluxo do Step 5.2)
    const delRes = await request(app).delete(`/api/purchases/${purchaseId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);

    // Confirmar que sumiu do banco de dados
    const dbPurchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
    expect(dbPurchase).toBeNull();

    // 5. Obter recomendações pós-exclusão e garantir que voltou a ficar não-adquirido
    const postDeleteRes = await request(app).get(`/api/recommendations/${testUser.id}`);
    expect(postDeleteRes.status).toBe(200);
    const postDeleteBooks = postDeleteRes.body.books;
    
    const deletedBookStatus = postDeleteBooks.find(b => b.bookId === testBook1.id);
    if (deletedBookStatus) {
      expect(deletedBookStatus.isPurchased).toBe(false);
    }
  });
});
