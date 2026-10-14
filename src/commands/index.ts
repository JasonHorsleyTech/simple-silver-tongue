import type { AnyCommand } from "../registry.ts";
import auth from "./auth.ts";
import brains from "./brains.ts";
import campaigns from "./campaigns.ts";
import chat from "./chat.ts";
import conversations from "./conversations.ts";
import images from "./images.ts";
import messages from "./messages.ts";
import setup from "./setup.ts";
import system from "./system.ts";
import users from "./users.ts";
import venice from "./venice.ts";

/** Every registered command. Add new command modules here. */
export const commands: AnyCommand[] = [...system, ...users, ...auth, ...venice, ...conversations, ...campaigns, ...setup, ...brains, ...messages, ...chat, ...images];
