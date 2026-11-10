import Link from "next/link";
import { ICON_SIZES, buttonClass } from "./styles";

/**
 * A link that looks like <Button>. Use it for navigation (a <button> inside an
 * <a>, or a button that calls router.push, is worse for keyboards and for
 * "open in new tab").
 *
 *   <ButtonLink href="/workflow" variant="primary" iconRight={ArrowRight}>Start a workflow</ButtonLink>
 *   <ButtonLink href="/samples/sample-data.xlsx" download icon={Download}>Sample data</ButtonLink>
 *
 * Internal hrefs render next/link; `download` or `external` render a plain <a>.
 * Works in Server and Client Components.
 */
export default function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  download,
  external = false,
  className,
  children,
  ...props
}) {
  const classes = buttonClass({ variant, size, className });
  const content = (
    <>
      {Icon ? <Icon className={ICON_SIZES[size] || ICON_SIZES.md} aria-hidden="true" /> : null}
      {children}
      {IconRight ? <IconRight className={ICON_SIZES[size] || ICON_SIZES.md} aria-hidden="true" /> : null}
    </>
  );
  if (download !== undefined || external) {
    return (
      <a
        href={href}
        download={download}
        className={classes}
        {...(external ? { target: "_blank", rel: "noreferrer" } : null)}
        {...props}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {content}
    </Link>
  );
}
