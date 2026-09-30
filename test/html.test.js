// 画面（index.html）の組み立てのテスト
//   使い方: node test/html.test.js
// 共通ファイルの読み込み忘れや、script.js が使う部品の書き忘れを見つけます。

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");
const apps = ["diary-app", "diary-app-cute"];

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

apps.forEach((app) => {
  const html = fs.readFileSync(path.join(APP_DIR, app, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(APP_DIR, app, "script.js"), "utf8");

  test(`${app}: 共通ファイルを script.js より先に読み込んでいる`, () => {
    const storageAt = html.indexOf('src="../shared/github-storage.js');
    const csvAt = html.indexOf('src="../shared/diary-csv.js');
    const scriptAt = html.indexOf('src="script.js');
    assert.ok(storageAt >= 0, "github-storage.js を読み込んでいません");
    assert.ok(csvAt >= 0, "diary-csv.js を読み込んでいません");
    assert.ok(storageAt < scriptAt && csvAt < scriptAt, "script.js より後に読み込んでいます");
  });

  test(`${app}: script.js が使う部品（id）がすべて画面にある`, () => {
    const ids = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
    const missing = ids.filter((id) => !html.includes(`id="${id}"`));
    assert.deepStrictEqual(missing, [], `画面にない部品: ${missing.join(", ")}`);
  });

  test(`${app}: 合鍵の入力欄は伏せ字（password）になっている`, () => {
    assert.match(html, /<input type="password" id="setting-token"/);
  });

  test(`${app}: 合鍵らしき文字列がコードに書かれていない`, () => {
    assert.ok(!/github_pat_[A-Za-z0-9_]{20,}/.test(html + js), "合鍵が書かれています");
  });

  test(`${app}: 通信先は GitHub の窓口だけに制限されている（CSP）`, () => {
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(csp, "CSP がありません");
    const connect = csp[1].split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"));
    assert.strictEqual(connect, "connect-src https://api.github.com");
    assert.match(csp[1], /script-src 'self';/, "外部のプログラムを読み込める状態です");
  });

  test(`${app}: ホーム画面用の設定とアイコンがそろっている`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, app, "manifest.json"), "utf8"));
    assert.match(html, /<link rel="manifest" href="manifest.json">/);
    assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon.png">/);
    const icons = [...manifest.icons.map((i) => [i.src, i.sizes]), ["apple-touch-icon.png", "180x180"]];
    icons.forEach(([src, sizes]) => {
      const png = fs.readFileSync(path.join(APP_DIR, app, src));
      const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`; // PNG の幅・高さ
      assert.strictEqual(size, sizes, `${src} の大きさが違います`);
    });
  });

  test(`${app}: テーマ色が HTML と manifest.json で一致している`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, app, "manifest.json"), "utf8"));
    const meta = html.match(/<meta name="theme-color" content="([^"]+)">/)[1];
    assert.strictEqual(manifest.theme_color, meta);
    assert.strictEqual(manifest.background_color, meta);
  });

  test(`${app}: キャッシュ対策の ?v= 番号と画面の版番号がすべて一致している`, () => {
    const marks = [...html.matchAll(/\?v=(\d+)"/g)].map((m) => m[1]);
    assert.strictEqual(marks.length, 4, "?v= の付け忘れがあります（CSS 1つ・JS 3つ）");
    const label = html.match(/<p class="version">ver (\d+)<\/p>/)[1];
    assert.deepStrictEqual([...new Set(marks)], [label]);
  });
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
