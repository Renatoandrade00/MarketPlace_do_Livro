const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.join(__dirname, '../data/processed');
const RAW_BOOKS_PATH = path.join(PROCESSED_DIR, 'books_raw.json');
const CACHE_PATH = path.join(PROCESSED_DIR, 'generos.json');

function guessGenre(title, author) {
  const t = title.toLowerCase();
  const a = author.toLowerCase();

  // Fantasy / Sci-Fi
  if (
    t.includes('harry potter') ||
    t.includes('hobbit') ||
    t.includes('lord of the rings') ||
    t.includes('two towers') ||
    t.includes('return of the king') ||
    t.includes('fellowship') ||
    t.includes('dragon') ||
    t.includes('wicked') ||
    t.includes('magic') ||
    t.includes('ghost') ||
    t.includes('vampire') ||
    t.includes('jurassic park') ||
    t.includes('lost world') ||
    t.includes('alienist') ||
    t.includes('stand') ||
    t.includes('dreamcatcher') ||
    t.includes('timeline') ||
    t.includes('sphere') ||
    t.includes('mists of avalon') ||
    t.includes('elfstones') ||
    t.includes('shannara') ||
    t.includes('golden compass') ||
    t.includes('subtle knife') ||
    t.includes('dead zone') ||
    t.includes('regulators') ||
    t.includes('dark tower') ||
    t.includes('gunslinger') ||
    t.includes('artemis fowl') ||
    t.includes('wrinkle in time')
  ) {
    return 'Fantasia';
  }

  // Biography / Memoir
  if (
    t.includes('biography') ||
    t.includes('autobiography') ||
    t.includes('memoir') ||
    t.includes('diary') ||
    t.includes("liars' club") ||
    t.includes('tuesdays with morrie') ||
    t.includes("angela's ashes") ||
    t.includes('lucky : a memoir') ||
    t.includes('wild animus')
  ) {
    return 'Biografia';
  }

  // Romance
  if (
    t.includes('romance') ||
    t.includes('love') ||
    t.includes('romantic') ||
    t.includes('notebook') ||
    t.includes('wedding') ||
    t.includes('heart') ||
    t.includes('rescue') ||
    t.includes('walk to remember') ||
    t.includes('bend in the road') ||
    t.includes('message in a bottle') ||
    t.includes('sweetheart') ||
    t.includes('circle of friends') ||
    t.includes('evening class') ||
    t.includes('jewels of the sun') ||
    t.includes('key of light')
  ) {
    return 'Romance';
  }

  // Kids / Teen / Young Adult
  if (
    t.includes('juvenile') ||
    t.includes('children') ||
    t.includes('young adult') ||
    t.includes('teen') ||
    t.includes('school') ||
    t.includes('kids') ||
    t.includes('bad beginning') ||
    t.includes('nanny diaries') ||
    t.includes('four to score') ||
    t.includes('one for the money') ||
    t.includes('three to get deadly') ||
    t.includes('hard eight') ||
    t.includes('hot six') ||
    t.includes('seven up') ||
    t.includes('2nd chance')
  ) {
    return 'Infantojuvenil';
  }

  // Non-fiction / History / Science
  if (
    t.includes('nonfiction') ||
    t.includes('non-fiction') ||
    t.includes('history') ||
    t.includes('science') ||
    t.includes('religion') ||
    t.includes('philosophy') ||
    t.includes('politics') ||
    t.includes('essay') ||
    t.includes('self-help') ||
    t.includes('psychology') ||
    t.includes('fast food nation') ||
    t.includes('stupid white men') ||
    t.includes('nickel and dimed') ||
    t.includes('sophie\'s world') ||
    t.includes('under the tuscan sun') ||
    t.includes('in cold blood') ||
    t.includes('zen and the art')
  ) {
    return 'Não-ficção';
  }

  // Fiction / Suspense (default for novels)
  return 'Ficção';
}

function run() {
  console.log('Gerando cache de gêneros fictícios/locais de alta qualidade...');

  if (!fs.existsSync(RAW_BOOKS_PATH)) {
    console.error('Erro: books_raw.json não encontrado. Execute o filtro de dataset primeiro.');
    process.exit(1);
  }

  const books = JSON.parse(fs.readFileSync(RAW_BOOKS_PATH, 'utf8'));
  const cache = {};

  for (const book of books) {
    cache[book.isbn] = guessGenre(book.nome, book.autor);
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`Cache gerado com sucesso em ${CACHE_PATH}. Total de itens: ${Object.keys(cache).length}`);
}

run();
