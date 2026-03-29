// 测试管理面板加载功能
async function testAdminLoad() {
    console.log('=== 测试管理面板加载功能 ===');
    
    let cookies = '';
    
    try {
        // 模拟登录
        console.log('步骤1: 尝试登录...');
        const loginResponse = await fetch('http://localhost:3000/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: 'REDACTED_USER',
                password: 'REDACTED'
            })
        });
        
        if (loginResponse.ok) {
            const loginData = await loginResponse.json();
            console.log('✓ 登录成功');
            console.log('用户信息:', loginData.user);
            
            // 获取session cookie
            cookies = loginResponse.headers.get('set-cookie');
            console.log('Session Cookie:', cookies);
            
            // 测试用户信息API
            console.log('\n步骤2: 获取用户信息...');
            const userResponse = await fetch('http://localhost:3000/api/user', {
                headers: {
                    'Cookie': cookies
                }
            });
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                console.log('✓ 用户信息获取成功');
                console.log('是否是管理员:', userData.isAdmin);
                console.log('用户名:', userData.username);
                
                if (userData.isAdmin) {
                    console.log('\n步骤3: 加载邀请码列表...');
                    const inviteResponse = await fetch('http://localhost:3000/api/invite-codes', {
                        headers: {
                            'Cookie': cookies
                        }
                    });
                    
                    if (inviteResponse.ok) {
                        const inviteData = await inviteResponse.json();
                        console.log('✓ 邀请码列表加载成功');
                        console.log('邀请码数量:', inviteData.length);
                        
                        console.log('\n步骤4: 加载任务列表...');
                        const tasksResponse = await fetch('http://localhost:3000/api/tasks', {
                            headers: {
                                'Cookie': cookies
                            }
                        });
                        
                        if (tasksResponse.ok) {
                            const tasksData = await tasksResponse.json();
                            console.log('✓ 任务列表加载成功');
                            console.log('任务数量:', tasksData.length);
                            
                            console.log('\n步骤5: 加载留言列表...');
                            const messagesResponse = await fetch('http://localhost:3000/api/messages', {
                                headers: {
                                    'Cookie': cookies
                                }
                            });
                            
                            if (messagesResponse.ok) {
                                const messagesData = await messagesResponse.json();
                                console.log('✓ 留言列表加载成功');
                                console.log('留言数量:', messagesData.length);
                                
                                console.log('\n步骤6: 加载账号列表...');
                                const accountsResponse = await fetch('http://localhost:3000/api/members', {
                                    headers: {
                                        'Cookie': cookies
                                    }
                                });
                                
                                if (accountsResponse.ok) {
                                    const accountsData = await accountsResponse.json();
                                    console.log('✓ 账号列表加载成功');
                                    console.log('账号数量:', accountsData.length);
                                    
                                    console.log('\n步骤7: 加载待审核头像...');
                                    const avatarResponse = await fetch('http://localhost:3000/api/avatar/pending', {
                                        headers: {
                                            'Cookie': cookies
                                        }
                                    });
                                    
                                    if (avatarResponse.ok) {
                                        const avatarData = await avatarResponse.json();
                                        console.log('✓ 头像审核列表加载成功');
                                        console.log('待审核头像数量:', avatarData.length);
                                        
                                        console.log('\n=== 所有测试通过 ✓ ===');
                                    } else {
                                        console.log('✗ 头像审核列表加载失败');
                                        console.log('响应状态:', avatarResponse.status);
                                        console.log('响应内容:', await avatarResponse.text());
                                    }
                                } else {
                                    console.log('✗ 账号列表加载失败');
                                    console.log('响应状态:', accountsResponse.status);
                                    console.log('响应内容:', await accountsResponse.text());
                                }
                            } else {
                                console.log('✗ 留言列表加载失败');
                                console.log('响应状态:', messagesResponse.status);
                                console.log('响应内容:', await messagesResponse.text());
                            }
                        } else {
                            console.log('✗ 任务列表加载失败');
                            console.log('响应状态:', tasksResponse.status);
                            console.log('响应内容:', await tasksResponse.text());
                        }
                    } else {
                        console.log('✗ 邀请码列表加载失败');
                        console.log('响应状态:', inviteResponse.status);
                        console.log('响应内容:', await inviteResponse.text());
                    }
                } else {
                    console.log('✗ 用户信息获取失败');
                    console.log('响应状态:', userResponse.status);
                    console.log('响应内容:', await userResponse.text());
                }
            } else {
                console.log('✗ 登录失败');
                console.log('响应状态:', loginResponse.status);
                console.log('响应内容:', await loginResponse.text());
            }
        } else {
            console.log('✗ 登录请求失败');
            console.log('响应状态:', loginResponse.status);
        }
    } catch (error) {
        console.error('测试失败:', error);
    }
}

testAdminLoad();