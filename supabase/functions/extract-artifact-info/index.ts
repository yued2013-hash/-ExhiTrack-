import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ExtractRequest = {
  artifact_ids?: string[];
  items?: Array<{
    artifact_id: string;
    photo_url?: string;
    raw_ocr_text?: string;
    ocr_engine?: string;
  }>;
};

type ArtifactInfo = {
  name: string | null;
  dynasty: string | null;
  category: string | null;
  origin: string | null;
  era: string | null;
  description: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const promptTemplate = (rawOcrText: string) => `
你是博物馆文物信息抽取专家。下面是一段展签 OCR 文字，请抽取结构化信息：

OCR 原文：
${rawOcrText}

请输出严格的 JSON 格式，字段如下：
{
  "name": "文物名称",
  "dynasty": "朝代（如：唐 / 宋 / 战国）",
  "category": "品类（如：青铜器 / 陶瓷 / 书画 / 玉器）",
  "origin": "出土地或来源（无则填 null）",
  "era": "具体年代（如：公元前 5 世纪 / 1368-1644）",
  "description": "完整展签描述文字"
}

如果某字段无法判断，填 null。不要编造。只输出 JSON，不要输出任何其他文字。`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const supabaseAnonKey = requiredEnv('SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = (await req.json()) as ExtractRequest;
    const rows = await resolveArtifactRows(supabase, body);
    if (rows.length === 0) return json({ processed: 0, results: [] });

    const results = [];
    for (const row of rows) {
      await supabase
        .from('artifacts')
        .update({
          extraction_status: 'processing',
          extraction_error: null,
          extraction_updated_at: new Date().toISOString(),
        })
        .eq('id', row.artifact_id);

      try {
        const rawOcrText = row.raw_ocr_text?.trim() || (await extractOcrText(row.photo_url));
        const info = await extractInfoWithLlm(rawOcrText);
        const { error } = await supabase
          .from('artifacts')
          .update({
            name: info.name,
            dynasty: info.dynasty,
            category: info.category,
            origin: info.origin,
            era: info.era,
            label_description: info.description,
            raw_ocr_text: rawOcrText,
            extraction_status: 'done',
            extraction_error: null,
            extraction_updated_at: new Date().toISOString(),
          })
          .eq('id', row.artifact_id);
        if (error) throw error;
        results.push({ artifact_id: row.artifact_id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase
          .from('artifacts')
          .update({
            extraction_status: 'failed',
            extraction_error: message,
            extraction_updated_at: new Date().toISOString(),
          })
          .eq('id', row.artifact_id);
        results.push({ artifact_id: row.artifact_id, ok: false, error: message });
      }
    }

    return json({ processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});

async function resolveArtifactRows(
  supabase: ReturnType<typeof createClient>,
  body: ExtractRequest,
): Promise<Array<{ artifact_id: string; photo_url: string; raw_ocr_text?: string }>> {
  const explicitRows = body.items?.length
    ? body.items
        .filter((item) => item.artifact_id && (item.photo_url || item.raw_ocr_text?.trim()))
        .map((item) => ({
          artifact_id: item.artifact_id,
          photo_url: item.photo_url ?? '',
          raw_ocr_text: item.raw_ocr_text,
        }))
    : [];
  if (!body.artifact_ids?.length) return explicitRows;
  const { data, error } = await supabase
    .from('artifacts')
    .select('id, photo_url')
    .in('id', body.artifact_ids);
  if (error) throw error;
  const fetchedRows = (data ?? [])
    .filter((row) => row.photo_url)
    .map((row) => ({ artifact_id: row.id, photo_url: row.photo_url as string }));
  return [...explicitRows, ...fetchedRows];
}

async function extractOcrText(photoUrl: string): Promise<string> {
  const endpoint = requiredEnv('ALIYUN_OCR_ENDPOINT');
  const appCode = Deno.env.get('ALIYUN_OCR_APPCODE');
  const apiKey = Deno.env.get('ALIYUN_OCR_API_KEY');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appCode) headers.Authorization = `APPCODE ${appCode}`;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: photoUrl, image_url: photoUrl }),
  });
  if (!response.ok) {
    throw new Error(`OCR request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = readOcrText(data);
  if (!text) throw new Error('OCR returned empty text');
  return text;
}

function readOcrText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  const direct = readString(record.text) ?? readString(record.content);
  if (direct) return direct;
  const words = record.words_result ?? record.prism_wordsInfo ?? record.data;
  if (Array.isArray(words)) {
    return words
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const row = item as Record<string, unknown>;
        return readString(row.words) ?? readString(row.word) ?? readString(row.text);
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function extractInfoWithLlm(rawOcrText: string): Promise<ArtifactInfo> {
  const apiKey = requiredEnv('DASHSCOPE_API_KEY');
  const model = Deno.env.get('DASHSCOPE_TEXT_MODEL') ?? 'qwen-plus';
  const response = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: promptTemplate(rawOcrText) }],
        response_format: { type: 'json_object' },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM returned empty content');
  return normalizeInfo(JSON.parse(content));
}

function normalizeInfo(value: unknown): ArtifactInfo {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: readString(row.name),
    dynasty: readString(row.dynasty),
    category: readString(row.category),
    origin: readString(row.origin),
    era: readString(row.era),
    description: readString(row.description),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
