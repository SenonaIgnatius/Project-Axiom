import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md">
        <div className="label-xs">error 404</div>
        <h1 className="mt-3 text-5xl">Signal not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This console route does not exist or has been retired.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background"
        >
          Return to overview
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md">
        <div className="label-xs">runtime fault</div>
        <h1 className="mt-3 text-4xl">This view failed to load</h1>
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background"
          >
            Retry
          </button>
          <a
            href="/"
            className="border border-border px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Overview
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Project Sentinel — Infrastructure Risk Console" },
        {
          name: "description",
          content:
            "Monitoring console for government infrastructure projects: reported vs independently verified progress, with ML risk scoring.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
        },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "icon", href: "/favicon.png", type: "image/png" },
        { rel: "alternate icon", href: "/favicon.ico" },
        { rel: "apple-touch-icon", href: "/favicon.png" },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/projects", label: "Case Studies" },
  { to: "/report", label: "All Projects" },
  { to: "/analytics", label: "Analytics" },
  { to: "/data-quality", label: "Report Audit" },
  { to: "/provenance", label: "Provenance" },
] as const;

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-stretch justify-between px-6">
            <Link to="/" className="flex items-center gap-3 py-4">
              <span className="flex h-7 w-7 items-center justify-center border border-foreground font-mono text-[11px] font-bold">
                PS
              </span>
              <span className="font-display text-sm font-extrabold uppercase tracking-[0.22em]">
                Project Sentinel
              </span>
            </Link>
            <nav className="flex items-stretch">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  activeOptions={{ exact: n.to === "/" }}
                  className="flex items-center border-l border-border px-5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "!text-foreground bg-surface" }}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main>
          {/* Required: nested routes render here. */}
          <Outlet />
        </main>

        <footer className="mt-24 border-t border-border">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="label-xs">
              Project Sentinel — infrastructure risk console · Smart India
              Hackathon · reported figures: MoSPI PAIMANA flash report, Dec 2025
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em]">
              Built by Team Nyx
            </div>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  );
}
