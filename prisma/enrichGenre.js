const fs = require('fs');
const path = require('path');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');
const RAW_BOOKS_PATH = path.join(PROCESSED_DIR, 'books_raw.json');
const CACHE_PATH = path.join(PROCESSED_DIR, 'generos.json');
const FINAL_BOOKS_PATH = path.join(PROCESSED_DIR, 'books.json');

// Mapeamento de subjects do Open Library (em inglês) para nossos gêneros em português
function mapSubjectToGenre(subjects) {
  if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
    return 'Não classificado';
  }

  // Converter todos os subjects para minúsculo
  const subjectList = subjects.map(s => (typeof s === 'string' ? s : s.name || '').toLowerCase());

  // Mapeamentos específicos
  const rules = [
    {
      genre: 'Fantasia',
      keywords: ['fantasy', 'magic', 'sci-fi', 'science fiction', 'wizard', 'ghost', 'supernatural', 'paranormal', 'dystopian', 'vampire', 'horror']
    },
    {
      genre: 'Romance',
      keywords: ['romance', 'love', 'romantic', 'courtship', 'historical romance', 'relationship']
    },
    {
      genre: 'Infantojuvenil',
      keywords: ['juvenile', 'children', 'young adult', 'teen', 'school', 'kids', 'infantil', 'adolescente']
    },
    {
      genre: 'Biografia',
      keywords: ['biography', 'autobiography', 'memoir', 'biografia', 'diary', 'memoirs']
    },
    {
      genre: 'Não-ficção',
      keywords: ['nonfiction', 'non-fiction', 'history', 'science', 'religion', 'philosophy', 'politics', 'essay', 'self-help', 'psychology', 'travel', 'art', 'true crime']
    },
    {
      genre: 'Ficção',
      keywords: ['fiction', 'ficção', 'literature', 'suspense', 'thriller', 'mystery', 'detective', 'classic', 'gothic', 'adventure', 'drama']
    }
  ];

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (subjectList.some(subject => subject.includes(keyword))) {
        return rule.genre;
      }
    }
  }

  return 'Não classificado';
}

// Delay auxiliar para respeitar rate-limits
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  console.log('Iniciando enriquecimento de gêneros com Open Library API...');

  if (!fs.existsSync(RAW_BOOKS_PATH)) {
    console.error(`Erro: Arquivo ${RAW_BOOKS_PATH} não encontrado. Execute o filtro de dataset primeiro.`);
    process.exit(1);
  }

  const books = JSON.parse(fs.readFileSync(RAW_BOOKS_PATH, 'utf8'));
  console.log(`Carregados ${books.length} livros para processamento.`);

  // Carregar cache de gêneros
  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      console.log(`Cache de gêneros carregado com ${Object.keys(cache).length} itens.`);
    } catch (err) {
      console.warn('Erro ao ler cache, iniciando cache limpo.');
    }
  }

  let apiCallsCount = 0;
  const enrichedBooks = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const isbn = book.isbn;
    let genre = cache[isbn];

    if (genre) {
      // Usar valor do cache
      book.genero = genre;
    } else {
      // Buscar da API
      apiCallsCount++;
      console.log(`[${apiCallsCount}] Buscando gênero da Open Library para o ISBN: ${isbn} (${book.nome})...`);
      
      let successfullyFetched = false;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
          
          if (response.ok) {
            const data = await response.json();
            const bookKey = `ISBN:${isbn}`;
            const subjects = data[bookKey]?.subjects || [];
            
            genre = mapSubjectToGenre(subjects);
            successfullyFetched = true;
            break; // Succeeded, exit retry loop
          } else {
            console.warn(`[Tentativa ${attempt}/${maxRetries}] Erro de resposta da API para o ISBN ${isbn}: Status ${response.status}`);
            genre = 'Não classificado';
            successfullyFetched = true; // API replied, so it's a valid result to cache
            break;
          }
        } catch (error) {
          console.error(`[Tentativa ${attempt}/${maxRetries}] Falha de conexão ao buscar ISBN ${isbn}:`, error.message);
          if (attempt < maxRetries) {
            console.log(`Aguardando 1.5s antes de tentar novamente...`);
            await delay(1500);
          } else {
            genre = 'Não classificado';
            successfullyFetched = false;
          }
        }
      }

      // Adicionar ao cache e salvar periodicamente se a requisição foi bem-sucedida
      if (successfullyFetched) {
        cache[isbn] = genre;
      }
      book.genero = genre;

      // Salvar cache a cada 10 requisições
      if (apiCallsCount % 10 === 0) {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
        console.log(`Cache salvo temporariamente (${apiCallsCount} requisições feitas).`);
      }

      // Pequena pausa de 50ms para evitar sobrecarga da API
      await delay(50);
    }

    enrichedBooks.push(book);
  }

  // Gravar cache final e arquivo consolidado de livros
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  fs.writeFileSync(FINAL_BOOKS_PATH, JSON.stringify(enrichedBooks, null, 2));

  console.log('Enriquecimento de gêneros concluído com sucesso!');
  console.log(`Total de chamadas feitas à API: ${apiCallsCount}`);
  console.log(`Livros salvos com gêneros em ${FINAL_BOOKS_PATH}`);
}

// Exportar helper de mapeamento para os testes
module.exports = {
  mapSubjectToGenre,
  run
};

if (require.main === module && !process.env.VITEST) {
  run().catch(console.error);
}
