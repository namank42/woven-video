import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-10 text-center md:flex-row md:justify-between md:text-left">
        <div className="flex items-center gap-3">
          <Image
            src="/woven-logo.png"
            alt="Woven"
            width={100}
            height={28}
            className="h-5 w-auto"
          />
          <span className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Woven Labs. All rights reserved.
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/compare" className="hover:text-foreground">
            Compare
          </Link>
          <Link href="/for" className="hover:text-foreground">
            Use cases
          </Link>
          <Link href="/ai-video-editor-mac" className="hover:text-foreground">
            Mac editor
          </Link>
          <Link href="/guide" className="hover:text-foreground">
            Product guide
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            SFX docs
          </Link>
          <Link href="/changelog" className="hover:text-foreground">
            Changelog
          </Link>
          {/* The external SFX app needs a full document navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/sfx" className="hover:text-foreground">
            Woven SFX
          </a>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            Contact
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a
            href="mailto:hello@woven.video"
            className="hover:text-foreground"
          >
            hello@woven.video
          </a>
        </div>
      </div>
    </footer>
  );
}
