// ==UserScript==
// @name         Asset Hunter
// @namespace    https://github.com/xedinho/Asset-Hunter
// @version      5.5.7
// @description  Search Ripper.Store for assets (DL detection, watchlist, LF post system, etc)
// @author       Xedinho
// @license      MIT
// @match        *://booth.pm/*
// @match        *://*.booth.pm/*
// @match        *://gumroad.com/*
// @match        *://*.gumroad.com/*
// @match        *://jinxxy.com/*
// @match        *://*.jinxxy.com/*
// @match        *://payhip.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      forum.ripper.store
// @downloadURL  https://raw.githubusercontent.com/xedinho/Asset-Hunter/main/Asset%20Hunter-5.5.0.user.js
// @updateURL    https://raw.githubusercontent.com/xedinho/Asset-Hunter/main/Asset%20Hunter.meta.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ─── API Endpoints ────────────────────────────────────────────────────────
  const API_URL    = "https://forum.ripper.store/api/search?term={query}&in=posts&matchWords=any&by=&categories=&searchChildren=false&hasTags=&replies=&repliesFilter=atleast&timeFilter=newer&timeRange=&sortBy=relevance&sortDirection=desc&showAs=topics";
  const TOPIC_API  = "https://forum.ripper.store/api/topic/{tid}";
  const POST_API   = "https://forum.ripper.store/api/v3/topics";
  const CONFIG_API = "https://forum.ripper.store/api/config";
  const SITE_URL   = "https://forum.ripper.store";

  // ─── Download Detection Patterns ─────────────────────────────────────────
  const DL_PATTERNS = [
    /mega\.nz/i, /mediafire/i, /drive\.google/i, /gofile\.io/i,
    /pixeldrain/i, /anonfiles/i, /workupload/i, /1fichier/i,
    /dropbox/i, /onedrive/i, /terabox/i, /bowfile/i,
    /\.zip\b/i, /\.rar\b/i, /\.7z\b/i, /download/i, /baixar/i, /descargar/i,
    /\/hidelinks\/r\//i, /🔗[\s]*DL/,
  ];

  // ─── Platform detection ───────────────────────────────────────────────────
  const HOST = location.hostname.replace(/^www\./, "");

  // ─── Booth Adapter ────────────────────────────────────────────────────────
  const BOOTH = {
    getId: () => {
      const m = window.location.pathname.match(/items\/(\d+)/);
      return m ? m[1] : "";
    },
    getName: () => {
      let name = document.title.replace(/\s*[-–|].*?BOOTH.*$/i, "").trim();
      if (!name) {
        const el = document.querySelector("h1.u-tpg-title1") || document.querySelector("h1");
        name = el ? el.textContent.trim() : "";
      }
      return name;
    },
    buildQuery: (id, name) => id || name,
    isItemPage: () => /\/items\/\d+/.test(window.location.pathname),
  };

  // ─── Gumroad Adapter ──────────────────────────────────────────────────────
  const GUMROAD = {
    getId: () => {
      const m = window.location.pathname.match(/\/l\/([^/?#]+)/);
      return m ? m[1] : "";
    },
    getName: () => {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.getAttribute("content")) {
        return og.getAttribute("content").trim();
      }
      return document.title.replace(/\s*[-–|]\s*Gumroad.*$/i, "").trim();
    },
    buildQuery: (id, name) => id || name,
    isItemPage: () => /\/l\/[^/?#]+/.test(window.location.pathname),
  };

  // ─── Jinxxy Adapter ───────────────────────────────────────────────────────
  const JINXXY = {
    getId: () => {
      const m = window.location.pathname.match(/^\/[^/]+\/([^/?#]+)/);
      return m ? m[1] : "";
    },
    getName: () => {
      const h1 = document.querySelector("h1");
      if (h1) return h1.textContent.trim();
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.getAttribute("content")) {
        return og.getAttribute("content").replace(/\s+by\s+.+?\s+on\s+Jinxxy$/i, "").trim();
      }
      return document.title.replace(/\s*[-–|].*?Jinxxy.*$/i, "").trim();
    },
    buildQuery: (id, name) => id || name,
    isItemPage: () => {
      const parts = window.location.pathname.replace(/^\/|\/$/g, "").split("/");
      if (parts.length !== 2) return false;
      const skip = ["market", "my", "about", "terms-of-service", "privacy-policy",
                    "refund-policy", "cart", "search"];
      if (skip.includes(parts[0])) return false;
      return true;
    },
  };

  // ─── Payhip Adapter ───────────────────────────────────────────────────────
  const PAYHIP = {
    getId: () => {
      const m = window.location.pathname.match(/\/b\/([^/?#]+)/);
      return m ? m[1] : "";
    },
    getName: () => {
      const h1 = document.querySelector("h1.font-section-product-name");
      if (h1) return h1.textContent.trim();
      const h1g = document.querySelector("h1");
      if (h1g) return h1g.textContent.trim();
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.getAttribute("content")) {
        return og.getAttribute("content").trim();
      }
      return document.title.replace(/\s*[-–|].*?Payhip.*$/i, "").trim();
    },
    buildQuery: (id, name) => id || name,
    isItemPage: () => /\/b\/[^/?#]+/.test(window.location.pathname),
  };

  // ─── Active adapter ───────────────────────────────────────────────────────
  function getAdapter() {
    if (HOST === "booth.pm" || HOST.endsWith(".booth.pm")) return BOOTH;
    if (HOST === "gumroad.com" || HOST.endsWith(".gumroad.com")) return GUMROAD;
    if (HOST === "jinxxy.com" || HOST.endsWith(".jinxxy.com")) return JINXXY;
    if (HOST === "payhip.com" || HOST.endsWith(".payhip.com")) return PAYHIP;
    return null;
  }

  // ─── Watermark ────────────────────────────────────────────────────────────
  const WATERMARK = "\n\n---\n# Posted via [Asset Hunter](https://forum.ripper.store/topic/108432/asset-hunter)";

  // ─── Category color map ───────────────────────────────────────────────────
  const CAT_COLORS = {
    "open":              { color: "#ff9540", bg: "rgba(255,149,64,.1)",  bd: "rgba(255,149,64,.25)"  },
    "solved":            { color: "#72f0a8", bg: "rgba(114,240,168,.1)", bd: "rgba(114,240,168,.25)" },
    "gifts":             { color: "#72f0a8", bg: "rgba(114,240,168,.1)", bd: "rgba(114,240,168,.25)" },
    "downloads":         { color: "#72f0a8", bg: "rgba(114,240,168,.1)", bd: "rgba(114,240,168,.25)" },
    "gifts / downloads": { color: "#72f0a8", bg: "rgba(114,240,168,.1)", bd: "rgba(114,240,168,.25)" },
    "looking for":       { color: "#ff9540", bg: "rgba(255,149,64,.1)",  bd: "rgba(255,149,64,.25)"  },
    "general assets":    { color: "#60c8ff", bg: "rgba(96,200,255,.1)",  bd: "rgba(96,200,255,.25)"  },
    "found avatars":     { color: "#72f0a8", bg: "rgba(114,240,168,.1)", bd: "rgba(114,240,168,.25)" },
    "booth avatars":     { color: "#ff6eb4", bg: "rgba(255,110,180,.1)", bd: "rgba(255,110,180,.25)" },
    "gumroad":           { color: "#ff8c69", bg: "rgba(255,140,105,.1)", bd: "rgba(255,140,105,.25)" },
    "payhip":            { color: "#ff8c69", bg: "rgba(255,140,105,.1)", bd: "rgba(255,140,105,.25)" },
    "furry":             { color: "#ffb347", bg: "rgba(255,179,71,.1)",  bd: "rgba(255,179,71,.25)"  },
    "nsfw":              { color: "#ff5577", bg: "rgba(255,85,119,.1)",  bd: "rgba(255,85,119,.25)"  },
    "scripts":           { color: "#a8e6cf", bg: "rgba(168,230,207,.1)", bd: "rgba(168,230,207,.25)" },
    "tools":             { color: "#a8e6cf", bg: "rgba(168,230,207,.1)", bd: "rgba(168,230,207,.25)" },
    "clothes":           { color: "#dda0dd", bg: "rgba(221,160,221,.1)", bd: "rgba(221,160,221,.25)" },
    "hair":              { color: "#f0e68c", bg: "rgba(240,230,140,.1)", bd: "rgba(240,230,140,.25)" },
    "textures":          { color: "#87ceeb", bg: "rgba(135,206,235,.1)", bd: "rgba(135,206,235,.25)" },
    "worlds":            { color: "#9b8ec4", bg: "rgba(155,142,196,.1)", bd: "rgba(155,142,196,.25)" },
    "live2d":            { color: "#ffaad4", bg: "rgba(255,170,212,.1)", bd: "rgba(255,170,212,.25)" },
    "general discussions":{ color: "#9898ff", bg: "rgba(152,152,255,.1)", bd: "rgba(152,152,255,.25)" },
    "uncategorized":     { color: "#6b6b80", bg: "rgba(107,107,128,.1)", bd: "rgba(107,107,128,.25)" },
    "other":             { color: "#6b6b80", bg: "rgba(107,107,128,.1)", bd: "rgba(107,107,128,.25)" },
    "accessories":       { color: "#ffd700", bg: "rgba(255,215,0,.1)",   bd: "rgba(255,215,0,.25)"   },
    "props":             { color: "#cd853f", bg: "rgba(205,133,63,.1)",  bd: "rgba(205,133,63,.25)"  },
    "shaders":           { color: "#00ced1", bg: "rgba(0,206,209,.1)",   bd: "rgba(0,206,209,.25)"   },
    "animations":        { color: "#ff7f50", bg: "rgba(255,127,80,.1)",  bd: "rgba(255,127,80,.25)"  },
  };

  const CAT_DEFAULT = { color: "#9898ff", bg: "rgba(152,152,255,.1)", bd: "rgba(152,152,255,.25)" };

  function getCatStyle(catName) {
    if (!catName) return CAT_DEFAULT;
    const lower = catName.toLowerCase();
    if (CAT_COLORS[lower]) return CAT_COLORS[lower];
    for (const [key, val] of Object.entries(CAT_COLORS)) {
      if (lower.includes(key)) return val;
    }
    return CAT_DEFAULT;
  }

  // ─── Settings Defaults & Helpers ─────────────────────────────────────────
  const DEFAULTS = {
    titleTpl:       "LF: {name}",
    bodyTpl:        "Looking for: **{name}**\n\n{url}\n\nPlease share if you have this item! 🙏",
    defaultTags:    "looking-for, lf, unsolved, booth",
    autoWatch:      true,
    autoUpdate:     false,
    autoUpdateMins: 15,
  };
  const AUTO_UPDATE_MIN_OPTIONS = [5, 10, 15, 20, 25, 30];
  const WATCHLIST_RECHECK_DELAY_MS = 25;

  function getSetting(key) {
    const val = GM_getValue("ah-cfg-" + key, null);
    if (val === null) return DEFAULTS[key];
    if (key === "autoWatch" || key === "autoUpdate") return val === "1";
    if (key === "autoUpdateMins") return parseInt(val, 10) || DEFAULTS.autoUpdateMins;
    return val;
  }
  function setSetting(key, val) {
    if (key === "autoWatch" || key === "autoUpdate") {
      GM_setValue("ah-cfg-" + key, val ? "1" : "0");
    } else {
      GM_setValue("ah-cfg-" + key, String(val));
    }
  }

  function buildTitle(name) {
    return getSetting("titleTpl").replace(/\{name\}/g, name);
  }
  function buildBody(name, url) {
    return getSetting("bodyTpl")
      .replace(/\{name\}/g, name)
      .replace(/\{url\}/g, url)
      + WATERMARK;
  }

  // ─── Localisation ─────────────────────────────────────────────────────────
  const STRINGS = {
    en: {
      title: "ASSET HUNTER", minimize: "Minimize", unknown: "Unknown", search: "Search",
      placeholder: "Search query...", noResult: "No results",
      hits: " hits", solved: "Solved", unsolved: "Open", untitled: "Untitled",
      errParse: "Failed to parse response", errNetwork: "Network error", errTimeout: "Request timed out",
      lfBtn: "Post LF Request", lfTitle: "LF Request", lfNotFound: "Not found on Ripper. Want to request it?",
      lfPost: "Post Request", lfPreview: "Preview", lfPosting: "Posting...",
      lfSuccess: "Posted!", lfViewPost: "View post →", lfLoginWarn: "You must be logged in at forum.ripper.store.",
      watchlist: "Watchlist", addWatch: "Add to Watchlist", inWatch: "Watching",
      noWatch: "No items in watchlist", recheck: "Re-check all", settings: "Settings",
      langLabel: "Language",
      secLfTemplates: "LF Post Templates", secBehaviour: "Behaviour", secDataMgmt: "Data Management",
      labelTitleTpl: "Title Template", hintTitleTpl: "Use <code>{name}</code> for the asset name",
      labelBodyTpl: "Body Template", hintBodyTpl: "Use <code>{name}</code> for the asset name, <code>{url}</code> for the item link",
      labelDefaultTags: "Default Tags", hintDefaultTags: "Comma separated — smart tags (avatar, hair, etc.) are appended automatically based on the item name",
      labelInterval: "Update interval", intervalEvery: "Every", intervalMin: "minutes",
      labelAutoWatch: "Auto-watch posted topics", hintAutoWatch: "Automatically follow your LF posts so you get notified when someone replies",
      labelAutoUpdate: "Auto-update watchlist", hintAutoUpdate: "Automatically re-check all watchlist items on a timer",
      wmLabel: "Watermark — always appended, not editable",
      btnSave: "Save Settings", btnExport: "Export Data", btnImport: "Import Data",
      btnResetDef: "Reset Defaults", btnDeleteData: "Delete Data", btnReset: "↺ Reset",
      savedMsg: "✓ Saved",
      lfLabelTitle: "Title", lfLabelCategory: "Category", lfLabelTags: "Tags",
      lfLabelTagsHint: "(comma separated)", lfLabelContent: "Content",
      lfLabelContentHint: "(Markdown — watermark auto-appended)",
      lfBtnPreview: "Preview on site", btnCancel: "Cancel",
      importTitle: "Import Data", importDrop: "Drop your JSON here", importDropSub: "or click to browse",
      importOk: "✓ Imported successfully!", importErr: "Failed to parse JSON — is this a valid export file?",
      importInvalid: "Please drop a valid .json file.",
      lfErrTitle: "Please enter a title.", lfErrContent: "Please enter content.",
      lfConnecting: "Connecting to Ripper.Store…",
      modalResetTitle: "Reset to Defaults", modalResetMsg: "This will reset all settings to their default values. Your watchlist will not be affected.",
      modalResetProceed: "Reset",
      modalDeleteTitle: "Delete Watchlist", modalDeleteMsg: "This will permanently delete all items in your watchlist. This cannot be undone.",
      modalDeleteProceed: "Delete",
      searching: "Searching…",
      openPost: "↗ Open post", openItem: "↗ Open item",
      warnNoName: "<strong>Title template</strong> is missing <code>{name}</code> — the asset name won't appear in your post title.",
      warnBadUrl: "<strong>Body template</strong> has <code>{url}</code> on a line with other text — Ripper.Store won't generate a link preview embed unless <code>{url}</code> is alone on its own line.",
      kofiCardMsg: "Enjoying Asset Hunter? Consider supporting!",
      kofiModalTitle: "Before you close this...",
      kofiModalBody: "Asset Hunter is free and took a lot of effort, time, and sanity to build. Donations are never necessary, but please consider supporting if it has helped you.",
      kofiKeepBtn: "I'll consider",
      kofiCloseBtn: "Close anyway",
      kofiDontAsk: "Don't ask again",
    },
    ja: {
      title: "ASSET HUNTER", minimize: "最小化", unknown: "不明", search: "検索",
      placeholder: "検索ワード...", noResult: "結果なし",
      hits: "件ヒット", solved: "解決済", unsolved: "未解決", untitled: "無題",
      errParse: "解析失敗", errNetwork: "通信エラー", errTimeout: "タイムアウト",
      lfBtn: "LFリクエスト投稿", lfTitle: "LFリクエスト", lfNotFound: "Ripperで見つかりません。リクエストしますか？",
      lfPost: "投稿する", lfPreview: "プレビュー", lfPosting: "投稿中...",
      lfSuccess: "投稿成功！", lfViewPost: "投稿を見る →", lfLoginWarn: "forum.ripper.store にログインが必要です。",
      watchlist: "ウォッチリスト", addWatch: "監視リストに追加", inWatch: "監視中",
      noWatch: "監視アイテムなし", recheck: "再チェック", settings: "設定",
      langLabel: "言語",
      secLfTemplates: "LFテンプレート", secBehaviour: "動作設定", secDataMgmt: "データ管理",
      labelTitleTpl: "タイトルテンプレート", hintTitleTpl: "<code>{name}</code> でアセット名を挿入",
      labelBodyTpl: "本文テンプレート", hintBodyTpl: "<code>{name}</code> でアセット名、<code>{url}</code> でリンクを挿入",
      labelDefaultTags: "デフォルトタグ", hintDefaultTags: "カンマ区切り — スマートタグはアイテム名から自動付与されます",
      labelInterval: "更新間隔", intervalEvery: "毎", intervalMin: "分",
      labelAutoWatch: "投稿を自動ウォッチ", hintAutoWatch: "LF投稿に返信があると通知を受け取るため自動フォロー",
      labelAutoUpdate: "ウォッチリスト自動更新", hintAutoUpdate: "タイマーでウォッチリストを自動再チェック",
      wmLabel: "ウォーターマーク — 常に追記されます（編集不可）",
      btnSave: "設定を保存", btnExport: "データ書き出し", btnImport: "データ読み込み",
      btnResetDef: "デフォルトに戻す", btnDeleteData: "データ削除", btnReset: "↺ リセット",
      savedMsg: "✓ 保存",
      lfLabelTitle: "タイトル", lfLabelCategory: "カテゴリ", lfLabelTags: "タグ",
      lfLabelTagsHint: "（カンマ区切り）", lfLabelContent: "本文",
      lfLabelContentHint: "（Markdown — ウォーターマーク自動付与）",
      lfBtnPreview: "サイトでプレビュー", btnCancel: "キャンセル",
      importTitle: "データ読み込み", importDrop: "JSONをここにドロップ", importDropSub: "またはクリックして選択",
      importOk: "✓ 読み込み完了！", importErr: "JSON解析失敗 — 正しいエクスポートファイルですか？",
      importInvalid: "有効な .json ファイルをドロップしてください。",
      lfErrTitle: "タイトルを入力してください。", lfErrContent: "本文を入力してください。",
      lfConnecting: "Ripper.Store に接続中…",
      modalResetTitle: "デフォルトにリセット", modalResetMsg: "すべての設定がデフォルト値に戻ります。ウォッチリストはそのままです。",
      modalResetProceed: "リセット",
      modalDeleteTitle: "ウォッチリスト削除", modalDeleteMsg: "ウォッチリストのすべての項目が完全に削除されます。元に戻せません。",
      modalDeleteProceed: "削除",
      searching: "検索中…",
      openPost: "↗ 投稿を開く", openItem: "↗ アイテムを開く",
      warnNoName: "<strong>タイトルテンプレート</strong>に <code>{name}</code> がありません。",
      warnBadUrl: "<strong>本文テンプレート</strong>の <code>{url}</code> は単独行に配置してください。",
      kofiCardMsg: "Asset Hunterを楽しんでいますか？ よければサポートをご検討ください！",
      kofiModalTitle: "閉じる前に...",
      kofiModalBody: "Asset Hunter は無料ですが、作成と維持には多くの時間・労力・正気が必要でした。寄付は必須ではありませんが、役に立ったならぜひご支援をご検討ください。",
      kofiKeepBtn: "検討します",
      kofiCloseBtn: "それでも閉じる",
      kofiDontAsk: "今後は表示しない",
    },
    ru: {
      title: "ASSET HUNTER", minimize: "Свернуть", unknown: "Неизвестно", search: "Поиск",
      placeholder: "Поисковый запрос...", noResult: "Нет результатов",
      hits: " совпадений", solved: "Решено", unsolved: "Открыто", untitled: "Без названия",
      errParse: "Ошибка разбора ответа", errNetwork: "Ошибка сети", errTimeout: "Время запроса истекло",
      lfBtn: "Создать LF запрос", lfTitle: "LF Запрос", lfNotFound: "Не найдено на Ripper. Хотите запросить?",
      lfPost: "Опубликовать", lfPreview: "Предпросмотр", lfPosting: "Публикация...",
      lfSuccess: "Опубликовано!", lfViewPost: "Открыть пост →", lfLoginWarn: "Необходимо войти на forum.ripper.store.",
      watchlist: "Список слежения", addWatch: "Добавить в список", inWatch: "Отслеживается",
      noWatch: "Список слежения пуст", recheck: "Проверить всё", settings: "Настройки",
      langLabel: "Язык",
      secLfTemplates: "Шаблоны LF постов", secBehaviour: "Поведение", secDataMgmt: "Управление данными",
      labelTitleTpl: "Шаблон заголовка", hintTitleTpl: "Используйте <code>{name}</code> для названия ассета",
      labelBodyTpl: "Шаблон текста", hintBodyTpl: "Используйте <code>{name}</code> для названия, <code>{url}</code> для ссылки",
      labelDefaultTags: "Теги по умолчанию", hintDefaultTags: "Через запятую — умные теги добавляются автоматически по названию",
      labelInterval: "Интервал обновления", intervalEvery: "Каждые", intervalMin: "минут",
      labelAutoWatch: "Авто-слежение за постами", hintAutoWatch: "Автоматически следить за LF постами для получения уведомлений",
      labelAutoUpdate: "Авто-обновление списка", hintAutoUpdate: "Автоматически перепроверять список слежения по таймеру",
      wmLabel: "Водяной знак — всегда добавляется, не редактируется",
      btnSave: "Сохранить настройки", btnExport: "Экспорт данных", btnImport: "Импорт данных",
      btnResetDef: "Сброс по умолчанию", btnDeleteData: "Удалить данные", btnReset: "↺ Сброс",
      savedMsg: "✓ Сохранено",
      lfLabelTitle: "Заголовок", lfLabelCategory: "Категория", lfLabelTags: "Теги",
      lfLabelTagsHint: "(через запятую)", lfLabelContent: "Содержание",
      lfLabelContentHint: "(Markdown — водяной знак добавляется автоматически)",
      lfBtnPreview: "Предпросмотр на сайте", btnCancel: "Отмена",
      importTitle: "Импорт данных", importDrop: "Перетащите JSON сюда", importDropSub: "или нажмите для выбора",
      importOk: "✓ Импорт выполнен!", importErr: "Ошибка разбора JSON — это верный файл экспорта?",
      importInvalid: "Перетащите корректный .json файл.",
      lfErrTitle: "Введите заголовок.", lfErrContent: "Введите содержание.",
      lfConnecting: "Подключение к Ripper.Store…",
      modalResetTitle: "Сброс настроек", modalResetMsg: "Все настройки будут сброшены до значений по умолчанию. Список слежения не затронут.",
      modalResetProceed: "Сбросить",
      modalDeleteTitle: "Удалить список слежения", modalDeleteMsg: "Все элементы списка слежения будут удалены безвозвратно.",
      modalDeleteProceed: "Удалить",
      searching: "Поиск…",
      openPost: "↗ Открыть пост", openItem: "↗ Открыть элемент",
      warnNoName: "<strong>Шаблон заголовка</strong> не содержит <code>{name}</code>.",
      warnBadUrl: "<strong>Шаблон текста</strong>: <code>{url}</code> должен быть на отдельной строке.",
      kofiCardMsg: "Нравится Asset Hunter? Подумайте о поддержке!",
      kofiModalTitle: "Перед тем как закрыть...",
      kofiModalBody: "Asset Hunter бесплатный, но на его создание ушло очень много сил, времени и нервов. Донаты не обязательны, но, пожалуйста, подумайте о поддержке, если он вам помог.",
      kofiKeepBtn: "Я подумаю",
      kofiCloseBtn: "Все равно закрыть",
      kofiDontAsk: "Больше не спрашивать",
    },
    "pt-BR": {
      title: "ASSET HUNTER", minimize: "Minimizar", unknown: "Desconhecido", search: "Buscar",
      placeholder: "Termo de busca...", noResult: "Sem resultados",
      hits: " resultados", solved: "Resolvido", unsolved: "Aberto", untitled: "Sem título",
      errParse: "Falha ao processar resposta", errNetwork: "Erro de rede", errTimeout: "Tempo de requisição esgotado",
      lfBtn: "Postar pedido LF", lfTitle: "Pedido LF", lfNotFound: "Não encontrado no Ripper. Deseja solicitar?",
      lfPost: "Publicar", lfPreview: "Pré-visualizar", lfPosting: "Publicando...",
      lfSuccess: "Publicado!", lfViewPost: "Ver post →", lfLoginWarn: "Você precisa estar logado no forum.ripper.store.",
      watchlist: "Lista de observação", addWatch: "Adicionar à lista", inWatch: "Monitorando",
      noWatch: "Nenhum item na lista", recheck: "Verificar tudo", settings: "Configurações",
      langLabel: "Idioma",
      secLfTemplates: "Modelos de post LF", secBehaviour: "Comportamento", secDataMgmt: "Gerenciar dados",
      labelTitleTpl: "Modelo de título", hintTitleTpl: "Use <code>{name}</code> para o nome do asset",
      labelBodyTpl: "Modelo de corpo", hintBodyTpl: "Use <code>{name}</code> para o nome, <code>{url}</code> para o link",
      labelDefaultTags: "Tags padrão", hintDefaultTags: "Separadas por vírgula — tags inteligentes são adicionadas automaticamente pelo nome",
      labelInterval: "Intervalo de atualização", intervalEvery: "A cada", intervalMin: "minutos",
      labelAutoWatch: "Monitorar posts automaticamente", hintAutoWatch: "Seguir seus posts LF automaticamente para receber notificações de resposta",
      labelAutoUpdate: "Atualizar lista automaticamente", hintAutoUpdate: "Verificar todos os itens da lista por temporizador",
      wmLabel: "Marca d'água — sempre adicionada, não editável",
      btnSave: "Salvar configurações", btnExport: "Exportar dados", btnImport: "Importar dados",
      btnResetDef: "Restaurar padrões", btnDeleteData: "Apagar dados", btnReset: "↺ Restaurar",
      savedMsg: "✓ Salvo",
      lfLabelTitle: "Título", lfLabelCategory: "Categoria", lfLabelTags: "Tags",
      lfLabelTagsHint: "(separadas por vírgula)", lfLabelContent: "Conteúdo",
      lfLabelContentHint: "(Markdown — marca d'água adicionada automaticamente)",
      lfBtnPreview: "Pré-visualizar no site", btnCancel: "Cancelar",
      importTitle: "Importar dados", importDrop: "Arraste seu JSON aqui", importDropSub: "ou clique para selecionar",
      importOk: "✓ Importado com sucesso!", importErr: "Falha ao analisar JSON — é um arquivo de exportação válido?",
      importInvalid: "Arraste um arquivo .json válido.",
      lfErrTitle: "Por favor insira um título.", lfErrContent: "Por favor insira o conteúdo.",
      lfConnecting: "Conectando ao Ripper.Store…",
      modalResetTitle: "Restaurar padrões", modalResetMsg: "Todas as configurações serão restauradas. Sua lista de observação não será afetada.",
      modalResetProceed: "Restaurar",
      modalDeleteTitle: "Apagar lista de observação", modalDeleteMsg: "Todos os itens da lista serão apagados permanentemente. Isso não pode ser desfeito.",
      modalDeleteProceed: "Apagar",
      searching: "Buscando…",
      openPost: "↗ Abrir post", openItem: "↗ Abrir item",
      warnNoName: "<strong>Modelo de título</strong> sem <code>{name}</code> — o nome do asset não aparecerá no título.",
      warnBadUrl: "<strong>Modelo de corpo</strong>: <code>{url}</code> deve estar em uma linha sozinho.",
      kofiCardMsg: "Gostando do Asset Hunter? Considere apoiar!",
      kofiModalTitle: "Antes de fechar isso...",
      kofiModalBody: "O Asset Hunter é gratuito e exigiu muito esforço, tempo e sanidade para ser feito. Doações nunca são necessárias, mas por favor considere apoiar se ele te ajudou.",
      kofiKeepBtn: "Vou considerar",
      kofiCloseBtn: "Fechar mesmo assim",
      kofiDontAsk: "Não perguntar novamente",
    },
  };

  const LANG_OPTIONS = [
    { value: "en",    label: "English" },
    { value: "ja",    label: "日本語" },
    { value: "ru",    label: "Русский" },
    { value: "pt-BR", label: "Português (BR)" },
  ];

  let currentLang = (function() {
    const saved = GM_getValue("ah-cfg-lang", null);
    return (saved && STRINGS[saved]) ? saved : "en";
  })();
  function t(key) { return (STRINGS[currentLang] || STRINGS.en)[key] || key; }

  // ─── Migrate stale default cid ────────────────────────────────────────────
  (function migrateCid() {
    const saved = GM_getValue("bs-lf-cid", null);
    if (saved === null || saved === 2 || saved === 3) GM_setValue("bs-lf-cid", 42);
  })();

  GM_registerMenuCommand("☠ LF Post Category ID", () => {
    const cur = GM_getValue("bs-lf-cid", 42);
    const input = prompt(
      "Enter the category ID for LF/Request posts on forum.ripper.store\n(Check the URL when browsing that category, e.g. /category/42)",
      cur
    );
    const n = parseInt(input, 10);
    if (!isNaN(n) && n > 0) { GM_setValue("bs-lf-cid", n); alert(`Category ID set to ${n}. Reload.`); }
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) { const d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }
  function dec(s) { const d = document.createElement("textarea"); d.innerHTML = s; return d.value; }

  function stripHTML(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  // ─── Core API Calls ───────────────────────────────────────────────────────
  function doSearch(query, cb) {
    GM_xmlhttpRequest({
      method: "GET",
      url: API_URL.replace("{query}", encodeURIComponent(query)),
      responseType: "json",
      timeout: 12000,
      onload: (r) => {
        try {
          const d = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
          cb(null, d);
        } catch(e) { cb(t("errParse")); }
      },
      onerror:  () => cb(t("errNetwork")),
      ontimeout: () => cb(t("errTimeout")),
    });
  }

  const URL_EXTRACT_PATTERNS = [
    /https?:\/\/mega\.nz\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?mediafire\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/drive\.google\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/gofile\.io\/[^\s"'<>)]+/gi,
    /https?:\/\/pixeldrain\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/workupload\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/1fichier\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/onedrive\.live\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/terabox\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/bowfile\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/forum\.ripper\.store\/hidelinks\/r\/[^\s"'<>)]+/gi,
    /https?:\/\/forum\.ripper\.store\/[^\s"'<>)]*hidelinks[^\s"'<>)]*/gi,
  ];

  function extractFirstURL(text) {
    for (const pat of URL_EXTRACT_PATTERNS) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) return m[0].replace(/[.,;!?)]+$/, "");
    }
    return null;
  }

  function checkDL(tid, cb) {
    GM_xmlhttpRequest({
      method: "GET",
      url: TOPIC_API.replace("{tid}", tid),
      responseType: "json",
      timeout: 8000,
      onload: (r) => {
        try {
          const d = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
          for (const p of (d.posts || [])) {
            const htmlContent = p.content || "";
            const rawContent  = p.rawContent || "";
            if (DL_PATTERNS.some(x => x.test(rawContent))) return cb(true);
            if (htmlContent) {
              const plain = stripHTML(htmlContent);
              if (DL_PATTERNS.some(x => x.test(plain))) return cb(true);
              const tmp = document.createElement("div");
              tmp.innerHTML = htmlContent;
              const anchors = tmp.querySelectorAll("a[href]");
              for (const a of anchors) {
                const href = a.getAttribute("href") || "";
                if (DL_PATTERNS.some(x => x.test(href))) return cb(true);
              }
            }
            if (p.attachments && p.attachments.length) return cb(true);
          }
          cb(false);
        } catch(e) { cb(false); }
      },
      onerror:  () => cb(false),
      ontimeout: () => cb(false),
    });
  }

  // ─── LF Post API ──────────────────────────────────────────────────────────
  function getCSRFToken(cb) {
    GM_xmlhttpRequest({
      method: "GET",
      url: CONFIG_API,
      responseType: "json",
      timeout: 8000,
      onload: (r) => {
        try {
          const d = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
          cb(null, d.csrf_token || d["csrf-token"] || d.csrfToken || "");
        } catch(e) { cb("Failed to get CSRF token"); }
      },
      onerror:  () => cb("Network error getting CSRF"),
      ontimeout: () => cb("Timeout getting CSRF"),
    });
  }

  function postLFTopic(title, content, tags, cid, cb) {
    getCSRFToken((err, csrf) => {
      if (err) return cb(err);
      GM_xmlhttpRequest({
        method: "POST",
        url: POST_API,
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        data: JSON.stringify({ cid: parseInt(cid, 10), title, content, tags }),
        responseType: "json",
        timeout: 20000,
        onload: (r) => {
          try {
            const d = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
            if (r.status === 200 && d && (d.tid || (d.response && d.response.tid))) {
              cb(null, d);
            } else if (d && d.status && d.status.code === "ok") {
              cb(null, d);
            } else {
              cb((d && d.status && d.status.message) || (d && d.message) ||
                 `HTTP ${r.status}: Post failed. Make sure you are logged in.`);
            }
          } catch(e) { cb("Failed to parse post response"); }
        },
        onerror:  () => cb("Network error while posting"),
        ontimeout: () => cb("Post request timed out"),
      });
    });
  }

  function watchTopic(tid, csrf) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: `${SITE_URL}/api/v3/topics/${tid}/follow`,
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      data: JSON.stringify({}),
      responseType: "json",
      timeout: 8000,
      onload: (r) => {
        if (r.status !== 200) {
          GM_xmlhttpRequest({
            method: "POST",
            url: `${SITE_URL}/topic/${tid}/follow`,
            headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
            data: JSON.stringify({ tid }),
            responseType: "json", timeout: 8000,
            onload: () => {}, onerror: () => {}, ontimeout: () => {},
          });
        }
      },
      onerror: () => {}, ontimeout: () => {},
    });
  }

  // ─── Forum Category Map ───────────────────────────────────────────────────
  const FORUM_CATEGORIES = [
    { cid: 20, name: "General Discussions",        depth: 0 },
    { cid: 25, name: "Assets",                     depth: 0 },
    { cid: 28, name: "Looking for...",             depth: 1 },
    { cid: 29, name: "General Assets",             depth: 2 },
    { cid: 31, name: "Found Avatars & Assets",     depth: 2 },
    { cid: 33, name: "Booth Avatars",              depth: 2 },
    { cid: 34, name: "Gumroad/Payhip Avatars",     depth: 2 },
    { cid: 35, name: "Furry Avatars",              depth: 2 },
    { cid: 36, name: "NSFW",                       depth: 2 },
    { cid: 37, name: "Scripts & Tools",            depth: 2 },
    { cid: 38, name: "Clothes",                    depth: 2 },
    { cid: 39, name: "Hair",                       depth: 2 },
    { cid: 40, name: "Textures",                   depth: 2 },
    { cid: 41, name: "Uncategorized",              depth: 2 },
    { cid: 42, name: "Other Assets",               depth: 2 },
    { cid: 43, name: "Worlds",                     depth: 2 },
    { cid: 47, name: "Live2D",                     depth: 2 },
    { cid: 44, name: "Gifts / Downloads",          depth: 1 },
  ];

  const GIFTS_CIDS = new Set([44]);

  function isGiftsCategory(category) {
    const catName = dec((category && category.name) || "").toLowerCase();
    return catName.includes("gifts") || catName.includes("downloads") || GIFTS_CIDS.has(category && category.cid);
  }

  function getAutoTags(name) {
    const base  = getSetting("defaultTags").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const n     = (name || "").toLowerCase();
    const extra = [];
    if (/avatar|アバター/.test(n))                   extra.push("avatar");
    if (/cloth|clothes|outfit|wear|衣装|服/.test(n)) extra.push("clothing");
    if (/hair|髪/.test(n))                            extra.push("hair");
    if (/access|アクセ/.test(n))                      extra.push("accessory");
    if (/shader|シェーダー/.test(n))                   extra.push("shader");
    if (/vrchat|vrc/.test(n))                         extra.push("vrchat");
    if (/unity/.test(n))                              extra.push("unity");
    if (/prop|武器|weapon/.test(n))                    extra.push("prop");
    return [...new Set([...base, ...extra])].slice(0, 8);
  }

  // ─── Watchlist Helpers ────────────────────────────────────────────────────
  function wlGet()       { try { return JSON.parse(GM_getValue("bs-watchlist", "[]")); } catch(e) { return []; } }
  function wlSave(list)  { GM_setValue("bs-watchlist", JSON.stringify(list)); }
  function wlAdd(item)   { const l = wlGet(); if (!l.find(x => x.url === item.url)) { l.push(item); wlSave(l); } }
  function wlRemove(url) { wlSave(wlGet().filter(x => x.url !== url)); }

  function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  // ─── Auto-update interval management ─────────────────────────────────────
  let _autoUpdateTimer = null;
  let _recheckFn = null;

  function startAutoUpdate() {
    stopAutoUpdate();
    if (!getSetting("autoUpdate")) return;
    const mins = getSetting("autoUpdateMins");
    _autoUpdateTimer = setInterval(() => {
      if (_recheckFn) _recheckFn();
    }, mins * 60 * 1000);
  }

  function stopAutoUpdate() {
    if (_autoUpdateTimer) { clearInterval(_autoUpdateTimer); _autoUpdateTimer = null; }
  }

  // ─── LF Modal ─────────────────────────────────────────────────────────────
  function showLFModal() {
    const adapter = getAdapter();
    const id   = adapter ? adapter.getId()   : "";
    const name = adapter ? adapter.getName() : "";
    const url  = window.location.href;
    const cid  = GM_getValue("bs-lf-cid", 42);

    document.getElementById("ah-lf-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "ah-lf-modal";
    modal.innerHTML = `
      <div class="ah-lf-backdrop"></div>
      <div class="ah-lf-dialog">
        <div class="ah-lf-dialog-header">
          <div class="ah-lf-dialog-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L8.5 5H13L9.5 7.5L11 11.5L7 9L3 11.5L4.5 7.5L1 5H5.5L7 1Z"
                stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            ${t("lfTitle")}
          </div>
          <button class="ah-lf-close">✕</button>
        </div>
        <div class="ah-lf-dialog-body">
          <div class="ah-lf-field">
            <label class="ah-lf-label">${t("lfLabelTitle")}</label>
            <input id="ah-lf-title" type="text" value="${esc(buildTitle(name))}" />
          </div>
          <div class="ah-lf-row-2">
            <div class="ah-lf-field">
              <label class="ah-lf-label">${t("lfLabelCategory")}</label>
              <select id="ah-lf-cid"></select>
            </div>
            <div class="ah-lf-field">
              <label class="ah-lf-label">${t("lfLabelTags")} <span class="ah-lf-hint">${t("lfLabelTagsHint")}</span></label>
              <input id="ah-lf-tags" type="text" value="${esc(getAutoTags(name).join(", "))}" />
            </div>
          </div>
          <div class="ah-lf-field">
            <label class="ah-lf-label">${t("lfLabelContent")} <span class="ah-lf-hint">${t("lfLabelContentHint")}</span></label>
            <textarea id="ah-lf-content" rows="7">${esc(buildBody(name, url).replace(WATERMARK, "").trimEnd())}</textarea>
          </div>
          <div class="ah-lf-notice">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M6.5 5.5V9.5M6.5 3.5H6.51" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            ${t("lfLoginWarn")}
            <a href="${SITE_URL}" target="_blank" rel="noopener">Open Ripper.Store ↗</a>
          </div>
          <div class="ah-lf-actions">
            <button id="ah-lf-preview">${t("lfBtnPreview")}</button>
            <button id="ah-lf-submit">${t("lfPost")}</button>
          </div>
          <div id="ah-lf-status"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    injectModalCSS();

    modal.querySelector("#ah-lf-cid").innerHTML = FORUM_CATEGORIES.map(c => {
      const pad      = "\u00a0\u00a0\u00a0".repeat(c.depth);
      const selected = c.cid === cid ? " selected" : "";
      return `<option value="${c.cid}"${selected}>${pad}${c.name}</option>`;
    }).join("");

    modal.querySelector(".ah-lf-close").addEventListener("click",   () => modal.remove());
    modal.querySelector(".ah-lf-backdrop").addEventListener("click", () => modal.remove());

    modal.querySelector("#ah-lf-preview").addEventListener("click", () => {
      const ttl  = modal.querySelector("#ah-lf-title").value;
      const cidV = modal.querySelector("#ah-lf-cid").value;
      window.open(`${SITE_URL}/compose?cid=${cidV}&title=${encodeURIComponent(ttl)}`, "_blank");
    });

    modal.querySelector("#ah-lf-submit").addEventListener("click", () => {
      const postTitle   = modal.querySelector("#ah-lf-title").value.trim();
      const postContent = modal.querySelector("#ah-lf-content").value.trim() + WATERMARK;
      const postTags    = modal.querySelector("#ah-lf-tags").value
                            .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const postCid     = parseInt(modal.querySelector("#ah-lf-cid").value, 10) || cid;

      if (!postTitle)   { setStatus(t("lfErrTitle"),   "err"); return; }
      if (!postContent) { setStatus(t("lfErrContent"), "err"); return; }

      const btn = modal.querySelector("#ah-lf-submit");
      btn.disabled = true; btn.textContent = t("lfPosting");
      setStatus(t("lfConnecting"), "load");
      GM_setValue("bs-lf-cid", postCid);

      postLFTopic(postTitle, postContent, postTags, postCid, (err, result) => {
        btn.disabled = false; btn.textContent = t("lfPost");
        if (err) { setStatus(`❌ ${err}`, "err"); return; }

        const topicData = (result && result.response && result.response.topicData) ||
                          (result && result.topicData) ||
                          (result && result.response) || result || {};
        const slug     = topicData.slug || topicData.tid || null;
        const topicUrl = slug ? `${SITE_URL}/topic/${slug}` : SITE_URL;
        const tid      = topicData.tid;

        if (tid && getSetting("autoWatch")) {
          getCSRFToken((csrfErr, csrf) => { if (!csrfErr && csrf) watchTopic(tid, csrf); });
        }

        setStatus(`${t("lfSuccess")} <a href="${topicUrl}" target="_blank" rel="noopener">${t("lfViewPost")}</a>`, "ok");
        setTimeout(() => modal.remove(), 5000);
      });
    });

    function setStatus(html, type) {
      const el = modal.querySelector("#ah-lf-status");
      el.innerHTML = html; el.className = `ah-lf-st-${type}`;
    }
  }

  // ─── Import Modal ─────────────────────────────────────────────────────────
  function showImportModal(onImport) {
    document.getElementById("ah-import-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "ah-import-modal";
    modal.innerHTML = `
      <div class="ah-import-backdrop"></div>
      <div class="ah-import-dialog">
        <div class="ah-import-header">
          <div class="ah-import-title">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 9V3M3.5 6l3 3 3-3M1 11h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Import Data
          </div>
          <button class="ah-import-close">✕</button>
        </div>
        <div class="ah-import-body">
          <div class="ah-import-drop" id="ah-import-drop">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 4v14M7 11l7-7 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 22h20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span class="ah-import-drop-label">${t("importDrop")}</span>
            <span class="ah-import-drop-sub">${t("importDropSub")}</span>
            <input type="file" id="ah-import-file" accept=".json,application/json" style="display:none"/>
          </div>
          <div id="ah-import-status"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    injectImportCSS();

    const close = () => modal.remove();
    modal.querySelector(".ah-import-backdrop").addEventListener("click", close);
    modal.querySelector(".ah-import-close").addEventListener("click", close);

    const drop    = modal.querySelector("#ah-import-drop");
    const fileInp = modal.querySelector("#ah-import-file");
    const status  = modal.querySelector("#ah-import-status");

    function setStatus(msg, type) {
      status.textContent = msg;
      status.className   = `ah-import-st ah-import-st--${type}`;
    }

    function processFile(file) {
      if (!file || !file.name.endsWith(".json")) {
        setStatus(t("importInvalid"), "err"); return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || (typeof data !== "object")) throw new Error("Invalid format");
          setStatus(t("importOk"), "ok");
          setTimeout(() => { modal.remove(); onImport(data); }, 900);
        } catch(err) {
          setStatus(t("importErr"), "err");
        }
      };
      reader.readAsText(file);
    }

    drop.addEventListener("click", () => fileInp.click());
    fileInp.addEventListener("change", () => {
      if (fileInp.files[0]) processFile(fileInp.files[0]);
    });

    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("ah-import-drop--over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("ah-import-drop--over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("ah-import-drop--over");
      const file = e.dataTransfer.files[0];
      processFile(file);
    });
  }

  // ─── Confirm Modal ─────────────────────────────────────────────────────────
  function showConfirmModal({ title, message, proceedLabel, onProceed }) {
    document.getElementById("ah-confirm-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "ah-confirm-modal";
    modal.innerHTML = `
      <div class="ah-confirm-backdrop"></div>
      <div class="ah-confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="ah-confirm-icon-row">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 3L26 24H2L14 3Z" stroke="#ff6680" stroke-width="1.6" stroke-linejoin="round" fill="rgba(255,102,128,.08)"/>
            <path d="M14 11V17" stroke="#ff6680" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="14" cy="21" r="1.1" fill="#ff6680"/>
          </svg>
          <span class="ah-confirm-title">${esc(title)}</span>
        </div>
        <div class="ah-confirm-body">${esc(message)}</div>
        <div class="ah-confirm-actions">
          <button class="ah-confirm-cancel" id="ah-confirm-cancel">${t("btnCancel")}</button>
          <button class="ah-confirm-proceed" id="ah-confirm-proceed">${esc(proceedLabel || "Proceed")}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    injectConfirmCSS();

    const close = () => modal.remove();
    modal.querySelector(".ah-confirm-backdrop").addEventListener("click", close);
    modal.querySelector("#ah-confirm-cancel").addEventListener("click", close);
    modal.querySelector("#ah-confirm-proceed").addEventListener("click", () => {
      close();
      onProceed();
    });
  }

  // ─── Render Results ───────────────────────────────────────────────────────
  function renderResults(data, panel) {
    const posts = data.posts || [], count = data.matchCount || 0;

    if (!count || !posts.length) {
      return `<div class="ah-no-results">${t("noResult")}</div>
        <div class="ah-lf-prompt">
          <p>${t("lfNotFound")}</p>
          <button class="ah-btn-lf" id="ah-lf-open">${t("lfBtn")}</button>
        </div>`;
    }

    const dloc = { en: "en-US", ja: "ja-JP", ru: "ru-RU", "pt-BR": "pt-BR" }[currentLang] || "en-US";

    function buildCard(post, isDL) {
      const tp    = post.topic    || {};
      const cat   = post.category || {};
      const u     = post.user     || {};
      const tid   = tp.tid || "";
      const title = dec(tp.titleRaw || tp.title || t("untitled"));
      const href  = `${SITE_URL}/topic/${tp.slug || tid}`;
      const catN  = dec(cat.name || "");
      const solved = tp.isSolved === 1;
      const pc    = tp.postcount || 0;
      const vc    = tp.viewcount || 0;
      const date  = post.timestampISO ? new Date(post.timestampISO).toLocaleDateString(dloc) : "";
      const tags  = (tp.tags || []).map(g => dec(g.value));
      const user  = dec(u.displayname || u.username || "?");

      const catStyle = getCatStyle(catN);
      const catBadge = catN
        ? `<span class="ah-cat" style="color:${catStyle.color};background:${catStyle.bg};border-color:${catStyle.bd}">${esc(catN)}</span>`
        : "";

      const openStyle   = getCatStyle("open");
      const solvedStyle = getCatStyle("solved");
      const statusBadge = solved
        ? `<span class="ah-badge ah-badge--solved" style="color:${solvedStyle.color};background:${solvedStyle.bg};border-color:${solvedStyle.bd}">${t("solved")}</span>`
        : `<span class="ah-badge ah-badge--open" style="color:${openStyle.color};background:${openStyle.bg};border-color:${openStyle.bd}">${t("unsolved")}</span>`;

      const dlChip = isDL
        ? `<span class="ah-dl-chip">↓ DL</span>`
        : "";

      return `<a class="ah-card ${isDL ? "ah-card--dl" : "ah-card--disc"}" data-tid="${esc(String(tid))}" data-slug="${esc(String(tp.slug || tid))}" href="${href}" target="_blank" rel="noopener">
        <div class="ah-card-top">
          ${statusBadge}
          ${catBadge}
          ${dlChip}
        </div>
        <div class="ah-card-title">${esc(title)}</div>
        <div class="ah-card-meta">
          <span class="ah-card-user">${esc(user)}</span>
          <span>${date}</span><span>💬 ${pc}</span><span>👁 ${vc}</span>
        </div>
        ${tags.length ? `<div class="ah-tags">${tags.map(g => `<span class="ah-tag">${esc(g)}</span>`).join("")}</div>` : ""}
      </a>`;
    }

    let html = `<div class="ah-result-count">${count}${t("hits")}</div>`;
    html += `<div class="ah-section-label ah-section--dl" id="ah-dl-hd" style="display:none">↓ Download Found</div>`;
    html += `<div class="ah-list" id="ah-dl-list"></div>`;
    html += `<div class="ah-section-label ah-section--disc" id="ah-disc-hd" style="display:none">◎ Discussions</div>`;
    html += `<div class="ah-list" id="ah-disc-list">`;
    for (const post of posts) {
      const cat  = post.category || {};
      const isGifts = isGiftsCategory(cat);
      html += buildCard(post, isGifts);
    }
    html += `</div>`;
    html += `<div class="ah-bottom-actions">
      <button class="ah-btn-watch" id="ah-wl-add">${t("addWatch")}</button>
      <button class="ah-btn-lf" id="ah-lf-open">${t("lfBtn")}</button>
    </div>`;

    setTimeout(() => {
      const out      = panel.querySelector("#ah-out"); if (!out) return;
      const discHd   = out.querySelector("#ah-disc-hd");
      const dlHd     = out.querySelector("#ah-dl-hd");
      const dlList   = out.querySelector("#ah-dl-list");
      const discList = out.querySelector("#ah-disc-list");

      if (discList && dlList) {
        Array.from(discList.querySelectorAll(".ah-card--dl")).forEach(card => {
          dlList.appendChild(card);
          dlHd.style.display = "";
        });
        if (discList.children.length) discHd.style.display = "";
      }

      for (const post of posts) {
        const tid  = (post.topic || {}).tid; if (!tid) continue;
        const isGifts = isGiftsCategory(post.category || {});
        if (isGifts) continue;

        checkDL(tid, (found) => {
          if (!found) return;
          const card = discList && discList.querySelector(`[data-tid="${tid}"]`);
          if (card && dlList) {
            const clone = card.cloneNode(true);
            clone.className = "ah-card ah-card--dl";
            if (!clone.querySelector(".ah-dl-chip")) {
              const chip = document.createElement("span");
              chip.className = "ah-dl-chip";
              chip.textContent = "↓ DL";
              clone.querySelector(".ah-card-top").appendChild(chip);
            }
            dlList.appendChild(clone);
            card.remove();
            dlHd.style.display = "";
            if (discList.children.length === 0) discHd.style.display = "none";
          }
        });
      }
    }, 150);

    return html;
  }

  // ─── Main Panel ───────────────────────────────────────────────────────────
  function injectUI() {
    if (document.getElementById("ah-panel")) return;

    const adapter = getAdapter();
    if (!adapter) return;

    const id    = adapter.getId();
    const name  = adapter.getName();
    const query = adapter.buildQuery(id, name);
    if (!query) return;

    const platformLabel = (() => {
      if (HOST === "booth.pm" || HOST.endsWith(".booth.pm")) return "booth.pm";
      if (HOST === "gumroad.com" || HOST.endsWith(".gumroad.com")) return "gumroad";
      if (HOST === "jinxxy.com" || HOST.endsWith(".jinxxy.com")) return "jinxxy";
      if (HOST === "payhip.com" || HOST.endsWith(".payhip.com")) return "payhip";
      return HOST;
    })();

    const panel = document.createElement("div");
    panel.id = "ah-panel";
    panel.innerHTML = `
      <div id="ah-header">
        <div id="ah-header-left">
          <svg class="ah-logo-star" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L9.5 6H15L10.5 9L12 14L8 11L4 14L5.5 9L1 6H6.5L8 1Z"
              stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          </svg>
          <span id="ah-title">${t("title")}</span>
        </div>
        <div id="ah-header-right">
          <span id="ah-booth-badge">${platformLabel}</span>
          <button id="ah-minimize" title="${t("minimize")}">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="ah-collapsible">
        <div id="ah-tabs">
          <button class="ah-tab ah-tab--active" data-tab="search" id="ah-tab-search">${t("search")}</button>
          <button class="ah-tab" data-tab="watchlist" id="ah-tab-watchlist">${t("watchlist")} <span id="ah-wl-count"></span></button>
          <button class="ah-tab ah-tab--icon" data-tab="settings" title="${t("settings")}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="1.8" stroke="currentColor" stroke-width="1.2"/>
              <path d="M6 1.5V2.5M6 9.5V10.5M1.5 6H2.5M9.5 6H10.5M2.9 2.9L3.6 3.6M8.4 8.4L9.1 9.1M2.9 9.1L3.6 8.4M8.4 3.6L9.1 2.9"
                stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
          </button>
          <button id="ah-recheck-btn" title="${t("recheck")}">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M11 6.5A4.5 4.5 0 1 1 9.2 3M11 1.5V4H8.5"
                stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div id="ah-pane-search">
          <div id="ah-item-info">
            <div id="ah-item-name" title="${esc(name)}">${esc(name) || t("unknown")}</div>
            ${id ? `<div id="ah-item-id">ID ${id}</div>` : ""}
          </div>
          <div id="ah-search-row">
            <input id="ah-input" type="text" value="${esc(query)}" placeholder="${t("placeholder")}" />
            <button id="ah-search-btn">${t("search")}</button>
          </div>
          <div id="ah-out"></div>
        </div>

        <div id="ah-pane-watchlist" style="display:none">
          <div id="ah-wl-body"></div>
        </div>

        <div id="ah-pane-settings" style="display:none">
          <div id="ah-settings-body"></div>
        </div>
      </div>`;
    document.body.appendChild(panel);
    injectCSS();

    // ── Ko-fi donation card ──────────────────────────────────────────────────
    const KOFI_CLOSE_ANYWAY_COUNT_KEY = "ah-kofi-close-anyway-count";
    const KOFI_DONT_ASK_KEY = "ah-kofi-dont-ask";
    const card = document.createElement("div");
    card.id = "ah-kofi-card";
    let renderKofiCardContent = () => {};
    if (GM_getValue(KOFI_DONT_ASK_KEY, "0") === "1") {
      renderKofiCardContent = () => {};
    } else {
      renderKofiCardContent = () => {
        card.innerHTML = `<div id="ah-kofi-inner">
      <span id="ah-kofi-heart">♥</span>
      <div id="ah-kofi-text">
        <span id="ah-kofi-msg">${t("kofiCardMsg")}</span>
        <a href="https://ko-fi.com/xedinho" target="_blank" rel="noopener">☕ ko-fi.com/xedinho</a>
      </div>
      <button id="ah-kofi-close">✕</button>
    </div>`;
        card.querySelector("#ah-kofi-close").addEventListener("click", showKofiCloseModal);
      };
      renderKofiCardContent();
      document.body.appendChild(card);

    function positionKofiCard() {
      const pr = panel.getBoundingClientRect();
      card.style.right  = (window.innerWidth  - pr.right)  + "px";
      card.style.bottom = (window.innerHeight - pr.top + 5) + "px";
      card.style.width  = pr.width + "px";
    }

    requestAnimationFrame(() => requestAnimationFrame(positionKofiCard));
    window.addEventListener("resize", positionKofiCard);
    if (typeof ResizeObserver !== "undefined") {
      const kofiObserver = new ResizeObserver(positionKofiCard);
      kofiObserver.observe(panel);
    }

    function showKofiCloseModal() {
      document.getElementById("ah-kofi-confirm-modal")?.remove();
      const closeAnywayCount = parseInt(GM_getValue(KOFI_CLOSE_ANYWAY_COUNT_KEY, "0"), 10) || 0;
      const canShowDontAsk = closeAnywayCount > 5;
      const modal = document.createElement("div");
      modal.id = "ah-kofi-confirm-modal";
      modal.innerHTML = `
        <div class="ah-kofi-confirm-backdrop"></div>
        <div class="ah-kofi-confirm-dialog" role="alertdialog" aria-modal="true">
          <div class="ah-kofi-confirm-title">
            <span class="ah-kofi-confirm-heart">♥</span>
            ${t("kofiModalTitle")}
          </div>
          <div class="ah-kofi-confirm-body">
            ${t("kofiModalBody")}
          </div>
          <a href="https://ko-fi.com/xedinho" target="_blank" rel="noopener" class="ah-kofi-confirm-link">☕ ko-fi.com/xedinho</a>
          ${canShowDontAsk ? `<label class="ah-kofi-confirm-optout"><input type="checkbox" id="ah-kofi-dont-ask"> ${t("kofiDontAsk")}</label>` : ""}
          <div class="ah-kofi-confirm-actions">
            <button id="ah-kofi-keep-btn">${t("kofiKeepBtn")}</button>
            <button id="ah-kofi-close-btn">${t("kofiCloseBtn")}</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const dismiss = () => modal.remove();
      modal.querySelector(".ah-kofi-confirm-backdrop").addEventListener("click", dismiss);
      modal.querySelector("#ah-kofi-keep-btn").addEventListener("click", dismiss);
      modal.querySelector("#ah-kofi-close-btn").addEventListener("click", () => {
        const nextCount = closeAnywayCount + 1;
        GM_setValue(KOFI_CLOSE_ANYWAY_COUNT_KEY, String(nextCount));
        const dontAskEl = modal.querySelector("#ah-kofi-dont-ask");
        if (dontAskEl && dontAskEl.checked) {
          GM_setValue(KOFI_DONT_ASK_KEY, "1");
        }
        card.remove();
        dismiss();
      });
    }
    }

    const out     = panel.querySelector("#ah-out");
    const inp     = panel.querySelector("#ah-input");
    const wlBody  = panel.querySelector("#ah-wl-body");
    const setBody = panel.querySelector("#ah-settings-body");
    let lastSearchData = null;

    function updateWlCount() {
      const el = panel.querySelector("#ah-wl-count");
      const n  = wlGet().length;
      el.textContent = n > 0 ? `(${n})` : "";
    }
    updateWlCount();

    // ── Tab switching ──
    const PANES = { search: "#ah-pane-search", watchlist: "#ah-pane-watchlist", settings: "#ah-pane-settings" };
    panel.querySelectorAll(".ah-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        panel.querySelectorAll(".ah-tab").forEach(b => b.classList.remove("ah-tab--active"));
        btn.classList.add("ah-tab--active");
        const tab = btn.dataset.tab;
        Object.entries(PANES).forEach(([k, sel]) => {
          panel.querySelector(sel).style.display = k === tab ? "" : "none";
        });
        if (tab === "watchlist") renderWatchlist();
        if (tab === "settings")  renderSettings();
      });
    });

    // ── Watchlist ──
    function renderWatchlist() {
      const list = wlGet();
      updateWlCount();
      if (!list.length) { wlBody.innerHTML = `<div class="ah-wl-empty">${t("noWatch")}</div>`; return; }

      const dlItems    = list.filter(x => x.status === "dl");
      const discItems  = list.filter(x => x.status === "found");
      const otherItems = list.filter(x => x.status !== "dl" && x.status !== "found");

      function itemHTML(item) {
        const hasTid     = item.ripperTid || item.ripperSlug;
        const topicRef   = item.ripperTid || item.ripperSlug;
        const isDLStatus = item.status === "dl";
        const isFoundStatus = item.status === "found";

        const badge =
          isDLStatus      ? `<span class="ah-wl-badge ah-wl-badge--dl">↓ DL Found</span>`     :
          isFoundStatus   ? `<span class="ah-wl-badge ah-wl-badge--disc">◎ Discussion</span>`  :
          item.status === "none"
                          ? `<span class="ah-wl-badge ah-wl-badge--none">✗ Not Found</span>`   :
                            `<span class="ah-wl-badge ah-wl-badge--pending">⏳ Pending</span>`;

        const checked = item.lastChecked
          ? `<span class="ah-wl-ts" data-ts="${item.lastChecked}">${timeAgo(item.lastChecked)}</span>`
          : "";

        const ripperLink = (isDLStatus || isFoundStatus) && hasTid
          ? `<a href="${SITE_URL}/topic/${esc(String(topicRef))}" target="_blank" class="ah-wl-link ah-wl-link--ripper">${t("openPost")}</a>`
          : "";

        return `<div class="ah-wl-item ah-wl-item--${item.status || "pending"}" data-url="${esc(item.url)}">
          <div class="ah-wl-row1">
            ${badge}
            <button class="ah-wl-remove" data-url="${esc(item.url)}">✕</button>
          </div>
          <div class="ah-wl-name">${esc(item.name)}</div>
          <div class="ah-wl-row2">
            <a href="${esc(item.url)}" target="_blank" class="ah-wl-link">${t("openItem")}</a>
            ${ripperLink}
            ${checked}
          </div>
        </div>`;
      }

      let html = "";
      if (dlItems.length)    html += `<div class="ah-section-label ah-section--dl">↓ Download Found</div>` + dlItems.map(itemHTML).join("");
      if (discItems.length)  html += `<div class="ah-section-label ah-section--disc">◎ Discussions</div>` + discItems.map(itemHTML).join("");
      if (otherItems.length) {
        if (dlItems.length || discItems.length) html += `<div class="ah-section-label ah-section--other">○ Other</div>`;
        html += otherItems.map(itemHTML).join("");
      }

      wlBody.innerHTML = html;

      wlBody.querySelectorAll(".ah-wl-remove").forEach(btn => {
        btn.addEventListener("click", e => { e.preventDefault(); wlRemove(btn.dataset.url); renderWatchlist(); });
      });

      if (wlBody._tick) clearInterval(wlBody._tick);
      wlBody._tick = setInterval(() => {
        wlBody.querySelectorAll(".ah-wl-ts").forEach(el => {
          const ts = parseInt(el.dataset.ts, 10); if (ts) el.textContent = timeAgo(ts);
        });
      }, 1000);
    }

    // ── Settings validation warn popup ──
    function showSettingsWarn(errors) {
      if (document.getElementById("ah-warn-modal")) return;

      const modal = document.createElement("div");
      modal.id = "ah-warn-modal";

      const itemsHTML = errors.map(function(e) {
        return '<div class="ah-warn-item">' + e + '</div>';
      }).join("");

      modal.innerHTML = [
        '<div class="ah-warn-backdrop"></div>',
        '<div class="ah-warn-dialog" role="alertdialog" aria-modal="true">',
          '<div class="ah-warn-icon-row">',
            '<svg width="28" height="28" viewBox="0 0 28 28" fill="none">',
              '<path d="M14 3L26 24H2L14 3Z" stroke="#ff6680" stroke-width="1.6" stroke-linejoin="round" fill="rgba(255,102,128,.08)"/>',
              '<path d="M14 11V17" stroke="#ff6680" stroke-width="1.8" stroke-linecap="round"/>',
              '<circle cx="14" cy="21" r="1.1" fill="#ff6680"/>',
            '</svg>',
            '<span class="ah-warn-title">Check your templates</span>',
          '</div>',
          '<div class="ah-warn-body">' + itemsHTML + '</div>',
          '<button class="ah-warn-btn" id="ah-warn-ok">Understood</button>',
        '</div>'
      ].join("");

      document.body.appendChild(modal);
      injectWarnCSS();

      const close = function() { modal.remove(); };
      modal.querySelector("#ah-warn-ok").addEventListener("click", close);
      modal.querySelector(".ah-warn-backdrop").addEventListener("click", close);
    }

    // ── Settings ──
    function renderSettings() {
      const autoUpdateMins = getSetting("autoUpdateMins");
      const autoUpdateMinsIdx = AUTO_UPDATE_MIN_OPTIONS.indexOf(autoUpdateMins);
      setBody.innerHTML = `
        <div class="ah-set-section">${t("langLabel")}</div>

        <div class="ah-set-field">
          <select class="ah-set-input ah-set-input--single" id="ah-set-lang">
            ${LANG_OPTIONS.map(o => `<option value="${o.value}"${o.value === currentLang ? " selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ah-set-section">${t("secLfTemplates")}</div>

        <div class="ah-set-field">
          <div class="ah-set-field-hd">
            <label class="ah-set-label">${t("labelTitleTpl")}</label>
            <button class="ah-set-reset" data-key="titleTpl">${t("btnReset")}</button>
          </div>
          <div class="ah-set-hint">${t("hintTitleTpl")}</div>
          <textarea class="ah-set-input ah-set-input--single" id="ah-set-titleTpl" rows="1">${esc(getSetting("titleTpl"))}</textarea>
        </div>

        <div class="ah-set-field">
          <div class="ah-set-field-hd">
            <label class="ah-set-label">${t("labelBodyTpl")}</label>
            <button class="ah-set-reset" data-key="bodyTpl">${t("btnReset")}</button>
          </div>
          <div class="ah-set-hint">${t("hintBodyTpl")}</div>
          <textarea class="ah-set-input" id="ah-set-bodyTpl" rows="6">${esc(getSetting("bodyTpl"))}</textarea>
          <div class="ah-set-wm-box">
            <span class="ah-set-wm-label">${t("wmLabel")}</span>
            <pre class="ah-set-wm-pre">---\n# Posted via Asset Hunter</pre>
          </div>
        </div>

        <div class="ah-set-field">
          <div class="ah-set-field-hd">
            <label class="ah-set-label">${t("labelDefaultTags")}</label>
            <button class="ah-set-reset" data-key="defaultTags">${t("btnReset")}</button>
          </div>
          <div class="ah-set-hint">${t("hintDefaultTags")}</div>
          <textarea class="ah-set-input ah-set-input--single" id="ah-set-defaultTags" rows="1">${esc(getSetting("defaultTags"))}</textarea>
        </div>

        <div class="ah-set-section">${t("secBehaviour")}</div>

        <div class="ah-set-toggle-row">
          <div class="ah-set-toggle-info">
            <span class="ah-set-toggle-label">${t("labelAutoWatch")}</span>
            <span class="ah-set-toggle-hint">${t("hintAutoWatch")}</span>
          </div>
          <button class="ah-set-toggle ${getSetting("autoWatch") ? "ah-set-toggle--on" : ""}"
            id="ah-set-autoWatch" aria-pressed="${getSetting("autoWatch")}">
            <span class="ah-set-toggle-knob"></span>
          </button>
        </div>

        <div class="ah-set-toggle-row">
          <div class="ah-set-toggle-info">
            <span class="ah-set-toggle-label">${t("labelAutoUpdate")}</span>
            <span class="ah-set-toggle-hint">${t("hintAutoUpdate")}</span>
          </div>
          <button class="ah-set-toggle ${getSetting("autoUpdate") ? "ah-set-toggle--on" : ""}"
            id="ah-set-autoUpdate" aria-pressed="${getSetting("autoUpdate")}">
            <span class="ah-set-toggle-knob"></span>
          </button>
        </div>

        <div class="ah-set-field" id="ah-set-interval-row">
          <label class="ah-set-label">${t("labelInterval")}</label>
          <div class="ah-set-slider-wrap">
            <input type="range" id="ah-set-slider" class="ah-set-slider"
              min="0" max="5" step="1"
              value="${autoUpdateMinsIdx < 0 ? 2 : autoUpdateMinsIdx}" />
            <div class="ah-set-slider-labels">
              <span>5m</span><span>10m</span><span>15m</span><span>20m</span><span>25m</span><span>30m</span>
            </div>
            <div class="ah-set-slider-val">${t("intervalEvery")} <span id="ah-set-slider-display">${autoUpdateMins}</span> ${t("intervalMin")}</div>
          </div>
        </div>

        <div class="ah-set-section ah-set-section--danger">${t("secDataMgmt")}</div>

        <div class="ah-set-data-actions">
          <button class="ah-set-data-btn ah-set-data-btn--export" id="ah-set-export">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M5.5 1v6M2.5 5l3 3 3-3M1 9h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${t("btnExport")}
          </button>
          <button class="ah-set-data-btn ah-set-data-btn--import" id="ah-set-import">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M5.5 10V4M2.5 6l3-3 3 3M1 1h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${t("btnImport")}
          </button>
          <button class="ah-set-data-btn ah-set-data-btn--reset" id="ah-set-reset-defaults">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M9 5.5A3.5 3.5 0 1 1 7.2 2.5M9 1v2.5H6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${t("btnResetDef")}
          </button>
          <button class="ah-set-data-btn ah-set-data-btn--delete" id="ah-set-delete-data">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 3h8M4 3V2h3v1M2.5 3l.5 6h5l.5-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${t("btnDeleteData")}
          </button>
        </div>`;

      const slider = setBody.querySelector("#ah-set-slider");
      const sliderDisplay = setBody.querySelector("#ah-set-slider-display");

      function autoSaveTitleTpl() {
        const val = setBody.querySelector("#ah-set-titleTpl").value || DEFAULTS.titleTpl;
        setSetting("titleTpl", val);
      }
      function autoSaveBodyTpl() {
        const val = setBody.querySelector("#ah-set-bodyTpl").value || DEFAULTS.bodyTpl;
        setSetting("bodyTpl", val);
      }
      function autoSaveDefaultTags() {
        const val = setBody.querySelector("#ah-set-defaultTags").value || DEFAULTS.defaultTags;
        setSetting("defaultTags", val);
      }

      setBody.querySelector("#ah-set-titleTpl").addEventListener("change", autoSaveTitleTpl);
      setBody.querySelector("#ah-set-bodyTpl").addEventListener("change", autoSaveBodyTpl);
      setBody.querySelector("#ah-set-defaultTags").addEventListener("change", autoSaveDefaultTags);

      setBody.querySelector("#ah-set-lang").addEventListener("change", function() {
        const chosen = this.value;
        if (chosen && STRINGS[chosen]) {
          GM_setValue("ah-cfg-lang", chosen);
          currentLang = chosen;
          const tabSearch = panel.querySelector("#ah-tab-search");
          const tabWl     = panel.querySelector("#ah-tab-watchlist");
          const wlCount   = panel.querySelector("#ah-wl-count");
          if (tabSearch) tabSearch.textContent = t("search");
          if (tabWl)     tabWl.innerHTML = `${t("watchlist")} <span id="ah-wl-count">${wlCount ? wlCount.textContent : ""}</span>`;
          if (document.getElementById("ah-kofi-card")) renderKofiCardContent();
          if (lastSearchData) {
            out.innerHTML = renderResults(lastSearchData, panel);
            wireSearchResults();
          }
          if (wlBody.closest("#ah-pane-watchlist").style.display !== "none") {
            renderWatchlist();
          }
          renderSettings();
        }
      });

      setBody.querySelector("#ah-set-autoWatch").addEventListener("click", function() {
        const on = this.classList.toggle("ah-set-toggle--on");
        this.setAttribute("aria-pressed", on);
        setSetting("autoWatch", on);
      });

      setBody.querySelector("#ah-set-autoUpdate").addEventListener("click", function() {
        const on = this.classList.toggle("ah-set-toggle--on");
        this.setAttribute("aria-pressed", on);
        setSetting("autoUpdate", on);
        if (on) { startAutoUpdate(); } else { stopAutoUpdate(); }
      });

      slider.addEventListener("input", () => {
        const mins = AUTO_UPDATE_MIN_OPTIONS[parseInt(slider.value, 10)];
        sliderDisplay.textContent = mins;
        setSetting("autoUpdateMins", mins);
      });

      setBody.querySelectorAll(".ah-set-reset").forEach(btn => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.key;
          const el  = setBody.querySelector(`#ah-set-${key}`);
          if (el) { el.value = DEFAULTS[key]; setSetting(key, DEFAULTS[key]); }
        });
      });

      setBody.querySelector("#ah-set-export").addEventListener("click", () => {
        const exportData = {
          version: "5.5.0",
          exported: new Date().toISOString(),
          settings: {
            lang:           currentLang,
            titleTpl:       getSetting("titleTpl"),
            bodyTpl:        getSetting("bodyTpl"),
            defaultTags:    getSetting("defaultTags"),
            autoWatch:      getSetting("autoWatch"),
            autoUpdate:     getSetting("autoUpdate"),
            autoUpdateMins: getSetting("autoUpdateMins"),
          },
          watchlist: wlGet(),
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `asset-hunter-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });

      setBody.querySelector("#ah-set-import").addEventListener("click", () => {
        showImportModal((data) => {
          if (data.settings) {
            const s = data.settings;
            if (s.lang && STRINGS[s.lang]) { GM_setValue("ah-cfg-lang", s.lang); currentLang = s.lang; }
            if (s.titleTpl)       setSetting("titleTpl",       s.titleTpl);
            if (s.bodyTpl)        setSetting("bodyTpl",        s.bodyTpl);
            if (s.defaultTags)    setSetting("defaultTags",    s.defaultTags);
            if (s.autoWatch      !== undefined) setSetting("autoWatch",      s.autoWatch);
            if (s.autoUpdate     !== undefined) setSetting("autoUpdate",     s.autoUpdate);
            if (s.autoUpdateMins !== undefined) setSetting("autoUpdateMins", s.autoUpdateMins);
          }
          if (Array.isArray(data.watchlist)) {
            wlSave(data.watchlist);
            updateWlCount();
          }
          renderSettings();
        });
      });

      setBody.querySelector("#ah-set-reset-defaults").addEventListener("click", () => {
        showConfirmModal({
          title: t("modalResetTitle"),
          message: t("modalResetMsg"),
          proceedLabel: t("modalResetProceed"),
          onProceed: () => {
            ["titleTpl","bodyTpl","defaultTags","autoWatch","autoUpdate","autoUpdateMins"].forEach(k => {
              GM_setValue("ah-cfg-" + k, null);
            });
            GM_setValue("ah-cfg-lang", null);
            currentLang = "en";
            stopAutoUpdate();
            renderSettings();
          },
        });
      });

      setBody.querySelector("#ah-set-delete-data").addEventListener("click", () => {
        showConfirmModal({
          title: t("modalDeleteTitle"),
          message: t("modalDeleteMsg"),
          proceedLabel: t("modalDeleteProceed"),
          onProceed: () => {
            wlSave([]);
            updateWlCount();
            renderSettings();
          },
        });
      });
    }

    // ── Watchlist re-check ──
    function runWatchlistCheck() {
      panel.querySelectorAll(".ah-tab").forEach(b => b.classList.remove("ah-tab--active"));
      panel.querySelector('[data-tab="watchlist"]').classList.add("ah-tab--active");
      Object.entries(PANES).forEach(([k, sel]) => {
        panel.querySelector(sel).style.display = k === "watchlist" ? "" : "none";
      });

      const list = wlGet();
      if (!list.length) { renderWatchlist(); return; }
      list.forEach(item => { item.status = "pending"; });
      wlSave(list); renderWatchlist();

      let i = 0;
      function nextCheck() {
        if (i >= list.length) return;
        const item = list[i++];
        doSearch(item.id || item.name, (err, data) => {
          const cur   = wlGet();
          const entry = cur.find(x => x.url === item.url);
          if (!entry) { setTimeout(nextCheck, WATCHLIST_RECHECK_DELAY_MS); return; }

          if (err || !data || !data.matchCount || !data.posts || !data.posts.length) {
            entry.status = "none"; entry.lastChecked = Date.now();
            wlSave(cur); renderWatchlist(); setTimeout(nextCheck, WATCHLIST_RECHECK_DELAY_MS); return;
          }

          const giftsPost = data.posts.find(p => isGiftsCategory(p.category || {}));
          if (giftsPost) {
            const tp = giftsPost.topic || {};
            entry.status = "dl";
            entry.lastChecked = Date.now();
            entry.ripperTid   = tp.tid || null;
            entry.ripperSlug  = tp.slug || tp.tid || null;
            wlSave(cur); renderWatchlist();
            setTimeout(nextCheck, WATCHLIST_RECHECK_DELAY_MS);
            return;
          }

          const topics = data.posts.map(p => ({ tid: (p.topic || {}).tid, slug: (p.topic || {}).slug })).filter(x => x.tid);
          let foundDL  = false;
          function checkNext(idx) {
            if (foundDL) return;
            if (idx >= topics.length) {
              if (!foundDL) {
                entry.status = "found";
                entry.lastChecked = Date.now();
                if (topics.length > 0) {
                  entry.ripperTid  = topics[0].tid;
                  entry.ripperSlug = topics[0].slug || topics[0].tid;
                }
                wlSave(cur); renderWatchlist();
              }
              setTimeout(nextCheck, WATCHLIST_RECHECK_DELAY_MS); return;
            }
            checkDL(topics[idx].tid, (confirmed) => {
              if (confirmed && !foundDL) {
                foundDL = true;
                entry.status = "dl";
                entry.lastChecked = Date.now();
                entry.ripperTid  = topics[idx].tid;
                entry.ripperSlug = topics[idx].slug || topics[idx].tid;
                wlSave(cur); renderWatchlist();
                setTimeout(nextCheck, WATCHLIST_RECHECK_DELAY_MS);
              } else { checkNext(idx + 1); }
            });
          }
          checkNext(0);
        });
      }
      nextCheck();
    }

    _recheckFn = runWatchlistCheck;

    panel.querySelector("#ah-recheck-btn").addEventListener("click", runWatchlistCheck);

    // ── Search ──
    function wireSearchResults() {
      const lfBtn = panel.querySelector("#ah-lf-open");
      if (lfBtn) lfBtn.addEventListener("click", () => showLFModal());

      const wlBtn = panel.querySelector("#ah-wl-add");
      if (wlBtn) {
        if (wlGet().find(x => x.url === window.location.href)) {
          wlBtn.textContent = `✓ ${t("inWatch")}`; wlBtn.disabled = true;
        }
        wlBtn.addEventListener("click", () => {
          wlAdd({ name, url: window.location.href, id: query, status: "pending" });
          wlBtn.textContent = `✓ ${t("inWatch")}`; wlBtn.disabled = true;
          updateWlCount();
        });
      }
    }

    function search(q) {
      if (!q) return;
      inp.value     = q;
      out.innerHTML = `<div class="ah-loading"><span class="ah-spinner"></span>${t("searching")}</div>`;
      doSearch(q, (err, data) => {
        lastSearchData = err ? null : data;
        out.innerHTML = err
          ? `<div class="ah-error">⚠ ${esc(err)}</div>`
          : renderResults(data, panel);
        wireSearchResults();
      });
    }

    panel.querySelector("#ah-search-btn").addEventListener("click", () => search(inp.value.trim()));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") search(inp.value.trim()); });

    // ── Minimize ──
    const collapsible = panel.querySelector("#ah-collapsible");
    const minBtn      = panel.querySelector("#ah-minimize");
    let collapsed     = false;
    minBtn.addEventListener("click", e => {
      e.stopPropagation();
      collapsed = !collapsed;
      collapsible.classList.toggle("ah-collapsed", collapsed);
      minBtn.querySelector("svg").style.transform = collapsed ? "rotate(45deg)" : "";
      minBtn.title = collapsed ? "Expand" : t("minimize");
    });

    search(query);
    startAutoUpdate();
  }

  // ─── Panel CSS ────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("ah-css")) return;
    const s = document.createElement("style");
    s.id = "ah-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Noto+Sans+JP:wght@400;500;700&display=swap');

#ah-panel {
  --ah-bg0: #0c0c0e;
  --ah-bg1: #111115;
  --ah-bg2: #16161b;
  --ah-bg3: #1c1c23;
  --ah-border: rgba(255,255,255,.07);
  --ah-border-h: rgba(255,255,255,.14);
  --ah-txt: #e8e8f0;
  --ah-txt2: #6b6b80;
  --ah-muted: #3a3a48;
  --ah-accent: #c8a8ff;
  --ah-accent-dim: rgba(200,168,255,.12);
  --ah-dl: #72f0a8;
  --ah-dl-bg: rgba(114,240,168,.06);
  --ah-dl-bd: rgba(114,240,168,.18);
  --ah-disc: #9898ff;
  --ah-disc-bg: rgba(152,152,255,.06);
  --ah-disc-bd: rgba(152,152,255,.18);
  --ah-r: 10px;
  --ah-r-sm: 6px;
  --ah-f: 'Space Mono','Noto Sans JP',monospace;
}

#ah-panel {
  position:fixed;bottom:24px;right:22px;z-index:999999;
  width:352px;
  max-height:600px;
  background:var(--ah-bg0);border:1px solid var(--ah-border);border-radius:var(--ah-r);
  box-shadow:0 0 0 1px rgba(255,255,255,.03),0 4px 6px rgba(0,0,0,.4),
             0 20px 60px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.04);
  font-family:var(--ah-f);color:var(--ah-txt);
  display:flex;flex-direction:column;overflow:hidden;font-size:11px;
}

/* Header */
#ah-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:11px 14px;background:var(--ah-bg1);
  border-bottom:1px solid var(--ah-border);flex-shrink:0;user-select:none;
}
#ah-header-left { display:flex;align-items:center;gap:7px; }
.ah-logo-star   { color:var(--ah-accent);flex-shrink:0;opacity:.85; }
#ah-title       { font-size:9.5px;font-weight:700;letter-spacing:4px;text-transform:uppercase;font-style:italic; }
#ah-header-right { display:flex;align-items:center;gap:8px; }
#ah-booth-badge {
  font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
  color:#ff1428;padding:2px 7px;border-radius:3px;
  background:rgba(255,20,40,.08);border:1px solid rgba(255,20,40,.2);
}
#ah-minimize {
  background:none;border:none;color:var(--ah-muted);cursor:pointer;
  padding:3px;display:flex;align-items:center;border-radius:4px;
  transition:color .15s,background .15s;
}
#ah-minimize:hover { color:var(--ah-txt);background:var(--ah-bg3); }
#ah-minimize svg  { transition:transform .25s ease; }

/* Collapse */
#ah-collapsible {
  display:flex;flex-direction:column;
  overflow:hidden;flex:1;min-height:0;
  max-height:10000px;
  transition:max-height .3s cubic-bezier(.4,0,.2,1),opacity .25s ease;
  opacity:1;
}
#ah-collapsible.ah-collapsed { max-height:0!important;opacity:0;pointer-events:none; }

/* Tabs */
#ah-tabs {
  display:flex;align-items:center;background:var(--ah-bg1);
  border-bottom:1px solid var(--ah-border);flex-shrink:0;padding:0 2px;
}
.ah-tab {
  flex:1;padding:8px 0;background:none;border:none;border-bottom:2px solid transparent;
  color:var(--ah-muted);font-family:var(--ah-f);font-size:8.5px;font-weight:700;
  letter-spacing:2px;text-transform:uppercase;cursor:pointer;
  transition:color .15s,border-color .15s;margin-bottom:-1px;
  display:flex;align-items:center;justify-content:center;gap:4px;
}
.ah-tab:hover      { color:var(--ah-txt2); }
.ah-tab--active    { color:var(--ah-txt)!important;border-bottom-color:var(--ah-accent)!important; }
.ah-tab--icon      { flex:0 0 34px; }
#ah-wl-count       { font-size:8px;opacity:.6; }
#ah-recheck-btn {
  background:none;border:none;color:var(--ah-muted);cursor:pointer;
  padding:6px 10px;display:flex;align-items:center;border-radius:4px;
  transition:color .15s;flex-shrink:0;
}
#ah-recheck-btn:hover { color:var(--ah-txt); }

/* Panes */
#ah-pane-search,#ah-pane-watchlist,#ah-pane-settings {
  padding:12px 13px;overflow-y:auto;flex:1;min-height:0;
}
#ah-pane-search::-webkit-scrollbar,
#ah-pane-watchlist::-webkit-scrollbar,
#ah-pane-settings::-webkit-scrollbar  { width:2px; }
#ah-pane-search::-webkit-scrollbar-thumb,
#ah-pane-watchlist::-webkit-scrollbar-thumb,
#ah-pane-settings::-webkit-scrollbar-thumb { background:var(--ah-bg3);border-radius:2px; }

/* Item info */
#ah-item-info {
  margin-bottom:10px;padding:8px 10px;
  background:var(--ah-bg2);border-radius:var(--ah-r-sm);border:1px solid var(--ah-border);
}
#ah-item-name {
  font-size:11px;font-weight:700;color:var(--ah-txt);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;
}
#ah-item-id { font-size:9px;color:var(--ah-muted);margin-top:2px;letter-spacing:1px; }

/* Search row */
#ah-search-row { display:flex;gap:6px;margin-bottom:12px; }
#ah-input {
  flex:1;padding:7px 10px;
  background:#16161b !important;
  border:1px solid var(--ah-border);border-radius:var(--ah-r-sm);
  color:var(--ah-txt) !important;font-family:var(--ah-f);font-size:10.5px;
  outline:none !important;box-shadow:none !important;-webkit-appearance:none;
  transition:border-color .15s;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
  -webkit-text-fill-color:var(--ah-txt) !important;
  caret-color:var(--ah-accent);
}
#ah-input:focus {
  outline:none !important;box-shadow:none !important;
  border-color:rgba(200,168,255,.35);
  background:#16161b !important;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
}
#ah-input::placeholder { color:var(--ah-muted); }
#ah-search-btn {
  padding:7px 12px;background:var(--ah-accent-dim);
  border:1px solid rgba(200,168,255,.22);border-radius:var(--ah-r-sm);
  color:var(--ah-accent);font-family:var(--ah-f);font-size:9px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;white-space:nowrap;
  transition:background .15s,border-color .15s;
}
#ah-search-btn:hover { background:rgba(200,168,255,.2);border-color:rgba(200,168,255,.4); }

/* Loading/error */
.ah-loading {
  display:flex;align-items:center;gap:8px;padding:20px 0;justify-content:center;
  color:var(--ah-txt2);font-size:9.5px;letter-spacing:2px;text-transform:uppercase;
}
.ah-spinner {
  width:12px;height:12px;border:1.5px solid var(--ah-bg3);
  border-top-color:var(--ah-accent);border-radius:50%;
  animation:ah-spin .7s linear infinite;flex-shrink:0;
}
@keyframes ah-spin { to { transform:rotate(360deg); } }
.ah-error      { color:#ff6680;font-size:10.5px;padding:12px 0;text-align:center; }
.ah-no-results { color:var(--ah-muted);font-size:10px;padding:20px 0 6px;text-align:center;letter-spacing:1.5px;text-transform:uppercase; }
.ah-result-count { font-size:8.5px;color:var(--ah-muted);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px; }

/* Section labels */
.ah-section-label {
  font-size:8px;font-weight:700;letter-spacing:3px;text-transform:uppercase;
  padding:4px 8px;border-radius:4px;margin:10px 0 6px;display:flex;align-items:center;gap:5px;
}
.ah-section--dl    { color:var(--ah-dl);  background:var(--ah-dl-bg);  border:1px solid var(--ah-dl-bd); }
.ah-section--disc  { color:var(--ah-disc);background:var(--ah-disc-bg);border:1px solid var(--ah-disc-bd); }
.ah-section--other { color:var(--ah-muted);background:var(--ah-bg2);border:1px solid var(--ah-border); }

/* Cards */
.ah-list  { display:flex;flex-direction:column;gap:5px; }
.ah-card  {
  display:block;padding:9px 11px;border-radius:var(--ah-r-sm);text-decoration:none;color:inherit;
  border:1px solid var(--ah-border);background:var(--ah-bg2);
  transition:border-color .15s,background .15s;
}
.ah-card:hover        { border-color:var(--ah-border-h);background:var(--ah-bg3); }
.ah-card--dl          { background:var(--ah-dl-bg);border-color:var(--ah-dl-bd); }
.ah-card--dl:hover    { border-color:rgba(114,240,168,.35);background:rgba(114,240,168,.09); }
.ah-card--disc        { background:var(--ah-disc-bg);border-color:var(--ah-disc-bd); }
.ah-card--disc:hover  { border-color:rgba(152,152,255,.35);background:rgba(152,152,255,.09); }
.ah-card-top          { display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap; }
.ah-badge             { font-size:7.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 6px;border-radius:3px;border:1px solid transparent; }
.ah-cat               { font-size:7.5px;font-weight:700;padding:2px 6px;border-radius:3px;border:1px solid transparent;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

/* DL chip */
.ah-dl-chip {
  font-size:7.5px;font-weight:700;letter-spacing:1px;
  color:var(--ah-dl);padding:2px 7px;border-radius:3px;
  background:rgba(114,240,168,.1);border:1px solid rgba(114,240,168,.25);
  margin-left:auto;
  animation:ah-dl-pulse 2.5s ease-in-out infinite;
}
@keyframes ah-dl-pulse { 0%,100%{opacity:1} 50%{opacity:.6} }

.ah-card-title        { font-size:11px;font-weight:700;color:var(--ah-txt);margin-bottom:5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
.ah-card--dl   .ah-card-title { color:var(--ah-dl); }
.ah-card--disc .ah-card-title { color:var(--ah-disc); }
.ah-card-meta         { display:flex;gap:8px;font-size:9px;color:var(--ah-muted);flex-wrap:wrap; }
.ah-card-user         { color:var(--ah-txt2); }
.ah-tags              { display:flex;flex-wrap:wrap;gap:3px;margin-top:6px; }
.ah-tag               { font-size:8px;padding:1px 5px;border-radius:3px;background:var(--ah-bg3);color:var(--ah-muted);border:1px solid var(--ah-border); }
.ah-card--dl   .ah-tag { background:rgba(114,240,168,.06);color:rgba(114,240,168,.5);border-color:rgba(114,240,168,.1); }
.ah-card--disc .ah-tag { background:rgba(152,152,255,.06);color:rgba(152,152,255,.5);border-color:rgba(152,152,255,.1); }

/* Bottom actions */
.ah-bottom-actions { display:flex;gap:6px;margin-top:12px; }
.ah-btn-watch {
  flex:1;padding:8px;background:var(--ah-bg2);border:1px solid var(--ah-border);
  border-radius:var(--ah-r-sm);color:var(--ah-txt2);font-family:var(--ah-f);
  font-size:8.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
  cursor:pointer;transition:all .15s;
}
.ah-btn-watch:hover:not(:disabled) { border-color:var(--ah-border-h);color:var(--ah-txt); }
.ah-btn-watch:disabled { opacity:.4;cursor:default; }
.ah-btn-lf {
  flex:1;padding:8px;background:var(--ah-accent-dim);
  border:1px solid rgba(200,168,255,.2);border-radius:var(--ah-r-sm);
  color:var(--ah-accent);font-family:var(--ah-f);font-size:8.5px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all .15s;
}
.ah-btn-lf:hover { background:rgba(200,168,255,.2);border-color:rgba(200,168,255,.4); }

/* LF prompt */
.ah-lf-prompt  { margin-top:8px;padding:12px;background:var(--ah-bg2);border:1px solid var(--ah-border);border-radius:var(--ah-r-sm);text-align:center; }
.ah-lf-prompt p { font-size:10px;color:var(--ah-txt2);margin:0 0 10px;line-height:1.5; }

/* Watchlist */
.ah-wl-empty { color:var(--ah-muted);font-size:9.5px;letter-spacing:1px;text-align:center;padding:24px 0;text-transform:uppercase; }
.ah-wl-item  { padding:9px 10px;margin-bottom:5px;background:var(--ah-bg2);border:1px solid var(--ah-border);border-radius:var(--ah-r-sm);transition:border-color .15s; }
.ah-wl-item--dl    { background:var(--ah-dl-bg);  border-color:var(--ah-dl-bd); }
.ah-wl-item--found { background:var(--ah-disc-bg);border-color:var(--ah-disc-bd); }
.ah-wl-row1  { display:flex;align-items:center;gap:6px;margin-bottom:4px; }
.ah-wl-badge { font-size:7.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 7px;border-radius:3px; }
.ah-wl-badge--dl      { color:var(--ah-dl);  background:rgba(114,240,168,.1);border:1px solid rgba(114,240,168,.2); }
.ah-wl-badge--disc    { color:var(--ah-disc);background:rgba(152,152,255,.1);border:1px solid rgba(152,152,255,.2); }
.ah-wl-badge--none    { color:var(--ah-muted);background:var(--ah-bg3);border:1px solid var(--ah-border); }
.ah-wl-badge--pending { color:var(--ah-muted);background:var(--ah-bg3);border:1px solid var(--ah-border); }
.ah-wl-remove {
  background:none;border:none;color:var(--ah-muted);font-size:10px;cursor:pointer;
  padding:1px 4px;border-radius:3px;transition:color .12s;line-height:1;
  margin-left:auto;
}
.ah-wl-remove:hover { color:#ff6680; }
.ah-wl-name  { font-size:10.5px;font-weight:700;color:var(--ah-txt);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.ah-wl-item.ah-wl-item--dl    .ah-wl-name { color:var(--ah-dl); }
.ah-wl-item.ah-wl-item--found .ah-wl-name { color:var(--ah-disc); }
.ah-wl-row2  { display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:6px; }
.ah-wl-ts    { font-size:8.5px;color:var(--ah-muted);margin-left:auto; }
.ah-wl-link  { font-size:9px;color:var(--ah-muted);text-decoration:none;transition:color .12s; }
.ah-wl-link:hover { color:var(--ah-txt); }
.ah-wl-link--ripper { color:var(--ah-dl) !important;opacity:.8; }
.ah-wl-link--ripper:hover { opacity:1 !important; }
.ah-wl-item--found .ah-wl-link--ripper { color:var(--ah-disc) !important; }

/* ══ Settings pane ══ */
.ah-set-section {
  font-size:8px;font-weight:700;letter-spacing:3px;text-transform:uppercase;
  color:var(--ah-muted);margin-bottom:12px;padding-bottom:6px;
  border-bottom:1px solid var(--ah-border);
}
.ah-set-section--danger {
  color:rgba(255,102,128,.5);border-color:rgba(255,102,128,.15);margin-top:8px;
}
.ah-set-field       { margin-bottom:14px; }
.ah-set-field-hd    { display:flex;align-items:center;justify-content:space-between;margin-bottom:3px; }
.ah-set-label       { font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ah-txt2); }
.ah-set-hint        { font-size:8.5px;color:var(--ah-muted);margin-bottom:5px;line-height:1.5; }
.ah-set-hint code   { font-family:var(--ah-f);font-size:8.5px;color:var(--ah-accent);background:var(--ah-accent-dim);padding:1px 4px;border-radius:3px; }
.ah-set-input {
  display:block;width:100%;box-sizing:border-box;
  padding:8px 10px;background:#16161b !important;
  border:1px solid rgba(255,255,255,.07);border-radius:var(--ah-r-sm);
  color:var(--ah-txt) !important;font-family:var(--ah-f);font-size:10.5px;line-height:1.6;
  outline:none !important;box-shadow:none !important;-webkit-appearance:none;appearance:none;
  transition:border-color .15s;resize:vertical;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
  -webkit-text-fill-color:var(--ah-txt) !important;caret-color:var(--ah-accent);
}
textarea.ah-set-input.ah-set-input--single {
  min-height:unset;height:36px;resize:none;overflow:hidden;white-space:nowrap;
}
textarea.ah-set-input:not(.ah-set-input--single) { min-height:100px;resize:vertical; }
.ah-set-input:focus {
  outline:none !important;box-shadow:none !important;
  border-color:rgba(200,168,255,.4);background:#16161b !important;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
}
.ah-set-input:-webkit-autofill,.ah-set-input:-webkit-autofill:focus {
  outline:none !important;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
  -webkit-text-fill-color:var(--ah-txt) !important;
}
.ah-set-reset {
  background:none;border:1px solid var(--ah-border);border-radius:4px;
  color:var(--ah-muted);font-family:var(--ah-f);font-size:8px;letter-spacing:.5px;
  padding:2px 7px;cursor:pointer;transition:all .14s;white-space:nowrap;
}
.ah-set-reset:hover { color:var(--ah-txt);border-color:var(--ah-border-h); }
.ah-set-wm-box  { margin-top:6px;padding:7px 10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:var(--ah-r-sm); }
.ah-set-wm-label { display:block;font-size:7.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ah-muted);margin-bottom:4px; }
.ah-set-wm-pre  { margin:0;font-family:var(--ah-f);font-size:9.5px;color:rgba(255,255,255,.18);white-space:pre-wrap;line-height:1.6; }
.ah-set-toggle-row {
  display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
  padding:10px 12px;margin-bottom:10px;
  background:var(--ah-bg2);border:1px solid var(--ah-border);border-radius:var(--ah-r-sm);
}
.ah-set-toggle-info  { display:flex;flex-direction:column;gap:3px; }
.ah-set-toggle-label { font-size:10px;font-weight:700;color:var(--ah-txt); }
.ah-set-toggle-hint  { font-size:8.5px;color:var(--ah-muted);line-height:1.5;max-width:220px; }
.ah-set-toggle {
  flex-shrink:0;width:34px;height:18px;border-radius:9px;
  background:var(--ah-bg3);border:1px solid var(--ah-border);
  cursor:pointer;position:relative;transition:background .2s,border-color .2s;padding:0;
}
.ah-set-toggle--on   { background:rgba(200,168,255,.28);border-color:rgba(200,168,255,.45); }
.ah-set-toggle-knob  {
  position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;
  background:var(--ah-muted);transition:transform .2s,background .2s;pointer-events:none;
}
.ah-set-toggle--on .ah-set-toggle-knob { transform:translateX(16px);background:var(--ah-accent); }
.ah-set-slider-wrap { margin-top:6px; }
.ah-set-slider {
  -webkit-appearance:none;appearance:none;
  width:100%;height:3px;border-radius:2px;
  background:var(--ah-bg3);outline:none;cursor:pointer;border:none;
}
.ah-set-slider::-webkit-slider-thumb {
  -webkit-appearance:none;appearance:none;
  width:14px;height:14px;border-radius:50%;
  background:var(--ah-accent);border:2px solid var(--ah-bg0);cursor:pointer;transition:transform .15s;
}
.ah-set-slider::-webkit-slider-thumb:hover { transform:scale(1.2); }
.ah-set-slider::-moz-range-thumb {
  width:14px;height:14px;border-radius:50%;
  background:var(--ah-accent);border:2px solid var(--ah-bg0);cursor:pointer;
}
.ah-set-slider-labels {
  display:flex;justify-content:space-between;
  margin-top:5px;font-size:8px;color:var(--ah-muted);letter-spacing:.5px;
}
.ah-set-slider-val { text-align:center;font-size:9px;color:var(--ah-txt2);margin-top:4px;letter-spacing:.5px; }
.ah-set-slider-val span { color:var(--ah-accent);font-weight:700; }
.ah-set-actions   { display:flex;align-items:center;gap:10px;margin-top:4px;margin-bottom:14px; }
#ah-set-save {
  padding:8px 18px;background:var(--ah-accent-dim);
  border:1px solid rgba(200,168,255,.22);border-radius:var(--ah-r-sm);
  color:var(--ah-accent);font-family:var(--ah-f);font-size:9px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all .15s;
}
#ah-set-save:hover  { background:rgba(200,168,255,.2);border-color:rgba(200,168,255,.4); }
.ah-set-saved-msg   { font-size:9px;color:var(--ah-dl);opacity:0;transition:opacity .2s;letter-spacing:1px; }
.ah-set-saved--vis  { opacity:1; }
.ah-set-data-actions { display:flex;gap:6px;flex-wrap:wrap; }
.ah-set-data-btn {
  flex:1;min-width:80px;padding:8px 6px;border-radius:var(--ah-r-sm);
  font-family:var(--ah-f);font-size:8px;font-weight:700;letter-spacing:1px;
  text-transform:uppercase;cursor:pointer;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:5px;
}
.ah-set-data-btn--export { background:rgba(96,200,255,.08);border:1px solid rgba(96,200,255,.2);color:#60c8ff; }
.ah-set-data-btn--export:hover { background:rgba(96,200,255,.15);border-color:rgba(96,200,255,.4); }
.ah-set-data-btn--import { background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.35); }
.ah-set-data-btn--import:hover { background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.6); }
.ah-set-data-btn--reset  { background:rgba(255,179,71,.08);border:1px solid rgba(255,179,71,.2);color:#ffb347; }
.ah-set-data-btn--reset:hover { background:rgba(255,179,71,.15);border-color:rgba(255,179,71,.4); }
.ah-set-data-btn--delete { background:rgba(255,86,128,.08);border:1px solid rgba(255,86,128,.2);color:#ff5680; }
.ah-set-data-btn--delete:hover { background:rgba(255,86,128,.15);border-color:rgba(255,86,128,.4); }

/* ── Ko-fi card ── */
#ah-kofi-card {
  position:fixed;z-index:9999998;
  font-family:'Space Mono','Noto Sans JP',monospace;
  box-sizing:border-box;
}
#ah-kofi-inner {
  display:flex;align-items:center;gap:9px;
  padding:9px 12px;
  background:#0c0c0e;
  border:1px solid rgba(255,255,255,.08);
  border-left:3px solid #ff5e5b;
  border-radius:10px;
  box-shadow:0 0 0 1px rgba(255,255,255,.02),0 4px 6px rgba(0,0,0,.4),0 20px 60px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.04);
  font-size:10px;color:#9898a8;
}
#ah-kofi-heart {
  color:#ff5e5b;
  font-size:12px;
  line-height:1;
  animation:ah-kofi-pulse 1.35s ease-in-out infinite;
}
#ah-kofi-text { display:flex;flex-direction:column;gap:2px;min-width:0; }
#ah-kofi-msg { color:#9898a8;font-size:9px;line-height:1.3; }
#ah-kofi-inner a { color:#ff5e5b;text-decoration:none;font-weight:700;font-size:10px;line-height:1.2; }
#ah-kofi-inner a:hover { text-decoration:underline; }
#ah-kofi-close {
  background:none;border:none;color:#3a3a48;cursor:pointer;
  font-size:10px;padding:2px 4px;line-height:1;margin-left:auto;
  font-family:'Space Mono',monospace;transition:color .15s;
}
#ah-kofi-close:hover { color:#9898a8; }
@keyframes ah-kofi-pulse {
  0%,100% { transform:scale(1); opacity:.9; }
  50% { transform:scale(1.16); opacity:1; }
}
#ah-kofi-confirm-modal {
  position:fixed;inset:0;z-index:99999999;
  display:flex;align-items:center;justify-content:center;pointer-events:all;
  font-family:'Space Mono','Noto Sans JP',monospace;
}
.ah-kofi-confirm-backdrop {
  position:absolute;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(5px);
}
.ah-kofi-confirm-dialog {
  position:relative;z-index:1;
  width:430px;max-width:92vw;
  background:#0c0c0e;
  border:1px solid rgba(255,255,255,.08);
  border-left:3px solid #ff5e5b;
  border-radius:10px;
  box-shadow:0 0 0 1px rgba(255,255,255,.02),0 8px 16px rgba(0,0,0,.5),0 32px 80px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.04);
  padding:16px;
  animation:ah-kofi-confirm-in .18s cubic-bezier(.34,1.4,.64,1) both;
}
@keyframes ah-kofi-confirm-in {
  from { opacity:0; transform:scale(.9) translateY(8px); }
  to   { opacity:1; transform:scale(1) translateY(0); }
}
.ah-kofi-confirm-title {
  display:flex;align-items:center;gap:8px;
  color:#ffb7b6;font-size:10px;font-weight:700;letter-spacing:1px;
  text-transform:uppercase;margin-bottom:10px;
}
.ah-kofi-confirm-heart {
  color:#ff5e5b;font-size:12px;line-height:1;
  animation:ah-kofi-pulse 1.35s ease-in-out infinite;
}
.ah-kofi-confirm-body {
  color:#9898a8;font-size:10px;line-height:1.6;
  background:#111115;border:1px solid rgba(255,255,255,.06);
  border-radius:8px;padding:10px 11px;margin-bottom:10px;
}
.ah-kofi-confirm-link {
  display:inline-block;color:#ff5e5b;text-decoration:none;
  font-weight:700;font-size:10px;margin-bottom:12px;
}
.ah-kofi-confirm-link:hover { text-decoration:underline; }
.ah-kofi-confirm-optout {
  display:flex;align-items:center;gap:7px;
  color:#9898a8;font-size:9px;line-height:1.2;margin-bottom:11px;
  user-select:none;
}
.ah-kofi-confirm-optout input {
  accent-color:#ff5e5b;
  width:12px;height:12px;cursor:pointer;
}
.ah-kofi-confirm-actions { display:flex;gap:8px; }
#ah-kofi-keep-btn,#ah-kofi-close-btn {
  flex:1;padding:9px 10px;border-radius:6px;cursor:pointer;
  font-family:'Space Mono','Noto Sans JP',monospace;
  font-size:8.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;
  transition:all .15s;
}
#ah-kofi-keep-btn {
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#9898a8;
}
#ah-kofi-keep-btn:hover { background:rgba(255,255,255,.08);color:#d0d0e4; }
#ah-kofi-close-btn {
  background:rgba(255,94,91,.12);border:1px solid rgba(255,94,91,.35);color:#ff8f8d;
}
#ah-kofi-close-btn:hover { background:rgba(255,94,91,.2);border-color:rgba(255,94,91,.55); }
`;
    document.head.appendChild(s);
  }

  // ─── Modal CSS ────────────────────────────────────────────────────────────
  function injectModalCSS() {
    if (document.getElementById("ah-lf-css")) return;
    const s = document.createElement("style");
    s.id = "ah-lf-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans+JP:wght@400;700&display=swap');

#ah-lf-modal {
  position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999999;
  display:flex;align-items:center;justify-content:center;
}
.ah-lf-backdrop  { position:absolute;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px); }
.ah-lf-dialog {
  position:relative;z-index:1;width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;
  background:#0c0c0e;border:1px solid rgba(255,255,255,.08);border-radius:12px;
  box-shadow:0 0 0 1px rgba(255,255,255,.02),0 8px 16px rgba(0,0,0,.5),0 32px 80px rgba(0,0,0,.9);
  font-family:'Space Mono','Noto Sans JP',monospace;color:#c0c0d0;font-size:11px;
}
.ah-lf-dialog::-webkit-scrollbar       { width:2px; }
.ah-lf-dialog::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08); }
.ah-lf-dialog-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:13px 16px;background:#111115;border-bottom:1px solid rgba(255,255,255,.07);
  position:sticky;top:0;z-index:2;
}
.ah-lf-dialog-title {
  display:flex;align-items:center;gap:7px;font-size:9.5px;font-weight:700;
  letter-spacing:3.5px;text-transform:uppercase;color:#c8a8ff;
}
.ah-lf-close {
  background:none;border:none;color:rgba(255,255,255,.25);font-size:15px;cursor:pointer;
  padding:2px 6px;border-radius:4px;transition:color .15s;line-height:1;
}
.ah-lf-close:hover { color:rgba(255,255,255,.75); }
.ah-lf-dialog-body { padding:16px 18px; }
.ah-lf-field       { margin-bottom:11px; }
.ah-lf-row-2       { display:flex;gap:12px;margin-bottom:11px; }
.ah-lf-row-2 .ah-lf-field { flex:1;margin-bottom:0; }
.ah-lf-label {
  display:block;font-size:8px;font-weight:700;letter-spacing:2px;
  text-transform:uppercase;color:rgba(255,255,255,.25);margin-bottom:5px;
}
.ah-lf-hint { font-size:7.5px;text-transform:none;letter-spacing:.5px;opacity:.6; }
.ah-lf-dialog-body input,
.ah-lf-dialog-body textarea,
.ah-lf-dialog-body select {
  width:100%;box-sizing:border-box;padding:8px 10px;
  background:#16161b !important;border:1px solid rgba(255,255,255,.07);border-radius:6px;
  color:#d0d0e4 !important;font-family:'Space Mono',monospace;font-size:10.5px;
  outline:none !important;box-shadow:none !important;-webkit-appearance:none;
  transition:border-color .15s;resize:vertical;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
  -webkit-text-fill-color:#d0d0e4 !important;caret-color:#c8a8ff;
}
.ah-lf-dialog-body select       { cursor:pointer;resize:none; }
.ah-lf-dialog-body select option { background:#111115;color:#d0d0e4; }
.ah-lf-dialog-body input:focus,
.ah-lf-dialog-body textarea:focus,
.ah-lf-dialog-body select:focus {
  outline:none !important;box-shadow:none !important;
  border-color:rgba(200,168,255,.35);background:#16161b !important;
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
}
.ah-lf-dialog-body input:-webkit-autofill,
.ah-lf-dialog-body input:-webkit-autofill:focus {
  -webkit-box-shadow:0 0 0 1000px #16161b inset !important;
  -webkit-text-fill-color:#d0d0e4 !important;
}
.ah-lf-dialog-body input::placeholder,
.ah-lf-dialog-body textarea::placeholder { color:rgba(255,255,255,.12); }
.ah-lf-notice {
  display:flex;align-items:flex-start;gap:7px;padding:9px 11px;
  background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);
  border-radius:6px;margin:12px 0;font-size:9.5px;color:rgba(255,255,255,.3);line-height:1.5;
}
.ah-lf-notice svg { flex-shrink:0;margin-top:1px;color:rgba(255,255,255,.2); }
.ah-lf-notice a   { color:#c8a8ff;text-decoration:none; }
.ah-lf-notice a:hover { text-decoration:underline; }
.ah-lf-actions    { display:flex;gap:8px; }
#ah-lf-preview {
  padding:9px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
  border-radius:6px;color:rgba(255,255,255,.4);font-family:'Space Mono',monospace;
  font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
  cursor:pointer;transition:all .15s;white-space:nowrap;
}
#ah-lf-preview:hover { background:rgba(255,255,255,.07);color:rgba(255,255,255,.7); }
#ah-lf-submit {
  flex:1;padding:10px 16px;background:rgba(200,168,255,.1);
  border:1px solid rgba(200,168,255,.25);border-radius:6px;color:#c8a8ff;
  font-family:'Space Mono',monospace;font-size:9px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all .15s;
}
#ah-lf-submit:hover:not(:disabled) { background:rgba(200,168,255,.18);border-color:rgba(200,168,255,.5); }
#ah-lf-submit:disabled { opacity:.4;cursor:not-allowed; }
#ah-lf-status       { min-height:20px;margin-top:10px;font-size:10px;letter-spacing:.3px; }
#ah-lf-status a     { text-decoration:none; }
#ah-lf-status a:hover { text-decoration:underline; }
.ah-lf-st-load { color:rgba(255,255,255,.3); }
.ah-lf-st-err  { color:#ff7090; }
.ah-lf-st-ok   { color:#72f0a8; }
.ah-lf-st-ok a { color:#72f0a8; }
`;
    document.head.appendChild(s);
  }

  // ─── Warn popup CSS ───────────────────────────────────────────────────────
  function injectWarnCSS() {
    if (document.getElementById("ah-warn-css")) return;
    const s = document.createElement("style");
    s.id = "ah-warn-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
#ah-warn-modal {
  position:fixed;inset:0;z-index:99999999;
  display:flex;align-items:center;justify-content:center;pointer-events:all;
}
.ah-warn-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);cursor:default; }
.ah-warn-dialog {
  position:relative;z-index:1;width:fit-content;
  min-width:280px;max-width:min(440px,92vw);
  background:#0f0a0a;border:1px solid rgba(255,102,128,.25);border-radius:10px;
  box-shadow:0 0 0 1px rgba(255,102,128,.08),0 8px 24px rgba(0,0,0,.6),0 24px 64px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,102,128,.08);
  font-family:'Space Mono',monospace;padding:22px 22px 18px;
  animation:ah-warn-in .18s cubic-bezier(.34,1.4,.64,1) both;
}
@keyframes ah-warn-in { from{opacity:0;transform:scale(.88) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
.ah-warn-icon-row { display:flex;align-items:center;gap:10px;margin-bottom:14px; }
.ah-warn-title { font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#ff8898; }
.ah-warn-body { display:flex;flex-direction:column;gap:9px;margin-bottom:18px; }
.ah-warn-item {
  font-size:10.5px;color:rgba(255,255,255,.55);line-height:1.6;
  padding:9px 11px;background:rgba(255,102,128,.05);border:1px solid rgba(255,102,128,.12);border-radius:6px;
}
.ah-warn-item strong { color:#ff8898;font-weight:700; }
.ah-warn-item code { font-family:'Space Mono',monospace;font-size:9.5px;color:#c8a8ff;background:rgba(200,168,255,.12);padding:1px 5px;border-radius:3px; }
.ah-warn-btn {
  display:block;width:100%;padding:10px 0;background:rgba(255,102,128,.1);
  border:1px solid rgba(255,102,128,.3);border-radius:6px;color:#ff8898;
  font-family:'Space Mono',monospace;font-size:9px;font-weight:700;
  letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:background .15s,border-color .15s;
}
.ah-warn-btn:hover { background:rgba(255,102,128,.18);border-color:rgba(255,102,128,.55); }
`;
    document.head.appendChild(s);
  }

  // ─── Import popup CSS ─────────────────────────────────────────────────────
  function injectImportCSS() {
    if (document.getElementById("ah-import-css")) return;
    const s = document.createElement("style");
    s.id = "ah-import-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
#ah-import-modal {
  position:fixed;inset:0;z-index:99999999;
  display:flex;align-items:center;justify-content:center;pointer-events:all;
}
.ah-import-backdrop {
  position:absolute;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);cursor:default;
}
.ah-import-dialog {
  position:relative;z-index:1;width:360px;max-width:92vw;
  background:#0c0c0e;border:1px solid rgba(255,255,255,.08);border-radius:12px;
  box-shadow:0 0 0 1px rgba(255,255,255,.02),0 8px 16px rgba(0,0,0,.5),0 32px 80px rgba(0,0,0,.9);
  font-family:'Space Mono',monospace;color:#c0c0d0;font-size:11px;
  animation:ah-import-in .18s cubic-bezier(.34,1.4,.64,1) both;
}
@keyframes ah-import-in { from{opacity:0;transform:scale(.9) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
.ah-import-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:13px 16px;background:#111115;border-bottom:1px solid rgba(255,255,255,.07);
  border-radius:12px 12px 0 0;
}
.ah-import-title {
  display:flex;align-items:center;gap:7px;font-size:9.5px;font-weight:700;
  letter-spacing:3.5px;text-transform:uppercase;color:#c8a8ff;
}
.ah-import-close {
  background:none;border:none;color:rgba(255,255,255,.25);font-size:15px;cursor:pointer;
  padding:2px 6px;border-radius:4px;transition:color .15s;line-height:1;
}
.ah-import-close:hover { color:rgba(255,255,255,.75); }
.ah-import-body { padding:18px; }
.ah-import-drop {
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  padding:32px 20px;border:1.5px dashed rgba(255,255,255,.1);border-radius:8px;
  background:rgba(255,255,255,.02);cursor:pointer;
  transition:border-color .15s,background .15s;
  color:rgba(255,255,255,.25);
}
.ah-import-drop:hover,.ah-import-drop--over {
  border-color:rgba(200,168,255,.4);
  background:rgba(200,168,255,.04);
  color:rgba(200,168,255,.6);
}
.ah-import-drop svg { opacity:.5;transition:opacity .15s; }
.ah-import-drop:hover svg,.ah-import-drop--over svg { opacity:1; }
.ah-import-drop-label { font-size:10.5px;font-weight:700;letter-spacing:1px; }
.ah-import-drop-sub   { font-size:8.5px;letter-spacing:.5px;opacity:.5; }
.ah-import-st { display:block;margin-top:12px;font-size:9.5px;text-align:center;letter-spacing:.5px;min-height:16px; }
.ah-import-st--err { color:#ff7090; }
.ah-import-st--ok  { color:#72f0a8; }
`;
    document.head.appendChild(s);
  }

  // ─── Confirm popup CSS ────────────────────────────────────────────────────
  function injectConfirmCSS() {
    if (document.getElementById("ah-confirm-css")) return;
    const s = document.createElement("style");
    s.id = "ah-confirm-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
#ah-confirm-modal {
  position:fixed;inset:0;z-index:99999999;
  display:flex;align-items:center;justify-content:center;pointer-events:all;
}
.ah-confirm-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);cursor:default; }
.ah-confirm-dialog {
  position:relative;z-index:1;
  min-width:280px;max-width:min(400px,92vw);
  background:#0f0a0a;border:1px solid rgba(255,102,128,.25);border-radius:10px;
  box-shadow:0 0 0 1px rgba(255,102,128,.08),0 8px 24px rgba(0,0,0,.6),0 24px 64px rgba(0,0,0,.9);
  font-family:'Space Mono',monospace;padding:22px 22px 18px;
  animation:ah-confirm-in .18s cubic-bezier(.34,1.4,.64,1) both;
}
@keyframes ah-confirm-in { from{opacity:0;transform:scale(.88) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
.ah-confirm-icon-row { display:flex;align-items:center;gap:10px;margin-bottom:14px; }
.ah-confirm-title { font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#ff8898; }
.ah-confirm-body {
  font-size:10.5px;color:rgba(255,255,255,.5);line-height:1.6;
  padding:10px 12px;background:rgba(255,102,128,.04);border:1px solid rgba(255,102,128,.1);
  border-radius:6px;margin-bottom:18px;
}
.ah-confirm-actions { display:flex;gap:8px; }
.ah-confirm-cancel {
  flex:1;padding:9px 0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
  border-radius:6px;color:rgba(255,255,255,.4);font-family:'Space Mono',monospace;
  font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
  cursor:pointer;transition:all .15s;
}
.ah-confirm-cancel:hover { background:rgba(255,255,255,.08);color:rgba(255,255,255,.7); }
.ah-confirm-proceed {
  flex:1;padding:9px 0;background:rgba(255,102,128,.12);border:1px solid rgba(255,102,128,.3);
  border-radius:6px;color:#ff8898;font-family:'Space Mono',monospace;
  font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
  cursor:pointer;transition:all .15s;
}
.ah-confirm-proceed:hover { background:rgba(255,102,128,.22);border-color:rgba(255,102,128,.6); }
`;
    document.head.appendChild(s);
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    const adapter = getAdapter();
    if (!adapter) return;
    if (!adapter.isItemPage()) return;
    injectUI();
  }

  setTimeout(boot, 1200);

  let _lastHref = location.href;
  const _observer = new MutationObserver(() => {
    if (location.href !== _lastHref) {
      _lastHref = location.href;
      document.getElementById("ah-panel")?.remove();
      document.getElementById("ah-kofi-card")?.remove();
      stopAutoUpdate();
      _recheckFn = null;
      setTimeout(boot, 1500);
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });

})();