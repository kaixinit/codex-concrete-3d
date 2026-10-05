# 全流程动画 / Workflow showreel

动画复用 `PlantScene`、程序化设备/车辆模型及 `getWorkflowState`。浏览器逐帧渲染真实 WebGL 场景，以 WebCodecs VP8 编码为 IVF 母版，再用 FFmpeg 转为 H.264 MP4 和循环 GIF。字幕和流程栏在同一画布中合成；不是由静态截图拼接的幻灯片。

The exporter renders this project's actual WebGL scene frame by frame, samples its deterministic workflow, encodes a VP8 IVF master with WebCodecs, and converts it with FFmpeg. Captions are composited into the same output canvas.

每个镜头 4 秒，13 个镜头共 52 秒。播放时间压缩了业务时间，并选取关键作业片段；没有声称以真实作业速度复现全部流程，也不代替产品中的人工确认门控。所有业务数据均为模拟。MP4 的 30 fps 是导出规格，不能作为浏览器实时帧率证据。

| 片中时间 | 内容 | 业务时钟范围（秒） |
| --- | --- | --- |
| 00–04 | 厂家到搅拌站的原料运输 | 砂 8–18 |
| 04–08 | 砂石自卸车卸料入仓 | 砂 47–58.8 |
| 08–12 | 装载机取料、收斗与退出 | 砂 89–98 |
| 12–16 | 装载机转运、举臂与卸斗 | 砂 98–113 |
| 16–20 | 水泥接管、气力入罐与清管 | 水泥 47.2–57 |
| 20–24 | 粉煤灰接管、气力入罐与清管 | 粉煤灰 47.2–57 |
| 24–28 | 中控配方、试配与确认 | 配送 0–21.8 |
| 28–32 | 自动配料与双轴搅拌剖视 | 配送 22–31.8 |
| 32–36 | 搅拌车装料 | 配送 32–40.9 |
| 36–40 | 站外运输、同车镜头跟随 | 配送 49–66.8 |
| 40–44 | 工地泵送、卸料与模拟交付 | 配送 73–90.8 |
| 44–48 | 空车沿道路返站 | 配送 91–108.8 |
| 48–52 | 进入洗车区与喷淋清洗 | 配送 109–115.9 |

## 重新制作

1. 安装项目依赖并执行 `npm run dev`，用新版 Chrome 或 Edge 打开 `http://127.0.0.1:5178/?showreel`。也可通过本地 HTTP 服务打开构建后的 `dist/index.html?showreel`。
2. 用“分镜预览”检查构图；点击“导出 52 秒动画”。保持本页开启，等待全部 1,560 帧完成后下载 IVF 母版。需要浏览器支持 WebCodecs / VP8；该功能不要求摄像头、麦克风或屏幕录制权限。
3. 安装可选的视频转换依赖：`python -m pip install imageio-ffmpeg==0.6.0 Pillow`。转换脚本也支持通过 `IMAGEIO_FFMPEG_EXE` 指定已有的 FFmpeg。
4. 执行下列命令。完整 MP4 保留全部镜头；GIF 在完整时间范围上加速至约 26 秒，超过大小预算时仅降低画幅、帧率或调色板。

```sh
python scripts/encode-showreel.py concrete-3d-showreel.ivf --output-prefix docs/media/concrete-showreel --gif-speed 2 --gif-width 720 --gif-fps 8 --gif-colors 80 --gif-dither none --gif-max-bytes 9900000
```

分镜、业务时间和镜头位置在 `src/showreelTimeline.js` 中维护。修改后执行 `npm run build`、`node scripts/verify-showreel.mjs`，再重新录制并转换。查看媒体文件本身不需要 Python 或 FFmpeg。

## 放到 GitHub

README 使用相对路径引用 GIF，因此仓库首页可以直接显示动画。完整 MP4 使用文件链接；不要把 MP4 写成 Markdown 图片并期待它自动成为视频播放器。媒体与源码通过同一仓库的普通 Git 提交更新。

本仓库提供的是作品动画、源码和独立 HTML 预览；GitHub Pages 的在线交互部署需另行配置。

当前成片：MP4 为 52.00 秒、1280×720、H.264 / yuv420p、30 fps、9,851,833 字节；GIF 为 26.01 秒、720×406、208 帧、8 fps、80 色、无限循环、9,650,224 字节。IVF 母版的 1,560 个时戳连续，完整 MP4 解码验证通过。业务分镜验证会确认实际卸料、取料、供料、两种粉料、装车、泵送、模拟签收、返站与洗车均出现在采样范围内。
