# DiaryMaster

**DiaryMaster** 是一款本地 Markdown 日记助手：用对话写笔记、改笔记，并在右侧实时看到 Agent 的每一步操作（读文件、局部修改、写入等）。笔记保存在你电脑上的 `workspace/` 目录，不会随 Git 仓库上传。

> 适合：按日期写日记、让 AI 帮忙整理/补全、需要看清「Agent 正在干什么」的用户。

---

## 功能概览

### 界面

- **三栏布局**：左侧文件树、中间编辑/对比、右侧 Agent 对话。
- **编辑 / 变更**：中间栏可手动改 Markdown；Agent 或手动保存后可查看行级 diff（绿增红删）。
- **多 Session**：Agent 面板切换/新建会话；支持**重命名**；首轮对话结束后由 AI **自动生成会话标题**。
- **模型与思考**：输入框底栏可选 **V4 Flash / V4 Pro** 与**思考模式**（偏好存浏览器，不绑 Session）；开启思考时流式展示思考链。
- **上下文圆环**：底栏显示当前模型上下文占用（优先 API `prompt_tokens`，无数据时字符估算）。

### Agent 能力


| 能力            | 说明                                                                      |
| ------------- | ----------------------------------------------------------------------- |
| **局部修改**      | 默认用 `edit_file` 只改匹配的一小段，避免整篇重写误伤原文。                                    |
| **新建 / 长文写入** | 新建文件或短文可用 `write_file`；已有长文会提示改用局部修改。                                   |
| **跨文件阅读**     | `read_file` / `list_files`，可汇总多篇日记（如周总结）。                               |
| **执行过程可见**    | 流式展示 `[agent]` 模型调用、`[read_file]`、`[edit_file]` 等步骤；`read_file` 仅预览前几行。 |
| **多轮对话**      | 同一 Session 内连续追问；每轮可 **退回**（撤销该轮及之后的对话与文件变更）。                           |


### 文件与数据

- 笔记仅为 `workspace/` 下的 `.md` 文件（可自行按日期命名，如 `2025-05-16.md`）。
- Session、对话记录、变更历史在 `data/`（本地 JSON，已加入 `.gitignore`）。
- 所有 Session **共用**同一 `workspace/`；切换 Session 不会切换笔记目录。

---

## 环境要求

- Python 3.11+
- [DeepSeek](https://platform.deepseek.com/) API Key（在应用内 **设置** 中填写，或使用系统环境变量 `DEEPSEEK_API_KEY`）
- 本机已安装 Git（可选，当前版本未集成 Git 功能）

---

## 安装与配置

### 1. 克隆仓库

```bash
git clone https://github.com/adoooore/DiaryMaster.git
cd DiaryMaster
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 配置 API Key

在 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 API Key 后，任选一种方式：

#### 方式 A：应用内设置（推荐，无需改代码）

1. 执行 `python run.py` 并打开浏览器
2. 点击顶栏 **⚙ 设置**
3. 粘贴 API Key 并 **保存**

密钥保存在本机 `data/user_settings.json`（已在 `.gitignore` 的 `data/` 目录下，不会提交到 Git）。

#### 方式 B：系统环境变量（可选，适合高级用户或脚本）

仅在 **未** 于设置页保存密钥时生效：启动后进程会读取 `DEEPSEEK_API_KEY` 作为兜底。若 `data/user_settings.json` 里已有密钥，会**覆盖**进程内环境变量，设置页保存的内容优先。

**Windows PowerShell（当前终端）**

```powershell
$env:DEEPSEEK_API_KEY="你的密钥"
python run.py
```

**macOS / Linux**

```bash
export DEEPSEEK_API_KEY="你的密钥"
python run.py
```

#### 检查是否生效

启动后若对话提示未配置 API Key，请打开设置页保存，或检查环境变量。可在项目根目录执行：

```bash
python -c "from backend.config import get_api_key; print('OK' if get_api_key() else 'MISSING')"
```

输出 `OK` 即表示配置成功。

### 4. 准备工作区（首次）

启动后会自动创建 `workspace/`。你也可以手动放入自己的 `.md` 日记，或保留示例文件 `welcome.md`。

---

## 启动

在项目根目录执行：

```bash
python run.py
```

浏览器打开：**[http://127.0.0.1:8765](http://127.0.0.1:8765)**

### 可选环境变量


| 变量                 | 默认值         | 说明                               |
| ------------------ | ----------- | -------------------------------- |
| `DIARYMASTER_HOST` | `127.0.0.1` | 监听地址                             |
| `DIARYMASTER_PORT` | `8765`      | 端口                                 |
| `DEEPSEEK_API_KEY` | —           | DeepSeek API 密钥（可选；见「配置 API Key」，无本机设置时作为兜底） |


示例（PowerShell 换端口）：

```powershell
$env:DIARYMASTER_PORT="9000"
python run.py
```

### 端口被占用（Windows）

```powershell
netstat -ano | findstr ":8765"
taskkill /PID <PID> /F
```

---

## 使用指南

### 1. 浏览与手写日记

1. 左侧点击某个 `.md` 文件。
2. 在中间栏编辑内容。
3. 点击 **保存** 写入磁盘（会记录一次「手动」变更，可进 **变更** 视图查看 diff）。

### 2. 让 Agent 改日记

在右侧输入自然语言，例如：

- `帮我在今天日记里加一条：晚上吃了火锅。`
- `把 2025-05-14.md 里「优化前端文件树」改成「优化文件树与步骤展示」。`

发送后你会先看到**步骤时间线**（读取、局部修改等），再出现助手文字回复。若改动了当前打开的文件，会自动进入 **变更** 视图。

### 3. 跨文件 / 周总结

示例：

```text
请根据工作区里 2025-05-12 到 2025-05-16 的日记，写一篇本周总结，写入 week-2025-05-16.md
```

Agent 会先读取相关日记，再写入新文件。

### 4. 模型、思考与上下文

- **模型**：底栏下拉选择 `V4 Flash`（默认）或 `V4 Pro`；选择会保存在本机 `localStorage`。
- **思考**：勾选「思考」后，模型在回复前会流式输出思考过程（步骤区 `思考中…`）；关闭则不展示思考链。
- **上下文圆环**：悬停可查看已用 / 上限 tokens；标注 **API 计量** 或 **字符估算**。

### 5. Session 与标题

- **新建 Session**：开始一段新对话（旧 Session 仍可在下拉框切回）。
- **重命名**：顶栏 **重命名** 可改当前会话名；改名后不会再被自动标题覆盖。
- **自动标题**：每个 Session **第一轮**对话结束后，会额外调用一次模型生成简短会话名（步骤里显示 `[generate_title]`）。

### 6. 撤销与回退


| 操作                | 作用                         |
| ----------------- | -------------------------- |
| 中间栏 **撤销**        | 撤销**当前文件**最近一次变更（含后续相关记录）。 |
| 对话区 **退回**（每轮标题旁） | 回退到该轮之前：撤销该轮及之后所有对话与文件变更。  |


### 7. 建议用法

- 日记文件按日期命名，便于 Agent 查找与汇总。
- 改已有内容时，Agent 会优先 **局部修改**；你可在步骤里确认是否出现 `[edit_file]` 而非整篇 `[write_file]`。
- `workspace/` 与 `data/` 为私人数据，已在 `.gitignore` 中忽略，**请勿提交到 Git**。

---

## 数据存储位置


| 数据                | 路径                        | 提交 Git |
| ----------------- | ------------------------- | ------ |
| 日记 Markdown       | `workspace/`              | 否      |
| Session / 对话 / 变更 | `data/sessions/*.json`    | 否      |
| 当前 Session ID     | `data/active_session.txt` | 否      |
| API Key           | `data/user_settings.json` | 否      |


刷新页面或重启后端后，上述本地数据都会保留。

---

## 项目结构

```
DiaryMaster/
├── backend/          # FastAPI、LangChain Agent、会话与补丁逻辑
├── web/              # 前端静态页面
├── workspace/        # 日记工作区（本地，git 忽略）
├── data/             # Session 数据（本地，git 忽略）
├── run.py            # 推荐启动入口
└── requirements.txt
```

---


## 许可证

本项目采用 **[MIT License](LICENSE)**。

- **个人 / 商用均可**，可修改、可再分发、可闭源集成。
- **唯一硬性要求**：再分发时须保留版权声明与 MIT 全文，让他人知道项目中包含本作品（署名）。


| 使用场景            | 是否允许           |
| --------------- | -------------- |
| 个人学习、自用         | ✅              |
| 修改后商用、收费 SaaS   | ✅（须保留 LICENSE） |
| 去掉版权与 MIT 声明后分发 | ❌              |


- 英文全文：[LICENSE](LICENSE)
- 中文说明：[LICENSE-CN.md](LICENSE-CN.md)

GitHub 仓库 License 可选 **MIT**。