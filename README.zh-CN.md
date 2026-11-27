# agy-NOV

[English](./README.md)

**面向 Google Antigravity 2.0 的一站式模块化原生 MCP App 工作台。**  
把 PR 级 Diff 行内批注审阅、改前零 Git 快照与密钥防火墙、上下文透视（X-Ray）、视觉原型画布、代码锚定长期记忆图谱，以及可选的手机/IM 远程审批集成进**同一个原生插件**——**每个模块随时一键开关，用什么开什么**。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node-%3E%3D20-339933.svg)](https://nodejs.org)
[![零 ASAR / 零 CDP](https://img.shields.io/badge/%E9%9B%B6%E4%BE%B5%E5%85%A5-%E9%9B%B6%20ASAR%20%2F%20%E9%9B%B6%20CDP-0ea5e9.svg)](#架构设计)
[![MCP Apps SEP-1865](https://img.shields.io/badge/Protocol-MCP%20Apps%20(SEP--1865)-6366f1.svg)](#架构设计)

---

## 为什么把 6 个能力合进一个模块化工作台？

同时安装 6 个独立插件会常驻 6 个 Node 进程、重复加载 6 份前端运行时、每次工具调用并发拉起 2–4 个 Hook 进程，还会把 25+ 个模型工具定义持续塞进每一轮对话上下文里。

**`agy-NOV` 将 6 大高频能力收口为一个轻量的原生插件，并内置实时「Modules 模块中心」**：
- **1 个常驻 MCP 进程 + 1 个统一 Hook 分发器 + 1 份单文件多主题界面**。
- **模型工具动态按需注册**：关闭的模块会从 `tools/list` 实时撤下（零额外 Token 占用），Hook 收到事件也会第一时间短路跳过。
- **默认纯本地零联网**：`Remote` 模块**默认彻底关闭**——未开启时不监听任何端口、不开启后台轮询、不发起任何外部网络请求。
- **零 ASAR 魔改、零 CDP 注入**：100% 基于 Antigravity 2.0 官方 MCP Apps（`aux_pane` 右侧栏 + `global` 全局视图）、Lifecycle Hooks 与 Skills 规范构建，客户端升级后稳健可用。

---

## 6 大可独立开关模块

| 模块 | 默认状态 | 隐私与网络 | 模型工具数 | 挂载 Hook | 核心能力 |
| :--- | :---: | :--- | :---: | :--- | :--- |
| **Diff 审阅台**（`review`） | **开启** | 100% 本地离线 | 2 | `PostToolUse`, `Stop` | 类 GitHub PR 的工作区/暂存区 Diff 审阅、逐行分类批注，一键拼装结构化 `file:line` 修复指令发回给 Agent。 |
| **安全护盾与快照**（`guard`） | **开启** | 100% 本地离线 | 4 | `PreToolUse` | 拦截 `.env`/SSH/密钥外泄与高危命令；AI 改文件前自动落盘独立快照（不弄脏 Git 历史），支持一键对比回滚。 |
| **上下文透视**（`xray`） | **开启** | 100% 本地离线 | 4 | `PostToolUse`, `Stop` | 查看每轮真实缓存命中与新鲜 Token 消耗、定位高耗工具、一键侧栏打开修改文件、支持中英文 BM25 跨会话全文检索。 |
| **视觉批注画布**（`canvas`） | 关闭 | 100% 本地离线 | 4 | 无 | 在隔离沙盒中预览 HTML 原型、SVG 架构图、Slides、Markdown 与图片，直接打点框选写修改意见并回传给 Agent。 |
| **代码锚定记忆**（`mem`） | 关闭 | 100% 本地离线 | 3 | `SessionStart`, `Stop` | 将架构决策锚定到源码文件 SHA-256 哈希，新会话自动召回相关上下文，代码改动后自动标注过期漂移记忆。 |
| **手机与 IM 遥控**（`remote`） | 关闭 | 按需联网（默认关） | 4 | `PreToolUse`, `Stop` | 开启后支持局域网手机 PWA 及 Telegram / 飞书 / 钉钉 / 企微 / Slack / Discord 完成推送、高危命令远程审批与后台派单。 |

### 一键预设档位

- **`core`（默认轻量核心）**：开启 `review` + `guard` + `xray`，100% 离线，仅暴露 12 个精炼模型工具（含 `nov_open` 与 `nov_status`）。
- **`local-all`（纯本地五件套）**：开启全部 5 个本地模块，`remote` 保持彻底关闭。
- **`full`（全功能六件套）**：开启全部 6 个模块（含手机与 IM 远程审批网关）。
- **`minimal`（极简安全网）**：仅开启 `guard`（共 6 个模型工具），把上下文开销压到最低。

---

## 快速上手

### 1. 安装到 Antigravity 2.0

```bash
agy plugin install https://github.com/tone-leh/agy-NOV
```

或手动克隆到插件目录：

```bash
git clone https://github.com/tone-leh/agy-NOV.git ~/.gemini/config/plugins/agy-nov
```

在右侧栏 `+` 菜单或左侧全局栏打开 **agy-NOV**，点击右上角 **Modules** 即可随时自由勾选模块或切换预设。

### 2. 离线沙盒零侵入预览（完全不碰日常客户端）

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci
npm run workbench
```

随后打开 `http://127.0.0.1:4399`，即可在内置模拟器中用合成演示数据体验全部 6 个模块、深浅主题切换、侧栏（480px）/全屏（1160px）视图与宿主事件检视器。

### 3. 命令行管理模块开关

```bash
node dist/cli.cjs status
node dist/cli.cjs enable canvas
node dist/cli.cjs disable xray
node dist/cli.cjs preset local-all
node dist/cli.cjs doctor
```

---

## 架构设计

```text
Antigravity 2.0 宿主（Desktop / CLI / IDE）
 ├── 单一 MCP 服务（dist/server.cjs）
 │    ├── 常驻入口：nov_open、nov_status、nov_app_{get_config,set_module,apply_preset}
 │    ├── 动态工具开关（RegisteredTool.enable / .disable 实时刷新 tools/list）
 │    └── 统一单文件 UI 资源：ui://agy-nov/app.html（远低于 10 MiB 上限，自动跟随深浅色）
 ├── 统一 Hook 分发器（dist/hook.cjs）
 │    ├── 先只读 <dataDir>/config.json，关闭的模块 O(1) 短路零副作用
 │    └── 归一化 camelCase 与 snake_case 载荷，覆盖 SessionStart / PreToolUse / PostToolUse / Stop
 └── 分模块隔离数据目录（<dataDir>/modules/<moduleId>/，目录 0700 / 文件 0600）
```

---

## 配套独立项目

- **[agy-session-guard（领航哨）](https://github.com/tone-leh/agy-session-guard)**：面向自定义 `/compact` 压缩阈值、草稿保险箱与对话书签的独立 CDP 增强伴侣（为确保 `agy-NOV` 保持 100% 零 CDP 纯原生承诺而独立维护）。

## 开源协议

MIT © [tone-leh](https://github.com/tone-leh)
