import type { AnyCommand } from "../registry.ts";
import auth from "./auth.ts";
import system from "./system.ts";
import users from "./users.ts";
import venice from "./venice.ts";

/** Every registered command. Add new command modules here. */
export const commands: AnyCommand[] = [...system, ...users, ...auth, ...venice];
