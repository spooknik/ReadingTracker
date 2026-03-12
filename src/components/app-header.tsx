import Link from "next/link";

export function AppHeader() {
  return (
    <Link href="/" className="flex items-center gap-3 py-3 select-none">
      <pre
        className="text-primary leading-none text-[10px]"
        aria-hidden="true"
        style={{ fontFamily: "var(--font-geist-mono), monospace" }}
      >{`  /\\_/\\
 ( o.o )
  > ^ <
 /|   |\\
(_|   |_)`}</pre>
      <div>
        <h1 className="text-lg font-bold leading-tight tracking-tight">
          ReadingTracker
        </h1>
        <p className="text-[11px] text-muted leading-tight">
          Track manga with friends
        </p>
      </div>
    </Link>
  );
}
