import { loadEntries, saveEntries, addEntry, buildBackup } from './store.js';

const SYNC_URL = 'https://taka070600538-tech.github.io/app-sync/v1/sync.js';
const entries = loadEntries();

// 旧実装(GitHub直接保存)の設定キーを掃除する
for (const k of ['vd_token', 'vd_repo', 'vd_branch', 'vd_folder']) localStorage.removeItem(k);

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

/* ---------- date header ---------- */
todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
}).format(new Date());

function openSettings() {
  settingsBackdrop.classList.add('is-open');
  window.vdRenderSettingsSections();
}

function closeSettings() {
  settingsBackdrop.classList.remove('is-open');
}

openSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", (e) => {
  if (e.target === settingsBackdrop) closeSettings();
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
// finalText holds fully-committed segments; currentSegment holds the most
// recent finalized chunk, which some engines (observed on Android) keep
// re-emitting as isFinal:true while it's still growing or being restated
// verbatim, rather than only marking the truly completed chunk once.
let finalText = "";
let currentSegment = "";
// Tracks how many of the CURRENT session's results we've already looked at.
// Some browsers can redeliver a stale/zero resultIndex, so resultIndex alone
// can't be trusted to avoid reprocessing the same entry.
let sessionFinalCount = 0;

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
        if (i >= sessionFinalCount) {
          if (chunk.startsWith(currentSegment)) {
            // growing restatement (or exact repeat) of the same chunk
            currentSegment = chunk;
          } else if (!currentSegment.startsWith(chunk)) {
            // genuinely new content, not a shorter duplicate of what we have
            finalText += currentSegment;
            currentSegment = chunk;
          }
          sessionFinalCount = i + 1;
        }
      } else {
        interim += chunk;
      }
    }
    transcriptEl.value = joinText(baseText, finalText + currentSegment + interim);
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
      // mobile browsers often stop after a pause; keep listening.
      // A restart begins a brand-new session whose results are indexed
      // from 0 again, so the per-session dedupe counter must reset too.
      sessionFinalCount = 0;
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
    currentSegment = "";
    sessionFinalCount = 0;
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

/* ---------- local save ---------- */
saveBtn.addEventListener('click', () => {
  const text = transcriptEl.value.trim();
  if (!text) return;
  addEntry(entries, text);
  transcriptEl.value = '';
  baseText = '';
  finalText = '';
  currentSegment = '';
  updateSaveEnabled();
  showStamp();
  setStatus('保存しました', 'success');
});

/* ---------- app-sync (1日1回自動バックアップ) ---------- */
import(SYNC_URL)
  .then((sync) => sync.initDailyBackup({
    appId: 'voice-diary',
    collect: async () => buildBackup(loadEntries()),
    restore: async (data) => {
      saveEntries(Array.isArray(data?.entries) ? data.entries : []);
    },
  }))
  .catch(() => {}); // オフライン時はスキップ(アプリ本体は動く)

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

window.vdRenderSettingsSections = () => {};
