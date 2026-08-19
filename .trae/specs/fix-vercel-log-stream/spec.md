# 修复 Vercel 管理面板日志流断开问题 - Product Requirement Document

## Overview
- **Summary**: 修复部署在 Vercel Serverless 环境下的 STC 网站管理面板中，实时日志流（SSE）频繁断开的问题。通过优化 SSE 心跳机制、增加增量日志获取接口、改进前端重连策略，使日志流在 Vercel 环境下稳定可用。
- **Purpose**: 解决 Vercel Serverless 函数执行时间限制（30秒）导致 SSE 长连接被强制断开的问题，同时解决多实例环境下日志丢失的问题，让管理员能持续稳定地查看实时服务器日志。
- **Target Users**: 网站管理员、超级管理员

## Goals
- 日志流在 Vercel 环境下能够持续运行，用户感知不到频繁断开
- 重连过程中不丢失任何日志条目
- 前端显示连接状态（连接中/已连接/重连中）
- 统一前端两套日志流实现，避免冲突

## Non-Goals (Out of Scope)
- 不引入 Redis 或其他外部消息队列服务
- 不重构为 WebSocket 方案
- 不改变现有的日志数据结构（仅增加唯一ID字段）
- 不修改非日志相关的功能

## Background & Context
当前系统使用 Server-Sent Events (SSE) 实现实时日志流：
- 后端：`server.js` 中维护 `sseClients` 数组，通过 `/api/logs/sse` 端点推送日志
- 前端：`admin.js` 中有两套独立的日志流实现（CMDLog 对象和 toggleLogStream 函数）
- Vercel 配置：`vercel.json` 中 `maxDuration: 30`，即 Serverless 函数最长执行30秒

### 问题根因分析
1. **Vercel Serverless 超时限制**：函数最多执行30秒，SSE 长连接会被强制终止
2. **多实例无状态问题**：Vercel 可能将请求路由到不同实例，内存中的 `sseClients` 不共享，导致新日志无法推送到所有连接
3. **前端重连不完善**：虽然有重连机制，但重连时会丢失断开期间产生的日志
4. **两套实现冲突**：CMDLog.connectToServerLogs 和 toggleLogStream 都在连接日志流，可能造成资源竞争

## Functional Requirements
- **FR-1**: 每条服务器日志具有唯一可递增的 ID（时间戳+序号）
- **FR-2**: 日志查询 API 支持 `since` 参数，返回指定 ID 之后的增量日志
- **FR-3**: SSE 端点在连接约25秒时主动发送重连提示，让客户端优雅重连（避开Vercel的30秒硬超时）
- **FR-4**: SSE 心跳间隔调整为 10 秒，确保连接活跃
- **FR-5**: 前端日志流重连时，先通过增量接口获取断开期间的日志，再建立 SSE 连接
- **FR-6**: 前端统一日志流实现，移除重复代码
- **FR-7**: 前端显示连接状态指示器（已连接/重连中/断开）

## Non-Functional Requirements
- **NFR-1**: 日志延迟不超过 5 秒（正常连接状态下）
- **NFR-2**: 重连过程用户无明显感知（自动补全日志）
- **NFR-3**: 连接断开后 3 秒内开始重连
- **NFR-4**: 向后兼容，不破坏现有 API 接口

## Constraints
- **Technical**: 必须兼容 Vercel Serverless 环境（只读文件系统、30秒超时、多实例无状态）
- **Technical**: 不引入新的外部依赖服务（如 Redis、数据库等）
- **Business**: 保持现有管理面板 UI 风格一致
- **Dependencies**: 基于现有的 Express.js + 原生前端实现

## Assumptions
- Vercel Serverless 函数的 maxDuration 保持 30 秒配置
- 日志量在可接受范围内（每秒不超过10条）
- 管理员可以接受重连期间极短的日志延迟（< 5秒）
- 浏览器支持 Fetch API + ReadableStream

## Acceptance Criteria

### AC-1: 日志唯一 ID
- **Given**: 服务器产生一条新日志
- **When**: 日志被添加到 serverLogs 数组
- **Then**: 该日志具有唯一的、可递增比较的 id 字段
- **Verification**: `programmatic`
- **Notes**: id 格式建议为时间戳+序号，如 `1692345678901-001`

### AC-2: 增量日志查询
- **Given**: 已存在若干条日志，最后一条 ID 为 lastId
- **When**: 调用 GET /api/logs?since=lastId
- **Then**: 仅返回 ID 大于 lastId 的日志条目
- **Verification**: `programmatic`
- **Notes**: 不传 since 参数时返回全部日志，保持向后兼容

### AC-3: SSE 优雅重连
- **Given**: SSE 连接已建立并正常运行
- **When**: 连接时间达到约 25 秒
- **Then**: 服务器主动发送一条 type: 'reconnect' 的消息，提示客户端准备重连
- **Verification**: `programmatic`
- **Notes**: 25秒 < 30秒 Vercel 超时，确保优雅断开

### AC-4: 前端增量补全日志
- **Given**: 日志流因超时断开，断开期间产生了 N 条新日志
- **When**: 前端发起重连
- **Then**: 前端先调用 /api/logs?since=lastLogId 获取缺失的日志并显示，再建立 SSE 连接
- **Verification**: `human-judgment`
- **Notes**: 用户不会看到日志断层

### AC-5: 连接状态显示
- **Given**: 用户打开管理面板的日志区域
- **When**: 连接状态变化（连接中/已连接/重连中/断开）
- **Then**: UI 上有明确的状态指示
- **Verification**: `human-judgment`

### AC-6: Vercel 环境稳定运行
- **Given**: 网站部署在 Vercel 上
- **When**: 管理员打开日志流并持续观察 5 分钟
- **Then**: 日志持续更新，没有明显的断开感，日志完整不丢失
- **Verification**: `human-judgment`

### AC-7: 向后兼容
- **Given**: 现有调用 /api/logs 和 /api/logs/sse 的代码
- **When**: 使用旧方式调用（不带 since 参数等）
- **Then**: 行为与之前保持一致，不报错
- **Verification**: `programmatic`

## Open Questions
- [ ] 是否需要在管理面板上增加"手动刷新日志"按钮？
- [ ] 日志保留数量（当前 MAX_LOG_COUNT=1000）是否需要调整？
