# -ExhiTrack-
我要为自己开发一个个人观展档案管理系统，解决我看完展览后大量照片堆积、缺乏动力整理的痛点。 核心价值主张：把"看完展回家"到"得到一份完整观展档案"的整理流程，从数小时压缩到 10 分钟内。


# 个人观展档案管理系统 — Vibe Coding 实施提示词

> 本文档用作与 AI 编码助手（Claude / Cursor / Copilot 等）协作开发时的**主提示词**。
> 使用方式：开新会话时把本文档作为初始上下文喂给 AI；后续每次提需求时引用对应章节即可。

---

## 一、项目背景与目标

我要为自己开发一个**个人观展档案管理系统**，解决我看完展览后大量照片堆积、缺乏动力整理的痛点。

**核心价值主张**：把"看完展回家"到"得到一份完整观展档案"的整理流程，从数小时压缩到 10 分钟内。

**用户范围**：仅自用，不对外发布，不考虑多租户、不考虑商业化、不考虑大规模并发。

**开发模式**：Vibe coding —— 我描述需求，AI 写代码，我在浏览器里验证后迭代。我具备基础的产品设计能力，但代码能力较弱，因此架构选型、模块边界、技术栈都需要对 AI 生成友好。

**预期周期**：7–10 周完成 MVP，按周末 + 工作日晚上的投入节奏。

---

## 二、技术栈（已确定，不要随意更换）

### 前端
- **Next.js 14**（App Router，TypeScript）
- **TailwindCSS** + **shadcn/ui**（UI 组件库直接使用，不要自己造）
- **TanStack Query**（服务端状态管理）
- **Zustand**（本地状态管理，按需使用）
- **React Hook Form** + **Zod**（表单与校验）

### 后端 / 基础设施
- **Supabase** 一站式：
  - Postgres（数据库）
  - Storage（对象存储，存照片和语音文件）
  - Auth（用户认证，自用场景仅启用邮箱登录）
  - Edge Functions（异步后台任务，如批量 OCR / LLM 调用）
  - Realtime（可选，用于批量处理进度推送）

### 外部 AI 服务
- **OCR**：阿里云通用文字识别 OCR API（备选：腾讯云 OCR）
- **LLM**：通义千问（qwen-max 或 qwen-plus）/ 智谱 GLM-4 / Moonshot Kimi 三选一
- **语音转文字**：通义听悟 API（备选：OpenAI Whisper API）

### 部署
- **Vercel**（连接 GitHub 仓库，自动部署）
- 域名可选，初期使用 Vercel 免费子域名

### 不要使用的技术（明确排除）
- 不要使用微信小程序 / Flutter / React Native（vibe coding 反馈循环过长）
- 不要使用自建后端服务（Express / FastAPI 等）—— 全部走 Supabase
- 不要使用 Redux / MobX（Zustand 足够）
- 不要使用 Prisma / Drizzle ORM —— 直接用 Supabase 客户端 SDK
- 不要使用 Docker —— 部署完全交给 Vercel

---

## 三、架构原则与约束

1. **模块边界清晰**：每个功能模块的输入输出都是数据库表或字段，不允许跨模块紧耦合。
2. **失败优雅降级**：任何 AI 服务调用失败都不能阻塞主流程，必须允许用户手动补全。
3. **批处理优先**：所有 AI 调用尽量批处理，避免单条调用产生大量等待。
4. **客户端能做的不上后端**：图像缩略图、模糊检测、相似度比对优先在浏览器端完成。
5. **数据可导出**：所有数据必须可导出为 JSON / Markdown，避免厂商锁定。
6. **零成本默认**：默认配置下应能跑在 Supabase 免费额度内，付费 API 调用走用户自己的 Key。
7. **自用场景，不要过度设计**：
   - RLS（行级安全）默认关闭，用 Supabase Service Role Key 直连即可
   - 不需要复杂权限系统
   - 不需要审计日志
   - 不需要国际化（只做中文）

---

## 四、数据模型

### 核心表结构

```sql
-- 展览表
exhibitions
  - id (uuid, PK)
  - name (text, 展览名称)
  - museum (text, 博物馆名称)
  - location (text, 城市)
  - start_date (date, 展览开始日期)
  - end_date (date, 展览结束日期)
  - visit_date (date, 我的观展日期)
  - description (text, 展览介绍 / 策展前言)
  - curatorial_units (jsonb, 策展单元结构 [{title, description, order}])
  - cover_image_url (text)
  - created_at, updated_at (timestamptz)

-- 文物表
artifacts
  - id (uuid, PK)
  - exhibition_id (uuid, FK -> exhibitions)
  - curatorial_unit_index (int, 所属策展单元序号，可空)
  - name (text, 文物名称)
  - dynasty (text, 朝代)
  - category (text, 品类，如青铜器/陶瓷/书画)
  - origin (text, 出土地 / 来源)
  - era (text, 具体年代)
  - description (text, 展签原文)
  - structured_info (jsonb, LLM 抽取的结构化字段)
  - photo_urls (text[], 照片 URL 列表)
  - thumbnail_url (text, 主缩略图)
  - photo_taken_at (timestamptz, 拍摄时间，用于排序)
  - is_blurry (bool, 是否模糊废片)
  - is_duplicate_of (uuid, 关联到主图)
  - tags (text[])
  - created_at, updated_at

-- 感受表
impressions
  - id (uuid, PK)
  - exhibition_id (uuid, FK -> exhibitions)
  - artifact_id (uuid, FK -> artifacts，可空，可绑定到展览整体)
  - raw_voice_url (text, 语音原文件)
  - raw_text (text, 语音转文字原文)
  - polished_text (text, LLM 润色后的文本)
  - recorded_at (timestamptz, 录制时间)
  - created_at, updated_at

-- 标签表（可选，初版可不做）
tags
  - id (uuid, PK)
  - name (text, unique)
  - color (text)
```

### 索引建议
- `artifacts(exhibition_id, photo_taken_at)`
- `artifacts` 全文搜索索引（name + description + structured_info::text）
- `impressions(artifact_id)`

### Storage Bucket 设计
- `photos/{exhibition_id}/{artifact_id}/{filename}` —— 文物照片
- `voices/{exhibition_id}/{filename}` —— 语音备忘录原文件
- `thumbnails/{exhibition_id}/{artifact_id}.webp` —— 客户端生成的缩略图

---

## 五、模块拆解与开发顺序

> **严格按顺序开发，每个模块跑通再做下一个。不要并行。**

### 第 1 步｜项目骨架（约 1 周）

**目标**：跑通整个技术链路，建立可运行的最小项目。

**任务**：
1. 初始化 Next.js 14 项目（App Router + TypeScript + Tailwind）
2. 集成 shadcn/ui，安装基础组件（Button / Input / Card / Dialog / Toast）
3. 注册并配置 Supabase 项目，建立上述数据库表
4. 实现邮箱登录 + 受保护路由
5. 做"展览列表 / 创建展览 / 展览详情"三个最简页面，能跑通增删改查
6. 配置 Vercel 部署，git push 自动上线

**验收标准**：登录后能在 Web 端创建展览、看到列表、点进详情页、删除展览。

### 第 2 步｜批量导入（约 1 周）

**目标**：把现场拍的照片和录的语音批量导入到展览下。

**任务**：
1. 在展览详情页加"上传"按钮，支持拖拽多文件上传
2. 客户端读取照片 EXIF（用 `exifr` 库）提取拍摄时间
3. 客户端生成 webp 缩略图（用 `browser-image-compression`）
4. 上传原图到 `photos/` bucket，缩略图到 `thumbnails/` bucket
5. 为每张照片创建一条 `artifacts` 记录（初始字段几乎为空，仅有 photo_url 和 photo_taken_at）
6. 语音文件上传到 `voices/` bucket，创建 `impressions` 初始记录
7. 在展览详情页展示瀑布流缩略图墙，按拍摄时间排序

**验收标准**：选中一个展览文件夹的几十张照片 + 几条语音，10 秒内完成上传，缩略图墙正确显示。

### 第 3 步｜OCR + LLM 信息抽取（约 2-3 周，核心价值）

**目标**：从展签照片里自动提取文物结构化信息。

**任务**：
1. 在展览详情页加"批量识别"按钮，支持选中多张照片一起处理
2. 创建 Supabase Edge Function `extract-artifact-info`：
   - 接收 photo_url 数组
   - 对每张图调阿里云 OCR API 拿到原始文字
   - 把原始文字喂给 LLM，用结构化 prompt 抽取：
     - 文物名称
     - 朝代
     - 品类
     - 出土地 / 来源
     - 具体年代
     - 完整展签描述
   - 写回 `artifacts` 表
3. 前端显示处理进度（用 Supabase Realtime 订阅 artifacts 表更新）
4. 处理完允许用户在卡片上手动修改任何字段
5. 失败的照片标记为"待手动补全"，不阻塞流程

**Prompt 模板示例**（写在 Edge Function 内）：
```
你是博物馆文物信息抽取专家。下面是一段展签 OCR 文字，请抽取结构化信息：

OCR 原文：
{raw_ocr_text}

请输出严格的 JSON 格式，字段如下：
{
  "name": "文物名称",
  "dynasty": "朝代（如：唐 / 宋 / 战国）",
  "category": "品类（如：青铜器 / 陶瓷 / 书画 / 玉器）",
  "origin": "出土地或来源（无则填 null）",
  "era": "具体年代（如：公元前 5 世纪 / 1368-1644）",
  "description": "完整展签描述文字"
}

如果某字段无法从原文判断，填 null。不要编造。只输出 JSON，不要任何其他文字。
```

**验收标准**：50 张展签照片，5 分钟内全部识别完成，准确率 > 80%，剩余字段允许快速手动补全。

### 第 4 步｜语音转文字 + 自动绑定（约 1 周）

**目标**：把现场录的语音感受自动转成文字并绑定到对应文物。

**任务**：
1. Edge Function `transcribe-voice`：调用通义听悟 / Whisper 转录
2. 自动绑定逻辑：根据语音录制时间戳，找到时间最接近的 artifact，绑定 impression.artifact_id
3. 绑定后在文物卡片下显示原始转录文本
4. 允许用户在 UI 上拖拽 impression 改绑到其他文物

**验收标准**：一场展览的 10 条语音，转录准确率高，自动绑定准确率 > 70%，剩余手动改绑。

### 第 5 步｜整理与归档（约 2 周）

**目标**：把碎片化内容组织成完整的观展档案。

**任务**：
1. 展览详情页加两种视图切换：
   - 时间顺序视图（按拍摄时间）
   - 策展单元视图（按 curatorial_units 分组）
2. "策展叙事生成"按钮：把展览名 + 文物列表喂给 LLM，让它生成 3-6 个策展单元划分（标题 + 描述），写入 `exhibitions.curatorial_units`
3. 用户可手动调整单元划分
4. 自动把 artifacts 分配到最匹配的单元（LLM 二次调用）
5. "感受润色"功能：把同一展览所有 raw_text 喂给 LLM，生成连贯的整体观展感受
6. 卡片支持手动 / AI 二选一切换显示原始或润色版

**验收标准**：随便选一个已识别完的展览，3 分钟内生成完整的策展单元划分 + 润色感受。

### 第 6 步｜个人文博数据库（约 1 周）

**目标**：跨展览的搜索与统计。

**任务**：
1. 全局搜索页：关键词同时搜文物名、朝代、品类、感受
2. 筛选维度：按朝代、品类、博物馆、年份多维过滤
3. 统计页：
   - 看过多少场展览
   - 打卡过多少博物馆
   - 文物朝代分布饼图（用 recharts）
   - 月度 / 年度观展数量柱状图
4. 用 Postgres 的 `tsvector` + `ts_rank` 做全文搜索，无需 Elasticsearch

**验收标准**：搜"唐代 青铜器"能秒级返回所有相关文物 + 所属展览。

### 第 7 步｜导出（约 1 周）

**目标**：把档案导出为可分享 / 归档格式。

**任务**：
1. **Markdown 导出**：单个展览导出为一份结构化 markdown，包含策展单元 + 文物图文 + 感受
2. **PDF 导出**：用 `@react-pdf/renderer` 生成可打印 PDF（精简版）
3. **Notion 导入格式**：导出为 Notion 兼容的 markdown，含 frontmatter
4. **JSON 备份**：全库导出为 JSON，便于迁移
5. **社交平台精简版**：单展览生成 9 宫格 + 短文字（小红书风格）

**验收标准**：一场展览能 1 秒内生成 4 种格式，下载即用。

---

## 六、UI / UX 准则

- **视觉风格**：简洁、博物馆质感，参考小红书的图片墙 + Notion 的结构化布局
- **配色**：白底 + 深灰文字 + 一个主题色（推荐黛蓝 #2C3E50 或墨绿 #1F4D3C）
- **字体**：中文用思源宋体（标题）+ 苹方（正文）
- **响应式**：桌面优先，但要在 iPad / 手机浏览器上可用
- **暗黑模式**：v2 再做，MVP 不做
- **动画**：克制，仅在加载状态、卡片展开、Toast 提示上使用
- **空状态**：每个空列表都要有友好的引导文案 + 主操作按钮

---

## 七、AI 协作约定（重要）

每次让 AI 写代码时，请遵守以下约定：

1. **每次只做一个模块的一个小任务**，不要一次让 AI 写完整模块
2. **先要求 AI 列出实现计划**，确认没问题再让它写代码
3. **生成代码后，先在浏览器里验证，再决定是否合并**
4. **报错处理**：把完整报错（包含堆栈、网络请求、控制台）贴回对话，不要描述"好像出错了"
5. **避免一次性大重构**：宁可分 5 次小改，不要让 AI 一次改 10 个文件
6. **数据库迁移**：每次改表结构都让 AI 给出 `migration.sql` 文件，存在 `supabase/migrations/` 下
7. **环境变量**：所有 secret（Supabase Service Key / OCR Key / LLM Key）放 `.env.local`，绝不提交 Git
8. **类型先行**：每个数据结构先定义 TypeScript 类型，再写实现
9. **代码风格**：函数式优先、避免 class、避免过度抽象，自用场景重复一点没关系

---

## 八、风险与降级方案

| 风险点 | 降级方案 |
|--------|---------|
| OCR 识别率低 | 手动编辑文物字段，UI 必须支持快速批量编辑 |
| LLM 抽取不准 | 显示原始 OCR 文字 + 抽取结果对照，允许一键回退 |
| 语音转录失败 | 允许直接打字输入感受 |
| 策展单元生成不合理 | 提供"重新生成"按钮 + 手动编辑 |
| Supabase 免费额度超限 | 监控用量，必要时清理旧照片或升级到 Pro($25/月) |
| 浏览器上传大量照片卡顿 | 分批上传、用 Web Worker 处理缩略图 |
| 单个展览数据量过大 | 用虚拟滚动（`@tanstack/react-virtual`）优化长列表 |

---

## 九、明确不做的功能（避免范围蔓延）

以下功能即使你看到觉得"加一下也不难"，**MVP 阶段坚决不做**：

- ❌ 拍摄时玻璃反光自动优化（物理偏振镜更有效）
- ❌ 多人协作 / 共享档案（自用场景不需要）
- ❌ 移动端原生 App / 小程序（Web 已够用）
- ❌ 社交关注 / 评论 / 点赞
- ❌ 推送通知
- ❌ AI 推荐"你可能感兴趣的展览"
- ❌ 商业化相关（订阅 / 付费 / 广告）
- ❌ 国际化多语言
- ❌ 暗黑模式
- ❌ 复杂权限系统

---

## 十、起步检查清单

开始第一行代码之前，确保以下都已就绪：

- [ ] GitHub 账号已创建空仓库
- [ ] Supabase 账号 + 已创建项目（记下 URL + Anon Key + Service Role Key）
- [ ] Vercel 账号 + 已连接 GitHub
- [ ] 阿里云账号 + 已开通 OCR API（记下 AccessKey）
- [ ] 选定的 LLM 服务商账号 + API Key
- [ ] 通义听悟或 Whisper API Key
- [ ] 本地装好 Node.js 20+ 和 pnpm
- [ ] 装好 VS Code / Cursor + 安装 Tailwind CSS IntelliSense 插件

---

## 十一、首次启动指令

把本文档完整发给 AI 后，**第一句对话**建议是：

> "请基于以上提示词，帮我执行【第 1 步｜项目骨架】的第 1 个子任务：初始化 Next.js 14 项目。先列出执行计划和将创建/修改的文件列表，确认后再写代码。"

之后按模块顺序逐一推进即可。
