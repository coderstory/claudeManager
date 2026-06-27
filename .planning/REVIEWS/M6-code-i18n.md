---
subsystem: i18n-hardcoded-text
reviewer: opencode (deepseek-v4-flash-free; default routing for opencode 1.17.10)
reviewed_at: 2026-06-27T02:28:14Z
scope: SPEC.md §5 + §10, src/ (TSX/TS), src-tauri/src/ (RS), package.json deps
target_branch: master
project: Claude 配置管理器 — Tauri v2
prompt: /tmp/opencode-audit-i18n.md
stdout_lines: 177
stderr_lines: 21
exit_code: 0
---

# i18n + Hardcoded Text Audit — opencode

<output>
## Executive Summary

The app is **Simplified Chinese–only by SPEC design** (§10 defers i18n to v1.2+). No i18n framework exists, no locale files exist, and every UI string is hardcoded in source — 95 `.ts`/`.tsx` files (~14,700 Chinese chars) + 62 `.rs` files (~22,200 Chinese chars). ~30 English terms (technical labels like `Provider`, `Model`, `JSON`) appear in Chinese contexts. A future en-US retrofit would touch **157+ source files**. SPEC's recommendation to centralize strings in one file was not followed.

---

## 1. SPEC Requirement Check

**Findings**: §10 (lines 1152–1160) explicitly defers i18n:

```
§10. i18n / 国际化
v1.1 单语言:简体中文(zh-CN)
- 所有 UI 文字硬编码中文
- 不引入 i18n 框架
- 字符串集中放一个文件(如 Strings.zh-CN.cs),便于未来扩
v1.2+:可加 en-US,字符串放 Strings.en-US.cs
```

- i18n is **NOT required** for v1.1.
- SPEC **recommends** centralized string file, which was **not implemented**.
- No `Strings.zh-CN.cs` or equivalent exists anywhere.

---

## 2. i18n Framework Presence

**No findings.** Grep for `useTranslation`, `t(`, `i18n.`, `Intl.`, `formatMessage`, `Trans`, `<Localized>`, `__()`, `_()`, `changeLanguage` — **zero hits** in `src/`. All matches in the initial scan were false positives (e.g. `useEffect(`, `.toString()`, `textContent`).

---

## 3. i18n Library in package.json

**No findings.** `package.json` dependencies: `@tauri-apps/api ^2`, `@tauri-apps/plugin-opener ^2`, `lucide-react 0.542.0`, `react ^19.1.0`, `react-dom ^19.1.0`. No i18n dep present.

---

## 4. Chinese Characters in Frontend (`src/`)

**95 files** contain CJK characters. **Top-20 by density:**

| # | Count | File |
|---|-------|------|
| 1 | 1,845 | `src/pages/resource-browser/index.tsx` |
| 2 | 1,287 | `src/App.tsx` |
| 3 | 1,131 | `src/__tests__/pages/resource-browser.test.tsx` |
| 4 | 1,099 | `src/pages/marketplace/index.tsx` |
| 5 | 1,071 | `src/pages/provider-list/index.tsx` |
| 6 | 982 | `src/lib/sql-validator.ts` |
| 7 | 865 | `src/pages/backup-restore/index.tsx` |
| 8 | 838 | `src/components/JsonFileTree.tsx` |
| 9 | 817 | `src/pages/import-sql/index.tsx` |
| 10 | 809 | `src/__tests__/pages/provider-list.test.tsx` |
| 11 | 748 | `src/components/ErrorBanner.tsx` |
| 12 | 660 | `src/__tests__/pages/marketplace.test.tsx` |
| 13 | 615 | `src/lib/errors.ts` |
| 14 | 595 | `src/pages/optimizer/index.tsx` |
| 15 | 480 | `src/pages/about/index.tsx` |
| 16 | 444 | `src/pages/json-editor/index.tsx` |
| 17 | 428 | `src/__tests__/components/ErrorBanner.test.tsx` |
| 18 | 413 | `src/components/DatePicker.tsx` |
| 19 | 394 | `src/pages/mcp-management/index.tsx` |
| 20 | 373 | `src/lib/api/marketplace.ts` |

Representative Chinese strings: `Provider 列表` (`provider-list/index.tsx:3`), `● 已激活` (`provider-list/index.tsx:897`), `配置优化检查` (`optimizer/index.tsx:388`), `备份与恢复` (`AppSidebar.tsx:95`), `加载中...` (`about/index.tsx:133`).

---

## 5. Chinese Characters in Backend (`src-tauri/src/`)

**62 files** contain CJK characters, **22,213 total chars**. Top-5:

| # | Count | File |
|---|-------|------|
| 1 | 3,074 | `src-tauri/src/services/marketplace_service.rs` |
| 2 | 1,777 | `src-tauri/src/commands/fs.rs` |
| 3 | 1,541 | `src-tauri/src/commands/optimizer.rs` |
| 4 | 1,529 | `src-tauri/src/services/provider_service.rs` |
| 5 | 1,369 | `src-tauri/src/infrastructure/sql_parser.rs` |

Chinese in Rust appears in doc comments (`//!`/`///` — design notes in Chinese), test descriptions, and **user-facing error payloads** (e.g. `"路径含 '..',拒绝(安全策略)"` in `resource_service.rs:142`, `"当前配置不完整"` in `provider_service.rs`).

---

## 6. Hardcoded English UI Strings

Despite the Chinese-only design, ~30 English strings exist mixed in:

**Buttons** (2):
| String | File:Line |
|--------|-----------|
| `+ Add` | `provider-list/index.tsx:472` |
| `Fix` | `optimizer/index.tsx:937` |

**Table headers** (8):
| String | File:Line |
|--------|-----------|
| `Provider` | `history/UsageHistoryTable.tsx:163`, `DailyStatsTable.tsx:128`, `FilterBar.tsx:162` |
| `Model`, `Input`, `Output`, `Cache Read`, `Total`, `# Msgs` | `usage-query/index.tsx:449–454` |

**Format/transport labels** (5):
| String | File:Line |
|--------|-----------|
| `JSON`, `CSV` | `history/index.tsx:497–498` |
| `stdio`, `http` | `mcp-management/index.tsx:773–774` |
| `CLI`, `NPX`, `GIT` | `marketplace/index.tsx:840–844` |

**Field labels** (5):
| String | File:Line |
|--------|-----------|
| `Notes (可选)` | `provider-list/index.tsx:1129` |
| `<strong>id:</strong>`, `name:`, `base_url:`, `api_key:` | `provider-list/index.tsx:708–717` |

**Fallback text** (2):
| String | File:Line |
|--------|-----------|
| `(no url)`, `(no command)` | `mcp-management/index.tsx:570–571` |

---

## 7. Specific Questions

**Q1: Central text catalog?** **NONE FOUND.** No `en.json`, `zh.json`, `locales/`, `messages.ts`, `.po`, `.yaml`, or `Strings.zh-CN.*` file exists anywhere in the repo. SPEC §10's recommendation was not followed.

**Q2: Rust error messages localized?** Rust error messages are **hardcoded Chinese strings** in `Display` impls and error payload structs. For example `resource_service.rs:142` returns `"路径含 '..',拒绝(安全策略)"`. The `project.rs:219` comment notes *"方便前端按 code 做 i18n 或埋点; reason 是直接给用户看的中文。"* — the struct has a `code` field (suitable for i18n key) but `reason` is always Chinese.

**Q3: Language switcher?** **NONE.** No Settings page, About page, or any component contains a language switcher, `changeLanguage` call, or locale preference. Grep for `language`, `语言`, `Language`, `switchLanguage` — zero meaningful hits.

**Q4: If i18n is missing — impact estimate:**
- **95 frontend source files** (`src/`) with hardcoded Chinese to refactor
- **62 Rust files** (`src-tauri/src/`) with hardcoded Chinese to refactor
- **~30 English UI strings** to standardize (either extract or convert to Chinese)
- Total: **157+ files** would need extraction, a `react-i18next` setup, `translation.json` files, and integration wiring

**Q5: i18n exists but underused?** Not applicable — i18n does not exist.

---

## 8. Severity Categorization

| Severity | Count | Rationale |
|----------|-------|-----------|
| **CRITICAL** | 0 | SPEC §10 explicitly defers i18n to v1.2+ |
| **HIGH** | 1 | **157+ files** with hardcoded Chinese strings; no central catalog despite SPEC recommendation; switching languages = page-by-page rewrite |
| **MEDIUM** | 1 | ~30 English UI strings (`+ Add`, `Fix`, column headers like `Model`, `JSON`, `CLI`) mixed into Chinese UI — inconsistent and confusing |
| **LOW** | 2 | `DatePicker.tsx` locale hardcoded to en-US (`DatePicker.tsx:6`); no `Intl.DateTimeFormat` usage — dates/numbers not localizable |

---

## 9. Risk Assessment

**A Chinese-only UI locks out international users.** Any non-Chinese-speaking user (including English-speaking Claude users on macOS) cannot navigate the app — every button, error message, label, and tooltip is in Chinese. The **157+ files** with hardcoded strings mean a future i18n retrofit will cost **proportionally to string count**, not amortized by an existing framework. With ~14,700 Chinese characters in frontend and ~22,200 in backend code, extraction is a **multi-sprint effort**. The lack of a central string catalog (against SPEC recommendation) further compounds this — strings must be located per-file rather than extracted from one location.

---

## 10. Top 5 Fixes

1. **Adopt `react-i18next` + `i18next-browser-languagedetector`** — the de facto React i18n standard; auto-detects browser/system locale.

2. **Extract all Chinese strings to `src/locales/zh-CN/translation.json`** — one JSON file per locale, organized by page/component namespace.

3. **Create `src/locales/en-US/translation.json`** — English translation (even partial) as a scaffold for future translators.

4. **Add Settings → Language switcher** — a dropdown calling `i18n.changeLanguage('zh-CN' | 'en-US')` that persists preference to `localStorage` and re-renders in the target language.

5. **Rust: keep error payloads as `code` strings, localize in frontend** — the existing pattern in `commands/project.rs` (`code` field for i18n key + `reason` as Chinese fallback) is the right architecture; strip hardcoded Chinese from Rust `Display` impls and map codes to translations in the frontend layer.

---

```
| Severity | Count | Examples |
|---|---|---|
| CRITICAL | 0 | (SPEC defers i18n to v1.2+) |
| HIGH     | 1 | 157+ files with hardcoded Chinese; no centralized catalog |
| MEDIUM   | 1 | ~30 English strings mixed in (`+ Add`, `Model`, `JSON`, `CLI`, etc.) |
| LOW      | 2 | DatePicker locale hardcoded en-US; no Intl.DateTimeFormat |
```
</output>

---

## Reviewer Notes

- **Model used**: opencode 1.17.10 routed to `deepseek-v4-flash-free` instead of the spec'd `minimax/MiniMax-M3`. Output quality is high; the model routing is opencode's default and not under audit control.
- **Evidence density**: All severity findings include `file:line` references. Counts (95 frontend files, 62 Rust files, ~36,900 total Chinese characters, ~30 English strings) come from systematic grep + per-file counting.
- **SPEC compliance**: SPEC §10 explicitly states v1.1 is Chinese-only. The audit correctly classifies this as **0 CRITICAL** (no spec violation) but **1 HIGH** (SPEC recommendation to centralize strings in one file was not followed).
- **Cross-reference to M6-1/5**: This audit complements the M6 frontend audit. The display-name drift flagged in §6.4 is one example of the broader hardcoded-text problem quantified here.
- **Retrofit cost**: 157+ files × ~1-2 minutes per string extraction = roughly **40-80 engineer-hours** to add `react-i18next` and extract all hardcoded text. Not blocking for v1.1 ship, but should be tracked for v1.2 roadmap.