// ============================================================
// Kintone予約システム - Cloudflare Pages Functions プロキシ
// ============================================================

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return corsResponse('', 204);
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

async function getRecords(env) {
  // 直近1ヶ月より前の予約はカレンダーに不要なため、基準日（今日の1ヶ月前）以降のみ取得する。
  // さらに、繰り返し予約で件数が膨らんでも1回の取得上限(500件)で新しい予約が
  // 切り捨てられないよう、offsetページネーションで全ページを取得する。
  const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19) + 'Z'; // 例: 2026-06-23T00:00:00Z
  const pageSize = 500;
  const all = [];
  let offset = 0;
  while (true) {
    const query = `end_datetime >= "${cutoff}" order by $id asc limit ${pageSize} offset ${offset}`;
    const data = await kintoneRequest(
      'GET',
      `records.json?app=${env.KINTONE_APP_ID}&query=${encodeURIComponent(query)}`,
      null, env.KINTONE_TOKEN, env
    );
    all.push(...data.records);
    // 取得件数がページサイズ未満なら最終ページ。offset上限(10000)も安全のため打ち止め。
    if (data.records.length < pageSize || offset + pageSize >= 10000) break;
    offset += pageSize;
  }
  return { success: true, records: all };
}

async function getResources(env) {
  const data = await kintoneRequest('GET', `records.json?app=${env.KINTONE_RES_APP_ID}&fields%5B%5D=resource_name&query=order+by+display_order+asc`, null, env.KINTONE_RES_TOKEN, env);
  return { success: true, records: data.records };
}

async function addRecord(request, env) {
  const { record } = await request.json();
  const data = await kintoneRequest('POST', 'record.json', { app: env.KINTONE_APP_ID, record }, env.KINTONE_TOKEN, env);
  return { success: true, id: data.id };
}

async function addRecords(request, env) {
  const { records } = await request.json();
  const ids = [];
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const data = await kintoneRequest('POST', 'records.json', { app: env.KINTONE_APP_ID, records: chunk }, env.KINTONE_TOKEN, env);
    ids.push(...data.ids);
  }
  return { success: true, ids, count: ids.length };
}

async function updateRecord(request, env) {
  const { id, record } = await request.json();
  await kintoneRequest('PUT', 'record.json', { app: env.KINTONE_APP_ID, id, record }, env.KINTONE_TOKEN, env);
  return { success: true };
}

async function updateRecords(request, env) {
  const { records } = await request.json();
  for (let i = 0; i < records.length; i += 100) {
    await kintoneRequest('PUT', 'records.json', { app: env.KINTONE_APP_ID, records: records.slice(i, i + 100) }, env.KINTONE_TOKEN, env);
  }
  return { success: true, count: records.length };
}

async function deleteRecords(request, env) {
  const { ids } = await request.json();
  for (let i = 0; i < ids.length; i += 100) {
    await kintoneRequest('DELETE', 'records.json', { app: env.KINTONE_APP_ID, ids: ids.slice(i, i + 100) }, env.KINTONE_TOKEN, env);
  }
  return { success: true, count: ids.length };
}
