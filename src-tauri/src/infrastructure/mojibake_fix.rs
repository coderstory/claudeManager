//! Mojibake reversal for provider JSON string fields (M3.13.7).
//!
//! ## What this is
//!
//! Pre-M3.13 `sql_parser.rs` had a bug in its `parse_value_list` byte
//! loop: non-ASCII bytes (0x80..0xFF) inside SQL string literals were
//! appended one-by-one via `buf.push(b as char)` instead of being
//! reassembled as UTF-8. Result: each UTF-8 byte of an East Asian
//! character became its own U+00XX Latin-1 code point. After
//! `serde_json::to_string_pretty` re-encoded the Rust `String`, each
//! codepoint was serialized back to **2 UTF-8 bytes** (because the
//! codepoint value is in U+0080..U+00FF, the 2-byte UTF-8 range). This
//! is the classic "double-encoded UTF-8" mojibake pattern:
//!
//! ```text
//!   original UTF-8:      e7 81 ab       e5 b1 b1      (火山)
//!   byte-push as Latin-1: U+00E7 U+0081 U+00AB U+00E5 U+00B1 U+00B1
//!   re-encode UTF-8:      c3 a7 c2 81 c2 ab   c3 a5 c2 b1 c2 b1
//!   on-disk:                              "ç«å±±"
//! ```
//!
//! ## What this fixes
//!
//! We reverse the transformation at JSON read time:
//!
//! 1. Each codepoint in the on-disk string maps back to its raw byte
//!    (Latin-1 decoding).
//! 2. The resulting `Vec<u8>` is re-decoded as UTF-8.
//! 3. If the original string contained no Latin-1-high characters,
//!    nothing changes.
//!
//! We do NOT mutate the bytes on disk; we only repair the in-memory
//! representation returned to the UI. New writes (via `to_json_file`)
//! already produce clean UTF-8 because the bug is in the SQL parser,
//! not in the JSON serializer.
//!
//! ## Conservative heuristic
//!
//! We only reverse when **at least one of these conditions holds**:
//!
//! - The on-disk string contains a run of **3 or more consecutive**
//!   Latin-1-high code points (`U+0080..U+00FF`). This is the signature
//!   of an originally 3-byte UTF-8 East Asian character. A *single*
//!   Latin-1-high code point (e.g. `é` = U+00E9, `ñ` = U+00F1) is
//!   almost always a genuine Western European character — we leave it
//!   alone so we don't corrupt user-typed French/Spanish/German names.
//!
//! OR
//!
//! - The Latin-1-decode-then-UTF-8-decode round-trip produces a string
//!   that contains at least one non-ASCII codepoint **and** the
//!   round-trip string is different from the input. This catches the
//!   edge case where a single 3-byte UTF-8 sequence happens to fall
//!   across two runs (rare but possible).
//!
//! ## Why not just rewrite the file?
//!
//! - The user has F13 backups; touching disk adds risk for a cosmetic
//!   issue.
//! - Re-decoding on read is idempotent and self-healing: as soon as
//!   the user edits + saves the provider (M3.6 `update_provider`),
//!   `to_json_file` writes clean UTF-8, and the mojibake disappears
//!   from disk without any explicit migration.
//! - We leave the file timestamps alone (CLAUDE.md §7: any disk write
//!   must be backed up; a read-time fix avoids the backup requirement
//!   entirely).
//!
//! ## Test coverage
//!
//! - `double_encoded_chinese_round_trips_to_original`
//! - `genuine_latin1_passes_through_unchanged` (French `é` is safe)
//! - `valid_utf8_passes_through_unchanged` (no false positives)
//! - `empty_string_passes_through_unchanged`
//! - `mixed_mojibake_and_ascii_only_affects_mojibake_runs`
//! - `short_run_below_threshold_is_left_alone` (single Latin-1 char)

/// Repair a single JSON string field that may have been written with
/// pre-M3.13 double-encoded UTF-8. Returns the original string unchanged
/// if it does not match the mojibake signature (see module docs).
///
/// # Examples
///
/// ```
/// use crate::infrastructure::mojibake_fix::repair_mojibake;
/// // Real-world symptom on disk: 6 Latin-1 codepoints U+00E7
/// // U+0081 U+00AB U+00E5 U+00B1 U+00B1 followed by "Agentplan"
/// // (i.e. "火山Agentplan" double-encoded).
/// let bad = "\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}Agentplan";
/// let fixed = repair_mojibake(bad);
/// assert_eq!(fixed, "火山Agentplan");
///
/// // Genuine French/Spanish names are NOT touched.
/// let genuine = "café";
/// assert_eq!(repair_mojibake(genuine), "café");
/// ```
pub fn repair_mojibake(s: &str) -> String {
    if !looks_like_double_encoded(s) {
        return s.to_string();
    }
    // Reverse the transformation: each codepoint → its Latin-1 byte,
    // then re-decode the byte sequence as UTF-8.
    // `s` is a Rust `&str` containing only Latin-1-range codepoints
    // (guaranteed by `looks_like_double_encoded`). Each Latin-1
    // codepoint was originally serialized as its 2-byte UTF-8 sequence
    // (0xC2 0xXX or 0xC3 0xXX). Re-encoding each codepoint back to a
    // single byte (its Latin-1 value) and then decoding as UTF-8
    // recovers the original characters.
    let latin1_bytes: Vec<u8> = s.chars().filter_map(|c| {
        let code = c as u32;
        if code <= 0xFF {
            Some(code as u8)
        } else {
            None
        }
    }).collect();
    match std::str::from_utf8(&latin1_bytes) {
        Ok(repaired) => repaired.to_string(),
        Err(_) => s.to_string(),
    }
}

/// Conservative detector for the pre-M3.13 double-encoding pattern.
///
/// Returns `true` only if the string **strongly** looks like
/// double-encoded UTF-8 — specifically, it contains at least one run
/// of 3+ consecutive Latin-1-high code points AND/OR its Latin-1 +
/// UTF-8 round-trip yields a different, non-ASCII string.
fn looks_like_double_encoded(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    // Reject if the string contains any character outside the
    // Latin-1 range (e.g. real Chinese characters that survived
    // serialization intact, emojis, etc.). Mixed strings are already
    // partially valid UTF-8 — we don't try to surgically repair them.
    if !s.chars().all(|c| (c as u32) <= 0xFF) {
        return false;
    }

    // Signal 1: a run of 3+ consecutive Latin-1-high code points.
    // East Asian UTF-8 characters are 3 bytes; if the SQL parser
    // pushed each byte individually, every CJK char becomes exactly
    // 3 consecutive Latin-1-high codepoints. We require a run of 3
    // to avoid false-positives on single Latin-1 chars (é, ñ, ß, …).
    let mut run = 0usize;
    let mut max_run = 0usize;
    for c in s.chars() {
        let code = c as u32;
        if (0x80..=0xFF).contains(&code) {
            run += 1;
            max_run = max_run.max(run);
        } else {
            run = 0;
        }
    }
    if max_run >= 3 {
        return true;
    }

    // Signal 2: the round-trip produces a different string containing
    // a non-ASCII char. Catches edge cases where CJK bytes are split
    // across runs.
    let bytes: Vec<u8> = s.chars().map(|c| c as u8).collect();
    if let Ok(repaired) = std::str::from_utf8(&bytes) {
        if repaired != s && repaired.chars().any(|c| (c as u32) >= 0x80) {
            return true;
        }
    }

    false
}

/// Detect whether the string is a **contiguous run** of Latin-1-high
/// code points of length ≥ 3 (i.e. a fragment of double-encoded UTF-8).
/// Used by `repair_mojibake_runs` to find each repairable substring
/// inside a string that may contain both mojibake and clean CJK.
fn is_mojibake_run(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.chars().count() >= 3 && s.chars().all(|c| (c as u32) >= 0x80 && (c as u32) <= 0xFF)
}

/// Repair a string that may contain **segments** of double-encoded
/// UTF-8 alongside clean UTF-8 (e.g. real Chinese text after the
/// mojibake region). Each contiguous run of Latin-1-high code
/// points that is at least 3 characters long is reversed; everything
/// else passes through unchanged.
///
/// This is more conservative than `repair_mojibake` and is the
/// function `Provider::from_json_file` actually calls, because
/// real `name` / `notes` strings may legitimately mix user-typed
/// CJK with content imported via the legacy SQL parser.
pub fn repair_mojibake_runs(s: &str) -> String {
    if s.is_empty() {
        return String::new();
    }
    // Fast path: no Latin-1-high chars at all → already clean.
    if !s.chars().any(|c| (c as u32) >= 0x80 && (c as u32) <= 0xFF) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut buf = String::new();
    for c in s.chars() {
        let code = c as u32;
        let is_latin1_high = (0x80..=0xFF).contains(&code);
        if is_latin1_high {
            buf.push(c);
        } else {
            // Flush any pending run.
            if !buf.is_empty() {
                if is_mojibake_run(&buf) {
                    // Reverse: codepoints → Latin-1 bytes → UTF-8 decode.
                    let bytes: Vec<u8> = buf.chars().map(|c| c as u8).collect();
                    match std::str::from_utf8(&bytes) {
                        Ok(repaired) => out.push_str(repaired),
                        Err(_) => out.push_str(&buf), // defensive fallback
                    }
                } else {
                    // Run too short (e.g. single `é`) — genuine Western
                    // European char, pass through.
                    out.push_str(&buf);
                }
                buf.clear();
            }
            out.push(c);
        }
    }
    // Flush trailing run.
    if !buf.is_empty() {
        if is_mojibake_run(&buf) {
            let bytes: Vec<u8> = buf.chars().map(|c| c as u8).collect();
            match std::str::from_utf8(&bytes) {
                Ok(repaired) => out.push_str(repaired),
                Err(_) => out.push_str(&buf),
            }
        } else {
            out.push_str(&buf);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the exact mojibake signature that the on-disk file
    /// `267d0039-…json` shows. The on-disk bytes after `"name": "`
    /// are `c3 a7 c2 81 c2 ab c3 a5 c2 b1 c2 b1` — the 12-byte
    /// UTF-8 sequence for 6 Latin-1 codepoints (U+00E7, U+0081,
    /// U+00AB, U+00E5, U+00B1, U+00B1). We construct the same
    /// `String` via `\u{XXXX}` escapes so the test does not depend
    /// on the host terminal's UTF-8 rendering.
    #[test]
    fn double_encoded_chinese_round_trips_to_original() {
        // 6 Latin-1-high codepoints correspond to the 6 UTF-8 bytes
        // of "火山" pushed individually by the pre-M3.13 SQL parser.
        // When round-tripped via this function, we get back "火山".
        let bad = "\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}Agentplan";
        let fixed = repair_mojibake(bad);
        assert_eq!(fixed, "火山Agentplan", "expected 火山Agentplan, got: {fixed:?}");
    }

    /// Genuine French/Spanish/German text uses U+00E9, U+00F1, U+00DF,
    /// etc. — single Latin-1-high codepoints that are NOT mojibake.
    /// We must not corrupt these.
    #[test]
    fn genuine_latin1_passes_through_unchanged() {
        let inputs = ["café", "niño", "straße", "naïve", "résumé"];
        for s in inputs {
            let out = repair_mojibake(s);
            assert_eq!(out, s, "genuine Latin-1 string got mangled: {s:?} → {out:?}");
        }
    }

    /// A string with only ASCII (or pre-existing valid UTF-8) must
    /// pass through with no allocation churn we care about.
    #[test]
    fn valid_utf8_passes_through_unchanged() {
        assert_eq!(repair_mojibake(""), "");
        assert_eq!(repair_mojibake("plain ascii"), "plain ascii");
        assert_eq!(repair_mojibake("GLM-4.6 官方"), "GLM-4.6 官方");
        assert_eq!(repair_mojibake("日本語"), "日本語");
    }

    /// The on-disk signature from the user's report: a mix of
    /// mojibake + ASCII suffix.
    #[test]
    fn user_reported_case_huoshan_agentplan() {
        // Same codepoint sequence as the actual file content:
        // U+00E7 U+0081 U+00AB U+00E5 U+00B1 U+00B1 + "Agentplan".
        let bad = "\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}Agentplan";
        let fixed = repair_mojibake(bad);
        assert_eq!(fixed, "火山Agentplan");
    }

    /// Mixed content: ASCII prefix + mojibake CJK + ASCII suffix.
    /// The CJK should repair; the ASCII should pass through.
    #[test]
    fn mixed_mojibake_and_ascii_only_affects_mojibake_runs() {
        // "[hot]" + 6 Latin-1 codepoints for 火山 + " (volcengine)".
        let bad = "[hot]\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1} (volcengine)";
        let fixed = repair_mojibake(bad);
        assert_eq!(fixed, "[hot]火山 (volcengine)");
    }

    /// A string with only 1 or 2 consecutive Latin-1-high chars is
    /// almost certainly a genuine Western European char — we must
    /// leave it alone.
    #[test]
    fn short_run_below_threshold_is_left_alone() {
        // "aéb" — only `é` (U+00E9) is Latin-1-high, run length 1.
        // Repair would yield back the same string (no change), but
        // more importantly we shouldn't try.
        let s = "aéb";
        assert_eq!(repair_mojibake(s), s);

        // "a€b" — € is U+20AC, outside Latin-1 range, so it can't be
        // double-encoded; we must not touch it.
        let s = "a€b";
        assert_eq!(repair_mojibake(s), s);
    }

    /// Idempotency: repairing an already-repaired string is a no-op.
    /// (Already-repaired strings have non-Latin-1 chars, so they
    /// fall into the "valid UTF-8" branch and are returned unchanged.)
    #[test]
    fn idempotent() {
        let once = repair_mojibake("\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}Agentplan");
        let twice = repair_mojibake(&once);
        assert_eq!(once, twice);
        assert_eq!(once, "火山Agentplan");
    }

    // ----- repair_mojibake_runs — segment-wise repair -----

    /// A string that mixes pre-existing valid UTF-8 CJK with a
    /// mojibake run must repair only the run.
    #[test]
    fn runs_repairs_mojibake_preserves_clean_cjk() {
        // "备注 " (clean UTF-8) + "火山" (mojibake) + " 备忘" (clean UTF-8).
        // The mojibake 6 codepoints in the middle should flip to "火山";
        // the surrounding clean CJK should pass through.
        let mixed = "备注 \u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1} 备忘";
        let fixed = repair_mojibake_runs(mixed);
        assert_eq!(fixed, "备注 火山 备忘");
    }

    /// All-mojibake input still works (delegates to the same logic).
    #[test]
    fn runs_all_mojibake_still_repairs() {
        let bad = "\u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}Agentplan";
        let fixed = repair_mojibake_runs(bad);
        assert_eq!(fixed, "火山Agentplan");
    }

    /// Genuine Latin-1 single-char strings (French/Spanish names) are
    /// not touched — the run is too short to be mojibake.
    #[test]
    fn runs_genuine_latin1_passes_through() {
        assert_eq!(repair_mojibake_runs("café résumé"), "café résumé");
        assert_eq!(repair_mojibake_runs("straße"), "straße");
    }

    /// Empty / ASCII-only input is a no-op.
    #[test]
    fn runs_empty_and_ascii_passes_through() {
        assert_eq!(repair_mojibake_runs(""), "");
        assert_eq!(repair_mojibake_runs("plain ascii"), "plain ascii");
        assert_eq!(repair_mojibake_runs("GLM-4.6"), "GLM-4.6");
    }

    /// Trailing mojibake run with no terminator (end of string) is
    /// still repaired.
    #[test]
    fn runs_trailing_mojibake_segment_repairs() {
        let bad = "Note: \u{00E7}\u{0081}\u{00AB}\u{00E5}\u{00B1}\u{00B1}";
        let fixed = repair_mojibake_runs(bad);
        assert_eq!(fixed, "Note: 火山");
    }
}