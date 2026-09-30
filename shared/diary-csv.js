// 日記と CSV ファイルの変換（書き出し・取り込み）
// 形式は古い日記アプリの「バックアップを書き出す(CSV)」と同じ：
//   1行目が見出し「日付,内容」、日付は 2026/9/30 の形、
//   改行・カンマ・" を含む内容は "..." で囲み、中の " は "" にする

(function (global) {
  function escapeCsvField(field) {
    const str = String(field);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // 「2026-09-30」を「2026/9/30」にする（古いアプリの CSV と同じ形。時差の影響を受けないよう文字から直接作る）
  function toSlashDate(isoDate) {
    const [y, m, d] = isoDate.split("-");
    return `${y}/${Number(m)}/${Number(d)}`;
  }

  // 日付の新しい順に並べて CSV の文字列を作る（Excel で文字化けしないよう先頭に BOM を付ける）
  function buildCsv(entries) {
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
    const rows = [["日付", "内容"]];
    sorted.forEach((entry) => {
      rows.push([toSlashDate(entry.date), entry.text]);
    });
    return "﻿" + rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
  }

  // CSV の文字列を「行の配列（各行はマスの配列）」に分ける
  // "..." の中の改行やカンマは区切りとして扱わない
  function parseCsv(text) {
    const src = text.replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"' && src[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // 「2026/9/30」や「2026-09-30」を「2026-09-30」にそろえる。読めなければ null
  function toIsoDate(str) {
    const m = String(str).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  // CSV から日記の一覧を作る。日付が読めない行・内容が空の行は数えて飛ばす
  function csvToEntries(text, makeId) {
    const rows = parseCsv(text);
    if (rows.length > 0 && rows[0][0] === "日付") rows.shift();

    const entries = [];
    let skipped = 0;
    rows.forEach((row) => {
      if (row.length === 1 && row[0].trim() === "") return; // 空行
      const date = toIsoDate(row[0]);
      const text = (row[1] || "").trim();
      if (!date || text === "") {
        skipped++;
        return;
      }
      entries.push({ id: makeId(), date, text });
    });
    return { entries, skipped };
  }

  const DiaryCsv = { escapeCsvField, buildCsv, parseCsv, toIsoDate, csvToEntries };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DiaryCsv;
  } else {
    global.DiaryCsv = DiaryCsv;
  }
})(typeof window !== "undefined" ? window : globalThis);
