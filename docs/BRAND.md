# 品牌标识 · 0.6.36

CShell 与 CAgent 共用开口 C 轮廓。CShell 的蓝色终端提示符代表工作台；CAgent 的薄荷绿星芒代表本地智能体。Pro 使用香槟金轮廓及细边框，保留产品识别，不依赖微小的 Pro 字样。

本次使用内置 imagegen 生成四个概念图，保存在 `assets/brand/generated/`。正式应用采用依据这些概念整理的 SVG，避免生成图的杂点及缩小时的模糊；PNG 和多尺寸 ICO 由 `scripts/render-icon.cjs` 渲染。基础版本已应用，Pro 仅提供设计资产，未冒充已开发的商业产品。

## 生成提示词概要

- CShell：production app icon; bold geometric white C shell enclosing terminal >_; deep ink navy tile, electric blue accent; flat vector-like geometry, transparent surround, no text.
- CAgent：same family C silhouette; replace terminal with mint four-point spark; dark teal tile; clean, small-size readable, no robot face.
- CShell Pro：preserve silhouette and terminal; champagne gold C, pale gold prompt, dark navy tile and thin inset gold border; no crown or Pro lettering.
- CAgent Pro：preserve CAgent silhouette and spark; champagne gold C, pale mint-gold spark, dark teal tile and thin gold inset border.

## 资产与再生成

- 基础版：`assets/icon.svg`、`assets/cagent-icon.svg`，对应 PNG / ICO。
- 品牌目录：`assets/brand/cshell.svg`、`cagent.svg`、`cshell-pro.svg`、`cagent-pro.svg`。
- Windows CAgent 的窗口品牌和托盘从可执行文件内嵌图标读取，同安装图标一致。
- Android 构建复制同一 CShell 图标；macOS / Linux 包装使用共享 PNG。
- 运行 `electron scripts/render-icon.cjs icon`、`cagent-icon`、`brand/cshell-pro` 或 `brand/cagent-pro` 更新输出。

当前发布为开源版，Pro 素材不改变授权、功能或现有应用名称。
