# 跨系统同步开发指南

本文档用于记录本项目在 Linux 和 Windows 之间切换开发环境时的同步方式，以及 Windows 首次跑通项目需要准备的内容。

项目当前技术栈为 Expo + React Native + TypeScript + pnpm + EAS Build。后续跨系统开发时，建议只通过 GitHub 同步代码，通过 Supabase 同步业务数据，不要复制整个本地项目目录。

## 一、同步原则

### 1. GitHub 同步代码

需要提交到 GitHub 的内容：

- `app/`、`components/`、`lib/` 等源码
- `package.json`
- `pnpm-lock.yaml`
- `app.json`
- `eas.json`
- `supabase/migrations/`
- `docs/`
- `.env.example`

不要提交的内容：

- `node_modules/`
- `.expo/`
- `dist/`
- `android/`
- `ios/`
- `.env.local`
- 任何真实 API Key、Supabase service role key、OCR/LLM/Tavily/Whisper secret

当前仓库的 `.gitignore` 已经覆盖了主要本地文件和密钥文件。后续新增环境变量时，只更新 `.env.example` 的变量名，不要把真实值写入 Git。

### 2. Supabase 同步业务数据

代码通过 GitHub 同步，App 内数据通过 Supabase 同步。

切换电脑前，先在 App 里确认同步状态：

- 待同步数量为 0 时，再切换开发环境
- 如果仍有 `pending` 数据，先联网等待同步完成
- 本地 SQLite 数据不会跟随 GitHub 自动迁移到另一台电脑

如果登录同一个 Supabase 用户账号，Windows 上启动 App 后应从 Supabase 拉取云端数据并合并到本地 SQLite。

### 3. EAS 云端构建

Android development build 由 EAS 云端构建，不依赖本地 Android Studio。

只要 Windows 上登录同一个 Expo 账号，并且仓库里保留 `app.json` 的 EAS project id 和 `eas.json`，就可以继续使用同一个 EAS 项目。

## 二、Linux 日常提交流程

开发完成后，在 Linux 项目目录执行：

```bash
pnpm lint
git status
git add .
git commit -m "描述本次修改"
git push
```

如果当前机器还没有配置 GitHub 远端，先添加远端：

```bash
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin master
```

如果使用 SSH：

```bash
git remote add origin git@github.com:<你的用户名>/<你的仓库名>.git
git push -u origin master
```

后续每次提交只需要：

```bash
git push
```

## 三、Windows 首次准备

建议把项目放在简单路径，例如：

```text
C:\dev\zhanji
```

避免放在 OneDrive、中文路径、带空格路径中。

需要安装：

- Git for Windows
- Node.js 20 LTS 或更高版本
- pnpm
- VS Code 或 Cursor
- Android 手机
- 已安装本项目的 EAS development build APK
- Expo/EAS 账号

启用 pnpm：

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

安装 EAS CLI：

```powershell
npm install -g eas-cli
eas login
```

建议设置 Git 换行策略，减少 Windows/Linux 切换时的无意义 diff：

```powershell
git config --global core.autocrlf input
```

## 四、Windows 使用 GitHub 拉取并运行项目

当前 Linux 工作区已推送到 GitHub 仓库的 `master` 分支。Windows 上要使用这批最新文件，应显式拉取 `master` 分支，而不是默认分支：

```powershell
cd C:\dev
git clone -b master git@github.com:yued2013-hash/-ExhiTrack-.git zhanji
cd zhanji
pnpm install --frozen-lockfile
```

如果 Windows 没有配置 GitHub SSH key，也可以用 HTTPS：

```powershell
cd C:\dev
git clone -b master https://github.com/yued2013-hash/-ExhiTrack-.git zhanji
cd zhanji
pnpm install --frozen-lockfile
```

其他仓库或后续更换默认分支时，可以参考这个通用模板：

```powershell
cd C:\dev
git clone https://github.com/<你的用户名>/<你的仓库名>.git zhanji
cd zhanji
pnpm install --frozen-lockfile
```

创建本地环境变量文件：

```powershell
copy .env.example .env.local
```

然后打开 `.env.local`，填入真实值：

```env
EXPO_PUBLIC_SUPABASE_URL=你的 Supabase URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=你的 Supabase anon key
```

启动 development build 调试：

```powershell
pnpm exec expo start --dev-client
```

手机打开已安装的 development build，然后扫码或连接 Metro。

如果手机和电脑不在同一局域网，或连接失败，使用 tunnel：

```powershell
pnpm exec expo start --dev-client --tunnel
```

## 五、Windows 日常开发流程

每次开始前先同步最新代码：

```powershell
git pull
pnpm install --frozen-lockfile
pnpm exec expo start --dev-client
```

开发完成后提交：

```powershell
pnpm lint
git status
git add .
git commit -m "描述本次修改"
git push
```

如果只改了 JS/TS/样式/页面逻辑，不需要重新 EAS Build。

如果修改了以下内容，需要重新打 Android development build：

- 新增或移除原生模块
- 修改 `app.json` 的 plugins
- 修改 Android 权限
- 修改 intent filter，例如分享入口
- 修改图标、启动屏、package name

重新构建命令：

```powershell
eas build --profile development --platform android
```

## 六、Expo Go 与 Development Build 的区别

当前项目已经使用了 `expo-dev-client` 和 `expo-share-intent`，因此完整测试应使用 EAS development build。

Expo Go 适合测试纯 JS 和大部分 Expo 官方模块，但不适合测试：

- 系统分享入口
- 自定义 dev client
- 需要原生配置的插件
- 修改了 `app.json` plugins 后的能力

日常建议默认使用：

```bash
pnpm exec expo start --dev-client
```

## 七、切换系统前检查清单

离开当前系统前：

- 运行 `pnpm lint`
- 确认 `.env.local` 没有被提交
- 确认 App 内待同步数据为 0
- 提交 `package.json` 和 `pnpm-lock.yaml` 的依赖变化
- 提交 `supabase/migrations/` 的数据库迁移
- 推送到 GitHub

到另一套系统后：

- `git pull`
- `pnpm install --frozen-lockfile`
- 确认 `.env.local` 存在且值正确
- `pnpm exec expo start --dev-client`
- 用同一个账号登录 App，检查 Supabase 数据是否拉取成功

## 八、常见问题

### 1. Windows 扫码连不上

优先确认手机和电脑在同一 WiFi。仍失败时使用：

```powershell
pnpm exec expo start --dev-client --tunnel
```

### 2. Windows 出现大量换行 diff

先检查 Git 设置：

```powershell
git config --global core.autocrlf input
```

如果问题仍反复出现，可以后续在仓库新增 `.gitattributes` 固定文本文件使用 LF。

### 3. 安装依赖后运行异常

清理本地缓存后重装：

```powershell
Remove-Item -Recurse -Force node_modules
pnpm install --frozen-lockfile
pnpm exec expo start --dev-client -c
```

### 4. 新增原生模块后手机无反应

仅重启 Metro 不够，需要重新 EAS Build：

```powershell
eas build --profile development --platform android
```

安装新 APK 后再运行：

```powershell
pnpm exec expo start --dev-client
```
