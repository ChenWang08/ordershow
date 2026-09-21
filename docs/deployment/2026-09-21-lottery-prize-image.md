# 奖品图片上传接口部署（2026-09-21）

2026-09-21 09:15（Asia/Shanghai）替换本机 order-show backend 容器以启用抽奖奖品图片上传接口；09:26 替换 frontend 容器以更新奖品图片原比例样式。MySQL、Redis、MinIO 容器及其数据卷保持不变。

- 新 backend 镜像：sha256:1a519dd405d64a3a56392fcac9424599016a2f711ee3e779fe0758c9e7bdedad。
- 更新前镜像：sha256:b1ababfd257f4cbe790c0c609f2d9c8fdf25c463df5e83439bcf6ad107b460d6。
- 回退标签：order-show-backend:pre-prize-image-upload-20260921。
- 新 frontend 镜像：sha256:1bf0217f4fe61a314bf6c98ad3641108389b17a5ee7ee1230fd2869ee80721fd。
- 更新前镜像：sha256:9f3e19b1a7295785cf0e0ecb83d8763daa1d32fa68ebbbc197cacb3be0b6f4f0。
- 回退标签：order-show-frontend:pre-prize-image-ratio-20260921。
- Flyway 从版本 026 应用 V027 和 V028；V028 增加 LOTTERY_PRIZE_IMAGE 文件用途及抽奖轮次图片引用。
- backend 启动完成后 readiness 为 UP，容器状态为 healthy；frontend 状态为 running，/admin 返回 HTTP 200。
- Docker 镜像构建成功，配置跳过自动化测试；没有运行测试。

2026-09-21 09:52（Asia/Shanghai）再次仅替换 frontend 容器，更新抽奖大屏的奖品名称副标题、放大奖品图片展示并移除候选资格说明。

- 新 frontend 镜像：sha256:86aea9e717eaaa597311d5854a4ffd9c478e85a89dc72c2bdd3bedb606fdab4e。
- 更新前镜像：sha256:06c23bde89df595ccd1b9bf19df334a95078200a9e961a352ba09fb95f17527d。
- 回退标签：order-show-frontend:pre-prize-caption-20260921。
- 抽奖页面返回 HTTP 200；backend 和数据服务未替换。
- 前端构建成功；没有运行测试。
- 后台业务写请求的资源不存在时显示操作级错误，不再将整个活动工作区误判为登录或活动权限失效。

2026-09-21 10:14（Asia/Shanghai）再次仅替换 frontend 容器，保留桌面端三列中奖名单、加宽名单区域、为名单区增加内部滚动，并修正已完成轮次显示真实中奖姓名。

- 新 frontend 镜像：sha256:52d4c1ab4a2d4b5768a0da58f42327e2969a379ca74552acc2542cfd50b0c7ca。
- 更新前镜像：sha256:474a1b4f7b53244442dac4c715ccec62a2dac470750b73d1ac6e44db4d09cfff。
- 回退标签：order-show-frontend:pre-winner-grid-20260921。
- 抽奖页面返回 HTTP 200；backend 和数据服务未替换。
- 前端构建成功；没有运行测试。
