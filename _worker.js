// ============================================================
// Kintone予約システム - Cloudflare Workers プロキシ
// APIトークンは環境変数に保存（ブラウザからは見えない）
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS プリフライト対応
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    // /api/* のみ処理
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }

    const action = url.pathname.replace('/api/', '');

    try {
      let result;
      switch (action) {
        case 'getRecords':    result = await getRecords(env); break;
        case 'getResources':  result = await getResources(env); break;
        case 'addRecord':     result = await addRecord(request, env); break;
        case 'addRecords':    result = await addRecords(request, env); break;
        case 'updateRecord':  result = await updateRecord(request, env); break;
        case 'updateRecords': result = await updateRecords(request, env); break;
        case 'deleteRecords': result = await deleteRecords(request, env); break;
        default: return corsResponse(JSON.stringify({ success: false, error: 'Unknown action' }), 404);
      }
      return corsResponse(JSON.stringify(result), 200);
    } catch (e) {
      return corsResponse(JSON.stringify({ success: false, error: e.message }), 500);
    }
  }
};

// ============================================================
// CORS レスポンス
// ============================================================
function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}

// ============================================================
// Kintone API 共通リクエスト
// ============================================================
async function kintoneRequest(method, path, payload, token, env) {
  const url = `https://${env.KINTONE_SUBDOMAIN}.cybozu.com/k/v1/${path}`;
  const headers = { 'X-Cybozu-API-Token': token };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  const options = { method, headers };
  if (payload && method !== 'GET') options.body = JSON.stringify(payload);

  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`Kintone API Error ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ============================================================
// 予約レコード 取得
// ============================================================
async function getRecords(env) {
  const data = await kintoneRequest(
    'GET',
    `records.json?app=${env.KINTONE_APP_ID}&query=order+by+%24id+asc+limit+500`,
    null, env.KINTONE_TOKEN, env
  );
  return { success: true, records: data.records };
}

// ============================================================
// リソースマスタ 取得
// ============================================================
async function getResources(env) {
  const data = await kintoneRequest(
    'GET',
    `records.json?app=${env.KINTONE_RES_APP_ID}&fields%5B%5D=resource_name&query=order+by+display_order+asc`,
    null, env.KINTONE_RES_TOKEN, env
  );
  return { success: true, records: data.records };
}

// ============================================================
// 予約 追加（1件）
// ============================================================
async function addRecord(request, env) {
  const { record } = await request.json();
  const data = await kintoneRequest(
    'POST', 'record.json',
    { app: env.KINTONE_APP_ID, record },
    env.KINTONE_TOKEN, env
  );
  return { success: true, id: data.id };
}

// ============================================================
// 予約 一括追加（繰り返し予約）
// ============================================================
async function addRecords(request, env) {
  const { records } = await request.json();
  const ids = [];
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const data = await kintoneRequest(
      'POST', 'records.json',
      { app: env.KINTONE_APP_ID, records: chunk },
      env.KINTONE_TOKEN, env
    );
    ids.push(...data.ids);
  }
  return { success: true, ids, count: ids.length };
}

// ============================================================
// 予約 更新（1件）
// ============================================================
async function updateRecord(request, env) {
  const { id, record } = await request.json();
  await kintoneRequest(
    'PUT', 'record.json',
    { app: env.KINTONE_APP_ID, id, record },
    env.KINTONE_TOKEN, env
  );
  return { success: true };
}

// ============================================================
// 予約 一括更新
// ============================================================
async function updateRecords(request, env) {
  const { records } = await request.json();
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    await kintoneRequest(
      'PUT', 'records.json',
      { app: env.KINTONE_APP_ID, records: chunk },
      env.KINTONE_TOKEN, env
    );
  }
  return { success: true, count: records.length };
}

// ============================================================
// 予約 削除
// ============================================================
async function deleteRecords(request, env) {
  const { ids } = await request.json();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await kintoneRequest(
      'DELETE', 'records.json',
      { app: env.KINTONE_APP_ID, ids: chunk },
      env.KINTONE_TOKEN, env
    );
  }
  return { success: true, count: ids.length };
}
