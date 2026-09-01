import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type Task = FunctionReturnType<typeof api.tasks.list>[number];
export type Estate = NonNullable<FunctionReturnType<typeof api.estates.get>>;
export type ThreadMessage = FunctionReturnType<typeof api.tasks.thread>[number];
export type DocumentRow = FunctionReturnType<typeof api.estates.documents>[number];
