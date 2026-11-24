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
const roomHeading = document.querySelector("#room-heading");
const roomStatus = document.querySelector("#room-status");
const playersList = document.querySelector("#players-list");
const playerCount = document.querySelector("#player-count");
const startButton = document.querySelector("#start-button");
const hostHint = document.querySelector("#host-hint");
const guestHint = document.querySelector("#guest-hint");
const numberPanel = document.querySelector("#number-panel");
const numberValue = document.querySelector("#number-title");
const copyButton = document.querySelector("#copy-button");
const leaveButton = document.querySelector("#leave-button");

let currentRoomId = null;
let currentRoomCode = null;
let activeChannel = null;

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
  if (data.session) return;

  const { error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) throw signInError;
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
  sessionStorage.setItem("ito-room-id", roomId);
  showScreen("room");
  await refreshRoom();
  subscribeToRoom(roomId);
}

async function refreshRoom() {
  if (!currentRoomId) return;
  const { data, error } = await supabase.rpc("get_room_state", {
    p_room_id: currentRoomId
  });
  if (error) throw error;

  currentRoomCode = data.code;
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
  startButton.hidden = !waiting || !data.is_host;
  hostHint.hidden = !waiting || !data.is_host;
  guestHint.hidden = !waiting || data.is_host;
  numberPanel.hidden = waiting;
  if (!waiting) {
    numberValue.textContent = Number.isInteger(data.my_number) ? String(data.my_number) : "--";
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
    }, () => {
      refreshRoom().catch((error) => notify(errorMessage(error)));
    })
    .subscribe((status) => {
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

startButton.addEventListener("click", () => {
  withBusyButton(startButton, async () => {
    const { error } = await supabase.rpc("start_game", {
      p_room_id: currentRoomId
    });
    if (error) throw error;
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

leaveButton.addEventListener("click", () => {
  withBusyButton(leaveButton, async () => {
    const { error } = await supabase.rpc("leave_room", {
      p_room_id: currentRoomId
    });
    if (error) throw error;
    if (activeChannel) {
      await supabase.removeChannel(activeChannel);
      activeChannel = null;
    }
    currentRoomId = null;
    currentRoomCode = null;
    sessionStorage.removeItem("ito-room-id");
    showScreen("home");
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
    await ensureSignedIn();
    const savedRoomId = sessionStorage.getItem("ito-room-id");
    if (savedRoomId) {
      currentRoomId = savedRoomId;
      showScreen("room");
      try {
        await refreshRoom();
        subscribeToRoom(savedRoomId);
      } catch (error) {
        sessionStorage.removeItem("ito-room-id");
        currentRoomId = null;
        showScreen("home");
        notify(`前回の部屋に戻れませんでした: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    notify(errorMessage(error));
    createButton.disabled = true;
    joinButton.disabled = true;
  }
}

initialize();
