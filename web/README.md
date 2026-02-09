# MooncakesDailyData Web Demo

## 本地运行

1. 在仓库根目录启动静态服务器：
   ```bash
   python -m http.server 8000
   ```
2. 浏览器访问 `http://localhost:8000/web/`。

> 如果不是部署在 GitHub Pages，请在 `web/main.js` 顶部配置：
> ```js
> window.REPO_CONFIG = { owner: '你的用户名', repo: '仓库名' };
> ```

## GitHub Pages 部署

推荐使用 `web/` 作为 Pages 根目录：

1. 在 GitHub 仓库设置中进入 **Settings → Pages**。
2. 在 **Build and deployment** 中选择：
   - **Source**: Deploy from a branch
   - **Branch**: `main`
   - **Folder**: `/web`
3. 保存后等待部署完成，访问 `https://<owner>.github.io/<repo>/`。

页面会自动通过 GitHub API 读取 `data/` 与 `diff/` 目录中的 CSV 文件列表，并展示最新数据。
