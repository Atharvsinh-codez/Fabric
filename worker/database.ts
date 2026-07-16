import postgres from "postgres";

export type WorkerSql = postgres.Sql;
export type WorkerTransaction = postgres.TransactionSql;

export function createWorkerDatabase(databaseUrl: string, maxConnections = 4): WorkerSql {
  return postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
}
