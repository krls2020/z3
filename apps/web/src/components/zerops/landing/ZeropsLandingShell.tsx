import type { ReactNode } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { APP_DISPLAY_NAME } from "~/branding";

const DEFAULT_CARD_CLASS_NAME =
  "w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5";

/**
 * Page chrome for the hosted-static Zerops landing states (sign-in, and the
 * "not exactly one connected project" picker). Mirrors the generic
 * onboarding card this replaces in `routes/_chat.index.tsx` so the visual
 * language stays consistent with the non-Zerops empty state it sits next to.
 */
export function ZeropsLandingShell({
  icon,
  title,
  description,
  cardClassName = DEFAULT_CARD_CLASS_NAME,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly cardClassName?: string;
  readonly children?: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className={cardClassName}>
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                {icon}
              </div>
              <EmptyTitle className="text-foreground text-xl">{title}</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                {description}
              </EmptyDescription>
            </EmptyHeader>
            {children ? <div className="mt-6 flex flex-col gap-4 text-left">{children}</div> : null}
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
