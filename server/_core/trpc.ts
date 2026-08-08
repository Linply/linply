import { UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { requireWorkspaceForUser, consoleScope } from "../workspace";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * The default procedure for business data. There is no administrator role: the
 * signed-in user always acts as the owner of their own workspace, and `scope`
 * is the console scope that every workspace-scoped query and mutation takes.
 */
export const workspaceProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const workspace = await requireWorkspaceForUser(ctx.user!);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user!,
        workspace,
        scope: consoleScope(workspace),
      },
    });
  })
);
