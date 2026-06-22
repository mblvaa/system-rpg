const supabaseUrl = window.SYSTEM_CONFIG?.SUPABASE_URL;
const supabaseAnonKey = window.SYSTEM_CONFIG?.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey ||
    supabaseUrl.includes('ВСТАВЬТЕ') ||
    supabaseAnonKey.includes('ВСТАВЬТЕ')) {
  alert('Сначала заполните файл config.js данными из Supabase.');
}

const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

const State = {
  session: null,
  profile: null,
  messages: [],
  sponsors: [],
  characters: [],
  templates: [],
  actionLog: [],
  selectedChoiceId: null,
  realtimeChannel: null
};

const $ = (id) => document.getElementById(id);

const Utils = {
  escape(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  date(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  messageType(type) {
    const types = {
      info: 'СИСТЕМНОЕ СООБЩЕНИЕ',
      scenario: 'СЦЕНАРИЙ',
      choice: 'ВЫБОР',
      sponsor_choice: 'ВЫБОР СПОНСОРА',
      warning: 'ВНИМАНИЕ',
      result: 'РЕЗУЛЬТАТ',
      sponsor: 'СООБЩЕНИЕ ОТ СПОНСОРА',
      character: 'ДАННЫЕ ПЕРСОНАЖА'
    };
    return types[type] || 'СООБЩЕНИЕ';
  },

  toast(text, type = 'success') {
    const container = $('toast-container');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = text;
    container.appendChild(item);

    setTimeout(() => item.remove(), 3800);
  },

  async log(action, detail = '') {
    if (!State.profile?.id) return;

    await sb.from('action_log').insert({
      character_id: State.profile.id,
      action,
      detail
    });
  },

  parseJson(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
};

const Modal = {
  open(title, bodyHtml) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    $('modal-overlay').style.display = 'block';
  },

  close() {
    $('modal-overlay').style.display = 'none';
    $('modal-body').innerHTML = '';
  },

  closeOnOverlay(event) {
    if (event.target.id === 'modal-overlay') {
      Modal.close();
    }
  }
};

const App = {
  async init() {
    App.bindTabs();
    App.bindPlayerNavigation();
    App.bindAdminNavigation();

    const { data } = await sb.auth.getSession();

    if (data.session) {
      State.session = data.session;
      await App.loadCurrentUser();
    }
  },

  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((item) => item.classList.remove('active'));

        button.classList.add('active');
        $(`tab-${button.dataset.tab}`).classList.add('active');
        $('login-error').style.display = 'none';
      });
    });
  },

  bindPlayerNavigation() {
    document.querySelectorAll('#screen-player .nav-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        document.querySelectorAll('#screen-player .nav-btn').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('#screen-player .page').forEach((item) => item.classList.remove('active'));

        button.classList.add('active');
        $(`page-${button.dataset.page}`).classList.add('active');

        await Player.renderPage(button.dataset.page);
      });
    });
  },

  bindAdminNavigation() {
    document.querySelectorAll('#screen-admin .nav-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        document.querySelectorAll('#screen-admin .nav-btn').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('#screen-admin .page').forEach((item) => item.classList.remove('active'));

        button.classList.add('active');
        $(`page-${button.dataset.page}`).classList.add('active');

        await Admin.renderPage(button.dataset.page);
      });
    });
  },

  async register() {
    const name = $('reg-name').value.trim();
    const pin = $('reg-pin').value.trim();
    const pin2 = $('reg-pin2').value.trim();

    if (!name || !pin || !pin2) {
      App.showLoginError('Заполните все поля.');
      return;
    }

    if (pin.length < 4) {
      App.showLoginError('PIN должен содержать минимум 4 символа.');
      return;
    }

    if (pin !== pin2) {
      App.showLoginError('PIN-коды не совпадают.');
      return;
    }

    const loginEmail = App.makeInternalEmail(name);

    const { data, error } = await sb.auth.signUp({
      email: loginEmail,
      password: pin,
      options: {
        data: {
          character_name: name
        }
      }
    });

    if (error) {
      App.showLoginError(error.message);
      return;
    }

    if (!data.session) {
      App.showLoginError(
        'Регистрация создана, но сессия не открылась. Проверьте, что в Supabase отключено Confirm email.'
      );
      return;
    }

    Utils.toast('Персонаж зарегистрирован.');
    State.session = data.session;
    await App.loadCurrentUser();
  },

  async login() {
    const name = $('login-name').value.trim();
    const pin = $('login-pin').value.trim();

    if (!name || !pin) {
      App.showLoginError('Введите имя персонажа и PIN.');
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({
      email: App.makeInternalEmail(name),
      password: pin
    });

    if (error) {
      App.showLoginError('Не удалось войти. Проверьте имя и PIN.');
      return;
    }

    State.session = data.session;
    await App.loadCurrentUser();
  },

  async adminLogin() {
    const login = $('admin-login').value.trim();
    const pin = $('admin-pin').value.trim();

    if (!login || !pin) {
      App.showLoginError('Введите логин и PIN администратора.');
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({
      email: App.makeInternalEmail(login),
      password: pin
    });

    if (error) {
      App.showLoginError('Не удалось войти. Проверьте логин и PIN.');
      return;
    }

    State.session = data.session;
    await App.loadCurrentUser();
  },

  makeInternalEmail(name) {
    const safe = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zа-яё0-9_-]/gi, '');

    return `${safe}@system-rpg.local`;
  },

  showLoginError(text) {
    $('login-error').textContent = text;
    $('login-error').style.display = 'block';
  },

  async loadCurrentUser() {
    const { data: authData } = await sb.auth.getUser();

    if (!authData.user) {
      await App.logout();
      return;
    }

    const { data: profile, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (error) {
      console.error(error);
      Utils.toast('Не удалось загрузить профиль.', 'error');
      return;
    }

    State.profile = profile;

    if (profile.role === 'admin') {
      App.showScreen('screen-admin');
      await Admin.refresh();
    } else {
      App.showScreen('screen-player');
      await Player.refresh();
      App.subscribeRealtime();
    }
  },

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
    $(screenId).classList.add('active');
  },

  async logout() {
    if (State.realtimeChannel) {
      await sb.removeChannel(State.realtimeChannel);
      State.realtimeChannel = null;
    }

    await sb.auth.signOut();

    State.session = null;
    State.profile = null;
    State.messages = [];
    State.characters = [];
    State.sponsors = [];

    App.showScreen('screen-login');
    $('login-name').value = '';
    $('login-pin').value = '';
    $('admin-login').value = '';
    $('admin-pin').value = '';
  },

  toggleTheme() {
    document.body.classList.toggle('theme-light');
  },

  async refreshMessages() {
    await Player.refresh();
    Utils.toast('Система обновлена.');
  },

  subscribeRealtime() {
    if (State.realtimeChannel) return;

    State.realtimeChannel = sb
      .channel(`player-system-${State.profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_message_state',
          filter: `character_id=eq.${State.profile.id}`
        },
        async () => {
          await Player.refresh();
          Utils.toast('Получено новое системное сообщение.');
        }
      )
      .subscribe();
  }
};

const Player = {
  async refresh() {
    await Player.loadMessages();
    await Player.loadProfile();
    Player.renderHeader();
    await Player.renderPage(Player.getCurrentPage());
  },

  getCurrentPage() {
    const current = document.querySelector('#screen-player .nav-btn.active');
    return current?.dataset.page || 'main';
  },

  async loadProfile() {
    const { data, error } = await sb
      .from('profiles')
      .select(`
        *,
        sponsors (
          id,
          name,
          title,
          description,
          attitude,
          bonuses
        )
      `)
      .eq('id', State.profile.id)
      .single();

    if (!error && data) {
      State.profile = data;
    }
  },

  async loadMessages() {
    const { data, error } = await sb
      .from('player_message_state')
      .select(`
        *,
        messages (
          id,
          type,
          title,
          body,
          category,
          difficulty,
          time_text,
          reward,
          failure,
          created_at,
          message_choices (
            id,
            text,
            sort_order
          )
        )
      `)
      .eq('character_id', State.profile.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    State.messages = (data || [])
      .filter((row) => row.messages)
      .map((row) => ({
        ...row.messages,
        state: {
          id: row.id,
          is_read: row.is_read,
          is_accepted: row.is_accepted,
          selected_choice_id: row.selected_choice_id,
          completed_status: row.completed_status,
          read_at: row.read_at,
          selected_at: row.selected_at
        },
        choices: (row.messages.message_choices || []).sort((a, b) => a.sort_order - b.sort_order)
      }));
  },

  renderHeader() {
    $('header-char-name').textContent = State.profile.character_name;

    const unread = State.messages.filter((message) => !message.state.is_read).length;

    $('unread-badge').textContent = unread;
    $('unread-badge').style.display = unread ? 'grid' : 'none';
  },

  async renderPage(page) {
    if (page === 'main') Player.renderMain();
    if (page === 'inbox') Player.renderInbox();
    if (page === 'scenarios') Player.renderScenarios();
    if (page === 'choices') Player.renderChoices();
    if (page === 'log') Player.renderLog();
    if (page === 'profile') Player.renderProfile();
    if (page === 'sponsor') Player.renderSponsor();
  },

  renderMain() {
    $('main-char-greeting').innerHTML = `
      <strong>${Utils.escape(State.profile.character_name)}</strong>, Система подтверждает ваш статус.
      Новые сценарии и сообщения будут отображаться здесь.
    `;

    $('main-quick-stats').innerHTML = `
      <div class="quick-stat">
        <div class="quick-stat-label">МОНЕТЫ</div>
        <div class="quick-stat-value">${State.profile.coins || 0}</div>
      </div>
      <div class="quick-stat">
        <div class="quick-stat-label">СЦЕНАРИИ</div>
        <div class="quick-stat-value">${State.messages.filter((m) => m.type === 'scenario').length}</div>
      </div>
      <div class="quick-stat">
        <div class="quick-stat-label">ВЫБОРЫ</div>
        <div class="quick-stat-value">${State.messages.filter((m) => ['choice', 'sponsor_choice'].includes(m.type) && !m.state.selected_choice_id).length}</div>
      </div>
      <div class="quick-stat">
        <div class="quick-stat-label">СПОНСОР</div>
        <div class="quick-stat-value">${State.profile.sponsors ? 'ЕСТЬ' : '—'}</div>
      </div>
    `;

    const recent = State.messages.slice(0, 4);

    $('main-new-messages').innerHTML = recent.length
      ? recent.map((message) => Player.messageCard(message, true)).join('')
      : Player.empty('Новых системных сообщений нет.');
  },

  renderInbox() {
    const list = State.messages.filter((message) => !['scenario', 'choice', 'sponsor_choice'].includes(message.type));

    $('inbox-list').innerHTML = list.length
      ? list.map((message) => Player.messageCard(message)).join('')
      : Player.empty('Во входящих пока ничего нет.');
  },

  renderScenarios() {
    const list = State.messages.filter((message) => message.type === 'scenario');

    $('scenarios-list').innerHTML = list.length
      ? list.map((message) => Player.messageCard(message)).join('')
      : Player.empty('Активных сценариев нет.');
  },

  renderChoices() {
    const list = State.messages.filter((message) => ['choice', 'sponsor_choice'].includes(message.type));

    $('choices-list').innerHTML = list.length
      ? list.map((message) => Player.messageCard(message)).join('')
      : Player.empty('Доступных выборов нет.');
  },

  renderLog() {
    const list = [...State.messages].sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    });

    $('log-list').innerHTML = list.length
      ? list.map((message) => `
          <div class="message-card ${message.type}">
            <div class="message-meta">
              <span>${Utils.messageType(message.type)}</span>
              <span>${Utils.date(message.created_at)}</span>
            </div>
            <div class="message-title">${Utils.escape(message.title || 'Без названия')}</div>
            <div class="message-body">${Utils.escape(message.body || '')}</div>
          </div>
        `).join('')
      : Player.empty('Журнал пока пуст.');
  },

  renderProfile() {
    const stats = Utils.parseJson(State.profile.stats, {});
    const skills = Utils.parseJson(State.profile.skills, []);

    const avatar = State.profile.avatar_url
      ? `<img class="avatar" src="${Utils.escape(State.profile.avatar_url)}" alt="Аватар">`
      : `<div class="avatar-placeholder">${Utils.escape(State.profile.character_name.charAt(0) || '?')}</div>`;

    const statRows = Object.entries(stats).length
      ? Object.entries(stats).map(([name, value]) => `
          <div class="data-row"><span>${Utils.escape(name)}</span><strong>${Utils.escape(value)}</strong></div>
        `).join('')
      : `<div class="empty-state">Характеристики еще не заданы.</div>`;

    const skillRows = Array.isArray(skills) && skills.length
      ? skills.map((skill) => `<div class="data-row"><span>${Utils.escape(skill)}</span></div>`).join('')
      : `<div class="empty-state">Навыки еще не заданы.</div>`;

    $('profile-content').innerHTML = `
      <div class="sys-card profile-grid">
        <div class="profile-top">
          ${avatar}
          <div>
            <div class="profile-name">${Utils.escape(State.profile.character_name)}</div>
            <div class="profile-status">${Utils.escape(State.profile.status || 'Активен')}</div>
            <div class="profile-status">Монеты: ${State.profile.coins || 0}</div>
          </div>
        </div>

        <div>
          <div class="card-label">ОПИСАНИЕ</div>
          <div class="message-body">${Utils.escape(State.profile.description || 'Описание не добавлено.')}</div>
        </div>

        <div>
          <div class="card-label">ХАРАКТЕРИСТИКИ</div>
          <div class="data-list">${statRows}</div>
        </div>

        <div>
          <div class="card-label">НАВЫКИ</div>
          <div class="data-list">${skillRows}</div>
        </div>
      </div>
    `;
  },

  renderSponsor() {
    const sponsor = State.profile.sponsors;

    if (!sponsor) {
      $('sponsor-content').innerHTML = Player.empty('Спонсор отсутствует.');
      return;
    }

    $('sponsor-content').innerHTML = `
      <div class="sys-card sponsor">
        <div class="card-label">СОЗВЕЗДИЕ-ПОКРОВИТЕЛЬ</div>
        <div class="message-title">${Utils.escape(sponsor.name)}</div>
        <div class="message-body">${Utils.escape(sponsor.title || '')}</div>

        <div class="scenario-data">
          <div><span>Описание:</span> <strong>${Utils.escape(sponsor.description || '—')}</strong></div>
          <div><span>Отношение:</span> <strong>${Utils.escape(sponsor.attitude || '—')}</strong></div>
          <div><span>Дары:</span> <strong>${Utils.escape(sponsor.bonuses || '—')}</strong></div>
        </div>
      </div>
    `;
  },

  messageCard(message, compact = false) {
    const scenarioData = message.type === 'scenario'
      ? `
        <div class="scenario-data">
          ${message.category ? `<div><span>Категория:</span> <strong>${Utils.escape(message.category)}</strong></div>` : ''}
          ${message.difficulty ? `<div><span>Сложность:</span> <strong>${Utils.escape(message.difficulty)}</strong></div>` : ''}
          ${message.time_text ? `<div><span>Время:</span> <strong>${Utils.escape(message.time_text)}</strong></div>` : ''}
          ${message.reward ? `<div><span>Награда:</span> <strong>${Utils.escape(message.reward)}</strong></div>` : ''}
          ${message.failure ? `<div><span>Провал:</span> <strong>${Utils.escape(message.failure)}</strong></div>` : ''}
        </div>
      `
      : '';

    const actions = compact ? '' : Player.messageActions(message);

    return `
      <div class="message-card ${message.type} ${message.state.is_read ? '' : 'unread'}">
        <div class="message-meta">
          <span>[${Utils.messageType(message.type)}]</span>
          <span>${Utils.date(message.created_at)}</span>
        </div>

        <div class="message-title">${Utils.escape(message.title || 'Системное сообщение')}</div>
        <div class="message-body">${Utils.escape(message.body || '')}</div>

        ${scenarioData}
        ${actions}
      </div>
    `;
  },

  messageActions(message) {
    const buttons = [];

    if (!message.state.is_read) {
      buttons.push(`
        <button class="sys-btn small" onclick="Player.markRead('${message.id}')">
          ПРОЧИТАНО
        </button>
      `);
    }

    if (message.type === 'scenario' && !message.state.is_accepted) {
      buttons.push(`
        <button class="sys-btn primary small" onclick="Player.acceptScenario('${message.id}')">
          ПРИНЯТЬ СЦЕНАРИЙ
        </button>
      `);
    }

    if (message.type === 'scenario' && message.state.is_accepted && message.state.completed_status === 'pending') {
      buttons.push(`
        <button class="sys-btn small" onclick="Player.completeScenario('${message.id}')">
          ОТМЕТИТЬ ВЫПОЛНЕННЫМ
        </button>
      `);
    }

    if (['choice', 'sponsor_choice'].includes(message.type)) {
      if (message.state.selected_choice_id) {
        const choice = message.choices.find((item) => item.id === message.state.selected_choice_id);
        buttons.push(`
          <div class="sys-btn small">ВЫБРАНО: ${Utils.escape(choice?.text || '—')}</div>
        `);
      } else {
        buttons.push(`
          <button class="sys-btn primary small" onclick="Player.openChoice('${message.id}')">
            СДЕЛАТЬ ВЫБОР
          </button>
        `);
      }
    }

    return buttons.length ? `<div class="btn-row" style="margin-top:14px">${buttons.join('')}</div>` : '';
  },

  empty(text) {
    return `<div class="empty-state">${Utils.escape(text)}</div>`;
  },

  async markRead(messageId) {
    const { error } = await sb
      .from('player_message_state')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('character_id', State.profile.id)
      .eq('message_id', messageId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    await Utils.log('read_message', `Прочитано сообщение ${messageId}`);
    await Player.refresh();
  },

  async acceptScenario(messageId) {
    const { error } = await sb
      .from('player_message_state')
      .update({
        is_accepted: true,
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('character_id', State.profile.id)
      .eq('message_id', messageId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    await Utils.log('accept_scenario', `Принят сценарий ${messageId}`);
    Utils.toast('Сценарий принят.');
    await Player.refresh();
  },

  async completeScenario(messageId) {
    const { error } = await sb
      .from('player_message_state')
      .update({
        completed_status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('character_id', State.profile.id)
      .eq('message_id', messageId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    await Utils.log('complete_scenario', `Игрок отметил сценарий выполненным: ${messageId}`);
    Utils.toast('Сценарий отмечен выполненным.');
    await Player.refresh();
  },

  openChoice(messageId) {
    const message = State.messages.find((item) => item.id === messageId);
    if (!message) return;

    State.selectedChoiceId = null;

    Modal.open(
      message.type === 'sponsor_choice' ? '[ ВЫБОР СПОНСОРА ]' : '[ ВЫБОР ]',
      `
      <div class="message-title">${Utils.escape(message.title || '')}</div>
      <div class="message-body">${Utils.escape(message.body || '')}</div>

      <div class="choice-list">
        ${message.choices.map((choice) => `
          <button class="choice-btn" data-choice-id="${choice.id}" onclick="Player.selectChoice('${choice.id}', this)">
            ${Utils.escape(choice.text)}
          </button>
        `).join('')}
      </div>

      <div class="btn-row">
        <button class="sys-btn primary" onclick="Player.confirmChoice('${message.id}')">
          [ ПОДТВЕРДИТЬ ВЫБОР ]
        </button>
        <button class="sys-btn" onclick="Modal.close()">ОТМЕНА</button>
      </div>
      `
    );
  },

  selectChoice(choiceId, button) {
    State.selectedChoiceId = choiceId;
    document.querySelectorAll('.choice-btn').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
  },

  async confirmChoice(messageId) {
    if (!State.selectedChoiceId) {
      Utils.toast('Сначала выберите вариант.', 'error');
      return;
    }

    const message = State.messages.find((item) => item.id === messageId);
    const choice = message?.choices.find((item) => item.id === State.selectedChoiceId);

    const { error } = await sb
      .from('player_message_state')
      .update({
        selected_choice_id: State.selectedChoiceId,
        selected_at: new Date().toISOString(),
        is_read: true,
        completed_status: 'chosen'
      })
      .eq('character_id', State.profile.id)
      .eq('message_id', messageId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    if (message?.type === 'sponsor_choice' && choice) {
      const { data: sponsor } = await sb
        .from('sponsors')
        .select('id')
        .eq('name', choice.text)
        .maybeSingle();

      if (sponsor?.id) {
        await sb
          .from('profiles')
          .update({ sponsor_id: sponsor.id })
          .eq('id', State.profile.id);
      }
    }

    await Utils.log('make_choice', `Выбран вариант: ${choice?.text || ''}`);
    Modal.close();
    Utils.toast('Выбор подтвержден.');
    await Player.refresh();
  }
};

const Admin = {
  async refresh() {
    await Admin.loadAll();
    await Admin.renderPage(Admin.getCurrentPage());
  },

  getCurrentPage() {
    const current = document.querySelector('#screen-admin .nav-btn.active');
    return current?.dataset.page || 'a-dashboard';
  },

  async loadAll() {
    const [charactersRes, sponsorsRes, messagesRes, templatesRes, logRes] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: false }),
      sb.from('sponsors').select('*').order('created_at', { ascending: false }),
      sb.from('messages').select(`
        *,
        message_choices (
          id,
          text,
          sort_order
        ),
        player_message_state (
          id,
          character_id,
          is_read,
          is_accepted,
          selected_choice_id,
          completed_status
        )
      `).order('created_at', { ascending: false }),
      sb.from('message_templates').select('*').order('created_at', { ascending: false }),
      sb.from('action_log').select(`
        *,
        profiles (
          character_name
        )
      `).order('created_at', { ascending: false }).limit(100)
    ]);

    State.characters = charactersRes.data || [];
    State.sponsors = sponsorsRes.data || [];
    State.messages = messagesRes.data || [];
    State.templates = templatesRes.data || [];
    State.actionLog = logRes.data || [];
  },

  async renderPage(page) {
    if (page === 'a-dashboard') Admin.renderDashboard();
    if (page === 'a-characters') Admin.renderCharacters();
    if (page === 'a-messages') Admin.renderMessages();
    if (page === 'a-scenarios') Admin.renderScenarios();
    if (page === 'a-choices') Admin.renderChoices();
    if (page === 'a-sponsors') Admin.renderSponsors();
    if (page === 'a-templates') Admin.renderTemplates();
    if (page === 'a-log') Admin.renderLog();
  },

  renderDashboard() {
    const players = State.characters.filter((character) => character.role === 'player');
    const activeScenarios = State.messages.filter((message) => message.type === 'scenario');
    const openChoices = State.messages.filter((message) => ['choice', 'sponsor_choice'].includes(message.type));

    $('a-dashboard-stats').innerHTML = `
      <div class="admin-stat">
        <div class="admin-stat-label">ПЕРСОНАЖИ</div>
        <div class="admin-stat-value">${players.length}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">СЦЕНАРИИ</div>
        <div class="admin-stat-value">${activeScenarios.length}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">ВЫБОРЫ</div>
        <div class="admin-stat-value">${openChoices.length}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">СПОНСОРЫ</div>
        <div class="admin-stat-value">${State.sponsors.length}</div>
      </div>
    `;

    $('a-dashboard-log').innerHTML = State.actionLog.length
      ? State.actionLog.slice(0, 8).map((log) => `
          <div class="message-card">
            <div class="message-meta">
              <span>${Utils.escape(log.profiles?.character_name || 'Система')}</span>
              <span>${Utils.date(log.created_at)}</span>
            </div>
            <div class="message-body">${Utils.escape(log.detail || log.action)}</div>
          </div>
        `).join('')
      : Player.empty('Действий пока нет.');
  },

  renderCharacters() {
    const players = State.characters.filter((character) => character.role === 'player');

    $('a-characters-list').style.display = 'block';
    $('a-character-detail').style.display = 'none';

    $('a-characters-list').innerHTML = players.length
      ? players.map((character) => {
          const sponsor = State.sponsors.find((item) => item.id === character.sponsor_id);

          return `
            <div class="admin-character">
              <div>
                <div class="admin-character-name">${Utils.escape(character.character_name)}</div>
                <div class="admin-character-meta">
                  ${Utils.escape(character.status || 'Активен')} ·
                  Монеты: ${character.coins || 0} ·
                  Спонсор: ${Utils.escape(sponsor?.name || 'нет')}
                </div>
              </div>
              <button class="sys-btn small" onclick="Admin.openCharacter('${character.id}')">ОТКРЫТЬ</button>
            </div>
          `;
        }).join('')
      : Player.empty('Игроки еще не зарегистрировались.');
  },

  openCharacter(characterId) {
    const character = State.characters.find((item) => item.id === characterId);
    if (!character) return;

    const stats = Utils.parseJson(character.stats, {});
    const skills = Utils.parseJson(character.skills, []);

    $('a-characters-list').style.display = 'none';
    $('a-character-detail').style.display = 'block';

    $('a-character-detail').innerHTML = `
      <button class="sys-btn small" onclick="Admin.renderCharacters()">← К СПИСКУ</button>

      <div class="sys-card" style="margin-top:12px">
        <div class="card-label">РЕДАКТИРОВАНИЕ ПЕРСОНАЖА</div>

        <input type="hidden" id="edit-character-id" value="${character.id}">

        <div class="form-group">
          <label class="sys-label">ИМЯ</label>
          <input class="sys-input" id="edit-character-name" value="${Utils.escape(character.character_name)}">
        </div>

        <div class="form-group">
          <label class="sys-label">СТАТУС</label>
          <input class="sys-input" id="edit-character-status" value="${Utils.escape(character.status || '')}">
        </div>

        <div class="form-group">
          <label class="sys-label">МОНЕТЫ</label>
          <input class="sys-input" id="edit-character-coins" type="number" value="${character.coins || 0}">
        </div>

        <div class="form-group">
          <label class="sys-label">ОПИСАНИЕ</label>
          <textarea class="sys-textarea" id="edit-character-description">${Utils.escape(character.description || '')}</textarea>
        </div>

        <div class="form-group">
          <label class="sys-label">ХАРАКТЕРИСТИКИ — JSON</label>
          <textarea class="sys-textarea" id="edit-character-stats">${Utils.escape(JSON.stringify(stats, null, 2))}</textarea>
        </div>

        <div class="form-group">
          <label class="sys-label">НАВЫКИ — JSON</label>
          <textarea class="sys-textarea" id="edit-character-skills">${Utils.escape(JSON.stringify(skills, null, 2))}</textarea>
        </div>

        <div class="form-group">
          <label class="sys-label">СПОНСОР</label>
          <select class="sys-select" id="edit-character-sponsor">
            <option value="">— без спонсора —</option>
            ${State.sponsors.map((sponsor) => `
              <option value="${sponsor.id}" ${sponsor.id === character.sponsor_id ? 'selected' : ''}>
                ${Utils.escape(sponsor.name)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="sys-label">СКРЫТЫЕ ЗАМЕТКИ АДМИНА</label>
          <textarea class="sys-textarea" id="edit-character-admin-notes">${Utils.escape(character.admin_notes || '')}</textarea>
        </div>

        <button class="sys-btn primary" onclick="Admin.saveCharacter()">[ СОХРАНИТЬ ]</button>
      </div>
    `;
  },

  async saveCharacter() {
    const id = $('edit-character-id').value;

    let stats = {};
    let skills = [];

    try {
      stats = JSON.parse($('edit-character-stats').value || '{}');
      skills = JSON.parse($('edit-character-skills').value || '[]');
    } catch {
      Utils.toast('JSON характеристик или навыков заполнен неправильно.', 'error');
      return;
    }

    const payload = {
      character_name: $('edit-character-name').value.trim(),
      status: $('edit-character-status').value.trim(),
      coins: Number($('edit-character-coins').value || 0),
      description: $('edit-character-description').value.trim(),
      stats,
      skills,
      sponsor_id: $('edit-character-sponsor').value || null,
      admin_notes: $('edit-character-admin-notes').value.trim()
    };

    const { error } = await sb
      .from('profiles')
      .update(payload)
      .eq('id', id);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    Utils.toast('Персонаж обновлен.');
    await Admin.refresh();
    Admin.openCharacter(id);
  },

  renderMessages() {
    $('a-messages-list').innerHTML = Admin.messagesList(
      State.messages.filter((message) => !['scenario', 'choice', 'sponsor_choice'].includes(message.type))
    );
  },

  renderScenarios() {
    $('a-scenarios-list').innerHTML = Admin.messagesList(
      State.messages.filter((message) => message.type === 'scenario')
    );
  },

  renderChoices() {
    $('a-choices-list').innerHTML = Admin.messagesList(
      State.messages.filter((message) => ['choice', 'sponsor_choice'].includes(message.type))
    );
  },

  messagesList(messages) {
    return messages.length
      ? messages.map((message) => {
          const total = message.player_message_state?.length || 0;
          const read = message.player_message_state?.filter((state) => state.is_read).length || 0;
          const selected = message.player_message_state?.filter((state) => state.selected_choice_id).length || 0;

          return `
            <div class="message-card ${message.type}">
              <div class="message-meta">
                <span>[${Utils.messageType(message.type)}]</span>
                <span>${Utils.date(message.created_at)}</span>
              </div>
              <div class="message-title">${Utils.escape(message.title || 'Без названия')}</div>
              <div class="message-body">${Utils.escape(message.body || '')}</div>
              <div class="scenario-data">
                <div><span>Получатели:</span> <strong>${total}</strong></div>
                <div><span>Прочитали:</span> <strong>${read}</strong></div>
                ${['choice', 'sponsor_choice'].includes(message.type)
                  ? `<div><span>Сделали выбор:</span> <strong>${selected}</strong></div>`
                  : ''
                }
              </div>
              <div class="btn-row">
                <button class="sys-btn small" onclick="Admin.openMessageResults('${message.id}')">РЕЗУЛЬТАТЫ</button>
                <button class="sys-btn small" onclick="Admin.deleteMessage('${message.id}')">УДАЛИТЬ</button>
              </div>
            </div>
          `;
        }).join('')
      : Player.empty('Пока ничего не создано.');
  },

  openMessageModal(type = 'info', template = null) {
    const isScenario = type === 'scenario';
    const isChoice = ['choice', 'sponsor_choice'].includes(type);

    Modal.open(
      type === 'scenario'
        ? '[ НОВЫЙ СЦЕНАРИЙ ]'
        : type === 'sponsor_choice'
          ? '[ ВЫБОР СПОНСОРА ]'
          : type === 'choice'
            ? '[ НОВЫЙ ВЫБОР ]'
            : '[ НОВОЕ СООБЩЕНИЕ ]',
      `
      <input type="hidden" id="new-message-type" value="${type}">

      <div class="form-group">
        <label class="sys-label">ЗАГОЛОВОК</label>
        <input class="sys-input" id="new-message-title" value="${Utils.escape(template?.title || '')}">
      </div>

      <div class="form-group">
        <label class="sys-label">ТЕКСТ</label>
        <textarea class="sys-textarea" id="new-message-body">${Utils.escape(template?.body || '')}</textarea>
      </div>

      ${isScenario ? `
        <div class="form-group">
          <label class="sys-label">КАТЕГОРИЯ</label>
          <input class="sys-input" id="new-message-category" value="${Utils.escape(template?.category || 'Основной')}">
        </div>

        <div class="form-group">
          <label class="sys-label">СЛОЖНОСТЬ</label>
          <input class="sys-input" id="new-message-difficulty" value="${Utils.escape(template?.difficulty || 'F')}">
        </div>

        <div class="form-group">
          <label class="sys-label">ВРЕМЯ</label>
          <input class="sys-input" id="new-message-time" value="${Utils.escape(template?.time_text || '')}" placeholder="Например: 30 минут">
        </div>

        <div class="form-group">
          <label class="sys-label">НАГРАДА</label>
          <input class="sys-input" id="new-message-reward" value="${Utils.escape(template?.reward || '')}">
        </div>

        <div class="form-group">
          <label class="sys-label">УСЛОВИЕ ПРОВАЛА</label>
          <input class="sys-input" id="new-message-failure" value="${Utils.escape(template?.failure || '')}">
        </div>
      ` : ''}

      ${isChoice ? `
        <div class="form-group">
          <label class="sys-label">ВАРИАНТЫ ВЫБОРА — ОДИН НА КАЖДОЙ СТРОКЕ</label>
          <textarea class="sys-textarea" id="new-message-choices">${Utils.escape(
            template?.choices || (type === 'sponsor_choice'
              ? State.sponsors.map((sponsor) => sponsor.name).join('\n')
              : '')
          )}</textarea>
        </div>
      ` : ''}

      <div class="form-group">
        <label class="sys-label">ПОЛУЧАТЕЛИ</label>
        <select class="sys-select" id="new-message-targets" multiple size="5">
          <option value="all" selected>ВСЕ ИГРОКИ</option>
          ${State.characters
            .filter((character) => character.role === 'player')
            .map((character) => `
              <option value="${character.id}">${Utils.escape(character.character_name)}</option>
            `).join('')
          }
        </select>
        <div class="admin-character-meta">Чтобы выбрать нескольких — удерживайте Ctrl на компьютере.</div>
      </div>

      <div class="btn-row">
        <button class="sys-btn primary" onclick="Admin.createMessage()">[ ОТПРАВИТЬ ]</button>
        <button class="sys-btn" onclick="Modal.close()">ОТМЕНА</button>
      </div>
      `
    );
  },

  async createMessage() {
    const type = $('new-message-type').value;
    const title = $('new-message-title').value.trim();
    const body = $('new-message-body').value.trim();

    if (!title && !body) {
      Utils.toast('Введите заголовок или текст.', 'error');
      return;
    }

    const selectedTargets = Array.from($('new-message-targets').selectedOptions).map((option) => option.value);

    const recipientIds = selectedTargets.includes('all')
      ? State.characters.filter((character) => character.role === 'player').map((character) => character.id)
      : selectedTargets;

    if (!recipientIds.length) {
      Utils.toast('Выберите хотя бы одного получателя.', 'error');
      return;
    }

    const payload = {
      type,
      title,
      body,
      created_by: State.profile.id,
      category: $('new-message-category')?.value?.trim() || '',
      difficulty: $('new-message-difficulty')?.value?.trim() || '',
      time_text: $('new-message-time')?.value?.trim() || '',
      reward: $('new-message-reward')?.value?.trim() || '',
      failure: $('new-message-failure')?.value?.trim() || ''
    };

    const { data: message, error: messageError } = await sb
      .from('messages')
      .insert(payload)
      .select()
      .single();

    if (messageError) {
      Utils.toast(messageError.message, 'error');
      return;
    }

    if (['choice', 'sponsor_choice'].includes(type)) {
      const text = $('new-message-choices').value.trim();
      const choices = text
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item, index) => ({
          message_id: message.id,
          text: item,
          sort_order: index
        }));

      if (choices.length < 2) {
        await sb.from('messages').delete().eq('id', message.id);
        Utils.toast('Для выбора нужно минимум два варианта.', 'error');
        return;
      }

      const { error: choiceError } = await sb
        .from('message_choices')
        .insert(choices);

      if (choiceError) {
        Utils.toast(choiceError.message, 'error');
        return;
      }
    }

    const states = recipientIds.map((characterId) => ({
      character_id: characterId,
      message_id: message.id
    }));

    const { error: stateError } = await sb
      .from('player_message_state')
      .insert(states);

    if (stateError) {
      Utils.toast(stateError.message, 'error');
      return;
    }

    Modal.close();
    Utils.toast('Системное сообщение отправлено.');
    await Admin.refresh();
  },

  async deleteMessage(messageId) {
    if (!confirm('Удалить это сообщение у всех игроков?')) return;

    const { error } = await sb
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    Utils.toast('Сообщение удалено.');
    await Admin.refresh();
  },

  openMessageResults(messageId) {
    const message = State.messages.find((item) => item.id === messageId);
    if (!message) return;

    const rows = (message.player_message_state || []).map((state) => {
      const character = State.characters.find((item) => item.id === state.character_id);
      const choice = message.message_choices?.find((item) => item.id === state.selected_choice_id);

      return `
        <div class="data-row">
          <span>${Utils.escape(character?.character_name || 'Неизвестный')}</span>
          <strong>
            ${state.selected_choice_id
              ? `Выбор: ${Utils.escape(choice?.text || '—')}`
              : state.is_read
                ? 'Прочитано'
                : 'Не прочитано'
            }
          </strong>
        </div>
      `;
    }).join('');

    Modal.open(
      '[ РЕАКЦИИ ИГРОКОВ ]',
      `
      <div class="message-title">${Utils.escape(message.title || '')}</div>
      <div class="data-list" style="margin-top:14px">
        ${rows || Player.empty('Нет получателей.')}
      </div>
      `
    );
  },

  renderSponsors() {
    $('a-sponsors-list').innerHTML = State.sponsors.length
      ? State.sponsors.map((sponsor) => {
          const assigned = State.characters.filter((character) => character.sponsor_id === sponsor.id);

          return `
            <div class="message-card sponsor">
              <div class="message-title">${Utils.escape(sponsor.name)}</div>
              <div class="message-body">${Utils.escape(sponsor.title || '')}</div>
              <div class="scenario-data">
                <div><span>Игроки:</span> <strong>${assigned.map((item) => Utils.escape(item.character_name)).join(', ') || 'никто'}</strong></div>
              </div>
              <div class="btn-row">
                <button class="sys-btn small" onclick="Admin.openSponsorModal('${sponsor.id}')">РЕДАКТИРОВАТЬ</button>
                <button class="sys-btn small" onclick="Admin.deleteSponsor('${sponsor.id}')">УДАЛИТЬ</button>
              </div>
            </div>
          `;
        }).join('')
      : Player.empty('Спонсоры еще не созданы.');
  },

  openSponsorModal(sponsorId = null) {
    const sponsor = sponsorId
      ? State.sponsors.find((item) => item.id === sponsorId)
      : null;

    Modal.open(
      sponsor ? '[ РЕДАКТИРОВАНИЕ СПОНСОРА ]' : '[ НОВЫЙ СПОНСОР ]',
      `
      <input type="hidden" id="edit-sponsor-id" value="${sponsor?.id || ''}">

      <div class="form-group">
        <label class="sys-label">ИМЯ</label>
        <input class="sys-input" id="sponsor-name" value="${Utils.escape(sponsor?.name || '')}">
      </div>

      <div class="form-group">
        <label class="sys-label">ТИТУЛ</label>
        <input class="sys-input" id="sponsor-title" value="${Utils.escape(sponsor?.title || '')}">
      </div>

      <div class="form-group">
        <label class="sys-label">ОПИСАНИЕ</label>
        <textarea class="sys-textarea" id="sponsor-description">${Utils.escape(sponsor?.description || '')}</textarea>
      </div>

      <div class="form-group">
        <label class="sys-label">ОТНОШЕНИЕ К ПЕРСОНАЖУ</label>
        <textarea class="sys-textarea" id="sponsor-attitude">${Utils.escape(sponsor?.attitude || '')}</textarea>
      </div>

      <div class="form-group">
        <label class="sys-label">ДАРЫ / БОНУСЫ</label>
        <textarea class="sys-textarea" id="sponsor-bonuses">${Utils.escape(sponsor?.bonuses || '')}</textarea>
      </div>

      <div class="form-group">
        <label class="sys-label">СКРЫТЫЕ ЗАМЕТКИ АДМИНА</label>
        <textarea class="sys-textarea" id="sponsor-notes">${Utils.escape(sponsor?.admin_notes || '')}</textarea>
      </div>

      <div class="btn-row">
        <button class="sys-btn primary" onclick="Admin.saveSponsor()">[ СОХРАНИТЬ ]</button>
        <button class="sys-btn" onclick="Modal.close()">ОТМЕНА</button>
      </div>
      `
    );
  },

  async saveSponsor() {
    const id = $('edit-sponsor-id').value;
    const payload = {
      name: $('sponsor-name').value.trim(),
      title: $('sponsor-title').value.trim(),
      description: $('sponsor-description').value.trim(),
      attitude: $('sponsor-attitude').value.trim(),
      bonuses: $('sponsor-bonuses').value.trim(),
      admin_notes: $('sponsor-notes').value.trim()
    };

    if (!payload.name) {
      Utils.toast('Введите имя спонсора.', 'error');
      return;
    }

    const query = id
      ? sb.from('sponsors').update(payload).eq('id', id)
      : sb.from('sponsors').insert(payload);

    const { error } = await query;

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    Modal.close();
    Utils.toast('Спонсор сохранен.');
    await Admin.refresh();
  },

  async deleteSponsor(sponsorId) {
    if (!confirm('Удалить спонсора? Он будет снят с персонажей, у которых назначен.')) return;

    const { error } = await sb
      .from('sponsors')
      .delete()
      .eq('id', sponsorId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    Utils.toast('Спонсор удален.');
    await Admin.refresh();
  },

  renderTemplates() {
    $('a-templates-list').innerHTML = State.templates.length
      ? State.templates.map((template) => `
          <div class="message-card">
            <div class="message-meta">
              <span>[${Utils.messageType(template.type)}]</span>
            </div>
            <div class="message-title">${Utils.escape(template.name)}</div>
            <div class="message-body">${Utils.escape(template.title || '')}</div>
            <div class="btn-row" style="margin-top:12px">
              <button class="sys-btn small" onclick="Admin.useTemplate('${template.id}')">ИСПОЛЬЗОВАТЬ</button>
              <button class="sys-btn small" onclick="Admin.deleteTemplate('${template.id}')">УДАЛИТЬ</button>
            </div>
          </div>
        `).join('')
      : Player.empty('Шаблонов пока нет.');
  },

  openTemplateModal() {
    Modal.open(
      '[ НОВЫЙ ШАБЛОН ]',
      `
      <div class="form-group">
        <label class="sys-label">НАЗВАНИЕ ШАБЛОНА</label>
        <input class="sys-input" id="template-name">
      </div>

      <div class="form-group">
        <label class="sys-label">ТИП</label>
        <select class="sys-select" id="template-type">
          <option value="info">Сообщение</option>
          <option value="scenario">Сценарий</option>
          <option value="choice">Выбор</option>
          <option value="sponsor_choice">Выбор спонсора</option>
          <option value="warning">Предупреждение</option>
          <option value="result">Результат</option>
        </select>
      </div>

      <div class="form-group">
        <label class="sys-label">ЗАГОЛОВОК</label>
        <input class="sys-input" id="template-title">
      </div>

      <div class="form-group">
        <label class="sys-label">ТЕКСТ</label>
        <textarea class="sys-textarea" id="template-body"></textarea>
      </div>

      <div class="btn-row">
        <button class="sys-btn primary" onclick="Admin.saveTemplate()">[ СОХРАНИТЬ ]</button>
        <button class="sys-btn" onclick="Modal.close()">ОТМЕНА</button>
      </div>
      `
    );
  },

  async saveTemplate() {
    const payload = {
      name: $('template-name').value.trim(),
      type: $('template-type').value,
      title: $('template-title').value.trim(),
      body: $('template-body').value.trim()
    };

    if (!payload.name) {
      Utils.toast('Введите название шаблона.', 'error');
      return;
    }

    const { error } = await sb
      .from('message_templates')
      .insert(payload);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    Modal.close();
    Utils.toast('Шаблон сохранен.');
    await Admin.refresh();
  },

  useTemplate(templateId) {
    const template = State.templates.find((item) => item.id === templateId);
    if (!template) return;

    Admin.openMessageModal(template.type, template);
  },

  async deleteTemplate(templateId) {
    if (!confirm('Удалить шаблон?')) return;

    const { error } = await sb
      .from('message_templates')
      .delete()
      .eq('id', templateId);

    if (error) {
      Utils.toast(error.message, 'error');
      return;
    }

    await Admin.refresh();
  },

  renderLog() {
    $('a-log-list').innerHTML = State.actionLog.length
      ? State.actionLog.map((log) => `
          <div class="message-card">
            <div class="message-meta">
              <span>${Utils.escape(log.profiles?.character_name || 'Система')}</span>
              <span>${Utils.date(log.created_at)}</span>
            </div>
            <div class="message-body">${Utils.escape(log.detail || log.action)}</div>
          </div>
        `).join('')
      : Player.empty('Журнал пуст.');
  }
};

window.App = App;
window.Player = Player;
window.Admin = Admin;
window.Modal = Modal;

document.addEventListener('DOMContentLoaded', () => App.init());
