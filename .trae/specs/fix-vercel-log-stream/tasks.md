# 修复 Vercel 管理面板日志流断开问题 - The Implementation Plan

## [x] Task 1: 后端 - 日志增加唯一 ID 及增量查询支持
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `addServerLog` 函数，为每条日志生成唯一递增 ID（格式：`Date.now()-序号`，同一毫秒内多条日志用序号区分）
  - 修改 `GET /api/logs` 端点，支持 `since` 查询参数，返回 ID 大于 since 的日志
  - 保持向后兼容：不传 since 时返回全部日志
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-7
- **Test Requirements**:
  - `programmatic` TR-1.1: 新产生的日志包含 id 字段，且 id 是唯一且递增的
  - `programmatic` TR-1.2: `GET /api/logs?since=<lastId>` 仅返回 id 大于 lastId 的日志
  - `programmatic` TR-1.3: `GET /api/logs`（无 since）返回全部日志，与原行为一致
- **Notes**: 使用闭包变量维护同一毫秒内的序号计数器

## [x] Task 2: 后端 - SSE 端点优化（优雅重连 + 心跳调整）
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - SSE 心跳间隔从 15 秒调整为 10 秒
  - 新增连接计时，约 25 秒时主动发送 `type: 'reconnect'` 消息，提示客户端重连
  - 发送 reconnect 消息后，等待一小段时间再结束响应（给客户端处理时间）
  - 确保 Vercel 的 30 秒超时前连接已优雅关闭
- **Acceptance Criteria Addressed**: AC-3, AC-7
- **Test Requirements**:
  - `programmatic` TR-2.1: SSE 连接建立后，每 10 秒收到一次心跳注释（`: heartbeat`）
  - `programmatic` TR-2.2: 连接约 25 秒时收到一条 type 为 'reconnect' 的消息
  - `programmatic` TR-2.3: 收到 reconnect 消息后连接正常关闭，不报错
- **Notes**: 25秒是安全阈值，Vercel maxDuration 为 30秒，留 5 秒余量

## [x] Task 3: 前端 - 统一日志流实现 & 增量补全策略
- **Priority**: high
- **Depends On**: Task 1, Task 2
- **Description**: 
  - 统一前端两套日志流代码（CMDLog.connectToServerLogs 和 toggleLogStream），提取为单一的 LogStreamManager
  - 记录最后收到的日志 ID（lastLogId）
  - 重连时先调用 `GET /api/logs?since=lastLogId` 获取缺失的日志并追加显示
  - 然后再建立 SSE 连接接收实时日志
  - 优化重连策略：立即重连（不需要等5秒），最多连续失败3次后降级为轮询
- **Acceptance Criteria Addressed**: AC-4, AC-6, AC-7
- **Test Requirements**:
  - `programmatic` TR-3.1: 重连时会先调用 /api/logs?since=xxx 获取增量日志
  - `programmatic` TR-3.2: 获取到的增量日志按顺序追加到显示区域
  - `human-judgement` TR-3.3: 用户观察不到日志断层，重连过程平滑
  - `programmatic` TR-3.4: 只有一套日志流在运行，没有重复连接
- **Notes**: 保持 CMDLog 的终端样式日志和管理面板的日志区域都能正常工作

## [x] Task 4: 前端 - 连接状态指示器
- **Priority**: medium
- **Depends On**: Task 3
- **Description**: 
  - 在管理面板的日志区域添加连接状态指示
  - 状态包括：连接中（黄色）、已连接（绿色）、重连中（橙色）、已断开（红色）
  - 状态变化时更新显示文字和颜色
  - CMDLog 终端也显示连接状态
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `human-judgement` TR-4.1: 管理面板日志区域有清晰的连接状态指示
  - `human-judgement` TR-4.2: 状态变化时指示及时更新（颜色/文字）
  - `human-judgement` TR-4.3: CMDLog 终端也能看到连接状态
- **Notes**: 状态指示器样式需与现有 UI 风格一致

## [x] Task 5: 本地测试 & Vercel 部署验证
- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3, Task 4
- **Description**: 
  - 本地启动服务，测试日志流功能是否正常
  - 验证增量查询 API 正确性
  - 验证 SSE 重连机制
  - 确认部署到 Vercel 后日志流稳定运行
- **Acceptance Criteria Addressed**: AC-6, AC-7
- **Test Requirements**:
  - `programmatic` TR-5.1: 本地环境 /api/logs?since= 参数工作正常
  - `human-judgement` TR-5.2: 本地日志流连续运行 2 分钟以上，日志完整不丢失
  - `human-judgement` TR-5.3: Vercel 环境日志流连续运行 5 分钟以上，用户感知不到频繁断开
  - `programmatic` TR-5.4: 旧版 API 调用方式（不带 since）仍然正常工作
- **Notes**: Vercel 测试需确认部署成功后进行
