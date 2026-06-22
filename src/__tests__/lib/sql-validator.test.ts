/**
 * sql-validator — M3.9 清单 21 测试 (5 场景)
 *
 * 覆盖 5 场景 (清单 21):
 *   1. `valid`           — 至少 1 个合法 INSERT INTO providers
 *   2. `partially_valid` — 至少 1 importable + 至少 1 skipped
 *   3. `illegal`         — 有 INSERT 但 0 importable (全是非法/未知表)
 *   4. `empty`           — 空文件 / 纯空白
 *   5. `encoding_error`  — 含非 UTF-8 字节 (U+FFFD)
 *
 * 包含 7 个测试:
 *   - 5 场景各 1 个
 *   - splitStatements 字符串内分号测试
 *   - 真实 cc-switch dump 集成测试
 */
import { describe, it, expect } from 'vitest';
import { validateSql, splitStatements } from '../../lib/sql-validator';

// ---------------------------------------------------------------------------
// 场景 1: valid — 完整可导入
// ---------------------------------------------------------------------------

describe('validateSql — scenario: valid', () => {
  it('returns valid + 1 importable when file has 1 INSERT INTO providers', () => {
    const sql = `
      INSERT INTO providers (id, app_type, name, settings_config) VALUES ('p1', 'claude', 'P1', '{}');
    `;
    const r = validateSql(sql);
    expect(r.scenario).toBe('valid');
    expect(r.valid).toBe(true);
    expect(r.importableCount).toBe(1);
    expect(r.skippedCount).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('returns valid + 4 importable for cc-switch dump (no PRAGMA/BEGIN/COMMIT)', () => {
    // 不含 PRAGMA/BEGIN/COMMIT → 应为 valid (无 skipped)。
    const sql = `
      INSERT INTO providers VALUES('glm-46','claude','GLM','{}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);
      INSERT INTO providers VALUES('ds','claude-desktop','DS','{}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);
      INSERT INTO mcp_servers VALUES('fs','Filesystem','{}','Local',NULL,NULL,'[]',1,0,0,1,0);
      INSERT INTO mcp_servers VALUES('git','GitHub','{}','Remote',NULL,NULL,'[]',1,0,0,1,0);
    `;
    const r = validateSql(sql);
    expect(r.scenario).toBe('valid');
    expect(r.importableCount).toBe(4);
    expect(r.skippedCount).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('returns partially_valid for realistic cc-switch dump with PRAGMA/BEGIN/COMMIT', () => {
    // 真实 cc-switch dump 头部有 PRAGMA + BEGIN + COMMIT → partially_valid。
    const sql = `
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      INSERT INTO providers VALUES('glm-46','claude','GLM','{}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);
      INSERT INTO providers VALUES('ds','claude-desktop','DS','{}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);
      INSERT INTO mcp_servers VALUES('fs','Filesystem','{}','Local',NULL,NULL,'[]',1,0,0,1,0);
      INSERT INTO mcp_servers VALUES('git','GitHub','{}','Remote',NULL,NULL,'[]',1,0,0,1,0);
      COMMIT;
    `;
    const r = validateSql(sql);
    expect(r.scenario).toBe('partially_valid');
    expect(r.importableCount).toBe(4);
    expect(r.skippedCount).toBe(3); // PRAGMA + BEGIN + COMMIT
    expect(r.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 场景 2: partially_valid — 有 importable 也有 skipped
// ---------------------------------------------------------------------------

describe('validateSql — scenario: partially_valid', () => {
  it('returns partially_valid when 1 importable + 1 unknown table INSERT', () => {
    const sql = `
      INSERT INTO providers VALUES('p1','claude','P1','{}',NULL,'custom',NULL,0,NULL,NULL,NULL,'{}',0,0,'1.0',NULL,NULL,NULL);
      INSERT INTO proxy_request_logs (id, foo) VALUES (1, 'bar');
    `;
    const r = validateSql(sql);
    expect(r.scenario).toBe('partially_valid');
    expect(r.valid).toBe(true);
    expect(r.importableCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 场景 3: illegal — 有 INSERT 但 0 importable
// ---------------------------------------------------------------------------

describe('validateSql — scenario: illegal', () => {
  it('returns illegal when all INSERTs target unknown tables', () => {
    const sql = `
      INSERT INTO proxy_request_logs (id) VALUES (1);
      INSERT INTO request_logs (id, ts) VALUES (2, '2024');
    `;
    const r = validateSql(sql);
    expect(r.scenario).toBe('illegal');
    expect(r.valid).toBe(false);
    expect(r.importableCount).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('parse');
  });

  it('returns illegal when file has no SQL at all', () => {
    const sql = 'this is just plain text\nno SQL keywords\n';
    const r = validateSql(sql);
    expect(r.scenario).toBe('illegal');
    expect(r.valid).toBe(false);
    expect(r.importableCount).toBe(0);
    expect(r.errors[0].code).toBe('no_insert');
  });
});

// ---------------------------------------------------------------------------
// 场景 4: empty — 空文件
// ---------------------------------------------------------------------------

describe('validateSql — scenario: empty', () => {
  it('returns empty for literal empty string', () => {
    const r = validateSql('');
    expect(r.scenario).toBe('empty');
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('empty');
    expect(r.errors[0].message).toMatch(/空/);
  });

  it('returns empty for whitespace-only content', () => {
    const r = validateSql('   \n\n\t  \r\n');
    expect(r.scenario).toBe('empty');
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// 场景 5: encoding_error — 含 U+FFFD (非 UTF-8 替换字符)
// ---------------------------------------------------------------------------

describe('validateSql — scenario: encoding_error', () => {
  it('returns encoding_error when content contains U+FFFD', () => {
    const sql = `INSERT INTO providers (id) VALUES ('p1');\nBad bytes: ��\n`;
    const r = validateSql(sql);
    expect(r.scenario).toBe('encoding_error');
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('encoding');
    expect(r.errors[0].message).toMatch(/UTF-8/);
  });
});

// ---------------------------------------------------------------------------
// splitStatements edge cases
// ---------------------------------------------------------------------------

describe('splitStatements — edge cases', () => {
  it('does not split on semicolon inside single-quoted string', () => {
    const sql = "INSERT INTO providers (id, name) VALUES ('a;b', 'X');";
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].kind).toBe('INSERT');
    expect(stmts[0].targetTable).toBe('providers');
  });

  it('does not split on semicolon inside double-quoted string', () => {
    const sql = 'INSERT INTO "providers" (id, name) VALUES (\'a\', "x;y");';
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].targetTable).toBe('providers');
  });

  it('returns multiple statements separated by semicolons', () => {
    const sql = `
      INSERT INTO providers (id) VALUES ('a');
      INSERT INTO mcp_servers (id) VALUES ('b');
    `;
    const stmts = splitStatements(sql);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
    const inserts = stmts.filter((s) => s.kind === 'INSERT');
    expect(inserts).toHaveLength(2);
  });

  it('classifies BEGIN / COMMIT / PRAGMA / CREATE correctly', () => {
    const sql = `
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE foo (x INT);
      COMMIT;
    `;
    const stmts = splitStatements(sql);
    const kinds = stmts.map((s) => s.kind);
    expect(kinds).toContain('PRAGMA');
    expect(kinds).toContain('BEGIN');
    expect(kinds).toContain('CREATE');
    expect(kinds).toContain('COMMIT');
  });

  it('records correct 1-based line number for second statement', () => {
    const sql = 'INSERT INTO providers (id) VALUES (\'a\');\nINSERT INTO mcp_servers (id) VALUES (\'b\');';
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
    expect(stmts[0].line).toBe(1);
    expect(stmts[1].line).toBe(2);
  });
});
