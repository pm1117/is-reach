// データアクセス層（design-detail 6.1 — 決定 E14 のアプリ側）。
//
// 規約（このモジュールが構造的に強制する）:
// 1. テナント文脈のクエリは必ずトランザクションで包み、先頭で
//    set_config('app.tenant_id', $1, /* is_local = */ true) を実行する（SET LOCAL 相当）。
//    RLS ポリシーは current_setting('app.tenant_id', true) を参照し、未設定なら
//    fail-closed（全行不可）。is_local = true のためトランザクションモードの
//    接続プーリングでも他リクエストへ漏れない。
// 2. 生の Pool / PoolClient をハンドラへ露出しない。ハンドラが触れるのは
//    withTenantContext() が渡す TenantQuerier のみ。
// 3. 接続ロールは app_user（BYPASSRLS なし）。監査ログ書き込みも同経路
//    （INSERT のみ可能なことは DB 権限で担保済み — 20260714000400）。
// 4. バッチ・共有資産書き込みは app_batch ロールの BatchDb に分離する
//    （テナント資産の業務クエリには使わない。第 2 段の収集バッチで使用）。
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { uuidSchema } from "@is-reach/shared";

/** トランザクション内でのみ有効なクエリ実行器（トランザクション外へ持ち出さないこと） */
export interface TenantQuerier {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface TenantDb {
  /**
   * テナントコンテキスト付きトランザクションで fn を実行する。
   * fn が正常終了すれば commit、throw すれば rollback して例外を再送出する。
   */
  withTenantContext<T>(tenantId: string, fn: (tx: TenantQuerier) => Promise<T>): Promise<T>;
  /** 全接続を解放する（シャットダウン時） */
  end(): Promise<void>;
}

/** テスト注入用の最小プール型（pg の Pool はこれを構造的に満たす） */
export interface MinimalPoolClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void;
}
export interface MinimalPool {
  connect(): Promise<MinimalPoolClient>;
  end(): Promise<void>;
}

class PgTenantDb implements TenantDb {
  readonly #pool: MinimalPool;

  constructor(pool: MinimalPool) {
    this.#pool = pool;
  }

  async withTenantContext<T>(tenantId: string, fn: (tx: TenantQuerier) => Promise<T>): Promise<T> {
    // tenantId は JWT 由来（信頼境界外の入力起点）のため、接続確保前に UUID を強制する。
    // set_config へは $1 プレースホルダで渡すので SQL 注入はないが、不正値で
    // RLS キャストエラーになる前に入力側で落とす（防御の二重化）。
    const parsedTenantId = uuidSchema.parse(tenantId);

    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query("begin");
      try {
        await client.query("select set_config('app.tenant_id', $1, true)", [parsedTenantId]);
        const tx: TenantQuerier = {
          query: async <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
            const result = await client.query(text, values === undefined ? undefined : [...values]);
            return result as QueryResult<R>;
          },
        };
        const result = await fn(tx);
        await client.query("commit");
        return result;
      } catch (error) {
        try {
          await client.query("rollback");
        } catch {
          // rollback も失敗 = 接続が壊れている。プールへ戻さず破棄する
          broken = true;
        }
        throw error;
      }
    } finally {
      client.release(broken);
    }
  }

  async end(): Promise<void> {
    await this.#pool.end();
  }
}

export interface PoolOptions {
  connectionString: string;
  /** プール最大接続数（既定 10） */
  max?: number;
}

/** app_user ロール接続の TenantDb を作る（本番経路） */
export function createTenantDb(options: PoolOptions): TenantDb {
  return createTenantDbFromPool(
    new Pool({ connectionString: options.connectionString, max: options.max ?? 10 }),
  );
}

/** プール注入版（テスト用。規約 — トランザクション + set_config — の検証に使う） */
export function createTenantDbFromPool(pool: MinimalPool): TenantDb {
  return new PgTenantDb(pool);
}

/**
 * バッチ・共有資産書き込み用の接続（DB ロール app_batch — design-detail 6.1）。
 * companies / signals への書き込みと運用系処理のみに使う。テナント資産の業務クエリには
 * 使わないこと（RLS のテナントコンテキスト経路は必ず TenantDb を通す）。
 * 実際の利用（シグナル収集バッチ）は第 2 段。本段では接続ファクトリのみ提供する。
 */
export interface BatchDb {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

export function createBatchDb(options: PoolOptions): BatchDb {
  const pool = new Pool({ connectionString: options.connectionString, max: options.max ?? 5 });
  return {
    query: async <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
      const result = await pool.query(text, values === undefined ? undefined : [...values]);
      return result as QueryResult<R>;
    },
    end: () => pool.end(),
  };
}
