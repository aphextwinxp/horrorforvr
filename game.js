/**
 * game.js — ядро игры «Ночная смена».
 *
 * Отвечает за:
 *  - WebGL-рендерер с включённым WebXR, сцену, камеру и rig игрока;
 *  - главный игровой цикл (renderer.setAnimationLoop) с фиксированным шагом для физики/ИИ;
 *  - реестр систем (VR-контроллеры, игрок, физика, ИИ, звук, сюжет и т.д.);
 *  - состояния игры (меню, игра, пауза) и режимы (ПК, VR);
 *  - жизненный цикл WebXR-сессии;
 *  - адаптивную деградацию качества на Quest и отладочную статистику.
 *
 * Система — это любой объект с необязательными хуками:
 *   init(game)                      — один раз при старте (может быть async)
 *   fixedUpdate(fixedDt, game)      — фиксированный шаг (1/60 с), для физики и ИИ
 *   update(dt, elapsed, frame, game)— каждый кадр
 *   lateUpdate(dt, elapsed, frame, game) — после всех update (камера, UI в мире)
 *   onRunStart(mode, game)          — начался новый забег ('desktop' | 'vr')
 *   onRunEnd(game)                  — забег закончен (возврат в меню)
 *   onCheckpointRestart(storyTime, game)
 *   onStateChange(state, prevState, game)
 *   onSettingsChanged(settings, game)
 *   onVRStart(session, game) / onVREnd(game)
 *   onAdaptiveStep(stepId, game)
 *   dispose(game)
 *
 * События игры (game.on / game.off): 'ready', 'statechange', 'modechange', 'clockchange',
 * 'settingschange', 'vrsessionstart', 'vrsessionend', 'checkpointrestart', 'adaptive',
 * 'debug', 'systemerror', 'contextlost', 'contextrestored'.
 */

import * as THREE from 'three';
import {
  CONFIG,
  formatClock,
  resolveRenderScale,
  sanitizeSettings,
  storySecondsToClockMinutes
} from './config.js';

/* ==========================================================================
   Константы цикла (локальные, на уровне ядра)
   ========================================================================== */

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FIXED_STEPS_PER_FRAME = 5;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_SYSTEM_ERRORS = 3;
const PERF_WARNING_INTERVAL_SECONDS = 5;

export const GameState = Object.freeze({
  BOOT: 'boot',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused'
});

export const GameMode = Object.freeze({
  DESKTOP: 'desktop',
  VR: 'vr'
});

/* ==========================================================================
   Вспомогательные функции освобождения ресурсов
   ========================================================================== */

function disposeMaterial(material) {
  const keys = Object.keys(material);
  for (let i = 0; i < keys.length; i++) {
    const value = material[keys[i]];
    if (value && value.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

/**
 * Освобождает геометрии, материалы и текстуры всей иерархии объектов.
 */
function disposeObject(root) {
  root.traverse(function (object) {
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (let i = 0; i < materials.length; i++) {
        disposeMaterial(materials[i]);
      }
    }
    if (object.isInstancedMesh && typeof object.dispose === 'function') {
      object.dispose();
    }
  });
}

/* ==========================================================================
   Класс Game
   ========================================================================== */

export class Game {

  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {object} options.settings        — пользовательские настройки (см. config.js)
   * @param {object} options.deviceProfile   — профиль устройства (getDeviceProfile)
   */
  constructor(options) {
    if (!options || !options.canvas) {
      throw new Error('Game: не передан canvas');
    }
    if (!options.deviceProfile) {
      throw new Error('Game: не передан deviceProfile');
    }

    this.canvas = options.canvas;
    this.settings = sanitizeSettings(options.settings);
    this.deviceProfile = options.deviceProfile;

    /* Three.js */
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.rig = null;
    this.hemisphereLight = null;
    this.levelRoot = null;
    this.isDebugRoomActive = false;

    /* Состояние */
    this.state = GameState.BOOT;
    this.mode = GameMode.DESKTOP;
    this.initialized = false;
    this.disposed = false;
    this.vrRequestPending = false;

    /* Системы и события */
    this.systems = [];
    this.systemCounter = 0;
    this.listeners = new Map();
    this.dynamicLights = [];

    /* Время */
    this.elapsed = 0;
    this.storyTime = 0;
    this.clockMinutes = CONFIG.STORY.START_MINUTES;
    this.lastClockText = '';
    this.fixedAccumulator = 0;
    this.lastFrameTime = null;
    this.frameCounter = 0;

    /* Спавн и чекпоинт */
    this.spawn = { x: 0, z: 3, yaw: 0 };
    this.checkpoint = { storyTime: 0, x: 0, z: 3, yaw: 0 };

    /* VR */
    this.vrSupport = { supported: false, reason: 'unchecked' };
    this.vrSession = null;

    /* Производительность */
    this.perf = {
      windowTime: 0,
      windowFrames: 0,
      sinceAdaptation: 0,
      fps: 0,
      frameMs: 0,
      calls: 0,
      callsPerView: 0,
      triangles: 0,
      viewCount: 1,
      geometries: 0,
      textures: 0,
      sinceWarning: PERF_WARNING_INTERVAL_SECONDS
    };

    /* Адаптивная деградация */
    this.baseFogDensity = CONFIG.ATMOSPHERE.FOG_DENSITY;
    this.adaptive = {
      level: 0,
      foveationMax: false,
      extraLightsOff: false,
      fogMultiplier: 1,
      cullFarRooms: false,
      suggestLowerRenderScale: false
    };

    /* Отладка */
    this.debugTimerMs = 0;
    this.lastDebugVisible = false;

    /* Привязанные обработчики */
    this._onFrame = this._onFrame.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onContextLost = this._onContextLost.bind(this);
    this._onContextRestored = this._onContextRestored.bind(this);
    this._onXRSessionStart = this._onXRSessionStart.bind(this);
    this._onXRSessionEnd = this._onXRSessionEnd.bind(this);
  }

  /* ========================================================================
     События
     ======================================================================== */

  /**
   * Подписка на событие. Возвращает функцию отписки.
   */
  on(type, listener) {
    const existing = this.listeners.get(type) || [];
    this.listeners.set(type, existing.concat([listener]));
    const self = this;
    return function unsubscribe() {
      self.off(type, listener);
    };
  }

  off(type, listener) {
    const existing = this.listeners.get(type);
    if (!existing) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index === -1) {
      return;
    }
    const copy = existing.slice();
    copy.splice(index, 1);
    this.listeners.set(type, copy);
  }

  emit(type, payload) {
    const list = this.listeners.get(type);
    if (!list) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (error) {
        console.error('[game] ошибка в обработчике события "' + type + '":', error);
      }
    }
  }

  /* ========================================================================
     Инициализация
     ======================================================================== */

  async init() {
    if (this.initialized) {
      return;
    }

    this._createRenderer();
    this._createScene();
    this._createCamera();
    this._createLights();
    this._createDebugRoom();
    this._bindEvents();

    this.vrSupport = await this.checkVRSupport();

    this._resetDesktopCamera();
    this.placeRig(this.spawn.x, this.spawn.z, this.spawn.yaw);

    const entries = this.systems.slice();
    for (let i = 0; i < entries.length; i++) {
      await this._initSystem(entries[i]);
    }

    this.renderer.setAnimationLoop(this._onFrame);
    this.initialized = true;
    this._setState(GameState.MENU);
    this.emit('ready', { vrSupport: this.vrSupport });
  }

  _createRenderer() {
    const render = CONFIG.RENDER;
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: render.ANTIALIAS,
      alpha: render.ALPHA,
      stencil: render.STENCIL,
      depth: render.DEPTH,
      powerPreference: render.POWER_PREFERENCE
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.deviceProfile.pixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(CONFIG.ATMOSPHERE.BACKGROUND_COLOR, 1);
    renderer.shadowMap.enabled = render.SHADOWS_ENABLED;

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType(render.XR_REFERENCE_SPACE);
    renderer.xr.setFoveation(this._effectiveFoveation());
    renderer.xr.addEventListener('sessionstart', this._onXRSessionStart);
    renderer.xr.addEventListener('sessionend', this._onXRSessionEnd);

    this.renderer = renderer;
  }

  _createScene() {
    const atmosphere = CONFIG.ATMOSPHERE;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(atmosphere.BACKGROUND_COLOR);
    this.scene.fog = new THREE.FogExp2(atmosphere.FOG_COLOR, this.baseFogDensity);
  }

  _createCamera() {
    const render = CONFIG.RENDER;
    const aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(render.DESKTOP_FOV, aspect, render.CAMERA_NEAR, render.CAMERA_FAR);
    this.camera.name = 'player-camera';

    this.rig = new THREE.Group();
    this.rig.name = 'player-rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);
  }

  _createLights() {
    const atmosphere = CONFIG.ATMOSPHERE;
    this.hemisphereLight = new THREE.HemisphereLight(
      atmosphere.HEMISPHERE_SKY_COLOR,
      atmosphere.HEMISPHERE_GROUND_COLOR,
      atmosphere.HEMISPHERE_INTENSITY
    );
    this.hemisphereLight.name = 'hemisphere-light';
    this.scene.add(this.hemisphereLight);
  }

  /**
   * Временная отладочная комната 12×8 м (размер торгового зала).
   * Заменяется настоящим уровнем через setLevelRoot() из level.js.
   */
  _createDebugRoom() {
    const level = CONFIG.LEVEL;
    const atmosphere = CONFIG.ATMOSPHERE;
    const room = new THREE.Group();
    room.name = 'debug-room';

    const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x4a4f57 });
    const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x33363c });
    const furnitureMaterial = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
    const lampMaterial = new THREE.MeshBasicMaterial({ color: atmosphere.LAMP_COLOR });
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xc8452c });

    const width = 12;
    const depth = 8;
    const height = level.WALL_HEIGHT;
    const thickness = level.WALL_THICKNESS;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'debug-floor';
    room.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    ceiling.name = 'debug-ceiling';
    room.add(ceiling);

    const northWall = new THREE.Mesh(new THREE.BoxGeometry(width + thickness * 2, height, thickness), wallMaterial);
    northWall.position.set(0, height / 2, -(depth / 2 + thickness / 2));
    northWall.name = 'debug-wall-north';
    room.add(northWall);

    const southWall = new THREE.Mesh(new THREE.BoxGeometry(width + thickness * 2, height, thickness), wallMaterial);
    southWall.position.set(0, height / 2, depth / 2 + thickness / 2);
    southWall.name = 'debug-wall-south';
    room.add(southWall);

    const westWall = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, depth), wallMaterial);
    westWall.position.set(-(width / 2 + thickness / 2), height / 2, 0);
    westWall.name = 'debug-wall-west';
    room.add(westWall);

    const eastWall = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, depth), wallMaterial);
    eastWall.position.set(width / 2 + thickness / 2, height / 2, 0);
    eastWall.name = 'debug-wall-east';
    room.add(eastWall);

    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.8), furnitureMaterial);
    counter.position.set(-3.5, 0.5, 2.6);
    counter.name = 'debug-counter';
    room.add(counter);

    const shelfA = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 3.0), furnitureMaterial);
    shelfA.position.set(1.5, 0.9, -1.2);
    shelfA.name = 'debug-shelf-a';
    room.add(shelfA);

    const shelfB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 3.0), furnitureMaterial);
    shelfB.position.set(3.2, 0.9, -1.2);
    shelfB.name = 'debug-shelf-b';
    room.add(shelfB);

    const lampFixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.3), lampMaterial);
    lampFixture.position.set(0, height - 0.05, 0);
    lampFixture.name = 'debug-lamp-fixture';
    room.add(lampFixture);

    const orientationMarker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.05), markerMaterial);
    orientationMarker.position.set(0, 1.5, -(depth / 2) + 0.03);
    orientationMarker.name = 'debug-north-marker';
    room.add(orientationMarker);

    const lamp = new THREE.PointLight(
      atmosphere.LAMP_COLOR,
      atmosphere.LAMP_INTENSITY,
      atmosphere.LAMP_DISTANCE,
      atmosphere.LAMP_DECAY
    );
    lamp.position.set(0, height - 0.3, 0);
    lamp.name = 'debug-lamp';
    room.add(lamp);
    this.registerDynamicLight(lamp, { essential: false });

    this.scene.add(room);
    this.levelRoot = room;
    this.isDebugRoomActive = true;
  }

  _bindEvents() {
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
  }

  _unbindEvents() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored, false);
  }

  /* ========================================================================
     Обработчики окружения
     ======================================================================== */

  _onResize() {
    this.resize();
  }

  resize() {
    if (!this.renderer || !this.camera) {
      return;
    }
    if (this.renderer.xr.isPresenting) {
      return;
    }
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.deviceProfile.pixelRatioCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _onVisibilityChange() {
    if (document.hidden && this.state === GameState.PLAYING && this.mode === GameMode.DESKTOP) {
      this.pause();
    }
  }

  _onContextLost(event) {
    event.preventDefault();
    this.emit('contextlost', {});
  }

  _onContextRestored() {
    this.emit('contextrestored', {});
  }

  /* ========================================================================
     Системы
     ======================================================================== */

  /**
   * Регистрирует систему. Чем меньше priority, тем раньше она вызывается в кадре.
   * Если игра уже инициализирована, init() системы вызывается сразу.
   */
  registerSystem(name, system, priority) {
    if (!name || typeof name !== 'string') {
      throw new Error('registerSystem: имя системы должно быть непустой строкой');
    }
    if (!system || typeof system !== 'object') {
      throw new Error('registerSystem: система "' + name + '" должна быть объектом');
    }
    if (this.getSystem(name)) {
      throw new Error('registerSystem: система "' + name + '" уже зарегистрирована');
    }

    const entry = {
      name: name,
      system: system,
      priority: typeof priority === 'number' ? priority : 0,
      order: this.systemCounter++,
      enabled: true,
      errors: 0
    };

    this.systems = this.systems.concat([entry]).sort(function (a, b) {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.order - b.order;
    });

    if (this.initialized) {
      const self = this;
      this._initSystem(entry).catch(function (error) {
        self._reportSystemError(entry, 'init', error);
      });
    }

    return system;
  }

  unregisterSystem(name) {
    const entry = this._findEntry(name);
    if (!entry) {
      return false;
    }
    this._callHook(entry, 'dispose', [this]);
    this.systems = this.systems.filter(function (item) {
      return item !== entry;
    });
    return true;
  }

  getSystem(name) {
    const entry = this._findEntry(name);
    return entry ? entry.system : null;
  }

  setSystemEnabled(name, enabled) {
    const entry = this._findEntry(name);
    if (!entry) {
      return false;
    }
    entry.enabled = Boolean(enabled);
    if (entry.enabled) {
      entry.errors = 0;
    }
    return true;
  }

  _findEntry(name) {
    for (let i = 0; i < this.systems.length; i++) {
      if (this.systems[i].name === name) {
        return this.systems[i];
      }
    }
    return null;
  }

  async _initSystem(entry) {
    const hook = entry.system.init;
    if (typeof hook !== 'function') {
      return;
    }
    try {
      await hook.call(entry.system, this);
    } catch (error) {
      this._reportSystemError(entry, 'init', error);
      entry.enabled = false;
    }
  }

  _callHook(entry, hookName, args) {
    if (!entry.enabled && hookName !== 'dispose') {
      return;
    }
    const hook = entry.system[hookName];
    if (typeof hook !== 'function') {
      return;
    }
    try {
      hook.apply(entry.system, args);
    } catch (error) {
      this._reportSystemError(entry, hookName, error);
    }
  }

  _notifySystems(hookName, args) {
    const list = this.systems;
    for (let i = 0; i < list.length; i++) {
      this._callHook(list[i], hookName, args);
    }
  }

  _reportSystemError(entry, hookName, error) {
    entry.errors += 1;
    console.error('[game] ошибка в системе "' + entry.name + '" (' + hookName + '):', error);
    if (entry.errors >= MAX_SYSTEM_ERRORS) {
      entry.enabled = false;
      console.error('[game] система "' + entry.name + '" отключена после ' + MAX_SYSTEM_ERRORS + ' ошибок');
    }
    this.emit('systemerror', { name: entry.name, hook: hookName, error: error, disabled: !entry.enabled });
  }

  /* ========================================================================
     Свет и уровень
     ======================================================================== */

  /**
   * Регистрирует динамический источник света для учёта бюджета.
   * essential = true — свет не отключается адаптивной деградацией (например, фонарик).
   */
  registerDynamicLight(light, options) {
    const essential = Boolean(options && options.essential);
    this.dynamicLights.push({ light: light, essential: essential });

    const budget = this.deviceProfile.maxDynamicLights;
    if (this.dynamicLights.length > budget && CONFIG.DEBUG.LOG_PERF_WARNINGS) {
      console.warn('[game] динамических источников света ' + this.dynamicLights.length +
        ', бюджет профиля "' + this.deviceProfile.id + '": ' + budget);
    }
    if (this.adaptive.extraLightsOff && !essential) {
      light.visible = false;
    }
  }

  unregisterDynamicLight(light) {
    this.dynamicLights = this.dynamicLights.filter(function (item) {
      return item.light !== light;
    });
  }

  /**
   * Подменяет корневой объект уровня. Старый (или отладочная комната) удаляется и освобождается.
   */
  setLevelRoot(root) {
    if (!root || !root.isObject3D) {
      throw new Error('setLevelRoot: ожидается THREE.Object3D');
    }
    if (this.levelRoot) {
      const previous = this.levelRoot;
      const self = this;
      previous.traverse(function (object) {
        if (object.isLight) {
          self.unregisterDynamicLight(object);
        }
      });
      this.scene.remove(previous);
      disposeObject(previous);
    }
    this.scene.add(root);
    this.levelRoot = root;
    this.isDebugRoomActive = false;
  }

  getLevelRoot() {
    return this.levelRoot;
  }

  /* ========================================================================
     Игрок: rig и камера
     ======================================================================== */

  /**
   * Ставит rig игрока в точку (x, z) с поворотом yaw (радианы). Высота задаётся режимом.
   */
  placeRig(x, z, yawRadians) {
    this.rig.position.x = x;
    this.rig.position.z = z;
    this.rig.rotation.set(0, yawRadians || 0, 0);
  }

  setSpawn(x, z, yawRadians) {
    this.spawn = { x: x, z: z, yaw: yawRadians || 0 };
    this.checkpoint = {
      storyTime: this.checkpoint.storyTime,
      x: x,
      z: z,
      yaw: yawRadians || 0
    };
  }

  /**
   * Запоминает чекпоинт: игровое время (секунды истории) и позицию rig.
   */
  setCheckpoint(data) {
    this.checkpoint = {
      storyTime: typeof data.storyTime === 'number' ? data.storyTime : this.storyTime,
      x: typeof data.x === 'number' ? data.x : this.rig.position.x,
      z: typeof data.z === 'number' ? data.z : this.rig.position.z,
      yaw: typeof data.yaw === 'number' ? data.yaw : this.rig.rotation.y
    };
  }

  _resetDesktopCamera() {
    this.camera.position.set(0, CONFIG.PLAYER.EYE_HEIGHT_STANDING, 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.fov = CONFIG.RENDER.DESKTOP_FOV;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Вертикальное смещение rig: в VR при режиме «сидя» мир поднимается на SEATED_OFFSET.
   */
  getHeightOffset() {
    if (this.mode === GameMode.VR && this.settings.heightMode === 'seated') {
      return CONFIG.PLAYER.SEATED_OFFSET;
    }
    return 0;
  }

  _applyHeightMode() {
    this.rig.position.y = this.getHeightOffset();
  }

  /* ========================================================================
     Состояния
     ======================================================================== */

  _setState(next) {
    if (this.state === next) {
      return;
    }
    const previous = this.state;
    this.state = next;
    this._notifySystems('onStateChange', [next, previous, this]);
    this.emit('statechange', { state: next, prevState: previous, mode: this.mode });
  }

  get isVR() {
    return this.mode === GameMode.VR;
  }

  get isPlaying() {
    return this.state === GameState.PLAYING;
  }

  /**
   * Подготавливает новый забег: сбрасывает время истории и уведомляет системы.
   */
  _beginRun(mode) {
    const previousMode = this.mode;
    this.mode = mode;
    this.elapsed = 0;
    this.storyTime = 0;
    this.fixedAccumulator = 0;
    this.lastClockText = '';
    this.perf.windowTime = 0;
    this.perf.windowFrames = 0;
    this.checkpoint = { storyTime: 0, x: this.spawn.x, z: this.spawn.z, yaw: this.spawn.yaw };

    this.placeRig(this.spawn.x, this.spawn.z, this.spawn.yaw);
    this._applyHeightMode();
    this._updateClock(true);
    this._notifySystems('onRunStart', [mode, this]);

    if (previousMode !== mode) {
      this.emit('modechange', { mode: mode, prevMode: previousMode });
    }
    this._setState(GameState.PLAYING);
  }

  _endRun() {
    this._notifySystems('onRunEnd', [this]);
    this.lastFrameTime = null;
    this._setState(GameState.MENU);
  }

  /**
   * Старт игры на ПК.
   */
  startDesktop() {
    if (!this.initialized || this.state !== GameState.MENU) {
      return;
    }
    if (this.renderer.xr.isPresenting) {
      return;
    }
    this._resetDesktopCamera();
    this.resize();
    this._beginRun(GameMode.DESKTOP);
    this.canvas.focus();
  }

  pause() {
    if (this.state !== GameState.PLAYING) {
      return;
    }
    this._setState(GameState.PAUSED);
  }

  resume() {
    if (this.state !== GameState.PAUSED) {
      return;
    }
    this._setState(GameState.PLAYING);
    this.canvas.focus();
  }

  togglePause() {
    if (this.state === GameState.PLAYING) {
      this.pause();
    } else if (this.state === GameState.PAUSED) {
      this.resume();
    }
  }

  /**
   * Возврат в главное меню. В VR завершает сессию (дальше сработает sessionend).
   */
  returnToMenu() {
    if (this.renderer.xr.isPresenting) {
      const session = this.renderer.xr.getSession();
      if (session) {
        session.end();
      }
      return;
    }
    if (this.state === GameState.MENU || this.state === GameState.BOOT) {
      return;
    }
    this._endRun();
  }

  /**
   * Возврат к последнему чекпоинту: время истории, позиция, уведомление систем.
   */
  restartFromCheckpoint() {
    if (this.state !== GameState.PLAYING && this.state !== GameState.PAUSED) {
      return;
    }
    this.storyTime = this.checkpoint.storyTime;
    this.fixedAccumulator = 0;
    this.placeRig(this.checkpoint.x, this.checkpoint.z, this.checkpoint.yaw);
    this._applyHeightMode();
    this._updateClock(true);
    this._notifySystems('onCheckpointRestart', [this.checkpoint.storyTime, this]);
    this.emit('checkpointrestart', { storyTime: this.checkpoint.storyTime });
    if (this.state === GameState.PAUSED) {
      this._setState(GameState.PLAYING);
    }
  }

  /* ========================================================================
     Время истории
     ======================================================================== */

  _updateClock(force) {
    const minutes = storySecondsToClockMinutes(this.storyTime);
    const text = formatClock(minutes);
    this.clockMinutes = minutes;
    if (force || text !== this.lastClockText) {
      this.lastClockText = text;
      this.emit('clockchange', { text: text, minutes: minutes });
    }
  }

  /* ========================================================================
     Настройки
     ======================================================================== */

  getSettings() {
    return Object.assign({}, this.settings);
  }

  applySettings(newSettings) {
    this.settings = sanitizeSettings(newSettings);
    if (this.renderer.xr.isPresenting) {
      this.renderer.xr.setFoveation(this._effectiveFoveation());
    }
    this._applyHeightMode();
    this._notifySystems('onSettingsChanged', [this.getSettings(), this]);
    this.emit('settingschange', this.getSettings());
  }

  _effectiveFoveation() {
    if (this.adaptive.foveationMax) {
      return 1;
    }
    return this.settings.foveation;
  }

  isDebugVisible() {
    return Boolean(this.settings.debugOverlay) || CONFIG.DEBUG.ENABLED_BY_URL;
  }

  /* ========================================================================
     WebXR
     ======================================================================== */

  /**
   * Проверяет поддержку immersive-vr. Возвращает { supported, reason }.
   * reason: '' | 'no-webxr' | 'insecure' | 'unsupported' | 'error'
   */
  async checkVRSupport() {
    if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
      return { supported: false, reason: 'no-webxr' };
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { supported: false, reason: 'insecure' };
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      if (supported) {
        return { supported: true, reason: '' };
      }
      return { supported: false, reason: 'unsupported' };
    } catch (error) {
      return { supported: false, reason: 'error' };
    }
  }

  /**
   * Входит в VR. Вызывать из обработчика пользовательского жеста (клик по кнопке).
   */
  async enterVR() {
    if (!this.initialized) {
      throw new Error('Игра ещё не инициализирована');
    }
    if (this.vrRequestPending || this.renderer.xr.isPresenting) {
      return;
    }
    if (this.state !== GameState.MENU) {
      return;
    }
    if (!this.vrSupport.supported) {
      throw new Error('VR недоступен (' + this.vrSupport.reason + ')');
    }

    this.vrRequestPending = true;
    try {
      const scale = resolveRenderScale(this.settings.renderScale, this.deviceProfile);
      this.renderer.xr.setFramebufferScaleFactor(scale);
      this.renderer.xr.setFoveation(this._effectiveFoveation());

      const baseInit = CONFIG.RENDER.XR_SESSION_INIT;
      const sessionInit = {
        optionalFeatures: baseInit.optionalFeatures.slice()
      };
      const session = await navigator.xr.requestSession('immersive-vr', sessionInit);
      await this.renderer.xr.setSession(session);
    } finally {
      this.vrRequestPending = false;
    }
  }

  _onXRSessionStart() {
    this.vrSession = this.renderer.xr.getSession();
    this.lastFrameTime = null;
    this.renderer.xr.setFoveation(this._effectiveFoveation());
    this._beginRun(GameMode.VR);
    this._notifySystems('onVRStart', [this.vrSession, this]);
    this.emit('vrsessionstart', { session: this.vrSession });
  }

  _onXRSessionEnd() {
    this.vrSession = null;
    this.mode = GameMode.DESKTOP;
    this.lastFrameTime = null;
    this._resetDesktopCamera();
    this._applyHeightMode();
    this.placeRig(this.spawn.x, this.spawn.z, this.spawn.yaw);
    this.resize();
    this._notifySystems('onVREnd', [this]);
    this.emit('vrsessionend', {});
    this.emit('modechange', { mode: GameMode.DESKTOP, prevMode: GameMode.VR });
    if (this.state !== GameState.MENU) {
      this._endRun();
    }
  }

  _isXRHidden() {
    if (!this.vrSession) {
      return false;
    }
    const visibility = this.vrSession.visibilityState;
    return Boolean(visibility) && visibility !== 'visible';
  }

  _getTargetHz() {
    if (this.vrSession && typeof this.vrSession.frameRate === 'number' && this.vrSession.frameRate > 0) {
      return this.vrSession.frameRate;
    }
    return this.deviceProfile.targetHz;
  }

  /* ========================================================================
     Главный цикл
     ======================================================================== */

  _onFrame(time, frame) {
    const nowSeconds = time / 1000;
    let delta = 0;
    if (this.lastFrameTime !== null) {
      delta = nowSeconds - this.lastFrameTime;
    }
    this.lastFrameTime = nowSeconds;

    if (delta < 0) {
      delta = 0;
    }
    if (delta > MAX_FRAME_DELTA_SECONDS) {
      delta = MAX_FRAME_DELTA_SECONDS;
    }
    this.frameCounter += 1;

    const presenting = this.renderer.xr.isPresenting;
    const shouldUpdate = this.state === GameState.PLAYING && !this._isXRHidden();

    if (shouldUpdate) {
      this.elapsed += delta;
      this.storyTime += delta;
      this._runFixedUpdates(delta);
      this._runUpdates(delta, frame);
      this._updateClock(false);
    }

    const shouldRender = presenting || this.state === GameState.PLAYING || this.state === GameState.PAUSED;
    if (shouldRender) {
      this.renderer.render(this.scene, this.camera);
    }

    if (shouldUpdate) {
      this._samplePerformance(delta);
    }
    this._updateDebug(delta);
  }

  _runFixedUpdates(delta) {
    this.fixedAccumulator += delta;
    let steps = 0;
    while (this.fixedAccumulator >= FIXED_STEP_SECONDS && steps < MAX_FIXED_STEPS_PER_FRAME) {
      const list = this.systems;
      for (let i = 0; i < list.length; i++) {
        this._callHook(list[i], 'fixedUpdate', [FIXED_STEP_SECONDS, this]);
      }
      this.fixedAccumulator -= FIXED_STEP_SECONDS;
      steps += 1;
    }
    if (steps === MAX_FIXED_STEPS_PER_FRAME && this.fixedAccumulator >= FIXED_STEP_SECONDS) {
      this.fixedAccumulator = 0;
    }
  }

  _runUpdates(delta, frame) {
    const list = this.systems;
    for (let i = 0; i < list.length; i++) {
      this._callHook(list[i], 'update', [delta, this.elapsed, frame, this]);
    }
    for (let i = 0; i < list.length; i++) {
      this._callHook(list[i], 'lateUpdate', [delta, this.elapsed, frame, this]);
    }
  }

  /* ========================================================================
     Производительность и адаптивная деградация
     ======================================================================== */

  _samplePerformance(delta) {
    const perf = this.perf;
    perf.windowTime += delta;
    perf.windowFrames += 1;

    if (perf.windowTime < CONFIG.ADAPTIVE.SAMPLE_SECONDS) {
      return;
    }

    perf.fps = perf.windowFrames / perf.windowTime;
    perf.frameMs = (1000 * perf.windowTime) / perf.windowFrames;
    perf.sinceAdaptation += perf.windowTime;
    perf.windowTime = 0;
    perf.windowFrames = 0;

    this._checkAdaptive();
  }

  _checkAdaptive() {
    const adaptiveConfig = CONFIG.ADAPTIVE;
    if (!adaptiveConfig.ENABLED || !this.renderer.xr.isPresenting) {
      return;
    }
    if (this.adaptive.level >= adaptiveConfig.STEPS.length) {
      return;
    }
    if (this.perf.sinceAdaptation < adaptiveConfig.COOLDOWN_SECONDS) {
      return;
    }
    const threshold = this._getTargetHz() * adaptiveConfig.LOW_FPS_RATIO;
    if (this.perf.fps >= threshold) {
      return;
    }

    const stepId = adaptiveConfig.STEPS[this.adaptive.level];
    this.adaptive.level += 1;
    this.perf.sinceAdaptation = 0;
    this._applyAdaptiveStep(stepId);
  }

  _applyAdaptiveStep(stepId) {
    if (stepId === 'foveation_max') {
      this.adaptive.foveationMax = true;
      this.renderer.xr.setFoveation(1);
    } else if (stepId === 'disable_extra_lights') {
      this.adaptive.extraLightsOff = true;
      for (let i = 0; i < this.dynamicLights.length; i++) {
        if (!this.dynamicLights[i].essential) {
          this.dynamicLights[i].light.visible = false;
        }
      }
    } else if (stepId === 'shorten_fog') {
      this.adaptive.fogMultiplier *= CONFIG.ADAPTIVE.FOG_DENSITY_MULTIPLIER_STEP;
      if (this.scene.fog) {
        this.scene.fog.density = this.baseFogDensity * this.adaptive.fogMultiplier;
      }
    } else if (stepId === 'cull_far_rooms') {
      this.adaptive.cullFarRooms = true;
    } else if (stepId === 'suggest_lower_render_scale') {
      this.adaptive.suggestLowerRenderScale = true;
    }

    if (CONFIG.DEBUG.LOG_PERF_WARNINGS) {
      console.warn('[game] адаптивная деградация: ' + stepId + ' (FPS ' + this.perf.fps.toFixed(1) + ')');
    }
    this._notifySystems('onAdaptiveStep', [stepId, this]);
    this.emit('adaptive', { step: stepId, level: this.adaptive.level, fps: this.perf.fps });
  }

  /**
   * Возвращает копию состояния адаптации (для level.js: cullFarRooms и т.д.).
   */
  getAdaptiveState() {
    return Object.assign({}, this.adaptive);
  }

  _readRenderStats() {
    const info = this.renderer.info;
    const perf = this.perf;
    let viewCount = 1;
    if (this.renderer.xr.isPresenting) {
      const xrCamera = this.renderer.xr.getCamera();
      if (xrCamera && xrCamera.cameras && xrCamera.cameras.length > 0) {
        viewCount = xrCamera.cameras.length;
      }
    }
    perf.viewCount = viewCount;
    perf.calls = info.render.calls;
    perf.callsPerView = Math.round(info.render.calls / viewCount);
    perf.triangles = Math.round(info.render.triangles / viewCount);
    perf.geometries = info.memory.geometries;
    perf.textures = info.memory.textures;
  }

  _warnIfOverBudget(delta) {
    const perf = this.perf;
    perf.sinceWarning += delta;
    if (!CONFIG.DEBUG.LOG_PERF_WARNINGS || perf.sinceWarning < PERF_WARNING_INTERVAL_SECONDS) {
      return;
    }
    const profile = this.deviceProfile;
    let warned = false;
    if (perf.callsPerView > profile.maxDrawCalls) {
      console.warn('[perf] draw calls на вид: ' + perf.callsPerView + ' > ' + profile.maxDrawCalls);
      warned = true;
    }
    if (perf.triangles > profile.maxTriangles) {
      console.warn('[perf] треугольников на вид: ' + perf.triangles + ' > ' + profile.maxTriangles);
      warned = true;
    }
    if (warned) {
      perf.sinceWarning = 0;
    }
  }

  _updateDebug(delta) {
    this.debugTimerMs += delta * 1000;
    if (this.debugTimerMs < CONFIG.DEBUG.OVERLAY_UPDATE_INTERVAL_MS) {
      return;
    }
    this.debugTimerMs = 0;

    if (this.state === GameState.PLAYING || this.state === GameState.PAUSED) {
      this._readRenderStats();
      this._warnIfOverBudget(CONFIG.DEBUG.OVERLAY_UPDATE_INTERVAL_MS / 1000);
    }

    const visible = this.isDebugVisible();
    if (!visible && !this.lastDebugVisible) {
      return;
    }
    this.lastDebugVisible = visible;
    this.emit('debug', { visible: visible, text: visible ? this.getDebugText() : '' });
  }

  getDebugText() {
    const perf = this.perf;
    const profile = this.deviceProfile;
    const lines = [];
    lines.push('НОЧНАЯ СМЕНА v' + CONFIG.VERSION);
    lines.push('FPS ' + perf.fps.toFixed(1) + ' (' + perf.frameMs.toFixed(1) + ' мс) / цель ' + this._getTargetHz());
    lines.push('Draw calls: ' + perf.callsPerView + ' на вид (всего ' + perf.calls + ', видов ' + perf.viewCount + ') / лимит ' + profile.maxDrawCalls);
    lines.push('Треугольники: ' + perf.triangles + ' / лимит ' + profile.maxTriangles);
    lines.push('Свет: ' + this.dynamicLights.length + ' / ' + profile.maxDynamicLights +
      ' · геометрии ' + perf.geometries + ' · текстуры ' + perf.textures);
    lines.push('Состояние: ' + this.state + ' · режим: ' + this.mode + ' · ' + profile.label);
    lines.push('Время: ' + this.lastClockText + ' · системы: ' + this.systems.length);
    lines.push('Адаптация: ' + this.adaptive.level + '/' + CONFIG.ADAPTIVE.STEPS.length);
    return lines.join('\n');
  }

  /* ========================================================================
     Завершение
     ======================================================================== */

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      if (this.renderer.xr.isPresenting) {
        const session = this.renderer.xr.getSession();
        if (session) {
          session.end();
        }
      }
      this.renderer.xr.removeEventListener('sessionstart', this._onXRSessionStart);
      this.renderer.xr.removeEventListener('sessionend', this._onXRSessionEnd);
    }

    const list = this.systems.slice();
    for (let i = 0; i < list.length; i++) {
      this._callHook(list[i], 'dispose', [this]);
    }
    this.systems = [];

    this._unbindEvents();

    if (this.levelRoot) {
      this.scene.remove(this.levelRoot);
      disposeObject(this.levelRoot);
      this.levelRoot = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
    this.listeners.clear();
  }
}
