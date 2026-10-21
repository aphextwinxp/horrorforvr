/**
 * config.js — единый источник всех настроек и констант игры «Ночная смена».
 *
 * Правила:
 *  - Здесь НЕТ игровой логики, только данные и небольшие чистые хелперы.
 *  - Объект CONFIG полностью заморожен (deepFreeze): менять его в рантайме нельзя.
 *  - Пользовательские настройки (комфорт, звук, графика) описаны в SETTINGS_SCHEMA,
 *    хранятся в localStorage и проходят проверку через sanitizeSettings().
 *  - Числовые значения помечены как «стартовые»: их нужно калибровать на шлеме.
 *
 * Единицы: метры, секунды, градусы (если не указано иное), игровое время — минуты от полуночи.
 */

export const VERSION = '0.1.0';
export const GAME_TITLE = 'Ночная смена';
export const EPISODE_TITLE = 'Эпизод 1: Последний клиент';

/* ==========================================================================
   Вспомогательные функции уровня модуля
   ========================================================================== */

/**
 * Читает булев флаг из строки запроса (?debug=1 или ?debug=true).
 */
function readQueryFlag(name) {
  if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(location.search);
    const value = params.get(name);
    return value === '1' || value === 'true';
  } catch (error) {
    return false;
  }
}

/**
 * Рекурсивно замораживает объект (включая массивы и вложенные объекты).
 */
export function deepFreeze(object) {
  if (object === null || typeof object !== 'object' || Object.isFrozen(object)) {
    return object;
  }
  Object.freeze(object);
  const keys = Object.getOwnPropertyNames(object);
  for (let i = 0; i < keys.length; i++) {
    deepFreeze(object[keys[i]]);
  }
  return object;
}

/* ==========================================================================
   Время истории
   Часы игры идут кусочно-линейно: у каждого акта есть своя реальная длительность.
   Это позволяет сделать обучение неспешным, а охоту — длинной,
   не растягивая линейно всю ночь.
   ========================================================================== */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const STORY_ACTS = [
  { id: 'act0', name: 'Обучение',            startMinutes: 1380, endMinutes: 1390, durationSeconds: 180 }, // 23:00–23:10
  { id: 'act1', name: 'Бытовые странности',  startMinutes: 1390, endMinutes: 1470, durationSeconds: 330 }, // 23:10–00:30
  { id: 'act2', name: 'Присутствие',         startMinutes: 1470, endMinutes: 1530, durationSeconds: 300 }, // 00:30–01:30
  { id: 'act3', name: 'Контакт',             startMinutes: 1530, endMinutes: 1590, durationSeconds: 240 }, // 01:30–02:30
  { id: 'act4', name: 'Охота',               startMinutes: 1590, endMinutes: 1740, durationSeconds: 600 }, // 02:30–05:00
  { id: 'act5', name: 'Затишье',             startMinutes: 1740, endMinutes: 1770, durationSeconds: 90 },  // 05:00–05:30
  { id: 'act6', name: 'Финал',               startMinutes: 1770, endMinutes: 1800, durationSeconds: 300 }  // 05:30–06:00
];

/* ==========================================================================
   Профили устройств
   Бюджеты взяты из дизайн-дока (раздел 5.1).
   ========================================================================== */

const DEVICE_PROFILES = {
  desktop: {
    id: 'desktop',
    label: 'ПК',
    isHeadset: false,
    targetHz: 60,
    maxDrawCalls: 400,
    maxTriangles: 600000,
    maxDynamicLights: 6,
    defaultRenderScale: 1.0,
    pixelRatioCap: 1.5
  },
  quest2: {
    id: 'quest2',
    label: 'Meta Quest 2',
    isHeadset: true,
    targetHz: 72,
    maxDrawCalls: 100,
    maxTriangles: 100000,
    maxDynamicLights: 3,
    defaultRenderScale: 0.9,
    pixelRatioCap: 1.0
  },
  quest3: {
    id: 'quest3',
    label: 'Meta Quest 3',
    isHeadset: true,
    targetHz: 90,
    maxDrawCalls: 150,
    maxTriangles: 200000,
    maxDynamicLights: 4,
    defaultRenderScale: 1.0,
    pixelRatioCap: 1.0
  }
};

/* ==========================================================================
   Схема пользовательских настроек
   Из неё ui.js строит форму, а sanitizeSettings() проверяет значения.
   type: 'select' | 'range' | 'toggle'
   ========================================================================== */

const SETTINGS_GROUPS = [
  { id: 'comfort',  label: 'Комфорт VR' },
  { id: 'controls', label: 'Управление' },
  { id: 'audio',    label: 'Звук' },
  { id: 'graphics', label: 'Графика' },
  { id: 'misc',     label: 'Прочее' }
];

const SETTINGS_SCHEMA = [
  {
    key: 'locomotion', group: 'comfort', type: 'select', label: 'Перемещение', default: 'smooth',
    options: [
      { value: 'smooth',   label: 'Плавное (стик)' },
      { value: 'teleport', label: 'Телепорт' }
    ]
  },
  {
    key: 'turnMode', group: 'comfort', type: 'select', label: 'Поворот', default: 'snap',
    options: [
      { value: 'snap',   label: 'Рывками (snap)' },
      { value: 'smooth', label: 'Плавный' }
    ]
  },
  {
    key: 'snapAngle', group: 'comfort', type: 'select', label: 'Угол рывкового поворота', default: 30,
    options: [
      { value: 15, label: '15°' },
      { value: 30, label: '30°' },
      { value: 45, label: '45°' }
    ]
  },
  {
    key: 'smoothTurnSpeed', group: 'comfort', type: 'range', label: 'Скорость плавного поворота (°/с)',
    default: 90, min: 30, max: 180, step: 10
  },
  {
    key: 'vignette', group: 'comfort', type: 'select', label: 'Виньетка при движении', default: 'medium',
    options: [
      { value: 'off',    label: 'Выкл' },
      { value: 'low',    label: 'Слабая' },
      { value: 'medium', label: 'Средняя' },
      { value: 'high',   label: 'Сильная' }
    ]
  },
  {
    key: 'moveDirection', group: 'comfort', type: 'select', label: 'Направление движения', default: 'head',
    options: [
      { value: 'head',       label: 'По голове' },
      { value: 'controller', label: 'По контроллеру' }
    ]
  },
  {
    key: 'heightMode', group: 'comfort', type: 'select', label: 'Режим высоты', default: 'standing',
    options: [
      { value: 'standing', label: 'Стоя' },
      { value: 'seated',   label: 'Сидя' }
    ]
  },
  {
    key: 'cameraShake', group: 'comfort', type: 'toggle', label: 'Дрожание камеры в сценах', default: false
  },
  {
    key: 'subtitles', group: 'controls', type: 'toggle', label: 'Субтитры', default: true
  },
  {
    key: 'mouseSensitivity', group: 'controls', type: 'range', label: 'Чувствительность мыши',
    default: 1.0, min: 0.2, max: 3.0, step: 0.1
  },
  {
    key: 'invertY', group: 'controls', type: 'toggle', label: 'Инвертировать мышь по вертикали', default: false
  },
  {
    key: 'masterVolume', group: 'audio', type: 'range', label: 'Общая громкость',
    default: 0.8, min: 0, max: 1, step: 0.05
  },
  {
    key: 'renderScale', group: 'graphics', type: 'select', label: 'Разрешение рендера (VR, со следующего входа)', default: 'auto',
    options: [
      { value: 'auto', label: 'Авто' },
      { value: 0.7,    label: '0.7' },
      { value: 0.8,    label: '0.8' },
      { value: 0.9,    label: '0.9' },
      { value: 1.0,    label: '1.0' },
      { value: 1.1,    label: '1.1' },
      { value: 1.2,    label: '1.2' }
    ]
  },
  {
    key: 'foveation', group: 'graphics', type: 'range', label: 'Фовеальный рендеринг (VR)',
    default: 1.0, min: 0, max: 1, step: 0.25
  },
  {
    key: 'debugOverlay', group: 'misc', type: 'toggle', label: 'Отладочный оверлей', default: false
  }
];

/* ==========================================================================
   Основной объект конфигурации
   ========================================================================== */

const GAME_MINUTES_START = STORY_ACTS[0].startMinutes;
const GAME_MINUTES_END = STORY_ACTS[STORY_ACTS.length - 1].endMinutes;
let storyTotalSeconds = 0;
for (let i = 0; i < STORY_ACTS.length; i++) {
  storyTotalSeconds += STORY_ACTS[i].durationSeconds;
}

export const CONFIG = deepFreeze({

  VERSION: VERSION,

  DEBUG: {
    ENABLED_BY_URL: readQueryFlag('debug'),
    OVERLAY_UPDATE_INTERVAL_MS: 500,
    LOG_PERF_WARNINGS: true
  },

  /* ---------- Хранилище ---------- */
  STORAGE: {
    SETTINGS_KEY: 'nightshift.settings',
    SETTINGS_VERSION: 1,
    CHECKPOINT_KEY: 'nightshift.checkpoint',
    CHECKPOINT_VERSION: 1
  },

  /* ---------- Пути к ресурсам (только относительные!) ---------- */
  PATHS: {
    AUDIO: './assets/audio/',
    MODELS: './assets/models/',
    TEXTURES: './assets/textures/'
  },

  /* ---------- Профили устройств и бюджеты ---------- */
  DEVICE_PROFILES: DEVICE_PROFILES,

  /* ---------- Рендер ---------- */
  RENDER: {
    ANTIALIAS: true,
    ALPHA: false,
    STENCIL: false,
    DEPTH: true,
    POWER_PREFERENCE: 'high-performance',
    SHADOWS_ENABLED: false,
    CAMERA_NEAR: 0.05,
    CAMERA_FAR: 60,
    DESKTOP_FOV: 75,
    RENDER_SCALE_MIN: 0.7,
    RENDER_SCALE_MAX: 1.2,
    FOVEATION_DEFAULT: 1.0,
    XR_REFERENCE_SPACE: 'local-floor',
    XR_SESSION_INIT: {
      optionalFeatures: ['local-floor', 'bounded-floor']
    }
  },

  /* ---------- Цвета, свет, туман (стартовые значения) ---------- */
  ATMOSPHERE: {
    BACKGROUND_COLOR: 0x05060a,
    FOG_COLOR: 0x07090d,
    FOG_DENSITY: 0.06,
    HEMISPHERE_SKY_COLOR: 0x1b2433,
    HEMISPHERE_GROUND_COLOR: 0x0a0a0c,
    HEMISPHERE_INTENSITY: 0.35,
    LAMP_COLOR: 0xffd9a0,
    LAMP_INTENSITY: 6,
    LAMP_DISTANCE: 9,
    LAMP_DECAY: 2,
    EMERGENCY_COLOR: 0xff2a1a,
    EMERGENCY_INTENSITY: 4,
    EMERGENCY_DISTANCE: 8,
    FLASHLIGHT_COLOR: 0xfff2d8,
    FLASHLIGHT_INTENSITY: 18,
    FLASHLIGHT_DISTANCE: 14,
    FLASHLIGHT_ANGLE: 0.5,
    FLASHLIGHT_PENUMBRA: 0.45,
    FLASHLIGHT_DECAY: 2
  },

  /* ---------- Адаптивная деградация (рантайм) ----------
     Внимание: коэффициент разрешения кадра (framebufferScaleFactor) в WebXR нельзя
     менять посреди сессии, поэтому в рантайме мы управляем только фовеацией,
     светом, туманом и отсечением комнат. Масштаб применяется при следующем входе в VR. */
  ADAPTIVE: {
    ENABLED: true,
    SAMPLE_SECONDS: 3,
    LOW_FPS_RATIO: 0.9,
    COOLDOWN_SECONDS: 5,
    FOG_DENSITY_MULTIPLIER_STEP: 1.35,
    STEPS: [
      'foveation_max',
      'disable_extra_lights',
      'shorten_fog',
      'cull_far_rooms',
      'suggest_lower_render_scale'
    ]
  },

  /* ---------- Размеры уровня (общие стандарты) ---------- */
  LEVEL: {
    WALL_HEIGHT: 2.8,
    WALL_THICKNESS: 0.2,
    FLOOR_Y: 0,
    DOOR_WIDTH: 0.95,
    DOOR_HEIGHT: 2.05,
    DOOR_THICKNESS: 0.05,
    DOOR_HANDLE_HEIGHT: 1.0
  },

  /* ---------- Игрок ---------- */
  PLAYER: {
    EYE_HEIGHT_STANDING: 1.65,
    EYE_HEIGHT_CROUCHING: 1.0,
    CROUCH_THRESHOLD_HEIGHT: 1.15,
    SEATED_OFFSET: 0.35,
    RADIUS: 0.25,
    WALK_SPEED: 1.7,
    FAST_SPEED: 2.8,
    CROUCH_SPEED: 0.9,
    ACCELERATION: 10,
    DECELERATION: 14,
    STRIDE_LENGTH: 0.75,
    COLLISION_ITERATIONS: 3,
    TELEPORT_MAX_DISTANCE: 6,
    TELEPORT_FADE_SECONDS: 0.12
  },

  /* ---------- Комфорт ---------- */
  COMFORT: {
    VIGNETTE_LEVELS: {
      off: 0,
      low: 0.45,
      medium: 0.7,
      high: 0.9
    },
    VIGNETTE_MAX_LINEAR_SPEED: 2.8,
    VIGNETTE_ANGULAR_WEIGHT: 0.004,
    VIGNETTE_FADE_IN_SECONDS: 0.15,
    VIGNETTE_FADE_OUT_SECONDS: 0.4,
    SNAP_TURN_COOLDOWN_SECONDS: 0.25,
    DEATH_FADE_SECONDS: 0.3
  },

  /* ---------- Ввод ---------- */
  INPUT: {
    STICK_DEADZONE: 0.15,
    SNAP_TURN_STICK_THRESHOLD: 0.7,
    /* Раскладка xr-standard (Quest Touch) */
    XR_BUTTONS: {
      TRIGGER: 0,
      SQUEEZE: 1,
      THUMBSTICK: 3,
      PRIMARY: 4,   // A / X
      SECONDARY: 5  // B / Y
    },
    XR_AXES: {
      STICK_X: 2,
      STICK_Y: 3
    },
    BUTTON_PRESS_THRESHOLD: 0.5,
    BUTTON_RELEASE_THRESHOLD: 0.3,
    /* События KeyboardEvent.code */
    KEYS: {
      FORWARD: 'KeyW',
      BACKWARD: 'KeyS',
      LEFT: 'KeyA',
      RIGHT: 'KeyD',
      CROUCH: 'KeyC',
      CROUCH_ALT: 'ControlLeft',
      SPRINT: 'ShiftLeft',
      GRAB: 'KeyE',
      USE: 'KeyF',
      FLASHLIGHT: 'KeyQ',
      INVENTORY: 'Tab',
      PAUSE: 'Escape'
    },
    MOUSE_RADIANS_PER_PIXEL: 0.0022,
    PITCH_LIMIT_DEGREES: 85
  },

  /* ---------- Взаимодействие ---------- */
  INTERACT: {
    GRAB_RADIUS: 0.12,
    DESKTOP_REACH: 2.0,
    HIGHLIGHT_COLOR: 0x6fd0ff,
    HIGHLIGHT_INTENSITY: 0.6,
    THROW_SAMPLE_FRAMES: 5,
    THROW_VELOCITY_MULTIPLIER: 1.0,
    THROW_MAX_SPEED: 8,
    GRAVITY: 9.81,
    RESTITUTION: 0.35,
    GROUND_FRICTION: 0.7,
    REST_SPEED_THRESHOLD: 0.15,
    INVENTORY_SLOTS: 4,
    BELT_FORWARD_OFFSET: 0.1,
    BELT_DOWN_OFFSET: 0.55,
    BELT_SLOT_RADIUS: 0.15,
    HAPTIC_GRAB: { intensity: 0.3, durationMs: 40 },
    HAPTIC_DOOR_SLAM: { intensity: 0.8, durationMs: 120 }
  },

  /* ---------- Двери и ящики ---------- */
  DOORS: {
    MAX_ANGLE_DEGREES: 100,
    ANGULAR_DAMPING: 3.0,
    RELEASE_INERTIA_FACTOR: 0.85,
    SLAM_ANGULAR_SPEED: 2.2,
    QUIET_ANGULAR_SPEED: 0.6,
    LOCKED_RATTLE_SECONDS: 0.35,
    LOCKED_RATTLE_ANGLE_DEGREES: 1.5,
    ENEMY_OPEN_SECONDS: 1.2,
    CLOSED_ANGLE_EPSILON_DEGREES: 1.0
  },

  DRAWERS: {
    SNAP_EPSILON: 0.02,
    OPEN_SPEED_FOR_NOISE: 1.2
  },

  HIDING: {
    PEEK_RADIUS: 0.15,
    BREATHING_START_SECONDS: 4,
    ENEMY_INSPECT_CHANCE_BASE: 0.25,
    ENEMY_INSPECT_CHANCE_PER_NOISE: 0.15,
    ENTER_CROUCH_REQUIRED: true
  },

  /* ---------- Навигация (NavGrid) ----------
     Границы сетки задаются в level-data.js, потому что зависят от раскладки уровня. */
  NAV: {
    CELL_SIZE: 0.25,
    AGENT_RADIUS: 0.3,
    DIAGONAL_COST: 1.41421356,
    CLOSED_DOOR_EXTRA_COST: 6,
    PATH_SMOOTHING: true,
    REPATH_INTERVAL_SECONDS: 0.25,
    STUCK_TIMEOUT_SECONDS: 1.5,
    STUCK_DISTANCE_EPSILON: 0.05,
    MAX_SEARCH_NODES: 20000
  },

  /* ---------- Шум ----------
     radius — максимальная дальность слышимости, loudness — вес для приоритета. */
  NOISE: {
    MEMORY_SECONDS: 3,
    CLOSED_DOOR_LOUDNESS_LOSS: 0.4,
    TYPES: {
      stepCrouch:   { radius: 1,  loudness: 0.1 },
      stepWalk:     { radius: 3,  loudness: 0.3 },
      stepFast:     { radius: 6,  loudness: 0.5 },
      doorCreak:    { radius: 4,  loudness: 0.35 },
      doorSlam:     { radius: 12, loudness: 0.8 },
      bottleThrow:  { radius: 8,  loudness: 0.6 },
      heavyDrop:    { radius: 12, loudness: 0.8 },
      glassBreak:   { radius: 25, loudness: 1.0 },
      phoneRing:    { radius: 15, loudness: 0.7 },
      engineStart:  { radius: 20, loudness: 0.9 },
      terminalSend: { radius: 5,  loudness: 0.4 }
    }
  },

  /* ---------- Враг ("Посетитель") ---------- */
  ENEMY: {
    SPEEDS: {
      PATROL: 1.2,
      INVESTIGATE: 1.6,
      CHASE: 3.2,
      SEARCH: 1.5
    },
    CATCH_DISTANCE: 0.8,
    HEIGHT: 1.85,
    EYE_HEIGHT: 1.7,
    VISION: {
      FOV_DEGREES: 100,
      RANGE_LIT: 12,
      DARK_RANGE_MULTIPLIER: 0.5,
      RAY_TARGET_FRACTIONS: [1.0, 0.7, 0.3],
      FILL_SECONDS_MIN: 0.8,
      FILL_SECONDS_MAX: 1.5,
      DECAY_PER_SECOND: 0.6,
      SUSPICION_THRESHOLD: 0.3,
      DETECTED_THRESHOLD: 1.0,
      FLASHLIGHT_MULTIPLIER: 1.8,
      CROUCH_MULTIPLIER: 0.6,
      HIDING_MULTIPLIER: 0.1
    },
    TIMINGS: {
      PATROL_PAUSE_MIN: 2,
      PATROL_PAUSE_MAX: 5,
      INVESTIGATE_LOOK_MIN: 5,
      INVESTIGATE_LOOK_MAX: 8,
      LOSE_SIGHT_SECONDS: 3,
      SEARCH_DURATION_SECONDS: 20,
      SEARCH_HIDE_SPOTS_MIN: 1,
      SEARCH_HIDE_SPOTS_MAX: 3,
      DOOR_KNOCK_SECONDS: 2.5
    },
    SLEEP: {
      RESPAWN_GRACE_SECONDS: 20,
      STORY_SLEEP_SECONDS: 90,
      POWER_SLEEP_SECONDS: 30,
      WAKE_NOISE_RADIUS: 20
    },
    FINAL_ACT: {
      SPEED_MULTIPLIER: 1.15,
      HEARING_MULTIPLIER: 1.3
    },
    ASSIST: {
      DEATHS_BEFORE_ASSIST: 3,
      VISION_RANGE_MULTIPLIER: 0.85
    },
    GRACE_RADIUS_NEAR_HIDING_SPOT: 1.5
  },

  /* ---------- Сюжет ---------- */
  STORY: {
    ACTS: STORY_ACTS,
    START_MINUTES: GAME_MINUTES_START,
    END_MINUTES: GAME_MINUTES_END,
    TOTAL_REAL_SECONDS: storyTotalSeconds,
    EVIDENCE_REQUIRED_FOR_TRUE_ENDING: 3,
    EVIDENCE_TOTAL: 4,
    ESCAPE_CAR_START_SECONDS: 3,
    ESCAPE_ENTER_CAR_DEADLINE_SECONDS: 8,
    TRAP_HOLD_DOOR_SECONDS: 10,
    TERMINAL_UPLOAD_SECONDS: 20
  },

  /* ---------- Чекпоинты ---------- */
  CHECKPOINTS: {
    IDS: ['cp_start', 'cp_post_scare1', 'cp_storage', 'cp_office', 'cp_final'],
    AUTOSAVE_ON_REACH: true
  },

  /* ---------- Звук ---------- */
  AUDIO: {
    MAX_POSITIONAL_VOICES: 16,
    REF_DISTANCE: 1.5,
    ROLLOFF_FACTOR: 1.6,
    MAX_DISTANCE: 30,
    LOWPASS_OPEN_HZ: 20000,
    LOWPASS_PER_CLOSED_DOOR_MULTIPLIER: 0.45,
    LOWPASS_MIN_HZ: 400,
    SURFACES: ['tile', 'linoleum', 'gravel'],
    FILE_FORMATS: ['ogg', 'mp3']
  },

  /* ---------- Схема настроек ---------- */
  SETTINGS_GROUPS: SETTINGS_GROUPS,
  SETTINGS_SCHEMA: SETTINGS_SCHEMA
});

/* ==========================================================================
   Время истории: хелперы
   ========================================================================== */

/**
 * Преобразует реальное время (секунды с начала прохождения) в игровые минуты от полуночи.
 * Может возвращать значения > 1440 (после полуночи): 00:30 = 1470.
 */
export function storySecondsToClockMinutes(elapsedSeconds) {
  const acts = CONFIG.STORY.ACTS;
  let remaining = Math.max(0, Number(elapsedSeconds) || 0);

  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    if (remaining < act.durationSeconds) {
      const t = remaining / act.durationSeconds;
      return act.startMinutes + (act.endMinutes - act.startMinutes) * t;
    }
    remaining -= act.durationSeconds;
  }

  return acts[acts.length - 1].endMinutes;
}

/**
 * Форматирует игровые минуты в строку ЧЧ:ММ (с переходом через полночь).
 */
export function formatClock(totalMinutes) {
  const wrapped = ((Math.floor(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / MINUTES_PER_HOUR);
  const minutes = wrapped % MINUTES_PER_HOUR;
  const hh = hours < 10 ? '0' + hours : String(hours);
  const mm = minutes < 10 ? '0' + minutes : String(minutes);
  return hh + ':' + mm;
}

/**
 * Возвращает индекс акта по игровому времени (минуты от полуночи).
 */
export function getActIndexAtClock(clockMinutes) {
  const acts = CONFIG.STORY.ACTS;
  for (let i = 0; i < acts.length; i++) {
    if (clockMinutes < acts[i].endMinutes) {
      return i;
    }
  }
  return acts.length - 1;
}

/* ==========================================================================
   Устройство и графика: хелперы
   ========================================================================== */

/**
 * Определяет профиль устройства по User-Agent.
 * Точный тип шлема позже можно уточнить по реальной частоте кадров XR-сессии.
 */
export function getDeviceProfile(userAgent) {
  let ua = '';
  if (typeof userAgent === 'string') {
    ua = userAgent;
  } else if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    ua = navigator.userAgent;
  }

  if (/Quest\s*3/i.test(ua)) {
    return CONFIG.DEVICE_PROFILES.quest3;
  }
  if (/Quest|OculusBrowser/i.test(ua)) {
    return CONFIG.DEVICE_PROFILES.quest2;
  }
  return CONFIG.DEVICE_PROFILES.desktop;
}

/**
 * Возвращает итоговый коэффициент разрешения для VR-сессии.
 * Значение 'auto' заменяется рекомендованным для профиля устройства.
 */
export function resolveRenderScale(settingValue, profile) {
  const min = CONFIG.RENDER.RENDER_SCALE_MIN;
  const max = CONFIG.RENDER.RENDER_SCALE_MAX;
  if (settingValue === 'auto' || settingValue === undefined || settingValue === null) {
    return profile.defaultRenderScale;
  }
  const numeric = Number(settingValue);
  if (!Number.isFinite(numeric)) {
    return profile.defaultRenderScale;
  }
  return Math.min(max, Math.max(min, numeric));
}

/**
 * Возвращает силу виньетки (0..1) по названию уровня из настроек.
 */
export function getVignetteStrength(level) {
  const levels = CONFIG.COMFORT.VIGNETTE_LEVELS;
  if (Object.prototype.hasOwnProperty.call(levels, level)) {
    return levels[level];
  }
  return levels.medium;
}

/* ==========================================================================
   Настройки пользователя: значения по умолчанию, проверка, хранение
   ========================================================================== */

/**
 * Создаёт новый объект настроек со значениями по умолчанию.
 */
export function createDefaultSettings() {
  const settings = {};
  const schema = CONFIG.SETTINGS_SCHEMA;
  for (let i = 0; i < schema.length; i++) {
    settings[schema[i].key] = schema[i].default;
  }
  return settings;
}

/**
 * Проверяет одно значение по описанию из схемы и возвращает корректное.
 */
function sanitizeSettingValue(entry, raw) {
  if (entry.type === 'toggle') {
    return typeof raw === 'boolean' ? raw : entry.default;
  }

  if (entry.type === 'select') {
    for (let i = 0; i < entry.options.length; i++) {
      if (String(entry.options[i].value) === String(raw)) {
        return entry.options[i].value;
      }
    }
    return entry.default;
  }

  if (entry.type === 'range') {
    const numeric = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(numeric)) {
      return entry.default;
    }
    const clamped = Math.min(entry.max, Math.max(entry.min, numeric));
    const steps = Math.round((clamped - entry.min) / entry.step);
    const snapped = entry.min + steps * entry.step;
    const rounded = Number(snapped.toFixed(4));
    return Math.min(entry.max, Math.max(entry.min, rounded));
  }

  return entry.default;
}

/**
 * Приводит произвольный объект к валидным настройкам.
 * Неизвестные ключи отбрасываются, отсутствующие берутся по умолчанию.
 */
export function sanitizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const result = {};
  const schema = CONFIG.SETTINGS_SCHEMA;
  for (let i = 0; i < schema.length; i++) {
    const entry = schema[i];
    result[entry.key] = sanitizeSettingValue(entry, source[entry.key]);
  }
  return result;
}

/**
 * Загружает настройки из localStorage. При любой ошибке возвращает значения по умолчанию.
 */
export function loadSettings() {
  try {
    if (typeof localStorage === 'undefined') {
      return createDefaultSettings();
    }
    const text = localStorage.getItem(CONFIG.STORAGE.SETTINGS_KEY);
    if (!text) {
      return createDefaultSettings();
    }
    const payload = JSON.parse(text);
    if (!payload || payload.version !== CONFIG.STORAGE.SETTINGS_VERSION) {
      return createDefaultSettings();
    }
    return sanitizeSettings(payload.settings);
  } catch (error) {
    return createDefaultSettings();
  }
}

/**
 * Сохраняет настройки в localStorage. Возвращает true при успехе.
 */
export function saveSettings(settings) {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    const payload = {
      version: CONFIG.STORAGE.SETTINGS_VERSION,
      settings: sanitizeSettings(settings)
    };
    localStorage.setItem(CONFIG.STORAGE.SETTINGS_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Удаляет сохранённые настройки и возвращает значения по умолчанию.
 */
export function resetSettings() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CONFIG.STORAGE.SETTINGS_KEY);
    }
  } catch (error) {
    /* Хранилище недоступно (например, приватный режим) — просто возвращаем значения по умолчанию. */
  }
  return createDefaultSettings();
}

/* ==========================================================================
   Самопроверка конфигурации
   ========================================================================== */

/**
 * Проверяет внутреннюю согласованность конфигурации.
 * Возвращает массив строк с описанием проблем (пустой массив = всё в порядке).
 * Вызывается из main.js при старте; проблемы выводятся в консоль.
 */
export function validateConfig() {
  const problems = [];

  /* Профили устройств */
  const profileIds = Object.keys(CONFIG.DEVICE_PROFILES);
  for (let i = 0; i < profileIds.length; i++) {
    const profile = CONFIG.DEVICE_PROFILES[profileIds[i]];
    const numericFields = ['targetHz', 'maxDrawCalls', 'maxTriangles', 'maxDynamicLights', 'defaultRenderScale', 'pixelRatioCap'];
    for (let j = 0; j < numericFields.length; j++) {
      const value = profile[numericFields[j]];
      if (!Number.isFinite(value) || value <= 0) {
        problems.push('DEVICE_PROFILES.' + profile.id + '.' + numericFields[j] + ' должно быть положительным числом');
      }
    }
    if (profile.defaultRenderScale < CONFIG.RENDER.RENDER_SCALE_MIN || profile.defaultRenderScale > CONFIG.RENDER.RENDER_SCALE_MAX) {
      problems.push('DEVICE_PROFILES.' + profile.id + '.defaultRenderScale вне диапазона RENDER_SCALE_MIN..MAX');
    }
  }

  /* Схема настроек */
  const seenKeys = {};
  const schema = CONFIG.SETTINGS_SCHEMA;
  const groupIds = CONFIG.SETTINGS_GROUPS.map(function (group) { return group.id; });
  for (let i = 0; i < schema.length; i++) {
    const entry = schema[i];
    if (seenKeys[entry.key]) {
      problems.push('SETTINGS_SCHEMA: повторяющийся ключ "' + entry.key + '"');
    }
    seenKeys[entry.key] = true;

    if (groupIds.indexOf(entry.group) === -1) {
      problems.push('SETTINGS_SCHEMA.' + entry.key + ': неизвестная группа "' + entry.group + '"');
    }
    if (entry.type !== 'select' && entry.type !== 'range' && entry.type !== 'toggle') {
      problems.push('SETTINGS_SCHEMA.' + entry.key + ': неизвестный тип "' + entry.type + '"');
      continue;
    }
    if (entry.type === 'range') {
      if (!(entry.min < entry.max) || !(entry.step > 0)) {
        problems.push('SETTINGS_SCHEMA.' + entry.key + ': некорректные min/max/step');
      }
    }
    if (entry.type === 'select' && (!entry.options || entry.options.length === 0)) {
      problems.push('SETTINGS_SCHEMA.' + entry.key + ': пустой список options');
    }
    const checked = sanitizeSettingValue(entry, entry.default);
    if (String(checked) !== String(entry.default)) {
      problems.push('SETTINGS_SCHEMA.' + entry.key + ': значение по умолчанию не проходит собственную проверку');
    }
  }

  /* Акты сюжета */
  const acts = CONFIG.STORY.ACTS;
  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    if (!(act.endMinutes > act.startMinutes)) {
      problems.push('STORY.ACTS.' + act.id + ': endMinutes должен быть больше startMinutes');
    }
    if (!(act.durationSeconds > 0)) {
      problems.push('STORY.ACTS.' + act.id + ': durationSeconds должен быть положительным');
    }
    if (i > 0 && acts[i - 1].endMinutes !== act.startMinutes) {
      problems.push('STORY.ACTS: между ' + acts[i - 1].id + ' и ' + act.id + ' есть разрыв по времени');
    }
  }

  /* Враг */
  const vision = CONFIG.ENEMY.VISION;
  if (!(vision.FOV_DEGREES > 0 && vision.FOV_DEGREES < 360)) {
    problems.push('ENEMY.VISION.FOV_DEGREES должен быть в диапазоне (0, 360)');
  }
  if (vision.FILL_SECONDS_MIN > vision.FILL_SECONDS_MAX) {
    problems.push('ENEMY.VISION: FILL_SECONDS_MIN больше FILL_SECONDS_MAX');
  }
  if (vision.SUSPICION_THRESHOLD >= vision.DETECTED_THRESHOLD) {
    problems.push('ENEMY.VISION: SUSPICION_THRESHOLD должен быть меньше DETECTED_THRESHOLD');
  }
  if (CONFIG.ENEMY.TIMINGS.PATROL_PAUSE_MIN > CONFIG.ENEMY.TIMINGS.PATROL_PAUSE_MAX) {
    problems.push('ENEMY.TIMINGS: PATROL_PAUSE_MIN больше PATROL_PAUSE_MAX');
  }
  if (CONFIG.ENEMY.TIMINGS.INVESTIGATE_LOOK_MIN > CONFIG.ENEMY.TIMINGS.INVESTIGATE_LOOK_MAX) {
    problems.push('ENEMY.TIMINGS: INVESTIGATE_LOOK_MIN больше INVESTIGATE_LOOK_MAX');
  }

  /* Шум */
  const noiseIds = Object.keys(CONFIG.NOISE.TYPES);
  for (let i = 0; i < noiseIds.length; i++) {
    const noise = CONFIG.NOISE.TYPES[noiseIds[i]];
    if (!(noise.radius > 0) || !(noise.loudness > 0 && noise.loudness <= 1)) {
      problems.push('NOISE.TYPES.' + noiseIds[i] + ': radius > 0 и loudness в (0, 1]');
    }
  }

  /* Навигация и инвентарь */
  if (!(CONFIG.NAV.CELL_SIZE > 0)) {
    problems.push('NAV.CELL_SIZE должен быть положительным');
  }
  if (!(CONFIG.NAV.AGENT_RADIUS >= CONFIG.NAV.CELL_SIZE)) {
    problems.push('NAV.AGENT_RADIUS не должен быть меньше NAV.CELL_SIZE');
  }
  if (!(CONFIG.INTERACT.INVENTORY_SLOTS >= 1)) {
    problems.push('INTERACT.INVENTORY_SLOTS должен быть не меньше 1');
  }

  return problems;
}
