// GitHub の非公開リポジトリに日記を保存・読み込みする共通の処理
// 日記は entries/2026.json のように「年ごとに1ファイル」で保存する
// （GitHub API は 1MB を超えるファイルを普通には読めないため、1ファイルに全部入れない）

(function (global) {
  const API = "https://api.github.com";
  const MAX_TRY = 3;

  // 画面に出すエラーの種類を code で見分けられるようにする
  class DiaryStorageError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // 日本語や絵文字を壊さずに base64（GitHub API が求める形式）へ変換する
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  function fromBase64(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function yearOf(entry) {
    return entry.date.slice(0, 4);
  }

  function createStorage({ owner, repo, token, fetchFn }) {
    const doFetch = fetchFn || global.fetch.bind(global);
    const repoUrl = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    let privateChecked = false;

    async function request(method, url, body) {
      let res;
      try {
        res = await doFetch(url, {
          method,
          // ブラウザの一時保存を使うと古い内容で上書きしてしまうため、毎回取り直す
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new DiaryStorageError("network", "通信できませんでした。電波の状態を確認してください。");
      }
      if (res.status === 401) {
        throw new DiaryStorageError("unauthorized", "合鍵（トークン）が無効か期限切れです。入れ直してください。");
      }
      return res;
    }

    // 保存先が非公開でなければ、日記を一切読み書きしない（日記の流出を防ぐ最重要チェック）
    async function checkPrivate() {
      if (privateChecked) return;
      const res = await request("GET", repoUrl);
      if (res.status === 404) {
        throw new DiaryStorageError("not-found", "リポジトリが見つかりません。名前と合鍵の設定を確認してください。");
      }
      if (!res.ok) {
        throw new DiaryStorageError("other", `GitHub との通信でエラーが起きました（${res.status}）。`);
      }
      const info = await res.json();
      if (info.private !== true) {
        throw new DiaryStorageError("public-repo", "保存先が公開リポジトリです。日記が誰でも読めてしまうため保存しません。");
      }
      privateChecked = true;
    }

    // 1年分のファイルを読む。まだ無ければ空として扱う
    async function readYear(year) {
      const res = await request("GET", `${repoUrl}/contents/entries/${year}.json`);
      if (res.status === 404) {
        return { entries: [], sha: null };
      }
      if (!res.ok) {
        throw new DiaryStorageError("other", `日記の読み込みに失敗しました（${res.status}）。`);
      }
      const file = await res.json();
      return { entries: JSON.parse(fromBase64(file.content)), sha: file.sha };
    }

    // 「最新を読む → 変更を当てる → 書き込む」。
    // 他の端末が先に書き込んでいたら（409/422）、読み直してやり直す
    async function updateYear(year, change, message) {
      await checkPrivate();
      for (let i = 0; i < MAX_TRY; i++) {
        const { entries, sha } = await readYear(year);
        const next = change(entries);
        if (next === null) return; // 変更なし（書き込まない）
        const body = { message, content: toBase64(JSON.stringify(next, null, 2)) };
        if (sha) body.sha = sha;
        const res = await request("PUT", `${repoUrl}/contents/entries/${year}.json`, body);
        if (res.ok) return;
        if (res.status !== 409 && res.status !== 422) {
          throw new DiaryStorageError("other", `日記の保存に失敗しました（${res.status}）。`);
        }
      }
      throw new DiaryStorageError("conflict", "ほかの端末と同時に保存したため失敗しました。もう一度試してください。");
    }

    async function loadAll() {
      await checkPrivate();
      const res = await request("GET", `${repoUrl}/contents/entries`);
      if (res.status === 404) return [];
      if (!res.ok) {
        throw new DiaryStorageError("other", `日記の読み込みに失敗しました（${res.status}）。`);
      }
      const files = await res.json();
      const years = files
        .map((f) => f.name.match(/^(\d{4})\.json$/))
        .filter(Boolean)
        .map((m) => m[1]);
      const all = [];
      for (const year of years) {
        const { entries } = await readYear(year);
        all.push(...entries);
      }
      return all;
    }

    // コミットメッセージには日記の本文を入れない（履歴一覧に本文が並ばないように）
    function addEntry(entry) {
      return updateYear(yearOf(entry), (list) => [entry, ...list], "日記を追加");
    }

    function removeEntry(entry) {
      return updateYear(
        yearOf(entry),
        (list) => list.filter((e) => e.id !== entry.id),
        "日記を削除"
      );
    }

    // CSV などから日記をまとめて取り込む。
    // 同じ日付・同じ内容の日記がすでにあれば飛ばす（2回取り込んでも重複しない）。取り込んだ件数を返す
    async function importEntries(newEntries) {
      const byYear = new Map();
      newEntries.forEach((e) => {
        if (!byYear.has(yearOf(e))) byYear.set(yearOf(e), []);
        byYear.get(yearOf(e)).push(e);
      });

      let added = 0;
      for (const [year, list] of byYear) {
        let addedThisYear = 0;
        await updateYear(
          year,
          (current) => {
            const seen = new Set(current.map((e) => `${e.date}\n${e.text}`));
            const fresh = list.filter((e) => {
              const key = `${e.date}\n${e.text}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            addedThisYear = fresh.length;
            return fresh.length ? [...fresh, ...current] : null;
          },
          "CSVから日記を取り込み"
        );
        added += addedThisYear;
      }
      return added;
    }

    return { checkPrivate, loadAll, addEntry, removeEntry, importEntries };
  }

  const DiaryStorage = { createStorage, DiaryStorageError, toBase64, fromBase64 };

  // ブラウザでは window.DiaryStorage、テスト（Node.js）では require で使えるようにする
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DiaryStorage;
  } else {
    global.DiaryStorage = DiaryStorage;
  }
})(typeof window !== "undefined" ? window : globalThis);
