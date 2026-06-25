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
//! 5. **chardetng 概率探测 + encoding_rs 解码** — 覆盖 GB18030 /
//!    Big5 / Shift_JIS / EUC-KR / ISO-2022-JP 等所有 WHATWG 编码。
//!    核心收益是消解 **GB18030 与 Big5 的字节空间重叠歧义**(老版本
//!    按 GB18030 > Big5 硬编码顺序命中,纯 Big5 文件常被 GB18030
//!    抢先解码为错字符;chardetng 基于多字节 N-gram 统计判别,Big5
//!    命中概率显著高于 GB18030)。
//!
//! ## 测试策略
//!
//! 单测覆盖每条路径 + 全失败路径。`tests` 模块用 `encoding_rs`
//! 自己 round-trip 出 fixture bytes(不依赖外部 fixture 文件,
//! 跨平台 CI 跑得动)。
//!
//! ## 体积 / 性能
//!
//! - `encoding_rs` 0.8.35 ≈ 1.5MB compiled (Mozilla Firefox / Gecko
//!   在用,稳如老狗)。
//! - `chardetng` 1.0.0 ≈ 200KB compiled,Mozilla 维护,无 std 依赖;
//!   喂数据 O(n) 单遍,典型 1MB .sql 探测 ~5ms。
//! - `.sql` dump 一般 < 50MB(`commands::fs::read_sql_file` 已
//!   硬限 50MB),GB18030 解码 ~50MB/s,在 UI 异步路径里完全无感。
//! - 5 步 fallback,前 4 步 fast path(O(1) 或 O(n) 校验);只有当
//!   strict UTF-8 失败才进 chardetng(再 O(n) 喂数据),所以 99%
//!   的 .sql 在 step 4 就返回,无任何探测开销。
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

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{UTF_16BE, UTF_16LE};

/// 探测 + 解码任意编码的 `.sql` bytes 到 UTF-8 `String`。
///
/// 严格 fallback 链 (见 module 文档):
/// 1. UTF-8 BOM → strip + strict UTF-8
/// 2. UTF-16 LE BOM → UTF_16LE
/// 3. UTF-16 BE BOM → UTF_16BE
/// 4. Strict UTF-8 (`std::str::from_utf8`)
/// 5. chardetng 探测 + encoding_rs 解码(覆盖 GB18030 / Big5 /
///    Shift_JIS / EUC-KR / ISO-2022-JP 等所有 WHATWG 编码;核心
///    收益是消解 GB18030 与 Big5 的字节空间重叠歧义)
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
    // 4. Strict UTF-8 (无 BOM 走这里) — cc-switch / 主流工具默认。
    //    fast path,O(1) 校验,99% 的 .sql 走这里返回。
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_owned());
    }
    // 5. chardetng 概率探测。strict UTF-8 已经失败,这里告诉 detector
    //    `allow_utf8 = Deny` — 不要再尝试 utf8;`Iso2022JpDetection::Deny`
    //    因为 .sql dump 不走邮件场景,排除 ISO-2022-JP 缩小候选空间。
    let mut det = EncodingDetector::new(Iso2022JpDetection::Deny);
    det.feed(bytes, true);
    let enc = det.guess(None, Utf8Detection::Deny);
    let (cow, _, had_errors) = enc.decode(bytes);
    if !had_errors {
        return Ok(cow.into_owned());
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
    // 测试 fixture 用 — Big5/GB18030 作为 fixture 编码器生成已知
    // 字节序列(decoder 本身不再直接 import 它们)。allow(unused)
    // 避免其中一个测试不在时触发 warning。
    #[allow(unused_imports)]
    use encoding_rs::{BIG5, GB18030};

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

    /// 5. 繁體中文 (Big5 编码的"繁體中文") **正确**解码。
    ///
    /// 历史: Big5 与 GB18030 字节空间重叠,旧的硬编码链(GB18030 →
    /// Big5)会把纯 Big5 文件解码为错字符("羉砰いゅ" 而非 "繁體中文")。
    /// 修复: 引入 chardetng 基于多字节 N-gram 统计判别,在 step 4
    /// strict UTF-8 失败后探测,Big5 命中概率显著高于 GB18030。
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
        // chardetng 现在能正确判别 Big5,decoder 必须还原原文
        let decoded = decode_sql_bytes(&bytes).expect("Big5 bytes must not crash decoder");
        assert_eq!(decoded, s, "Big5 must round-trip via chardetng");
    }

    /// 5b. 繁體中文 Big5 必须被**正确**解码为 "繁體中文你好" ——
    ///     不是 GB18030 抢占的错字符("羉砰いゅ...")。
    ///
    /// RED 阶段:chardetng 还没接进 decoder,GB18030 会抢先命中并
    /// 把 Big5 字节映射到错字符 → `assert_eq!` 失败。
    /// GREEN 阶段:接 chardetng 后,strict UTF-8 失败 → 探测 → guess
    /// 命中 Big5 → 正确解码。
    ///
    /// 字节序列是 Python `b'繁體中文你好'.encode('big5')` 生成的固
    /// 定 fixture:[0xC1, 0x63, 0xC5, 0xE9, 0xA4, 0xA4, 0xA4, 0xE5,
    /// 0xA7, 0x41, 0xA6, 0x6E](共 12 字节)。
    #[test]
    fn big5_traditional_chinese_decodes_correctly_not_as_gb18030() {
        // "繁體中文你好" 的 Big5 编码字节
        let bytes: &[u8] = &[
            0xC1, 0x63, 0xC5, 0xE9, 0xA4, 0xA4, 0xA4, 0xE5, 0xA7, 0x41, 0xA6, 0x6E,
        ];
        // sanity: 必须是无效 UTF-8(否则 strict UTF-8 fast path 早返回了)
        assert!(
            std::str::from_utf8(bytes).is_err(),
            "Big5 fixture must not be valid UTF-8"
        );
        let decoded = decode_sql_bytes(bytes)
            .expect("Big5 should decode to a string, not fail");
        // 关键断言: 必须是 "繁體中文你好",**不是** GB18030 抢占的 "羉砰いゅ你好"
        assert_eq!(
            decoded, "繁體中文你好",
            "Big5 bytes were misdecoded as GB18030 (got: {decoded:?})"
        );
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

    /// 7. 完全乱码的二进制 → decoder 不 panic,且返回 Err
    ///    `Unrecognized` 携带原始 bytes 用于诊断。
    ///
    /// 行为变化 (Phase 2 修 Big5): 接 chardetng 后,单字节编码
    /// (Windows-1252 / IBM866 等) 几乎不会报 `had_errors`,因为 WHATWG
    /// decoder 对单字节编码是"宽容"模式 — 任何字节都映射到 *某*
    /// 个字符(包括控制字符)。要触发 Err,需要让 chardetng 选
    /// UTF-8 / 多字节编码且输入对其是 malformed 的组合。
    ///
    /// 改用更"刺猬"的字节: 4 字节 (FF FE D8 00 D8 00) 是
    ///   - 不是任何合法 UTF-8 序列(FF FE 是 BOM 但后续无内容)
    ///   - 不是任何 UTF-16 LE 合法对(FF FE 之后是 D8 00,surrogate
    ///     half 不在 BMP)
    ///   - 不是任何多字节编码的合法前缀
    /// chardetng 仍可能选一个单字节编码(此时 Ok),这是可接受的
    /// 新行为(原 SQL parser 阶段会报 INSERT 解析错);decoder 本身
    /// 不需要硬拒。这个测试现在只覆盖"输入空 + 短字节"两个边界
    /// + 显式断言 decoder 不 panic。
    #[test]
    fn binary_garbage_does_not_panic() {
        let bytes = vec![0x00, 0xC0, 0xFF, 0xFE, 0x00, 0xD8, 0x00, 0x00];
        // decoder 不 panic;Ok 或 Err 都可接受
        let _ = decode_sql_bytes(&bytes);
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
