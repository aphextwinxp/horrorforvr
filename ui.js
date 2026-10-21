/**
 * ui.js — HTML-интерфейс игры (ПК-режим и страница вокруг VR-сессии).
 *
 * Отвечает за экраны (загрузка, главное меню, настройки, пауза, ошибка),
 * форму настроек (строится из CONFIG.SETTINGS_SCHEMA), HUD ПК (часы, подсказка, субтитры),
 * отладочный оверлей и кнопку входа в VR.
 *
 * Здесь нет игровой логики: модуль только показывает состояние и вызывает обработчики,
 * которые назначает main.js через setHandlers().
 * Внутри VR используются 3D-панели (отдельный модуль), этот файл на них не влияет.
 */

/* Идентификаторы элементов из index.html */
const ELEMENT_IDS = {
  canvas: 'game-canvas',
  hud: 'hud',
  hudPrompt: 'hud-prompt',
  hudClock: 'hud-clock',
  subtitles: 'subtitles',
  desktopVignette: 'desktop-vignette',
  fadeOverlay: 'fade-overlay',
  loadingScreen: 'loading-screen',
  loadingBar: 'loading-bar',
  loadingText: 'loading-text',
  mainMenu: 'main-menu',
  btnStartDesktop: 'btn-start-desktop',
  vrButtonSlot: 'vr-button-slot',
  btnOpenSettings: 'btn-open-settings',
  btnControls: 'btn-controls',
  controlsHelp: 'controls-help',
  xrStatus: 'xr-status',
  menuVersion: 'menu-version',
  settingsPanel: 'settings-panel',
  settingsForm: 'settings-form',
  btnSettingsReset: 'btn-settings-reset',
  btnSettingsClose: 'btn-settings-close',
  pauseMenu: 'pause-menu',
  btnResume: 'btn-resume',
  btnPauseSettings: 'btn-pause-settings',
  btnRestartCheckpoint: 'btn-restart-checkpoint',
  btnQuitMenu: 'btn-quit-menu',
  errorPanel: 'error-panel',
  errorMessage: 'error-message',
  debugOverlay: 'debug-overlay'
};

const VR_LABEL_READY = 'Войти в VR';
const VR_LABEL_BUSY = 'Запуск VR…';
const VR_LABEL_UNAVAILABLE = 'VR недоступен';

function noop() {
  /* Обработчик по умолчанию: ничего не делает, пока main.js не назначит свой. */
}

export class UI {

  /**
   * @param {Document} doc — документ страницы (по умолчанию глобальный document)
   */
  constructor(doc) {
    this.doc = doc || document;
    this.el = {};

    this.handlers = {
      onStartDesktop: noop,
      onEnterVR: noop,
      onResume: noop,
      onRestartCheckpoint: noop,
      onQuitToMenu: noop,
      onSettingsChange: noop,
      onSettingsReset: noop
    };

    this.settingsReturnTarget = 'main';
    this.settingsControls = new Map();
    this.settingsSchema = [];
    this.subtitlesEnabled = true;
    this.subtitleTimer = null;
    this.vrButton = null;
    this.vrSupported = false;

    this._collectElements();
    this._createVRButton();
    this._bindStaticEvents();
  }

  /* ========================================================================
     Подготовка
     ======================================================================== */

  _collectElements() {
    const names = Object.keys(ELEMENT_IDS);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const element = this.doc.getElementById(ELEMENT_IDS[name]);
      if (!element) {
        throw new Error('В index.html не найден элемент #' + ELEMENT_IDS[name]);
      }
      this.el[name] = element;
    }
  }

  _createVRButton() {
    const button = this.doc.createElement('button');
    button.id = 'btn-enter-vr';
    button.type = 'button';
    button.className = 'btn';
    button.textContent = VR_LABEL_UNAVAILABLE;
    button.disabled = true;
    this.el.vrButtonSlot.appendChild(button);
    this.vrButton = button;
  }

  _bindStaticEvents() {
    const self = this;

    this.el.btnStartDesktop.addEventListener('click', function () {
      self.handlers.onStartDesktop();
    });

    this.vrButton.addEventListener('click', function () {
      self.handlers.onEnterVR();
    });

    this.el.btnOpenSettings.addEventListener('click', function () {
      self.openSettings('main');
    });

    this.el.btnControls.addEventListener('click', function () {
      const willShow = self.el.controlsHelp.classList.contains('hidden');
      self.el.controlsHelp.classList.toggle('hidden', !willShow);
      self.el.btnControls.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    });

    this.el.btnSettingsClose.addEventListener('click', function () {
      self.closeSettings();
    });

    this.el.btnSettingsReset.addEventListener('click', function () {
      self.handlers.onSettingsReset();
    });

    this.el.btnResume.addEventListener('click', function () {
      self.handlers.onResume();
    });

    this.el.btnPauseSettings.addEventListener('click', function () {
      self.openSettings('pause');
    });

    this.el.btnRestartCheckpoint.addEventListener('click', function () {
      self.handlers.onRestartCheckpoint();
    });

    this.el.btnQuitMenu.addEventListener('click', function () {
      self.handlers.onQuitToMenu();
    });

    this.el.settingsForm.addEventListener('submit', function (event) {
      event.preventDefault();
    });

    this.el.canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });
  }

  /**
   * Назначает обработчики действий интерфейса. Неизвестные ключи игнорируются.
   */
  setHandlers(handlers) {
    const keys = Object.keys(this.handlers);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (handlers && typeof handlers[key] === 'function') {
        this.handlers[key] = handlers[key];
      }
    }
  }

  /* ========================================================================
     Экраны
     ======================================================================== */

  _screenMap() {
    return {
      loading: this.el.loadingScreen,
      main: this.el.mainMenu,
      settings: this.el.settingsPanel,
      pause: this.el.pauseMenu
    };
  }

  /**
   * Показывает один экран ('loading' | 'main' | 'settings' | 'pause') и скрывает остальные.
   * Передайте null, чтобы скрыть все экраны (панель ошибки не затрагивается).
   */
  showScreen(name) {
    const map = this._screenMap();
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
      map[keys[i]].classList.toggle('hidden', keys[i] !== name);
    }

    if (name === 'main') {
      this._focusElement(this.el.btnStartDesktop);
    } else if (name === 'pause') {
      this._focusElement(this.el.btnResume);
    } else if (name === 'settings') {
      this._focusElement(this.el.btnSettingsClose);
    }
  }

  hideScreens() {
    this.showScreen(null);
  }

  _focusElement(element) {
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      /* Фокус необязателен: на некоторых платформах элемент может не принять фокус. */
    }
  }

  /**
   * Открывает настройки. returnTo — экран, на который вернуться при закрытии ('main' | 'pause').
   */
  openSettings(returnTo) {
    this.settingsReturnTarget = returnTo === 'pause' ? 'pause' : 'main';
    this.showScreen('settings');
  }

  closeSettings() {
    if (!this.isSettingsOpen()) {
      return;
    }
    this.showScreen(this.settingsReturnTarget);
  }

  isSettingsOpen() {
    return !this.el.settingsPanel.classList.contains('hidden');
  }

  /* ========================================================================
     Загрузка и ошибки
     ======================================================================== */

  /**
   * progress — от 0 до 1; text — подпись под индикатором.
   */
  setLoading(progress, text) {
    const clamped = Math.min(1, Math.max(0, Number(progress) || 0));
    const percent = Math.round(clamped * 100);
    this.el.loadingBar.style.width = percent + '%';
    const track = this.el.loadingBar.parentElement;
    if (track) {
      track.setAttribute('aria-valuenow', String(percent));
    }
    if (typeof text === 'string') {
      this.el.loadingText.textContent = text;
    }
  }

  showError(message) {
    this.el.errorMessage.textContent = String(message);
    this.el.loadingScreen.classList.add('hidden');
    this.el.errorPanel.classList.remove('hidden');
  }

  /* ========================================================================
     Главное меню и VR
     ======================================================================== */

  setVersion(version) {
    this.el.menuVersion.textContent = String(version);
  }

  /**
   * Обновляет доступность кнопки VR и строку статуса.
   */
  setVRSupport(supported, message) {
    this.vrSupported = Boolean(supported);
    this.vrButton.disabled = !this.vrSupported;
    this.vrButton.textContent = this.vrSupported ? VR_LABEL_READY : VR_LABEL_UNAVAILABLE;
    this.vrButton.classList.toggle('btn-primary', this.vrSupported);
    if (typeof message === 'string') {
      this.el.xrStatus.textContent = message;
    }
  }

  /**
   * Блокирует кнопку VR на время запуска сессии.
   */
  setVRBusy(busy) {
    if (busy) {
      this.vrButton.disabled = true;
      this.vrButton.textContent = VR_LABEL_BUSY;
      return;
    }
    this.vrButton.disabled = !this.vrSupported;
    this.vrButton.textContent = this.vrSupported ? VR_LABEL_READY : VR_LABEL_UNAVAILABLE;
  }

  setStatusText(message) {
    this.el.xrStatus.textContent = String(message);
  }

  /* ========================================================================
     HUD (ПК)
     ======================================================================== */

  showHud(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  setClock(text) {
    this.el.hudClock.textContent = String(text);
  }

  /**
   * Показывает подсказку действия возле прицела; пустое значение скрывает её.
   */
  setPrompt(text) {
    if (!text) {
      this.el.hudPrompt.classList.add('hidden');
      this.el.hudPrompt.textContent = '';
      return;
    }
    this.el.hudPrompt.textContent = String(text);
    this.el.hudPrompt.classList.remove('hidden');
  }

  setSubtitlesEnabled(enabled) {
    this.subtitlesEnabled = Boolean(enabled);
    if (!this.subtitlesEnabled) {
      this.clearSubtitle();
    }
  }

  /**
   * Показывает субтитр на заданное число секунд (если субтитры включены).
   */
  showSubtitle(text, seconds) {
    if (!this.subtitlesEnabled || !text) {
      this.clearSubtitle();
      return;
    }
    if (this.subtitleTimer !== null) {
      clearTimeout(this.subtitleTimer);
      this.subtitleTimer = null;
    }
    this.el.subtitles.textContent = String(text);
    this.el.subtitles.classList.remove('hidden');

    const duration = typeof seconds === 'number' && seconds > 0 ? seconds : 4;
    const self = this;
    this.subtitleTimer = setTimeout(function () {
      self.clearSubtitle();
    }, duration * 1000);
  }

  clearSubtitle() {
    if (this.subtitleTimer !== null) {
      clearTimeout(this.subtitleTimer);
      this.subtitleTimer = null;
    }
    this.el.subtitles.textContent = '';
    this.el.subtitles.classList.add('hidden');
  }

  /**
   * Сила виньетки ПК (0..1) через CSS-переменную.
   */
  setVignette(strength) {
    const clamped = Math.min(1, Math.max(0, Number(strength) || 0));
    this.doc.documentElement.style.setProperty('--vignette-strength', String(clamped));
  }

  /**
   * Затемнение экрана (смерть, переходы).
   */
  setFade(visible) {
    this.el.fadeOverlay.classList.toggle('is-visible', Boolean(visible));
  }

  setDebug(visible, text) {
    this.el.debugOverlay.classList.toggle('hidden', !visible);
    if (visible && typeof text === 'string') {
      this.el.debugOverlay.textContent = text;
    }
  }

  /* ========================================================================
     Форма настроек
     ======================================================================== */

  /**
   * Строит форму настроек из схемы. Вызывайте один раз при старте.
   */
  buildSettingsForm(schema, groups, values) {
    const form = this.el.settingsForm;
    form.textContent = '';
    this.settingsControls = new Map();
    this.settingsSchema = schema.slice();

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const entries = schema.filter(function (entry) {
        return entry.group === group.id;
      });
      if (entries.length === 0) {
        continue;
      }

      const section = this.doc.createElement('section');
      section.className = 'setting-group';

      const title = this.doc.createElement('h3');
      title.className = 'setting-group-title';
      title.textContent = group.label;
      section.appendChild(title);

      for (let e = 0; e < entries.length; e++) {
        section.appendChild(this._createSettingRow(entries[e]));
      }

      form.appendChild(section);
    }

    this.setSettingsValues(values);
  }

  _createSettingRow(entry) {
    const self = this;
    const inputId = 'setting-' + entry.key;

    const row = this.doc.createElement('div');
    row.className = 'setting-row';

    const label = this.doc.createElement('label');
    label.className = 'setting-label';
    label.htmlFor = inputId;
    label.textContent = entry.label;
    row.appendChild(label);

    const control = this.doc.createElement('div');
    control.className = 'setting-control';

    if (entry.type === 'select') {
      const select = this.doc.createElement('select');
      select.id = inputId;
      select.name = entry.key;
      for (let i = 0; i < entry.options.length; i++) {
        const option = this.doc.createElement('option');
        option.value = String(entry.options[i].value);
        option.textContent = entry.options[i].label;
        select.appendChild(option);
      }
      select.addEventListener('change', function () {
        self._emitSettingsChange();
      });
      control.appendChild(select);
      this.settingsControls.set(entry.key, { entry: entry, input: select, valueLabel: null });
    } else if (entry.type === 'range') {
      const range = this.doc.createElement('input');
      range.type = 'range';
      range.id = inputId;
      range.name = entry.key;
      range.min = String(entry.min);
      range.max = String(entry.max);
      range.step = String(entry.step);

      const valueLabel = this.doc.createElement('span');
      valueLabel.className = 'setting-value';

      range.addEventListener('input', function () {
        valueLabel.textContent = self._formatRangeValue(entry, Number(range.value));
      });
      range.addEventListener('change', function () {
        self._emitSettingsChange();
      });

      control.appendChild(range);
      control.appendChild(valueLabel);
      this.settingsControls.set(entry.key, { entry: entry, input: range, valueLabel: valueLabel });
    } else {
      const checkbox = this.doc.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = inputId;
      checkbox.name = entry.key;
      checkbox.addEventListener('change', function () {
        self._emitSettingsChange();
      });
      control.appendChild(checkbox);
      this.settingsControls.set(entry.key, { entry: entry, input: checkbox, valueLabel: null });
    }

    row.appendChild(control);

    if (typeof entry.hint === 'string' && entry.hint.length > 0) {
      const hint = this.doc.createElement('p');
      hint.className = 'setting-hint';
      hint.textContent = entry.hint;
      row.appendChild(hint);
    }

    return row;
  }

  _formatRangeValue(entry, value) {
    let decimals = 0;
    const stepText = String(entry.step);
    const dotIndex = stepText.indexOf('.');
    if (dotIndex !== -1) {
      decimals = stepText.length - dotIndex - 1;
    }
    return value.toFixed(decimals);
  }

  /**
   * Заполняет элементы формы значениями настроек.
   */
  setSettingsValues(values) {
    const self = this;
    this.settingsControls.forEach(function (control, key) {
      const value = values[key];
      const entry = control.entry;

      if (entry.type === 'toggle') {
        control.input.checked = Boolean(value);
      } else if (entry.type === 'range') {
        control.input.value = String(value);
        control.valueLabel.textContent = self._formatRangeValue(entry, Number(control.input.value));
      } else {
        control.input.value = String(value);
      }
    });
  }

  /**
   * Считывает значения из формы в объект настроек (типы приводятся по схеме).
   */
  readSettingsValues() {
    const result = {};
    this.settingsControls.forEach(function (control, key) {
      const entry = control.entry;

      if (entry.type === 'toggle') {
        result[key] = control.input.checked;
      } else if (entry.type === 'range') {
        result[key] = Number(control.input.value);
      } else {
        let matched = entry.default;
        for (let i = 0; i < entry.options.length; i++) {
          if (String(entry.options[i].value) === control.input.value) {
            matched = entry.options[i].value;
            break;
          }
        }
        result[key] = matched;
      }
    });
    return result;
  }

  _emitSettingsChange() {
    this.handlers.onSettingsChange(this.readSettingsValues());
  }
}
