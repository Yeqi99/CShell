export const databaseRecipes = {
  mysql: { name: 'MySQL 8.4', port: 3306, repository: 'library/mysql', digest: 'sha256:a81d043930e51745522bd5c430961cf8286f0a23f0a9a2a6e0108f7ea71b0902' },
  redis: { name: 'Redis 7.4', port: 6379, repository: 'library/redis', digest: 'sha256:2e3eb11462c4e3759e6972678dd051d150ff54b1e60714b3c33b701260172a90' },
  milvus: { name: 'Milvus 2.6.4', port: 19530, repository: 'milvusdb/milvus', digest: 'sha256:27f1732a6668c813ee96d21364e3ba220ce1dd1d6e07660106d646dc33d1c654' },
} as const;
export type DatabaseApp = keyof typeof databaseRecipes;
export function isDatabaseApp(app: string): app is DatabaseApp {
  return Object.hasOwn(databaseRecipes, app);
}
