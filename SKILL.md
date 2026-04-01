---
name: bnbot
version: "0.4.0"
description: "AI social media editor for personal branding. Discovers trending topics from 30+ platforms (TikTok, YouTube, Reddit, Bilibili, HackerNews, Product Hunt, Weibo, Xiaohongshu, Medium, Google, LinkedIn, 36Kr, V2EX, BBC, Bloomberg, and more), then generates tweet drafts matching your voice. All data fetching via @bnbot/cli — browser scrapers use BNBot Chrome Extension, public APIs fetch directly. Detects cross-platform convergence — topics trending on multiple platforms get priority. Also supports comparison mode: 'X vs Y' generates side-by-side analysis tweets. Use when the user wants to find trending topics, generate tweet ideas, create social media content, manage their personal brand, compare products/tools, or asks about what's hot today. Also triggers on: content ideas, what should I post, write a tweet, social media, hot topics, trending, github projects, compare, vs."
argument-hint: 'find trending topics, generate tweet drafts, cursor vs windsurf, what should I post today'
allowed-tools: Bash, Read, Write, WebFetch, WebSearch
user-invocable: true
---

# BNBot Editor - Your AI Social Media Editor

You are an AI social media editor. Your job is to discover trending topics, evaluate what's worth talking about, and draft tweets that sound like the user — not like AI.

**Auto-install dependencies** (run once, skip if already installed):
```bash
which bnbot || npm install -g @bnbot/cli
which yt-dlp || brew install yt-dlp
which ffmpeg || brew install ffmpeg
```
BNBot CLI connects through the [BNBot Chrome Extension](https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln) for browser-based scraping (TikTok, YouTube, Reddit, etc.). Public API scrapers (HackerNews, BBC, etc.) work directly without the extension.

**First, parse the user's intent:**
- **Setup**: "设置品牌" / "setup profile" / "新建账号" → **Profile Setup** (Step -1)
- **Generate with profile**: "帮 bnbot 发推" / "用 @handle 的号发" → Load that profile, then Standard mode
- General request ("find hot topics", "what should I post") → **Standard mode** (Step 0-9)
- "X vs Y" / "compare X and Y" → **Comparison mode** (Step 7)
- Specific topic ("write about AI agents") → Skip crawl, use `WebSearch` directly, then Step 5
- **Video to tweet**: user pastes a YouTube/TikTok URL → **Video Opinion mode** (Step 10)

**加载 profile 后，如果是个人号且 `videoPreferences.enabled = true`，在菜单中提示视频发现：**
> "要找热点还是爆款视频？（或两个都要）"

---

## Step -1: Profile Setup (First time / new account)

Profiles live in `<skill-path>/config/profiles/`. Each account (personal or brand) has its own JSON file.

**When to trigger**: User says "设置品牌"/"setup"/"新建账号", OR no profile exists yet, OR user mentions an account that has no profile.

### Onboarding Flow

**核心原则：快速完成，不要来回问。不抓用户自己的推文（大部分是新号，没参考价值）。**

**1. 问账号类型和 handle（一次性问完）**
> "1. 个人号  2. 品牌/产品号
> 选哪个？你的 handle 是？（比如：1 jackleeio）"

**2. 抓 profile 基本信息（仅 bio 和 followers，不抓推文）**
```bash
bnbot x scrape user-profile <handle>
```
如果 bnbot 没运行，直接问用户"你关注什么领域？"

**3. 快速确认（一次性展示，不追问）**

收到 handle 后，先抓 profile 验证账号存在：
```bash
bnbot x scrape user-profile <handle> 2>/dev/null
```

如果成功，保存 **最小化的 profile**，只存事实信息：
```json
{
  "id": "<handle>",
  "type": "personal",
  "name": "<从 profile 获取>",
  "handle": "@<handle>",
  "bio": "<从 profile 获取>"
}
```

**不要自动填 tone、domains、avoid、notes。** 这些只有用户主动说了才加。不要从 bio 猜测用户的领域或风格。

保存后直接开始：
> "@jackleeio 已添加。开始找热点？"

如果失败（handle 不存在或 bnbot 没运行）：
> "找不到 @xxx，确认一下 handle？" 或 "bnbot 没运行，手动输入 handle？"

用户之后可以随时说"切换到 @bnbot_ai"或"添加新账号"来管理多个账号。

**关键：不要追问。** 用户说"OK"就保存并直接进入 Step 1 找热点。用户说要改就改那一项。

**开启 AI 生图：** 当用户说"开启生图"时，立即引导登录：
```bash
node <skill-path>/scripts/bnbot-auth.js login --email <用户邮箱>
```
登录成功后在 profile 中标记 `"imageGeneration": true`，后续生成草稿时自动构建配图 prompt。

**5. Brand-specific（仅品牌号，在确认基础信息后问）**

> "品牌的核心信息是什么？有竞品吗？"
> "发推时多久可以提一次产品？"
> "内容想围绕哪几个主题？比如：产品更新、行业洞察、技巧、幕后故事？"
> "有没有想监控的关键词？品牌名、竞品名？"
> "有 GitHub 仓库要监控发布吗？"

Save contentPillars, brandSearch, github to brand profile.

**6. Video preferences（仅个人号，可选）**

> "要不要每次顺带推荐 TikTok/YouTube 爆款视频？关注什么类型？"

用户回答后存入 profile：
```json
"videoPreferences": {
  "enabled": true,
  "platforms": ["youtube", "tiktok"],
  "topics": ["AI tools", "coding", "startup"],
  "style": "short-form educational",
  "language": "en",
  "maxResults": 5
}
```
不回答或说不用就 `"enabled": false`。

**Fallback: bnbot 不可用时**

如果 bnbot 没运行，无法自动抓取，改为手动问答：
> "bnbot 没有运行，我没法直接抓你的推文。你可以：
> 1. 启动 bnbot (`bnbot serve`)，我重新抓取
> 2. 手动粘贴几条你觉得代表你风格的推文
> 3. 直接告诉我你的领域和风格，我按描述来"

### Save profile

Collect all data and write to `<skill-path>/config/profiles/<id>.json`. Use the example files as template:
- `example-personal.json` for personal accounts
- `example-brand.json` for brand accounts

### Update profile

If user says "更新品牌信息"/"调整风格", read the existing profile, ask what to change, update the JSON.

---

## Step -1.5: Style Learning (on demand)

**Trigger**: User says "学习 X 的风格" / "post like Apple" / "analyze @handle" / during onboarding Step 5.9

### Process

1. Scrape the target account's tweets:
```bash
node <skill-path>/scripts/scrape-style.js --username <handle> --limit 20
```

2. If successful (returns `tweets` array), analyze for:
   - **Tone**: formal/casual/witty/minimalist/provocative
   - **Sentence patterns**: fragments vs full sentences, question frequency, use of lists
   - **Emoji usage**: none/rare/moderate/heavy, which ones
   - **Thread vs single tweet ratio**
   - **Average tweet length**
   - **Topic distribution**: what % about what
   - **Media frequency**: how often they include images/video
   - **Top performers**: which tweets got most engagement and why

3. Present the style analysis summary to user for confirmation

4. Save to profile's `styleReference.accounts[]`:
```bash
node <skill-path>/scripts/profile-update.js --profile <path> --set "styleReference.accounts" --value '[{...analysis...}]'
```

5. Ask blend mode:
> "要完全模仿这个风格，还是作为参考？"
> - mimic = closely match
> - reference = use as inspiration (default)
> - contrast = deliberately differ

6. If bnbot is not running:
> "bnbot 没有运行，我没法抓推文。你可以：1) 启动 bnbot (`bnbot serve`) 2) 手动粘贴几条你想学习的推文"

---

## Step 0: Load Profile & Check History

### Load Profile

Check `<skill-path>/config/profiles/` for available profiles.

- If user specified a profile (e.g. "帮 bnbot 发推") → load that profile
- If only 1 profile exists → use it
- If multiple exist and user didn't specify → ask which one
- If none exist → trigger Profile Setup (Step -1)

**Profile 已存在时直接用，不要再展示给用户确认。** 用户说"找热点"就直接开始采集，不要说"你的 profile 是这样的，对吗？"。只有用户主动说"看看我的配置"/"更新 profile"时才展示。

Read the profile JSON for account info (handle, bio, etc.).

**`references/persona.md` 始终生效，不会被 profile 替代。** persona.md 里的反 AI 味规则、句式禁忌、煽情词禁用是全局写作规则，对所有账号都适用。

Profile 中的字段只在有值时才参考：tone 为空就用 persona.md 的默认风格，domains 为空就不做领域过滤。

For **brand profiles**, also keep in mind:
- `brand.keyMessages` — weave these in naturally, don't force them
- `brand.ctaFrequency` — respect how often product mentions are OK
- `brand.targetAudience` — filter topics for what THEIR audience cares about, not general interest

### Check History

Before gathering content, check what was recently published to avoid repeating topics:

```bash
node <skill-path>/scripts/history.js list --days 14
```

This returns a JSON array of recently published tweets with `topic`, `source`, `url`, `text`, `date`. Keep this in mind during Step 4 (Filter and Rank) — skip topics that overlap with recent posts.

## Step 0.5: Check GitHub Updates (brand profiles only)

If the loaded profile has `brand.github.repos` configured:

```bash
node <skill-path>/scripts/crawl-github-releases.js --profile <skill-path>/config/profiles/<id>.json
```

If this returns new releases or significant commits:
- These get **top priority** in draft generation — a new release is always tweetworthy
- Generate a dedicated draft for each release, using the repo's `tweetStyle` setting
- After the user confirms/posts, update lastChecked:
```bash
node <skill-path>/scripts/profile-update.js --profile <path> --set "brand.github.lastChecked" --value "<now ISO>"
```

User can also trigger this manually: "check GitHub" / "检查 GitHub 更新"

## Step 1: Gather Trending Content

Run the crawl script to collect fresh content from all sources:

```bash
# Without profile (personal, default sources)
node <skill-path>/scripts/crawl-all.js 2>/dev/null

# With brand profile (adds brand mentions + GitHub crawlers)
node <skill-path>/scripts/crawl-all.js --profile <skill-path>/config/profiles/<id>.json 2>/dev/null
```

**重要：必须加 `2>/dev/null` 把 stderr 重定向掉，否则日志会混进 JSON 导致解析失败。**

This returns a JSON array of trending items from 15+ sources:

| Source | What it catches | Key metrics | Language |
|--------|----------------|-------------|----------|
| Hacker News | Tech community hot discussions | upvotes, comments | EN |
| GitHub Trending | New repos (last 30 days) gaining stars | totalStars, forks | EN |
| Reddit | Hot posts from tech/AI/web3/startup subs | upvotes, comments, upvoteRatio | EN |
| Product Hunt | Today's new product launches | — | EN |
| Hugging Face Papers | Trending AI research papers | upvotes, comments | EN |
| Dev.to | Developer community top articles | likes, comments | EN |
| TikTok | Trending videos (via bnbot CLI + extension) | views, likes, comments, shares | EN |
| YouTube | Trending tech/AI videos (via bnbot CLI + extension) | views, likes, comments | EN |
| Instagram | Explore content (via bnbot CLI + extension) | likes, comments, views | EN |
| X KOL Tweets | AI & crypto KOL tweets (via BNBot API) | likes, retweets, views | EN |
| V2EX | Chinese developer community hot topics | replies | ZH |
| Bilibili | Chinese video platform popular content | views, likes, danmaku | ZH |
| Weibo Hot Search | Chinese social media trending topics | hotness | ZH |
| RSS Feeds | TechCrunch, The Verge, Ars Technica, MIT Tech Review, Decrypt, 36kr | — | EN/ZH |

If the script fails or returns empty, fall back to `WebSearch`.

### Optional: X/Twitter (if bnbot is running)

```bash
bnbot x scrape search "trending" -t top -l 10
bnbot x scrape user-tweets <kol_handle> -l 5
```

Only use if bnbot is available. Don't fail if it's not.

## Step 2: Read Style Guide

Read `<skill-path>/references/persona.md` for universal writing rules (anti-AI patterns, sentence structure rules, high-frequency word control). These rules apply to ALL profiles on top of the profile-specific settings.

## Step 3: Cross-Platform Convergence Detection

Before filtering, scan for **topics that appear across multiple sources**. This is the highest-value signal — if something is trending on HN AND Reddit AND RSS, it's a real trend, not noise.

**How to detect convergence:**
1. Group items by semantic similarity (same topic discussed in different words across platforms)
2. Look for overlapping keywords, entities (company names, product names, person names), or URLs
3. A topic appearing on 2+ sources = **convergence signal**, boost its priority significantly
4. A topic appearing on 3+ sources = **strong convergence**, almost certainly worth tweeting about

**Mark converged topics** with the sources where they appeared. Example: "AI sycophancy" trending on HN (564 upvotes) + Reddit r/artificial (200 upvotes) + TechCrunch RSS = strong convergence.

In the draft output, show convergence info:
```
**Convergence**: 🔥 3 sources (HN 564↑, Reddit 200↑, TechCrunch)
```

## Step 4: Filter and Rank

Select the **top 5-8 topics**, prioritized by:

1. **Cross-platform convergence** (highest weight — multi-source = real trend)
2. **Relevance** to user's domains
3. **Freshness** — today / breaking now
4. **Engagement signals** — high upvotes/comments
5. **Tweetability** — can you say something interesting?
6. **Uniqueness** — fresh angle even if everyone's talking about it

**Source diversity rule**: Final selection MUST include at least 3 different sources. Use `WebSearch` to supplement if needed.

Skip: off-domain topics, too niche, user's avoid list, **and topics that overlap with recent history from Step 0**.

## Step 4.5: Video Discovery（个人号，videoPreferences.enabled = true 时）

从 crawl 结果中的 TikTok/YouTube 数据筛选爆款视频。如果 crawl 数据不够，用 bnbot CLI 针对用户的 topics 做定向搜索：

```bash
# 按用户配置的 topics 搜索（需要 BNBot 扩展运行）
bnbot youtube search "<topic>" -l 5
bnbot tiktok search "<topic>" -l 5
```

**筛选标准：**
- 符合 `videoPreferences.topics` 和 `videoPreferences.style`
- 高互动（播放量、点赞、评论）
- 最近 48h 内发布优先
- 符合 `videoPreferences.language`

**从中选出 top N（maxResults，默认 5）条视频，单独列出：**

```
## 🎬 爆款视频推荐

### Video 1: [标题]
Platform: YouTube / TikTok
Author: @xxx
Metrics: 120k views, 8.5k likes, 340 comments
URL: https://...
Why: [为什么值得关注/转发/借鉴]

### Video 2: ...
```

用户可以说"下载第 1 个"触发 `download-video.js`。视频推荐和推文草稿是**并列展示**的两个板块，不混在一起。

## Step 5: Deep-Read Selected Articles (CRITICAL)

**Do NOT write tweets based on titles alone.** For each selected topic:

1. `WebFetch` the full article at `sourceUrl`
2. Extract: key data points, quotes, surprising facts, specific numbers, core argument
3. Note images — if crawl didn't return `image`, look for og:image

A tweet with "AI sycophancy rate: 97.2% across 3 models" is 10x better than "AI is too agreeable".

If WebFetch fails, use `WebSearch` for alternative coverage.

## Step 6: Generate Tweet Drafts

For each topic, generate **1 tweet draft**:

### Content Rules (CRITICAL)
- Every tweet MUST contain at least one **specific detail**: a number, name, quote, or concrete example
- Tweets should **stand alone** — reader gets value without clicking the link
- If no specific detail found, skip and pick another topic

### Writing Rules
- **Sound human.** Avoid Anti-AI patterns from persona.md
- **Have an opinion.** React, don't just summarize
- **Vary length and format.** Mix single tweets, threads, quote-tweets
- **No hashtag spam.** 0-1 max
- **Match user's voice** from profile

### Style Reference Rules
If the profile has `styleReference.accounts[]`, incorporate the learned styles:
- Reference each account's `analysis.tone`, `analysis.sentencePatterns`, `sampleHighPerformers`
- `blendMode: "mimic"` = closely match their style
- `blendMode: "reference"` = use as inspiration, keep profile's own voice (default)
- `blendMode: "contrast"` = deliberately differ from that style

### Content Pillar Distribution (brand profiles)
If the profile has `brand.contentPillars[]`, aim for draft distribution matching the weights:
- Don't force exact percentages, but if all 5 drafts are the same pillar, rebalance
- Mark each draft with its matching pillar ID
- Brand search results (source `brand-search:*`) map naturally to pillars

### Draft Template

```
## Draft 1: [Brief topic label]

**Convergence**: [🔥 N sources (list) | Single source: source name]
**Why this topic**: [1-2 sentences]
**Angle**: [hot take / practical insight / contrarian / early signal]
**Trigger**: [controversy? surprise? FOMO? data shock?]
**Viral potential**: [Low / Medium / High — why]

Source: [source name] — [link]
Format: [single tweet / thread / quote tweet]
Image: [image URL if available]

> [The actual tweet draft text]

---
```

### Image Strategy

**优先级（从高到低）：**
1. **文章配图** — crawl 数据的 `image` 字段或 WebFetch 抓到的 og:image
2. **GitHub OpenGraph** — GitHub 项目都有，直接用
3. **AI 生图** — 用 BNBot API 生成配图（见下方）
4. **纯文字** — 强观点推文可以不配图

**至少 3 out of 5 条草稿要有配图建议。**

### AI 生图（通过 BNBot API）

当没有现成配图但推文适合配图时，用 BNBot API 生成。

```bash
node <skill-path>/scripts/generate-image.js --prompt "<image prompt>" --model nano-banana --output data/images/<topic>.png
```

需要 BNBot 账号登录（token 存在 `~/.bnbot/auth.json`）。如果用户没登录过，引导登录：

```bash
node <skill-path>/scripts/bnbot-auth.js login --email user@example.com
```

用户输入邮箱收到验证码，验证后 token 自动保存到本地。后续生图不需要再登录。

**生图提示词构建规则（CRITICAL）：**

不要直接把推文内容翻译成英文当 prompt。要为图片单独设计提示词：

1. **明确画面内容** — 描述你想看到的具体画面，不是抽象概念
   - ❌ "AI security vulnerability discovery"
   - ✅ "A glowing AI brain scanning through lines of code, finding a red highlighted bug, dark background with green matrix-style text, minimal tech illustration style"

2. **指定风格** — 根据推文调性选择
   - 科技/AI 话题 → "minimal tech illustration, dark background, clean lines"
   - 数据/图表类 → "infographic style, bold numbers, contrasting colors"
   - 观点/思考类 → "conceptual illustration, metaphorical, editorial style"
   - 产品/工具类 → "product screenshot mockup, clean UI, light background"

3. **指定构图** — 适合推文配图的比例
   - 加 "16:9 aspect ratio" 或 "landscape format"
   - 避免太复杂的画面，手机上要看得清

4. **避免文字** — AI 生图里的文字通常是乱码
   - ❌ "with text saying 'AI is the future'"
   - ✅ 纯视觉，不含文字

**提示词模板：**
```
[主体描述], [风格], [色调/背景], [构图], no text, 16:9
```

**示例：**
| 推文话题 | 生图 prompt |
|---------|-------------|
| AI 找到 0-day 漏洞 | "A magnifying glass held by a robot hand examining code on a screen, red warning alerts appearing, dark cybersecurity theme, minimal illustration, 16:9" |
| 开源 vs 闭源讨论 | "Two doors side by side, one open with light streaming through, one locked with chains, clean editorial illustration, blue and orange contrast, 16:9" |
| 创业者沉默的暗黑森林 | "A lone figure standing in a dark forest made of glowing code and data streams, atmospheric, cinematic lighting, conceptual art, 16:9" |

**在草稿中展示：**
```
Image: 🎨 AI 生成
Prompt: "..."
```
用户确认后再实际调 API 生成，不要提前生成浪费 credits。

## Step 6.5: Human Score — 活人感打分 (CRITICAL)

Before showing any draft to the user, score EVERY draft for "human-ness". This is a quality gate — drafts that don't pass get rewritten.

**Score each draft 1-10 on these 5 dimensions:**

| Dimension | What to check | Red flags (score low) |
|-----------|---------------|----------------------|
| **自然度** | 读起来像人在聊天还是 AI 在汇报？ | 工整的排比、完美的并列结构、每段长度一样 |
| **观点锐度** | 有没有鲜明立场？ | "一方面...另一方面..."、"值得关注"、不敢下判断 |
| **口语感** | 会不会真有人这么说话？ | 书面语过重、"综上所述"、"由此可见" |
| **信息密度** | 每句话是否都有信息量？ | 废话填充、重复同一个意思、空洞的感叹 |
| **独特性** | 换一个人能写出一模一样的吗？ | 通稿感、任何人都能写的泛泛而谈 |

**Human Score = 5 个维度的平均分**

**Gate rules:**
- **8-10 分**: ✅ Pass — 可以展示给用户
- **6-7 分**: ⚠️ Rewrite — 指出具体问题，重写后再打分，最多重写 2 次
- **1-5 分**: ❌ Drop — 丢弃，换一个话题或完全换角度

**在每条草稿中展示打分:**

```
**Human Score**: 8.2/10 ✅
  自然度: 8 | 观点锐度: 9 | 口语感: 8 | 信息密度: 9 | 独特性: 7
```

**常见 AI 味道 checklist（写完后逐条检查）：**
- ❌ "值得注意的是" / "不得不说" / "让我们"
- ❌ 每条推文都差不多长
- ❌ 用了 emoji 列表（🔥📊🚀💡）凑排版
- ❌ 结尾是"你怎么看？"这种假互动
- ❌ 开头是"刚刚看到..."/"今天发现..."这种 AI 起手式
- ❌ 用了"game-changer"/"paradigm shift"等大词
- ❌ 所有句子都是陈述句，没有反问、省略、口语

**如果发现任何一条 checklist 命中，直接扣 2 分并重写。**

## Step 7: Comparison Mode (X vs Y)

When the user asks to compare two things (e.g. "cursor vs windsurf", "react vs vue"):

1. **Parse**: Extract TOPIC_A and TOPIC_B (split on " vs " or " versus ")
2. **Research both** in parallel:
   - `WebSearch` for "[TOPIC_A] vs [TOPIC_B] 2026"
   - `WebSearch` for "[TOPIC_A] review 2026"
   - `WebSearch` for "[TOPIC_B] review 2026"
   - Check crawl data for mentions of either
3. **Build comparison matrix**: strengths, weaknesses, use cases, community sentiment
4. **Generate 3 tweet drafts**, each with a different angle:
   - **Thread**: Structured "A vs B" comparison with verdict
   - **Hot take**: Pick a side with a strong opinion
   - **Nuanced**: "It depends on X" — useful for different audiences

### Comparison Draft Template

```
## Comparison: [TOPIC_A] vs [TOPIC_B]

### Research Summary
| | TOPIC_A | TOPIC_B |
|---|---------|---------|
| Strengths | ... | ... |
| Weaknesses | ... | ... |
| Best for | ... | ... |
| Community sentiment | ... | ... |

### Draft A: Thread (structured comparison)
> [thread content]

### Draft B: Hot take
> [opinionated single tweet]

### Draft C: Nuanced take
> [balanced perspective]

---
```

## Step 8: Present to User

Show 5 drafts (all must pass Human Score ≥ 8), then **recommend 1 best pick** with reason.

Format:
```
## ⭐ 推荐发布: [Draft N] — [topic]
[reason: convergence strength, timing, persona fit]

## 备选 2-5: [one-line summary each]
```

If `videoPreferences.enabled`, append the video section after drafts:
```
## 🎬 爆款视频 (N 条)

1. **[title]** — @author · YouTube · 120k views, 8.5k❤️
   [url]  →  "下载第1个"

2. ...
```

Ask user: pick / edit / rewrite / post / download video.

## Step 9: Publish via BNBot

When the user confirms, use `bnbot` CLI to publish. Always default to **draft mode** (fills composer, doesn't auto-post) unless user explicitly says "直接发".

### Single Tweet

```bash
# Draft mode (default) — fills composer, user clicks post
bnbot tweet post --draft "tweet text" --media "image_url"

# Direct post — only if user says "直接发"
bnbot tweet post "tweet text" --media "image_url"
```

### Thread

```bash
# Draft mode — opens composer with first tweet
bnbot tweet post --draft "first tweet text"
# Then instruct user to add remaining tweets manually

# Or if bnbot supports thread:
bnbot post-thread --texts "tweet1" "tweet2" "tweet3"
```

### Media Notes
- `--media` accepts: image URL, local file path, or base64 data URL
- Supported formats: PNG, JPG, GIF, WebP, MP4
- For GitHub OpenGraph images: pass the URL directly, e.g. `--media "https://opengraph.githubassets.com/1/owner/repo"`
- If no image, omit `--media`

### Video Download (via yt-dlp)

当用户说"下载这个视频"/"把这个视频下下来"，或者需要视频素材时：

```bash
# 下载视频（YouTube, TikTok, Instagram, Bilibili 等）
node <skill-path>/scripts/download-video.js "<video-url>"

# 指定分辨率
node <skill-path>/scripts/download-video.js "<video-url>" --format 720

# 只提取音频
node <skill-path>/scripts/download-video.js "<video-url>" --audio-only

# 指定输出路径
node <skill-path>/scripts/download-video.js "<video-url>" --output data/videos/my-video.mp4
```

视频默认保存到 `<skill-path>/data/videos/`。下载完后返回 JSON 包含文件路径。

支持的平台：YouTube, TikTok, Instagram, Bilibili, Twitter/X, Reddit, 以及 [1000+ 站点](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。

### Add Subtitles (yt-dlp → Groq Whisper → ffmpeg)

当用户说"加字幕"/"给视频加字幕"时。字幕获取优先级：
1. **yt-dlp 下载已有字幕**（YouTube 自带的，免费秒出）
2. **Groq Whisper API**（语音识别，需要 GROQ_API_KEY）

```bash
# YouTube 视频 — 自动尝试下载字幕，没有则用 Groq 识别
node <skill-path>/scripts/add-subtitles.js "<video-path>" --url "https://youtube.com/watch?v=xxx" --language en

# 本地视频 — 直接用 Groq 识别
node <skill-path>/scripts/add-subtitles.js "<video-path>" --language zh

# 只生成 .srt 字幕文件，不烧进视频
node <skill-path>/scripts/add-subtitles.js "<video-path>" --srt-only

# 用已有的 .srt 烧进视频
node <skill-path>/scripts/add-subtitles.js "<video-path>" --srt subtitles.srt
```

输出文件默认为 `<原文件名>_subtitled.mp4`。whisper 模型第一次运行会自动下载（small 约 460MB）。

**典型流程：下载视频 → 加字幕 → 发布**
```bash
node <skill-path>/scripts/download-video.js "https://youtube.com/watch?v=xxx"
node <skill-path>/scripts/add-subtitles.js data/videos/xxx.mp4 --language en
```

### AI 生图流程（用户确认后）

如果草稿的 Image 标记为 "🎨 AI 生成"，用户确认要用时再生成：

```bash
node <skill-path>/scripts/generate-image.js \
  --prompt "<the image prompt from draft>" \
  --model nano-banana \
  --output data/images/<topic-slug>.png
```

然后用生成的本地文件发推：
```bash
bnbot tweet post --draft "tweet text" --media "data/images/<topic-slug>.png"
```

### After Posting
- Confirm success to user
- If draft mode: remind user to review in browser and click post
- **Record to history** so we don't repeat this topic:

```bash
node <skill-path>/scripts/history.js add --topic "[brief topic]" --source "[source]" --url "[source url]" --text "[tweet text first 100 chars]"
```

## 定时工作流

当用户说"帮我设置定时发推"/"每 2 小时找一次热点"时：

### 方式 1：后台循环（简单，关终端就停）
```bash
node <skill-path>/scripts/schedule.js --interval 2h
# 可选加 profile
node <skill-path>/scripts/schedule.js --interval 2h --profile <skill-path>/config/profiles/<id>.json
```
每 2 小时自动采集一次，结果存到 `data/latest-crawl.json`。用户打开 Claude Code 时说"看看最新采集"就能直接用。

### 方式 2：macOS 系统服务（推荐，开机自动运行）
```bash
node <skill-path>/scripts/schedule.js --setup --interval 2h
# 然后加载服务：
launchctl load ~/Library/LaunchAgents/ai.bnbot.editor.schedule.plist
# 停止：
launchctl unload ~/Library/LaunchAgents/ai.bnbot.editor.schedule.plist
```

### 使用已采集的数据
如果 `data/latest-crawl.json` 存在且不超过设定间隔，可以直接读取而不重新采集：
```bash
cat <skill-path>/data/latest-crawl.json
```

**注意：定时采集只存数据，不自动生成推文。** 生成推文需要 Claude 参与（筛选 + 写作 + 打分），这部分在用户打开对话时完成。

## Step 10: Video → Tweet (Video Opinion Mode)

**Trigger**: 用户粘贴一个 YouTube/TikTok URL，或说"这个视频写条推文"/"看看这个视频讲了什么"

### 流程

1. **下载字幕**（不需要下载视频本身）：
```bash
node <skill-path>/scripts/add-subtitles.js "<any-video-path>" --url "<video-url>" --language en --srt-only
```
如果有字幕文件就够了。没有字幕才下载视频做语音识别。

2. **读取字幕内容**，提取：
   - 核心观点（speaker 在说什么）
   - 关键数据/引用
   - 有争议或有趣的点

3. **下载视频 + 加中文字幕**（默认带视频发布）：
```bash
node <skill-path>/scripts/download-video.js "<video-url>"
node <skill-path>/scripts/add-subtitles.js "<downloaded-video>" --url "<video-url>" --language zh --source en --font-size 12
```

4. **生成推文 — 一句话就够**。视频本身就是内容，推文只需要一句有观点的引导语。
   - ✅ "Karpathy 在 Tesla 想招人得恳求 Musk，想留人也得恳求 Musk。"
   - ❌ 长篇大论分析视频内容（视频自己会说）
   - 生成 3 条一句话草稿，角度不同

5. **发布时默认带视频**：
```bash
bnbot tweet post --draft "一句话推文" --media "<subtitled-video-path>"
```

6. 所有草稿必须过 **Human Score ≥ 8** 和 **persona.md** 规则

### 注意
- **推文是引导语，不是摘要**。视频已经有完整内容了，推文只负责勾住人点开
- 一句话，最多两句。不要写段落
- 不要说"看了个视频说..."，直接输出观点
- 如果视频太长（>10分钟），只关注最抓人的一个点

## Notes

- Always crawl fresh — no stale data (unless using scheduled latest-crawl.json)
- Specific topic request → skip crawl, use `WebSearch`
- "More" / "different angle" → regenerate with new perspectives
- Customize: `config/sources.json` for sources, `config/profiles/*.json` for account voice, `references/persona.md` for universal writing rules
- Default to draft mode for safety — never auto-post without explicit user consent
