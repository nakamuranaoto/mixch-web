/**
 * Mixch 特典履行CSV生成 - Netlify Function
 *
 * POST /api/analyze-event
 * Body: { "url": "https://mixch.tv/live/event/XXXXX" }
 *
 * 必要な環境変数:
 *   ANTHROPIC_API_KEY  ... Anthropic APIキー
 *   ALLOWED_ORIGIN     ... フロントエンドのURL（例: https://your-site.netlify.app）省略時は*
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

async function fetchWithUA(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/json,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractEventId(url) {
  const m = url.match(/\/event\/(\d+)/);
  if (!m) throw new Error("URLからイベントIDを取得できません");
  return m[1];
}

function extractThresholds(text) {
  const vals = new Set();
  for (const m of text.matchAll(/(\d+)\s*万\s*(?:ポイント|[pP][tT])/g)) {
    vals.add(parseInt(m[1]) * 10000);
  }
  return [...vals].sort((a, b) => a - b);
}

// ─────────────────────────────────────────────
// Claude API呼び出し
// ─────────────────────────────────────────────

async function analyzeWithClaude(title, thresholds, detailHtml) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません");
  }

  // HTMLからテキストを大まかに抽出（Claude送信量を減らす）
  const detailText = detailHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000); // 4000文字に制限

  const thresholdStr =
    thresholds.length > 0
      ? thresholds.map((t) => `${t / 10000}万pt`).join(", ")
      : "閾値なし";

  const prompt = `あなたはミクチャ（Mixch）オーディションイベントの特典管理の専門家です。
以下のイベント情報を解析して、履行管理CSVの構造をJSONで返してください。

## イベントタイトル
${title}

## 検出された閾値
${thresholdStr}

## 特典ページテキスト
${detailText}

## 返してほしいJSON形式
{
  "event_type": "photo または music または cosmetics または general",
  "event_type_reason": "なぜこの種別と判定したか（1〜2文）",
  "management_columns": ["管理列名1", "管理列名2", ...],
  "prize_rows": [
    {
      "condition": "1位 または 達成特典XX万pt または ―",
      "description": "特典の内容説明",
      "notes": "備考があれば"
    }
  ],
  "special_notes": "イレギュラーな特典や注意事項があれば記載"
}

## 判定の基準
- photo: 撮影、宣材、ロケ、ポスター、MV出演、フォトブックなど撮影関連
- music: 楽曲制作、楽曲提供、レコーディング、作曲など音楽制作関連
- cosmetics: コスメ、美容、スキンケア、物品発送など物販関連
- general: 上記に当てはまらない汎用特典

## management_columnsの例
- photo系: ["特典区分", "主要特典内容", "ヘアメイク", "交通費上限", "衣装費上限", "日程調整済み", "撮影完了", "データ納品済み", "ポスター掲載対象", "ポスター完了", "備考"]
- music系: ["特典区分", "レコーディング日程調整済み", "レコーディング完了", "楽曲納品済み", "追加特典", "追加特典完了", "備考"]
- cosmetics系: ["特典内容", "特典額（相当）", "住所収集済み", "発送済み", "発送日", "備考"]
- general系: ["特典内容", "確認済み", "完了", "備考"]
- イレギュラーな場合は内容に合った列名を柔軟に設定してください

必ずJSONのみを返してください（説明文は不要）。`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API エラー: ${response.status} ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // JSONブロックを抽出
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude APIのレスポンスがJSONではありません");

  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────
// CSV行データ構築
// ─────────────────────────────────────────────

function buildRows(users, thresholds, analysis) {
  const rankLabel = (r) =>
    ({ 1: "🥇 1位", 2: "🥈 2位", 3: "🥉 3位" }[r] || `${r}位`);
  const achieved = (score, t) => (score >= t ? "✅" : "❌");
  const mgmtCols = analysis.management_columns || ["特典内容", "確認済み", "完了", "備考"];
  const prizeRows = analysis.prize_rows || [];

  return users.map((u, i) => {
    const rank = i + 1;
    const score = u.score || 0;

    // 管理列の値を決定
    let mgmtValues;
    if (rank <= prizeRows.length) {
      const pr = prizeRows[rank - 1];
      // 最初の列にcondition、2列目にdescription、残りは空
      mgmtValues = mgmtCols.map((col, ci) => {
        if (ci === 0) return pr.condition || "";
        if (ci === 1) return pr.description || "";
        if (col === "備考") return pr.notes || "";
        return "";
      });
    } else {
      mgmtValues = mgmtCols.map(() => "");
    }

    const baseRow = [rankLabel(rank), u.name || "", u.id || "", score];
    const thresholdCols = thresholds.map((t) => achieved(score, t));

    return [...baseRow, ...thresholdCols, ...mgmtValues];
  });
}

function buildCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v == null ? "" : v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const line = (arr) => arr.map(esc).join(",");
  return "﻿" + [line(headers), ...rows.map(line)].join("\r\n");
}

// ─────────────────────────────────────────────
// メインハンドラー
// ─────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = corsHeaders();

  // プリフライトリクエスト
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "POST only" }),
    };
  }

  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) throw new Error("urlが指定されていません");

    const eventId = extractEventId(url);

    // 1. Mixch API取得
    const apiRaw = await fetchWithUA(
      `https://mixch.tv/api-web/events/${eventId}`
    );
    const apiData = JSON.parse(apiRaw);

    const title = (apiData.title || `event_${eventId}`).trim();
    const pageSecret = apiData.pageSecret || "";
    const users = apiData.users || [];

    // 2. 特典ページ取得
    let detailHtml = "";
    if (pageSecret) {
      try {
        detailHtml = await fetchWithUA(`https://mixch.tv/p/${pageSecret}`);
      } catch (e) {
        console.warn("特典ページ取得失敗:", e.message);
      }
    }

    // 3. 閾値抽出
    const thresholds = extractThresholds(detailHtml);

    // 4. Claude APIで解析
    const analysis = await analyzeWithClaude(title, thresholds, detailHtml);

    // 5. CSV構築
    const baseHeaders = ["順位", "ライバー名", "ミクチャID", "ポイント"];
    const thresholdHeaders = thresholds.map((t) => `${t / 10000}万pt達成`);
    const mgmtHeaders = analysis.management_columns || ["特典内容", "確認済み", "完了", "備考"];
    const allHeaders = [...baseHeaders, ...thresholdHeaders, ...mgmtHeaders];

    const rows = buildRows(users, thresholds, analysis);
    const csv = buildCsv(allHeaders, rows);

    // ファイル名
    const safe = title.replace(/[\\/:*?"<>|\s]/g, "_").slice(0, 40);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `mixch_${eventId}_${safe}_${today}.csv`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        meta: {
          eventId,
          title,
          userCount: users.length,
          thresholds,
          eventType: analysis.event_type,
          eventTypeReason: analysis.event_type_reason,
          specialNotes: analysis.special_notes || "",
          filename,
        },
        csv,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
