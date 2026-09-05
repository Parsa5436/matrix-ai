import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { PrismaClient } from "./generated/client";

// One client per process. Next's dev server re-evaluates modules on every edit, so
// without the global the pool grows until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
	});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
