const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

async function main() {
  console.log('Iniciando limpeza e populamento do banco de dados (Seed)...');

  // 1. Limpar tabelas na ordem correta para preservar chaves estrangeiras
  console.log('Limpando dados antigos...');
  await prisma.purchase.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.book.deleteMany({});

  // 2. Carregar dados processados
  console.log('Carregando arquivos JSON processados...');
  const usersRaw = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'users_raw.json'), 'utf8'));
  const booksRaw = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'books.json'), 'utf8'));
  const purchasesRaw = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, 'purchases_raw.json'), 'utf8'));

  // 3. Inserir Usuários
  console.log(`Inserindo ${usersRaw.length} usuários...`);
  await prisma.user.createMany({
    data: usersRaw
  });

  // 4. Inserir Livros
  console.log(`Inserindo ${booksRaw.length} livros...`);
  await prisma.book.createMany({
    data: booksRaw
  });

  // 5. Obter IDs reais gerados para os livros via ISBN
  console.log('Mapeando ISBNs de livros para IDs do banco...');
  const dbBooks = await prisma.book.findMany({
    select: {
      id: true,
      isbn: true
    }
  });

  const isbnToIdMap = {};
  for (const book of dbBooks) {
    isbnToIdMap[book.isbn] = book.id;
  }

  // 6. Preparar e inserir Compras
  console.log('Preparando e limpando registros de compras...');
  const purchaseDataMap = new Map();

  for (const purchase of purchasesRaw) {
    const bookId = isbnToIdMap[purchase.isbn];
    if (!bookId) continue;

    // Chave única para evitar duplicidades no array antes de inserir
    const uniqueKey = `${purchase.userId}_${bookId}`;
    purchaseDataMap.set(uniqueKey, {
      userId: purchase.userId,
      bookId: bookId
    });
  }

  const purchaseData = Array.from(purchaseDataMap.values());
  console.log(`Inserindo ${purchaseData.length} compras...`);

  await prisma.purchase.createMany({
    data: purchaseData
  });

  console.log('Banco de dados populado com sucesso (Seed concluído)!');
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('Erro durante a execução do seed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = main;
