
### 1. commands::fs::tests::bare_filename_detection_negative
- Test file: src/commands/fs.rs:836
- Production: src/commands/fs.rs:200 `looks_like_bare_filename`
- Panic: `assertion failed: !looks_like_bare_filename("   ")`
- Category: assertion_contradicts_production
- Suggested fix: Remove the `"   "` assertion on line 840. Whitespace-only input is not a contract the production function promises to reject (per the function intent: only directory separators and absolute paths disqualify). Per the task brief, only the test can be changed.

### 2. commands::fs::tests::resolve_claude_path_active_root_none_resolves_to_home_dotclaude
- Test file: src/commands/fs.rs:935
- Production: src/commands/fs.rs:567 `resolve_claude_path`
- Panic: `无法解析路径 .../.tmp9pcYMe.claude/settings.json: No such file or directory`
- Category: other (fixture_mismatch / path_validation_gap)
- Suggested fix: Test calls `resolve_claude_path(&paths, None, "~/.claude/settings.json")` after writing to `<tmp>/.claude/settings.json`. Production's `~` resolution likely expands to the real `$HOME`, not `paths.home`. Either the test should pass an absolute path inside `<tmp>/.claude/`, or production's `~` expansion should honor `paths.home` when the path is otherwise allow-listed.

### 3. commands::fs::tests::resolve_claude_path_active_root_some_bare_filename_routes_to_project
- Test file: src/commands/fs.rs:987
- Production: src/commands/fs.rs:567 `resolve_claude_path`
- Panic: `路径超出允许范围(只允许 /private/var/folders/.../.claude/**): /var/folders/...`
- Category: other (path_validation_gap)
- Suggested fix: macOS canonicalizes `/var` to `/private/var`. Production compares against the un-canonicalized allow-list prefix. Test should either skip the allow-list check by symlinking `paths.home` under `/private/var`, or production should canonicalize the allow-list prefixes before comparison.

### 4. commands::optimizer::tests::default_filename_is_md_with_timestamp
- Test file: src/commands/optimizer.rs:606
- Production: src/commands/optimizer.rs:215 `default_report_filename`
- Panic: `left: 45, right: 48`
- Category: other (fixture_mismatch)
- Suggested fix: Test asserts `name.len() == 48` (`claude-optimization-report-` 30 + `YYYYMMDD-HHMMSS` 15 + `.md` 3 = 48). Actual length is 45. Read production at lines 223-226 — the format string likely produces a shorter prefix (e.g. `claude-opt-report-` 18 + 15 + 3 = 36) or different timestamp format. Align the assertion with the actual format string.

### 5. commands::optimizer::tests::epoch_to_ymdhms_known_anchor
- Test file: src/commands/optimizer.rs:598
- Production: src/commands/optimizer.rs:231 `epoch_to_ymdhms`
- Panic: `left: (2026, 6, 20, 5, 20, 0), right: (2026, 6, 21, 0, 0, 0)`
- Category: other (production_bug)
- Suggested fix: `1_781_932_800` is 2026-06-21 00:00:00 UTC. Production returns `(2026, 6, 20, 5, 20, 0)` which is exactly 5h20m earlier. The hand-rolled civil-from-days algorithm (line 238-249) likely has an off-by-one in the per-day hour accumulation. Read 231-260 and fix the algorithm.

### 6. commands::updater::tests::pubkey_is_base64_encoded_and_non_empty
- Test file: src/commands/updater.rs:57
- Production: N/A (test is self-contained, calls base64 crate directly)
- Panic: `pubkey must be valid base64: InvalidByte(5, 45)` (45 == '-' ASCII)
- Category: buggy_test
- Suggested fix: Test fixture `"dummy-base64-key-for-test"` contains `-` and `_` which are NOT valid STANDARD base64 alphabet. Either change to `URL_SAFE` engine (`base64::engine::general_purpose::URL_SAFE`) or use a real standard-base64 string like `"ZHVtbXktYmFzZTY0LWtleS1mb3ItdGVzdA=="`.

### 7. commands::history::tests::get_daily_stats_history_impl_aggregates_same_day_snapshots
- Test file: src/commands/history.rs:454
- Production: src/commands/history.rs:102 `get_daily_stats_history_impl` → HistoryService::query_daily_stats
- Panic: `left: 0, right: 1` (no rows returned)
- Category: other (production_bug)
- Suggested fix: Test inserts two snapshots with `timestamp: 1_700_000_000` and `+ 3600`, calls `backfill_daily_stats()`, then queries with filter `provider_id="p1"`. Production returns 0 rows. Read HistoryService::backfill_daily_stats + query_daily_stats — the backfill predicate likely uses `MAX(timestamp)` per (provider, day) and the second insert is dropping, or the query filters by something stale.

### 8. commands::history::tests::get_history_stats_impl_reports_zero_for_empty_db
- Test file: src/commands/history.rs:595
- Production: src/commands/history.rs:126 `get_history_stats_impl`
- Panic: `assertion failed: stats.first_recorded_at.is_none()`
- Category: other (production_bug)
- Suggested fix: Test asserts `first_recorded_at` is `None` on an empty DB, but production returns `Some(...)`. Likely `stats()` sets `first_recorded_at = Some(0)` or `Some(epoch)` as a default, or it leaks a value from an in-memory shared DB connection. Either production should leave it `None` when there is no row, or test should accept `Some(0)`.

### 9. commands::history::tests::get_daily_stats_history_impl_filters_by_provider
- Test file: src/commands/history.rs:501
- Production: src/commands/history.rs:102 `get_daily_stats_history_impl`
- Panic: `left: 0, right: 1` (filter for provider "b" returns 0 rows)
- Category: other (production_bug)
- Suggested fix: Same family as #7. `backfill_daily_stats()` is producing no rows for provider "b" (which has tokens_used=99). Likely the backfill predicate skips single-snapshot days, or the filter's provider_id field name does not match.

### 10. domain::provider::tests::new_provider_populates_created_at_and_default_flags
- Test file: src/domain/provider.rs:480
- Production: src/domain/provider.rs:30 `Provider` struct + `new`
- Panic: `assertion failed: p.created_at < 1_700_000_000 + 3_600`
- Category: time_bombed
- Suggested fix: Test asserts `created_at < 1_703_596_000` (2023-11-14 + 1h). In 2026, current `SystemTime::now()` returns ~1.78e9, way past 1.7e9. Replace `1_700_000_000` with a moving anchor, e.g. `(std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() - 3_600)`, or use a tolerance check.

### 11. domain::usage::tests::roundtrip_usage_snapshot_omits_none_fields
- Test file: src/domain/usage.rs:406
- Production: src/domain/usage.rs:261 `UsageSnapshot` (Serialize impl)
- Panic: `assertion failed: v.get("breakdown").is_some()`
- Category: buggy_test
- Suggested fix: Test asserts `is_some()` then immediately `is_none()` on the same key (lines 417-418). This is self-contradictory. The intent is "verify the field is present in JSON even when empty array" — keep `assert!(v.get("breakdown").is_some())` and delete line 418 (the `is_none()` line).

### 12. domain::usage::tests::serialize_window_lowercase
- Test file: src/domain/usage.rs:354
- Production: src/domain/usage.rs:45 `UsageWindow` (Serialize impl)
- Panic: `left: "fivehours", right: "five_hours"`
- Category: other (config_key_drift)
- Suggested fix: Test expects `"five_hours"` (snake_case); production emits `"fivehours"`. The enum likely has a custom serialize or the variant name is `FiveHours` which serializes without an underscore. Either rename the variants in the enum (production) or update the test to expect `"fivehours"`.

### 13. infrastructure::backup_scanner::tests::parse_filename_extracts_original_and_ts
- Test file: src/infrastructure/backup_scanner.rs:433
- Production: src/infrastructure/backup_scanner.rs `parse_backup_filename`
- Panic: `called Option::unwrap() on a None value` at line 435
- Category: other (fixture_mismatch)
- Suggested fix: Test passes `PathBuf::from("/x/y/settings.json.bak.20260619-142305")` and expects `original_path.ends_with("settings.json")` and `timestamp_unix = Some(1_781_929_385)`. Production returns `None` from `parse_backup_filename`. Likely the parser requires an additional extension/segment, or the timestamp `20260619-142305` doesn't decode correctly (note `1_781_929_385` corresponds to 2026-06-19 14:23:05 UTC — verify the timestamp parser at line 188).

### 14. infrastructure::backup_scanner::tests::parse_timestamp_rejects_garbage
- Test file: src/infrastructure/backup_scanner.rs:480
- Production: src/infrastructure/backup_scanner.rs:188 `parse_timestamp`
- Panic: `assertion failed: parse_timestamp("20260230-000000").is_none()`
- Category: other (production_bug)
- Suggested fix: `20260230` is invalid (Feb has 28-29 days). Production's `parse_timestamp` accepts it and returns `Some(...)` instead of `None`. The hand-rolled date validator (likely in 188-230) probably only checks `mo <= 12` but does not cross-check `(y, mo) → days_in_month`. Add a days-in-month table + leap year check.

### 15. infrastructure::backup_scanner::tests::scan_sorts_newest_first
- Test file: src/infrastructure/backup_scanner.rs:355
- Production: src/infrastructure/backup_scanner.rs:98 `scan_backups_in`
- Panic: `left: Some(1781878985), right: Some(1781929385)` (got older ts first)
- Category: other (production_bug)
- Suggested fix: First entry has older `timestamp_unix` (1781878985 = earlier) than expected (1781929385 = newer). Either the sort comparator is reversed or the parser is reading the wrong field. Read sort closure at end of `scan_backups_in`.

### 16. infrastructure::deeplink_parser::tests::parse_malformed_query_errors
- Test file: src/infrastructure/deeplink_parser.rs:453
- Production: src/infrastructure/deeplink_parser.rs:118 `parse_deeplink_url`
- Panic: `assertion failed: matches!(err, DeeplinkParseError::InvalidUrl(_))`
- Category: other (production_bug)
- Suggested fix: Test feeds a malformed URL expecting `InvalidUrl(_)`; production returns a different variant (likely a more specific error like `EmptyName` or `MissingField` is returned when the URL parses but the payload is bad). Verify which error variant production returns and update either test or error mapping.

### 17. infrastructure::deeplink_parser::tests::parse_mcp_stdio_full
- Test file: src/infrastructure/deeplink_parser.rs:559
- Production: src/infrastructure/deeplink_parser.rs:251 `parse_mcp_deeplink`
- Panic: `left: None, right: Some("/tmp")` (s.env["ROOT"] missing)
- Category: other (fixture_mismatch)
- Suggested fix: Test expects `s.env.get("ROOT") == Some("/tmp")` from URL `env.ROOT=/tmp;KEY=v`. Production is dropping `ROOT` or the `;` separator is being treated as a path delimiter. Verify URL-decoding of dotted-key query params (`env.ROOT` syntax) in the parser.

### 18. infrastructure::fs_atomic::tests::unix_to_utc_fields_known_value
- Test file: src/infrastructure/fs_atomic.rs:568
- Production: src/infrastructure/fs_atomic.rs:304 `unix_to_utc_fields`
- Panic: `left: (5, 20, 0), right: (0, 0, 0)` for `(h, m, s)` fields
- Category: other (production_bug)
- Suggested fix: Test expects `(0, 0, 0)` for hour/min/sec of `1_781_932_800` (= 2026-06-21 00:00:00 UTC). Production returns `(5, 20, 0)`. Same root cause as #5: the hand-rolled epoch decomposition is wrong by a non-uniform offset, suggesting both share a faulty utility. Fix `unix_to_utc_fields` (and `epoch_to_ymdhms`) together.

### 19. infrastructure::json_diff::tests::diff_object_combined_add_remove_change
- Test file: src/infrastructure/json_diff.rs:260
- Production: src/infrastructure/json_diff.rs:74 `diff_json`
- Panic: `left: 3, right: 2`
- Category: assertion_contradicts_production
- Suggested fix: Test expects 2 diff entries (probably collapse add+remove of same path into Change); production returns 3 (separate Add/Change/Remove). The test contract says "diff with both add and remove should count Change once" but the impl treats them independently. Either change production to coalesce or update test to expect 3.

### 20. infrastructure::optimizer_rules::tests::inconsistent_type_apply_lowercases_with_backup
- Test file: src/infrastructure/optimizer_rules.rs:1637
- Production: src/infrastructure/optimizer_rules.rs: InconsistentProviderTypeRule::apply
- Panic: `error = Some("无法解析 provider id(请重新扫描)。")`
- Category: other (production_bug)
- Suggested fix: `apply()` fails with "无法解析 provider id" — it cannot find provider "p2" by ID even though `findings[0]` references it. Likely the apply path looks up by name or path but the test fixture stores by ID. Verify `InconsistentProviderTypeRule::apply` (line 619 area) provider lookup.

### 21. infrastructure::sql_parser::tests::parse_escaped_quote_in_string_value
- Test file: src/infrastructure/sql_parser.rs:1344
- Production: src/infrastructure/sql_parser.rs:132 `parse_sql_dump`
- Panic: `left: "Its ok", right: "It's ok"`
- Category: other (production_bug)
- Suggested fix: SQL has `'It''s ok'` (SQL-standard escaped single quote = single literal `'`); production strips both quotes producing `Its ok`. The parser's string scanner (likely around line 132-200) sees `''` and removes both chars. Fix: keep one quote when seeing `''` inside a string literal.

### 22. infrastructure::sql_parser::tests::parse_mcp_row_double_encoded_json
- Test file: src/infrastructure/sql_parser.rs:1446
- Production: src/infrastructure/sql_parser.rs:132 `parse_sql_dump`
- Panic: `parse: "server_config invalid JSON: trailing characters at line 1 column 4"`
- Category: other (production_bug)
- Suggested fix: Test feeds a JSON value that is double-encoded. Production fails because after first decode there is trailing data. Either the parser should detect double-encoded JSON and recurse, or the test fixture should pass single-encoded JSON.

### 23. infrastructure::sql_parser::tests::parse_missing_required_field_recorded_as_skipped
- Test file: src/infrastructure/sql_parser.rs:1298
- Production: src/infrastructure/sql_parser.rs:132 `parse_sql_dump`
- Panic: `assertion failed: parsed.skipped_lines[0].reason.contains("values but 3 columns")`
- Category: other (production_bug)
- Suggested fix: Test expects skip reason to mention `"values but 3 columns"` (column count mismatch in INSERT). Production's reason string is different (likely `"expected N columns, got 3"` or just `"column mismatch"`). Align the wording.

### 24. infrastructure::sql_parser::tests::parse_unknown_table_positional_insert_silently_ignored
- Test file: src/infrastructure/sql_parser.rs:1240
- Production: src/infrastructure/sql_parser.rs:132 `parse_sql_dump`
- Panic: `assertion failed: parsed.skipped_lines.is_empty()`
- Category: assertion_contradicts_production
- Suggested fix: Test expects unknown tables to be silently ignored (no skipped_lines entry); production records them in `skipped_lines`. The contract is ambiguous — either test should accept `skipped_lines` containing the unknown table, or production should not record skips for unknown tables (only for malformed ones).

### 25. infrastructure::sqlite::history_db::tests::open_recovers_from_corruption
- Test file: src/infrastructure/sqlite/history_db.rs:448
- Production: src/infrastructure/sqlite/history_db.rs:167 `open_history_db`
- Panic: `called Result::unwrap() on an Err value: Sqlite(... "file is not a database")`
- Category: other (production_bug)
- Suggested fix: Test writes garbage bytes to a `.db` file and expects `open_history_db` to either recover (recreate) or return a clean error. Production returns raw SQLite error which `unwrap()` blows up on. Likely `open_history_db` does not catch the `SqliteFailure` from the probe-and-recover path. Add try-from-corruption with a backup-and-recreate fallback.

### 26. services::backup_service::tests::backup_incremental_when_changed_creates_backup
- Test file: src/services/backup_service.rs:1292
- Production: src/services/backup_service.rs:409 `backup_incremental`
- Panic: `left == right (same path: "...settings.json.bak.20260628-211538")`
- Category: other (production_bug / time_bombed)
- Suggested fix: New backup has the SAME path as the old one — second `.bak.<ts>` collides. The timestamp is seconds-resolution so two backups in the same second produce identical filenames. Production should include millis (`HHMMSS-mmm`) or a counter. Test should also sleep 1s or use an injected clock.

### 27. services::backup_service::tests::delete_backup_rejects_path_outside_allowed_dirs
- Test file: src/services/backup_service.rs:1433
- Production: src/services/backup_service.rs:550 `delete_backup`
- Panic: `delete outside allow-list must error: ()` (got Ok(()), so `.expect_err` returned Ok which the `()` repr shows)
- Category: other (path_validation_gap)
- Suggested fix: Test passes `tmp.path()/not-a-backup.txt` (a file outside `~/.claude/` and outside `<app_data>/backups/`); production's `resolve_safe_path_for_active_root` accepts it. The allow-list is too permissive OR the test path is somehow inside an allowed dir (check `test_paths()` helper at line ~870). Likely the allow-list includes the entire `tmp.path()` because of how `test_paths` configures `app_data`.

### 28. services::backup_service::tests::delete_backup_rejects_path_completely_outside_allowlist
- Test file: src/services/backup_service.rs:1486
- Production: src/services/backup_service.rs:550 `delete_backup`
- Panic: `path outside allow-list must be rejected: ()`
- Category: other (path_validation_gap)
- Suggested fix: Same family as #27 — test passes a path completely outside both `~/.claude/` and `<app_data>/backups/`. Production returns `Ok(())` instead of `Err(PathNotAllowed)`. Same root cause: allow-list resolution too permissive.

### 29. services::backup_service::tests::delete_backup_missing_file_errors
- Test file: src/services/backup_service.rs:1441
- Production: src/services/backup_service.rs:550 `delete_backup`
- Panic: `assertion failed: matches!(err, BackupError::NotFound(_))`
- Category: other (production_bug)
- Suggested fix: Test passes a non-existent file `<claude_dir>/settings.json.bak.20990101-000000`; production returns an error but it is not the `NotFound` variant (likely `Io(_)` wrapping the not-found syscall, or `PathNotAllowed` because the timestamp format does not parse). Production's `delete_backup` (line 562-567) should explicitly return `NotFound` for missing files but currently does not.

### 30. services::backup_service::tests::delete_backup_twice_returns_not_found_on_second
- Test file: src/services/backup_service.rs:1468
- Production: src/services/backup_service.rs:550 `delete_backup`
- Panic: `assertion failed: matches!(err, BackupError::NotFound(_))`
- Category: other (production_bug)
- Suggested fix: Same family as #29 — second delete returns wrong error variant (probably `Io(_)` instead of `NotFound`).

### 31. services::backup_service::tests::list_backups_dedupes_when_same_file_in_two_dirs
- Test file: src/services/backup_service.rs:1377
- Production: src/services/backup_service.rs:141 `list_backups`
- Panic: `left: 2, right: 1` (same canonical file in two dirs not deduped)
- Category: other (production_bug)
- Suggested fix: Test sets up a symlink or hardlink so the same `settings.json.bak.20260619-140000` appears in both `<tmp>/backups/` and `<tmp>/claude/`. Production's `list_backups` returns both. Fix: after merging both dirs, dedupe by `canonicalize().unwrap_or(path)` and keep first occurrence.

### 32. services::backup_service::tests::read_backup_content_rejects_path_outside_allowed_dirs
- Test file: src/services/backup_service.rs:912
- Production: src/services/backup_service.rs:215 `read_backup_content`
- Panic: `called Result::unwrap_err() on an Ok value: "hi"` (read succeeded with content "hi")
- Category: other (path_validation_gap)
- Suggested fix: Test writes `hi` to `<tmp>/not-a-backup.txt` and expects `Err(PathNotAllowed)`. Production reads it successfully — the allow-list check is missing or wrong. Likely `test_paths` puts the temp dir entirely in the allow-list, or production only validates file extension (`.bak`/`.backup`), not directory.

### 33. services::backup_service::tests::restore_backup_invalid_path_errors
- Test file: src/services/backup_service.rs:1006
- Production: src/services/backup_service.rs:293 `restore_backup`
- Panic: `assertion failed: matches!(err, BackupError::PathNotAllowed(_))`
- Category: other (path_validation_gap)
- Suggested fix: Test feeds an invalid path (probably absolute path outside allow-list); production returns wrong error variant or `Ok`. Same allow-list looseness as #27/#32.

### 34. services::backup_service::tests::restore_backup_missing_file_errors
- Test file: src/services/backup_service.rs:1018
- Production: src/services/backup_service.rs:293 `restore_backup`
- Panic: `assertion failed: matches!(err, BackupError::NotFound(_))`
- Category: other (production_bug)
- Suggested fix: Test passes a non-existent backup path; production returns `Io(_)` or other variant, not `NotFound`. Add explicit `if !backup_path.exists() { return Err(BackupError::NotFound(backup_path.into())); }` at the top of `restore_backup`.

### 35. services::marketplace_service::tests::slug_from_url_rejects_empty
- Test file: src/services/marketplace_service.rs:862
- Production: src/services/marketplace_service.rs:448 `slug_from_url`
- Panic: `assertion failed: slug_from_url("https://github.com/").is_err()`
- Category: other (production_bug)
- Suggested fix: URL `https://github.com/` has no path segments after the host; test expects `Err`. Production returns `Ok("github")` or similar (it derives slug from host when path is empty). Either production should treat empty path as an error, or test should accept the host-derived slug.

### 36. services::mcp_service::tests::remove_existing_deletes_from_file
- Test file: src/services/mcp_service.rs:770
- Production: src/services/mcp_service.rs `McpService::remove` (or similar)
- Panic: `Result::unwrap() on Err value: NotFound("31f9f1c0-8aad-4e8f-bf41-a5e7eb653438")`
- Category: other (fixture_mismatch)
- Suggested fix: Test creates an MCP server with UUID `31f9f1c0-...` and then calls `remove(uuid)`. Production cannot find it by that ID — likely the production code looks up by `name` not `id`, or the test fixture writes the UUID in a different field than `remove` reads. Verify the lookup key in `remove`.

### 37. services::mcp_service::tests::toggle_enabled_writes_to_file
- Test file: src/services/mcp_service.rs:616
- Production: src/services/mcp_service.rs `McpService::toggle_enabled`
- Panic: `Result::unwrap() on Err value: NotFound("2eff4dd4-...")`
- Category: other (fixture_mismatch)
- Suggested fix: Same family as #36 — test creates server with UUID `2eff4dd4-...`, production's `toggle_enabled` cannot find it. Likely ID-vs-name lookup mismatch.

### 38. services::mcp_service::tests::update_existing_replaces_in_file
- Test file: src/services/mcp_service.rs:714
- Production: src/services/mcp_service.rs `McpService::update`
- Panic: `Result::unwrap() on Err value: NotFound("6ecf8ddf-...")`
- Category: other (fixture_mismatch)
- Suggested fix: Same family as #36/#37 — `update(id)` cannot find the existing entry. Verify lookup key.

### 39. services::mcp_service::tests::update_id_mismatch_errors
- Test file: src/services/mcp_service.rs:750
- Production: src/services/mcp_service.rs `McpService::update`
- Panic: `assertion failed: matches!(err, McpError::InvalidField(_))`
- Category: other (production_bug)
- Suggested fix: Test passes update payload with mismatched ID (probably `id` in body differs from path/lookup id); production returns `NotFound` instead of `InvalidField`. The check should validate `payload.id == path.id` BEFORE the lookup, returning `InvalidField` on mismatch.

### 40. services::mcp_service::tests::write_preserves_unknown_top_level_keys
- Test file: src/services/mcp_service.rs:851
- Production: src/services/mcp_service.rs:516 `write_mcp_json` (or `McpService::write`)
- Panic: `Result::unwrap() on Err value: NotFound("96e3fe6d-...")`
- Category: other (fixture_mismatch)
- Suggested fix: Test writes an existing MCP JSON containing `mcpServers.<uuid>` plus an unknown top-level key `unknown_field: {}`, calls `write`, expects the unknown key preserved. Production fails because the test fixture's UUID `96e3fe6d-...` is not found by the lookup. Likely `write` is treating the call as an update and looking up by ID, but the test scenario is a fresh write.

### 41. services::mcp_service::tests::write_with_active_root_some_writes_to_project_and_creates_backup
- Test file: src/services/mcp_service.rs:995
- Production: src/services/mcp_service.rs `McpService::write`
- Panic: `old entry replaced`
- Category: other (production_bug)
- Suggested fix: Test writes a new MCP server to project root (active_root=Some), expects NO replacement of existing user-level entry. Production is overwriting the user-level `.mcp.json`. The `active_root` parameter is likely not being honored by `write` — it writes to both or to user-level instead of project-level.

### 42. services::optimizer_service::tests::apply_with_active_root_missing_root_dir_rejects_write
- Test file: src/services/optimizer_service.rs:815
- Production: src/services/optimizer_service.rs:191 `apply_findings`
- Panic: `DEPRECATED_FIELD should fire`
- Category: other (fixture_mismatch)
- Suggested fix: Test scans with a bogus (non-existent) project root expecting `DEPRECATED_FIELD` finding to fire. Production's `scan_with_root` returns no findings (or different ones). The scanner likely bails out early when the root does not exist rather than scanning whatever files exist. Either relax the early-return or update the test to use an existing dir with deprecated fields.

### 43. services::project_service::tests::switch_updates_current_and_takes_f13_backup
- Test file: src/services/project_service.rs:554
- Production: src/services/project_service.rs:200 `switch`
- Panic: `expected .claude.json backup, got: ["settings.json.bak.20260628-211558", "settings.json"]`
- Category: other (production_bug)
- Suggested fix: Test expects BOTH `settings.json.bak.*` AND `.claude.json.bak.*` after `switch()`. Production only backs up `settings.json`. The F13 backup logic in `switch()` is missing the `.claude.json` step. Add backup of `paths.claude_json` alongside `paths.settings_json`.

### 44. services::resource_service::tests::reveal_error_propagates_with_category_tag
- Test file: src/services/resource_service.rs:243
- Production: src/services/resource_service.rs:156 `reveal`
- Panic: `got msg = Path does not exist: /var/folders/.../anything.md`
- Category: other (production_bug)
- Suggested fix: Test expects the error message to contain a category tag (e.g. `[NOT_FOUND]` or `[PATH]` prefix); production emits plain `Path does not exist: ...`. The test contract for `classify_io_error` requires the leading category word, but `reveal` does not classify before stringifying. Add `classify_io_error` wrapper in `reveal`'s error path.

### 45. services::resource_service::tests::reveal_failure_serializes_all_variants
- Test file: src/services/resource_service.rs:303
- Production: src/services/resource_service.rs:156 `reveal`
- Panic: `assertion failed: lf.message.contains("exit 1")`
- Category: other (production_bug)
- Suggested fix: Test mocks `RevealPlatform` to return `RevealError::LauncherFailed { exit_code: 1, stderr: "..." }`. Expects serialized message to contain `"exit 1"`. Production's Display impl for `RevealError` uses different wording (e.g. `"launcher failed (code=1)"` or just `"launcher failed"`). Align the Display format.

## Aggregate observations

### Cross-cutting root causes

1. **Hand-rolled epoch decomposition is broken** (affects tests #5, #18). The civil-from-days algorithm in `optimizer.rs:231` and `fs_atomic.rs:304` returns inconsistent hour/min/sec values. Fix once, fix twice.

2. **`allowlist` resolution on macOS is non-canonical** (affects tests #3, #27, #28, #32, #33). `resolve_safe_path` compares un-canonicalized prefixes against paths that may have been canonicalized to `/private/var/...`. Need to canonicalize BOTH sides.

3. **`backup_incremental` timestamp resolution is too coarse** (affects test #26). Two backups in the same second collide. Switch to millisecond resolution or append a counter.

4. **`delete_backup`/`restore_backup` do not normalize error variants** (affects tests #29, #30, #34). They return `Io(_)` for not-found instead of `NotFound(_)`. Add explicit existence-check + NotFound conversion at the entry point.

5. **`McpService` ID lookup mismatch** (affects tests #36, #37, #38, #40). Test fixtures store servers keyed by ID, production looks up by name (or vice versa). Confirm canonical lookup key and align test fixtures.

6. **`SqlParser` string-literal handling** (affects tests #21, #23, #24). The parser has multiple subtle bugs: dropping one character of escaped quotes, mismatched skip-reason wording, and recording unknown tables as skipped. These should be fixed together as a focused pass.

7. **`backup_scanner::parse_timestamp` lacks days-in-month validation** (affects test #14). Need cross-check with month length table including leap year.

8. **One real time-bomb** (test #10). `1_700_000_000` was Nov 2023 — now 2026, the assertion `created_at < 1_703_596_000` is false for any freshly-created provider. Replace with tolerance / dynamic anchor.

### Suggested fix priority

**P0 (blocks ship / corrupts data)**: #5, #18 (epoch math), #14 (calendar validation), #21 (SQL parser), #26 (backup filename collision), #43 (missing .claude.json backup).

**P1 (real production bugs, not test bugs)**: #7, #8, #9, #15, #20, #25, #29, #30, #31, #34, #39, #41.

**P2 (allow-list / contract drift, security-adjacent)**: #2, #3, #27, #28, #32, #33, #35, #44, #45.

**P3 (test-only fixes — brief explicitly says test can be changed)**: #1, #6, #10, #11, #19, #24.

**P3 (fixture / config key updates, no production risk)**: #4, #12, #13, #16, #17, #36, #37, #38, #40, #42.

## Inventory file path

`/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/tech-debt-test-inventory.md`




