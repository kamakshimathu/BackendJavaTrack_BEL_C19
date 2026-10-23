import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation needs no database. Database commands fail if the URL is absent.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
