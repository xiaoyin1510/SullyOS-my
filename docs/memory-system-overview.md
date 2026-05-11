# 记忆系统概览

本项目包含两套并行运行的记忆系统：传统日度/月度总结（Legacy）和向量化记忆宫殿（主系统）。

---

## 系统一：传统日度/月度总结

### 数据结构

- `memories: MemoryFragment[]` — 每日记录（date + mood + summary）
- `refinedMemories: Record<string, string>` — LLM 生成的月度精炼总结
- `activeMemoryMonths: string[]` — 哪些月份的详细日志要注入上下文

### 输入

- **日度记录**：`MemoryFragment`，含 `date`、`mood`、`summary`
- **月度总结**：用户在 `MemoryArchivist` 组件手动点"生成"→ `handleRefineMonth()` 将该月所有日度记录送给 LLM 做精炼（temp=0.3）

### 调用/输出（context.ts → ContextBuilder）

- `buildRoleSettingsContext(char)`（用于情绪评估）：注入全部月度总结 + 当月日度记录
- `buildCoreContext(char, user, true)`（用于聊天）：
  - 月度总结 → "长期核心记忆"
  - `activeMemoryMonths` 对应的详细日志 → "激活的详细回忆"
- AI 可以用 `[[RECALL: YYYY-MM]]` 语法主动拉取某个月的详细日志

### 管理

- 用户可切换哪些月份"激活"（控制 token 用量）
- 可编辑/重新精炼月度总结

---

## 系统二：向量化记忆宫殿（主系统，仿大脑结构）

### 一、仿大脑结构——七个房间

| 房间 | 模拟脑区 | 职责 | 容量 | 衰减 |
|------|---------|------|------|------|
| **客厅** living_room | 海马体 | 日常闲聊、近期互动 | 200 | 快衰减（0.9972/h，1天剩6.5%） |
| **卧室** bedroom | 新皮质 | 亲密情感、深层羁绊 | 无限 | 慢衰减（0.9995/h） |
| **书房** study | 前额叶皮质 | 工作、学习、技能 | 无限 | 慢衰减 |
| **用户房** user_room | 颞顶联合区 | 用户个人信息、习惯 | 无限 | 慢衰减 |
| **自我房** self_room | 默认模式网络 | 角色自我认同演化 | 无限 | **永不衰减** |
| **阁楼** attic | 杏仁核-海马 | 未消化的困惑/创伤 | 无限 | **永不衰减**（潜伏） |
| **窗台** windowsill | 多巴胺奖赏系统 | 期盼、目标、愿望 | 无限 | **永不衰减** |

### 二、存入逻辑（Input Pipeline）

```
聊天消息流
    ↓
[最近200条] ← 热区，直接在上下文中，不处理
[缓冲N条]  ← 累积≥100条时触发处理（每次只做1次LLM调用）
[已处理]   ← 高水位标记之前的
```

#### Step 1 — 缓冲触发

- `BUFFER_THRESHOLD = 100`，累积够了才处理
- `PROCESS_RATIO = 0.85`，处理85%，留15%尾部保持上下文连续
- 高水位标记（localStorage）记录每角色处理进度，防重复

#### Step 2 — LLM 提取记忆（extraction.ts）

- 以角色第一人称视角叙事，用户称"TA"
- LLM 输出 JSON 数组，每条含：
  - `content`：第三人称叙事
  - `room`：分配到哪个房间
  - `importance`：1-10（越高叙事越完整，含因→事→反应）
  - `mood`：happy/sad/angry/anxious/tender 等12种
  - `tags`：2-5个关键词

#### Step 3 — 向量化（vectorStore.ts）

- 批量调用 Embedding API（batch=20），模型如 `text-embedding-3-small`，1024维
- **去重**：余弦相似度 > 0.9 视为重复，跳过
- 写入 IndexedDB：`MemoryNode`（embedded=true）+ `MemoryVector`（float[]）

#### Step 4 — 链接构建（links.ts）

- 自动规则（无需LLM）：
  - **时间链**：24h内创建 → strength 0.3-0.5
  - **情绪链**：相同mood → strength 0.4
- LLM 分类（轻量模型，temp=0.2）：
  - 类型：`causal` / `person` / `metaphor`
  - 强度 0.3-0.8

#### Step 5 — 巩固：短期→长期（consolidation.ts）

- 客厅→卧室晋升条件：
  - importance ≥ 8 → 立即晋升
  - importance ≥ 6 且 age > 24h → 时间成熟晋升
  - accessCount ≥ 3 → 频繁回忆晋升
- 客厅超200条 → 按有效重要性（importance × 衰减^小时）淘汰最低者到**阁楼**

### 三、检索逻辑（Retrieval Pipeline）

```
最近3条消息(≤500字) → 查询构建
        ↓
   ┌────┴────┐
向量搜索(85%)  BM25关键词(15%)    ← 混合检索
   └────┬────┘
        ↓ 融合分数
   房间权重加权打分               ← 每个房间不同权重侧重
        ↓
   扩散激活(Spreading Activation) ← 沿链接找关联记忆，最多+5条
        ↓
   情绪启动(Mood Priming)        ← 匹配当前mood的记忆×1.3
        ↓
   反刍检查(Rumination)          ← 概率性从阁楼冒出1条创伤记忆
        ↓
   格式化输出 → 注入System Prompt
```

#### 房间权重差异

| 房间 | 相似度权重 | 时近性权重 | 重要性权重 |
|------|-----------|-----------|-----------|
| 客厅 | 0.50 | 0.30 | 0.20 |
| 卧室 | 0.60 | 0.10 | 0.30 |
| 阁楼 | 0.70 | 0.00 | 0.30 |
| 书房/用户房/自我房/窗台 | 0.55 | 0.15 | 0.30 |

#### 扩散激活（按角色性格）

- **感性型**：情绪链×1.0, 人物链×0.6
- **叙事型**：时间链×1.0, 人物链×0.8
- **意象型**：隐喻链×1.0, 情绪链×0.5
- **分析型**：因果链×1.0, 时间链×0.4

#### 输出格式

检索结果格式化为 Markdown，注入到系统提示词：

```markdown
### 记忆宫殿

**[卧室 · 亲密情感]** (2026-03-20, 重要性: 8)
TA第一次对我说……我当时心里……

**[客厅 · 日常闲聊]** (2026-03-19, 重要性: 5)
今天和TA聊了……

> **窗台期盼**:
> - ✨ 期盼: 希望能一起……
> - 🔒 锚点: 长期心愿……
```

上限12条记忆，每个话题盒最多展开3条兄弟记忆。

### 四、认知消化过程（高级仿脑机制）

#### 认知消化（digestion.ts）

每 50 轮聊天自动触发 + 随时可手动触发（无冷却限制）。触发后在聊天界面弹窗反馈消化结果。角色以第一人称反思：

- 阁楼创伤 → 解决（移入卧室）/ 加深 / 淡化
- 窗台期盼 → 达成（移入卧室）/ 失望（移入阁楼）
- 书房知识 → 内化为自我认同（移入自我房）

#### 期盼生命周期（anticipation.ts）

```
active(新建) → anchor(7天+，心理锚点) → fulfilled / disappointed
```

#### 共激活学习

多条记忆被同时检索时，它们之间的链接强度 +0.05（最大1.0），模拟记忆网络强化。

---

## 系统对比

| | 传统日/月总结 | 向量化记忆宫殿 |
|---|---|---|
| **输入** | 旧 MemoryFragment 批量迁移 | 实时聊天缓冲 → LLM提取 |
| **存储** | 转为 MemoryNode（桥梁） | IndexedDB + 向量 + 链接图 |
| **检索** | 无主动检索 | 混合搜索 + 扩散激活 + 情绪启动 |
| **输出** | 迁移后融入新系统 | Markdown 注入 System Prompt |
| **仿脑** | 无 | 7脑区 + 衰减 + 巩固 + 消化 + 反刍 |
| **状态** | 遗留/迁移用 | **主力系统** |

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `types.ts` | 所有类型定义 |
| `db.ts` | IndexedDB CRUD |
| `pipeline.ts` | 主编排（存入+检索） |
| `extraction.ts` | LLM记忆提取 |
| `vectorStore.ts` | 向量化+去重 |
| `links.ts` | 链接构建 |
| `consolidation.ts` | 短期→长期晋升 |
| `hybridSearch.ts` | 向量+BM25融合 |
| `bm25.ts` | 关键词搜索 |
| `activation.ts` | 扩散激活 |
| `priming.ts` | 情绪启动+反刍 |
| `formatter.ts` | 输出格式化 |
| `digestion.ts` | 认知消化 |
| `anticipation.ts` | 期盼生命周期 |
| `migration.ts` | 旧格式迁移 |
