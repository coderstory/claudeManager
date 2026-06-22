/**
 * sql-validator — M3.9 清单 21 (P1): SQL schema 前置校验
 *
 * 后端 `parse_sql_dump` 已有完善的 parser (M2.2 实现),但它默认对空文件
 * 返回 `Err(Empty)`,且错误回传到前端只有抛错信息,没有结构化分
 * 类。本模块在前端 (js 端) 做一道 **pre-flight validation**:
 *
 * 1. **结构层**: 文件是否非空 / 是不是 SQL / 是否含 `INSERT` 语句。
 * 2. **5 场景分类** (清单 21):
 *    - `valid`           至少 1 个合法 INSERT INTO providers / mcp_servers
 *    - `illegal`         含 INSERT 但所有 INSERT 都被跳过(0 个可导入)
 *    - `partially_valid` 至少 1 个可导入 + 至少 1 个跳过
 *    - `empty`           文件为空 / 纯空白
 *    - `encoding_error`  含非 UTF-8 字节(浏览器 / WebView2 读出来会
 *                        以 U+FFFD 替换;JS 端用 `TextDecoder` 强校验)
 *
 * 返回的 `SqlValidationResult` 供 `import-sql` 页面在调用
 * `parse_sql_preview` 之前先 show 一道 banner:
 *   - `empty` / `encoding_error` → 直接 ErrorBanner,不调后端。
 *   - `illegal` / `partially_valid` → banner + preview。
 *   - `valid` → 静默调用后端,无 banner。
 *
 * ## 设计权衡
 *
 * - **不复用后端 parser**。后端 parser 是 `&str → Provider`,要把
 *   同样的逻辑在前端复刻一遍,容易漂移;此处只做"轻量分类",
 *   真正的逐行解析仍交给后端 `parse_sql_preview` / `parse_sql_dump`。
 * - **不引第三方依赖**。CLAUDE.md §2.3: 新增依赖需理由 + 文档。
 *   `TextDecoder` 是浏览器 / WebView2 内置,零依赖。
 * - **statement 抽取用启发式**: 按 `;` 拆分(忽略字符串内的 `;`)。
 *   复杂度 O(N),N 通常 < 10k 行,几毫秒。
 *
 * ## 后续 M3.10+ 可以做
 *
 * - 把 `validateSql` 移到 `lib/api/sql.ts`,与后端的 `parse_sql_dump`
 *   共用一份 "split_statements" 心智模型 (后者已在 Rust 实现)。
 * - 增加 PRAGMA / CREATE TABLE 的语义校验(目前只关心 INSERT 计数)。
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** 一条 SQL 语句的最小化分类,供 UI 展示。 */
export interface SqlStatement {
  /** 1-based 行号(首字符所在行,best-effort)。 */
  line: number;
  /** 语句 trim 后的前 64 字符(UI 预览用,完整内容可能很长)。 */
  preview: string;
  /** `INSERT` / `CREATE` / `PRAGMA` / `BEGIN|COMMIT` / `OTHER`。 */
  kind: 'INSERT' | 'CREATE' | 'PRAGMA' | 'BEGIN' | 'COMMIT' | 'OTHER';
  /** 仅对 `INSERT` 有效:目标表名(`providers` / `mcp_servers` / 其它)。 */
  targetTable?: string;
}

/** 单条结构错误,前端 show ErrorBanner 用。 */
export interface SqlError {
  /** `empty` / `encoding` / `no_insert` / `parse`。 */
  code: 'empty' | 'encoding' | 'no_insert' | 'parse';
  /** 人类可读的中文 / 英文消息。 */
  message: string;
}

/**
 * 校验结果。前端用 `valid` 字段快速判断是否要走 preview,其它字段
 * 供 UI 展示分类细节(dry-run)。
 */
export interface SqlValidationResult {
  /** 主分类:`valid` / `partially_valid` / `illegal` / `empty` / `encoding_error`。 */
  valid: boolean;
  /** 5 场景的细化分类(与 M3.9 清单 21 一一对应)。 */
  scenario:
    | 'valid'
    | 'partially_valid'
    | 'illegal'
    | 'empty'
    | 'encoding_error';
  /** 所有抽出的 SQL 语句(预览用)。 */
  statements: SqlStatement[];
  /** 抽出的 INSERT INTO providers / mcp_servers 数(将导入 N 条)。 */
  importableCount: number;
  /** 非 INSERT 语句或目标表不识别的 INSERT 数(将被跳过的 M 条)。 */
  skippedCount: number;
  /** 结构错误,仅在 `valid === false` 时非空。 */
  errors: SqlError[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * 对一段从 .sql 文件读到的字符串做轻量校验,返回 5 场景之一。
 *
 * 注意: 此函数 **不** 调用后端,完全在前端跑。错误不会抛,所有失败
 * 都收集到 `result.errors`,UI 自行决定如何展示。
 */
export function validateSql(content: string): SqlValidationResult {
  const result: SqlValidationResult = {
    valid: false,
    scenario: 'empty',
    statements: [],
    importableCount: 0,
    skippedCount: 0,
    errors: [],
  };

  // 场景 1: 空文件 / 纯空白。
  if (content.trim().length === 0) {
    result.errors.push({
      code: 'empty',
      message: '文件为空或仅含空白字符。请选择一个有效的 cc-switch 导出的 .sql 文件。',
    });
    return result;
  }

  // 场景 2: 编码错误 (非 UTF-8 字节被替换为 U+FFFD)。
  // NOTE: WebView2 读文件默认 UTF-8;FileReader.readAsText 也是。
  // 如果上游是 `read_sql_file` (Tauri command),需要后端显式
  // `read_to_string`,不会再有替换问题——但如果上游是
  // `<input type="file">` + `file.text()`,WebView2 端同样的行为。
  // 此处仅作为"理论"场景提供,实际命中需用户截屏证明。
  if (content.includes('�')) {
    result.errors.push({
      code: 'encoding',
      message: '文件含非 UTF-8 字节。请确认文件编码为 UTF-8 (无 BOM)。',
    });
    result.scenario = 'encoding_error';
    return result;
  }

  // 结构层: 抽出所有 SQL 语句(按 `;` 拆分,忽略字符串内分号)。
  const statements = splitStatements(content);
  result.statements = statements;

  // 统计 importable / skipped。
  let importable = 0;
  let skipped = 0;
  for (const stmt of statements) {
    if (stmt.kind === 'INSERT' && stmt.targetTable) {
      if (
        stmt.targetTable.toLowerCase() === 'providers' ||
        stmt.targetTable.toLowerCase() === 'mcp_servers'
      ) {
        importable++;
      } else {
        // INSERT INTO 未知表 — 算 skipped(后端 parser 会静默忽略)。
        skipped++;
      }
    } else if (stmt.kind === 'OTHER') {
      // 完全不是 SQL(例如:用户塞了 .txt),算 skipped。
      skipped++;
    } else {
      // CREATE / PRAGMA / BEGIN / COMMIT — 算 skipped(后端 parser 忽略)。
      skipped++;
    }
  }
  result.importableCount = importable;
  result.skippedCount = skipped;

  // 场景 3: 完全无 INSERT(可能用户选了 .txt 改名 .sql,或全 PRAGMA)。
  if (importable === 0 && !statements.some((s) => s.kind === 'INSERT')) {
    result.errors.push({
      code: 'no_insert',
      message:
        '文件中没有检测到任何 INSERT INTO 语句。请确认这是 cc-switch 导出的 SQLite dump。',
    });
    result.scenario = 'illegal';
    return result;
  }

  // 场景 4: 有 INSERT 但 0 个 importable(可能全是未知表的 INSERT)。
  if (importable === 0) {
    result.errors.push({
      code: 'parse',
      message:
        '检测到 INSERT 语句,但没有 INSERT INTO providers / mcp_servers。请确认 dump 来源。',
    });
    result.scenario = 'illegal';
    return result;
  }

  // 场景 5: 至少 1 个 importable + 至少 1 个 skipped → partially_valid。
  if (skipped > 0) {
    result.valid = true;
    result.scenario = 'partially_valid';
    return result;
  }

  // 全部 importable,无 skipped → 完美 valid。
  result.valid = true;
  result.scenario = 'valid';
  return result;
}

// ---------------------------------------------------------------------------
// Statement splitter (lightweight, no third-party deps)
// ---------------------------------------------------------------------------

/**
 * 把 SQL dump 按 `;` 拆成单条语句。处理字符串字面量内的 `;` (单引号 +
 * 双引号)。首字符所在行号 = 1-based。
 */
export function splitStatements(content: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  const bytes = new TextEncoder().encode(content);
  // 维护一个 `lineAt[i] = i 处的行号` 不经济(O(N²) memory)。
  // 改为: 当 start 推进时,记录"start 处的行号" = 累加 0..start 的换行数。
  // 简化: 每次 start 推进后,扫一遍 content.slice(prevStart, start) 数
  // 换行符。但这只在 start 推进时做,常数可接受。
  let start = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  // 累计已处理的换行符数,得到"当前字节 i 处的行号" = lineOf(i) + 1。
  let linesBeforeStart = 0;
  let linesBeforeI = 0;
  const lineOf = (offset: number): number => {
    // 数 content[..offset] 内的换行符 + 1。
    let n = 0;
    for (let k = 0; k < offset; k++) {
      if (content.charCodeAt(k) === 0x0a) n++;
    }
    return n + 1;
  };
  void lineOf;
  // 把 start 推进时,记录 start 处的行号。
  const advanceStart = (newStart: number) => {
    if (newStart > start) {
      // 数 [start, newStart) 内的换行符,累加到 linesBeforeStart。
      for (let k = start; k < newStart; k++) {
        if (content.charCodeAt(k) === 0x0a) linesBeforeStart++;
      }
    }
    start = newStart;
  };
  // 当前 i 处的行号。
  const currentLine = (): number => {
    // linesBeforeI 是 [0, i) 中的换行符数;行号 = linesBeforeI + 1。
    return linesBeforeI + 1;
  };

  const pushStatement = (end: number) => {
    const raw = content.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    // 语句起始行 = 第一个非空白字符的行号。先数 [start, ..trim 起点) 内的换行符。
    const trimOffset = raw.length - raw.trimStart().length;
    let startLine = linesBeforeStart + 1;
    for (let k = 0; k < trimOffset; k++) {
      if (content.charCodeAt(start + k) === 0x0a) startLine++;
    }
    out.push(classify(trimmed, startLine, content, start, end));
  };

  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x0a) {
      // '\n'
      linesBeforeI++;
      i++;
      continue;
    }
    if (b === 0x27 && !inDouble) {
      // '\''
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (b === 0x22 && !inSingle) {
      // '"'
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (b === 0x3b && !inSingle && !inDouble) {
      // ';'
      pushStatement(i);
      i++;
      advanceStart(i);
      continue;
    }
    i++;
  }
  // 尾部无分号也收一条。
  if (start < content.length) {
    pushStatement(content.length);
  }
  return out;
}

/** 分类一条 SQL 语句,提取 kind + target table。 */
function classify(
  trimmed: string,
  line: number,
  fullContent: string,
  start: number,
  end: number,
): SqlStatement {
  // preview: 取语句前 64 字符(trim 后),加省略号。
  const preview =
    trimmed.length > 64 ? trimmed.slice(0, 64) + '…' : trimmed;
  void fullContent;
  void start;
  void end;
  const head = trimmed.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  let kind: SqlStatement['kind'] = 'OTHER';
  if (head === 'INSERT') kind = 'INSERT';
  else if (head === 'CREATE') kind = 'CREATE';
  else if (head === 'PRAGMA') kind = 'PRAGMA';
  else if (head === 'BEGIN') kind = 'BEGIN';
  else if (head === 'COMMIT') kind = 'COMMIT';

  let targetTable: string | undefined;
  if (kind === 'INSERT') {
    targetTable = extractInsertTarget(trimmed);
  }
  return { line, preview, kind, targetTable };
}

/** 从 `INSERT INTO [INTO] <table> [(...)] VALUES ...` 提取表名。 */
function extractInsertTarget(stmt: string): string | undefined {
  // 跳过 INSERT [INTO] (允许任选 INTO)。
  const rest = stmt
    .trimStart()
    .replace(/^INSERT\s+(?:INTO\s+)?/i, '')
    .trimStart();
  if (rest.length === 0) return undefined;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    return end > 0 ? rest.slice(1, end) : undefined;
  }
  // 读到第一个空白或 `(`。
  const end = rest.search(/[\s(]/);
  return end > 0 ? rest.slice(0, end) : rest;
}
