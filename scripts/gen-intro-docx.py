# -*- coding: utf-8 -*-
"""Generate Claude Config Manager intro Word doc.

用法: python gen-intro-docx.py
产出: ~/Desktop/Claude-Config-Manager-项目介绍-v3.0.docx
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
except ImportError:
    print("python-docx 未安装,正在自动安装...")
    os.system(f"{sys.executable} -m pip install python-docx --quiet")
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn


DESKTOP = Path.home() / "Desktop"
OUTPUT_NAME = "Claude-Config-Manager-项目介绍-v3.0.docx"
OUTPUT_PATH = DESKTOP / OUTPUT_NAME


# ---------- 样式辅助 ----------

def _set_zh_font(run, font_name: str = "宋体", size: int = 11):
    """同时设置中英文字体 + 字号。"""
    run.font.name = font_name
    run.font.size = Pt(size)
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        from docx.oxml import OxmlElement
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), font_name)
    rFonts.set(qn("w:ascii"), "Calibri")
    rFonts.set(qn("w:hAnsi"), "Calibri")


def add_heading(doc: Document, text: str, level: int = 1):
    """添加标题(H1 18pt 加粗,H2 14pt 加粗)。"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run(text)
    run.bold = True
    _set_zh_font(run, size=18 if level == 1 else 14)
    return p


def add_paragraph(doc: Document, text: str, size: int = 11, bold: bool = False,
                   align: str = "left"):
    """添加正文段落。"""
    p = doc.add_paragraph()
    p.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
    }[align]
    run = p.add_run(text)
    run.bold = bold
    _set_zh_font(run, size=size)
    return p


def add_ascii_block(doc: Document, lines: list[str]):
    """添加 ASCII 框图(Consolas 9pt,浅灰底)。"""
    for line in lines:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(9)
        rPr = run._element.get_or_add_rPr()
        from docx.oxml import OxmlElement
        rFonts = OxmlElement("w:rFonts")
        rFonts.set(qn("w:ascii"), "Consolas")
        rFonts.set(qn("w:hAnsi"), "Consolas")
        rFonts.set(qn("w:eastAsia"), "Consolas")
        rPr.append(rFonts)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "F5F5F5")
        pPr = p._element.get_or_add_pPr()
        pPr.append(shd)


def add_table(doc: Document, headers: list[str], rows: list[list[str]],
              col_widths: list[float] | None = None):
    """添加对比表(headers + rows)。"""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    # header
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = ""
        p = hdr_cells[i].paragraphs[0]
        run = p.add_run(h)
        run.bold = True
        _set_zh_font(run, size=11)
        from docx.oxml import OxmlElement
        tcPr = hdr_cells[i]._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "E1E4E8")
        tcPr.append(shd)
    # body
    for r_idx, row in enumerate(rows, start=1):
        cells = table.rows[r_idx].cells
        for c_idx, val in enumerate(row):
            cells[c_idx].text = ""
            p = cells[c_idx].paragraphs[0]
            run = p.add_run(val)
            _set_zh_font(run, size=10)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Cm(w)
    return table


def add_page_break(doc: Document):
    doc.add_page_break()


def set_footer(doc: Document, version: str):
    section = doc.sections[0]
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(f"Claude Config Manager · {version} · ")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x8B, 0x94, 0x9E)
    # add page number field
    fld_char_begin = run._element.makeelement(qn("w:fldChar"), {"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fldCharType": "begin"})
    instr_text = run._element.makeelement(qn("w:instrText"), {})
    instr_text.text = "PAGE"
    fld_char_end = run._element.makeelement(qn("w:fldChar"), {"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fldCharType": "end"})
    run2 = p.add_run()
    run2._element.append(fld_char_begin)
    run2._element.append(instr_text)
    run2._element.append(fld_char_end)
    run2.font.size = Pt(9)
    run2.font.color.rgb = RGBColor(0x8B, 0x94, 0x9E)


# ---------- 内容常量 ----------

VERSION = "v3.0"
DATE = "2026-06-24"

COVER_TITLE = "Claude Config Manager"
COVER_SUBTITLE = "Claude Code 跨平台配置管理工具"

POSITIONING = (
    "Claude Config Manager 是一款跨平台桌面工具,"
    "帮助 Claude Code 重度用户在多个 API provider 之间 1 秒切换,"
    "安全管理 settings.json,实时查看用量。"
    "支持 Windows 11 与 macOS 26 双平台。"
)

PAIN_TABLE_HEADERS = ["现状(手动)", "用 Claude Config Manager"]
PAIN_TABLE_ROWS = [
    ["手编 ~/.claude/settings.json 切换 provider(2-5 分钟,易错)", "双击卡片,1 秒切换,自动备份原文件"],
    ["复制 ANTHROPIC_AUTH_TOKEN 字段容易漏空格", "表单 + 校验 + token-mask 防肩窥"],
    ["MCP 启用列表手改,容易破坏其他键", "一行 toggle,只动 mcpServers 字段,其他键保留"],
    ["用量超额才发现被限额", "provider 卡片常驻用量徽章,详情页看精确数字"],
    ["想看当前生效的 env/hooks,只能 cat settings.json", "可视化 JSON 编辑器,带语法高亮 + 校验 + 格式化"],
]

ASCII_LIST_SWITCH = [
    "┌────────────────────────────────────────────────────────┐",
    "│ Claude 配置管理器                          [_] [□] [×] │",
    "├────┬───────────────────────────────────────────────────┤",
    "│ 🏠 │  提供商            [搜索] [+ 新建] [导入]          │",
    "│ 提商│  ─────────────────────────────────────────────    │",
    "│    │  ● GLM-4.6 (官方)    base=...   [● 已激活] [切换]  │",
    "│    │    5 个模型 · 上次使用 2 分钟前                     │",
    "│ 🔌 │  ─────────────────────────────────────────────    │",
    "│    │  ○ DeepSeek-V3       base=...   [启用]   [切换]    │",
    "│ MCP│    3 个模型 · 上次使用 昨天                        │",
    "│ 📥 │  ─────────────────────────────────────────────    │",
    "│ 导入│  ○ 自定义代理        base=...   [启用]   [切换]    │",
    "└────┴───────────────────────────────────────────────────┘",
]

ASCII_MCP = [
    "┌──────────────────────────────────────────┐",
    "│  MCP Server 管理                         │",
    "├──────────────────────────────────────────┤",
    "│  ✅ sequential-thinking    [开]           │",
    "│     npx -y @modelcontextprotocol/...     │",
    "│  ─────────────────────────────────       │",
    "│  ✅ filesystem             [开]           │",
    "│     npx -y @anthropic/mcp-fs             │",
    "│  ─────────────────────────────────       │",
    "│  ⬜ github                [关]           │",
    "│     npx -y @modelcontextprotocol/github  │",
    "└──────────────────────────────────────────┘",
]

ASCII_USAGE = [
    "┌──────────────────┐",
    "│ GLM-4.6 (官方)   │",
    "│                  │",
    "│ ● 35% ████░ 5h   │",
    "│   62% ██████ 1w  │",
    "│   28% ██░░░░ 1m  │",
    "│                  │",
    "│ 上次更新:2 分钟前 │",
    "│ [刷新]            │",
    "└──────────────────┘",
]

ASCII_IMPORT_SQL = [
    "┌────────────────────────────────────┐",
    "│  cc-switch .sql 导入               │",
    "├────────────────────────────────────┤",
    "│  ☐ GLM-4.6 (官方)    base=...  ✓   │",
    "│  ☐ DeepSeek-V3       base=...  ✓   │",
    "│  ☐ 自定义            base=...  ✓   │",
    "│  ──────────────────────────────    │",
    "│  5 个将被导入                       │",
    "│       [取消]    [导入]              │",
    "└────────────────────────────────────┘",
]

ASCII_ARCHITECTURE = [
    "┌───────────────────────────────┐",
    "│  React 19 + TS + Tailwind     │",
    "├───────────────────────────────┤",
    "│  Rust (Tauri v2)              │",
    "│  ├ domain/  业务模型           │",
    "│  ├ services/ 业务逻辑          │",
    "│  ├ infra/ 文件IO/HTTP/git     │",
    "│  ├ platform/ OS 抽象(8 trait) │",
    "│  └ plugins/ 插件系统(24个)    │",
    "├───────────────────────────────┤",
    "│  Windows 11  /  macOS 26      │",
    "└───────────────────────────────┘",
]

TECH_BULLETS = [
    "跨平台原生体验:Tauri v2 单一代码库,Windows 11 + macOS 26 双平台原生窗口 + 系统托盘;OS 差异全部抽象到 8 个 trait(单实例锁 / 路径 / 开机自启 / 文件管理器 / 通知 / 应用菜单 / 窗口装饰 / git 客户端),Windows 8/8 live、macOS 7/8 live。",
    "5 层架构 + 插件系统:domain / services / infrastructure / platform / plugins 分层清晰;24 个 plugin(F1-F8 核心 + F16-F24 高级)统一接口,新增功能 = 写新 plugin。",
    "三层自动化测试:单元(Vitest / cargo test)+ 集成 + UI e2e(Playwright + tauri-driver)。",
    "三阶段代码评审:每次迭代必过 自审 → 头脑风暴 → 同行评审 → 业务流程分析,缺陷在 ship 前拦截。",
]

PROGRESS_TABLE_HEADERS = ["里程碑", "状态", "范围"]
PROGRESS_TABLE_ROWS = [
    ["M1 架构期", "✅ 完成", "Tauri 骨架 / 8 traits / 12 plugin stub / 设计系统 / CI"],
    ["M2.1–M2.16 业务实现", "✅ 完成", "F1-F8 + F13 + F14 + F15 + F17 + F20-F23 + Mac 平台修复"],
    ["M2.17 收尾", "🚧 进行中", "文档收尾 + 集成 ship"],
    ["v3.0 主题重构", "✅ 完成", "2 套插件式主题(light 瓷白 + anime 薄荷汽水)+ ThemeRegistry + localStorage 持久化"],
]

ROADMAP_TABLE_HEADERS = ["任务", "标题", "范围"]
ROADMAP_TABLE_ROWS = [
    ["M3.0", "主题系统", "2 套主题 + 主题切换 + 持久化 ✅"],
    ["M3.1", "用量监控深化", "余额/时间窗/告警阈值 + 邮件告警"],
    ["M3.2", "智能优化(F18)", "一键扫描 settings.json + 三级建议 + 一键应用"],
    ["M3.3", "备份 diff(F24)", "选两个版本显示字段级 diff"],
    ["M3.4", "资源浏览(F16)", "查看 ~/.claude/settings.json 启用的 plugins/skills/commands/LSP"],
    ["M3.5", "在线安装(F17)", "内置推荐仓库 + 第三方 git URL 拉取"],
    ["M3.6", "错误反馈升级(F15)", "详细错误分类 + 一键复制诊断信息"],
    ["M3.7", "i18n 基础", "抽取所有中文字符串到资源文件"],
    ["M3.8", "自动更新", "应用内检查更新 + 增量下载 + 自动签名校验"],
]


# ---------- 主流程 ----------

def build_doc() -> Document:
    doc = Document()

    # 页面设置:A4 + 较窄的边距
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    set_footer(doc, VERSION)

    # === 1. 封面 ===
    add_paragraph(doc, "", size=8)
    add_paragraph(doc, "", size=8)
    add_paragraph(doc, COVER_TITLE, size=28, bold=True, align="center")
    add_paragraph(doc, COVER_SUBTITLE, size=14, align="center")
    add_paragraph(doc, "", size=8)
    add_paragraph(doc, "", size=8)
    add_paragraph(doc, f"版本 {VERSION}   {DATE}", size=11, align="center")
    add_page_break(doc)

    # === 2. 一句话定位 ===
    add_heading(doc, "1. 一句话定位", level=1)
    add_paragraph(doc, POSITIONING, size=12)
    add_paragraph(doc, "技术栈:Tauri v2 + React 19 + TypeScript 5 + Rust + Tailwind/shadcn。",
                  size=11)
    add_page_break(doc)

    # === 3. 三大痛点 ===
    add_heading(doc, "2. 三大用户痛点", level=1)
    add_paragraph(doc, "Claude Config Manager 解决 Claude Code 重度用户最常遇到的三个真实痛点:",
                  size=11)
    add_table(doc, PAIN_TABLE_HEADERS, PAIN_TABLE_ROWS, col_widths=[7.0, 10.0])
    add_page_break(doc)

    # === 4. 核心功能(5 个 ASCII 框图)===
    add_heading(doc, "3. 核心功能", level=1)
    add_paragraph(doc, "围绕 24 大功能(F1–F24),本节展示最常用的 5 个场景。",
                  size=11)

    add_heading(doc, "3.1 Provider 列表 + 一键切换(F1 / F2)", level=2)
    add_paragraph(doc, "主页所有 provider 卡片化展示,当前激活有蓝色高亮 + 徽章。"
                  "双击卡片或点[切换]按钮即可秒级切换,自动备份原 settings.json。",
                  size=11)
    add_ascii_block(doc, ASCII_LIST_SWITCH)

    add_heading(doc, "3.2 MCP Server 管理(F6)", level=2)
    add_paragraph(doc, "列表式 MCP 管理,一行 toggle 即可启用/禁用某个 server;"
                  "只动 mcpServers 字段,其他键(numStartups / userID / projects)完整保留。",
                  size=11)
    add_ascii_block(doc, ASCII_MCP)

    add_heading(doc, "3.3 实时用量查询(F7)", level=2)
    add_paragraph(doc, "provider 卡片常驻用量徽章,支持 Anthropic 官方(3 个时间窗)、"
                  "DeepSeek(余额)、OpenAI 兼容(余额)三种查询策略,5 分钟内存缓存。",
                  size=11)
    add_ascii_block(doc, ASCII_USAGE)

    add_heading(doc, "3.4 cc-switch .sql 导入(F3)", level=2)
    add_paragraph(doc, "从 cc-switch 备份的 .sql 文件批量导入 provider + MCP,"
                  "预览页可勾选/重命名/跳过,ID 冲突默认重命名。",
                  size=11)
    add_ascii_block(doc, ASCII_IMPORT_SQL)

    add_heading(doc, "3.5 5 层架构总览", level=2)
    add_paragraph(doc, "Tauri v2 单一代码库,前后端镜像结构:"
                  "每个业务功能 = 1 个 Rust backend service + 1 个 React frontend page + 1 个 Tauri command 包装。",
                  size=11)
    add_ascii_block(doc, ASCII_ARCHITECTURE)
    add_page_break(doc)

    # === 5. 技术亮点 ===
    add_heading(doc, "4. 技术亮点", level=1)
    for bullet in TECH_BULLETS:
        add_paragraph(doc, f"• {bullet}", size=11)
    add_page_break(doc)

    # === 6. 当前进度 ===
    add_heading(doc, "5. 当前进度", level=1)
    add_table(doc, PROGRESS_TABLE_HEADERS, PROGRESS_TABLE_ROWS,
              col_widths=[4.0, 3.0, 10.0])
    add_page_break(doc)

    # === 7. 路线图 ===
    add_heading(doc, "6. 路线图(M3.x 计划)", level=1)
    add_table(doc, ROADMAP_TABLE_HEADERS, ROADMAP_TABLE_ROWS,
              col_widths=[2.0, 4.0, 11.0])
    add_page_break(doc)

    # === 8. 版本说明 ===
    add_heading(doc, "7. 版本说明", level=1)
    add_paragraph(doc, f"版本:{VERSION}", size=11)
    add_paragraph(doc, f"发布日期:{DATE}", size=11)
    add_paragraph(doc, "支持平台:Windows 11 (10.0.22000+)/ macOS 26 Tahoe",
                  size=11)
    add_paragraph(doc, "技术栈:Tauri v2 + React 19 + TypeScript 5 + Rust + Tailwind/shadcn",
                  size=11)
    add_paragraph(doc, "项目仓库:见 GitHub `claude-config-manager`(内部地址)",
                  size=11)
    add_paragraph(doc, " ", size=11)
    add_paragraph(doc, "— END —", size=10, align="center")

    return doc


def main():
    print(f"[*] 输出路径:{OUTPUT_PATH}")
    doc = build_doc()
    doc.save(str(OUTPUT_PATH))
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"[✓] 已生成:{OUTPUT_PATH}({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()