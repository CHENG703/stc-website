// 多语言配置
const LANGUAGES = {
    'zh-CN': {
        name: '中文简体',
        flag: '🇨🇳',
        translations: {
            // 导航栏
            nav: {
                brand: 'STC工会任务平台',
                home: '首页',
                about: '关于我们',
                tasks: '任务',
                messages: '留言',
                login: '登录',
                logout: '退出',
                userCenter: '用户中心',
                adminPanel: '管理面板',
                themeToggle: '🌙'
            },
            // 首页
            home: {
                title: '欢迎来到STC任务网站',
                subtitle: '一个高效的任务管理平台',
                unionDays: '工会已成立',
                years: '年',
                days: '天',
                viewTasks: '查看任务',
                viewAbout: '了解更多',
                tasksTitle: '最新任务',
                messagesTitle: '留言板',
                noTasks: '暂无任务',
                noMessages: '暂无留言',
                sendMessage: '发送留言',
                placeholderMessage: '输入留言内容...'
            },
            // 关于我们
            about: {
                title: '关于我们',
                subtitle: 'STC工会 - 一个热爱《我的世界》的游戏团队',
                announcement: '公告',
                announcementTitle: '欢迎加入STC工会！',
                announcementContent: '我们是一个专注于《我的世界》游戏的团队，致力于创造精彩的游戏体验。',
                announcementDate: '2025年1月24日',
                whoWeAre: '我们是谁',
                whoWeAreDesc: 'STC工会是一个由热爱《我的世界》的玩家组成的团队。我们专注于建筑创作、红石技术和服务器管理，致力于为玩家提供优质的游戏体验。',
                features: '特色玩法',
                featureBuild: '建筑创作',
                featureBuildDesc: '精心设计的建筑作品',
                featureRedstone: '红石技术',
                featureRedstoneDesc: '复杂的红石机械系统',
                featureCommunity: '社区活动',
                featureCommunityDesc: '丰富的团队活动',
                team: '核心成员',
                founder: '创始人/超级管理员',
                president: '会长',
                vicePresident: '副会长',
                architect: '建筑师',
                engineer: '红石工程师',
                member: '成员',
                teamDescFounder: '工会的创立者，负责整体规划与管理',
                teamDescPresident: '负责工会日常运营与决策',
                teamDescVice: '协助会长处理工会事务',
                teamDescArchitect: '负责建筑设计与创作',
                teamDescEngineer: '负责红石系统开发',
                teamDescAlice: '负责红石与建筑创作',
                teamDescMember: '潜水',
                teamDescMembers: '所有成员都是工会不可或缺的力量',
                stats: '数据统计',
                statsMembers: '成员数量',
                statsProjects: '完成项目',
                statsDays: '运营天数',
                gallery: '精彩瞬间',
                joinUs: '加入我们',
                joinUsDesc: '想要加入STC工会？欢迎联系我们！',
                joinNow: '立即加入'
            },
            // 登录页
            login: {
                title: '登录',
                passwordLogin: '密码登录',
                codeLogin: '验证码登录',
                username: '用户名/邮箱',
                password: '密码',
                email: '邮箱',
                code: '验证码',
                sendCode: '发送验证码',
                loginBtn: '登录',
                noAccount: '没有账号？',
                register: '注册',
                forgotPassword: '忘记密码？'
            },
            // 用户中心
            user: {
                title: '用户中心',
                profile: '个人资料',
                settings: '设置',
                changePassword: '修改密码',
                oldPassword: '旧密码',
                newPassword: '新密码',
                confirmPassword: '确认密码',
                save: '保存',
                cancel: '取消'
            },
            // 管理面板
            admin: {
                title: '管理面板',
                members: '成员管理',
                tasks: '任务管理',
                messages: '留言管理',
                settings: '系统设置',
                logs: '系统日志',
                backup: '备份管理',
                siteLock: '网站锁定',
                siteUnlock: '网站解锁',
                siteStatus: '网站状态',
                dbLock: '锁定数据库',
                dbUnlock: '解锁数据库',
                dbStatus: '数据库状态'
            },
            // 通用
            common: {
                loading: '加载中...',
                error: '错误',
                success: '成功',
                confirm: '确认',
                delete: '删除',
                edit: '编辑',
                add: '添加',
                search: '搜索',
                noData: '暂无数据',
                submit: '提交',
                back: '返回',
                close: '关闭'
            }
        }
    },
    'zh-TW': {
        name: '中文繁體',
        flag: '🇹🇼',
        translations: {
            nav: {
                brand: 'STC工會任務平台',
                home: '首頁',
                about: '關於我們',
                tasks: '任務',
                messages: '留言',
                login: '登入',
                logout: '退出',
                userCenter: '用戶中心',
                adminPanel: '管理面板',
                themeToggle: '🌙'
            },
            home: {
                title: '歡迎來到STC任務網站',
                subtitle: '一個高效的任務管理平台',
                unionDays: '工會已成立',
                years: '年',
                days: '天',
                viewTasks: '查看任務',
                viewAbout: '了解更多',
                tasksTitle: '最新任務',
                messagesTitle: '留言板',
                noTasks: '暫無任務',
                noMessages: '暫無留言',
                sendMessage: '發送留言',
                placeholderMessage: '輸入留言內容...'
            },
            about: {
                title: '關於我們',
                subtitle: 'STC工會 - 一個熱愛《我的世界》的遊戲團隊',
                announcement: '公告',
                announcementTitle: '歡迎加入STC工會！',
                announcementContent: '我們是一個專注於《我的世界》遊戲的團隊，致力於創造精彩的遊戲體驗。',
                announcementDate: '2025年1月24日',
                whoWeAre: '我們是誰',
                whoWeAreDesc: 'STC工會是一個由熱愛《我的世界》的玩家組成的團隊。我們專注於建築創作、紅石技術和伺服器管理，致力於為玩家提供優質的遊戲體驗。',
                features: '特色玩法',
                featureBuild: '建築創作',
                featureBuildDesc: '精心設計的建築作品',
                featureRedstone: '紅石技術',
                featureRedstoneDesc: '複雜的紅石機械系統',
                featureCommunity: '社群活動',
                featureCommunityDesc: '豐富的團隊活動',
                team: '核心成員',
                founder: '創始人/超級管理員',
                president: '會長',
                vicePresident: '副會長',
                architect: '建築師',
                engineer: '紅石工程師',
                member: '成員',
                teamDescFounder: '工會的創立者，負責整體規劃與管理',
                teamDescPresident: '負責工會日常運營與決策',
                teamDescVice: '協助會長處理工會事務',
                teamDescArchitect: '負責建築設計與創作',
                teamDescEngineer: '負責紅石系統開發',
                teamDescAlice: '負責紅石與建築創作',
                teamDescMember: '潛水',
                teamDescMembers: '所有成員都是工會不可或缺的力量',
                stats: '數據統計',
                statsMembers: '成員數量',
                statsProjects: '完成項目',
                statsDays: '運營天數',
                gallery: '精彩瞬間',
                joinUs: '加入我們',
                joinUsDesc: '想要加入STC工會？歡迎聯繫我們！',
                joinNow: '立即加入'
            },
            login: {
                title: '登入',
                passwordLogin: '密碼登入',
                codeLogin: '驗證碼登入',
                username: '用戶名/郵箱',
                password: '密碼',
                email: '郵箱',
                code: '驗證碼',
                sendCode: '發送驗證碼',
                loginBtn: '登入',
                noAccount: '沒有帳號？',
                register: '註冊',
                forgotPassword: '忘記密碼？'
            },
            user: {
                title: '用戶中心',
                profile: '個人資料',
                settings: '設定',
                changePassword: '修改密碼',
                oldPassword: '舊密碼',
                newPassword: '新密碼',
                confirmPassword: '確認密碼',
                save: '儲存',
                cancel: '取消'
            },
            admin: {
                title: '管理面板',
                members: '成員管理',
                tasks: '任務管理',
                messages: '留言管理',
                settings: '系統設定',
                logs: '系統日誌',
                backup: '備份管理',
                siteLock: '網站鎖定',
                siteUnlock: '網站解鎖',
                siteStatus: '網站狀態',
                dbLock: '鎖定資料庫',
                dbUnlock: '解鎖資料庫',
                dbStatus: '資料庫狀態'
            },
            common: {
                loading: '載入中...',
                error: '錯誤',
                success: '成功',
                confirm: '確認',
                delete: '刪除',
                edit: '編輯',
                add: '新增',
                search: '搜尋',
                noData: '暫無資料',
                submit: '提交',
                back: '返回',
                close: '關閉'
            }
        }
    },
    'en': {
        name: 'English',
        flag: '🇬🇧',
        translations: {
            nav: {
                brand: 'STC Union Task Platform',
                home: 'Home',
                about: 'About Us',
                tasks: 'Tasks',
                messages: 'Messages',
                login: 'Login',
                logout: 'Logout',
                userCenter: 'User Center',
                adminPanel: 'Admin Panel',
                themeToggle: '🌙'
            },
            home: {
                title: 'Welcome to STC Task Platform',
                subtitle: 'An efficient task management platform',
                unionDays: 'Union founded for',
                years: 'years',
                days: 'days',
                viewTasks: 'View Tasks',
                viewAbout: 'Learn More',
                tasksTitle: 'Latest Tasks',
                messagesTitle: 'Message Board',
                noTasks: 'No tasks available',
                noMessages: 'No messages available',
                sendMessage: 'Send Message',
                placeholderMessage: 'Enter your message...'
            },
            about: {
                title: 'About Us',
                subtitle: 'STC Union - A Minecraft Gaming Team',
                announcement: 'Announcement',
                announcementTitle: 'Welcome to STC Union!',
                announcementContent: 'We are a team focused on Minecraft, dedicated to creating amazing gaming experiences.',
                announcementDate: 'January 24, 2025',
                whoWeAre: 'Who We Are',
                whoWeAreDesc: 'STC Union is a team of Minecraft enthusiasts. We focus on building, redstone technology, and server management, dedicated to providing quality gaming experiences.',
                features: 'Features',
                featureBuild: 'Building',
                featureBuildDesc: 'Carefully designed architectural works',
                featureRedstone: 'Redstone',
                featureRedstoneDesc: 'Complex redstone mechanical systems',
                featureCommunity: 'Community',
                featureCommunityDesc: 'Rich team activities',
                team: 'Core Members',
                founder: 'Founder/Super Admin',
                president: 'President',
                vicePresident: 'Vice President',
                architect: 'Architect',
                engineer: 'Redstone Engineer',
                member: 'Member',
                teamDescFounder: 'Founder of the union, responsible for overall planning and management',
                teamDescPresident: 'Responsible for daily operations and decisions',
                teamDescVice: 'Assists the president with union affairs',
                teamDescArchitect: 'Responsible for building design and creation',
                teamDescEngineer: 'Responsible for redstone system development',
                teamDescAlice: 'Responsible for redstone and building creation',
                teamDescMember: 'Diving',
                teamDescMembers: 'All members are essential to the union',
                stats: 'Statistics',
                statsMembers: 'Members',
                statsProjects: 'Projects',
                statsDays: 'Days Active',
                gallery: 'Highlights',
                joinUs: 'Join Us',
                joinUsDesc: 'Want to join STC Union? Contact us!',
                joinNow: 'Join Now'
            },
            login: {
                title: 'Login',
                passwordLogin: 'Password Login',
                codeLogin: 'Code Login',
                username: 'Username/Email',
                password: 'Password',
                email: 'Email',
                code: 'Verification Code',
                sendCode: 'Send Code',
                loginBtn: 'Login',
                noAccount: 'No account?',
                register: 'Register',
                forgotPassword: 'Forgot password?'
            },
            user: {
                title: 'User Center',
                profile: 'Profile',
                settings: 'Settings',
                changePassword: 'Change Password',
                oldPassword: 'Old Password',
                newPassword: 'New Password',
                confirmPassword: 'Confirm Password',
                save: 'Save',
                cancel: 'Cancel'
            },
            admin: {
                title: 'Admin Panel',
                members: 'Member Management',
                tasks: 'Task Management',
                messages: 'Message Management',
                settings: 'System Settings',
                logs: 'System Logs',
                backup: 'Backup Management',
                siteLock: 'Lock Site',
                siteUnlock: 'Unlock Site',
                siteStatus: 'Site Status',
                dbLock: 'Lock Database',
                dbUnlock: 'Unlock Database',
                dbStatus: 'Database Status'
            },
            common: {
                loading: 'Loading...',
                error: 'Error',
                success: 'Success',
                confirm: 'Confirm',
                delete: 'Delete',
                edit: 'Edit',
                add: 'Add',
                search: 'Search',
                noData: 'No data',
                submit: 'Submit',
                back: 'Back',
                close: 'Close'
            }
        }
    },
    'ru': {
        name: 'Русский',
        flag: '🇷🇺',
        translations: {
            nav: {
                brand: 'Платформа задач STC',
                home: 'Главная',
                about: 'О нас',
                tasks: 'Задачи',
                messages: 'Сообщения',
                login: 'Войти',
                logout: 'Выход',
                userCenter: 'Центр пользователя',
                adminPanel: 'Админ-панель',
                themeToggle: '🌙'
            },
            home: {
                title: 'Добро пожаловать на платформу STC',
                subtitle: 'Эффективная платформа управления задачами',
                unionDays: 'Союз создан',
                years: 'лет',
                days: 'дней',
                viewTasks: 'Задачи',
                viewAbout: 'Подробнее',
                tasksTitle: 'Последние задачи',
                messagesTitle: 'Доска сообщений',
                noTasks: 'Нет задач',
                noMessages: 'Нет сообщений',
                sendMessage: 'Отправить',
                placeholderMessage: 'Введите сообщение...'
            },
            about: {
                title: 'О нас',
                subtitle: 'STC Union - Команда Minecraft',
                announcement: 'Объявление',
                announcementTitle: 'Добро пожаловать в STC Union!',
                announcementContent: 'Мы - команда,专注于 Minecraft,致力于创造精彩的游戏体验。',
                announcementDate: '24 января 2025',
                whoWeAre: 'Кто мы',
                whoWeAreDesc: 'STC Union - это команда любителей Minecraft. Мы专注于 строительство, redstone технологии и управление сервером.',
                features: 'Особенности',
                featureBuild: 'Строительство',
                featureBuildDesc: 'Качественные архитектурные работы',
                featureRedstone: 'Redstone',
                featureRedstoneDesc: 'Сложные redstone системы',
                featureCommunity: 'Комьюнити',
                featureCommunityDesc: 'Командные мероприятия',
                team: 'Основные участники',
                founder: 'Основатель/Супер-админ',
                president: 'Президент',
                vicePresident: 'Вице-президент',
                architect: 'Архитектор',
                engineer: 'Redstone инженер',
                member: 'Участник',
                teamDescFounder: 'Основатель союза, отвечает за планирование и управление',
                teamDescPresident: 'Отвечает за ежедневные операции и решения',
                teamDescVice: 'Помогает президенту с делами союза',
                teamDescArchitect: 'Отвечает за дизайн и строительство',
                teamDescEngineer: 'Отвечает за redstone системы',
                teamDescAlice: 'Отвечает за redstone и строительство',
                teamDescMember: '潜水',
                teamDescMembers: 'Все участники важны для союза',
                stats: 'Статистика',
                statsMembers: 'Участников',
                statsProjects: 'Проектов',
                statsDays: 'Дней работы',
                gallery: 'Моменты',
                joinUs: 'Присоединиться',
                joinUsDesc: 'Хотите присоединиться к STC Union? Свяжитесь с нами!',
                joinNow: 'Вступить'
            },
            login: {
                title: 'Вход',
                passwordLogin: 'По паролю',
                codeLogin: 'По коду',
                username: 'Имя/Email',
                password: 'Пароль',
                email: 'Email',
                code: 'Код',
                sendCode: 'Отправить код',
                loginBtn: 'Войти',
                noAccount: 'Нет аккаунта?',
                register: 'Регистрация',
                forgotPassword: 'Забыли пароль?'
            },
            user: {
                title: 'Центр пользователя',
                profile: 'Профиль',
                settings: 'Настройки',
                changePassword: 'Сменить пароль',
                oldPassword: 'Старый пароль',
                newPassword: 'Новый пароль',
                confirmPassword: 'Подтвердить',
                save: 'Сохранить',
                cancel: 'Отмена'
            },
            admin: {
                title: 'Админ-панель',
                members: 'Управление участниками',
                tasks: 'Управление задачами',
                messages: 'Управление сообщениями',
                settings: 'Настройки системы',
                logs: 'Системные журналы',
                backup: 'Резервное копирование',
                siteLock: 'Заблокировать сайт',
                siteUnlock: 'Разблокировать сайт',
                siteStatus: 'Статус сайта',
                dbLock: 'Заблокировать БД',
                dbUnlock: 'Разблокировать БД',
                dbStatus: 'Статус БД'
            },
            common: {
                loading: 'Загрузка...',
                error: 'Ошибка',
                success: 'Успешно',
                confirm: 'Подтвердить',
                delete: 'Удалить',
                edit: 'Редактировать',
                add: 'Добавить',
                search: 'Поиск',
                noData: 'Нет данных',
                submit: 'Отправить',
                back: 'Назад',
                close: 'Закрыть'
            }
        }
    },
    'fr': {
        name: 'Français',
        flag: '🇫🇷',
        translations: {
            nav: {
                brand: 'Plateforme de tâches STC',
                home: 'Accueil',
                about: 'À propos',
                tasks: 'Tâches',
                messages: 'Messages',
                login: 'Connexion',
                logout: 'Déconnexion',
                userCenter: 'Centre utilisateur',
                adminPanel: 'Panel admin',
                themeToggle: '🌙'
            },
            home: {
                title: 'Bienvenue sur la plateforme STC',
                subtitle: 'Une plateforme de gestion de tâches efficace',
                unionDays: 'Union fondée',
                years: 'ans',
                days: 'jours',
                viewTasks: 'Voir les tâches',
                viewAbout: 'En savoir plus',
                tasksTitle: 'Tâches récentes',
                messagesTitle: 'Tableau des messages',
                noTasks: 'Pas de tâches',
                noMessages: 'Pas de messages',
                sendMessage: 'Envoyer',
                placeholderMessage: 'Entrez votre message...'
            },
            about: {
                title: 'À propos',
                subtitle: 'STC Union - Une équipe Minecraft',
                announcement: 'Annonce',
                announcementTitle: 'Bienvenue dans STC Union!',
                announcementContent: 'Nous sommes une équipe专注于 Minecraft,致力于创造精彩的游戏体验。',
                announcementDate: '24 janvier 2025',
                whoWeAre: 'Qui sommes-nous',
                whoWeAreDesc: 'STC Union est une équipe de passionnés de Minecraft. Nous nous concentrons sur la construction, la technologie redstone et la gestion de serveur.',
                features: 'Caractéristiques',
                featureBuild: 'Construction',
                featureBuildDesc: 'Travaux architecturaux de qualité',
                featureRedstone: 'Redstone',
                featureRedstoneDesc: 'Systèmes redstone complexes',
                featureCommunity: 'Communauté',
                featureCommunityDesc: 'Activités de équipe',
                team: 'Membres clés',
                founder: 'Fondateur/Super Admin',
                president: 'Président',
                vicePresident: 'Vice-président',
                architect: 'Architecte',
                engineer: 'Ingénieur Redstone',
                member: 'Membre',
                teamDescFounder: 'Fondateur de l\'union, responsable de la planification et gestion',
                teamDescPresident: 'Responsable des opérations quotidiennes et décisions',
                teamDescVice: 'Aide le président avec les affaires de l\'union',
                teamDescArchitect: 'Responsable du design et construction',
                teamDescEngineer: 'Responsable des systèmes redstone',
                teamDescAlice: 'Responsable redstone et construction',
                teamDescMember: '潜水',
                teamDescMembers: 'Tous les membres sont essentiels à l\'union',
                stats: 'Statistiques',
                statsMembers: 'Membres',
                statsProjects: 'Projets',
                statsDays: 'Jours actifs',
                gallery: 'Moments',
                joinUs: 'Rejoignez-nous',
                joinUsDesc: 'Vous voulez rejoindre STC Union? Contactez-nous!',
                joinNow: 'Rejoindre'
            },
            login: {
                title: 'Connexion',
                passwordLogin: 'Par mot de passe',
                codeLogin: 'Par code',
                username: 'Nom/Email',
                password: 'Mot de passe',
                email: 'Email',
                code: 'Code',
                sendCode: 'Envoyer code',
                loginBtn: 'Connexion',
                noAccount: 'Pas de compte?',
                register: 'Inscription',
                forgotPassword: 'Mot de passe oublié?'
            },
            user: {
                title: 'Centre utilisateur',
                profile: 'Profil',
                settings: 'Paramètres',
                changePassword: 'Changer mot de passe',
                oldPassword: 'Ancien mot de passe',
                newPassword: 'Nouveau mot de passe',
                confirmPassword: 'Confirmer',
                save: 'Enregistrer',
                cancel: 'Annuler'
            },
            admin: {
                title: 'Panel admin',
                members: 'Gestion des membres',
                tasks: 'Gestion des tâches',
                messages: 'Gestion des messages',
                settings: 'Paramètres système',
                logs: 'Logs système',
                backup: 'Gestion des sauvegardes',
                siteLock: 'Verrouiller site',
                siteUnlock: 'Déverrouiller site',
                siteStatus: 'Statut site',
                dbLock: 'Verrouiller BDD',
                dbUnlock: 'Déverrouiller BDD',
                dbStatus: 'Statut BDD'
            },
            common: {
                loading: 'Chargement...',
                error: 'Erreur',
                success: 'Succès',
                confirm: 'Confirmer',
                delete: 'Supprimer',
                edit: 'Modifier',
                add: 'Ajouter',
                search: 'Rechercher',
                noData: 'Pas de données',
                submit: 'Soumettre',
                back: 'Retour',
                close: 'Fermer'
            }
        }
    },
    'de': {
        name: 'Deutsch',
        flag: '🇩🇪',
        translations: {
            nav: {
                brand: 'STC Aufgaben-Plattform',
                home: 'Startseite',
                about: 'Über uns',
                tasks: 'Aufgaben',
                messages: 'Nachrichten',
                login: 'Anmelden',
                logout: 'Abmelden',
                userCenter: 'Benutzerzentrum',
                adminPanel: 'Admin-Panel',
                themeToggle: '🌙'
            },
            home: {
                title: 'Willkommen auf der STC-Plattform',
                subtitle: 'Eine effiziente Aufgabenverwaltungsplattform',
                unionDays: 'Union gegründet',
                years: 'Jahre',
                days: 'Tage',
                viewTasks: 'Aufgaben anzeigen',
                viewAbout: 'Mehr erfahren',
                tasksTitle: 'Aktuelle Aufgaben',
                messagesTitle: 'Nachrichtenboard',
                noTasks: 'Keine Aufgaben',
                noMessages: 'Keine Nachrichten',
                sendMessage: 'Senden',
                placeholderMessage: 'Geben Sie Ihre Nachricht ein...'
            },
            about: {
                title: 'Über uns',
                subtitle: 'STC Union - Ein Minecraft-Team',
                announcement: 'Ankündigung',
                announcementTitle: 'Willkommen bei STC Union!',
                announcementContent: 'Wir sind ein Team专注于 Minecraft,致力于创造精彩的游戏体验。',
                announcementDate: '24. Januar 2025',
                whoWeAre: 'Wer wir sind',
                whoWeAreDesc: 'STC Union ist ein Team von Minecraft-Enthusiasten. Wir konzentrieren uns auf Bau, Redstone-Technologie und Server-Management.',
                features: 'Funktionen',
                featureBuild: 'Bau',
                featureBuildDesc: 'Qualitativ hochwertige Architekturwerke',
                featureRedstone: 'Redstone',
                featureRedstoneDesc: 'Komplexe Redstone-Systeme',
                featureCommunity: 'Community',
                featureCommunityDesc: 'Team-Aktivitäten',
                team: 'Kernmitglieder',
                founder: 'Gründer/Super-Admin',
                president: 'Präsident',
                vicePresident: 'Vizepräsident',
                architect: 'Architekt',
                engineer: 'Redstone-Ingenieur',
                member: 'Mitglied',
                teamDescFounder: 'Gründer der Union, verantwortlich für Planung und Management',
                teamDescPresident: 'Verantwortlich für tägliche Operationen und Entscheidungen',
                teamDescVice: 'Unterstützt den Präsidenten bei Union-Angelegenheiten',
                teamDescArchitect: 'Verantwortlich für Design und Bau',
                teamDescEngineer: 'Verantwortlich für Redstone-Systeme',
                teamDescAlice: 'Verantwortlich für Redstone und Bau',
                teamDescMember: '潜水',
                teamDescMembers: 'Alle Mitglieder sind wichtig für die Union',
                stats: 'Statistiken',
                statsMembers: 'Mitglieder',
                statsProjects: 'Projekte',
                statsDays: 'Aktive Tage',
                gallery: 'Momente',
                joinUs: 'Join uns',
                joinUsDesc: 'Möchten Sie STC Union joinen? Kontaktieren Sie uns!',
                joinNow: 'Joinen'
            },
            login: {
                title: 'Anmelden',
                passwordLogin: 'Passwort-Anmeldung',
                codeLogin: 'Code-Anmeldung',
                username: 'Benutzername/Email',
                password: 'Passwort',
                email: 'Email',
                code: 'Code',
                sendCode: 'Code senden',
                loginBtn: 'Anmelden',
                noAccount: 'Kein Konto?',
                register: 'Registrieren',
                forgotPassword: 'Passwort vergessen?'
            },
            user: {
                title: 'Benutzerzentrum',
                profile: 'Profil',
                settings: 'Einstellungen',
                changePassword: 'Passwort ändern',
                oldPassword: 'Altes Passwort',
                newPassword: 'Neues Passwort',
                confirmPassword: 'Bestätigen',
                save: 'Speichern',
                cancel: 'Abbrechen'
            },
            admin: {
                title: 'Admin-Panel',
                members: 'Mitgliederverwaltung',
                tasks: 'Aufgabenverwaltung',
                messages: 'Nachrichtenverwaltung',
                settings: 'Systemeinstellungen',
                logs: 'System-Logs',
                backup: 'Backup-Verwaltung',
                siteLock: 'Site sperren',
                siteUnlock: 'Site entsperren',
                siteStatus: 'Site-Status',
                dbLock: 'DB sperren',
                dbUnlock: 'DB entsperren',
                dbStatus: 'DB-Status'
            },
            common: {
                loading: 'Laden...',
                error: 'Fehler',
                success: 'Erfolg',
                confirm: 'Bestätigen',
                delete: 'Löschen',
                edit: 'Bearbeiten',
                add: 'Hinzufügen',
                search: 'Suchen',
                noData: 'Keine Daten',
                submit: 'Absenden',
                back: 'Zurück',
                close: 'Schließen'
            }
        }
    }
};

// 语言管理器
const LangManager = {
    currentLang: 'zh-CN',
    
    init() {
        // 从 localStorage 加载语言设置
        const savedLang = localStorage.getItem('stc-lang');
        if (savedLang && LANGUAGES[savedLang]) {
            this.currentLang = savedLang;
        }
        this.applyLanguage();
        this.createLangSelector();
    },
    
    setLanguage(lang) {
        if (LANGUAGES[lang]) {
            this.currentLang = lang;
            localStorage.setItem('stc-lang', lang);
            this.applyLanguage();
            // 更新选择器显示
            this.updateLangSelector();
        }
    },
    
    getTranslation(key) {
        const keys = key.split('.');
        let value = LANGUAGES[this.currentLang].translations;
        for (const k of keys) {
            if (value && value[k]) {
                value = value[k];
            } else {
                return key; // 如果找不到翻译，返回原始key
            }
        }
        return value;
    },
    
    applyLanguage() {
        // 更新页面标题
        const pageTitle = document.querySelector('title');
        if (pageTitle) {
            const page = this.detectPage();
            if (page === 'home') {
                pageTitle.textContent = this.getTranslation('home.title') + ' - STC';
            } else if (page === 'about') {
                pageTitle.textContent = this.getTranslation('about.title') + ' - STC';
            } else if (page === 'login') {
                pageTitle.textContent = this.getTranslation('login.title') + ' - STC';
            }
        }
        
        // 更新导航栏
        this.updateNavbar();
        
        // 更新页面内容
        this.updatePageContent();
        
        // 更新 HTML lang 属性
        document.documentElement.lang = this.currentLang;
    },
    
    detectPage() {
        const path = window.location.pathname;
        if (path.includes('about')) return 'about';
        if (path.includes('login')) return 'login';
        if (path.includes('user')) return 'user';
        if (path.includes('admin')) return 'admin';
        if (path.includes('task')) return 'task';
        return 'home';
    },
    
    updateNavbar() {
        // 导航栏品牌
        const brand = document.querySelector('.nav-brand a');
        if (brand) brand.textContent = this.getTranslation('nav.brand');
        
        // 导航菜单
        const navMenu = document.querySelector('.nav-menu');
        if (navMenu) {
            const items = navMenu.querySelectorAll('li a');
            items.forEach(item => {
                if (item.getAttribute('href') === '/home' || item.classList.contains('active')) {
                    if (!item.closest('#nav-user')) {
                        item.textContent = this.getTranslation('nav.home');
                    }
                }
                if (item.getAttribute('href') === '/about') {
                    item.textContent = this.getTranslation('nav.about');
                }
                if (item.getAttribute('href') === '#tasks') {
                    item.textContent = this.getTranslation('nav.tasks');
                }
                if (item.getAttribute('href') === '#messages') {
                    item.textContent = this.getTranslation('nav.messages');
                }
                if (item.getAttribute('href') === '/login') {
                    item.textContent = this.getTranslation('nav.login');
                }
                if (item.getAttribute('href') === '/user') {
                    item.textContent = this.getTranslation('nav.userCenter');
                }
                if (item.getAttribute('href') === '/admin') {
                    item.textContent = this.getTranslation('nav.adminPanel');
                }
            });
        }
    },
    
    updatePageContent() {
        // 更新带有 data-lang 属性的元素
        document.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            el.textContent = this.getTranslation(key);
        });
        
        // 更新带有 data-lang-placeholder 属性的元素
        document.querySelectorAll('[data-lang-placeholder]').forEach(el => {
            const key = el.getAttribute('data-lang-placeholder');
            el.placeholder = this.getTranslation(key);
        });
        
        // 更新带有 data-lang-title 属性的元素
        document.querySelectorAll('[data-lang-title]').forEach(el => {
            const key = el.getAttribute('data-lang-title');
            el.title = this.getTranslation(key);
        });
    },
    
    createLangSelector() {
        // 检查是否已存在选择器
        if (document.getElementById('lang-selector')) return;
        
        const navMenu = document.querySelector('.nav-menu');
        if (!navMenu) return;
        
        // 创建语言选择器
        const langItem = document.createElement('li');
        langItem.id = 'lang-selector-container';
        langItem.className = 'lang-selector-item';
        
        const langBtn = document.createElement('button');
        langBtn.id = 'lang-selector';
        langBtn.className = 'lang-selector-btn';
        langBtn.innerHTML = `<span class="lang-flag">${LANGUAGES[this.currentLang].flag}</span>`;
        langBtn.title = '切换语言';
        
        // 创建下拉菜单
        const langDropdown = document.createElement('div');
        langDropdown.className = 'lang-dropdown';
        langDropdown.id = 'lang-dropdown';
        
        for (const [code, lang] of Object.entries(LANGUAGES)) {
            const option = document.createElement('button');
            option.className = 'lang-option';
            option.setAttribute('data-lang-code', code);
            option.innerHTML = `<span class="lang-flag">${lang.flag}</span> <span class="lang-name">${lang.name}</span>`;
            option.onclick = () => {
                this.setLanguage(code);
                langDropdown.classList.remove('show');
            };
            langDropdown.appendChild(option);
        }
        
        langBtn.onclick = (e) => {
            e.stopPropagation();
            langDropdown.classList.toggle('show');
        };
        
        // 点击其他地方关闭下拉菜单
        document.addEventListener('click', () => {
            langDropdown.classList.remove('show');
        });
        
        langItem.appendChild(langBtn);
        langItem.appendChild(langDropdown);
        
        // 插入到主题切换按钮之前
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle && themeToggle.parentElement) {
            navMenu.insertBefore(langItem, themeToggle.parentElement);
        } else {
            navMenu.appendChild(langItem);
        }
    },
    
    updateLangSelector() {
        const langBtn = document.getElementById('lang-selector');
        if (langBtn) {
            langBtn.innerHTML = `<span class="lang-flag">${LANGUAGES[this.currentLang].flag}</span>`;
        }
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    LangManager.init();
});

// 导出给其他脚本使用
window.LangManager = LangManager;
window.LANGUAGES = LANGUAGES;