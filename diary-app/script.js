const dateInput = document.getElementById("entry-date");
const dateLabel = document.getElementById("date-label");
const input = document.getElementById("entry-input");
const saveButton = document.getElementById("save-button");
const entryList = document.getElementById("entry-list");
const menuButton = document.getElementById("menu-button");
const monthMenu = document.getElementById("month-menu");
const exportButton = document.getElementById("export-button");
const importButton = document.getElementById("import-button");
const importFile = document.getElementById("import-file");
const statusText = document.getElementById("status-text");
const settingsButton = document.getElementById("settings-button");
const settingsPanel = document.getElementById("settings-panel");
const ownerInput = document.getElementById("setting-owner");
const repoInput = document.getElementById("setting-repo");
const tokenInput = document.getElementById("setting-token");
const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect-button");

// この端末に覚えておくもの：GitHub の設定（合鍵を含む）と、日記の控え（表示を速くするため）
const SETTINGS_KEY = "diaryGitHubSettings";
const CACHE_KEY = "diaryWebCache";

// 端末の時計（日本時間）で今日の「2026-09-30」を作る。
// toISOString や valueAsDate は世界標準時なので、日本の朝0〜9時に前の日になってしまう
function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// 「2026-09-30」を「2026/9/30」にする（時差の影響を受けないよう文字から直接作る）
function toJaDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${y}/${Number(m)}/${Number(d)}`;
}

function updateDateLabel() {
  dateLabel.textContent = toJaDate(dateInput.value || todayIso());
}

dateInput.value = todayIso();
dateInput.addEventListener("change", updateDateLabel);
dateInput.addEventListener("click", () => {
  if (typeof dateInput.showPicker === "function") {
    try {
      dateInput.showPicker();
    } catch (e) {
      // 既に開いている場合などは無視
    }
  }
});
updateDateLabel();

window.addEventListener("pageshow", () => {
  dateInput.value = todayIso();
  updateDateLabel();
});

let activeMonth = null;
let entries = [];
let storage = null; // GitHub との窓口（設定が済むまで null）
let busy = false; // 保存・削除・取り込みの途中かどうか
let localEdits = 0; // この端末で保存・削除・取り込みした回数（読み込み中に変わったら、その読み込み結果は古い）
let refreshSeq = 0; // 読み込みの通し番号（一番新しい読み込みの結果だけを画面に使う）

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (e) {
    return null;
  }
}

// 日記の一覧を入れ替えて、控えに保存し、画面を描き直す
function setEntries(list) {
  entries = list;
  localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  renderEntries();
  renderMonthMenu();
}

// GitHub から最新の日記を読み直す。成功したら true
async function refresh() {
  if (!storage) return false;
  const myTurn = ++refreshSeq;
  const editsAtStart = localEdits;
  showStatus("GitHub から読み込み中…");
  try {
    const list = await storage.loadAll();
    // あとから始まった読み込みがあれば、この結果は古いので使わない（新しいほうに任せる）
    if (myTurn !== refreshSeq) {
      return true;
    }
    // 読み込み中に保存・削除・取り込みしていたら、この結果は古いので読み直す（日記が画面から消えないように）
    if (editsAtStart !== localEdits) {
      return refresh();
    }
    setEntries(list);
    showStatus("");
    return true;
  } catch (e) {
    if (myTurn === refreshSeq) {
      showStatus(e.message, true);
    }
    return false;
  }
}

async function removeEntry(entry) {
  busy = true;
  showStatus("削除中…");
  try {
    await storage.removeEntry(entry);
    localEdits++;
    setEntries(entries.filter((e) => e.id !== entry.id));
    showStatus("削除しました");
  } catch (e) {
    showStatus(e.message, true);
  } finally {
    busy = false;
  }
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function renderMonthMenu() {
  const months = [...new Set(entries.map((entry) => getMonthKey(entry.date)))];
  months.sort((a, b) => (a < b ? 1 : -1));

  monthMenu.innerHTML = "";
  const ul = document.createElement("ul");

  const allItem = document.createElement("li");
  allItem.textContent = "すべて表示";
  allItem.className = activeMonth === null ? "active" : "";
  allItem.addEventListener("click", () => {
    activeMonth = null;
    monthMenu.classList.remove("open");
    renderEntries();
  });
  ul.appendChild(allItem);

  months.forEach((monthKey) => {
    const li = document.createElement("li");
    li.textContent = getMonthLabel(monthKey);
    li.className = activeMonth === monthKey ? "active" : "";
    li.addEventListener("click", () => {
      activeMonth = monthKey;
      monthMenu.classList.remove("open");
      renderEntries();
    });
    ul.appendChild(li);
  });

  monthMenu.appendChild(ul);
}

function groupByDate(list) {
  const groups = [];
  const groupMap = new Map();

  list.forEach((entry) => {
    if (!groupMap.has(entry.date)) {
      const group = { date: entry.date, entries: [] };
      groupMap.set(entry.date, group);
      groups.push(group);
    }
    groupMap.get(entry.date).entries.push(entry);
  });

  groups.sort((a, b) => (a.date < b.date ? 1 : -1));

  return groups;
}

function renderEntries() {
  entryList.innerHTML = "";

  const filtered = activeMonth
    ? entries.filter((entry) => getMonthKey(entry.date) === activeMonth)
    : entries;

  groupByDate(filtered).forEach((group) => {
    const dayGroup = document.createElement("div");
    dayGroup.className = "day-group";

    const heading = document.createElement("h3");
    heading.textContent = toJaDate(group.date);
    dayGroup.appendChild(heading);

    const ul = document.createElement("ul");
    group.entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "entry-item";

      const span = document.createElement("span");
      span.className = "entry-text";
      span.textContent = entry.text;
      li.appendChild(span);

      const deleteBtn = document.createElement("span");
      deleteBtn.className = "delete-button";
      deleteBtn.textContent = "×";
      deleteBtn.setAttribute("role", "button");
      deleteBtn.setAttribute("tabindex", "0");
      deleteBtn.setAttribute("aria-label", "削除");
      deleteBtn.addEventListener("click", () => {
        if (!storage) {
          showStatus("先に ⚙ から GitHub の設定をしてください", true);
          return;
        }
        deleteBtn.classList.add("confirming");
        setTimeout(() => {
          const confirmed = confirm("この日記を削除しますか？");
          deleteBtn.classList.remove("confirming");
          if (!confirmed) {
            return;
          }
          removeEntry(entry);
        }, 50);
      });
      li.appendChild(deleteBtn);

      ul.appendChild(li);
    });
    dayGroup.appendChild(ul);

    entryList.appendChild(dayGroup);
  });
}

menuButton.addEventListener("click", () => {
  monthMenu.classList.toggle("open");
});

// ---- GitHub の設定 ----------------------------------------------------

settingsButton.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

// 入力された設定で実際に接続し、非公開リポジトリだと確認できたときだけ覚える
connectButton.addEventListener("click", async () => {
  const settings = {
    owner: ownerInput.value.trim(),
    repo: repoInput.value.trim(),
    token: tokenInput.value.trim(),
  };
  if (!settings.owner || !settings.repo || !settings.token) {
    showStatus("ユーザー名・リポジトリ名・合鍵の3つを入力してください", true);
    return;
  }

  connectButton.disabled = true;
  showStatus("接続を確認中…");
  const candidate = DiaryStorage.createStorage(settings);
  try {
    await candidate.checkPrivate();
  } catch (e) {
    showStatus(e.message, true);
    connectButton.disabled = false;
    return;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  storage = candidate;
  tokenInput.value = "";
  tokenInput.placeholder = "設定済み（変えるときだけ入力）";
  settingsPanel.classList.remove("open");
  connectButton.disabled = false;
  if (await refresh()) {
    showStatus("GitHub に接続しました");
  }
});

disconnectButton.addEventListener("click", () => {
  const confirmed = confirm("この端末から合鍵と日記の控えを消しますか？\n（GitHub 上の日記は消えません）");
  if (!confirmed) {
    return;
  }
  localStorage.removeItem(SETTINGS_KEY);
  storage = null;
  setEntries([]);
  localStorage.removeItem(CACHE_KEY);
  tokenInput.placeholder = "github_pat_ で始まる合鍵を貼り付け";
  showStatus("この端末から合鍵を消しました");
});

// ---- CSV の書き出し・取り込み -----------------------------------------

exportButton.addEventListener("click", async () => {
  // GitHub 上の最新を読み直してから書き出す（読めなければこの端末の控えから）
  await refresh();

  const blob = new Blob([DiaryCsv.buildCsv(entries)], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `diary_${todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

importButton.addEventListener("click", () => {
  if (!storage) {
    showStatus("先に ⚙ から GitHub の設定をしてください", true);
    return;
  }
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = ""; // 同じファイルをもう一度選べるようにする
  if (!file) {
    return;
  }

  const { entries: found, skipped } = DiaryCsv.csvToEntries(await file.text(), makeId);
  if (found.length === 0) {
    showStatus("取り込める日記が見つかりませんでした", true);
    return;
  }
  if (!confirm(`${found.length}件の日記が見つかりました。GitHub に取り込みますか？`)) {
    return;
  }

  busy = true;
  showStatus("取り込み中…");
  try {
    const added = await storage.importEntries(found);
    localEdits++;
    await refresh();
    const notes = [];
    if (found.length - added > 0) notes.push(`取り込み済みの${found.length - added}件`);
    if (skipped > 0) notes.push(`読めなかった${skipped}行`);
    showStatus(`${added}件取り込みました` + (notes.length ? `（${notes.join("・")}は飛ばしました）` : ""));
  } catch (e) {
    showStatus(e.message, true);
  } finally {
    busy = false;
  }
});

// ---- 保存 -------------------------------------------------------------

saveButton.addEventListener("click", async () => {
  const text = input.value.trim();
  if (text === "") {
    return;
  }
  if (!storage) {
    showStatus("先に ⚙ から GitHub の設定をしてください", true);
    settingsPanel.classList.add("open");
    return;
  }

  const isoDate = dateInput.value || todayIso();
  const entry = { id: makeId(), date: isoDate, text: text };

  busy = true;
  saveButton.disabled = true;
  showStatus("保存中…");
  try {
    await storage.addEntry(entry);
    localEdits++;
    setEntries([entry, ...entries]);
    input.value = "";
    showStatus("保存しました");
  } catch (e) {
    // 失敗しても書いた文章は消さずに残す
    showStatus(e.message, true);
  } finally {
    busy = false;
    saveButton.disabled = false;
  }
});

// ---- 起動時 -----------------------------------------------------------

// まず控えをすぐ表示し、そのあと GitHub から最新を読み込む
setEntries(readJson(CACHE_KEY) || []);

const savedSettings = readJson(SETTINGS_KEY);
if (savedSettings) {
  ownerInput.value = savedSettings.owner;
  repoInput.value = savedSettings.repo;
  tokenInput.placeholder = "設定済み（変えるときだけ入力）";
  storage = DiaryStorage.createStorage(savedSettings);
  refresh();
} else {
  ownerInput.value = "equatol";
  repoInput.value = "diary-data";
  settingsPanel.classList.add("open");
  showStatus("はじめに GitHub の設定をしてください");
}

// ホーム画面のアプリに戻ってきたとき、ほかの端末で書いた日記を読み込む
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !busy) {
    refresh();
  }
});
