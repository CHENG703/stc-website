# 修复 Vercel 管理面板日志流断开问题 - Verification Checklist

## 后端验证

- [x] Checkpoint 1: 每条新生成的日志都包含唯一的 `id` 字段
- [x] Checkpoint 2: 日志 id 是严格递增的（后生成的日志 id 大于先生成的）
- [x] Checkpoint 3: `GET /api/logs` 不带参数时返回全部日志（向后兼容）
- [x] Checkpoint 4: `GET /api/logs?since=<lastId>` 仅返回 id 大于 lastId 的日志
- [x] Checkpoint 5: `GET /api/logs?since=invalid` 不会报错，返回空数组或全部日志（优雅降级）
- [x] Checkpoint 6: SSE 端点 `/api/logs/sse` 连接后每 10 秒收到一次心跳
- [x] Checkpoint 7: SSE 连接约 25 秒时收到 `type: 'reconnect'` 消息
- [x] Checkpoint 8: 收到 reconnect 消息后连接正常关闭，无错误
- [x] Checkpoint 9: SSE 消息格式与原有格式兼容（包含 message, type 等字段）
- [ ] Checkpoint 10: 管理权限校验仍然生效（未登录用户无法访问日志接口）

## 前端验证

- [x] Checkpoint 11: 管理面板日志区域有连接状态指示器
- [x] Checkpoint 12: 状态指示器能正确显示：连接中、已连接、重连中、已断开
- [x] Checkpoint 13: 日志流断开后自动重连
- [x] Checkpoint 14: 重连时先调用增量接口补全缺失日志
- [x] Checkpoint 15: 重连后日志完整，没有断层或丢失
- [x] Checkpoint 16: 前端只有一套日志流在运行（没有重复连接）
- [x] Checkpoint 17: CMDLog 终端日志功能正常工作
- [x] Checkpoint 18: 管理面板的"启动/停止实时日志"按钮功能正常
- [ ] Checkpoint 19: 页面切换或关闭时，日志流正确清理，无内存泄漏

## 集成 & Vercel 环境验证

- [ ] Checkpoint 20: 本地启动服务后日志流功能正常
- [ ] Checkpoint 21: 本地持续运行 2 分钟，日志连续不丢失
- [ ] Checkpoint 22: Vercel 部署成功，无构建错误
- [ ] Checkpoint 23: Vercel 环境下日志流持续运行 5 分钟以上
- [ ] Checkpoint 24: Vercel 环境下用户感知不到频繁断开
- [ ] Checkpoint 25: Vercel 环境下日志完整，没有丢失条目
- [x] Checkpoint 26: 向后兼容：旧版本前端（不支持 since 参数）仍能正常获取全部日志
