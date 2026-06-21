//! `resource_detail` — F22 资源详情读取(M2.16)。
//!
//! 给定一个资源路径 + kind,产出 [`ResourceDetail`]:
//!   - `files`:目录下相对路径列表(深度 ≤ 2,上限 200 项)
//!   - `description`:从 manifest 提取的描述(best-effort)
//!   - `manifest`:解析后的 manifest(JSON Value,best-effort)
//!
//! ## 设计原则
//!
//! - **best-effort,不报错**:manifest 缺失/损坏只返回 `None`,不
//!   抛错。F22 是只读详情面板,不该因 manifest 缺失就阻塞用户。
//!   (SPEC §6.5 "不允许静默吞错"指的是要给用户看错误,这里"无
//!   manifest"是正常状态不是错误,展示"暂无描述"即可。)
//! - **std::fs + serde_json,不加新 crate**:frontmatter 解析手写,
//!   不引入 serde_yaml(反事故:Cargo.toml 不动)。
//! - **深度上限 2 + 数量上限 200**:防大目录(如 plugins 下含
//!   node_modules)拖慢面板。跳过 node_modules / target / __pycache__
//!   等构建产物目录。
//! - **不改 ResourceItem 模型**:detail 是独立结构,列表层无感知
//!   (反事故:F16 已 ship)。

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::domain::{ResourceDetail, ResourceKind};

/// 文件列表的深度上限(防大目录爆炸)。0 = 只列根目录直接子项,
/// 1 = 列到子目录的直接子项,2 = 列到孙目录的直接子项。
const MAX_DEPTH: usize = 2;

/// 文件列表的数量上限。超过则截断(前端会显示"... 还有 N 项未列出")。
const MAX_FILES: usize = 200;

/// 读取资源详情。best-effort:任何读取/解析失败都返回对应字段的
/// `None` / 空 Vec,不抛错。
///
/// `path` 可以是文件或目录;`kind` 决定 manifest 识别策略。
pub fn read_resource_detail(path: &Path, kind: ResourceKind) -> ResourceDetail {
    // 单文件资源(command / lsp / mcp)不列文件列表——path 本身就是
    // 唯一文件,前端已展示 path。
    let is_dir = path.is_dir();
    let files = if is_dir {
        list_files(path)
    } else {
        Vec::new()
    };

    let (description, manifest) = read_manifest(path, kind, is_dir);

    ResourceDetail {
        files,
        description,
        manifest,
    }
}

// ---------------------------------------------------------------------------
// 文件列表
// ---------------------------------------------------------------------------

/// 列出目录下的相对路径(深度 ≤ MAX_DEPTH,上限 MAX_FILES 项)。
///
/// 相对路径用 `/` 分隔(跨平台一致,前端渲染统一)。跳过:
///   - dotfiles(`.` / `..` / `.git` 等)
///   - 构建产物目录(node_modules / target / __pycache__ / dist / build)
///
/// 结果按字典序排序,便于用户浏览。
fn list_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= MAX_FILES {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(it) => it,
            Err(_) => continue, // 权限/不存在 → 跳过,不阻塞
        };
        let mut child_names: Vec<(String, PathBuf)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match entry.file_name().to_str() {
                Some(n) => n.to_string(),
                None => continue,
            };
            // 跳过 dotfiles。
            if name.starts_with('.') {
                continue;
            }
            // 跳过构建产物目录(只在进入子目录时检查,文件不跳过)。
            if path.is_dir() && is_noise_dir(&name) {
                continue;
            }
            child_names.push((name, path));
        }
        // 字典序排序,保证稳定输出。
        child_names.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, child_path) in child_names {
            if out.len() >= MAX_FILES {
                break;
            }
            // 相对路径:从 root 开始算。
            let rel = child_path
                .strip_prefix(root)
                .ok()
                .and_then(|p| p.to_str())
                .map(|s| s.replace('\\', "/"))
                .unwrap_or_else(|| name.clone());
            out.push(rel);
            // 子目录继续递归(深度 ≤ MAX_DEPTH)。
            if child_path.is_dir() && depth + 1 < MAX_DEPTH {
                stack.push((child_path, depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// 判断目录名是否为构建产物/缓存(跳过以加速大目录)。
fn is_noise_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "__pycache__" | "dist" | "build"
            | ".venv" | "venv" | ".git" | ".idea" | ".vscode"
    )
}

// ---------------------------------------------------------------------------
// manifest 读取
// ---------------------------------------------------------------------------

/// 按 kind 识别并读取 manifest。返回 `(description, manifest_value)`。
/// 无 manifest / 解析失败 → `(None, None)`。
fn read_manifest(
    path: &Path,
    kind: ResourceKind,
    is_dir: bool,
) -> (Option<String>, Option<Value>) {
    match kind {
        ResourceKind::Plugin => read_plugin_manifest(path),
        ResourceKind::Skill => read_skill_manifest(path, is_dir),
        ResourceKind::Command => read_markdown_manifest(path),
        ResourceKind::Lsp => read_json_manifest(path),
        ResourceKind::Mcp => read_mcp_manifest(path),
    }
}

/// Plugin:优先 plugin.json,其次 .claude-plugin/plugin.json,最后
/// package.json。description 取 `.description`,缺失则取 `.name`。
fn read_plugin_manifest(path: &Path) -> (Option<String>, Option<Value>) {
    let candidates = [
        path.join("plugin.json"),
        path.join(".claude-plugin").join("plugin.json"),
        path.join("package.json"),
    ];
    for candidate in &candidates {
        if let Ok(body) = std::fs::read_to_string(candidate) {
            if let Ok(value) = serde_json::from_str::<Value>(&body) {
                let desc = value
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        value
                            .get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    });
                return (desc, Some(value));
            }
        }
    }
    (None, None)
}

/// Skill:目录则读 SKILL.md,文件则读自身。解析 frontmatter 的
/// `description` 字段。
fn read_skill_manifest(path: &Path, is_dir: bool) -> (Option<String>, Option<Value>) {
    let target = if is_dir {
        path.join("SKILL.md")
    } else {
        path.to_path_buf()
    };
    read_markdown_manifest(&target)
}

/// Command:读 .md 文件,解析 frontmatter。description 取
/// frontmatter 的 `description`,缺失则取首段非标题正文(best-effort)。
fn read_markdown_manifest(path: &Path) -> (Option<String>, Option<Value>) {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    if let Some((frontmatter, _rest)) = parse_frontmatter(&body) {
        let desc = frontmatter
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                frontmatter
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });
        return (desc, Some(Value::Object(frontmatter)));
    }
    // 无 frontmatter:取首个非空、非标题(`#` 开头)的段落作为描述。
    //
    // 真实场景里 SKILL.md / command .md 经常长这样:
    //   # Title
    //
    //   Description text...
    //
    // 旧实现用 `find(|l| !l.is_empty() && !l.starts_with('#'))` —— 但遇到
    // `# Title` 之后第一个非空行仍然是 `#` 开头的二级标题(如 `## Usage`),
    // 导致返回 None,详情面板一直显示"暂无描述"。
    //
    // 新实现:跳过所有 `#` / `<!--` 开头行 + 空行,找到第一个真正的
    // 段落正文(到下一个空行或 `#` 行为止)。保留 ≤ 80 字符截断。
    let desc = extract_first_paragraph(&body);
    if desc.is_some() {
        return (desc, None);
    }
    (None, None)
}

/// 从 markdown body 提取第一个非标题段落正文(去首尾空白,截 80 字符)。
///
/// 段落定义:跳过所有 `#` / `<!--` 开头的标题 / 注释行 + 空行,直到
/// 遇到第一个内容行。同一段落内多行用空格拼接(避免显示一堆换行)。
/// 截断在 80 字符边界,避免详情面板被长行撑爆。
fn extract_first_paragraph(body: &str) -> Option<String> {
    let mut started = false;
    let mut buf = String::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // 段落结束:如果已开始收集,直接返回;否则继续找起点。
            if started {
                let trimmed_buf = buf.trim().to_string();
                if !trimmed_buf.is_empty() {
                    return Some(truncate_desc(&trimmed_buf));
                }
                return None;
            }
            continue;
        }
        // 标题 / 注释行:未开始收集时跳过,已开始后视为段落结束。
        if trimmed.starts_with('#') || trimmed.starts_with("<!--") {
            if started {
                let trimmed_buf = buf.trim().to_string();
                if !trimmed_buf.is_empty() {
                    return Some(truncate_desc(&trimmed_buf));
                }
                return None;
            }
            continue;
        }
        // 真正的段落正文行。
        started = true;
        if !buf.is_empty() {
            buf.push(' ');
        }
        buf.push_str(trimmed);
    }
    let trimmed_buf = buf.trim().to_string();
    if trimmed_buf.is_empty() {
        None
    } else {
        Some(truncate_desc(&trimmed_buf))
    }
}

/// 描述文本截断到 80 字符(UTF-8 安全边界用 chars 数)。
fn truncate_desc(s: &str) -> String {
    if s.chars().count() > 80 {
        let truncated: String = s.chars().take(80).collect();
        format!("{truncated}...")
    } else {
        s.to_string()
    }
}

/// LSP:读 .json 文件,description 取 `.description` 或 `.name`。
fn read_json_manifest(path: &Path) -> (Option<String>, Option<Value>) {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    let value = match serde_json::from_str::<Value>(&body) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    let desc = value
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            value
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
    (desc, Some(value))
}

/// MCP:mcp.json 是聚合文件,无法按 server 名隔离。manifest 返回
/// 整个 JSON,description 为 None(前端展示 mcp.json 全文摘要)。
fn read_mcp_manifest(path: &Path) -> (Option<String>, Option<Value>) {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    let value = match serde_json::from_str::<Value>(&body) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    (None, Some(value))
}

// ---------------------------------------------------------------------------
// frontmatter 解析(std only,不引入 serde_yaml)
// ---------------------------------------------------------------------------

/// 解析 markdown frontmatter。返回 `(map, body_after_frontmatter)`。
///
/// frontmatter 格式:
/// ```text
/// ---
/// key: value
/// key2: "quoted value"
/// ---
/// body...
/// ```
///
/// 解析规则:
///   - 首行必须是 `---`(trim 后)
///   - 找到下一个 `---` 行作为结束
///   - 每行 `key: value`,value 去引号
///   - 无冒号的行跳过(不报错)
///   - 值支持简单数组(后续逗号分隔,转 JSON array)
///
/// 不支持嵌套对象 / 多行字符串(YAML 复杂语法)。F22 只需要 description
/// 这种标量,够用。
fn parse_frontmatter(body: &str) -> Option<(Map<String, Value>, &str)> {
    let mut lines = body.lines();
    let first = lines.next()?.trim();
    if first != "---" {
        return None;
    }
    let mut map = Map::new();
    let mut rest_start = 0;
    let mut found_close = false;
    let mut current_key: Option<String> = None;
    let mut current_items: Vec<Value> = Vec::new();

    // 手动遍历以便记录 body 偏移。
    let bytes = body.as_bytes();
    // 跳过首行 + 换行。
    let mut pos = first.len();
    if bytes.get(pos) == Some(&b'\r') {
        pos += 1;
    }
    if bytes.get(pos) == Some(&b'\n') {
        pos += 1;
    }

    for line in body[pos..].lines() {
        pos += line.len();
        // 消耗换行符。
        if bytes.get(pos) == Some(&b'\r') {
            pos += 1;
        }
        if bytes.get(pos) == Some(&b'\n') {
            pos += 1;
        }
        let trimmed = line.trim();
        if trimmed == "---" {
            // 收尾:把未提交的数组 flush。
            if let Some(key) = current_key.take() {
                if !current_items.is_empty() {
                    map.insert(key, Value::Array(std::mem::take(&mut current_items)));
                }
            }
            found_close = true;
            rest_start = pos;
            break;
        }
        // 数组项:`- value`。
        if let Some(item) = trimmed.strip_prefix("- ") {
            if current_key.is_some() {
                current_items.push(Value::String(item.trim_matches('"').to_string()));
            }
            continue;
        }
        // 新 key:value 对。先把上一个 key 的数组 flush。
        if let Some(key) = current_key.take() {
            if !current_items.is_empty() {
                map.insert(key, Value::Array(std::mem::take(&mut current_items)));
            }
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_string();
            if key.is_empty() {
                continue;
            }
            let raw_val = v.trim();
            if raw_val.is_empty() {
                // 可能是多行数组的开始(`key:` 后跟 `- item`)。
                current_key = Some(key);
                current_items.clear();
            } else {
                let cleaned = raw_val.trim_matches('"').to_string();
                map.insert(key, Value::String(cleaned));
            }
        }
        // 无冒号的行忽略(注释 / 空行)。
    }

    if found_close {
        Some((map, &body[rest_start..]))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ----- 文件列表 -----

    #[test]
    fn list_files_returns_relative_paths_sorted() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("b.txt"), b"").unwrap();
        fs::write(tmp.path().join("a.txt"), b"").unwrap();
        fs::create_dir(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub").join("c.txt"), b"").unwrap();

        let files = list_files(tmp.path());
        assert!(files.contains(&"a.txt".to_string()));
        assert!(files.contains(&"b.txt".to_string()));
        assert!(files.contains(&"sub/c.txt".to_string()));
        // 排序:a.txt < b.txt < sub/c.txt
        assert_eq!(files[0], "a.txt");
    }

    #[test]
    fn list_files_skips_dotfiles_and_noise_dirs() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".hidden"), b"").unwrap();
        fs::create_dir(tmp.path().join("node_modules")).unwrap();
        fs::write(tmp.path().join("node_modules").join("x.js"), b"").unwrap();
        fs::write(tmp.path().join("visible.txt"), b"").unwrap();

        let files = list_files(tmp.path());
        assert!(files.contains(&"visible.txt".to_string()));
        assert!(!files.iter().any(|f| f.starts_with('.')));
        assert!(!files.iter().any(|f| f.contains("node_modules")));
    }

    #[test]
    fn list_files_respects_depth_limit() {
        let tmp = TempDir::new().unwrap();
        // root/l1/l2/l3/deep.txt
        fs::create_dir_all(tmp.path().join("l1").join("l2").join("l3")).unwrap();
        fs::write(
            tmp.path().join("l1").join("l2").join("l3").join("deep.txt"),
            b"",
        )
        .unwrap();
        let files = list_files(tmp.path());
        // MAX_DEPTH=2 → root(depth 0) 列 l1, l1(depth 1) 列 l2,
        // l2(depth 2) 不再递归 → deep.txt 不应出现。
        assert!(files.iter().any(|f| f == "l1"));
        assert!(files.iter().any(|f| f == "l1/l2"));
        assert!(!files.iter().any(|f| f.contains("deep.txt")));
    }

    // ----- plugin manifest -----

    #[test]
    fn plugin_dir_with_plugin_json_returns_description_and_manifest() {
        let tmp = TempDir::new().unwrap();
        let body = r#"{"name":"code-review","description":"代码审查插件"}"#;
        fs::write(tmp.path().join("plugin.json"), body).unwrap();

        let (desc, manifest) = read_plugin_manifest(tmp.path());
        assert_eq!(desc.as_deref(), Some("代码审查插件"));
        assert!(manifest.is_some());
        assert_eq!(manifest.unwrap()["name"], "code-review");
    }

    #[test]
    fn plugin_dir_falls_back_to_package_json() {
        let tmp = TempDir::new().unwrap();
        let body = r#"{"name":"my-pkg","description":"npm pkg"}"#;
        fs::write(tmp.path().join("package.json"), body).unwrap();

        let (desc, _manifest) = read_plugin_manifest(tmp.path());
        assert_eq!(desc.as_deref(), Some("npm pkg"));
    }

    #[test]
    fn plugin_dir_no_manifest_returns_none() {
        let tmp = TempDir::new().unwrap();
        let (desc, manifest) = read_plugin_manifest(tmp.path());
        assert!(desc.is_none());
        assert!(manifest.is_none());
    }

    // ----- skill / command (markdown frontmatter) -----

    #[test]
    fn skill_dir_reads_skill_md_frontmatter() {
        let tmp = TempDir::new().unwrap();
        let body = "---\nname: my-skill\ndescription: 我的技能\n---\n# My Skill\nbody";
        fs::write(tmp.path().join("SKILL.md"), body).unwrap();

        let (desc, manifest) = read_skill_manifest(tmp.path(), true);
        assert_eq!(desc.as_deref(), Some("我的技能"));
        assert!(manifest.is_some());
        assert_eq!(manifest.unwrap()["name"], "my-skill");
    }

    #[test]
    fn command_md_with_frontmatter_returns_description() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("deploy.md");
        let body = "---\ndescription: 部署命令\n---\n# Deploy";
        fs::write(&path, body).unwrap();

        let (desc, manifest) = read_markdown_manifest(&path);
        assert_eq!(desc.as_deref(), Some("部署命令"));
        assert!(manifest.is_some());
    }

    #[test]
    fn command_md_without_frontmatter_uses_first_paragraph() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        fs::write(&path, "# Title\nThis is the first body line.").unwrap();

        let (desc, manifest) = read_markdown_manifest(&path);
        assert_eq!(desc.as_deref(), Some("This is the first body line."));
        assert!(manifest.is_none());
    }

    /// M2.16 — C2 修复:无 frontmatter 时,标题(#) 后多段正文应取首段
    /// 非标题内容,而不是简单地跳过所有 `#` 行(老逻辑遇到 `## Usage`
    /// 这种二级标题会返回 None)。
    #[test]
    fn command_md_without_frontmatter_skips_subsequent_headings() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        let body = "# My Note\n\nThis is the actual description.\n\n## Usage\n\nSome usage text.";
        fs::write(&path, body).unwrap();

        let (desc, _manifest) = read_markdown_manifest(&path);
        assert_eq!(
            desc.as_deref(),
            Some("This is the actual description."),
            "应取首个非标题段落,不是 '## Usage'"
        );
    }

    /// M2.16 — C2 修复:纯多行段落应拼接为单行描述(空格分隔)。
    #[test]
    fn command_md_multiline_paragraph_joins_with_spaces() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        let body = "# Title\n\nLine one of the description.\nLine two continues.\nLine three.";
        fs::write(&path, body).unwrap();

        let (desc, _manifest) = read_markdown_manifest(&path);
        assert_eq!(
            desc.as_deref(),
            Some("Line one of the description. Line two continues. Line three.")
        );
    }

    /// M2.16 — C2 修复:超长描述截断到 80 字符 + "..."。
    #[test]
    fn command_md_long_description_truncates_at_80_chars() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        let long = "a".repeat(200);
        fs::write(&path, format!("# Title\n\n{long}")).unwrap();

        let (desc, _manifest) = read_markdown_manifest(&path);
        let d = desc.expect("description present");
        // chars 数 = 83 = 80 chars + "..."(3 个点)。
        assert!(d.ends_with("..."));
        assert_eq!(d.chars().count(), 83);
    }

    /// M2.16 — C2 修复:空文件 / 只有标题 → 返回 None。
    #[test]
    fn command_md_only_headings_returns_none() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        fs::write(&path, "# Title\n\n## Subtitle\n\n### Subsub").unwrap();

        let (desc, _manifest) = read_markdown_manifest(&path);
        assert!(desc.is_none(), "只有标题应返回 None");
    }

    // ----- lsp (json) -----

    #[test]
    fn lsp_json_returns_description() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("rust.json");
        fs::write(&path, r#"{"name":"rust-analyzer","description":"Rust LSP"}"#).unwrap();

        let (desc, manifest) = read_json_manifest(&path);
        assert_eq!(desc.as_deref(), Some("Rust LSP"));
        assert!(manifest.is_some());
    }

    #[test]
    fn lsp_json_malformed_returns_none() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bad.json");
        fs::write(&path, b"not json").unwrap();

        let (desc, manifest) = read_json_manifest(&path);
        assert!(desc.is_none());
        assert!(manifest.is_none());
    }

    // ----- mcp -----

    #[test]
    fn mcp_json_returns_manifest_no_description() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("mcp.json");
        fs::write(
            &path,
            r#"{"mcpServers":{"fs":{"command":"npx"}}}"#,
        )
        .unwrap();

        let (desc, manifest) = read_mcp_manifest(&path);
        assert!(desc.is_none());
        assert!(manifest.is_some());
        assert_eq!(manifest.unwrap()["mcpServers"]["fs"]["command"], "npx");
    }

    // ----- read_resource_detail 端到端 -----

    #[test]
    fn read_detail_plugin_dir_combines_files_and_manifest() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("plugin.json"),
            r#"{"name":"x","description":"desc"}"#,
        )
        .unwrap();
        fs::write(tmp.path().join("index.js"), b"").unwrap();

        let detail = read_resource_detail(tmp.path(), ResourceKind::Plugin);
        assert_eq!(detail.description.as_deref(), Some("desc"));
        assert!(detail.manifest.is_some());
        assert!(detail.files.contains(&"index.js".to_string()));
        assert!(detail.files.contains(&"plugin.json".to_string()));
    }

    #[test]
    fn read_detail_single_file_has_empty_file_list() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("cmd.md");
        fs::write(&path, "---\ndescription: d\n---\nbody").unwrap();

        let detail = read_resource_detail(&path, ResourceKind::Command);
        assert!(detail.files.is_empty());
        assert_eq!(detail.description.as_deref(), Some("d"));
    }

    #[test]
    fn read_detail_nonexistent_path_returns_empty() {
        let path = Path::new("/nonexistent/path/to/resource");
        let detail = read_resource_detail(path, ResourceKind::Plugin);
        assert!(detail.files.is_empty());
        assert!(detail.description.is_none());
        assert!(detail.manifest.is_none());
    }

    // ----- frontmatter 解析纯函数 -----

    #[test]
    fn parse_frontmatter_extracts_scalar_fields() {
        let body = "---\nname: foo\ndescription: bar baz\n---\n# body";
        let (map, rest) = parse_frontmatter(body).unwrap();
        assert_eq!(map["name"], "foo");
        assert_eq!(map["description"], "bar baz");
        assert!(rest.starts_with("# body"));
    }

    #[test]
    fn parse_frontmatter_handles_quoted_values() {
        let body = "---\ndescription: \"quoted value\"\n---\nbody";
        let (map, _rest) = parse_frontmatter(body).unwrap();
        assert_eq!(map["description"], "quoted value");
    }

    #[test]
    fn parse_frontmatter_returns_none_without_marker() {
        let body = "# just markdown\nno frontmatter";
        assert!(parse_frontmatter(body).is_none());
    }
}
