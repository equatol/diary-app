// GitHub 保存処理のテスト
//   使い方: node test/storage.test.js
// 本物の GitHub には接続せず、「偽物の GitHub」を用意して、
// アプリ本体の shared/github-storage.js をそのまま動かして確認します。

const assert = require("assert");
const DiaryStorage = require("../shared/github-storage.js");

// ---- 偽物の GitHub ------------------------------------------------------
// ファイルの中身と sha（版番号）を覚えておき、本物と同じように
// 「古い sha で書き込もうとしたら 409 を返す」動きをする
function createFakeGitHub({ isPrivate = true, validToken = "good-token" } = {}) {
  const files = new Map(); // "entries/2026.json" -> { content(base64), sha }
  let shaCounter = 0;
  const log = [];
  let beforePut = null; // テストで「書き込み直前に他の端末が割り込む」を再現する用

  function reply(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }

  async function fetchFn(url, options) {
    const method = options.method;
    log.push(`${method} ${url}`);
    if (options.headers.Authorization !== `Bearer ${validToken}`) {
      return reply(401, {});
    }
    const path = url.replace("https://api.github.com/repos/equatol/diary-data", "");

    if (path === "") {
      return reply(200, { private: isPrivate });
    }
    if (path === "/contents/entries" && method === "GET") {
      const names = [...files.keys()].map((k) => ({ name: k.replace("entries/", "") }));
      return names.length ? reply(200, names) : reply(404, {});
    }
    const key = path.replace("/contents/", "");
    if (method === "GET") {
      const f = files.get(key);
      return f ? reply(200, { content: f.content, sha: f.sha }) : reply(404, {});
    }
    if (method === "PUT") {
      if (beforePut) {
        const fn = beforePut;
        beforePut = null;
        fn();
      }
      const body = JSON.parse(options.body);
      const current = files.get(key);
      if (current && body.sha !== current.sha) return reply(409, {});
      if (!current && body.sha) return reply(409, {});
      files.set(key, { content: body.content, sha: `sha-${++shaCounter}` });
      return reply(200, {});
    }
    return reply(500, {});
  }

  return {
    fetchFn,
    log,
    files,
    readJson(key) {
      return JSON.parse(DiaryStorage.fromBase64(files.get(key).content));
    },
    writeJson(key, data) {
      files.set(key, {
        content: DiaryStorage.toBase64(JSON.stringify(data)),
        sha: `sha-${++shaCounter}`,
      });
    },
    interruptNextPut(fn) {
      beforePut = fn;
    },
  };
}

function makeStorage(fake, token = "good-token") {
  return DiaryStorage.createStorage({ owner: "equatol", repo: "diary-data", token, fetchFn: fake.fetchFn });
}

async function expectError(promise, code) {
  try {
    await promise;
  } catch (e) {
    assert.strictEqual(e.code, code, `エラーの種類が違います: ${e.code}`);
    return;
  }
  assert.fail(`エラー「${code}」になるはずが、成功してしまいました`);
}

// ---- テスト本体 ---------------------------------------------------------
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("日本語・絵文字・改行が変換後も元に戻る", () => {
  const text = "今日は晴れ☀️🐣\n「楽しかった」, \"よかった\"";
  assert.strictEqual(DiaryStorage.fromBase64(DiaryStorage.toBase64(text)), text);
});

test("保存した日記を読み込める（年ごとのファイルに入る）", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  await storage.addEntry({ id: "a", date: "2025-12-31", text: "大みそか" });
  await storage.addEntry({ id: "b", date: "2026-01-01", text: "元日" });

  assert.deepStrictEqual(fake.readJson("entries/2025.json").map((e) => e.id), ["a"]);
  assert.deepStrictEqual(fake.readJson("entries/2026.json").map((e) => e.id), ["b"]);

  const all = await storage.loadAll();
  assert.deepStrictEqual(all.map((e) => e.text).sort(), ["元日", "大みそか"].sort());
});

test("日記がまだ1つも無いときは空で読み込める", async () => {
  const storage = makeStorage(createFakeGitHub());
  assert.deepStrictEqual(await storage.loadAll(), []);
});

test("削除した日記だけが消える", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  const a = { id: "a", date: "2026-09-01", text: "A" };
  const b = { id: "b", date: "2026-09-02", text: "B" };
  await storage.addEntry(a);
  await storage.addEntry(b);
  await storage.removeEntry(a);
  assert.deepStrictEqual(fake.readJson("entries/2026.json").map((e) => e.id), ["b"]);
});

test("公開リポジトリには一切書き込まない", async () => {
  const fake = createFakeGitHub({ isPrivate: false });
  const storage = makeStorage(fake);
  await expectError(storage.addEntry({ id: "a", date: "2026-09-01", text: "秘密" }), "public-repo");
  await expectError(storage.loadAll(), "public-repo");
  assert.strictEqual(fake.files.size, 0, "ファイルが作られてしまいました");
  assert.ok(!fake.log.some((l) => l.startsWith("PUT")), "書き込みが送られてしまいました");
});

test("合鍵が違うと unauthorized エラーになる", async () => {
  const storage = makeStorage(createFakeGitHub(), "wrong-token");
  await expectError(storage.loadAll(), "unauthorized");
});

test("通信できないと network エラーになる", async () => {
  const storage = DiaryStorage.createStorage({
    owner: "equatol",
    repo: "diary-data",
    token: "good-token",
    fetchFn: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await expectError(storage.loadAll(), "network");
});

test("他の端末と同時に保存しても、両方の日記が残る（409 でやり直す）", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  await storage.addEntry({ id: "phone", date: "2026-09-01", text: "スマホで書いた" });

  // 自分が書き込む直前に、PC が別の日記を書き込んだことにする
  fake.interruptNextPut(() => {
    const list = fake.readJson("entries/2026.json");
    fake.writeJson("entries/2026.json", [{ id: "pc", date: "2026-09-01", text: "PCで書いた" }, ...list]);
  });
  await storage.addEntry({ id: "me", date: "2026-09-02", text: "今書いた" });

  const ids = fake.readJson("entries/2026.json").map((e) => e.id).sort();
  assert.deepStrictEqual(ids, ["me", "pc", "phone"]);
});

test("削除中に他の端末が保存しても、削除した日記は復活しない", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  const old = { id: "old", date: "2026-09-01", text: "消したい" };
  await storage.addEntry(old);

  fake.interruptNextPut(() => {
    const list = fake.readJson("entries/2026.json");
    fake.writeJson("entries/2026.json", [{ id: "pc", date: "2026-09-03", text: "PCで書いた" }, ...list]);
  });
  await storage.removeEntry(old);

  const ids = fake.readJson("entries/2026.json").map((e) => e.id);
  assert.deepStrictEqual(ids, ["pc"]);
});

test("コミットメッセージに日記の本文が入らない", async () => {
  let message = "";
  const fake = createFakeGitHub();
  const storage = DiaryStorage.createStorage({
    owner: "equatol",
    repo: "diary-data",
    token: "good-token",
    fetchFn: async (url, options) => {
      if (options.method === "PUT") message = JSON.parse(options.body).message;
      return fake.fetchFn(url, options);
    },
  });
  await storage.addEntry({ id: "a", date: "2026-09-01", text: "ひみつの話" });
  assert.ok(!message.includes("ひみつ"), `本文が入っています: ${message}`);
});

test("CSV取り込み：年ごとに振り分け、件数を返す", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  const added = await storage.importEntries([
    { id: "1", date: "2025-12-31", text: "去年" },
    { id: "2", date: "2026-01-01", text: "今年" },
  ]);
  assert.strictEqual(added, 2);
  assert.strictEqual(fake.readJson("entries/2025.json").length, 1);
  assert.strictEqual(fake.readJson("entries/2026.json").length, 1);
});

test("CSV取り込み：2回取り込んでも重複せず、2回目は書き込みもしない", async () => {
  const fake = createFakeGitHub();
  const storage = makeStorage(fake);
  const csvEntries = [{ id: "1", date: "2026-09-01", text: "同じ日記" }];
  await storage.importEntries(csvEntries);
  const putsBefore = fake.log.filter((l) => l.startsWith("PUT")).length;

  const added = await storage.importEntries([{ id: "別のid", date: "2026-09-01", text: "同じ日記" }]);
  assert.strictEqual(added, 0);
  assert.strictEqual(fake.readJson("entries/2026.json").length, 1);
  assert.strictEqual(fake.log.filter((l) => l.startsWith("PUT")).length, putsBefore);
});

test("CSV取り込み：公開リポジトリには書き込まない", async () => {
  const fake = createFakeGitHub({ isPrivate: false });
  const storage = makeStorage(fake);
  await expectError(storage.importEntries([{ id: "1", date: "2026-09-01", text: "秘密" }]), "public-repo");
  assert.strictEqual(fake.files.size, 0);
});

// ---- 実行 ---------------------------------------------------------------
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
