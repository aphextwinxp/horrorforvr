/**
 * main.js — точка входа игры «Ночная смена».
 *
 * Порядок запуска:
 *  1. Создаётся UI и показывается экран загрузки.
 *  2. Проверяется конфигурация и поддержка WebGL 2.
 *  3. Загружаются пользовательские настройки (localStorage) и определяется профиль устройства.
 *  4. Создаётся Game, строится форма настроек, подключаются обработчики меню и событий игры.
 *  5. game.init() создаёт рендерер и сцену и переводит игру в состояние MENU.
 *
 * Здесь же регистрируются системы игры (VR-контроллеры, игрок, ИИ, звук, сюжет):
 * каждая добавляется вызовом game.registerSystem(имя, объект, приоритет).
 */

import {
  CONFIG,
  VERSION,
  getDeviceProfile,
  loadSettings,
  resetSettings,
  sanitizeSettings,
  saveSettings,
  validateConfig
} from './config.js';
import { Game, GameMode, GameState } from './game.js';
import { UI } from './ui.js';

/* ==========================================================================
   Вспомогательные функции
   ========================================================================== */

function hasWebGL2() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2'));
  } catch (error) {
    return false;
  }
}

/**
 * Переводит причину недоступности VR в понятное сообщение для игрока.
 */
function describeVRSupport(support, deviceProfile) {
  if (support.supported) {
    return 'VR доступен (' + deviceProfile.label + '). Можно играть в шлеме или на ПК.';
  }
  switch (support.reason) {
    case 'no-webxr':
      return 'WebXR не найден в этом браузере — доступен режим ПК.';
    case 'insecure':
      return 'WebXR работает только по HTTPS (или на localhost) — доступен режим ПК.';
    case 'unsupported':
      return 'VR-шлем не обнаружен — доступен режим ПК.';
    default:
      return 'Не удалось проверить поддержку VR — доступен режим ПК.';
  }
}

function reportFatal(ui, error) {
  const message = error && error.message ? error.message : String(error);
  console.error('[main] фатальная ошибка:', error);
  if (typeof window.__NIGHT_SHIFT_FATAL__ === 'function') {
    window.__NIGHT_SHIFT_FATAL__(message);
    return;
  }
  if (ui) {
    ui.showError(message);
  }
}

/* ==========================================================================
   Запуск
   ========================================================================== */

async function bootstrap() {
  const ui = new UI(document);

  try {
    ui.setVersion(VERSION);
    ui.showScreen('loading');
    ui.setLoading(0.05, 'Проверка конфигурации…');

    const problems = validateConfig();
    for (let i = 0; i < problems.length; i++) {
      console.warn('[config] ' + problems[i]);
    }

    if (!hasWebGL2()) {
      throw new Error('Ваш браузер не поддерживает WebGL 2, без него игра не запустится.');
    }

    ui.setLoading(0.2, 'Загрузка настроек…');
    let settings = loadSettings();
    const deviceProfile = getDeviceProfile();

    ui.setLoading(0.4, 'Создание рендерера…');
    const canvas = document.getElementById('game-canvas');
    const game = new Game({
      canvas: canvas,
      settings: settings,
      deviceProfile: deviceProfile
    });

    ui.setLoading(0.6, 'Подготовка интерфейса…');
    ui.buildSettingsForm(CONFIG.SETTINGS_SCHEMA, CONFIG.SETTINGS_GROUPS, settings);
    ui.setSubtitlesEnabled(settings.subtitles);
    ui.setVignette(0);

    /* ---------- Обработчики меню ---------- */

    ui.setHandlers({
      onStartDesktop: function () {
        game.startDesktop();
      },

      onEnterVR: async function () {
        ui.setVRBusy(true);
        try {
          await game.enterVR();
        } catch (error) {
          console.error('[main] не удалось войти в VR:', error);
          ui.setStatusText('Не удалось войти в VR: ' + (error && error.message ? error.message : String(error)));
        } finally {
          ui.setVRBusy(false);
        }
      },

      onResume: function () {
        game.resume();
      },

      onRestartCheckpoint: function () {
        game.restartFromCheckpoint();
      },

      onQuitToMenu: function () {
        game.returnToMenu();
      },

      onSettingsChange: function (values) {
        settings = sanitizeSettings(values);
        if (!saveSettings(settings)) {
          console.warn('[main] настройки не сохранены: localStorage недоступен');
        }
        ui.setSubtitlesEnabled(settings.subtitles);
        game.applySettings(settings);
      },

      onSettingsReset: function () {
        settings = resetSettings();
        ui.setSettingsValues(settings);
        ui.setSubtitlesEnabled(settings.subtitles);
        game.applySettings(settings);
      }
    });

    /* ---------- События игры ---------- */

    game.on('ready', function (payload) {
      ui.setVRSupport(payload.vrSupport.supported, describeVRSupport(payload.vrSupport, deviceProfile));
    });

    game.on('statechange', function (payload) {
      if (payload.state === GameState.MENU) {
        ui.showHud(false);
        ui.setFade(false);
        ui.setPrompt(null);
        ui.clearSubtitle();
        ui.showScreen('main');
      } else if (payload.state === GameState.PLAYING) {
        ui.hideScreens();
        ui.showHud(payload.mode === GameMode.DESKTOP);
      } else if (payload.state === GameState.PAUSED) {
        if (payload.mode === GameMode.DESKTOP) {
          ui.showScreen('pause');
        }
      }
    });

    game.on('clockchange', function (payload) {
      ui.setClock(payload.text);
    });

    game.on('debug', function (payload) {
      ui.setDebug(payload.visible, payload.text);
    });

    game.on('adaptive', function (payload) {
      if (payload.step === 'suggest_lower_render_scale') {
        ui.setStatusText('Производительность низкая: уменьшите «Разрешение рендера» в настройках и войдите в VR заново.');
      }
    });

    game.on('contextlost', function () {
      reportFatal(ui, new Error('Графический контекст потерян. Перезагрузите страницу.'));
    });

    game.on('systemerror', function (payload) {
      if (payload.disabled) {
        console.warn('[main] система "' + payload.name + '" отключена из-за ошибок');
      }
    });

    /* ---------- Клавиатура: пауза и закрытие настроек ---------- */

    window.addEventListener('keydown', function (event) {
      if (event.code !== CONFIG.INPUT.KEYS.PAUSE || event.repeat) {
        return;
      }
      if (ui.isSettingsOpen()) {
        ui.closeSettings();
        event.preventDefault();
        return;
      }
      if (game.mode === GameMode.DESKTOP) {
        game.togglePause();
        event.preventDefault();
      }
    });

    /* ---------- Регистрация систем игры ---------- */
    /* На этом шаге систем ещё нет: они добавляются в следующих модулях
       (xr.js, input.js, player.js, interact.js, nav.js, enemy.js, audio.js, story.js). */

    ui.setLoading(0.85, 'Запуск игры…');
    await game.init();
    ui.setLoading(1, 'Готово');

    if (CONFIG.DEBUG.ENABLED_BY_URL) {
      window.NightShift = {
        game: game,
        ui: ui,
        getSettings: function () {
          return settings;
        }
      };
      console.info('[main] отладка включена: window.NightShift.game');
    }
  } catch (error) {
    reportFatal(ui, error);
  }
}

bootstrap();
