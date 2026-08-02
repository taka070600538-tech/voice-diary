"use strict";

/* ---------- element refs ---------- */
const $ = (id) => document.getElementById(id);
const todayLabel = $("today-label");
const transcriptEl = $("transcript");
const statusLine = $("status-line");
const inkWave = $("ink-wave");
const inkWavePath = $("ink-wave-path");
const recordBtn = $("record-btn");
const recordLabel = $("record-label");
const saveBtn = $("save-btn");
const stampOverlay = $("stamp-overlay");

const settingsBackdrop = $("settings-backdrop");
const openSettingsBtn = $("open-settings");
const closeSettingsBtn = $("close-settings");
const saveSettingsBtn = $("save-settings");
const tokenInput = $("setting-token");
const repoInput = $("setting-repo");
const branchInput = $("setting-branch");
const folderInput = $("setting-folder");

/* ---------- date header ---------- */
todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
}).format(new Date());

/* ---------- settings storage ---------- */
const STORE_KEYS = {
  token: "vd_token",
  repo: "vd_repo",
  branch: "vd_branch",
  folder: "vd_folder"
};

function loadSettings() {
  return {
    token: localStorage.getItem(STORE_KEYS.token) || "",
    repo: localStorage.getItem(STORE_KEYS.repo) || "",
    branch: localStorage.getItem(STORE_KEYS.branch) || "main",
    folder: localStorage.getItem(STORE_KEYS.folder) || "diary"
  };
}

function openSettings() {
  const s = loadSettings();
  tokenInput.value = s.token;
  repoInput.value = s.repo;
  branchInput.value = s.branch;
  folderInput.value = s.folder;
  settingsBackdrop.classList.add("is-open");
}

function closeSettings() {
  settingsBackdrop.classList.remove("is-open");
}

openSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", (e) => {
  if (e.target === settingsBackdrop) closeSettings();
});

saveSettingsBtn.addEventListener("click", () => {
  localStorage.setItem(STORE_KEYS.token, tokenInput.value.trim());
  localStorage.setItem(STORE_KEYS.repo, repoInput.value.trim());
  localStorage.setItem(STORE_KEYS.branch, branchInput.value.trim() || "main");
  localStorage.setItem(STORE_KEYS.folder, folderInput.value.trim().replace(/^\/+|\/+$/g, "") || "diary");
  closeSettings();
  setStatus("設定を保存しました", "success");
});

/* ---------- status line ---------- */
let statusTimer = null;
function setStatus(text, kind) {
  statusLine.textContent = text;
  statusLine.classList.remove("is-error", "is-success");
  if (kind === "error") statusLine.classList.add("is-error");
  if (kind === "success") statusLine.classList.add("is-success");
  clearTimeout(statusTimer);
  if (kind === "success") {
    statusTimer = setTimeout(() => {
      statusLine.textContent = "マイクのボタンを押して話しはじめてください";
      statusLine.classList.remove("is-success");
    }, 4000);
  }
}

/* ---------- ink wave (listening indicator) ---------- */
let waveRaf = null;
let waveT = 0;
function drawWave() {
  waveT += 0.18;
  let d = "M0,30 ";
  const points = 24;
  for (let i = 0; i <= points; i++) {
    const x = (300 / points) * i;
    const amp = 10 + Math.sin(waveT * 0.6 + i * 0.4) * 6;
    const y = 30 + Math.sin(i * 0.9 + waveT) * amp * (0.4 + Math.random() * 0.6);
    d += `L${x.toFixed(1)},${y.toFixed(1)} `;
  }
  inkWavePath.setAttribute("d", d);
  waveRaf = requestAnimationFrame(drawWave);
}
function startWave() {
  inkWave.classList.add("is-active");
  if (!waveRaf) drawWave();
}
function stopWave() {
  inkWave.classList.remove("is-active");
  cancelAnimationFrame(waveRaf);
  waveRaf = null;
  inkWavePath.setAttribute("d", "M0,30 L300,30");
}

/* ---------- speech recognition ---------- */
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let userStopped = false;
let baseText = "";
let finalText = "";

if (SpeechRecognitionCtor) {
  recognition = new SpeechRecognitionCtor();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += chunk;
      } else {
        interim += chunk;
      }
    }
    transcriptEl.value = joinText(baseText, finalText + interim);
    updateSaveEnabled();
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setStatus("マイクの使用が許可されていません。ブラウザの設定を確認してください。", "error");
      userStopped = true;
    } else if (event.error === "no-speech") {
      // silent; onend will decide whether to restart
    } else {
      setStatus("音声認識でエラーが発生しました。もう一度お試しください。", "error");
    }
  };

  recognition.onend = () => {
    if (isRecording && !userStopped) {
      // mobile browsers often stop after a pause; keep listening
      try { recognition.start(); } catch (_) { /* already starting */ }
    } else {
      isRecording = false;
      setRecordingUI(false);
    }
  };
} else {
  recordBtn.disabled = true;
  recordLabel.textContent = "非対応";
  setStatus("このブラウザは音声認識に対応していません。Chromeでお試しいただくか、下の欄に直接書いてください。", "error");
}

function joinText(base, addition) {
  if (!base) return addition;
  if (!addition) return base;
  return base.replace(/\s+$/, "") + "\n" + addition;
}

function setRecordingUI(active) {
  recordBtn.setAttribute("aria-pressed", String(active));
  recordLabel.textContent = active ? "停止" : "録音";
  if (active) {
    startWave();
    setStatus("聞いています…");
  } else {
    stopWave();
    if (!statusLine.classList.contains("is-error")) {
      setStatus("マイクのボタンを押して話しはじめてください");
    }
  }
}

recordBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (!isRecording) {
    baseText = transcriptEl.value;
    finalText = "";
    userStopped = false;
    isRecording = true;
    setRecordingUI(true);
    try {
      recognition.start();
    } catch (_) {
      // recognition already running; ignore
    }
  } else {
    userStopped = true;
    isRecording = false;
    recognition.stop();
    setRecordingUI(false);
  }
});

transcriptEl.addEventListener("input", updateSaveEnabled);
function updateSaveEnabled() {
  saveBtn.disabled = transcriptEl.value.trim().length === 0;
}

/* ---------- github save ---------- */
function pad2(n) { return String(n).padStart(2, "0"); }

function todayPath(folder) {
  const d = new Date();
  const y = d.getFullYear(), m = pad2(d.getMonth() + 1), day = pad2(d.getDate());
  return { path: `${folder}/${y}-${m}-${day}.md`, ymd: `${y}-${m}-${day}` };
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRequest(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  return res;
}

saveBtn.addEventListener("click", async () => {
  const s = loadSettings();
  const text = transcriptEl.value.trim();
  if (!text) return;

  if (!s.token || !s.repo) {
    setStatus("先に設定でトークンとリポジトリを入力してください", "error");
    openSettings();
    return;
  }

  saveBtn.disabled = true;
  setStatus("GitHubに保存しています…");

  const now = new Date();
  const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const { path, ymd } = todayPath(s.folder);
  const apiBase = `https://api.github.com/repos/${s.repo}/contents/${encodePath(path)}`;
  const entryBlock = `## ${hhmm}\n\n${text}\n`;

  try {
    const getRes = await githubRequest(`${apiBase}?ref=${encodeURIComponent(s.branch)}`, s.token);

    let sha = null;
    let newContent;

    if (getRes.status === 200) {
      const data = await getRes.json();
      sha = data.sha;
      const existing = base64ToUtf8(data.content);
      newContent = existing.replace(/\s+$/, "") + "\n\n" + entryBlock;
    } else if (getRes.status === 404) {
      newContent = `---\ndate: ${ymd}\n---\n\n${entryBlock}`;
    } else if (getRes.status === 401) {
      throw new Error("トークンが無効です。設定を確認してください。");
    } else {
      throw new Error(`リポジトリの確認に失敗しました（${getRes.status}）`);
    }

    const putBody = {
      message: `diary: ${ymd} ${hhmm}`,
      content: utf8ToBase64(newContent),
      branch: s.branch
    };
    if (sha) putBody.sha = sha;

    const putRes = await githubRequest(apiBase, s.token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `保存に失敗しました（${putRes.status}）`);
    }

    transcriptEl.value = "";
    baseText = "";
    finalText = "";
    updateSaveEnabled();
    showStamp();
    setStatus("保存しました", "success");
  } catch (err) {
    setStatus(err.message || "保存に失敗しました。通信環境を確認してください。", "error");
    saveBtn.disabled = text.trim().length === 0;
  }
});

function showStamp() {
  stampOverlay.classList.add("is-showing");
  setTimeout(() => stampOverlay.classList.remove("is-showing"), 1400);
}

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline shell is best-effort */ });
  });
}
