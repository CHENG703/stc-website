// CMD日志系统
const CMDLog = {
    logs: [],
    maxLogs: 100,
    terminalId: 'cmd-terminal-overlay',
    logStream: null,

    init() {
        this.injectStyles();
        this.createTerminal();
        this.connectToServerLogs();
        this.log('CMD日志系统已初始化', 'system');
    },

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .cmd-terminal-window {
                position: fixed;
                bottom: 10px;
                right: 10px;
                width: 600px;
                height: 300px;
                background: #0c0c0c;
                border: 1px solid #333;
                border-radius: 8px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                transition: all 0.3s ease;
            }
            .cmd-terminal-window.fullscreen {
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                border-radius: 0 !important;
                z-index: 99999 !important;
            }
            .cmd-terminal-header {
                background: #1a1a1a;
                padding: 8px 12px;
                border-bottom: 1px solid #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-radius: 8px 8px 0 0;
                cursor: pointer;
            }
            .cmd-terminal-window.fullscreen .cmd-terminal-header {
                border-radius: 0 !important;
            }
            .cmd-terminal-title {
                color: #fff;
                font-weight: bold;
            }
            .cmd-terminal-controls {
                display: flex;
                gap: 8px;
            }
            .cmd-terminal-btn {
                padding: 4px 12px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
            }
            .cmd-terminal-btn-minimize {
                background: #f59e0b;
                color: #000;
            }
            .cmd-terminal-btn-fullscreen {
                background: #10b981;
                color: #fff;
            }
            .cmd-terminal-btn-clear {
                background: #3b82f6;
                color: #fff;
            }
            .cmd-terminal-btn-close {
                background: #ef4444;
                color: #fff;
            }
            .cmd-terminal-content {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                color: #00ff00;
                line-height: 1.5;
            }
            .cmd-log-entry {
                margin: 2px 0;
                word-wrap: break-word;
            }
            .cmd-log-entry.info { color: #00ff00; }
            .cmd-log-entry.warn { color: #ffff00; }
            .cmd-log-entry.error { color: #ff0000; }
            .cmd-log-entry.system { color: #00ffff; }
            .cmd-log-entry.cmd { color: #ff00ff; }
            .cmd-terminal-input-area {
                display: flex;
                align-items: center;
                background: #1a1a1a;
                padding: 8px 12px;
                border-top: 1px solid #333;
                border-radius: 0 0 8px 8px;
            }
            .cmd-terminal-prompt { color: #00ff00; margin-right: 8px; font-weight: bold; }
            .cmd-terminal-input {
                flex: 1;
                background: transparent;
                border: none;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                outline: none;
            }
            .cmd-terminal-input::placeholder { color: #666; }
            .cmd-log-entry time { color: #888; margin-right: 8px; }
            .cmd-log-entry .cmd-prefix { color: #fff; margin-right: 4px; }
        `;
        document.head.appendChild(style);
    },

    createTerminal() {
        const existing = document.getElementById(this.terminalId);
        if (existing) existing.remove();

        const terminal = document.createElement('div');
        terminal.className = 'cmd-terminal-window';
        terminal.id = this.terminalId;
        terminal.innerHTML = `
            <div class="cmd-terminal-header" onclick="CMDLog.toggleFullscreen()">
                <span class="cmd-terminal-title">CMD - 服务器日志 <span style="font-size:10px;color:#888">(点击标题栏全屏)</span></span>
                <div class="cmd-terminal-controls" onclick="event.stopPropagation()">
                    <button class="cmd-terminal-btn cmd-terminal-btn-fullscreen" onclick="CMDLog.toggleFullscreen()">全屏</button>
                    <button class="cmd-terminal-btn cmd-terminal-btn-clear" onclick="CMDLog.clear()">清除</button>
                    <button class="cmd-terminal-btn cmd-terminal-btn-close" onclick="CMDLog.hide()">关闭</button>
                </div>
            </div>
            <div class="cmd-terminal-content" id="cmd-terminal-content"></div>
            <div class="cmd-terminal-input-area">
                <span class="cmd-terminal-prompt">></span>
                <input type="text" class="cmd-terminal-input" id="cmd-terminal-input" placeholder="输入命令后按回车执行..." onkeydown="CMDLog.handleInput(event)">
            </div>
        `;
        document.body.appendChild(terminal);
        this.contentEl = document.getElementById('cmd-terminal-content');
        this.inputEl = document.getElementById('cmd-terminal-input');
        this.isFullscreen = false;
    },

    toggleFullscreen() {
        const terminal = document.getElementById(this.terminalId);
        if (this.isFullscreen) {
            terminal.classList.remove('fullscreen');
            this.isFullscreen = false;
        } else {
            terminal.classList.add('fullscreen');
            this.isFullscreen = true;
        }
    },

    handleInput(event) {
        if (event.key === 'Enter') {
            const inputEl = document.getElementById('cmd-terminal-input');
            const command = inputEl.value.trim();
            if (command) {
                CMDLog.log('> ' + command, 'cmd');
                CMDLog.executeCommand(command);
                inputEl.value = '';
            }
        }
    },

    executeCommand(command) {
        const cmd = command.toLowerCase().split(' ')[0];
        const args = command.split(' ').slice(1).join(' ');
        switch(cmd) {
            case 'help':
                this.log('=== 可用命令 ===', 'system');
                this.log('help         - 显示帮助', 'system');
                this.log('clear        - 清除日志', 'system');
                this.log('stop         - 停止服务器', 'system');
                this.log('restart      - 重启服务器', 'system');
                this.log('status       - 服务器状态', 'system');
                this.log('stats        - 网站统计信息', 'system');
                this.log('users        - 用户数量', 'system');
                this.log('whoami       - 当前用户', 'system');
                this.log('date         - 当前时间', 'system');
                this.log('userinfo     - 查看用户信息 (userinfo <用户名或ID>)', 'system');
                this.log('createuser   - 创建用户 (createuser <用户名> <邮箱> <密码> [admin])', 'system');
                this.log('deleteuser   - 删除用户 (deleteuser <用户名或ID>)', 'system');
                this.log('banuser      - 封禁用户 (banuser <用户名或ID>)', 'system');
                this.log('unbanuser    - 解封用户 (unbanuser <用户名或ID>)', 'system');
                this.log('setadmin     - 设为管理员 (setadmin <用户名或ID>)', 'system');
                this.log('unsetadmin   - 取消管理员 (unsetadmin <用户名或ID>)', 'system');
                this.log('resetpw      - 重置密码 (resetpw <用户名或ID> <新密码>)', 'system');
                this.log('banip        - 封禁IP (banip <IP>)', 'system');
                this.log('unbanip      - 解封IP (unbanip <IP>)', 'system');
                this.log('banlist      - 查看已封禁IP列表', 'system');
                this.log('sitelock     - 锁定网站 (sitelock <原因>)', 'system');
                this.log('sitestatus   - 查看网站锁定状态', 'system');
                this.log('siteunlock   - 解锁网站', 'system');
                this.log('--- 超级管理员专用 ---', 'warn');
                this.log('backup       - 网站备份', 'system');
                this.log('backupinfo   - 查看上次备份信息', 'system');
                this.log('backuplist   - 查看所有备份列表', 'system');
                this.log('autobackup   - 设置自动备份 (autobackup <时间>)', 'system');
                this.log('stopbackup   - 关闭自动备份', 'system');
                this.log('rollback     - 回滚到指定备份 (rollback 或 rollback <备份名>)', 'system');
                this.log('delbackup    - 删除指定备份 (delbackup 或 delbackup <备份名>)', 'system');
                this.log('dblock       - 锁定数据库 (dblock [原因])', 'system');
                this.log('dbstatus     - 查看数据库状态', 'system');
                this.log('dbunlock     - 解锁数据库', 'system');
                this.log('================', 'system');
                break;
            case 'clear':
                this.clear();
                break;
            case 'stop':
                const stopPassword = prompt('请输入管理员密码以停止服务器：');
                if (!stopPassword) {
                    this.log('已取消', 'system');
                    return;
                }
                if (stopPassword !== 'Made STC Great Again') {
                    this.log('密码错误，无法停止服务器', 'error');
                    return;
                }
                if (confirm('确定要停止服务器吗？这将使网站离线！')) {
                    this.log('正在停止服务器...', 'warn');
                    fetch('/api/console/stop', {method:'POST'}).then(r=>r.json()).then(d=>this.log(d.message, d.success?'info':'error')).catch(e=>this.log('停止失败: '+e.message,'error'));
                } else {
                    this.log('已取消', 'system');
                }
                break;
            case 'restart':
                const restartPassword = prompt('请输入管理员密码以重启服务器：');
                if (!restartPassword) {
                    this.log('已取消', 'system');
                    return;
                }
                if (restartPassword !== 'Made STC Great Again') {
                    this.log('密码错误，无法重启服务器', 'error');
                    return;
                }
                this.log('正在重启服务器...', 'warn');
                fetch('/api/console/restart', {method:'POST'}).then(r=>r.json()).then(d=>this.log(d.message, d.success?'info':'error')).catch(e=>this.log('重启失败: '+e.message,'error'));
                break;
            case 'status':
                this.log('服务器状态: 运行中', 'info');
                break;
            case 'users':
                fetch('/api/members').then(r=>r.json()).then(u=>this.log('用户数量: '+u.length,'info')).catch(()=>this.log('获取失败','error'));
                break;
            case 'whoami':
                this.log('当前用户: '+(sessionStorage.getItem('username')||'未登录'), 'info');
                break;
            case 'date':
                this.log('时间: '+new Date().toLocaleString(), 'info');
                break;
            case 'banip':
                if (!args) {
                    this.log('用法: banip <IP地址>', 'error');
                    return;
                }
                this.log('正在封禁IP: '+args, 'warn');
                fetch('/api/admin/banip', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ip: args})
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('IP '+args+' 已封禁', 'info');
                    } else {
                        this.log('封禁失败: '+d.message, 'error');
                    }
                }).catch(e=>this.log('封禁失败: '+e.message,'error'));
                break;
            case 'unbanip':
                if (!args) {
                    this.log('用法: unbanip <IP地址>', 'error');
                    return;
                }
                this.log('正在解封IP: '+args, 'warn');
                fetch('/api/unban-ip', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ip: args})
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('IP '+args+' 已解封', 'info');
                    } else {
                        this.log('解封失败: '+d.message, 'error');
                    }
                }).catch(e=>this.log('解封失败: '+e.message,'error'));
                break;
            case 'banlist':
                fetch('/api/ban-ips').then(r=>r.json()).then(d=>{
                    if(d.data && d.data.length === 0) {
                        this.log('没有封禁任何IP', 'info');
                    } else {
                        this.log('=== 已封禁IP列表 ===', 'system');
                        (d.data || []).forEach(item=>this.log(item.ip || item, 'error'));
                        this.log('===================', 'system');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'stats':
                this.log('=== 网站统计 ===', 'system');
                this.log('统计功能暂未实现', 'info');
                this.log('================', 'system');
                break;
            case 'backup':
                this.log('正在备份网站数据...', 'warn');
                fetchWithAuth('/api/admin/backup', {method: 'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('备份完成！', 'info');
                        this.log('备份名称: ' + d.backup.name, 'system');
                        this.log('备份文件: ' + d.backup.files.join(', '), 'system');
                    } else {
                        this.log('备份失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('备份失败: '+e.message,'error'));
                break;
            case 'backupinfo':
                fetchWithAuth('/api/admin/backup-info').then(r=>r.json()).then(d=>{
                    if(d.success) {
                        if(d.lastBackup) {
                            this.log('=== 上次备份信息 ===', 'system');
                            this.log('备份时间: ' + new Date(d.lastBackup.time).toLocaleString(), 'info');
                            this.log('备份名称: ' + d.lastBackup.info.name, 'system');
                            this.log('===================', 'system');
                        } else {
                            this.log('从未进行过备份', 'warn');
                        }
                        if(d.autoBackup) {
                            this.log('=== 自动备份状态 ===', 'system');
                            this.log('状态: ' + (d.autoBackup.enabled ? '✅ 已启用' : '❌ 已关闭'), 'info');
                            this.log('备份时间: ' + d.autoBackup.time + ' (北京时间)', 'system');
                            this.log('===================', 'system');
                        }
                    } else {
                        this.log('获取备份信息失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'autobackup':
                if (!args) {
                    this.log('用法: autobackup <时间> (例如: autobackup 00:00)', 'error');
                    return;
                }
                this.log('正在设置自动备份...', 'warn');
                fetchWithAuth('/api/admin/auto-backup', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({time: args})
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log(d.message, 'info');
                        this.log('自动备份时间: ' + d.autoBackup.time + ' (北京时间)', 'system');
                    } else {
                        this.log('设置失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('设置失败: '+e.message,'error'));
                break;
            case 'stopbackup':
                this.log('正在关闭自动备份...', 'warn');
                fetchWithAuth('/api/admin/auto-backup/stop', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'}
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log(d.message, 'info');
                    } else {
                        this.log('关闭失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('关闭失败: '+e.message,'error'));
                break;
            case 'backuplist':
                this.log('正在获取备份列表...', 'warn');
                fetchWithAuth('/api/admin/backups').then(r=>r.json()).then(d=>{
                    if(d.success && d.backups) {
                        if(d.backups.length === 0) {
                            this.log('暂无备份', 'info');
                        } else {
                            this.log('=== 备份列表 ===', 'system');
                            d.backups.forEach((b, i) => {
                                const size = b.size > 1024*1024*1024 ? (b.size/1024/1024/1024).toFixed(2)+' GB' : 
                                            b.size > 1024*1024 ? (b.size/1024/1024).toFixed(2)+' MB' : 
                                            (b.size/1024).toFixed(2)+' KB';
                                this.log((i+1) + '. ' + b.name + ' (' + size + ') - ' + new Date(b.created).toLocaleString(), 'info');
                            });
                            this.log('================', 'system');
                        }
                    } else {
                        this.log('获取备份列表失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'rollback':
                this.log('正在获取备份列表...', 'warn');
                fetchWithAuth('/api/admin/backups').then(r=>r.json()).then(d=>{
                    if(d.success && d.backups) {
                        if(d.backups.length === 0) {
                            this.log('暂无备份', 'info');
                            return;
                        }
                        this.log('=== 备份列表 ===', 'system');
                        d.backups.forEach((b, i) => {
                            const size = b.size > 1024*1024*1024 ? (b.size/1024/1024/1024).toFixed(2)+' GB' : 
                                        b.size > 1024*1024 ? (b.size/1024/1024).toFixed(2)+' MB' : 
                                        (b.size/1024).toFixed(2)+' KB';
                            this.log((i+1) + '. ' + b.name + ' (' + size + ') - ' + new Date(b.created).toLocaleString(), 'info');
                        });
                        this.log('================', 'system');
                        
                        setTimeout(() => {
                            let backupName;
                            if (args) {
                                backupName = args;
                            } else {
                                const index = prompt('请输入要回滚的备份序号：');
                                if (!index) {
                                    this.log('已取消', 'system');
                                    return;
                                }
                                const idx = parseInt(index);
                                if (isNaN(idx) || idx < 1 || idx > d.backups.length) {
                                    this.log('无效的序号', 'error');
                                    return;
                                }
                                backupName = d.backups[idx - 1].name;
                            }
                            
                            if (!confirm('警告：回滚到 ' + backupName + ' 将覆盖当前数据库！是否继续？')) {
                                this.log('已取消回滚', 'system');
                                return;
                            }
                            this.log('正在回滚到备份: ' + backupName + '...', 'warn');
                            fetchWithAuth('/api/admin/rollback', {
                                method: 'POST',
                                headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({backupName: backupName})
                            }).then(r=>r.json()).then(d2=>{
                                if(d2.success) {
                                    this.log('回滚成功！', 'info');
                                    if(d2.preBackup) {
                                        this.log('已自动备份当前数据到: ' + d2.preBackup, 'warn');
                                    }
                                } else {
                                    this.log('回滚失败: ' + d2.message, 'error');
                                }
                            }).catch(e=>this.log('回滚失败: '+e.message,'error'));
                        }, 100);
                    } else {
                        this.log('获取备份列表失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'delbackup':
                this.log('正在获取备份列表...', 'warn');
                fetchWithAuth('/api/admin/backups').then(r=>r.json()).then(d=>{
                    if(d.success && d.backups) {
                        if(d.backups.length === 0) {
                            this.log('暂无备份', 'info');
                            return;
                        }
                        this.log('=== 备份列表 ===', 'system');
                        d.backups.forEach((b, i) => {
                            const size = b.size > 1024*1024*1024 ? (b.size/1024/1024/1024).toFixed(2)+' GB' : 
                                        b.size > 1024*1024 ? (b.size/1024/1024).toFixed(2)+' MB' : 
                                        (b.size/1024).toFixed(2)+' KB';
                            this.log((i+1) + '. ' + b.name + ' (' + size + ') - ' + new Date(b.created).toLocaleString(), 'info');
                        });
                        this.log('================', 'system');
                        
                        setTimeout(() => {
                            let backupName;
                            if (args) {
                                backupName = args;
                            } else {
                                const index = prompt('请输入要删除的备份序号：');
                                if (!index) {
                                    this.log('已取消', 'system');
                                    return;
                                }
                                const idx = parseInt(index);
                                if (isNaN(idx) || idx < 1 || idx > d.backups.length) {
                                    this.log('无效的序号', 'error');
                                    return;
                                }
                                backupName = d.backups[idx - 1].name;
                            }
                            
                            if (!confirm('确定要删除备份 ' + backupName + ' 吗？此操作不可恢复！')) {
                                this.log('已取消删除', 'system');
                                return;
                            }
                            this.log('正在删除备份: ' + backupName + '...', 'warn');
                            fetchWithAuth('/api/admin/backup/' + encodeURIComponent(backupName), {method: 'DELETE'}).then(r=>r.json()).then(d2=>{
                                if(d2.success) {
                                    this.log('备份已删除: ' + backupName, 'info');
                                } else {
                                    this.log('删除失败: ' + d2.message, 'error');
                                }
                            }).catch(e=>this.log('删除失败: '+e.message,'error'));
                        }, 100);
                    } else {
                        this.log('获取备份列表失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'dblock':
                const lockReason = args || '管理员锁定';
                this.log('正在锁定数据库，原因: ' + lockReason, 'warn');
                fetchWithAuth('/api/admin/db-lock', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({reason: lockReason})
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('数据库已锁定！', 'error');
                        this.log('锁定时间: ' + new Date(d.lockInfo.time).toLocaleString(), 'system');
                    } else {
                        this.log('锁定失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('锁定失败: '+e.message,'error'));
                break;
            case 'dbstatus':
                fetchWithAuth('/api/admin/db-status').then(r=>r.json()).then(d=>{
                    if(d.success) {
                        const s = d.status;
                        this.log('=== 数据库状态 ===', 'system');
                        this.log('状态: ' + (s.locked ? '已锁定' : '正常'), s.locked ? 'error' : 'info');
                        if(s.locked) {
                            this.log('锁定原因: ' + s.lockReason, 'warn');
                            this.log('锁定时间: ' + new Date(s.lockTime).toLocaleString(), 'system');
                        }
                        this.log('数据大小: ' + Math.round(s.dataSize / 1024) + ' KB', 'info');
                        this.log('用户数: ' + s.usersCount, 'info');
                        this.log('任务数: ' + s.tasksCount, 'info');
                        this.log('邮件数: ' + s.emailsCount, 'info');
                        this.log('==================', 'system');
                    } else {
                        this.log('获取状态失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'dbunlock':
                this.log('正在解锁数据库...', 'warn');
                fetchWithAuth('/api/admin/db-unlock', {method: 'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('数据库已解锁！', 'info');
                    } else {
                        this.log('解锁失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('解锁失败: '+e.message,'error'));
                break;
            case 'sitelock':
                if (!args) {
                    this.log('用法: sitelock <原因>', 'error');
                    this.log('示例: sitelock 系统维护中', 'info');
                    return;
                }
                this.log('正在锁定网站...', 'warn');
                fetchWithAuth('/api/admin/site-lock', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({reason: args})
                }).then(async r => {
                    const text = await r.text();
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        this.log('服务器返回非JSON: ' + text.substring(0, 100), 'error');
                        throw e;
                    }
                }).then(d=>{
                    if(d.success) {
                        this.log('网站已锁定！', 'warn');
                        this.log('锁定者: ' + d.lockBy, 'info');
                        this.log('原因: ' + d.lockReason, 'info');
                        this.log('所有非管理员用户已被强制下线', 'warn');
                    } else {
                        this.log('锁定失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('锁定失败: '+e.message,'error'));
                break;
            case 'siteunlock':
                this.log('正在解锁网站...', 'warn');
                fetchWithAuth('/api/admin/site-unlock', {method: 'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('网站已解锁！', 'info');
                        this.log('用户现在可以正常登录', 'info');
                    } else {
                        this.log('解锁失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('解锁失败: '+e.message,'error'));
                break;
            case 'sitestatus':
                fetchWithAuth('/api/admin/site-status').then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('=== 网站状态 ===', 'info');
                        this.log('锁定状态: ' + (d.locked ? '已锁定' : '正常'), d.locked ? 'warn' : 'info');
                        if (d.locked) {
                            this.log('锁定者: ' + d.lockBy, 'warn');
                            this.log('锁定原因: ' + d.lockReason, 'warn');
                            this.log('锁定时间: ' + new Date(d.lockTime).toLocaleString(), 'warn');
                        }
                    } else {
                        this.log('获取状态失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取状态失败: '+e.message,'error'));
                break;
            case 'createuser':
                if (!args || args.split(' ').length < 3) {
                    this.log('用法: createuser <用户名> <邮箱> <密码> [admin]', 'error');
                    return;
                }
                const cuParts = args.split(' ');
                const cuUsername = cuParts[0];
                const cuEmail = cuParts[1];
                const cuPassword = cuParts[2];
                const cuIsAdmin = cuParts[3] === 'admin' || cuParts[3] === 'true';
                this.log('正在创建用户: ' + cuUsername, 'warn');
                fetch('/api/console/create_user', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({username: cuUsername, email: cuEmail, password: cuPassword, isAdmin: cuIsAdmin})
                }).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('用户创建成功: ' + cuUsername, 'info');
                        loadMembers();
                    } else {
                        this.log('创建失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('创建失败: '+e.message,'error'));
                break;
            case 'deleteuser':
                if (!args) {
                    this.log('用法: deleteuser <用户名或ID>', 'error');
                    return;
                }
                if (!confirm('确定要删除用户 ' + args + ' 吗？此操作不可恢复！')) {
                    this.log('已取消删除', 'system');
                    return;
                }
                this.log('正在查找用户: ' + args, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    if (target.is_super_admin) {
                        this.log('无法删除超级管理员', 'error');
                        return;
                    }
                    fetch('/api/members/' + target.id, {method:'DELETE'}).then(r=>r.json()).then(d=>{
                        if(d.success) {
                            this.log('用户已删除: ' + target.username, 'info');
                            loadMembers();
                        } else {
                            this.log('删除失败: ' + d.message, 'error');
                        }
                    }).catch(e=>this.log('删除失败: '+e.message,'error'));
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            case 'banuser':
                if (!args) {
                    this.log('用法: banuser <用户名或ID>', 'error');
                    return;
                }
                this.log('正在封禁用户: ' + args, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    if (target.is_super_admin) {
                        this.log('无法封禁超级管理员', 'error');
                        return;
                    }
                    fetch('/api/members/' + target.id + '/ban', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ban: true})
                    }).then(r=>r.json()).then(d=>{
                        if(d.success) {
                            this.log('用户已封禁: ' + target.username, 'info');
                            loadMembers();
                        } else {
                            this.log('封禁失败: ' + d.message, 'error');
                        }
                    }).catch(e=>this.log('封禁失败: '+e.message,'error'));
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            case 'unbanuser':
                if (!args) {
                    this.log('用法: unbanuser <用户名或ID>', 'error');
                    return;
                }
                this.log('正在解封用户: ' + args, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    fetch('/api/members/' + target.id + '/unban', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'}
                    }).then(r=>r.json()).then(d=>{
                        if(d.success) {
                            this.log('用户已解封: ' + target.username, 'info');
                            loadMembers();
                        } else {
                            this.log('解封失败: ' + d.message, 'error');
                        }
                    }).catch(e=>this.log('解封失败: '+e.message,'error'));
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            case 'setadmin':
                if (!args) {
                    this.log('用法: setadmin <用户名或ID>', 'error');
                    return;
                }
                this.log('正在设为管理员: ' + args, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    fetch('/api/members/' + target.id + '/set_admin', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'}
                    }).then(r=>r.json()).then(d=>{
                        if(d.success) {
                            this.log('已设为管理员: ' + target.username, 'info');
                            loadMembers();
                        } else {
                            this.log('设置失败: ' + d.message, 'error');
                        }
                    }).catch(e=>this.log('设置失败: '+e.message,'error'));
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            case 'unsetadmin':
                if (!args) {
                    this.log('用法: unsetadmin <用户名或ID>', 'error');
                    return;
                }
                this.log('正在取消管理员: ' + args, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    if (target.is_super_admin) {
                        this.log('无法取消超级管理员权限', 'error');
                        return;
                    }
                    fetch('/api/members/' + target.id + '/unset_admin', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'}
                    }).then(r=>r.json()).then(d=>{
                        if(d.success) {
                            this.log('已取消管理员: ' + target.username, 'info');
                            loadMembers();
                        } else {
                            this.log('取消失败: ' + d.message, 'error');
                        }
                    }).catch(e=>this.log('取消失败: '+e.message,'error'));
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            case 'userinfo':
                if (!args) {
                    this.log('用法: userinfo <用户名或ID>', 'error');
                    return;
                }
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === args || u.id === parseInt(args));
                    if (!target) {
                        this.log('未找到用户: ' + args, 'error');
                        return;
                    }
                    this.log('=== 用户信息 ===', 'system');
                    this.log('ID: ' + target.id, 'info');
                    this.log('用户名: ' + target.username, 'info');
                    this.log('邮箱: ' + target.email, 'info');
                    this.log('管理员: ' + (target.is_admin ? '是' : '否'), target.is_admin ? 'warn' : 'info');
                    this.log('超级管理员: ' + (target.is_super_admin ? '是' : '否'), target.is_super_admin ? 'warn' : 'info');
                    this.log('封禁状态: ' + (target.is_banned ? '已封禁' : '正常'), target.is_banned ? 'error' : 'info');
                    this.log('注册时间: ' + new Date(target.created_at).toLocaleString(), 'info');
                    this.log('================', 'system');
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'resetpw':
                if (!args || args.split(' ').length < 2) {
                    this.log('用法: resetpw <用户名或ID> <新密码>', 'error');
                    return;
                }
                const rpParts = args.split(' ');
                const rpUsername = rpParts[0];
                const rpNewPw = rpParts[1];
                this.log('正在重置密码: ' + rpUsername, 'warn');
                fetch('/api/members').then(r=>r.json()).then(result=>{
                    const members = result.data || [];
                    const target = members.find(u => u.username === rpUsername || u.id === parseInt(rpUsername));
                    if (!target) {
                        this.log('未找到用户: ' + rpUsername, 'error');
                        return;
                    }
                    this.log('密码重置功能暂未实现，请手动修改数据库', 'warn');
                }).catch(e=>this.log('查找失败: '+e.message,'error'));
                break;
            default:
                this.log('未知命令: '+cmd+' (输入help查看)', 'error');
        }
    },

    log(message, type = 'info') {
        const entry = {
            time: new Date().toLocaleTimeString(),
            message: message,
            type: type
        };
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.render();
    },

    render() {
        if (!this.contentEl) return;
        this.contentEl.innerHTML = this.logs.map(log => {
            const typeClass = log.type || 'info';
            return `<div class="cmd-log-entry ${typeClass}">
                <time>[${log.time}]</time>
                <span class="cmd-prefix">></span>${this.escapeHtml(log.message)}
            </div>`;
        }).join('');
        this.contentEl.scrollTop = this.contentEl.scrollHeight;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    clear() {
        this.logs = [];
        this.render();
        this.log('日志已清除', 'system');
    },

    hide() {
        const terminal = document.getElementById(this.terminalId);
        if (terminal) {
            terminal.style.display = 'none';
        }
    },

    show() {
        const terminal = document.getElementById(this.terminalId);
        if (terminal) {
            terminal.style.display = 'flex';
        }
    },

    connectToServerLogs() {
        if (this.logStream) {
            try { this.logStream.cancel(); } catch(e) {}
        }
        
        const connect = async () => {
            try {
                const response = await fetch('/api/logs/sse', {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Accept': 'text/event-stream'
                    }
                });
                
                if (!response.ok) {
                    this.log('日志连接失败: ' + response.status, 'error');
                    setTimeout(connect, 5000);
                    return;
                }
                
                this.log('服务器日志连接已建立', 'system');
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        this.log('服务器日志连接已关闭，正在重连...', 'warn');
                        setTimeout(connect, 5000);
                        return;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;
                        
                        if (trimmedLine.startsWith('data: ')) {
                            const dataStr = trimmedLine.slice(6);
                            try {
                                const data = JSON.parse(dataStr);
                                this.log(data.message, data.type || 'info');
                            } catch (e) {
                                this.log(dataStr, 'info');
                            }
                        }
                    }
                }
            } catch (e) {
                this.log('日志连接错误: ' + e.message, 'error');
                setTimeout(connect, 5000);
            }
        };
        
        connect();
    }
};

// 全局消息提示函数
function showMessage(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'message-toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
    CMDLog.log(message, type === 'error' ? 'error' : 'info');
}

// 测试函数
function testAction(userId) {
    alert('测试按钮工作正常！用户ID: ' + userId);
    console.log('测试按钮被点击，用户ID:', userId);
    CMDLog.log('测试按钮被点击，用户ID: ' + userId, 'info');
}

// 清除日志函数
function clearLogs() {
    CMDLog.clear();
}

// 封装的fetch函数
async function fetchWithAuth(url, options = {}) {
    options.credentials = 'include';
    options.headers = options.headers || {};
    options.headers['Accept'] = 'application/json';

    const response = await fetch(url, options);
    if (response.status === 401) {
        showMessage('请先登录', 'error');
        localStorage.removeItem('user');
        setTimeout(() => window.location.href = '/login', 2000);
        throw new Error('Unauthorized');
    }
    if (response.status === 403) {
        const error = await response.json();
        const errorMsg = error.error || '';
        if (errorMsg.includes('请先登录') || errorMsg.includes('未登录')) {
            showMessage('登录已过期，请重新登录', 'error');
            localStorage.removeItem('user');
            setTimeout(() => window.location.href = '/login', 2000);
            throw new Error('Unauthorized');
        } else {
            showMessage(errorMsg || '权限不足', 'error');
            throw new Error('PermissionDenied');
        }
    }
    return response;
}

// 登出
async function logout() {
    const response = await fetchWithAuth('/api/logout', { method: 'POST' });
    if (response.ok) {
        showMessage('登出成功');
        CMDLog.log('用户登出', 'info');
        setTimeout(() => window.location.href = '/', 1000);
    }
}

// 显示成员操作模态框
function showMemberActions(userId, username, isBanned, isAdmin, isSuperAdmin) {
    console.log('showMemberActions被调用', {userId, username, isBanned, isAdmin, isSuperAdmin});
    CMDLog.log(`打开用户 ${username} 的操作菜单`, 'info');
    
    // 移除已存在的模态框
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) existingModal.remove();
    
    try {
        var modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.style.zIndex = '9999';
        modal.innerHTML = '<div class="modal-content" style="background:white;padding:20px;border-radius:8px;min-width:300px;">' +
            '<h3 style="margin:0 0 15px 0;color:#333;">操作 - ' + username + '</h3>' +
            '<div class="modal-actions" id="modal-actions" style="display:flex;flex-direction:column;gap:10px;"></div>' +
            '<button onclick="this.closest(\'.modal-overlay\').remove()" class="btn btn-secondary" style="margin-top:15px;">关闭</button>' +
            '</div>';

        var actionsContainer = modal.querySelector('#modal-actions');
        var btnStyle = 'padding:10px 15px;border:none;border-radius:5px;cursor:pointer;color:white;background:#667eea;';
        
        if (!isSuperAdmin) {
            if (isBanned) {
                actionsContainer.innerHTML += '<button style="' + btnStyle + 'background:#10b981;" onclick="toggleBan(' + userId + ', false)">解除封禁</button>';
            } else {
                actionsContainer.innerHTML += '<button style="' + btnStyle + '" onclick="toggleBan(' + userId + ', true)">封禁</button>';
            }

            if (isAdmin) {
                actionsContainer.innerHTML += '<button style="' + btnStyle + '" onclick="toggleAdmin(' + userId + ', false)">取消管理员</button>';
            } else {
                actionsContainer.innerHTML += '<button style="' + btnStyle + '" onclick="toggleAdmin(' + userId + ', true)">设为管理员</button>';
            }

            actionsContainer.innerHTML += '<button style="' + btnStyle + '" onclick="resetPassword(' + userId + ')">重置密码</button>';

            actionsContainer.innerHTML += '<button style="' + btnStyle + 'background:#dc3545;" onclick="deleteMember(' + userId + ', \'' + username.replace(/'/g, "\\'") + '\')">删除成员</button>';
        } else {
            actionsContainer.innerHTML += '<p style="color:#666;margin:0;">您无法对该管理员执行操作</p>';
        }

        document.body.appendChild(modal);
        console.log('模态框已添加到DOM');
    } catch (error) {
        console.error('showMemberActions错误:', error);
        alert('错误: ' + error.message);
    }
}

// 切换封禁状态
async function toggleBan(userId, ban) {
    CMDLog.log(`正在${ban ? '封禁' : '解除封禁'}用户ID: ${userId}`, 'info');
    try {
        var response = await fetchWithAuth('/api/members/' + userId + '/ban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ban: ban })
        });
        if (response.ok) {
            showMessage(ban ? '用户已被封禁' : '用户已解除封禁', 'success');
            CMDLog.log(`用户ID ${userId} 已${ban ? '封禁' : '解除封禁'}`, 'info');
            loadMembers();
            document.querySelector('.modal-overlay')?.remove();
        } else {
            var data = await response.json();
            showMessage(data.error || '操作失败', 'error');
            CMDLog.log(`操作失败: ${data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showMessage('操作失败', 'error');
        CMDLog.log(`操作失败: ${error.message}`, 'error');
    }
}

// 切换管理员状态
async function toggleAdmin(userId, admin) {
    CMDLog.log(`正在${admin ? '设为管理员' : '取消管理员'}用户ID: ${userId}`, 'info');
    try {
        var url = admin ? '/api/members/' + userId + '/set_admin' : '/api/members/' + userId + '/unset_admin';
        var response = await fetchWithAuth(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
            showMessage(admin ? '用户已设为管理员' : '用户已取消管理员', 'success');
            CMDLog.log(`用户ID ${userId} 已${admin ? '设为管理员' : '取消管理员'}`, 'info');
            loadMembers();
            document.querySelector('.modal-overlay')?.remove();
        } else {
            var data = await response.json();
            showMessage(data.error || data.message || '操作失败', 'error');
            CMDLog.log(`操作失败: ${data.error || data.message || '未知错误'}`, 'error');
        }
    } catch (error) {
        showMessage('操作失败', 'error');
        CMDLog.log(`操作失败: ${error.message}`, 'error');
    }
}

// 重置密码
async function resetPassword(userId) {
    CMDLog.log(`正在重置用户ID ${userId} 的密码`, 'info');
    if (!confirm('确定要重置密码吗？')) return;
    try {
        var response = await fetchWithAuth('/api/members/' + userId + '/reset-password', {
            method: 'PUT'
        });
        if (response.ok) {
            showMessage('密码已重置为123456', 'success');
            CMDLog.log(`用户ID ${userId} 的密码已重置为123456`, 'info');
            document.querySelector('.modal-overlay')?.remove();
        } else {
            var data = await response.json();
            showMessage(data.error || '操作失败', 'error');
            CMDLog.log(`重置密码失败: ${data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showMessage('操作失败', 'error');
        CMDLog.log(`重置密码失败: ${error.message}`, 'error');
    }
}

// 删除成员
async function deleteMember(userId, username) {
    CMDLog.log(`正在删除用户: ${username} (ID: ${userId})`, 'warn');
    if (!confirm('确定要删除用户 ' + username + ' 吗？此操作不可撤销！')) return;
    try {
        var response = await fetchWithAuth('/api/members/' + userId, {
            method: 'DELETE'
        });
        if (response.ok) {
            showMessage('用户已删除', 'success');
            CMDLog.log(`用户 ${username} 已删除`, 'warn');
            loadMembers();
            document.querySelector('.modal-overlay')?.remove();
        } else {
            var data = await response.json();
            showMessage(data.error || data.message || '操作失败', 'error');
            CMDLog.log(`删除失败: ${data.error || data.message || '未知错误'}`, 'error');
        }
    } catch (error) {
        showMessage('操作失败', 'error');
        CMDLog.log(`删除失败: ${error.message}`, 'error');
    }
}

// 生成邀请码
async function generateInviteCode() {
    CMDLog.log('正在生成邀请码...', 'info');
    try {
        const response = await fetchWithAuth('/api/invite-codes', { method: 'POST' });
        if (response.ok) {
            const data = await response.json();
            showMessage('邀请码 ' + (data.code || data.data?.code) + ' 生成成功');
            CMDLog.log('邀请码生成成功: ' + (data.code || data.data?.code), 'info');
            loadInviteCodes();
        } else {
            const data = await response.json();
            showMessage(data.error || '生成邀请码失败', 'error');
            CMDLog.log('邀请码生成失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('生成邀请码失败:', error);
        showMessage('生成邀请码失败: ' + error.message, 'error');
        CMDLog.log('邀请码生成失败: ' + error.message, 'error');
    }
}

// 删除邀请码
async function deleteInviteCode(codeId) {
    CMDLog.log('正在删除邀请码ID: ' + codeId, 'info');
    if (!confirm('确定要删除这个邀请码吗？')) return;
    const response = await fetchWithAuth('/api/invite-codes/' + codeId, { method: 'DELETE' });
    if (response.ok) {
        showMessage('邀请码删除成功');
        CMDLog.log('邀请码已删除', 'info');
        loadInviteCodes();
    }
}

// 加载邀请码
async function loadInviteCodes() {
    const container = document.getElementById('invite-codes-table');
    if (!container) return;
    try {
        const response = await fetchWithAuth('/api/invite-codes');
        const result = await response.json();
        const codes = result.data || [];
        if (codes.length === 0) {
            container.innerHTML = '<p style="text-align:center;">暂无邀请码</p>';
            return;
        }
        container.innerHTML = '<table class="admin-table"><thead><tr><th>邀请码</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' +
            codes.map(c => '<tr><td><code>' + (c.code || '') + '</code></td><td>' + (c.is_used || c.used ? '已使用' : '可用') + '</td><td>' + (c.created_at || '') + '</td><td><button onclick="deleteInviteCode(' + c.id + ')" class="btn btn-sm" style="background:#dc3545;">删除</button></td></tr>').join('') +
            '</tbody></table>';
        CMDLog.log('邀请码列表已刷新', 'info');
    } catch (error) {
        console.error('Failed to load invite codes:', error);
        container.innerHTML = '<p style="text-align:center;color:red;">加载失败</p>';
        CMDLog.log('邀请码加载失败: ' + error.message, 'error');
    }
}

// 加载成员
async function loadMembers() {
    const container = document.getElementById('members-table');
    if (!container) return;

    try {
        const response = await fetchWithAuth('/api/members');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.json();
        const members = result.data || [];

        if (members.length === 0) {
            container.innerHTML = '<p style="text-align:center;">暂无成员</p>';
            return;
        }

        container.innerHTML = '<table class="admin-table"><thead><tr><th>用户名</th><th>邮箱</th><th>角色</th><th>状态</th><th>最后登录IP</th><th>操作</th></tr></thead><tbody>' +
            members.map(function(m) {
                var role = m.is_super_admin ? '超级管理员' : (m.is_admin ? '管理员' : '普通用户');
                var status = m.is_banned ? '已封禁' : '正常';
                var escapedUsername = m.username.replace(/'/g, "\\'");
                var actionBtn = '<button class="btn btn-sm" onclick="showMemberActions(' + m.id + ', \'' + escapedUsername + '\', ' + m.is_banned + ', ' + m.is_admin + ', ' + (m.is_super_admin || false) + ')">操作</button>';
                return '<tr>' +
                    '<td>' + m.username + '</td>' +
                    '<td>' + m.email + '</td>' +
                    '<td>' + role + '</td>' +
                    '<td>' + status + '</td>' +
                    '<td style="color:#888;font-size:11px;">' + (m.last_login_ip || '无') + '</td>' +
                    '<td>' + actionBtn + '</td>' +
                    '</tr>';
            }).join('') +
            '</tbody></table>';
        CMDLog.log('成员列表已刷新，共 ' + members.length + ' 个成员', 'info');

    } catch (error) {
        console.error('Failed to load members:', error);
        container.innerHTML = '<p style="text-align:center;color:red;">加载成员失败</p>';
        CMDLog.log('成员列表加载失败: ' + error.message, 'error');
    }
}

// 加载任务
async function loadTasks() {
    const container = document.getElementById('tasks-table');
    if (!container) return;
    try {
        const response = await fetchWithAuth('/api/tasks');
        const result = await response.json();
        const tasks = result.data || [];
        if (tasks.length === 0) {
            container.innerHTML = '<p style="text-align:center;">暂无任务</p>';
            return;
        }
        container.innerHTML = '<table class="admin-table"><thead><tr><th>标题</th><th>状态</th><th>创建时间</th></tr></thead><tbody>' +
            tasks.map(t => '<tr><td>' + (t.title || '') + '</td><td>' + (t.status || 'pending') + '</td><td>' + (t.created_at || '') + '</td></tr>').join('') +
            '</tbody></table>';
        CMDLog.log('任务列表已刷新', 'info');
    } catch (error) {
        console.error('Failed to load tasks:', error);
        container.innerHTML = '<p style="text-align:center;color:red;">加载任务失败</p>';
        CMDLog.log('任务列表加载失败: ' + error.message, 'error');
    }
}

// 加载留言
async function loadMessages() {
    const container = document.getElementById('messages-table');
    if (!container) return;
    try {
        const response = await fetchWithAuth('/api/messages');
        const result = await response.json();
        const messages = result.data || [];
        if (messages.length === 0) {
            container.innerHTML = '<p style="text-align:center;">暂无留言</p>';
            return;
        }
        container.innerHTML = '<table class="admin-table"><thead><tr><th>内容</th><th>创建时间</th></tr></thead><tbody>' +
            messages.map(m => '<tr><td>' + (m.content || '') + '</td><td>' + (m.created_at || '') + '</td></tr>').join('') +
            '</tbody></table>';
        CMDLog.log('留言列表已刷新', 'info');
    } catch (error) {
        console.error('Failed to load messages:', error);
        container.innerHTML = '<p style="text-align:center;color:red;">加载留言失败</p>';
        CMDLog.log('留言列表加载失败: ' + error.message, 'error');
    }
}

// 加载待审核头像
async function loadPendingAvatars() {
    const container = document.getElementById('pending-avatars-table');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;">暂无待审核头像</p>';
}

// 加载登录状态
async function loadLoginStatus() {
    const container = document.getElementById('login-status-content');
    if (!container) return;
    
    try {
        const response = await fetchWithAuth('/api/user');
        const user = await response.json();
        
        if (user && user.id) {
            const role = user.is_super_admin ? '超级管理员' : (user.is_admin ? '管理员' : '普通用户');
            container.innerHTML = '<div style="padding:10px;background:#f0f9ff;border-radius:5px;">' +
                '<strong>用户名:</strong> ' + user.username + '<br>' +
                '<strong>邮箱:</strong> ' + user.email + '<br>' +
                '<strong>角色:</strong> ' + role + '<br>' +
                '<strong>ID:</strong> ' + user.id +
                '</div>';
            CMDLog.log('登录状态: ' + user.username + ' (' + role + ')', 'info');
        } else {
            container.innerHTML = '<div style="padding:10px;background:#fee;border-radius:5px;color:red;">未登录或登录已过期</div>';
            CMDLog.log('未登录', 'warn');
        }
    } catch (error) {
        container.innerHTML = '<div style="padding:10px;background:#fee;border-radius:5px;color:red;">加载失败: ' + error.message + '</div>';
        CMDLog.log('登录状态加载失败: ' + error.message, 'error');
    }
}

// 页面加载时初始化所有数据
async function initAdminPanel() {
    try {
        // 先加载登录状态
        await loadLoginStatus();
        
        // 加载所有管理数据
        await Promise.all([
            loadMembers().catch(e => CMDLog.log('成员加载失败: ' + e.message, 'error')),
            loadTasks().catch(e => CMDLog.log('任务加载失败: ' + e.message, 'error')),
            loadMessages().catch(e => CMDLog.log('留言加载失败: ' + e.message, 'error')),
            loadInviteCodes().catch(e => CMDLog.log('邀请码加载失败: ' + e.message, 'error')),
            loadPendingAvatars().catch(e => CMDLog.log('头像审核加载失败: ' + e.message, 'error'))
        ]);
        CMDLog.log('管理面板数据加载完成', 'system');
    } catch (error) {
        CMDLog.log('初始化失败: ' + error.message, 'error');
    }
}

// 服务器日志功能
let logStreamActive = false;
let logStream = null;

function appendServerLog(entry) {
    const container = document.getElementById('server-logs-container');
    if (!container) return;
    
    const time = entry.time ? new Date(entry.time).toLocaleTimeString() : '';
    const type = entry.type || 'info';
    const message = entry.message || '';
    
    const colors = {
        'error': '#ff6b6b',
        'warn': '#ffd93d',
        'success': '#6bcb77',
        'system': '#4d96ff',
        'info': '#eeeeee'
    };
    const color = colors[type] || '#eeeeee';
    
    const div = document.createElement('div');
    div.style.marginBottom = '2px';
    div.innerHTML = `<span style="color:#8b949e;">[${time}]</span> <span style="color:${color};">${escapeHtml(message)}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function clearServerLogs() {
    const container = document.getElementById('server-logs-container');
    if (container) {
        container.innerHTML = '<div style=\'color:#8b949e;\'>日志已清空</div>';
    }
}

async function loadServerLogs() {
    try {
        const response = await fetchWithAuth('/api/logs');
        const data = await response.json();
        
        if (data.success && data.data) {
            const container = document.getElementById('server-logs-container');
            container.innerHTML = '';
            data.data.forEach(entry => appendServerLog(entry));
        }
    } catch (error) {
        console.error('加载日志失败:', error);
    }
}

async function toggleLogStream() {
    const btn = document.getElementById('log-stream-btn');
    
    if (logStreamActive) {
        if (logStream) {
            try { logStream.cancel(); } catch(e) {}
            logStream = null;
        }
        logStreamActive = false;
        if (btn) btn.textContent = '启动实时日志';
        return;
    }
    
    try {
        logStreamActive = true;
        if (btn) btn.textContent = '停止实时日志';
        
        const response = await fetchWithAuth('/api/logs/sse');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (logStreamActive) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                const dataMatch = line.match(/^data: (.+)$/);
                if (dataMatch) {
                    try {
                        const entry = JSON.parse(dataMatch[1]);
                        appendServerLog(entry);
                    } catch (e) {}
                }
            }
        }
    } catch (error) {
        logStreamActive = false;
        if (btn) btn.textContent = '启动实时日志';
        console.error('日志流错误:', error);
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            CMDLog.init();
            initAdminPanel();
            loadServerLogs();
        }, 500);
    });
} else {
    setTimeout(() => {
        CMDLog.init();
        initAdminPanel();
        loadServerLogs();
    }, 500);
}