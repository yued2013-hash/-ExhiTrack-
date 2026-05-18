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

type TextCorrection = {
  from: string;
  to: string;
  reason: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const promptTemplate = (rawOcrText: string) => `
You are an expert museum label information extractor.
The OCR text may contain recognition errors, missing punctuation, broken lines,
or visually similar character mistakes. Before extracting fields, silently
validate the text against museum-label conventions and correct only obvious OCR
noise that is supported by nearby context.

OCR text:
${rawOcrText}

Return strict JSON only, with this shape:
{
  "name": string | null,
  "dynasty": string | null,
  "category": string | null,
  "origin": string | null,
  "era": string | null,
  "description": string | null
}

Validation rules:
- Prefer exact evidence from the OCR text over world knowledge.
- Correct obvious OCR artifacts such as broken words, stray symbols, duplicated
  line fragments, and common visual confusions only when context clearly supports
  the correction.
- Cross-check consistency: the dynasty, era, category, and description should not
  contradict each other. If they conflict, keep the better-supported value or use
  null.
- Prefer Chinese for every output field. If the OCR text contains both Chinese
  and English for the same label content, use the Chinese wording and ignore the
  English translation.
- Use English only as a fallback when no Chinese evidence is available for that
  field.
- Normalize Chinese output to Simplified Chinese.
- Pay special attention to common bronze vessel OCR confusions. For example,
  when a name looks like "单枉銅爵" or "单枉铜爵", validate it as the museum term
  "单柱铜爵" if the surrounding context indicates a bronze jue vessel.
- Do not infer a famous artifact name, dynasty, or excavation source unless the
  OCR text directly supports it.
- If multiple artifacts appear in the OCR text and there is no clear single
  target, extract the most prominent label only and keep ambiguous fields null.
- Preserve useful Chinese text from the label.
- Use null when a field cannot be determined with reasonable confidence.
- Return JSON only. No markdown, no commentary, no reasoning text.
`;

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
        const rawOcrText = await resolveOcrText(row);
        const normalizedOcr = normalizeMuseumText(rawOcrText);
        const info = await extractInfoWithLlm(normalizedOcr.text ?? rawOcrText);
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
        results.push({
          artifact_id: row.artifact_id,
          ok: true,
          corrections: normalizedOcr.corrections,
        });
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

async function resolveOcrText(row: {
  artifact_id: string;
  photo_url: string;
  raw_ocr_text?: string;
}): Promise<string> {
  const localText = row.raw_ocr_text?.trim();
  if (localText) return localText;

  if (Deno.env.get('ENABLE_CLOUD_OCR_FALLBACK') !== 'true') {
    throw new Error(
      'Missing raw_ocr_text. Cloud OCR fallback is disabled; run local OCR first or set ENABLE_CLOUD_OCR_FALLBACK=true.',
    );
  }
  if (!row.photo_url) {
    throw new Error('Missing photo_url for cloud OCR fallback.');
  }
  return extractOcrText(row.photo_url);
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
  const provider = (Deno.env.get('AI_PROVIDER') ?? 'zhipu').toLowerCase();
  if (provider === 'dashscope') return extractInfoWithDashScope(rawOcrText);
  return extractInfoWithZhipu(rawOcrText);
}

async function extractInfoWithZhipu(rawOcrText: string): Promise<ArtifactInfo> {
  const apiKey = requiredEnv('ZHIPU_API_KEY');
  const model = Deno.env.get('ZHIPU_TEXT_MODEL') ?? 'glm-4-flash-250414';
  const response = await fetch(
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You extract museum artifact metadata and return JSON only.',
          },
          { role: 'user', content: promptTemplate(rawOcrText) },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Zhipu request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Zhipu returned empty content');
  return normalizeInfo(parseJsonObject(content));
}

async function extractInfoWithDashScope(rawOcrText: string): Promise<ArtifactInfo> {
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
  return normalizeInfo(parseJsonObject(content));
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM returned non-JSON content');
    return JSON.parse(match[0]);
  }
}

function normalizeInfo(value: unknown): ArtifactInfo {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: normalizeMuseumText(readString(row.name)).text,
    dynasty: normalizeMuseumText(readString(row.dynasty)).text,
    category: normalizeMuseumText(readString(row.category)).text,
    origin: normalizeMuseumText(readString(row.origin)).text,
    era: normalizeMuseumText(readString(row.era)).text,
    description: normalizeMuseumText(readString(row.description)).text,
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMuseumText(value: string | null): {
  text: string | null;
  corrections: TextCorrection[];
} {
  if (!value) return { text: null, corrections: [] };

  let text = value;
  const corrections: TextCorrection[] = [];
  for (const rule of MUSEUM_TEXT_CORRECTION_RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replacement);
    if (text !== before) {
      corrections.push({
        from: before,
        to: text,
        reason: rule.reason,
      });
    }
  }

  return { text: text.trim() || null, corrections };
}

const MUSEUM_TEXT_CORRECTION_RULES: Array<{
  pattern: RegExp;
  replacement: string;
  reason: string;
}> = [
  {
    pattern: /[\u55ae\u5355]\u6789[\u9285\u94dc]\u7235/g,
    replacement: '\u5355\u67f1\u94dc\u7235',
    reason: 'bronze vessel term: single-post bronze jue',
  },
  {
    pattern: /\u9285/g,
    replacement: '\u94dc',
    reason: 'traditional-to-simplified bronze character',
  },
  {
    pattern: /\u55ae/g,
    replacement: '\u5355',
    reason: 'traditional-to-simplified single character',
  },
  {
    pattern: /\u9751[\u9285\u94dc]/g,
    replacement: '\u9752\u94dc',
    reason: 'common bronze term normalization',
  },
];

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
