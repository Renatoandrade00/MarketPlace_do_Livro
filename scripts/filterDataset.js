const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

// Default configurations
const MIN_RATINGS_PER_BOOK = 15;
const MAX_BOOKS = 350;
const MIN_RATINGS_PER_USER = 5;
const MAX_USERS = 250;
const DEFAULT_AGE = 35;

// Helper function to parse CSV stream
function parseCSV(filename, onRow) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path.join(RAW_DIR, filename), { encoding: 'latin1' })
      .pipe(csv({ separator: ';' }))
      .on('data', onRow)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function run() {
  console.log('Iniciando filtragem do Book-Crossing Dataset...');

  // Step 1: Contar avaliações por livro (ISBN)
  console.log('Passo 1: Contando avaliações por livro...');
  const ratingsPerBook = {};
  await parseCSV('BX-Book-Ratings.csv', (row) => {
    const isbn = row['ISBN'];
    if (isbn) {
      ratingsPerBook[isbn] = (ratingsPerBook[isbn] || 0) + 1;
    }
  });

  // Step 2: Selecionar os livros com pelo menos 15 avaliações, ordenar e pegar o top 350
  console.log('Passo 2: Selecionando o top dos livros...');
  const eligibleBooks = Object.keys(ratingsPerBook)
    .filter(isbn => ratingsPerBook[isbn] >= MIN_RATINGS_PER_BOOK)
    .map(isbn => ({ isbn, count: ratingsPerBook[isbn] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_BOOKS);

  const eligibleBookIsbns = new Set(eligibleBooks.map(b => b.isbn));
  console.log(`Livros qualificados selecionados: ${eligibleBookIsbns.size}`);

  // Step 3: Contar avaliações desses livros por usuário
  console.log('Passo 3: Contando avaliações qualificadas por usuário...');
  const ratingsPerUser = {};
  await parseCSV('BX-Book-Ratings.csv', (row) => {
    const userId = row['User-ID'];
    const isbn = row['ISBN'];
    if (userId && eligibleBookIsbns.has(isbn)) {
      ratingsPerUser[userId] = (ratingsPerUser[userId] || 0) + 1;
    }
  });

  // Step 4: Selecionar usuários com pelo menos 5 avaliações qualificadas e pegar o top 250
  console.log('Passo 4: Selecionando o top de usuários...');
  const eligibleUsers = Object.keys(ratingsPerUser)
    .filter(userId => ratingsPerUser[userId] >= MIN_RATINGS_PER_USER)
    .map(userId => ({ userId, count: ratingsPerUser[userId] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_USERS);

  const eligibleUserIds = new Set(eligibleUsers.map(u => u.userId));
  console.log(`Usuários qualificados selecionados: ${eligibleUserIds.size}`);

  // Step 5: Filtrar e coletar as interações (compras) correspondentes
  console.log('Passo 5: Coletando compras qualificadas...');
  const purchases = [];
  await parseCSV('BX-Book-Ratings.csv', (row) => {
    const userId = row['User-ID'];
    const isbn = row['ISBN'];
    if (eligibleUserIds.has(userId) && eligibleBookIsbns.has(isbn)) {
      purchases.push({
        userId: parseInt(userId, 10),
        isbn
      });
    }
  });
  console.log(`Total de compras (interações) qualificadas: ${purchases.length}`);

  // Step 6: Ler detalhes dos usuários (BX-Users.csv)
  console.log('Passo 6: Coletando detalhes de usuários...');
  const users = {};
  // Gerador de nomes fictícios para e-commerce didático
  let nameCounter = 1;

  await parseCSV('BX-Users.csv', (row) => {
    const userId = row['User-ID'];
    if (eligibleUserIds.has(userId)) {
      const location = row['Location'] || '';
      const parts = location.split(',').map(p => p.trim());
      const cidade = parts[0] || 'Desconhecida';
      const pais = parts[parts.length - 1] || 'Desconhecido';
      
      let idade = parseInt(row['Age'], 10);
      if (isNaN(idade) || idade <= 0 || idade > 120) {
        idade = DEFAULT_AGE;
      }

      users[userId] = {
        id: parseInt(userId, 10),
        nome: `Leitor ${nameCounter++}`,
        idade,
        sexo: nameCounter % 2 === 0 ? 'F' : 'M', // alternância para fins de seed
        pais,
        cidade
      };
    }
  });

  // Step 7: Ler detalhes dos livros (BX-Books.csv)
  console.log('Passo 7: Coletando detalhes de livros...');
  const books = {};
  await parseCSV('BX-Books.csv', (row) => {
    const isbn = row['ISBN'];
    if (eligibleBookIsbns.has(isbn)) {
      let ano = parseInt(row['Year-Of-Publication'], 10);
      if (isNaN(ano) || ano <= 0 || ano > 2026) {
        ano = 2000; // fallback padrão
      }

      books[isbn] = {
        isbn,
        nome: row['Book-Title'] || 'Título Indisponível',
        autor: row['Book-Author'] || 'Autor Desconhecido',
        ano,
        genero: 'Não classificado' // O gênero será enriquecido no Step 1.4
      };
    }
  });

  // Garantir que não criamos compras de livros ou usuários que não existam no CSV de detalhes
  // (Caso haja inconsistência referencial nos dados originais do Book-Crossing)
  const validPurchases = purchases.filter(p => users[p.userId] && books[p.isbn]);

  // Escrever arquivos processados em JSON
  console.log('Passo 8: Escrevendo arquivos JSON de saída...');
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  // Filtrar usuários e livros que realmente possuem relações de compras válidas
  const finalUsers = Object.values(users).filter(u => validPurchases.some(p => p.userId === u.id));
  const finalBooks = Object.values(books).filter(b => validPurchases.some(p => p.isbn === b.isbn));

  // Ajustar purchases para usar o id sequencial/correto após filtros
  const finalPurchases = validPurchases.filter(p => 
    finalUsers.some(u => u.id === p.userId) && finalBooks.some(b => b.isbn === p.isbn)
  );

  fs.writeFileSync(path.join(PROCESSED_DIR, 'users_raw.json'), JSON.stringify(finalUsers, null, 2));
  fs.writeFileSync(path.join(PROCESSED_DIR, 'books_raw.json'), JSON.stringify(finalBooks, null, 2));
  fs.writeFileSync(path.join(PROCESSED_DIR, 'purchases_raw.json'), JSON.stringify(finalPurchases, null, 2));

  console.log('Filtragem concluída com sucesso!');
  console.log(`Usuários salvos: ${finalUsers.length}`);
  console.log(`Livros salvos: ${finalBooks.length}`);
  console.log(`Compras salvas: ${finalPurchases.length}`);
}

run().catch(console.error);
