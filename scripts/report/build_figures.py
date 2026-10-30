from __future__ import annotations

import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib import font_manager

OUT = Path("docs/report-assets/figures")
OUT.mkdir(parents=True, exist_ok=True)

# Windows 自带中文字体；显式注册，避免 matplotlib 回落成方框。
FONT = "Microsoft YaHei"
if FONT not in {f.name for f in font_manager.fontManager.ttflist}:
    FONT = "SimHei"
plt.rcParams["font.family"] = FONT
plt.rcParams["axes.unicode_minus"] = False

INK = "#1f2d3d"
BLUE = "#2f6fed"
LIGHT_BLUE = "#eaf2ff"
GREEN = "#1f8f63"
LIGHT_GREEN = "#e9f7f0"
ORANGE = "#c26a1b"
LIGHT_ORANGE = "#fff3e4"
RED = "#c0392b"
LIGHT_RED = "#fdecea"
GRAY = "#6b7785"
LIGHT_GRAY = "#f4f6f8"


def box(ax, x, y, w, h, text, fc=LIGHT_BLUE, ec=BLUE, fs=10, bold=False, radius=0.02):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle=f"round,pad=0.012,rounding_size={radius}",
        linewidth=1.2, edgecolor=ec, facecolor=fc, zorder=2,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2, y + h / 2, text,
        ha="center", va="center", fontsize=fs, color=INK,
        fontweight="bold" if bold else "normal", zorder=3, linespacing=1.45,
    )


def arrow(ax, x1, y1, x2, y2, color=GRAY, style="-|>", lw=1.4, ls="-"):
    ax.add_patch(FancyArrowPatch(
        (x1, y1), (x2, y2), arrowstyle=style, mutation_scale=12,
        linewidth=lw, color=color, linestyle=ls, zorder=1,
    ))


def clean(ax, xlim=(0, 12), ylim=(0, 8)):
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.axis("off")


def save(fig, name):
    path = OUT / name
    fig.savefig(path, dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", path)


def architecture():
    fig, ax = plt.subplots(figsize=(11.5, 7.2))
    clean(ax, (0, 12), (0, 8))
    ax.text(0.15, 7.55, "安全文件存储系统分层架构", fontsize=16, fontweight="bold", color=INK)

    layers = [
        (6.25, 1.05, "表现层  React + TypeScript + Ant Design", "文件库 / 密钥管理 / 篡改实验室 / 性能测试 / 审计 / 设置", LIGHT_BLUE, BLUE),
        (4.95, 0.95, "状态与编排层  Zustand + 页面组件", "会话锁定 · 文件列表 · 加密/解密任务 · 进度/取消 · 错误码映射", LIGHT_GREEN, GREEN),
        (3.55, 1.15, "执行层  主线程 + Web Worker", "主线程：PBKDF2/scrypt、KCV、证书/信任库、RSA 私钥包装\nWorker：4 MiB 分块 AES-GCM、流式哈希、容器导入/导出、性能基准", LIGHT_ORANGE, ORANGE),
        (2.15, 1.15, "领域层  core（纯 TypeScript）", "crypto / envelope / manifest / vault / keys / storage / validation / benchmark", LIGHT_ORANGE, ORANGE),
        (0.65, 1.05, "持久化与桌面壳", "IndexedDB（files / chunks / keys / trust / audit / benchmarks）\nElectron：app:// 安全协议 · CSP · 固定 userData · 便携 exe", LIGHT_GRAY, GRAY),
    ]
    for y, h, title, detail, fc, ec in layers:
        box(ax, 0.55, y, 10.9, h, "", fc=fc, ec=ec)
        ax.text(0.85, y + h - 0.28, title, fontsize=11, fontweight="bold", color=ec, va="center")
        ax.text(0.85, y + 0.30, detail, fontsize=9.2, color=INK, va="center", linespacing=1.5)

    for y1, y2 in [(6.25, 5.90), (4.95, 4.70), (3.55, 3.30), (2.15, 1.70)]:
        arrow(ax, 6.0, y1, 6.0, y2, color=BLUE, lw=1.8)

    ax.text(11.55, 6.6, "纯本地\n无服务端", ha="center", va="center", fontsize=9, color=GRAY,
            bbox=dict(boxstyle="round,pad=0.35", fc="white", ec="#ccd3dc"))
    ax.text(11.55, 2.7, "口令不进入\nWorker", ha="center", va="center", fontsize=9, color=GRAY,
            bbox=dict(boxstyle="round,pad=0.35", fc="white", ec="#ccd3dc"))
    save(fig, "fig-2-1-architecture.png")


def key_hierarchy():
    fig, ax = plt.subplots(figsize=(11.5, 7.0))
    clean(ax, (0, 12), (0, 8))
    ax.text(0.15, 7.55, "密钥层级：口令只派生一次，文件密钥逐文件隔离", fontsize=15, fontweight="bold", color=INK)

    box(ax, 0.7, 6.25, 2.5, 0.75, "主口令 P\nUTF-8 NFC，完整参与", LIGHT_BLUE, BLUE, 9.5)
    box(ax, 3.8, 6.25, 2.7, 0.75, "PBKDF2 600k\n或 scrypt 2^17", LIGHT_BLUE, BLUE, 9.5)
    box(ax, 7.1, 6.25, 2.4, 0.75, "IKM 256 bit\n用后 best-effort 清零", LIGHT_ORANGE, ORANGE, 9.5)
    arrow(ax, 3.2, 6.62, 3.8, 6.62, color=BLUE)
    arrow(ax, 6.5, 6.62, 7.1, 6.62, color=BLUE)

    box(ax, 7.1, 5.35, 2.55, 0.55, "HKDF-SHA-256\n按 info 域分离", LIGHT_GREEN, GREEN, 9.5)
    arrow(ax, 8.3, 6.25, 8.3, 5.90, color=GREEN)

    targets = [
        (0.65, 4.25, "VMK\n文件密钥根", LIGHT_GREEN, GREEN),
        (3.55, 4.25, "keyringKey\n包装 RSA 私钥", LIGHT_GREEN, GREEN),
        (6.45, 4.25, "KCVKey\n口令校验/密钥环 HMAC", LIGHT_GREEN, GREEN),
    ]
    for x, y, text, fc, ec in targets:
        box(ax, x, y, 2.45, 0.68, text, fc, ec, 9.2)
        arrow(ax, 8.3, 5.35, x + 1.2, 4.93, color=GREEN, lw=1.2)

    box(ax, 0.65, 2.55, 2.55, 0.72, "fileSalt 16 B\n每文件随机", LIGHT_BLUE, BLUE, 9.2)
    box(ax, 3.55, 2.55, 2.55, 0.72, "HKDF → fileKEK\n文件包装密钥", LIGHT_BLUE, BLUE, 9.2)
    box(ax, 6.55, 2.55, 2.55, 0.72, "随机 DEK 16/32 B\nAES-GCM 包装", LIGHT_ORANGE, ORANGE, 9.2)
    box(ax, 9.35, 2.55, 2.1, 0.72, "4 MiB 密文分块\nGCM tag + AAD", LIGHT_ORANGE, ORANGE, 9.2)
    arrow(ax, 3.2, 2.91, 3.55, 2.91, color=BLUE)
    arrow(ax, 6.1, 2.91, 6.55, 2.91, color=ORANGE)
    arrow(ax, 9.1, 2.91, 9.35, 2.91, color=ORANGE)
    # VMK 与 fileSalt 共同参与 fileKEK 派生：用一条带标签的虚线表示。
    arrow(ax, 2.95, 4.25, 3.75, 3.27, color=GREEN, ls="--", lw=1.3)
    ax.text(2.95, 3.72, "VMK", fontsize=8.5, color=GREEN)

    box(ax, 0.65, 0.55, 10.8, 0.95,
        "keyringKey → AES-GCM 包装 RSA 私钥 PKCS#8；RSA 公钥 → 自签名 X.509 证书，SHA-256 指纹作为信任锚。\n"
        "KCVKey → 计算/校验 KCV，并对密钥环记录做 HMAC 完整性校验。改主口令只重包 wrappedDEK 与私钥；\n"
        "导入的外部容器保留原 KDF/KCV，不随本机改口令而重包。",
        LIGHT_GRAY, GRAY, 8.8)
    save(fig, "fig-2-2-key-hierarchy.png")


def rsa_d():
    fig, ax = plt.subplots(figsize=(11.5, 6.5))
    clean(ax, (0, 12), (0, 7.2))
    ax.text(0.15, 6.75, "RSA 密钥生成与“求私钥 d”流程", fontsize=15, fontweight="bold", color=INK)

    steps = [
        (0.55, 4.95, 2.35, 0.72, "选择大素数 p、q\n（3072 bit 模数）"),
        (3.35, 4.95, 2.35, 0.72, "n = p·q\nφ(n) = (p−1)(q−1)"),
        (6.15, 4.95, 2.35, 0.72, "e = 65537\n要求 gcd(e, φ(n)) = 1"),
        (8.95, 4.95, 2.45, 0.72, "求 d ≡ e^(-1) (mod φ(n))\n扩展欧几里得/模逆元"),
        (3.35, 3.28, 2.35, 0.72, "验证 e·d ≡ 1 (mod φ(n))\n公钥 (n,e)，私钥 (n,d)"),
        (6.15, 3.28, 2.35, 0.72, "签名 s = m^d mod n\n验签 m = s^e mod n"),
    ]
    for x, y, w, h, text in steps:
        box(ax, x, y, w, h, text, LIGHT_BLUE, BLUE, 9.2)
    for x1, x2 in [(2.9, 3.35), (5.7, 6.15), (8.5, 8.95)]:
        arrow(ax, x1, 5.31, x2, 5.31, color=BLUE)
    arrow(ax, 10.1, 4.95, 7.45, 4.0, color=BLUE)
    arrow(ax, 5.7, 3.64, 6.15, 3.64, color=BLUE)

    box(ax, 0.55, 1.55, 10.85, 1.15,
        "本项目实际实现：crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072,\n"
        "publicExponent: 65537, hash: 'SHA-256' }) —— 素数生成、d 计算和 CRT 指数运算由 WebCrypto 内部完成；\n"
        "应用只获得不透明 CryptoKey，落盘时导出 PKCS#8 并用 AES-GCM 包装，不解析 d。",
        LIGHT_ORANGE, ORANGE, 9.1)
    ax.text(0.75, 0.95, "报告写法：先讲教材原理（上面的扩展欧几里得），再说明工程实现把大数运算交给 WebCrypto，避免自实现侧信道与正确性风险。",
            fontsize=9, color=GRAY)
    save(fig, "fig-3-1-rsa-d.png")


def verify_flow():
    fig, ax = plt.subplots(figsize=(11.5, 7.4))
    clean(ax, (0, 12), (0, 8))
    ax.text(0.15, 7.58, "加密与解密验证流程", fontsize=15, fontweight="bold", color=INK)

    # 加密列
    ax.text(3.0, 7.05, "加密（本机）", fontsize=12, fontweight="bold", color=BLUE, ha="center")
    enc = [
        (1.25, 6.15, 3.5, 0.6, "拖拽/选择文件 → EncryptDialog"),
        (1.25, 5.15, 3.5, 0.6, "fileSalt + fileNonce；HKDF 派生 fileKEK"),
        (1.25, 4.15, 3.5, 0.6, "随机 DEK；AES-GCM 包装 wrappedDEK"),
        (1.25, 3.15, 3.5, 0.6, "4 MiB 分块：哈希 + AES-GCM（IV/AAD）"),
        (1.25, 2.15, 3.5, 0.6, "规范化清单 → RSA 签名 → pending/commit"),
    ]
    for x, y, w, h, text in enc:
        box(ax, x, y, w, h, text, LIGHT_BLUE, BLUE, 9.0)
    for y1, y2 in [(6.15, 5.75), (5.15, 4.75), (4.15, 3.75), (3.15, 2.75)]:
        arrow(ax, 3.0, y1, 3.0, y2, color=BLUE)

    # 解密列
    ax.text(9.0, 7.05, "解密（下载前）", fontsize=12, fontweight="bold", color=GREEN, ha="center")
    dec = [
        (7.0, 6.15, 4.0, 0.55, "S0 解析容器 / 规范化清单"),
        (7.0, 5.45, 4.0, 0.55, "S1 证书：指纹、主题、序列、signedAt、信任库"),
        (7.0, 4.75, 4.0, 0.55, "S2 RSA 验签：失败 → E_SIGNATURE"),
        (7.0, 4.05, 4.0, 0.55, "S3 口令 KDF + KCV：失败 → E_WRONG_PASSWORD"),
        (7.0, 3.35, 4.0, 0.55, "S4 解包 DEK；S5 分块 GCM：失败 → E_AUTH_TAG"),
        (7.0, 2.65, 4.0, 0.55, "S6 内容哈希比对：失败 → E_HASH_MISMATCH"),
        (7.0, 1.95, 4.0, 0.55, "全部通过才组装 Blob / 下载 / 审计"),
    ]
    for x, y, w, h, text in dec:
        box(ax, x, y, w, h, text, LIGHT_GREEN, GREEN, 8.8)
    for y1, y2 in [(6.15, 6.0), (5.45, 5.3), (4.75, 4.6), (4.05, 3.9), (3.35, 3.2), (2.65, 2.5)]:
        arrow(ax, 9.0, y1, 9.0, y2, color=GREEN)

    ax.text(1.25, 1.25, "签名覆盖清单（算法、KDF、wrappedDEK、哈希、证书指纹等），\n不直接覆盖密文；密文完整性由 GCM tag + AAD 负责。",
            fontsize=9.2, color=INK, bbox=dict(boxstyle="round,pad=0.35", fc=LIGHT_ORANGE, ec=ORANGE))
    ax.text(7.0, 0.95, "任何阶段失败都不生成明文下载文件。", fontsize=10, color=RED, fontweight="bold")
    save(fig, "fig-3-2-verify-flow.png")


def performance():
    fig, ax = plt.subplots(figsize=(10.5, 5.6))
    sizes = ["1 MiB", "10 MiB", "100 MiB"]
    enc_ms = [25.8, 141.5, 1230]
    dec_ms = [14.9, 130.7, 1160]
    x = range(len(sizes))
    width = 0.36
    b1 = ax.bar([i - width / 2 for i in x], enc_ms, width, label="端到端加密", color=BLUE)
    b2 = ax.bar([i + width / 2 for i in x], dec_ms, width, label="端到端解密", color=GREEN)
    ax.set_yscale("log")
    ax.set_xticks(list(x), sizes)
    ax.set_ylabel("耗时 / ms（对数坐标）")
    ax.set_title("端到端加解密耗时（本机基准，不含 IndexedDB 与下载）", fontsize=13, color=INK)
    ax.grid(axis="y", linestyle="--", alpha=0.3)
    ax.legend(frameon=False)
    for bars in (b1, b2):
        for rect in bars:
            height = rect.get_height()
            ax.annotate(f"{height:g}", (rect.get_x() + rect.get_width() / 2, height),
                        textcoords="offset points", xytext=(0, 4), ha="center", fontsize=8.5, color=INK)
    fig.subplots_adjust(bottom=0.18)
    fig.text(0.5, 0.035, "数据：artifacts/benchmark-report.md；Windows 11 / Edge 156 headless / 16 逻辑核 / 16 GiB",
             ha="center", fontsize=8, color=GRAY)
    save(fig, "fig-3-3-performance.png")


if __name__ == "__main__":
    architecture()
    key_hierarchy()
    rsa_d()
    verify_flow()
    performance()
