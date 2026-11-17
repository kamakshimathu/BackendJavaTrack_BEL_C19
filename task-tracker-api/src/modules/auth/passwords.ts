import { randomBytes } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';

// Algorithm 2 is Argon2id. A literal avoids the library's ambient const enum
// incompatibility with TypeScript's verbatimModuleSyntax setting.
const options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } satisfies Options;
const dummyHash = await hash(randomBytes(32), options);

export const hashPassword = (password: string): Promise<string> => hash(password, options);
export const verifyPassword = (password: string, passwordHash?: string): Promise<boolean> =>
  verify(passwordHash ?? dummyHash, password);
