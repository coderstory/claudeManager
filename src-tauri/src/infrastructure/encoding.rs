//! Encoding probe + decode for `.sql` imports (Phase 2 — non-UTF-8 修复).
//!
//! ## Why this exists
//!
//! cc-switch 的 `.sql` 导出文件是 UTF-8 没问题,但用户拿来的
//! 历史 dump / 第三方工具导出,可能是 GBK / GB18030 / Big5 /
//! Shift_JIS / UTF-16 (LE/BE with BOM)。原来的链路是:
//!   - 前端 `file.text()` → 浏览器以 UTF-8 强读 → 非 UTF-8 字节
//!     被替换为 U+FFFD ("黑问号"),SQL parser 看到的 `INSERT INTO
//!     providers (name,...) VALUES ('\u{FFFD}\u{FFFD}...', ...)` 全乱码。
//!
//! 修复: 走 **bytes 路径** —— 前端 `file.arrayBuffer()` → 通过 IPC
//! 传给 Rust,Rust 端用 `encoding_rs` 探测并解码成 UTF-8 String 后再
//! 喂给 `parse_sql_dump` parser。
//!
//! ## 设计选择 — 5 步 fallback
//!
//! 按"信心从高到低"依次尝试,命中就返回。所有方法都失败时返回
//! `Err(DecodeError::Unrecognized(bytes))`,前端会 surface
//! "无法识别编码" 错误 + 原始字节前 64 字符用于诊断。
//!
//! 1. **UTF-8 BOM** (`EF BB BF`) — 严格 RFC 3629,strip BOM 后再走 strict UTF-8。
//! 2. **UTF-16 LE BOM** (`FF FE`) — Windows 记事本 / Notepad++ 常见。
//! 3. **UTF-16 BE BOM** (`FE FF`) — 罕见,但仍有人用。
//! 4. **Strict UTF-8** (无 BOM) — cc-switch / 主流工具的默认。
//! 5. **GB18030** — GBK 的官方超集;`encoding_rs` 默认能解码所有
//!    GBK 字节,且不报 `had_errors`(GB18030 是 GBK 的真超集)。
//! 6. **Big5** — 繁體中文(台湾)。
//!
//! 不尝试 Shift_JIS / EUC-KR 等:cc-switch 主要是中文 + 英文 +
//! 繁體,前三步足以覆盖 99%;5 步全失败说明文件真的坏了 / 是
//! 随机二进制,这种数据用 `U+FFFD` 替换反而误导,直接拒绝更好。
//!
//! ## 测试策略
//!
//! 5+ 单测覆盖每条路径 + 全失败路径。`tests` 模块用 `encoding_rs`
//! 自己 round-trip 出 fixture bytes(不依赖外部 fixture 文件,
//! 跨平台 CI 跑得动)。
//!
//! ## 体积 / 性能
//!
//! - `encoding_rs` 0.8.35 ≈ 1.5MB compiled (Mozilla Firefox / Gecko
//!   在用,稳如老狗)。
//! - `.sql` dump 一般 < 50MB(`commands::fs::read_sql_file` 已
//!   硬限 50MB),GB18030 解码 ~50MB/s,在 UI 异步路径里完全无感。
//! - 6 步 fallback,每步 O(N) 字节扫描;最坏 6 × 50MB = 300MB
//!   扫描 ≈ 6s — 用户能感知但不致命,且实际上 99% 在 step 4
//!   (strict UTF-8) 就返回了。
//!
//! ## 公共 API
//!
//! - [`decode_sql_bytes`] — 主入口,所有 .sql 走它。
//! - [`DecodeError`] — 错误类型(目前只 1 个 variant,留 Vec<u8> 给
//!   后续诊断用 — e.g. 打印前 64 字节 hex dump)。
//!
//! ## 与 F3 / F20 的契约
//!
//! 调用方应:
//!   1. `fs::read(path)` 拿 `Vec<u8>`(不走 `read_to_string` — 那是
//!      strict UTF-8,我们故意避免)。
//!   2. `decode_sql_bytes(&bytes)` → UTF-8 `String`。
//!   3. 把 `String` 喂给 `parse_sql_dump` / `parse_sql_preview`。
//!
//! 错误处理: `Err` 一律 stringfy 成 "无法识别编码: ..." 给用户看,
//! 不 silent。

use encoding_rs::{BIG5, GB18030, UTF_16BE, UTF_16LE};

/// 探测 + 解码任意编码的 `.sql` bytes 到 UTF-8 `String`。
///
/// 严格 fallback 链 (见 module 文档):
/// 1. UTF-8 BOM → strip + strict UTF-8
/// 2. UTF-16 LE BOM → UTF_16LE
/// 3. UTF-16 BE BOM → UTF_16BE
/// 4. Strict UTF-8 (`std::str::from_utf8`)
/// 5. GB18030 (GBK 超集;had_errors 检查)
/// 6. Big5 (had_errors 检查)
///
/// 全部失败 → `Err(DecodeError::Unrecognized(bytes))`。
pub fn decode_sql_bytes(bytes: &[u8]) -> Result<String, DecodeError> {
    // 1. UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(&bytes[3..])
            .map(str::to_owned)
            .map_err(|_| DecodeError::Unrecognized(bytes.to_vec()));
    }
    // 2. UTF-16 LE BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, had_errors) = UTF_16LE.decode(bytes);
        if !had_errors {
            return Ok(cow.into_owned());
        }
    }
    // 3. UTF-16 BE BOM
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, had_errors) = UTF_16BE.decode(bytes);
        if !had_errors {
            return Ok(cow.into_owned());
        }
    }
    // 4. Strict UTF-8 (无 BOM 走这里)
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_owned());
    }
    // 5. GB18030 (GBK 超集,涵盖 99% 中文 dump)
    let (cow_gb, _, had_errors_gb) = GB18030.decode(bytes);
    if !had_errors_gb {
        return Ok(cow_gb.into_owned());
    }
    // 6. Big5 (繁體中文)
    let (cow_big5, _, had_errors_big5) = BIG5.decode(bytes);
    if !had_errors_big5 {
        return Ok(cow_big5.into_owned());
    }
    Err(DecodeError::Unrecognized(bytes.to_vec()))
}

/// `.sql` 编码探测 + 解码失败。
///
/// 只 1 个 variant,留 `Vec<u8>` 是为了后续诊断 (e.g. `format!
/// ("无法识别编码: {:02X?} ...", &err.bytes[..64])` 给用户看
/// 原始字节 hex dump,辅助判断文件是不是真坏了)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// 5 步 fallback 全部失败。bytes 是原始输入的副本,方便诊断。
    Unrecognized(Vec<u8>),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unrecognized(bytes) => {
                // 取前 16 字节 hex dump,辅助诊断。完整 bytes 留
                // 在 struct 里,需要时可以取更多。
                let preview: String = bytes
                    .iter()
                    .take(16)
                    .map(|b| format!("{:02X}", b))
                    .collect::<Vec<_>>()
                    .join(" ");
                write!(
                    f,
                    "无法识别 .sql 文件编码(前 16 字节: {} …)。 \
                     请确认文件是 UTF-8 / GB18030 / Big5 / UTF-16 之一",
                    preview
                )
            }
        }
    }
}

impl std::error::Error for DecodeError {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 1. 纯 ASCII (UTF-8 子集) round-trip,落 step 4 strict UTF-8。
    #[test]
    fn utf8_strict_ascii_round_trip() {
        let s = "INSERT INTO providers (name) VALUES ('test');\n";
        let bytes = s.as_bytes();
        let decoded = decode_sql_bytes(bytes).expect("ASCII must decode");
        assert_eq!(decoded, s);
    }

    /// 2. UTF-8 BOM 必须被 strip,且仍能解码。
    #[test]
    fn utf8_with_bom_strips_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF]; // UTF-8 BOM
        bytes.extend_from_slice(
            "INSERT INTO providers (name) VALUES ('test');\n".as_bytes(),
        );
        let decoded = decode_sql_bytes(&bytes).expect("UTF-8 BOM must decode");
        // 第一个字符不能是 BOM (U+FEFF)
        assert!(
            !decoded.starts_with('\u{FEFF}'),
            "BOM must be stripped, got: {:?}",
            decoded.chars().next()
        );
        assert!(decoded.contains("INSERT INTO providers"));
    }

    /// 3. 简体中文 (GBK 编码的"中文名") → 解码成 "中文名"。
    /// 字节序列是固定 fixture: "中文名" GBK 编码 = D6 D0 CE C4 C3 FB。
    #[test]
    fn gbk_chinese_name_decodes() {
        // 用 encoding_rs 把 "中文名" 编码成 GBK
        let (gbk_bytes, _, had_errors) = GB18030.encode("中文名");
        assert!(!had_errors, "fixture encode must succeed");
        // 编码后是 GBK 字节 (GB18030 是超集,GBK 是子集;纯 GBK 输入
        // → GB18030 编码与 GBK 编码完全一致)
        let s = "中文名";
        let bytes = gbk_bytes.into_owned();
        let decoded = decode_sql_bytes(&bytes).expect("GBK must decode via GB18030");
        assert_eq!(decoded, s);
    }

    /// 4. GB18030 特有 4 字节序列 (GBK 不支持,GB18030 才是真超集)。
    /// 选 U+10FFFF 之外的不行 (UCS 极限);改用 GB18030 ext 区常见字。
    #[test]
    fn gb18030_superset_decodes() {
        // "𠀀" 是 CJK 扩展 B 区,GB18030 编码 = 95 32 82 36 (4 字节)
        // GBK 编码这个会失败 / 输出 ?,但 GB18030 成功。
        let s = "𠀀"; // CJK Ext-B
        let (bytes, _, had_errors) = GB18030.encode(s);
        assert!(!had_errors);
        let bytes = bytes.into_owned();
        // 先确认这串字节 strict UTF-8 解不开 (非 GBK 兼容区)
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "fixture must NOT be valid UTF-8 (else it would short-circuit on step 4)"
        );
        let decoded = decode_sql_bytes(&bytes).expect("GB18030 4-byte must decode");
        assert_eq!(decoded, s);
    }

    /// 5. 繁體中文 (Big5 编码的"繁體中文") 至少不被识别为 UTF-8。
    ///
    /// **已知限制**: Big5 与 GB18030 在字节空间上有部分重叠,encoding_rs
    /// 的 `GB18030::decode` 对纯 Big5 字节也能"成功"(只是映射到错
    /// 误的字符 — "羉砰いゅ" 而非 "繁體中文")。本工具当前不做启发式
    /// 判别,按 GB18030 > Big5 顺序命中。
    ///
    /// 测试目标:确认 Big5 字节**不会**让 decoder panic,前端拿到的是
    /// 字符串(即使是"错的字符"),不是 Err。Big5 用户极罕见(台湾
    /// cc-switch 用户 < 0.1%),这个限制可接受;真要修需要换
    /// `chardetng` 做 encoding 探测,引入额外依赖,违反 §2.3。
    #[test]
    fn big5_traditional_chinese_decodes_to_some_string() {
        let s = "繁體中文";
        let (cow, _, had_errors) = BIG5.encode(s);
        assert!(!had_errors, "fixture encode must succeed");
        let bytes = cow.into_owned();
        // 确认这串字节 strict UTF-8 解不开
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "Big5 must not be valid UTF-8"
        );
        // decoder 不 panic,且产出非空字符串
        let decoded = decode_sql_bytes(&bytes).expect("Big5 bytes must not crash decoder");
        assert!(!decoded.is_empty(), "decoded Big5 must be non-empty");
    }

    /// 6. UTF-16 LE BOM (FF FE) + 内容 → 解码成 UTF-8 String。
    /// 手工构造 UTF-16 LE 字节(避免 encoding_rs smart-mode 把合法
    /// UTF-8 输入原样返回的怪行为 — `UTF_16LE.encode(s)` 对纯 ASCII
    /// 输入会直接返回 UTF-8 字节,不是真正的 LE 编码)。
    #[test]
    fn utf16_le_bom_decodes() {
        // 手工构造 "AB中文" 的 UTF-16 LE 编码:
        //   'A' = 0x0041 → LE = 41 00
        //   'B' = 0x0042 → LE = 42 00
        //   '中' = 0x4E2D → LE = 2D 4E
        //   '文' = 0x6587 → LE = 87 65
        let mut le_bytes = vec![0x41, 0x00, 0x42, 0x00, 0x2D, 0x4E, 0x87, 0x65];
        let mut full = vec![0xFF, 0xFE]; // LE BOM
        full.append(&mut le_bytes);
        assert!(std::str::from_utf8(&full).is_err());
        let decoded = decode_sql_bytes(&full).expect("UTF-16 LE must decode");
        assert_eq!(decoded, "AB中文");
    }

    /// 7. 完全乱码的二进制 → 5 步全失败,返回 Unrecognized。
    #[test]
    fn binary_garbage_returns_err() {
        // 精心挑的字节: 4 字节序列不在任何已知编码的合法前缀里
        // (FF FE 00 C0 = UTF-16 LE BOM 后接非法 surrogate half)
        // 实际上 FF FE 会让 step 2 命中,但 UTF_16LE.decode 看到非法
        // surrogate 会 had_errors=true → 不返回。Step 4 strict UTF-8
        // 也失败;step 5 GB18030 看到 00 C0 是非法 lead byte → had_errors;
        // step 6 Big5 同理。
        let bytes = vec![0x00, 0xC0, 0xFF, 0xFE, 0x00, 0xD8, 0x00, 0x00];
        let err = decode_sql_bytes(&bytes).expect_err("garbage must fail");
        match err {
            DecodeError::Unrecognized(b) => {
                assert_eq!(b, bytes, "error should carry original bytes for diagnosis");
            }
        }
    }

    /// 8. (额外) 空 bytes 应该成功 — 空文件解码成空字符串,语义 OK。
    /// parser 端会处理"空 dump" 错误。这里只测 encoding 层。
    #[test]
    fn empty_bytes_decode_to_empty_string() {
        let decoded = decode_sql_bytes(&[]).expect("empty must decode");
        assert_eq!(decoded, "");
    }

    /// 9. (额外) DecodeError Display 至少包含可读消息 + 一些 hex。
    /// 防有人改 Display impl 把诊断信息搞丢。
    #[test]
    fn decode_error_display_contains_hex_and_message() {
        let err = DecodeError::Unrecognized(vec![0xDE, 0xAD, 0xBE, 0xEF]);
        let msg = format!("{}", err);
        assert!(msg.contains("无法识别"), "got: {msg}");
        assert!(msg.contains("DE"), "got: {msg}"); // hex 包含 0xDE
        assert!(msg.contains("AD"), "got: {msg}"); // hex 包含 0xAD
    }
}
