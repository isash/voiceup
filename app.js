/**
 * VoiceUp - 毎日5分のボイトレ＆カラオケ上達アプリ
 * Web Audio API によるリアルタイム・ピッチ検出 + カラオケ風採点バー + 成長記録システム
 */

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_KANA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
const RECORDS_STORAGE_KEY = "voiceup_records_v1";

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function freqToMidiFloat(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const noteIdx = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_STRINGS[noteIdx]}${octave} (${NOTE_KANA[noteIdx]})`;
}

function midiToShortName(midi) {
  const rounded = Math.round(midi);
  const noteIdx = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_STRINGS[noteIdx]}${octave}`;
}

function getTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTimeStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${min}`;
}

// ==========================================
// 内蔵サンプル曲・フレーズデータ
// ==========================================
const SONG_PHRASES = {
  furusato: {
    title: "ゆったり階段メロディ（ふるさと風）",
    baseMidi: 57,
    bpm: 88,
    notes: [
      { offset: 0, dur: 1.0, lyric: "う" },
      { offset: 0, dur: 1.0, lyric: "さ" },
      { offset: 0, dur: 1.0, lyric: "ぎ" },
      { offset: 2, dur: 1.5, lyric: "お" },
      { offset: 4, dur: 0.5, lyric: "い" },
      { offset: 2, dur: 1.0, lyric: "し" },
      { offset: 4, dur: 1.0, lyric: "か" },
      { offset: 4, dur: 1.0, lyric: "の" },
      { offset: 5, dur: 1.0, lyric: "や" },
      { offset: 4, dur: 2.0, lyric: "まー" }
    ]
  },
  jpop_a: {
    title: "J-POP風 Aメロ（狭い音域）",
    baseMidi: 57,
    bpm: 96,
    notes: [
      { offset: 0, dur: 0.75, lyric: "き" },
      { offset: 2, dur: 0.75, lyric: "み" },
      { offset: 4, dur: 1.0, lyric: "と" },
      { offset: 2, dur: 1.0, lyric: "い" },
      { offset: 0, dur: 1.5, lyric: "た" },
      { offset: -1, dur: 0.5, lyric: "(息)" },
      { offset: 2, dur: 0.75, lyric: "あ" },
      { offset: 4, dur: 0.75, lyric: "の" },
      { offset: 7, dur: 1.25, lyric: "そ" },
      { offset: 4, dur: 2.0, lyric: "らー" }
    ]
  },
  jpop_chorus: {
    title: "J-POP風 サビ（高音ロングトーン）",
    baseMidi: 58,
    bpm: 100,
    notes: [
      { offset: 0, dur: 1.0, lyric: "と" },
      { offset: 4, dur: 1.0, lyric: "ど" },
      { offset: 7, dur: 1.5, lyric: "けー" },
      { offset: 5, dur: 0.75, lyric: "こ" },
      { offset: 4, dur: 0.75, lyric: "の" },
      { offset: 2, dur: 1.0, lyric: "こ" },
      { offset: 4, dur: 1.0, lyric: "え" },
      { offset: 7, dur: 2.5, lyric: "よー" }
    ]
  },
  kirakira: {
    title: "きらきら星（音程ジャンプの基礎）",
    baseMidi: 57,
    bpm: 92,
    notes: [
      { offset: 0, dur: 1.0, lyric: "き" },
      { offset: 0, dur: 1.0, lyric: "ら" },
      { offset: 7, dur: 1.0, lyric: "き" },
      { offset: 7, dur: 1.0, lyric: "ら" },
      { offset: 9, dur: 1.0, lyric: "ひ" },
      { offset: 9, dur: 1.0, lyric: "か" },
      { offset: 7, dur: 2.0, lyric: "るー" }
    ]
  }
};

// ==========================================
// 成長記録データ構造 (localStorage永続化)
// ==========================================
function createDefaultRecords() {
  return {
    streak: 1,
    lastPracticeDate: null,
    measuredMinMidi: null,
    measuredMaxMidi: null,
    maxScaleClearedMidi: null,
    totalLowBias: 0,
    totalHighBias: 0,
    dailyStats: {}, // { 'YYYY-MM-DD': { count, totalScore, maxScore, minMidi, maxMidi } }
    noteStats: {}, // { '57': { hits: 120, total: 150 } }
    history: [] // [{ timeStr, modeLabel, detail, score, tendency }]
  };
}

let records = createDefaultRecords();

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      records = { ...createDefaultRecords(), ...parsed };
    }
    // 旧キーからの移行サポート
    const oldMin = localStorage.getItem("voiceup_min_midi");
    const oldMax = localStorage.getItem("voiceup_max_midi");
    if (records.measuredMinMidi === null && oldMin) records.measuredMinMidi = parseInt(oldMin, 10);
    if (records.measuredMaxMidi === null && oldMax) records.measuredMaxMidi = parseInt(oldMax, 10);
  } catch (e) {
    console.warn("Failed to load records:", e);
  }
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn("Failed to save records:", e);
  }
}

// ==========================================
// アプリの状態管理
// ==========================================
const state = {
  mode: "longtone", // 'longtone' | 'scale' | 'song' | 'range' | 'records'
  audioCtx: null,
  analyser: null,
  micStream: null,
  isMicOn: false,
  isTraining: false,

  // ピッチ検出履歴
  currentFreq: null,
  currentMidiFloat: null,
  smoothedMidi: null,
  pitchHistory: [],

  // モード別設定
  longtoneMidi: 57, // A3
  scaleBaseMidi: 57,
  scalePattern: "five",
  songKeyOffset: 0,
  songTempoRate: 1.0,
  selectedSongKey: "furusato",

  // トレーニング進行用タイムライン
  trainingStartTime: 0,
  trainingDuration: 0,
  targetSegments: [],
  hitSamples: 0,
  totalActiveSamples: 0,
  lowBiasSamples: 0,
  highBiasSamples: 0,

  // 音域測定データ
  stableNoteCounter: 0,
  lastCandidateMidi: null,

  // 外部音声ファイル (Suno等)
  customAudioUrl: null,
  customAudioElement: null
};

// DOM要素の取得
const els = {
  tabBtns: document.querySelectorAll(".tab-btn"),
  modeSettings: document.querySelectorAll(".mode-settings"),
  practiceStage: document.getElementById("practiceStage"),
  recordsStage: document.getElementById("recordsStage"),
  todayCountText: document.getElementById("todayCountText"),
  streakCount: document.getElementById("streakCount"),
  userRangeText: document.getElementById("userRangeText"),

  targetNoteDisplay: document.getElementById("targetNoteDisplay"),
  targetFreqDisplay: document.getElementById("targetFreqDisplay"),
  detectedNoteDisplay: document.getElementById("detectedNoteDisplay"),
  centDiffDisplay: document.getElementById("centDiffDisplay"),
  centPointer: document.getElementById("centPointer"),
  currentScoreDisplay: document.getElementById("currentScoreDisplay"),
  comboDisplay: document.getElementById("comboDisplay"),
  canvas: document.getElementById("pitchCanvas"),
  canvasOverlay: document.getElementById("canvasOverlay"),
  coachText: document.getElementById("coachText"),
  micToggleBtn: document.getElementById("micToggleBtn"),
  playRefBtn: document.getElementById("playRefBtn"),
  startTrainingBtn: document.getElementById("startTrainingBtn"),

  ltNoteDown: document.getElementById("ltNoteDown"),
  ltNoteUp: document.getElementById("ltNoteUp"),
  ltCurrentNoteLabel: document.getElementById("ltCurrentNoteLabel"),
  presetChips: document.querySelectorAll(".chip"),
  scalePatternSelect: document.getElementById("scalePatternSelect"),
  scaleKeyDown: document.getElementById("scaleKeyDown"),
  scaleKeyUp: document.getElementById("scaleKeyUp"),
  scaleKeyLabel: document.getElementById("scaleKeyLabel"),
  autoKeyUpCheck: document.getElementById("autoKeyUpCheck"),
  songSelect: document.getElementById("songSelect"),
  songKeyDown: document.getElementById("songKeyDown"),
  songKeyUp: document.getElementById("songKeyUp"),
  songKeyOffsetLabel: document.getElementById("songKeyOffsetLabel"),
  songTempoDown: document.getElementById("songTempoDown"),
  songTempoUp: document.getElementById("songTempoUp"),
  songTempoLabel: document.getElementById("songTempoLabel"),
  audioFileInput: document.getElementById("audioFileInput"),
  audioFileName: document.getElementById("audioFileName"),
  measuredMinNote: document.getElementById("measuredMinNote"),
  measuredMaxNote: document.getElementById("measuredMaxNote"),
  measuredSpan: document.getElementById("measuredSpan"),
  resetRangeBtn: document.getElementById("resetRangeBtn"),
  applyRangeBtn: document.getElementById("applyRangeBtn"),

  // 成長記録画面の要素
  missionStatusText: document.getElementById("missionStatusText"),
  dailyStampBox: document.getElementById("dailyStampBox"),
  missionProgressBar: document.getElementById("missionProgressBar"),
  ovTotalSessions: document.getElementById("ovTotalSessions"),
  ovAvgScore: document.getElementById("ovAvgScore"),
  ovMaxClearedNote: document.getElementById("ovMaxClearedNote"),
  ovPitchTendency: document.getElementById("ovPitchTendency"),
  growthChartCanvas: document.getElementById("growthChartCanvas"),
  noteHeatmapContainer: document.getElementById("noteHeatmapContainer"),
  historyListContainer: document.getElementById("historyListContainer"),
  exportDataBtn: document.getElementById("exportDataBtn"),
  importDataInput: document.getElementById("importDataInput"),
  clearAllDataBtn: document.getElementById("clearAllDataBtn")
};

const ctx = els.canvas.getContext("2d");

// ==========================================
// 初期化処理
// ==========================================
function initApp() {
  loadRecords();
  updateHeaderBadges();
  updateRangeDisplay();
  resizeCanvas();
  window.addEventListener("resize", () => {
    resizeCanvas();
    if (state.mode === "records") renderRecordsStage();
  });
  setupEventListeners();
  updateTargetUI();
  requestAnimationFrame(renderLoop);
}

function updateHeaderBadges() {
  const today = getTodayStr();
  const todayData = records.dailyStats[today] || { count: 0 };
  els.todayCountText.textContent = `${todayData.count}/3`;
  els.streakCount.textContent = records.streak || 1;
}

function resizeCanvas() {
  const rect = els.canvas.parentElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    els.canvas.width = rect.width * window.devicePixelRatio;
    els.canvas.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
}

// ==========================================
// Web Audio API: 音声合成 ＆ マイク入力
// ==========================================
function ensureAudioContext() {
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextClass();
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
}

function playReferenceTone(midi, durationSec = 1.0, startTimeOffset = 0, volume = 0.25) {
  ensureAudioContext();
  const now = state.audioCtx.currentTime + startTimeOffset;
  const freq = midiToFreq(midi);

  const osc1 = state.audioCtx.createOscillator();
  const osc2 = state.audioCtx.createOscillator();
  const gainNode = state.audioCtx.createGain();

  osc1.type = "triangle";
  osc2.type = "sine";
  osc1.frequency.setValueAtTime(freq, now);
  osc2.frequency.setValueAtTime(freq * 2, now);

  const subGain = state.audioCtx.createGain();
  subGain.gain.setValueAtTime(0.18, now);

  gainNode.gain.setValueAtTime(0.001, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(volume * 0.6, now + durationSec * 0.7);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc1.connect(gainNode);
  osc2.connect(subGain);
  subGain.connect(gainNode);
  gainNode.connect(state.audioCtx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + durationSec + 0.02);
  osc2.stop(now + durationSec + 0.02);
}

async function toggleMic() {
  if (state.isMicOn) {
    stopMic();
    return;
  }

  try {
    ensureAudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    state.micStream = stream;
    const source = state.audioCtx.createMediaStreamSource(stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    source.connect(state.analyser);

    state.isMicOn = true;
    els.micToggleBtn.classList.add("active");
    els.micToggleBtn.innerHTML = "🛑 マイクON中";
    els.canvasOverlay.classList.add("hidden");
    setCoachMessage("マイク準備OK！「あー」と声を出すと、あなたの音程がリアルタイムに線で表示されます。");
  } catch (err) {
    console.error("Mic error:", err);
    setCoachMessage("⚠️ マイクの許可が必要です。ブラウザのマイクアクセスを「許可」にしてください。");
  }
}

function stopMic() {
  if (state.micStream) {
    state.micStream.getTracks().forEach((t) => t.stop());
    state.micStream = null;
  }
  state.isMicOn = false;
  state.currentFreq = null;
  state.currentMidiFloat = null;
  state.smoothedMidi = null;
  els.micToggleBtn.classList.remove("active");
  els.micToggleBtn.innerHTML = "🎙️ マイクON";
  els.detectedNoteDisplay.textContent = "--";
  els.centDiffDisplay.textContent = "マイク待機中";
}

// ==========================================
// 自己相関法によるピッチ検出
// ==========================================
function detectPitch(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.012) return null;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }

  const trimmed = buf.slice(r1, r2);
  const newSize = trimmed.length;
  if (newSize < 64) return null;

  const c = new Float32Array(newSize);
  for (let i = 0; i < newSize; i++) {
    let sum = 0;
    for (let j = 0; j < newSize - i; j++) {
      sum += trimmed[j] * trimmed[j + i];
    }
    c[i] = sum;
  }

  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) {
    d++;
  }

  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  if (maxpos <= 0 || maxval / c[0] < 0.45) return null;

  let T0 = maxpos;
  if (T0 > 0 && T0 < newSize - 1) {
    const x1 = c[T0 - 1];
    const x2 = c[T0];
    const x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);
  }

  const freq = sampleRate / T0;
  if (freq < 65 || freq > 1100) return null;
  return freq;
}

// ==========================================
// トレーニング・シーケンス生成
// ==========================================
function buildTrainingSegments() {
  const segments = [];

  if (state.mode === "longtone") {
    segments.push({
      startSec: 1.2,
      endSec: 4.7,
      midi: state.longtoneMidi,
      lyric: "あー (3.5秒キープ)"
    });
    return { segments, totalSec: 5.2 };
  }

  if (state.mode === "scale") {
    const base = state.scaleBaseMidi;
    let offsets = [];
    let noteDur = 0.75;

    if (state.scalePattern === "three") {
      offsets = [0, 2, 4, 2, 0];
    } else if (state.scalePattern === "five") {
      offsets = [0, 2, 4, 5, 7, 5, 4, 2, 0];
    } else if (state.scalePattern === "arpeggio") {
      offsets = [0, 4, 7, 4, 0];
      noteDur = 0.85;
    } else if (state.scalePattern === "siren") {
      offsets = [0, 2, 4, 5, 7, 9, 7, 5, 4, 2, 0];
      noteDur = 0.45;
    }

    const kanaScale = { 0: "ド", 2: "レ", 4: "ミ", 5: "ファ", 7: "ソ", 9: "ラ" };
    let cursor = 0.8;
    offsets.forEach((off) => {
      segments.push({
        startSec: cursor,
        endSec: cursor + noteDur - 0.05,
        midi: base + off,
        lyric: kanaScale[off] || "ー"
      });
      cursor += noteDur;
    });
    return { segments, totalSec: cursor + 0.6 };
  }

  if (state.mode === "song") {
    const song = SONG_PHRASES[state.selectedSongKey];
    const beatSec = (60 / song.bpm) / state.songTempoRate;
    let cursor = 1.0;

    song.notes.forEach((n) => {
      const durSec = n.dur * beatSec;
      if (n.offset >= 0) {
        segments.push({
          startSec: cursor,
          endSec: cursor + durSec - 0.06,
          midi: song.baseMidi + state.songKeyOffset + n.offset,
          lyric: n.lyric
        });
      }
      cursor += durSec;
    });
    return { segments, totalSec: cursor + 0.8 };
  }

  return { segments: [], totalSec: 0 };
}

async function startTraining() {
  if (state.isTraining) {
    stopTraining(false);
    return;
  }

  if (!state.isMicOn) {
    await toggleMic();
    if (!state.isMicOn) return;
  }

  if (state.mode === "range") {
    setCoachMessage("音域測定モードです！まずは一番低い声で「あー」、次に一番高い裏声・地声で「あー」と出してみてください。");
    return;
  }

  ensureAudioContext();
  const { segments, totalSec } = buildTrainingSegments();
  state.targetSegments = segments;
  state.trainingDuration = totalSec;
  state.trainingStartTime = performance.now() / 1000;
  state.hitSamples = 0;
  state.totalActiveSamples = 0;
  state.lowBiasSamples = 0;
  state.highBiasSamples = 0;
  state.isTraining = true;

  els.startTrainingBtn.classList.add("running");
  els.startTrainingBtn.innerHTML = "⏹️ ストップ";

  if (state.mode === "longtone") {
    playReferenceTone(state.longtoneMidi, 1.0, 0, 0.3);
    setCoachMessage("最初にお手本の音が鳴ります。続けて同じ高さで「あー」と3.5秒間キープしましょう！");
  } else {
    segments.forEach((seg) => {
      const dur = seg.endSec - seg.startSec;
      playReferenceTone(seg.midi, dur, seg.startSec, 0.16);
    });
    setCoachMessage("ガイド音と一緒に、青いバーにあなたの声の線が重なるように歌ってみましょう！");
  }

  if (state.mode === "song" && state.customAudioElement) {
    state.customAudioElement.currentTime = 0;
    state.customAudioElement.playbackRate = state.songTempoRate;
    state.customAudioElement.play().catch(() => {});
  }
}

/**
 * トレーニング完了時の記録保存＆フィードバック
 */
function recordCompletedSession(score, tendencyLabel) {
  const today = getTodayStr();

  // 連続日数更新
  if (records.lastPracticeDate !== today) {
    if (records.lastPracticeDate) {
      const prev = new Date(records.lastPracticeDate);
      const curr = new Date(today);
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        records.streak = (records.streak || 1) + 1;
      } else if (diffDays > 1) {
        records.streak = 1;
      }
    } else {
      records.streak = 1;
    }
    records.lastPracticeDate = today;
  }

  // 日別集計
  if (!records.dailyStats[today]) {
    records.dailyStats[today] = {
      count: 0,
      totalScore: 0,
      maxScore: 0,
      minMidi: records.measuredMinMidi,
      maxMidi: records.measuredMaxMidi
    };
  }
  const ds = records.dailyStats[today];
  ds.count += 1;
  ds.totalScore += score;
  ds.maxScore = Math.max(ds.maxScore, score);
  ds.minMidi = records.measuredMinMidi;
  ds.maxMidi = records.measuredMaxMidi;

  // 音程のクセ累計
  records.totalLowBias = (records.totalLowBias || 0) + state.lowBiasSamples;
  records.totalHighBias = (records.totalHighBias || 0) + state.highBiasSamples;

  // モード名と詳細
  let modeLabel = "音程キープ";
  let detail = midiToNoteName(state.longtoneMidi);
  if (state.mode === "scale") {
    modeLabel = "音階トレ";
    const maxSegMidi = Math.max(...state.targetSegments.map((s) => s.midi));
    detail = `${midiToShortName(state.scaleBaseMidi)}〜${midiToShortName(maxSegMidi)}`;
    if (score >= 80) {
      if (records.maxScaleClearedMidi === null || maxSegMidi > records.maxScaleClearedMidi) {
        records.maxScaleClearedMidi = maxSegMidi;
      }
    }
  } else if (state.mode === "song") {
    modeLabel = "曲フレーズ";
    const song = SONG_PHRASES[state.selectedSongKey];
    const sign = state.songKeyOffset >= 0 ? `+${state.songKeyOffset}` : state.songKeyOffset;
    detail = `${song.title} (キー${sign})`;
  }

  records.history.unshift({
    timeStr: getTimeStr(),
    modeLabel,
    detail,
    score,
    tendency: tendencyLabel
  });
  if (records.history.length > 50) {
    records.history.pop();
  }

  saveRecords();
  updateHeaderBadges();
}

function stopTraining(completedNormally = false) {
  state.isTraining = false;
  els.startTrainingBtn.classList.remove("running");
  els.startTrainingBtn.innerHTML = "▶️ トレーニング開始";

  if (state.customAudioElement) {
    state.customAudioElement.pause();
  }

  if (!completedNormally) {
    setCoachMessage("トレーニングを中断しました。自分のペースでいつでも再開できます！");
    return;
  }

  const score =
    state.totalActiveSamples > 0
      ? Math.round((state.hitSamples / state.totalActiveSamples) * 100)
      : 0;
  els.currentScoreDisplay.textContent = score;

  let tendencyMsg = "";
  let tendencyLabel = "🎯 安定";
  if (state.lowBiasSamples > state.highBiasSamples * 1.5 && state.lowBiasSamples > 10) {
    tendencyLabel = "少し低め(♭)";
    tendencyMsg = "少し音程が低め(♭)になる傾向があります。目線を少し上げて、眉間から声を前に出すイメージを持つとピタッと合いやすくなります！";
  } else if (state.highBiasSamples > state.lowBiasSamples * 1.5 && state.highBiasSamples > 10) {
    tendencyLabel = "少し高め(♯)";
    tendencyMsg = "少し音程が高め(♯)に上ずる傾向があります。肩と喉の力を抜いて、深呼吸してから優しく声を出してみましょう！";
  }

  // 成長記録へ自動保存
  recordCompletedSession(score, tendencyLabel);

  if (score >= 80) {
    if (state.mode === "scale" && els.autoKeyUpCheck.checked) {
      state.scaleBaseMidi = Math.min(72, state.scaleBaseMidi + 1);
      updateTargetUI();
      setCoachMessage(
        `🎉 スコア ${score}% でクリア（成長記録に保存しました）！音域を広げるため開始キーを半音(+1)上げました (${midiToShortName(state.scaleBaseMidi)})。`
      );
    } else {
      setCoachMessage(`🎉 スコア ${score}%！（成長記録に保存しました）素晴らしい音感です！${tendencyMsg}`);
    }
  } else if (score >= 50) {
    setCoachMessage(
      `👍 スコア ${score}%（記録保存済み）！あと少しです！${tendencyMsg || "最初に「お手本を聴く」で頭の中で音をイメージしてから声を出すとグッと安定します。"}`
    );
  } else {
    setCoachMessage(
      `💪 スコア ${score}%（記録保存済み）。出しにくい高さの場合は、無理せず「半音下げる」で自分のラクに出せる高さに調整してから練習しましょう！`
    );
  }
}

// ==========================================
// メイン描画＆ピッチ更新ループ (60fps)
// ==========================================
function renderLoop() {
  const nowSec = performance.now() / 1000;

  if (state.isMicOn && state.analyser) {
    const buf = new Float32Array(state.analyser.fftSize);
    state.analyser.getFloatTimeDomainData(buf);
    const freq = detectPitch(buf, state.audioCtx.sampleRate);

    if (freq) {
      const rawMidi = freqToMidiFloat(freq);
      if (state.smoothedMidi === null || Math.abs(rawMidi - state.smoothedMidi) > 6) {
        state.smoothedMidi = rawMidi;
      } else {
        state.smoothedMidi = state.smoothedMidi * 0.68 + rawMidi * 0.32;
      }
      state.currentFreq = freq;
      state.currentMidiFloat = state.smoothedMidi;

      state.pitchHistory.push({ time: nowSec, midi: state.smoothedMidi });
      updatePitchHUD(state.smoothedMidi);

      if (state.mode === "range") {
        processRangeMeasurement(state.smoothedMidi);
      }
    } else {
      state.currentFreq = null;
      state.currentMidiFloat = null;
      state.smoothedMidi = null;
      state.pitchHistory.push({ time: nowSec, midi: null });
    }

    const cutoff = nowSec - 8.0;
    while (state.pitchHistory.length > 0 && state.pitchHistory[0].time < cutoff) {
      state.pitchHistory.shift();
    }
  }

  if (state.isTraining) {
    const elapsed = nowSec - state.trainingStartTime;
    const activeSeg = state.targetSegments.find(
      (s) => elapsed >= s.startSec && elapsed <= s.endSec
    );

    if (activeSeg) {
      els.targetNoteDisplay.textContent = midiToNoteName(activeSeg.midi);
      els.targetFreqDisplay.textContent = `${midiToFreq(activeSeg.midi).toFixed(1)} Hz`;

      state.totalActiveSamples++;
      const noteKey = String(activeSeg.midi);
      if (!records.noteStats[noteKey]) {
        records.noteStats[noteKey] = { hits: 0, total: 0 };
      }
      records.noteStats[noteKey].total += 1;

      if (state.currentMidiFloat !== null) {
        const diffSemitones = state.currentMidiFloat - activeSeg.midi;
        const absDiff = Math.abs(diffSemitones);
        if (absDiff <= 0.55) {
          state.hitSamples++;
          records.noteStats[noteKey].hits += 1;
          activeSeg.isHitNow = true;
        } else {
          activeSeg.isHitNow = false;
          if (diffSemitones < -0.55) state.lowBiasSamples++;
          if (diffSemitones > 0.55) state.highBiasSamples++;
        }
      } else {
        activeSeg.isHitNow = false;
      }

      const liveScore = Math.round((state.hitSamples / state.totalActiveSamples) * 100);
      els.currentScoreDisplay.textContent = liveScore;
    }

    if (elapsed >= state.trainingDuration) {
      stopTraining(true);
    }
  }

  if (state.mode !== "records") {
    drawPitchCanvas(nowSec);
  }

  requestAnimationFrame(renderLoop);
}

function updatePitchHUD(midiFloat) {
  const nearestMidi = Math.round(midiFloat);
  els.detectedNoteDisplay.textContent = midiToNoteName(nearestMidi);

  const targetMidi = getCurrentTargetMidi();
  const refMidi = targetMidi !== null ? targetMidi : nearestMidi;
  const diffCents = Math.round((midiFloat - refMidi) * 100);
  const clampedCents = Math.max(-100, Math.min(100, diffCents));

  const percent = 50 + (clampedCents / 100) * 45;
  els.centPointer.style.left = `${percent}%`;

  if (Math.abs(diffCents) <= 35) {
    els.centDiffDisplay.textContent = "🎯 ピッタリ！";
    els.centDiffDisplay.style.color = "#4ade80";
    els.centPointer.style.backgroundColor = "#4ade80";
    els.comboDisplay.textContent = "安定度: ◎ バッチリ";
  } else if (diffCents < 0) {
    els.centDiffDisplay.textContent = `少し低い (${diffCents} cent)`;
    els.centDiffDisplay.style.color = "#fbbf24";
    els.centPointer.style.backgroundColor = "#fbbf24";
    els.comboDisplay.textContent = "安定度: △ 少し高めを狙おう";
  } else {
    els.centDiffDisplay.textContent = `少し高い (+${diffCents} cent)`;
    els.centDiffDisplay.style.color = "#f87171";
    els.centPointer.style.backgroundColor = "#f87171";
    els.comboDisplay.textContent = "安定度: △ 力を抜いてみよう";
  }
}

function getCurrentTargetMidi() {
  if (state.isTraining) {
    const elapsed = performance.now() / 1000 - state.trainingStartTime;
    const seg = state.targetSegments.find((s) => elapsed >= s.startSec && elapsed <= s.endSec);
    if (seg) return seg.midi;
  }
  if (state.mode === "longtone") return state.longtoneMidi;
  if (state.mode === "scale") return state.scaleBaseMidi;
  if (state.mode === "song") {
    const song = SONG_PHRASES[state.selectedSongKey];
    return song.baseMidi + state.songKeyOffset;
  }
  return null;
}

function processRangeMeasurement(midiFloat) {
  const rounded = Math.round(midiFloat);
  if (state.lastCandidateMidi === rounded) {
    state.stableNoteCounter++;
  } else {
    state.lastCandidateMidi = rounded;
    state.stableNoteCounter = 1;
  }

  if (state.stableNoteCounter >= 15) {
    let updated = false;
    if (records.measuredMinMidi === null || rounded < records.measuredMinMidi) {
      records.measuredMinMidi = rounded;
      updated = true;
    }
    if (records.measuredMaxMidi === null || rounded > records.measuredMaxMidi) {
      records.measuredMaxMidi = rounded;
      updated = true;
    }
    if (updated) {
      const today = getTodayStr();
      if (records.dailyStats[today]) {
        records.dailyStats[today].minMidi = records.measuredMinMidi;
        records.dailyStats[today].maxMidi = records.measuredMaxMidi;
      }
      saveRecords();
      updateRangeDisplay();
    }
  }
}

function updateRangeDisplay() {
  if (records.measuredMinMidi !== null && records.measuredMaxMidi !== null) {
    const minStr = midiToNoteName(records.measuredMinMidi);
    const maxStr = midiToNoteName(records.measuredMaxMidi);
    const span = records.measuredMaxMidi - records.measuredMinMidi;

    els.measuredMinNote.textContent = minStr;
    els.measuredMaxNote.textContent = maxStr;
    els.measuredSpan.textContent = `${span} 半音 (${(span / 12).toFixed(1)} オクターブ)`;
    els.userRangeText.textContent = `${midiToShortName(records.measuredMinMidi)}〜${midiToShortName(records.measuredMaxMidi)}`;
    els.applyRangeBtn.disabled = false;
  } else {
    els.measuredMinNote.textContent = "--";
    els.measuredMaxNote.textContent = "--";
    els.measuredSpan.textContent = "-- 半音";
    els.userRangeText.textContent = "未測定";
    els.applyRangeBtn.disabled = true;
  }
}

// ==========================================
// カラオケ風ピッチロール Canvas 描画
// ==========================================
function drawPitchCanvas(nowSec) {
  const width = els.canvas.width / window.devicePixelRatio;
  const height = els.canvas.height / window.devicePixelRatio;
  if (!width || !height) return;
  ctx.clearRect(0, 0, width, height);

  let centerMidi = 58;
  const target = getCurrentTargetMidi();
  if (target !== null) {
    centerMidi = target + 2;
  } else if (state.currentMidiFloat !== null) {
    centerMidi = Math.round(state.currentMidiFloat);
  }

  const visibleSemitones = 14;
  const minMidi = centerMidi - visibleSemitones / 2;
  const maxMidi = centerMidi + visibleSemitones / 2;

  const midiToY = (m) => {
    const norm = (m - minMidi) / (maxMidi - minMidi);
    return height - norm * (height - 28) - 14;
  };

  ctx.lineWidth = 1;
  ctx.font = "11px sans-serif";
  for (let m = Math.floor(minMidi); m <= Math.ceil(maxMidi); m++) {
    const y = midiToY(m);
    const isNatural = ![1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
    ctx.strokeStyle = isNatural ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.moveTo(46, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    if (isNatural) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
      ctx.fillText(midiToNoteName(m), 6, y + 4);
    }
  }

  const playheadX = width * 0.35;
  const pxPerSec = (width * 0.6) / 4.0;

  if (state.isTraining && state.targetSegments.length > 0) {
    const elapsed = nowSec - state.trainingStartTime;

    state.targetSegments.forEach((seg) => {
      const x1 = playheadX + (seg.startSec - elapsed) * pxPerSec;
      const x2 = playheadX + (seg.endSec - elapsed) * pxPerSec;
      const barWidth = Math.max(8, x2 - x1);
      const y = midiToY(seg.midi);
      const barHeight = 16;

      if (x2 < 46 || x1 > width) return;

      if (seg.isHitNow) {
        ctx.fillStyle = "rgba(74, 222, 128, 0.85)";
        ctx.strokeStyle = "#ffffff";
      } else {
        ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
        ctx.strokeStyle = "#38bdf8";
      }

      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x1, y - barHeight / 2, barWidth, barHeight, 6);
      ctx.fill();
      ctx.stroke();

      if (seg.lyric) {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(seg.lyric, x1 + 6, y - 11);
      }
    });
  } else if (state.mode !== "range" && target !== null) {
    const y = midiToY(target);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(46, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = "rgba(192, 132, 252, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();

  if (state.pitchHistory.length > 1) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#facc15";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < state.pitchHistory.length; i++) {
      const pt = state.pitchHistory[i];
      if (pt.midi === null) {
        started = false;
        continue;
      }
      const x = playheadX - (nowSec - pt.time) * pxPerSec;
      if (x < 46) continue;
      const y = midiToY(pt.midi);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    if (state.currentMidiFloat !== null) {
      const curY = midiToY(state.currentMidiFloat);
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(playheadX, curY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

// ==========================================
// 📊 成長記録ステージ (Records Stage) の描画
// ==========================================
function renderRecordsStage() {
  const today = getTodayStr();
  const todayData = records.dailyStats[today] || { count: 0 };

  // 1. デイリーミッション進捗
  const pct = Math.min(100, Math.round((todayData.count / 3) * 100));
  els.missionProgressBar.style.width = `${pct}%`;
  if (todayData.count >= 3) {
    els.missionStatusText.textContent = `🎉 今日は ${todayData.count} 回トレーニングしました！本日の目標達成です！`;
    els.dailyStampBox.textContent = "💮 達成済";
    els.dailyStampBox.classList.add("cleared");
  } else {
    els.missionStatusText.textContent = `あと ${3 - todayData.count} 回トレーニングすると今日の達成スタンプが押されます！`;
    els.dailyStampBox.textContent = `${todayData.count} / 3 回`;
    els.dailyStampBox.classList.remove("cleared");
  }

  // 2. 4枚サマリーカード
  const totalCount = Object.values(records.dailyStats).reduce((acc, d) => acc + d.count, 0);
  els.ovTotalSessions.textContent = `${totalCount}回`;

  if (records.history.length > 0) {
    const recent10 = records.history.slice(0, 10);
    const avg = Math.round(recent10.reduce((a, b) => a + b.score, 0) / recent10.length);
    els.ovAvgScore.textContent = `${avg}%`;
  } else {
    els.ovAvgScore.textContent = "--%";
  }

  els.ovMaxClearedNote.textContent =
    records.maxScaleClearedMidi !== null
      ? midiToNoteName(records.maxScaleClearedMidi)
      : "未クリア";

  const lowB = records.totalLowBias || 0;
  const highB = records.totalHighBias || 0;
  if (lowB + highB < 20) {
    els.ovPitchTendency.textContent = "データ収集中";
  } else if (lowB > highB * 1.4) {
    els.ovPitchTendency.textContent = "低め(♭)になりやすい";
  } else if (highB > lowB * 1.4) {
    els.ovPitchTendency.textContent = "高め(♯)に上ずりやすい";
  } else {
    els.ovPitchTendency.textContent = "🎯 バランス良好";
  }

  // 3. 日別推移グラフ描画
  drawGrowthChart();

  // 4. 音域別の得意・苦手マップ描画
  const noteKeys = Object.keys(records.noteStats)
    .map((k) => parseInt(k, 10))
    .filter((k) => records.noteStats[k].total >= 15)
    .sort((a, b) => a - b);

  if (noteKeys.length === 0) {
    els.noteHeatmapContainer.innerHTML = `<p class="empty-hint">トレーニングを行うと、音の高さごとの命中率がここに表示されます。</p>`;
  } else {
    els.noteHeatmapContainer.innerHTML = noteKeys
      .map((midi) => {
        const st = records.noteStats[midi];
        const rate = Math.round((st.hits / st.total) * 100);
        let color = "#f87171";
        if (rate >= 75) color = "#4ade80";
        else if (rate >= 45) color = "#fbbf24";

        return `
          <div class="note-pill">
            <div class="note-pill-top">
              <span>${midiToNoteName(midi)}</span>
              <span style="color:${color}">${rate}%</span>
            </div>
            <div class="note-mini-bar">
              <div class="note-mini-fill" style="width:${rate}%; background:${color}"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 5. 直近履歴リスト描画
  if (records.history.length === 0) {
    els.historyListContainer.innerHTML = `<p class="empty-hint">まだ履歴がありません。「音程キープ」や「音階トレ」をやってみましょう！</p>`;
  } else {
    els.historyListContainer.innerHTML = records.history
      .slice(0, 15)
      .map((item) => {
        const scoreColor =
          item.score >= 80 ? "#4ade80" : item.score >= 50 ? "#fbbf24" : "#f87171";
        return `
          <div class="history-item">
            <div class="history-left">
              <span class="history-time">${item.timeStr} ・ ${item.modeLabel}</span>
              <span class="history-title">${item.detail}</span>
            </div>
            <div class="history-right">
              <span class="history-tendency">${item.tendency}</span>
              <span class="history-score" style="color:${scoreColor}">${item.score}%</span>
            </div>
          </div>
        `;
      })
      .join("");
  }
}

function drawGrowthChart() {
  const c = els.growthChartCanvas;
  const rect = c.parentElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  c.width = rect.width * window.devicePixelRatio;
  c.height = rect.height * window.devicePixelRatio;
  const gctx = c.getContext("2d");
  gctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

  const w = rect.width;
  const h = rect.height;
  gctx.clearRect(0, 0, w, h);

  const dates = Object.keys(records.dailyStats).sort().slice(-10);
  if (dates.length === 0) {
    gctx.fillStyle = "#94a3b8";
    gctx.font = "13px sans-serif";
    gctx.textAlign = "center";
    gctx.fillText("まだ日別の練習データがありません。1回練習するとグラフが表示されます！", w / 2, h / 2);
    return;
  }

  const padL = 38;
  const padR = 20;
  const padT = 22;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // 背景グリッド (0%, 50%, 100%)
  gctx.font = "11px sans-serif";
  gctx.textAlign = "right";
  [0, 50, 80, 100].forEach((val) => {
    const y = padT + plotH - (val / 100) * plotH;
    gctx.strokeStyle = val === 80 ? "rgba(74, 222, 128, 0.25)" : "rgba(255,255,255,0.08)";
    gctx.beginPath();
    gctx.moveTo(padL, y);
    gctx.lineTo(w - padR, y);
    gctx.stroke();

    gctx.fillStyle = "#94a3b8";
    gctx.fillText(`${val}%`, padL - 6, y + 4);
  });

  const getX = (idx) => {
    if (dates.length === 1) return padL + plotW / 2;
    return padL + (idx / (dates.length - 1)) * plotW;
  };

  // 平均スコア線 (水色) & 最高スコア線 (緑)
  const avgPoints = dates.map((d, i) => {
    const st = records.dailyStats[d];
    const avg = Math.round(st.totalScore / Math.max(1, st.count));
    return { x: getX(i), y: padT + plotH - (avg / 100) * plotH, val: avg, date: d.slice(5) };
  });

  const maxPoints = dates.map((d, i) => {
    const st = records.dailyStats[d];
    return { x: getX(i), y: padT + plotH - (st.maxScore / 100) * plotH, val: st.maxScore };
  });

  // 最高スコア折れ線
  gctx.strokeStyle = "#4ade80";
  gctx.lineWidth = 2;
  gctx.beginPath();
  maxPoints.forEach((pt, i) => (i === 0 ? gctx.moveTo(pt.x, pt.y) : gctx.lineTo(pt.x, pt.y)));
  gctx.stroke();

  // 平均スコア折れ線
  gctx.strokeStyle = "#38bdf8";
  gctx.lineWidth = 3;
  gctx.beginPath();
  avgPoints.forEach((pt, i) => (i === 0 ? gctx.moveTo(pt.x, pt.y) : gctx.lineTo(pt.x, pt.y)));
  gctx.stroke();

  // ドットと日付ラベル
  gctx.textAlign = "center";
  avgPoints.forEach((pt, i) => {
    gctx.fillStyle = "#38bdf8";
    gctx.beginPath();
    gctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
    gctx.fill();

    gctx.fillStyle = "#e2e8f0";
    gctx.font = "bold 11px sans-serif";
    gctx.fillText(`${pt.val}%`, pt.x, pt.y - 8);

    gctx.fillStyle = "#94a3b8";
    gctx.font = "11px sans-serif";
    gctx.fillText(pt.date, pt.x, h - 8);

    const mpt = maxPoints[i];
    gctx.fillStyle = "#4ade80";
    gctx.beginPath();
    gctx.arc(mpt.x, mpt.y, 3.5, 0, Math.PI * 2);
    gctx.fill();
  });
}

// ==========================================
// UIイベント＆表示更新
// ==========================================
function updateTargetUI() {
  els.ltCurrentNoteLabel.textContent = midiToNoteName(state.longtoneMidi);
  els.scaleKeyLabel.textContent = `${midiToNoteName(state.scaleBaseMidi)} から開始`;

  const sign = state.songKeyOffset > 0 ? `+${state.songKeyOffset}` : state.songKeyOffset;
  els.songKeyOffsetLabel.textContent =
    state.songKeyOffset === 0 ? "原曲キー (±0)" : `キー (${sign})`;
  els.songTempoLabel.textContent = `${Math.round(state.songTempoRate * 100)}%`;

  const target = getCurrentTargetMidi();
  if (target !== null) {
    els.targetNoteDisplay.textContent = midiToNoteName(target);
    els.targetFreqDisplay.textContent = `${midiToFreq(target).toFixed(1)} Hz`;
  } else {
    els.targetNoteDisplay.textContent = "自由発声";
    els.targetFreqDisplay.textContent = "最低〜最高音を測定";
  }
}

function setCoachMessage(msg) {
  els.coachText.textContent = msg;
}

function setupEventListeners() {
  // モード切り替えタブ
  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.isTraining) stopTraining(false);
      els.tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;

      if (state.mode === "records") {
        els.practiceStage.classList.add("hidden");
        els.recordsStage.classList.remove("hidden");
        renderRecordsStage();
        return;
      }

      els.recordsStage.classList.add("hidden");
      els.practiceStage.classList.remove("hidden");
      resizeCanvas();

      els.modeSettings.forEach((panel) => panel.classList.remove("active"));
      const activePanel = document.getElementById(`settings-${state.mode}`);
      if (activePanel) activePanel.classList.add("active");

      updateTargetUI();

      if (state.mode === "longtone") {
        setCoachMessage("【1. 音程キープ】まずは「お手本を聴く」を押して音を覚え、「トレーニング開始」で3.5秒間同じ高さをキープしましょう！");
      } else if (state.mode === "scale") {
        setCoachMessage("【2. 音階トレ】階段を上り下りするように声を出し、クリアすると自動で半音ずつ上がって音域が広がります！");
      } else if (state.mode === "song") {
        setCoachMessage("【3. 曲フレーズ】歌いやすいキーやテンポに調整して、カラオケ採点バーのようにメロディをなぞってみましょう！");
      } else if (state.mode === "range") {
        setCoachMessage("【音域測定】マイクONの状態で、出せる一番低い「あー」と一番高い「あー」を出してみてください。自動で記録されます！");
      }
    });
  });

  els.micToggleBtn.addEventListener("click", toggleMic);

  els.playRefBtn.addEventListener("click", () => {
    if (state.mode === "longtone") {
      playReferenceTone(state.longtoneMidi, 1.4, 0, 0.3);
      setCoachMessage(`🎹 ${midiToNoteName(state.longtoneMidi)} のお手本音を鳴らしました。耳で聴いた音を頭の中でイメージしてから声を出してみましょう！`);
    } else if (state.mode === "scale" || state.mode === "song") {
      const { segments } = buildTrainingSegments();
      segments.slice(0, 6).forEach((seg) => {
        playReferenceTone(seg.midi, seg.endSec - seg.startSec, seg.startSec - 0.6, 0.25);
      });
      setCoachMessage("🎹 お手本フレーズを再生中です。まずは聴いてメロディの流れを掴みましょう！");
    } else {
      playReferenceTone(57, 1.0, 0, 0.25);
    }
  });

  els.startTrainingBtn.addEventListener("click", startTraining);

  // ロングトーン設定
  els.ltNoteDown.addEventListener("click", () => {
    state.longtoneMidi = Math.max(40, state.longtoneMidi - 1);
    updateTargetUI();
    playReferenceTone(state.longtoneMidi, 0.6, 0, 0.2);
  });
  els.ltNoteUp.addEventListener("click", () => {
    state.longtoneMidi = Math.min(79, state.longtoneMidi + 1);
    updateTargetUI();
    playReferenceTone(state.longtoneMidi, 0.6, 0, 0.2);
  });

  els.presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      els.presetChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const midi = parseInt(chip.dataset.baseMidi, 10);
      state.longtoneMidi = midi;
      state.scaleBaseMidi = midi;
      updateTargetUI();
      playReferenceTone(midi, 0.7, 0, 0.2);
    });
  });

  // スケール設定
  els.scalePatternSelect.addEventListener("change", (e) => {
    state.scalePattern = e.target.value;
  });
  els.scaleKeyDown.addEventListener("click", () => {
    state.scaleBaseMidi = Math.max(40, state.scaleBaseMidi - 1);
    updateTargetUI();
    playReferenceTone(state.scaleBaseMidi, 0.5, 0, 0.2);
  });
  els.scaleKeyUp.addEventListener("click", () => {
    state.scaleBaseMidi = Math.min(76, state.scaleBaseMidi + 1);
    updateTargetUI();
    playReferenceTone(state.scaleBaseMidi, 0.5, 0, 0.2);
  });

  // 曲フレーズ設定
  els.songSelect.addEventListener("change", (e) => {
    state.selectedSongKey = e.target.value;
    updateTargetUI();
  });
  els.songKeyDown.addEventListener("click", () => {
    state.songKeyOffset = Math.max(-12, state.songKeyOffset - 1);
    updateTargetUI();
  });
  els.songKeyUp.addEventListener("click", () => {
    state.songKeyOffset = Math.min(12, state.songKeyOffset + 1);
    updateTargetUI();
  });
  els.songTempoDown.addEventListener("click", () => {
    state.songTempoRate = Math.max(0.6, +(state.songTempoRate - 0.1).toFixed(1));
    updateTargetUI();
  });
  els.songTempoUp.addEventListener("click", () => {
    state.songTempoRate = Math.min(1.4, +(state.songTempoRate + 0.1).toFixed(1));
    updateTargetUI();
  });

  els.audioFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (state.customAudioUrl) URL.revokeObjectURL(state.customAudioUrl);
    state.customAudioUrl = URL.createObjectURL(file);
    state.customAudioElement = new Audio(state.customAudioUrl);
    els.audioFileName.textContent = `🎵 ${file.name}`;
    setCoachMessage(`「${file.name}」を読み込みました！トレーニング開始を押すとこの曲も一緒に再生されます。`);
  });

  // 音域測定リセット・自動反映
  els.resetRangeBtn.addEventListener("click", () => {
    records.measuredMinMidi = null;
    records.measuredMaxMidi = null;
    saveRecords();
    updateRangeDisplay();
    setCoachMessage("音域データをリセットしました。低い声と高い声を出してもう一度測ってみましょう！");
  });

  els.applyRangeBtn.addEventListener("click", () => {
    if (records.measuredMinMidi !== null && records.measuredMaxMidi !== null) {
      const comfortableMidi = Math.round(
        records.measuredMinMidi + (records.measuredMaxMidi - records.measuredMinMidi) * 0.4
      );
      state.longtoneMidi = comfortableMidi;
      state.scaleBaseMidi = comfortableMidi;
      state.songKeyOffset = comfortableMidi - 57;
      updateTargetUI();
      setCoachMessage(
        `✨ あなたの音域に合わせて、一番出しやすい基準音を ${midiToNoteName(comfortableMidi)} に自動調整しました！`
      );
    }
  });

  // バックアップ書き出し・読み込み・初期化
  els.exportDataBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voiceup_records_${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  els.importDataInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        records = { ...createDefaultRecords(), ...imported };
        saveRecords();
        updateHeaderBadges();
        updateRangeDisplay();
        renderRecordsStage();
        alert("記録データを読み込みました！");
      } catch (err) {
        alert("JSONファイルの形式が正しくありません。");
      }
    };
    reader.readAsText(file);
  });

  els.clearAllDataBtn.addEventListener("click", () => {
    if (confirm("本当にこれまでのトレーニング記録をすべて初期化しますか？")) {
      records = createDefaultRecords();
      saveRecords();
      updateHeaderBadges();
      updateRangeDisplay();
      renderRecordsStage();
    }
  });
}

// 起動
initApp();
