import Link from "next/link";

const FB = process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK_URL?.trim() || "https://www.facebook.com";
const IG = process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL?.trim() || "https://www.instagram.com";

function IconFacebook({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078V9.218h3.047V7.607c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function IconInstagram({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

type SocialLinksProps = {
  className?: string;
  iconClassName?: string;
};

export function SocialLinks({ className, iconClassName = "h-5 w-5" }: SocialLinksProps) {
  return (
    <div className={className}>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        Ikuti kami
      </p>
      <div className="flex items-center gap-3">
        <Link
          href={FB}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-edge bg-surface p-2 text-[#1877F2] shadow-sm transition hover:bg-subtle"
          aria-label="Facebook"
        >
          <IconFacebook className={iconClassName} />
        </Link>
        <Link
          href={IG}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-edge bg-surface p-2 text-[#E4405F] shadow-sm transition hover:bg-subtle"
          aria-label="Instagram"
        >
          <IconInstagram className={iconClassName} />
        </Link>
      </div>
    </div>
  );
}
