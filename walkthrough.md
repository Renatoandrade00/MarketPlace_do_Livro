# 🔑 Walkthrough de Setup — Contas, API Keys & Configurações

Guia completo de tudo que você precisa criar/configurar **antes** de começar a implementação do MarketPlace do Livro.

---

## 📋 Resumo Rápido

| Serviço | Para quê | Precisa de conta? | Precisa de API Key? | Cartão de crédito? | Quando usar |
|---|---|---|---|---|---|
| **Node.js** | Runtime do projeto | ❌ Instalação local | ❌ | ❌ | Fase 1 em diante |
| **Gemini** | LLM (explicações em português) | ✅ | ✅ API Key | ❌ | Fase 3 |
| **Kaggle** | Download do Book-Crossing Dataset | ✅ | ❌ | ❌ | Fase 1 |
| **Open Library** | Enriquecer gêneros dos livros | ❌ | ❌ | ❌ | Fase 1 |
| **GitHub** | Repositório + portfólio | ✅ (já tem) | ❌ | ❌ | Fase 6 |
| **Turso** | Banco de dados em produção | ✅ | ✅ Token + URL | ❌ | Fase 6 |
| **Render** | Deploy do backend | ✅ | ❌ (via dashboard) | ❌ | Fase 6 |

> [!TIP]
> As Fases 1–5 (desenvolvimento local) precisam apenas de **Node.js**, **Gemini** e **Kaggle**. Turso e Render são só para a Fase 6 (deploy). Você pode criar essas contas depois.

---

## 1. 🟢 Node.js — Runtime Local

**Quando:** Necessário desde o início (Fase 1)

### O que fazer

1. Acesse [https://nodejs.org/](https://nodejs.org/)
2. Baixe a versão **LTS** (20.x ou superior)
3. Instale com as opções padrão (Next → Next → Install)
4. Verifique a instalação:

```powershell
node --version    # deve retornar v20.x.x ou v22.x.x
npm --version     # deve retornar 10.x.x+
```

> [!NOTE]
> Se já tem o Node.js instalado, confirme que a versão é **18 ou superior**. Versões anteriores não são compatíveis com o `@tensorflow/tfjs-node`.

---

## 2. 🟠 Gemini — API de LLM (Explicações em Linguagem Natural)

**Quando:** Necessário a partir da Fase 3 (mas recomendo criar agora para já ter a key)

### Por que o Gemini?
- Cadastro **sem cartão de crédito** no Google AI Studio
- Tier gratuito extremamente generoso (15 requisições por minuto)
- Suporte nativo fantástico para o idioma português
- SDK simples `@google/generative-ai`

### Passo a passo

1. Acesse [https://aistudio.google.com/](https://aistudio.google.com/)

2. Faça login com sua conta Google (Gmail) padrão

3. Clique no botão **"Get API Key"** (no canto superior esquerdo ou central)

4. Clique em **"Create API Key"**
   - Escolha se deseja criar em um projeto existente ou em um novo projeto
   - Clique em **"Create API Key in new project"**

5. **⚠️ COPIE A CHAVE GERADA** e salve em local seguro.

6. O modelo recomendado para uso gratuito e rápido é o:
   - **`gemini-1.5-flash`**

### O que você terá

```env
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_MODEL=gemini-1.5-flash
```

> [!WARNING]
> **Nunca commite a API Key no Git!** Ela vai apenas no arquivo `.env` (que está no `.gitignore`).

---

## 3. 📊 Kaggle — Download do Book-Crossing Dataset

**Quando:** Necessário na Fase 1 (seed do banco de dados)

### Por que o Kaggle?
O Book-Crossing Dataset original é hospedado pelo GroupLens, mas o Kaggle oferece um mirror mais acessível e rápido para download.

### Passo a passo

1. Acesse [https://www.kaggle.com/](https://www.kaggle.com/)

2. Clique em **"Register"** (se não tiver conta)
   - 📧 Email + senha
   - 🔗 Google (recomendado — mais rápido)

3. Após login, acesse o dataset:
   - [https://www.kaggle.com/datasets/ruchi798/bookcrossing-dataset](https://www.kaggle.com/datasets/ruchi798/bookcrossing-dataset)
   - Alternativa: pesquise "Book-Crossing" na barra de busca do Kaggle

4. Clique em **"Download"** (botão no canto superior direito)
   - Será baixado um arquivo `.zip` contendo os CSVs

5. Extraia o `.zip` — você terá 3 arquivos CSV:
   - `BX-Books.csv` — catálogo de ~271 mil livros
   - `BX-Users.csv` — ~278 mil usuários com dados demográficos
   - `BX-Book-Ratings.csv` — ~1,1 milhão de avaliações

6. **Salve os CSVs** na pasta `data/raw/` do projeto (será criada na Fase 1):
   ```
   marketplace-do-livro/
   └── data/
       └── raw/
           ├── BX-Books.csv
           ├── BX-Users.csv
           └── BX-Book-Ratings.csv
   ```

> [!NOTE]
> O script de seed (Fase 1) vai filtrar esse dataset massivo para um subconjunto denso de ~300–400 livros e ~200–300 usuários. Você não precisa fazer a filtragem manual.

---

## 4. 📖 Open Library API — Enriquecimento de Gêneros

**Quando:** Fase 1 (script `enrichGenre.js`)

### O que fazer

**Nada!** 🎉

A Open Library API é:
- ✅ Completamente **gratuita**
- ✅ **Sem autenticação** (nenhuma chave, nenhuma conta)
- ✅ Sem limites rígidos de taxa (apenas bom-senso de não abusar)

O script `enrichGenre.js` vai consultar automaticamente:
```
https://openlibrary.org/api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data
```

> [!TIP]
> O script cacheia as respostas em `data/processed/generos.json` para não repetir chamadas a cada execução.

---

## 5. 🐙 GitHub — Repositório do Projeto

**Quando:** Desde o início (controle de versão) + Fase 6 (deploy via Render)

### O que fazer

Você já tem conta no GitHub. Basta criar o repositório:

1. Acesse [https://github.com/new](https://github.com/new)

2. Configure:
   - **Nome:** `marketplace-do-livro`
   - **Descrição:** `Sistema de recomendação de livros com IA (Two-Tower + LLM) — portfólio`
   - **Visibilidade:** Public (para portfólio)
   - **Não** inicialize com README (já temos um)

3. Após criar, conecte o repo local:
   ```bash
   git init
   git remote add origin https://github.com/seu-usuario/marketplace-do-livro.git
   ```

> [!NOTE]
> Crie o repositório apenas quando começar a Fase 1, para que o primeiro commit já contenha a estrutura base do projeto.

---

## 6. 🔵 Turso — Banco de Dados em Produção

**Quando:** Apenas na Fase 6 (deploy). Pode deixar para depois.

### Por que o Turso?
O Render free tier tem **disco efêmero** — o SQLite local não sobrevive a restarts. O Turso resolve isso com libSQL (fork do SQLite) hospedado na nuvem, mantendo compatibilidade total com Prisma.

### Passo a passo

1. Acesse [https://turso.tech/](https://turso.tech/)

2. Clique em **"Get Started Free"**

3. Crie a conta:
   - 🔗 GitHub (recomendado — vincula direto)

4. Instale a CLI do Turso:
   ```powershell
   # Windows (PowerShell)
   irm https://get.tur.so/install.ps1 | iex
   ```
   Ou via npm:
   ```powershell
   npm install -g @turso/cli
   ```

5. Autentique-se:
   ```powershell
   turso auth login
   ```
   Isso abre o navegador para confirmar via GitHub.

6. Crie o banco de dados:
   ```powershell
   turso db create marketplace-livro
   ```

7. Obtenha a URL do banco:
   ```powershell
   turso db show marketplace-livro --url
   ```
   - Formato: `libsql://marketplace-livro-seu-usuario.turso.io`

8. Crie um token de autenticação:
   ```powershell
   turso db tokens create marketplace-livro
   ```
   - **⚠️ COPIE O TOKEN AGORA** — guarde em lugar seguro

### O que você terá

```env
TURSO_DATABASE_URL=libsql://marketplace-livro-seu-usuario.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOiJFZDI1NTE5Iiwi...
```

> [!IMPORTANT]
> Em desenvolvimento local, continue usando SQLite (`file:./dev.db`). O Turso é usado **apenas em produção**, configurado via variáveis de ambiente no Render.

---

## 7. 🟣 Render — Deploy do Backend

**Quando:** Apenas na Fase 6 (deploy). Pode deixar para depois.

### Por que o Render?
Único PaaS popular com free tier **sem cartão de crédito**. Serve tanto o backend (Node.js) quanto o frontend estático (mesma origem, sem CORS).

### Passo a passo

1. Acesse [https://render.com/](https://render.com/)

2. Clique em **"Get Started for Free"**

3. Crie a conta:
   - 🔗 GitHub (recomendado — permite deploy automático do repo)

4. Após login, clique em **"New" → "Web Service"**

5. Conecte ao repositório GitHub:
   - Selecione `marketplace-do-livro`

6. Configure o serviço:
   | Campo | Valor |
   |---|---|
   | **Name** | `marketplace-do-livro` |
   | **Region** | Oregon (US West) ou o mais próximo |
   | **Branch** | `main` |
   | **Runtime** | Node |
   | **Build Command** | `npm install && npx prisma generate` |
   | **Start Command** | `node src/server.js` |
   | **Instance Type** | Free |

7. Configure as variáveis de ambiente no painel:
   - Vá em **"Environment"** → **"Add Environment Variable"**

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | `file:./dev.db` (o Prisma precisa, mas usaremos Turso via adapter) |
   | `GEMINI_API_KEY` | `AIzaSyxxxxx...` (sua chave) |
   | `GEMINI_MODEL` | `gemini-1.5-flash` |
   | `TURSO_DATABASE_URL` | `libsql://marketplace-livro-...turso.io` |
   | `TURSO_AUTH_TOKEN` | `eyJhbGci...` |
   | `PORT` | `10000` (padrão do Render) |

8. Clique em **"Create Web Service"** — o deploy começa automaticamente

> [!WARNING]
> **Free tier do Render:** o serviço "dorme" após ~15 min de inatividade. A primeira requisição seguinte leva **30–60 segundos** para responder. Isso é normal — não é bug. Documente isso na demo.

---

## 📦 Arquivo `.env` Final

Após completar todos os passos acima, seu `.env` local terá:

```env
# ── Banco de Dados ──────────────────────────────────
DATABASE_URL="file:./dev.db"

# ── Gemini (LLM) ────────────────────────────────────
GEMINI_API_KEY="AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
GEMINI_MODEL="gemini-1.5-flash"

# ── Servidor ────────────────────────────────────────
PORT=3000

# ── Produção (Fase 6 — preencha quando for fazer deploy) ──
# TURSO_DATABASE_URL="libsql://marketplace-livro-usuario.turso.io"
# TURSO_AUTH_TOKEN="eyJhbGciOiJFZDI1NTE5Iiwi..."
```

---

## ✅ Checklist — O que fazer agora (antes da Fase 1)

- [ ] Confirmar que **Node.js 18+** está instalado (`node --version`)
- [ ] Criar conta no **Google AI Studio** e gerar a API Key do Gemini
- [ ] Confirmar que o modelo padrão no `.env` está como `gemini-1.5-flash`
- [ ] Criar conta no **Kaggle** (se não tiver)
- [ ] Baixar o **Book-Crossing Dataset** do Kaggle
- [ ] *(Opcional agora)* Criar repositório no **GitHub**
- [ ] *(Deixar para Fase 6)* Criar conta no **Turso**
- [ ] *(Deixar para Fase 6)* Criar conta no **Render**

---

> Quando todos os itens acima estiverem ✅, estamos prontos para iniciar a **Fase 1: Estrutura Base, Dados e Banco de Dados**.
