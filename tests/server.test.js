import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const request = require('supertest');
const app = require('../src/server.js');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('REST API Routes Tests - Step 3.1 & 3.2', () => {
  let testUser;
  let testBook;
  let testPurchase;

  beforeAll(async () => {
    // Garantir que temos pelo menos um usuário, um livro e uma compra de teste controlada
    testUser = await prisma.user.create({
      data: {
        nome: "Leitor de Teste API",
        idade: 28,
        sexo: "M",
        pais: "Brasil",
        cidade: "Belo Horizonte"
      }
    });

    testBook = await prisma.book.create({
      data: {
        isbn: "TESTAPI999",
        nome: "Livro de Teste da API",
        autor: "Autor da API",
        ano: 2022,
        genero: "Ficção"
      }
    });
  });

  afterAll(async () => {
    // Limpar os dados criados especificamente para o teste de API
    if (testPurchase) {
      await prisma.purchase.deleteMany({ where: { id: testPurchase.id } });
    }
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.book.delete({ where: { id: testBook.id } });
  });

  // ---- GET /api/users ----
  test('GET /api/users should return a list of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const hasTestUser = res.body.some(u => u.id === testUser.id);
    expect(hasTestUser).toBe(true);
  });

  // ---- POST /api/purchases ----
  test('POST /api/purchases should validate schema via zod', async () => {
    const res = await request(app)
      .post('/api/purchases')
      .send({ userId: "invalido", bookId: -5 });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/purchases should create purchase successfully', async () => {
    const res = await request(app)
      .post('/api/purchases')
      .send({ userId: testUser.id, bookId: testBook.id });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.userId).toBe(testUser.id);
    expect(res.body.bookId).toBe(testBook.id);
    
    testPurchase = res.body; // salvar para deletar depois
  });

  test('POST /api/purchases should reject duplicate purchases with 409', async () => {
    const res = await request(app)
      .post('/api/purchases')
      .send({ userId: testUser.id, bookId: testBook.id });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  // ---- GET /api/purchases/user/:userId ----
  test('GET /api/purchases/user/:userId should return purchases history', async () => {
    const res = await request(app).get(`/api/purchases/user/${testUser.id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].bookId).toBe(testBook.id);
    expect(res.body[0].nome).toBe(testBook.nome);
  });

  // ---- GET /api/recommendations/:userId ----
  test('GET /api/recommendations/:userId should return correct schema structure', async () => {
    const res = await request(app).get(`/api/recommendations/${testUser.id}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(testUser.id);
    expect(res.body.usingFallback).toBeDefined();
    expect(Array.isArray(res.body.books)).toBe(true);
    
    if (res.body.books.length > 0) {
      const rec = res.body.books[0];
      expect(rec.bookId).toBeDefined();
      expect(rec.nome).toBeDefined();
      expect(rec.scorePercent).toBeDefined();
      expect(rec.justificativa).toBeDefined();
    }
  });
 
  test('GET /api/recommendations/:userId should respect limit query param', async () => {
    const res = await request(app).get(`/api/recommendations/${testUser.id}?limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.books.length).toBeLessThanOrEqual(5);
  });

  test('GET /api/recommendations/:userId should 404 for unknown user', async () => {
    const res = await request(app).get('/api/recommendations/999999');
    expect(res.status).toBe(404);
  });

  // ---- GET /api/model/status ----
  test('GET /api/model/status should return current training status info', async () => {
    const res = await request(app).get('/api/model/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  // ---- POST /api/llm/refresh-context ----
  test('POST /api/llm/refresh-context should reject without correct admin token', async () => {
    process.env.ADMIN_TOKEN = "segredo_admin_123";
    const res = await request(app)
      .post('/api/llm/refresh-context');
    
    expect(res.status).toBe(403);
  });

  test('POST /api/llm/refresh-context should succeed with correct admin token', async () => {
    process.env.ADMIN_TOKEN = "segredo_admin_123";
    const res = await request(app)
      .post('/api/llm/refresh-context')
      .set('x-admin-token', 'segredo_admin_123');

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBeDefined();
    expect(res.body.context).toBeDefined();
    expect(res.body.context.generoMaisPopular).toBeDefined();
  });

  // ---- DELETE /api/purchases/:id ----
  test('DELETE /api/purchases/:id should delete purchase successfully', async () => {
    const res = await request(app).delete(`/api/purchases/${testPurchase.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.id).toBe(testPurchase.id);
  });
});
