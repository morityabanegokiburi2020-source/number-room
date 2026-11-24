import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.APP_CONFIG ?? {};
const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const supabase = configured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const homeScreen = document.querySelector("#home-screen");
const roomScreen = document.querySelector("#room-screen");
const homeNotice = document.querySelector("#home-notice");
const roomNotice = document.querySelector("#room-notice");
const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const createButton = createForm.querySelector("button");
const joinButton = joinForm.querySelector("button");
const captchaPanel = document.querySelector("#captcha-panel");
const captchaWidget = document.querySelector("#captcha-widget");
const roomHeading = document.querySelector("#room-heading");
const roomStatus = document.querySelector("#room-status");
const playersList = document.querySelector("#players-list");
const playerCount = document.querySelector("#player-count");
const startButton = document.querySelector("#start-button");
const roundForm = document.querySelector("#round-form");
const difficulty = document.querySelector("#difficulty");
const themeMode = document.querySelector("#theme-mode");
const customThemeField = document.querySelector("#custom-theme-field");
const customTheme = document.querySelector("#custom-theme");
const themePanel = document.querySelector("#theme-panel");
const themeText = document.querySelector("#theme-text");
const themeLevel = document.querySelector("#theme-level");
const roundLabel = document.querySelector("#round-label");
const hostHint = document.querySelector("#host-hint");
const guestHint = document.querySelector("#guest-hint");
const numberPanel = document.querySelector("#number-panel");
const numberValue = document.querySelector("#number-title");
const copyButton = document.querySelector("#copy-button");
const leaveButton = document.querySelector("#leave-button");
const refreshButton = document.querySelector("#refresh-button");

let currentRoomId = null;
let currentRoomCode = null;
let currentIsHost = null;
let activeChannel = null;
let refreshTimer = null;
let roomRefreshError = null;
let currentRound = 0;
let previousTheme = null;
let refreshSequence = 0;
let captchaWidgetId = null;
let signingIn = false;

const themes = {
  1: [
    "朝に飲むものの温かさ",
    "公園で見かけるものの大きさ",
    "文房具を持ち運ぶときの重さ",
    "家の中で聞こえる音の大きさ",
    "雨の日に使うものの大きさ",
    "手で触ったときのやわらかさ",
    "おやつを食べるのにかかる時間",
    "乗り物で移動できる距離"
  ],
  2: [
    "旅先で偶然見つけたら立ち寄りたくなる場所",
    "お弁当を開けたときの意外さ",
    "部屋の模様替えで気分が変わりそうなこと",
    "道具に名前をつけたときの頼もしさ",
    "窓の外に見えたら写真を撮りたくなる景色",
    "短い休憩で気分転換になりそうなこと",
    "旅の荷物に入れたくなる小さなもの",
    "もし店を開くなら看板にしたいものの目立ちやすさ"
  ],
  3: [
    "待ち時間を楽しくする工夫の魅力",
    "初対面の会話で安心できる話題",
    "一日だけ交換してみたい役割の魅力",
    "ささやかな親切に気づいたときのうれしさ",
    "長い旅で隣にいてほしい相棒の頼もしさ",
    "予定が変わった日に楽しめそうな過ごし方",
    "暮らしに新しく加えたい習慣の続けやすさ",
    "街にあったらみんなが集まりそうな場所"
  ],
  4: [
    "雲がつける日記の一文の明るさ",
    "時間を売る店に並んでいそうな商品の魅力",
    "眠れない星に贈る言葉の心強さ",
    "未来の図書館で借りられそうな不思議な体験",
    "風に名前をつけるなら、その名前の勇ましさ",
    "忘れ物たちが開く会議の議題の重要さ",
    "影が休日に出かけたい場所の楽しさ",
    "夢の中の駅にありそうな案内表示の不思議さ"
  ]
};

function chooseTheme(level) {
  const choices = themes[level].filter((theme) => theme !== previousTheme);
  return choices[Math.floor(Math.random() * choices.length)];
}

function activeNotice() {
  return roomScreen.hidden ? homeNotice : roomNotice;
}

function notify(message) {
  const notice = activeNotice();
  notice.textContent = message;
  notice.hidden = false;
}

function errorMessage(error) {
  if (typeof error === "object" && error !== null && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function clearNotices() {
  homeNotice.hidden = true;
  roomNotice.hidden = true;
  homeNotice.textContent = "";
  roomNotice.textContent = "";
}

function showScreen(screen) {
  const showRoom = screen === "room";
  homeScreen.hidden = showRoom;
  roomScreen.hidden = !showRoom;
  homeScreen.classList.toggle("is-active", !showRoom);
  roomScreen.classList.toggle("is-active", showRoom);
  clearNotices();
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabaseの設定がありません。config.jsにURLと公開キーを設定してください。");
  }
}

async function ensureSignedIn() {
  requireSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    throw new Error("ボット対策の確認を完了してから、もう一度お試しください。");
  }
}

function setHomeEnabled(enabled) {
  createButton.disabled = !enabled;
  joinButton.disabled = !enabled;
}

async function restoreRoom() {
  const savedRoomId = sessionStorage.getItem("ito-room-id");
  if (!savedRoomId) return;
  try {
    await enterRoom(savedRoomId);
  } catch (error) {
    notify(`部屋の情報を取得できません: ${errorMessage(error)}。通信を確認し、更新してください。`);
  }
}

async function completeCaptcha(token) {
  if (signingIn) return;
  signingIn = true;
  setHomeEnabled(false);
  try {
    const { error } = await supabase.auth.signInAnonymously({
      options: { captchaToken: token }
    });
    if (error) throw error;
    captchaPanel.hidden = true;
    clearNotices();
    setHomeEnabled(true);
    await restoreRoom();
  } catch (error) {
    notify(`認証に失敗しました: ${errorMessage(error)}。もう一度お試しください。`);
    window.turnstile.reset(captchaWidgetId);
  } finally {
    signingIn = false;
  }
}

function showCaptcha() {
  if (!config.turnstileSiteKey) {
    throw new Error("ボット対策が未設定です。管理者はconfig.jsのturnstileSiteKeyを設定してください。");
  }
  captchaPanel.hidden = false;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => {
    try {
      captchaWidgetId = window.turnstile.render(captchaWidget, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => completeCaptcha(token),
        "expired-callback": () => notify("認証の有効期限が切れました。もう一度確認してください。"),
        "error-callback": () => notify("ボット対策の確認に失敗しました。ページを再読み込みしてください。")
      });
    } catch (error) {
      notify(`ボット対策を表示できません: ${errorMessage(error)}`);
    }
  };
  script.onerror = () => notify("ボット対策を読み込めません。通信環境を確認してページを再読み込みしてください。");
  document.head.append(script);
}

async function withBusyButton(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    notify(errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function createRoom(displayName) {
  await ensureSignedIn();
  const { data, error } = await supabase.rpc("create_room", {
    p_display_name: displayName
  });
  if (error) throw error;
  await enterRoom(data.id);
}

async function joinRoom(displayName, code) {
  await ensureSignedIn();
  const { data, error } = await supabase.rpc("join_room", {
    p_code: code.trim().toUpperCase(),
    p_display_name: displayName
  });
  if (error) throw error;
  await enterRoom(data);
}

async function enterRoom(roomId) {
  currentRoomId = roomId;
  currentRoomCode = null;
  currentIsHost = null;
  currentRound = 0;
  previousTheme = null;
  roomRefreshError = null;
  roomHeading.textContent = "------";
  roomStatus.textContent = "接続中";
  playerCount.textContent = "0人";
  playersList.replaceChildren();
  roundForm.hidden = true;
  hostHint.hidden = true;
  guestHint.hidden = true;
  numberPanel.hidden = true;
  themePanel.hidden = true;
  copyButton.disabled = true;
  sessionStorage.setItem("ito-room-id", roomId);
  showScreen("room");
  subscribeToRoom(roomId);
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(checkRoom, 30000);
  try {
    await refreshRoom();
  } catch (error) {
    if (currentRoomId === roomId) reportRoomRefreshError(error);
  }
}

function finishRoom(message) {
  currentRoomId = null;
  currentRoomCode = null;
  currentIsHost = null;
  currentRound = 0;
  previousTheme = null;
  roomRefreshError = null;
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (activeChannel) {
    supabase.removeChannel(activeChannel).catch((error) => {
      console.error("リアルタイム接続の終了に失敗しました:", error);
    });
    activeChannel = null;
  }
  sessionStorage.removeItem("ito-room-id");
  showScreen("home");
  if (message) notify(message);
}

function checkRoom() {
  const roomId = currentRoomId;
  refreshRoom().catch((error) => {
    if (roomId && currentRoomId === roomId) reportRoomRefreshError(error);
  });
}

function reportRoomRefreshError(error) {
  roomRefreshError = `部屋の情報を取得できません: ${errorMessage(error)}。通信を確認し、更新してください。`;
  notify(roomRefreshError);
}

async function refreshRoom() {
  if (!currentRoomId) return;
  const roomId = currentRoomId;
  const sequence = ++refreshSequence;
  const { data, error } = await supabase.rpc("get_room_state", {
    p_room_id: roomId
  });
  if (roomId !== currentRoomId || sequence !== refreshSequence) return;
  if (error) {
    if (error.message === "この部屋に参加していません") {
      finishRoom("部屋が終了したか、参加登録が解除されました。");
      return;
    }
    throw error;
  }
  if (roomRefreshError && roomNotice.textContent === roomRefreshError) {
    roomNotice.textContent = "";
    roomNotice.hidden = true;
  }
  roomRefreshError = null;
  currentRoomCode = data.code;
  currentIsHost = data.is_host;
  copyButton.disabled = false;
  currentRound = data.round_number ?? 0;
  previousTheme = data.theme ?? null;
  roomHeading.textContent = data.code;
  roomStatus.textContent = data.status === "started" ? "配布完了" : "参加者を待っています";
  playerCount.textContent = `${data.players.length}人`;
  playersList.replaceChildren(...data.players.map((player) => {
    const item = document.createElement("li");
    item.className = "player-row";

    const dot = document.createElement("span");
    dot.className = "player-dot";
    dot.setAttribute("aria-hidden", "true");
    item.append(dot, document.createTextNode(player.name));

    if (player.is_me) {
      const you = document.createElement("span");
      you.className = "player-you";
      you.textContent = "あなた";
      item.append(you);
    }

    return item;
  }));

  const waiting = data.status === "waiting";
  roundForm.hidden = !data.is_host;
  startButton.textContent = waiting ? "お題と数字を配る" : "次のお題と数字を配る";
  hostHint.hidden = !waiting || !data.is_host;
  guestHint.hidden = !waiting || data.is_host;
  numberPanel.hidden = waiting;
  themePanel.hidden = waiting || !data.theme;
  if (!waiting) {
    numberValue.textContent = Number.isInteger(data.my_number) ? String(data.my_number) : "--";
    roundLabel.textContent = currentRound > 0 ? `第${currentRound}回のお題` : "今回のお題";
    themeText.textContent = data.theme ?? "";
    themeLevel.textContent = data.difficulty ? `レベル${data.difficulty}` : "";
  }
}

function subscribeToRoom(roomId) {
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
  }

  activeChannel = supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "rooms",
      filter: `id=eq.${roomId}`
    }, checkRoom)
    .subscribe((status) => {
      if (currentRoomId !== roomId) return;
      if (status === "SUBSCRIBED") {
        checkRoom();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        notify("リアルタイム接続に失敗しました。ページを再読み込みしてください。");
      }
    });
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const displayName = new FormData(createForm).get("name").trim();
  withBusyButton(createButton, () => createRoom(displayName));
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(joinForm);
  const displayName = formData.get("name").trim();
  const code = formData.get("code");
  withBusyButton(joinButton, () => joinRoom(displayName, code));
});

themeMode.addEventListener("change", () => {
  const custom = themeMode.value === "custom";
  customThemeField.hidden = !custom;
  customTheme.required = custom;
});

roundForm.addEventListener("submit", (event) => {
  event.preventDefault();
  withBusyButton(startButton, async () => {
    const level = Number(difficulty.value);
    const theme = themeMode.value === "none"
      ? null
      : themeMode.value === "custom" ? customTheme.value.trim() : chooseTheme(level);
    if (themeMode.value === "custom" && !theme) {
      throw new Error("お題を入力してください。");
    }
    const { error } = await supabase.rpc("start_round", {
      p_room_id: currentRoomId,
      p_expected_round: currentRound,
      p_difficulty: theme === null ? null : level,
      p_theme: theme
    });
    if (error) throw error;
    clearNotices();
    await refreshRoom();
  });
});

copyButton.addEventListener("click", () => {
  withBusyButton(copyButton, async () => {
    await navigator.clipboard.writeText(currentRoomCode);
    copyButton.textContent = "コピーしました";
    window.setTimeout(() => {
      copyButton.textContent = "コードをコピー";
    }, 1600);
  });
});

refreshButton.addEventListener("click", () => {
  withBusyButton(refreshButton, async () => {
    const roomId = currentRoomId;
    await refreshRoom();
    if (currentRoomId === roomId) clearNotices();
  });
});

leaveButton.addEventListener("click", () => {
  const message = currentIsHost === true
    ? "ホストがホームへ戻ると部屋は終了し、全員が遊べなくなります。戻りますか？"
    : currentIsHost === false
      ? "ホームへ戻るとこの部屋から退出します。配布後は再参加できません。戻りますか？"
      : "部屋の状態を確認できません。ホストなら部屋が終了し、参加者なら退出します。戻りますか？";
  if (!window.confirm(message)) return;
  withBusyButton(leaveButton, async () => {
    const roomId = currentRoomId;
    const { error } = await supabase.rpc("leave_room", {
      p_room_id: roomId
    });
    if (error) throw error;
    if (currentRoomId === roomId) finishRoom();
  });
});

async function initialize() {
  if (!configured) {
    notify("SupabaseのURLと公開キーをconfig.jsに設定してから利用してください。");
    createButton.disabled = true;
    joinButton.disabled = true;
    return;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) {
      setHomeEnabled(true);
      await restoreRoom();
    } else {
      showCaptcha();
    }
  } catch (error) {
    notify(errorMessage(error));
    createButton.disabled = true;
    joinButton.disabled = true;
  }
}

initialize();
