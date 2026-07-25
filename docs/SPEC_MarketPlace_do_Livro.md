# SPEC Técnico — MarketPlace do Livro

## 0. Sobre este documento

O **PRD** define o quê e por quê (fases, decisões de arquitetura, riscos). Este **SPEC** define exatamente **como**: schemas de dados, contratos de API (request/response byte a byte), arquitetura numérica do modelo, prompts do LLM e algoritmos de treinamento. A ideia é que o agente do Antigravity (or qualquer dev) consiga implementar cada peça sem precisar tomar decisões de projeto por conta própria — as decisões já estão tomadas aqui, com a justificativa ao lado.

Onde há um número "mágico" (dimensão de embedding, taxa de aprendizado, proporção de negative sampling), ele foi escolhido como um ponto de partida razoável para o tamanho do dataset filtrado (~200-300 usuários, ~300-400 livros). Ajustes finos ficam livres, mas comece por aqui.

---

## 1. Modelo de Dados (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int        @id @default(autoincrement())
  nome      String
  idade     Int
  sexo      String     // "M" | "F" | "Outro"
  pais      String
  cidade    String
  purchases Purchase[]
}

model Book {
  id        Int        @id @default(autoincrement())
  isbn      String?    @unique
  nome      String
  autor     String
  ano       Int
  genero    String
  purchases Purchase[]
}

model Purchase {
  id        Int      @id @default(autoincrement())
  userId    Int
  bookId    Int
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  book      Book     @relation(fields: [bookId], references: [id])

  @@unique([userId, bookId]) // um usuário não "compra" o mesmo livro duas vezes
}
```

> A restrição `@@unique([userId, bookId])` existe para manter os dados de interação limpos (1 par = 1 sinal positivo). O endpoint `POST /api/purchases` deve tratar a violação dessa constraint como erro `409`, não `500`.

> ⚠️ **Sobre queries raw:** nenhuma rota deste projeto deve usar `$queryRawUnsafe`. Se alguma necessidade futura exigir SQL raw, usar exclusivamente `$queryRaw` do Prisma com template literals parametrizados — nunca concatenação de string. Todas as rotas do contrato (seção 5) usam apenas o Prisma Client normal, que já parametriza as queries por padrão.

---

## 2. Pré-processamento: Vocabulários e Normalização

O encoder (`src/ai/encoder.js`) depende de dois artefatos, **recalculados a partir do banco a cada treinamento** (nunca hardcoded, para não desalinhar do dataset real):

### 2.1 `vocab` (em memória, `{ cidades, generos, userIndex, bookIndex }`)

```json
{
  "cidades": ["São Paulo", "Rio de Janeiro", "Curitiba", "..."],
  "generos": ["Ficção", "Romance", "Fantasia", "Biografia", "Infantojuvenil", "Não-ficção", "Não classificado"],
  "userIndex": { "1": 0, "2": 1, "7": 2 },
  "bookIndex": { "3": 0, "9": 1, "14": 2 }
}
```

* `cidades` e `generos`: lista de valores distintos vistos no momento do treino, sempre com um slot extra implícito `"Outra"/"Outro"` (índice reservado) para valores não vistos depois do treino.
* `userIndex` / `bookIndex`: mapeiam o `id` do Prisma para um índice denso (0, 1, 2, ...) usado nas camadas de *embedding*. **Usuários e livros criados depois do último treino não têm índice** — nesse caso o backend usa o fallback de popularidade (seção 5.2) até o próximo retreino.

### 2.2 `normStats`

```json
{ "idadeMin": 12, "idadeMax": 78, "anoMin": 1950, "anoMax": 2023 }
```

Usado para normalização min-max: `valor_norm = (valor - min) / (max - min)`.

### 2.3 Funções do `encoder.js`

```js
function buildVocab(users, books) { /* -> vocab acima */ }
function computeNormStats(users, books) { /* -> normStats acima */ }
function encodeUser(user, vocab, normStats) {
  // retorna array de floats:
  // [idade_norm] + onehot(sexo, 3) + onehot(cidade, vocab.cidades.length + 1)
}
function encodeBook(book, vocab, normStats) {
  // [ano_norm] + onehot(genero, vocab.generos.length + 1)
}
```

`onehot(valor, tamanho)`: se `valor` não estiver no vocabulário, cai no último slot ("Outro/Outra").

---

## 3. Arquitetura do Modelo Two-Tower

| Componente | Entrada | Camadas | Saída |
|---|---|---|---|
| **User Tower** | `userEmbedding(16)` + `idade_norm(1)` + `sexo_onehot(3)` + `cidade_onehot(≈N+1)` | `Dense(32, relu)` → `Dense(16, relu)` | vetor de usuário (16) |
| **Item Tower** | `bookEmbedding(16)` + `ano_norm(1)` + `genero_onehot(8)` | `Dense(32, relu)` → `Dense(16, relu)` | vetor de item (16) |
| **Camada de Fusão** | `concat(userVector, itemVector)` (32) | `Dense(16, relu)` → `Dense(1, sigmoid)` | score (0.0–1.0) |

* **Dimensão de embedding = 16** para `userId`/`bookId`: pequena o suficiente pra não sobre-ajustar em ~200-300 usuários/livros, grande o suficiente pra capturar sinal de filtragem colaborativa.
* `src/ai/recommendationModel.js` deve expor:

```js
function buildModel({ numUsers, numBooks, userFeatureDim, itemFeatureDim }) { /* -> tf.LayersModel */ }
function saveModel(model, path = 'data/model') { /* model.save('file://' + path) */ }
async function loadModel(path = 'data/model') { /* retorna null se não existir, não lança erro */ }
function predict(model, userInput, itemInput) { /* -> number 0-1 */ }
```

---

## 4. Pipeline de Treinamento

### 4.1 Negative Sampling (obrigatório)

Para cada par positivo `(userId, bookId)` em `Purchase`, gerar **k = 4** pares negativos: `(userId, bookId_aleatorio)` onde `bookId_aleatorio` não está entre as compras desse usuário. Rótulo `1` para positivos, `0` para negativos. Sem isso o modelo aprende a solução trivial (score sempre ≈1) — **não é opcional**.

### 4.2 Split e Hiperparâmetros

| Parâmetro | Valor |
|---|---|
| Split treino/validação | 80% / 20% (aleatório, com seed fixa para reprodutibilidade) |
| Batch size | 32 |
| Épocas (máx.) | 30 |
| Early stopping | `patience = 3` sobre `val_loss` |
| Otimizador | Adam, `learningRate = 0.001` |
| Loss | Binary Crossentropy |
| Métrica | Accuracy |

### 4.3 Quando o treinamento roda

* **No boot do servidor** (`server.js`), se não houver modelo salvo em disco válido — **e sempre em produção**, já que o disco do Render é efêmero e o modelo salvo não sobrevive a um redeploy/restart. Como o dataset filtrado é pequeno, um treinamento completo leva poucos segundos a poucos minutos em CPU: rodar no boot é uma solução simples e correta, sem precisar de blob storage ou serviço externo.
* **Sob demanda**, via `POST /api/model/train` (ver seção 5), para retreinar depois de novas compras acumuladas, sem reiniciar o servidor.
* **Nunca** a cada `POST /api/purchases` individual — isso dispara apenas re-inferência (seção 5.2), não retreino.

### 4.4 Concorrência

Manter uma flag em memória `isTraining: boolean`. Se uma segunda chamada de treino chegar enquanto `isTraining === true`, responder `409` imediatamente. O treinamento é uma operação pesada de CPU que ocupa o event loop do Node durante sua execução — aceitável aqui por ser uma ação administrativa pouco frequente, não uma rota de uso comum. (Melhoria futura fora de escopo: mover para `worker_threads`.)

### 4.4.1 Proteção contra abuso (rotas administrativas)

`POST /api/model/train` e `POST /api/llm/refresh-context` não exigem autenticação (decisão de escopo, ver seção 10). Como o projeto é público (deploy no Render) e não há login, essas duas rotas ficam expostas a qualquer um que descubra a URL — a primeira dispara uma operação cara de CPU, a segunda consome cota do Groq indiretamente ao alimentar prompts futuros. Mitigação obrigatória:

* `express-rate-limit` aplicado especificamente a essas duas rotas (ex.: 1 requisição/minuto por IP).
* Opcionalmente, um header simples `x-admin-token` comparado à env var `ADMIN_TOKEN` — suficiente para o escopo didático, sem exigir um sistema de autenticação completo.

---

## 5. Contrato da API REST

Todas as respostas de erro seguem o formato: `{ "error": "mensagem legível" }`.

> ⚠️ **Validação de entrada:** como o projeto é JavaScript puro (sem TypeScript), a checagem de tipo só existe se for feita em runtime. Toda rota que recebe `body` ou `params` deve validá-los com **`zod`** antes de tocar o Prisma, retornando `400` no formato de erro acima em caso de falha — inclusive coerção explícita de `userId`/`bookId` vindos como string do JSON/URL para `number`. Isso vale em particular para `POST /api/purchases` (seção 5.3) e para os `:userId`/`:id` usados como parâmetro de rota em várias das rotas abaixo.

### 5.1 `GET /api/users`
**200 OK**
```json
[
  { "id": 1, "nome": "Maria Silva", "idade": 34, "sexo": "F", "pais": "Brasil", "cidade": "São Paulo" }
]
```

### 5.2 `GET /api/recommendations/:userId`
Roda inferência (`model.predict`) para todos os livros e ordena por score decrescente.

**200 OK**
```json
{
  "userId": 3,
  "generatedAt": "2026-07-22T14:00:00.000Z",
  "usingFallback": false,
  "books": [
    {
      "bookId": 12,
      "nome": "O Nome do Vento",
      "autor": "Patrick Rothfuss",
      "ano": 2007,
      "genero": "Fantasia",
      "score": 0.87,
      "scorePercent": 87,
      "isPurchased": false,
      "justificativa": "Como você costuma ler fantasia, este título tem grande chance de agradar."
    }
  ]
}
```

`usingFallback: true` (ordenação por popularidade, `score` = `contagemDeCompras / maiorContagem`) quando: o modelo ainda não foi treinado, o usuário tem zero compras (cold start), **ou** o `userId` não está em `vocab.userIndex` (criado depois do último treino).

Erros: `404` se `userId` não existir.

### 5.3 `POST /api/purchases`
**Body:** `{ "userId": 3, "bookId": 12 }`

> Validar com `zod` (`z.object({ userId: z.coerce.number().int().positive(), bookId: z.coerce.number().int().positive() })`) antes de qualquer chamada ao Prisma — retornar `400` no formato de erro padrão em caso de falha de schema.

**201 Created**
```json
{ "id": 45, "userId": 3, "bookId": 12, "createdAt": "2026-07-22T14:05:00.000Z" }
```
Erros: `400` (campos faltando) · `404` (usuário ou livro inexistente) · `409` (compra duplicada, mesma constraint da seção 1).

> Não dispara retreino. O frontend deve re-chamar `GET /api/recommendations/:userId` logo em seguida para exibir os scores atualizados (re-cálculo sob demanda / *lazy*, sem WebSocket nem job em background).

### 5.4 `DELETE /api/purchases/:id`
**200 OK:** `{ "deleted": true, "id": 45 }` · Erros: `404`.

### 5.5 `GET /api/purchases/user/:userId`
Histórico de compras do cliente (para o painel da Fase 4.3), já com dados do livro.
**200 OK**
```json
[
  { "purchaseId": 45, "bookId": 12, "nome": "O Nome do Vento", "autor": "Patrick Rothfuss", "createdAt": "2026-07-22T14:05:00.000Z" }
]
```

### 5.6 `POST /api/model/train`
**202 Accepted:** `{ "status": "training_started", "startedAt": "2026-07-22T14:10:00.000Z" }`
`409` se já houver um treino em andamento (seção 4.4).

### 5.7 `GET /api/model/status`
```json
{ "status": "idle", "lastTrainedAt": "2026-07-22T14:12:03.000Z", "metrics": { "loss": 0.21, "valLoss": 0.29, "epochs": 18 } }
```
`status` ∈ `"idle" | "training" | "never_trained"`.

### 5.8 `POST /api/llm/refresh-context`
Recalcula estatísticas agregadas (não é fine-tuning — ver PRD seção 3.3).
**200 OK**
```json
{
  "updatedAt": "2026-07-22T14:15:00.000Z",
  "context": { "generoMaisPopular": "Fantasia", "faixaEtariaPredominante": "25-34", "autorMaisLido": "J.K. Rowling" }
}
```

---

## 6. Especificação do Módulo LLM (`src/services/llmService.js`)

### 6.1 Cliente

```js
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
```
Modelo: variável de ambiente `GROQ_MODEL` (default sugerido `openai/gpt-oss-20b`; confirme disponibilidade em `console.groq.com/docs/models` antes de fixar). `temperature: 0.7`, `max_tokens: 100`.

### 6.2 Prompt

**System:**
```
Você é um assistente de recomendação de livros. Gere uma justificativa curta (1 a 2 frases),
amigável e em português, explicando por que um livro foi recomendado a um cliente, com base no
perfil dele e no score calculado por um modelo de IA. Não invente informações que não estejam
nos dados fornecidos.
```

**User (template dinâmico):**
```
Perfil do cliente: {idade} anos, {sexo}, mora em {cidade}, {pais}.
Livro: "{nome}" de {autor} ({ano}), gênero {genero}.
Score de interesse calculado pela IA: {scorePercent}%.
Contexto da loja: gênero mais popular é {generoMaisPopular}; faixa etária predominante é {faixaEtariaPredominante}.
Gere a justificativa.
```

> ⚠️ **Sanitização antes de interpolar no prompt:** `nome`, `autor` e `cidade` vêm do Book-Crossing (dado de terceiro, não digitado por um usuário final em tempo real), mas podem conter caracteres inesperados. Antes de montar o template, remover quebras de linha (`\n`/`\r`) desses campos — evita que um valor malformado do dataset seja interpretado como uma tentativa de sobrescrever as instruções do system prompt.

### 6.3 Cache

Chave: `` `${userId}-${bookId}-${Math.round(score * 20)}` `` (arredonda o score em passos de 5% para não estourar o cache a cada micro-variação). Armazenar em um `Map` em memória (`{ chave: { texto, geradoEm } }`) — suficiente para o volume de uma demo; não precisa persistir em banco.

### 6.4 Fallback (sem chamar a API)

Usado quando a chamada ao Groq falhar (erro de rede, `429`, timeout):
```
"Este livro tem {scorePercent}% de compatibilidade com o seu perfil, com base no seu histórico de compras."
```
E, quando `usingFallback` (seção 5.2) for `true` por popularidade:
```
"Recomendado por ser um dos livros mais populares da loja."
```

---

## 7. Especificação do Frontend (`public/app.js`)

### 7.1 Estado (objeto único em memória, sem framework)

```js
const state = {
  currentUserId: null,
  users: [],
  recommendations: [],   // resultado de GET /api/recommendations/:userId
  purchaseHistory: [],   // resultado de GET /api/purchases/user/:userId
  loading: false,
  error: null,
};
```

### 7.2 Funções principais

| Função | Dispara | Efeito |
|---|---|---|
| `loadUsers()` | ao carregar a página | popula o dropdown |
| `selectUser(userId)` | usuário escolhe no dropdown | seta `currentUserId`, chama `loadRecommendations` e `loadHistory` |
| `loadRecommendations(userId)` | após `selectUser`, compra ou exclusão | `GET /api/recommendations/:userId`, re-renderiza o grid |
| `loadHistory(userId)` | idem | `GET /api/purchases/user/:userId` |
| `buyBook(bookId)` | clique em "Comprar" | `POST /api/purchases` → em sucesso, chama `loadRecommendations` + `loadHistory` |
| `deletePurchase(purchaseId)` | clique em "Excluir" | `DELETE /api/purchases/:id` → idem |
| `refreshLlmContext()` | clique em "Atualizar Contexto" | `POST /api/llm/refresh-context` |

### 7.3 Tratamento de erro/latência na UI

* Exibir um estado de *loading* explícito durante qualquer `fetch` (o Render free tier pode levar 30-60s para "acordar" na primeira requisição — sem isso, a UI parece travada).
* Se `usingFallback === true` na resposta de recomendações, exibir um aviso discreto ("recomendações baseadas em popularidade — ainda sem histórico suficiente") em vez de esconder a informação.

### 7.4 Sanitização de saída no DOM

Todo dado renderizado no grid de livros (`nome`, `autor`, `genero` e, especialmente, a `justificativa` gerada pela LLM) deve ser inserido no DOM via `textContent` — nunca via `innerHTML` com concatenação de string. Isso é particularmente relevante para `justificativa`, por se tratar de texto gerado dinamicamente por um modelo de linguagem.

---

## 8. Testes Automatizados e Estratégia de Teste Progressivo

### 8.1 Estratégia de Teste Progressivo/Cumulativo
Para garantir a estabilidade do sistema e evitar regressões, o arnês de testes automatizados deve ser executado e expandido de forma cumulativa em cada etapa de implementação:
* **Fim do Step 1.1:** Executar testes de sanidade/inicialização (`tests/sanity.test.js`).
* **Fim do Step 1.2:** Executar testes do banco de dados (Prisma/SQLite) cumulativamente com os testes do Step 1.1.
* **Fim do Step 1.3:** Executar testes do script de seed e enriquecimento + testes do 1.1 e 1.2.
* **Fim de cada Step subsequente:** A suíte de testes deve rodar a totalidade dos testes das etapas anteriores mais os novos testes da etapa atual. Qualquer quebra em etapas passadas invalida a conclusão da tarefa atual.

### 8.2 Estrutura Concreta de Testes
```
tests/
├── sanity.test.js          // Step 1.1: Valida inicialização, imports de bibliotecas críticas e variáveis
├── encoder.test.js         // Step 2.1: onehot() cai no slot "Outro" para valor desconhecido; normalização
├── purchases.route.test.js // Step 3.1: POST cria, DELETE remove, 409 em compra duplicada, 404 em usuário inexistente
└── llmService.test.js      // Step 3.2: fallback é usado quando o client do Groq lança erro (mockado)
```
Banco de teste: SQLite em arquivo separado (`file:./test.db`), recriado a cada execução via `prisma migrate reset --force` no `beforeAll`.


---

## 9. Variáveis de Ambiente

| Variável | Uso | Obrigatória em |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` (dev) ou string de conexão Turso (prod) | sempre |
| `GROQ_API_KEY` | autenticação no Groq | sempre |
| `GROQ_MODEL` | nome do modelo Groq (ver 6.1) | sempre |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | driver adapter libSQL | produção (Render) |
| `PORT` | porta do Express | sempre (default 3000) |

> ⚠️ O servidor deve validar todas as variáveis obrigatórias no boot (`server.js`) e encerrar com uma mensagem de erro clara (`process.exit(1)`) se alguma estiver ausente, em vez de falhar silenciosamente na primeira chamada que a usar. Nenhum log deve imprimir `process.env` inteiro nem o corpo bruto de erros do SDK do Groq sem antes remover dados de autenticação.

---

## 10. Convenções Gerais

* Todas as rotas ficam sob o prefixo `/api`.
* Datas sempre em ISO 8601 (`new Date().toISOString()`).
* IDs numéricos (auto-increment do Prisma), nunca UUID — mantém o schema simples pro escopo didático.
* Nenhuma rota exige autenticação (fora do escopo do projeto) — o "cliente selecionado" no dropdown substitui login, exceto pela mitigação de rate-limit/token nas rotas administrativas (seção 4.4.1).
* Gerenciador de pacotes: **pnpm**, com `.npmrc` (`save-exact=true`, `engine-strict=true`) e `pnpm-lock.yaml` versionado no git. Todas as dependências em versão exata no `package.json` (sem `^`/`~`).
* `server.js` deve montar `helmet()` e `cors()` (mesmo com frontend e backend na mesma origem, a config explícita documenta a intenção) antes das rotas.
