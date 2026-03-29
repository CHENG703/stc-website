const fs = require('fs');

const content = fs.readFileSync('public/js/admin.js', 'utf8');

// 添加backup命令
const statsCase = content.indexOf("            case 'stats':");
const createuserCase = content.indexOf("            case 'createuser':");

const backupCommands = `            case 'backup':
                this.log('正在备份网站数据...', 'warn');
                fetch('/api/admin/backup', {method: 'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('备份完成！', 'info');
                    } else {
                        this.log('备份失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('备份失败: '+e.message,'error'));
                break;
            case 'backupinfo':
                fetch('/api/admin/backup-info').then(r=>r.json()).then(d=>{
                    if(d.success) {
                        if(d.lastBackup) {
                            this.log('=== 上次备份信息 ===', 'system');
                            this.log('备份时间: ' + new Date(d.lastBackup.time).toLocaleString(), 'info');
                            this.log('===================', 'system');
                        } else {
                            this.log('从未进行过备份', 'warn');
                        }
                    } else {
                        this.log('获取失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'dblock':
                const lockReason = args || '管理员锁定';
                this.log('正在锁定数据库...', 'warn');
                fetch('/api/admin/db-lock', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({reason: lockReason})}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('数据库已锁定！', 'error');
                    } else {
                        this.log('锁定失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('锁定失败: '+e.message,'error'));
                break;
            case 'dbstatus':
                fetch('/api/admin/db-status').then(r=>r.json()).then(d=>{
                    if(d.success) {
                        const s = d.status;
                        this.log('=== 数据库状态 ===', 'system');
                        this.log('状态: ' + (s.locked ? '已锁定' : '正常'), s.locked ? 'error' : 'info');
                        this.log('用户数: ' + s.usersCount, 'info');
                        this.log('==================', 'system');
                    } else {
                        this.log('获取失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('获取失败: '+e.message,'error'));
                break;
            case 'dbunlock':
                this.log('正在解锁数据库...', 'warn');
                fetch('/api/admin/db-unlock', {method: 'POST'}).then(r=>r.json()).then(d=>{
                    if(d.success) {
                        this.log('数据库已解锁！', 'info');
                    } else {
                        this.log('解锁失败: ' + d.message, 'error');
                    }
                }).catch(e=>this.log('解锁失败: '+e.message,'error'));
                break;
`;

const before = content.substring(0, createuserCase);
const after = content.substring(createuserCase);
const newContent = before + backupCommands + after;

fs.writeFileSync('public/js/admin.js', newContent);
console.log('Done!');
