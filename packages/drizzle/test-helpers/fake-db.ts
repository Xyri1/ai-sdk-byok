import { aiSdkByokKeys } from '../src/schema.js';

export interface FakeDrizzleRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  key_hint: string;
  credentials_ciphertext: string;
  credentials_nonce: string;
  encryption_key_version: string;
  created_at: string;
  updated_at: string;
}

type ColumnKey = keyof FakeDrizzleRow;
type QueryRow = Record<string, unknown>;
type SqlLike = { queryChunks?: unknown[] };
type Selection = Record<string, unknown>;

const columnNames: Record<string, ColumnKey> = {
  id: 'id',
  userId: 'user_id',
  provider: 'provider',
  label: 'label',
  keyHint: 'key_hint',
  credentialsCiphertext: 'credentials_ciphertext',
  credentialsNonce: 'credentials_nonce',
  encryptionKeyVersion: 'encryption_key_version',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function isSql(value: unknown): value is SqlLike {
  return typeof value === 'object' && value !== null && Array.isArray((value as SqlLike).queryChunks);
}

function isColumn(value: unknown): boolean {
  return Object.values(aiSdkByokKeys).some((column) => column === value);
}

function columnKey(column: unknown): string {
  const entry = Object.entries(aiSdkByokKeys).find(([, value]) => value === column);
  if (entry === undefined) {
    throw new Error('Fake Drizzle database received an unknown column');
  }
  return entry[0];
}

function rowValue(row: FakeDrizzleRow, column: unknown): unknown {
  return row[columnNames[columnKey(column)] as ColumnKey];
}

function matches(row: FakeDrizzleRow, condition: unknown): boolean {
  if (!isSql(condition)) {
    throw new Error('Fake Drizzle database received an unsupported condition');
  }

  const chunks = condition.queryChunks ?? [];
  const nested = chunks.filter(isSql);
  if (nested.length > 0) {
    return nested.every((entry) => matches(row, entry));
  }

  const column = chunks.find(isColumn);
  const parameter = chunks.find(
    (chunk): chunk is { value: unknown } =>
      typeof chunk === 'object' &&
      chunk !== null &&
      Object.prototype.hasOwnProperty.call(chunk, 'value') &&
      !Array.isArray((chunk as { value?: unknown }).value),
  );

  if (column === undefined || parameter === undefined) {
    throw new Error('Fake Drizzle database received an unsupported comparison');
  }

  return rowValue(row, column) === parameter.value;
}

function isDescending(expression: unknown): boolean {
  if (!isSql(expression)) {
    throw new Error('Fake Drizzle database received an unsupported order expression');
  }

  return (expression.queryChunks ?? []).some(
    (chunk) =>
      typeof chunk === 'object' &&
      chunk !== null &&
      Array.isArray((chunk as { value?: unknown }).value) &&
      (chunk as { value: unknown[] }).value[0] === ' desc',
  );
}

function project(row: FakeDrizzleRow, selection: Selection): QueryRow {
  return Object.fromEntries(
    Object.entries(selection).map(([key, column]) => [key, rowValue(row, column)]),
  );
}

interface Query<T> extends PromiseLike<T> {
  from(table: unknown): Query<T>;
  where(condition: unknown): Query<T>;
  orderBy(...expressions: unknown[]): Query<T>;
}

function query<T>(run: (condition: unknown, orderExpressions: unknown[]) => T): Query<T> {
  let condition: unknown;
  let orderExpressions: unknown[] = [];
  const builder: Query<T> = {
    from() {
      return builder;
    },
    where(nextCondition) {
      condition = nextCondition;
      return builder;
    },
    orderBy(...nextExpressions) {
      orderExpressions = nextExpressions;
      return builder;
    },
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve()
        .then(() => run(condition, orderExpressions))
        .then(onfulfilled, onrejected) as PromiseLike<TResult1 | TResult2>;
    },
  };
  return builder;
}

export interface FakeDrizzleDatabase {
  rows: FakeDrizzleRow[];
  error: Error | undefined;
  insert(table: unknown): {
    values(values: QueryRow): {
      onConflictDoUpdate(config: { target: unknown[]; set: QueryRow }): {
        returning(selection: Selection): PromiseLike<QueryRow[]>;
      };
      returning(selection: Selection): PromiseLike<QueryRow[]>;
    };
  };
  select(selection: Selection): Query<QueryRow[]>;
  delete(table: unknown): { where(condition: unknown): PromiseLike<void> };
}

export function createFakeDrizzle(options: { rows?: FakeDrizzleRow[]; error?: Error } = {}): FakeDrizzleDatabase {
  const database: FakeDrizzleDatabase = {
    rows: [...(options.rows ?? [])],
    error: options.error,
    insert() {
      if (database.error !== undefined) {
        throw database.error;
      }

      return {
        values(values) {
          const write = (
            selection: Selection,
            conflict?: { target: unknown[]; set: QueryRow },
          ): PromiseLike<QueryRow[]> =>
            Promise.resolve().then(() => {
              const target = conflict?.target ?? [];
              const existingIndex = database.rows.findIndex((row) =>
                target.every((column) => rowValue(row, column) === values[columnKey(column)]),
              );

              if (existingIndex === -1) {
                database.rows.push({
                  id: String(values.id),
                  user_id: String(values.userId),
                  provider: String(values.provider),
                  label: String(values.label),
                  key_hint: String(values.keyHint),
                  credentials_ciphertext: String(values.credentialsCiphertext),
                  credentials_nonce: String(values.credentialsNonce),
                  encryption_key_version: String(values.encryptionKeyVersion),
                  created_at: String(values.createdAt),
                  updated_at: String(values.updatedAt),
                });
              } else if (conflict !== undefined) {
                const row = database.rows[existingIndex];
                if (row === undefined) {
                  throw new Error('Fake Drizzle database lost its upsert row');
                }
                for (const [key, value] of Object.entries(conflict.set)) {
                  row[columnNames[key] as ColumnKey] = String(value);
                }
              }

              const row = database.rows[existingIndex === -1 ? database.rows.length - 1 : existingIndex];
              if (row === undefined) {
                throw new Error('Fake Drizzle database did not return its inserted row');
              }
              return [project(row, selection)];
            });

          const builder = {
            onConflictDoUpdate(config: { target: unknown[]; set: QueryRow }) {
              return {
                returning(selection: Selection) {
                  return write(selection, config);
                },
              };
            },
            returning(selection: Selection) {
              return write(selection);
            },
          };
          return builder;
        },
      };
    },
    select(selection) {
      if (database.error !== undefined) {
        throw database.error;
      }

      return query((condition, orderExpressions) => {
        const rows = database.rows.filter((row) => condition === undefined || matches(row, condition));
        rows.sort((left, right) => {
          for (const expression of orderExpressions) {
            const column = (isSql(expression) ? expression.queryChunks ?? [] : []).find(isColumn);
            if (column === undefined) {
              throw new Error('Fake Drizzle database received an unsupported order expression');
            }
            const leftValue = String(rowValue(left, column));
            const rightValue = String(rowValue(right, column));
            if (leftValue !== rightValue) {
              return isDescending(expression) ? (leftValue < rightValue ? 1 : -1) : leftValue < rightValue ? -1 : 1;
            }
          }
          return 0;
        });
        return rows.map((row) => project(row, selection));
      });
    },
    delete() {
      if (database.error !== undefined) {
        throw database.error;
      }

      return {
        where(condition) {
          return Promise.resolve().then(() => {
            database.rows = database.rows.filter((row) => !matches(row, condition));
          });
        },
      };
    },
  };

  return database;
}
