// CSV 変換のテスト
//   使い方: node test/csv.test.js
// アプリ本体の shared/diary-csv.js をそのまま読み込んで確認します。

const assert = require("assert");
const DiaryCsv = require("../shared/diary-csv.js");

let idCounter = 0;
const makeId = () => `id-${++idCounter}`;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("古いアプリが書き出した形の CSV を読める", () => {
  // 古いアプリの書き出し：BOM付き・改行は \r\n・日付は 2026/9/30
  const csv = "﻿日付,内容\r\n2026/9/30,晴れ\r\n2026/9/1,くもり";
  const { entries, skipped } = DiaryCsv.csvToEntries(csv, makeId);
  assert.deepStrictEqual(
    entries.map((e) => [e.date, e.text]),
    [["2026-09-30", "晴れ"], ["2026-09-01", "くもり"]]
  );
  assert.strictEqual(skipped, 0);
  assert.ok(entries.every((e) => e.id), "id が付いていません");
});

test("改行・カンマ・\" を含む日記を正しく読める", () => {
  const csv = '日付,内容\r\n2026/9/30,"1行目\n2行目, カンマ ""引用"""';
  const { entries } = DiaryCsv.csvToEntries(csv, makeId);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].text, '1行目\n2行目, カンマ "引用"');
});

test("日付が読めない行・内容が空の行は飛ばして数える", () => {
  const csv = "日付,内容\r\nきのう,あいう\r\n2026/9/30,\r\n2026/9/29,OK\r\n";
  const { entries, skipped } = DiaryCsv.csvToEntries(csv, makeId);
  assert.deepStrictEqual(entries.map((e) => e.text), ["OK"]);
  assert.strictEqual(skipped, 2);
});

test("書き出した CSV を取り込むと元の日記に戻る", () => {
  const original = [
    { id: "a", date: "2026-09-01", text: "ふつうの日" },
    { id: "b", date: "2026-09-30", text: '改行\nあり, カンマ "引用" 🐣' },
    { id: "c", date: "2025-01-05", text: "去年" },
  ];
  const csv = DiaryCsv.buildCsv(original);
  const { entries } = DiaryCsv.csvToEntries(csv, makeId);
  const pick = (list) => list.map((e) => [e.date, e.text]).sort();
  assert.deepStrictEqual(pick(entries), pick(original));
});

test("書き出しは新しい日付順で、日付は 2026/9/1 の形", () => {
  const csv = DiaryCsv.buildCsv([
    { id: "a", date: "2026-09-01", text: "古い" },
    { id: "b", date: "2026-09-30", text: "新しい" },
  ]);
  assert.strictEqual(csv, "﻿日付,内容\r\n2026/9/30,新しい\r\n2026/9/1,古い");
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`❌ ${t.name}\n   ${e.message}`);
    }
  }
  console.log(`\n${tests.length - failed} / ${tests.length} 成功`);
  process.exit(failed ? 1 : 0);
})();
