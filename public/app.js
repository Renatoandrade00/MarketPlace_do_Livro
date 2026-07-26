/**
 * app.js — Lógica de Estado e Renderização do Frontend (Step 7)
 */

// Estado global em memória
const state = {
  currentUserId: null,
  users: [],
  recommendations: [],
  purchaseHistory: [],
  loading: false,
  error: null,
  recommendationsLimit: 10
};

// Elementos do DOM
const elUserSelect = document.getElementById('user-select');
const elWelcomeView = document.getElementById('welcome-view');
const elMainView = document.getElementById('main-view');

const elProfileAge = document.getElementById('profile-age');
const elProfileSex = document.getElementById('profile-sex');
const elProfileCity = document.getElementById('profile-city');
const elProfileCountry = document.getElementById('profile-country');

const elRecommendationsGrid = document.getElementById('recommendations-grid');
const elFallbackBadge = document.getElementById('fallback-badge');
const elFallbackWarning = document.getElementById('fallback-warning');
const elRecsLoading = document.getElementById('recs-loading');
const elBtnShowMore = document.getElementById('btn-show-more');
const elShowMoreContainer = document.getElementById('show-more-container');

const elPurchaseHistoryList = document.getElementById('purchase-history-list');
const elHistoryLoading = document.getElementById('history-loading');
const elNoPurchasesMsg = document.getElementById('no-purchases-msg');

const elModelStatus = document.getElementById('model-status');
const elModelLastTrain = document.getElementById('model-last-train');
const elModelMetrics = document.getElementById('model-metrics');

const elBtnTrainModel = document.getElementById('btn-train-model');
const elBtnRefreshLlm = document.getElementById('btn-refresh-llm');

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES DE SERVIÇO / FETCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carrega a lista de usuários para povoar o dropdown.
 */
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error("Falha ao buscar leitores.");
    state.users = await res.json();
    
    // Popular Dropdown
    elUserSelect.innerHTML = '<option value="">Selecione um usuário...</option>';
    state.users.forEach(user => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = `${user.nome} (${user.idade} anos, ${user.cidade})`;
      elUserSelect.appendChild(option);
    });
  } catch (err) {
    showGlobalError("Não foi possível carregar os usuários: " + err.message);
  }
}

/**
 * Seleciona um usuário ativo e dispara recarregamento dos painéis.
 */
async function selectUser(userId) {
  if (!userId) {
    state.currentUserId = null;
    elWelcomeView.classList.remove('hidden');
    elMainView.classList.add('hidden');
    return;
  }

  state.currentUserId = Number(userId);
  state.recommendationsLimit = 10;
  const user = state.users.find(u => u.id === state.currentUserId);
  
  if (user) {
    // Atualiza painel de perfil demográfico
    elProfileAge.textContent = `${user.idade} anos`;
    elProfileSex.textContent = user.sexo === 'M' ? 'Masculino' : user.sexo === 'F' ? 'Feminino' : 'Outro';
    elProfileCity.textContent = user.cidade;
    elProfileCountry.textContent = user.pais;
  }

  elWelcomeView.classList.add('hidden');
  elMainView.classList.remove('hidden');

  // Carregar dados concomitantes
  await Promise.all([
    loadRecommendations(state.currentUserId),
    loadHistory(state.currentUserId)
  ]);
}

/**
 * Carrega a lista de recomendações personalizadas do usuário.
 */
async function loadRecommendations(userId) {
  elRecommendationsGrid.classList.add('hidden');
  elRecsLoading.classList.remove('hidden');
  elFallbackBadge.classList.add('hidden');
  elFallbackWarning.classList.add('hidden');
  elShowMoreContainer.classList.add('hidden');

  try {
    const res = await fetch(`/api/recommendations/${userId}?limit=${state.recommendationsLimit}`);
    if (!res.ok) throw new Error("Falha ao carregar recomendações.");
    
    const data = await res.json();
    state.recommendations = data.books || [];

    if (data.usingFallback) {
      elFallbackBadge.classList.remove('hidden');
      elFallbackWarning.classList.remove('hidden');
    }

    renderRecommendations();
  } catch (err) {
    elRecommendationsGrid.innerHTML = `<p class="empty-state">Erro ao processar recomendações: ${err.message}</p>`;
    elRecommendationsGrid.classList.remove('hidden');
  } finally {
    elRecsLoading.classList.add('hidden');
  }
}

/**
 * Carrega o histórico de compras do usuário selecionado.
 */
async function loadHistory(userId) {
  elPurchaseHistoryList.classList.add('hidden');
  elHistoryLoading.classList.remove('hidden');
  elNoPurchasesMsg.classList.add('hidden');

  try {
    const res = await fetch(`/api/purchases/user/${userId}`);
    if (!res.ok) throw new Error("Erro ao buscar histórico.");
    
    state.purchaseHistory = await res.json();
    renderHistory();
  } catch (err) {
    elPurchaseHistoryList.innerHTML = `<li class="empty-state">Erro ao carregar histórico: ${err.message}</li>`;
    elPurchaseHistoryList.classList.remove('hidden');
  } finally {
    elHistoryLoading.classList.add('hidden');
  }
}

/**
 * Registra a compra de um livro.
 */
async function buyBook(bookId) {
  if (!state.currentUserId) return;

  const btn = document.querySelector(`.btn-buy[data-book-id="${bookId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processando...";
  }

  try {
    const res = await fetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.currentUserId,
        bookId: Number(bookId)
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || "Erro ao efetuar compra.");
    }

    // Sucesso -> recarregar recomendações e histórico para atualizar scores e visual
    await Promise.all([
      loadRecommendations(state.currentUserId),
      loadHistory(state.currentUserId)
    ]);
  } catch (err) {
    alert("Falha na compra: " + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Comprar";
    }
  }
}

/**
 * Cancela/deleta uma compra de livro.
 */
async function deletePurchase(purchaseId) {
  if (!confirm("Tem certeza que deseja cancelar esta aquisição?")) return;

  try {
    const res = await fetch(`/api/purchases/${purchaseId}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error("Erro ao remover a compra.");

    // Sucesso -> recarrega os painéis
    await Promise.all([
      loadRecommendations(state.currentUserId),
      loadHistory(state.currentUserId)
    ]);
  } catch (err) {
    alert("Não foi possível excluir a compra: " + err.message);
  }
}

/**
 * Consulta e atualiza o estado atual de treinamento do modelo.
 */
async function checkModelStatus() {
  try {
    const res = await fetch('/api/model/status');
    if (!res.ok) return;
    const data = await res.json();

    // Atualiza crachá de status
    elModelStatus.className = `status-badge status-${data.status}`;
    elModelStatus.textContent = data.status;

    // Atualiza última data
    if (data.lastTrainedAt) {
      elModelLastTrain.textContent = new Date(data.lastTrainedAt).toLocaleString('pt-BR');
    } else {
      elModelLastTrain.textContent = 'Nunca treinado';
    }

    // Atualiza métricas
    if (data.metrics) {
      elModelMetrics.textContent = `L: ${data.metrics.loss} / Val L: ${data.metrics.valLoss} (${data.metrics.epochs} épocas)`;
    } else {
      elModelMetrics.textContent = '-';
    }

    // Gerencia botões conforme status de treinamento
    if (data.status === 'training') {
      elBtnTrainModel.disabled = true;
      elBtnTrainModel.querySelector('.btn-text').textContent = "Treinando...";
      elBtnTrainModel.querySelector('.btn-loader').classList.remove('hidden');
    } else {
      elBtnTrainModel.disabled = false;
      elBtnTrainModel.querySelector('.btn-text').textContent = "Retreinar Modelo";
      elBtnTrainModel.querySelector('.btn-loader').classList.add('hidden');
    }
  } catch (err) {
    console.error("Erro ao verificar status do modelo:", err);
  }
}

/**
 * Dispara o retreino do modelo no backend.
 */
async function trainModel() {
  const token = prompt("Insira o ADMIN_TOKEN para autorizar o treinamento:");
  if (token === null) return; // cancelado

  elBtnTrainModel.disabled = true;
  elBtnTrainModel.querySelector('.btn-text').textContent = "Iniciando...";
  elBtnTrainModel.querySelector('.btn-loader').classList.remove('hidden');

  try {
    const res = await fetch('/api/model/train', {
      method: 'POST',
      headers: { 'x-admin-token': token }
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Erro ao disparar treinamento.");
    }

    alert("Treinamento do modelo iniciado em background com sucesso!");
    // Iniciar checagem periódica rápida do status do modelo
    let pollCount = 0;
    const interval = setInterval(async () => {
      await checkModelStatus();
      pollCount++;
      // Limitar checagem a no máximo 1 minuto de polling rápido
      if (pollCount > 30 || elModelStatus.textContent === 'idle') {
        clearInterval(interval);
        // Atualizar recomendações se houver usuário ativo
        if (state.currentUserId) {
          loadRecommendations(state.currentUserId);
        }
      }
    }, 2000);
  } catch (err) {
    alert("Falha ao iniciar retreino: " + err.message);
    await checkModelStatus();
  }
}

/**
 * Atualiza o contexto LLM agregador.
 */
async function refreshLlmContext() {
  const token = prompt("Insira o ADMIN_TOKEN para autorizar o cálculo de contexto:");
  if (token === null) return;

  elBtnRefreshLlm.disabled = true;
  elBtnRefreshLlm.querySelector('.btn-loader').classList.remove('hidden');

  try {
    const res = await fetch('/api/llm/refresh-context', {
      method: 'POST',
      headers: { 'x-admin-token': token }
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Erro ao disparar cálculo.");
    }

    const data = await res.json();
    alert(`Contexto atualizado!\nGênero Popular: ${data.context.generoMaisPopular}\nFaixa Etária Predominante: ${data.context.faixaEtariaPredominante}`);
  } catch (err) {
    alert("Falha ao atualizar contexto: " + err.message);
  } finally {
    elBtnRefreshLlm.disabled = false;
    elBtnRefreshLlm.querySelector('.btn-loader').classList.add('hidden');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES DE RENDERING (COM SANITIZAÇÃO TEXTCONTENT CONFORME SPEC §7.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza o grid de livros recomendados na tela com sanitização completa de dados.
 */
function renderRecommendations() {
  elRecommendationsGrid.innerHTML = '';
  
  if (state.recommendations.length === 0) {
    elRecommendationsGrid.innerHTML = '<p class="empty-state">Nenhuma recomendação disponível para este perfil.</p>';
    elRecommendationsGrid.classList.remove('hidden');
    elShowMoreContainer.classList.add('hidden');
    return;
  }

  state.recommendations.forEach(rec => {
    // Container do Card
    const card = document.createElement('div');
    card.className = `book-card ${rec.isPurchased ? 'purchased' : ''}`;

    // Score Badge
    const badge = document.createElement('div');
    badge.className = 'book-score-badge';
    badge.textContent = rec.isPurchased ? 'Adquirido' : `${rec.scorePercent}%`;
    card.appendChild(badge);

    // Info do Livro
    const info = document.createElement('div');
    info.className = 'book-info';

    const title = document.createElement('h4');
    title.textContent = rec.nome; // Sanitização total
    info.appendChild(title);

    const author = document.createElement('p');
    author.className = 'book-author';
    author.textContent = rec.autor; // Sanitização total
    info.appendChild(author);

    // Meta (ano e gênero)
    const meta = document.createElement('div');
    meta.className = 'book-meta';

    const spanGenre = document.createElement('span');
    spanGenre.textContent = rec.genero;
    meta.appendChild(spanGenre);

    const spanYear = document.createElement('span');
    spanYear.textContent = rec.ano;
    meta.appendChild(spanYear);

    info.appendChild(meta);

    // Justificativa do LLM (ou Fallback)
    const explanation = document.createElement('p');
    explanation.className = 'llm-explanation';
    explanation.textContent = rec.justificativa; // Sanitização total (textContent) para evitar injeção XSS por modelos de linguagem
    info.appendChild(explanation);

    card.appendChild(info);

    // Ações (Botão Comprar)
    const actionArea = document.createElement('div');
    actionArea.className = 'book-action';

    const btn = document.createElement('button');
    if (rec.isPurchased) {
      btn.className = 'btn btn-purchased';
      btn.textContent = 'Adquirido';
      btn.disabled = true;
    } else {
      btn.className = 'btn btn-primary btn-buy';
      btn.dataset.bookId = rec.bookId;
      btn.textContent = 'Comprar';
      btn.addEventListener('click', () => buyBook(rec.bookId));
    }
    actionArea.appendChild(btn);
    card.appendChild(actionArea);

    elRecommendationsGrid.appendChild(card);
  });

  elRecommendationsGrid.classList.remove('hidden');

  if (state.recommendationsLimit >= 50 || state.recommendations.length < state.recommendationsLimit) {
    elBtnShowMore.disabled = true;
  } else {
    elBtnShowMore.disabled = false;
  }
  elShowMoreContainer.classList.remove('hidden');
}

/**
 * Renderiza o histórico de compras.
 */
function renderHistory() {
  elPurchaseHistoryList.innerHTML = '';
  
  if (state.purchaseHistory.length === 0) {
    elNoPurchasesMsg.classList.remove('hidden');
    elPurchaseHistoryList.classList.add('hidden');
    return;
  }

  state.purchaseHistory.forEach(item => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const info = document.createElement('div');
    info.className = 'history-book-info';

    const title = document.createElement('div');
    title.className = 'history-book-name';
    title.textContent = item.nome;
    info.appendChild(title);

    const author = document.createElement('div');
    author.className = 'history-book-author';
    author.textContent = item.autor;
    info.appendChild(author);

    li.appendChild(info);

    // Botão de Excluir Compra
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete-purchase';
    btnDel.title = 'Cancelar Compra';
    btnDel.innerHTML = '&#x1F5D1;'; // Ícone de Lixeira HTML
    btnDel.addEventListener('click', () => deletePurchase(item.purchaseId));
    li.appendChild(btnDel);

    elPurchaseHistoryList.appendChild(li);
  });

  elPurchaseHistoryList.classList.remove('hidden');
}

/**
 * Mostra erro global.
 */
function showGlobalError(msg) {
  alert(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTENERS DE EVENTO & INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

elUserSelect.addEventListener('change', (e) => selectUser(e.target.value));
elBtnTrainModel.addEventListener('click', trainModel);
elBtnRefreshLlm.addEventListener('click', refreshLlmContext);
elBtnShowMore.addEventListener('click', async () => {
  if (state.recommendationsLimit < 50 && state.currentUserId) {
    state.recommendationsLimit = Math.min(50, state.recommendationsLimit + 10);
    await loadRecommendations(state.currentUserId);
  }
});

// Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await checkModelStatus();
  
  // Atualizar status do modelo a cada 30 segundos
  setInterval(checkModelStatus, 30000);
});
