/** Drawing-tool icons from the NextDraw Figma file (Frame 6), drawn on a 16 × 16 grid with 1px lines
 *  and shown at 24 like the lucide icons beside them. */

/** A line between two end points. */
export function LineIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M12.8343 2.93624L2.88613 12.8844" />
      <circle cx="2" cy="14" r="1.5" />
      <circle cx="14" cy="2" r="1.5" />
    </svg>
  );
}

/** A square with a point at each corner. */
export function RectangleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M12.3737 14L3.62626 14M12.3737 2L3.62626 2M1.98862 12.2989L1.98863 3.49815M14 12.2989L14 3.49815" />
      <circle cx="2" cy="14" r="1.5" />
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="14" cy="2" r="1.5" />
      <circle cx="14" cy="14" r="1.5" />
    </svg>
  );
}

/** A circle with a point at each quarter. */
export function EllipseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <circle cx="2" cy="8" r="1.5" />
      <circle cx="8" cy="2" r="1.5" />
      <circle cx="14" cy="8" r="1.5" />
      <circle cx="8" cy="14" r="1.5" />
      <path d="M9.47556 2.18279C11.6014 2.72037 13.2754 4.39266 13.8155 6.51756M13.8155 9.48244C13.2789 11.5936 11.623 13.258 9.51674 13.8066M6.52444 13.8172C4.40149 13.2804 2.72916 11.6119 2.18677 9.49121M2.18677 6.50879C2.72916 4.38806 4.40149 2.71963 6.52444 2.18279" />
    </svg>
  );
}

/** Six 2 × 7 ovals turned 30° apart about the middle. */
export function SpirographIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {[0, -30, -60, -90, -120, -150].map((a) => (
        <ellipse key={a} cx="8" cy="8" rx="2" ry="7" transform={`rotate(${a} 8 8)`} />
      ))}
    </svg>
  );
}

/** The TC mark: a T inside an open C. */
export function SignatureIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0.5C11.5216 0.5 14.4763 2.92723 15.2825 6.2H13.9603C13.1882 3.63973 10.8121 1.775 8 1.775C4.56203 1.775 1.775 4.56203 1.775 8C1.775 11.438 4.56203 14.225 8 14.225C10.8121 14.225 13.1882 12.3603 13.9603 9.8H15.2825C14.4763 13.0728 11.5216 15.5 8 15.5C3.85786 15.5 0.5 12.1421 0.5 8C0.5 3.85786 3.85786 0.5 8 0.5Z" />
      <path d="M11.7903 5.6375H8.64878V13.0153H7.37378V5.6375H4.25645V4.3625H11.7903V5.6375Z" />
    </svg>
  );
}

export function SpiralIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.4 7.22222C9.4 7.63478 9.2525 8.03044 8.98995 8.32217C8.7274 8.61389 8.37131 8.77778 8 8.77778C7.6287 8.77778 7.27261 8.61389 7.01006 8.32217C6.74751 8.03044 6.60001 7.63478 6.60001 7.22222C6.60001 6.3971 6.895 5.60578 7.42011 5.02233C7.94521 4.43889 8.6574 4.11111 9.4 4.11111C10.1426 4.11111 10.8548 4.43889 11.3799 5.02233C11.905 5.60578 12.2 6.3971 12.2 7.22222C12.2 8.4599 11.7575 9.64688 10.9699 10.5221C10.1822 11.3972 9.11391 11.8889 8 11.8889C6.8861 11.8889 5.81781 11.3972 5.03016 10.5221C4.24251 9.64688 3.80001 8.4599 3.80001 7.22222C3.80001 5.57199 4.39 3.98934 5.44021 2.82245C6.49041 1.65555 7.91479 1 9.4 1C10.8852 1 12.3096 1.65555 13.3598 2.82245C14.41 3.98934 15 5.57199 15 7.22222C15 9.28502 14.2625 11.2633 12.9497 12.7219C11.637 14.1806 9.85652 15 8 15C6.14349 15 4.36301 14.1806 3.05026 12.7219C1.73751 11.2633 1.00001 9.28502 1.00001 7.22222C0.997428 5.19502 1.59242 3.22265 2.69401 1.60667" />
    </svg>
  );
}

export function WaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.33333 8.66667C1.68695 8.66667 2.02609 8.52619 2.27614 8.27614C2.52619 8.0261 2.66666 7.68696 2.66666 7.33334V4.66667C2.66666 4.31305 2.80714 3.97391 3.05719 3.72386C3.30723 3.47381 3.64637 3.33334 3.99999 3.33334C4.35362 3.33334 4.69276 3.47381 4.9428 3.72386C5.19285 3.97391 5.33333 4.31305 5.33333 4.66667V11.3333C5.33333 11.687 5.4738 12.0261 5.72385 12.2761C5.9739 12.5262 6.31304 12.6667 6.66666 12.6667C7.02028 12.6667 7.35942 12.5262 7.60947 12.2761C7.85952 12.0261 8 11.687 8 11.3333V4.66667C8 4.31305 8.14047 3.97391 8.39052 3.72386C8.64057 3.47381 8.97971 3.33334 9.33333 3.33334C9.68695 3.33334 10.0261 3.47381 10.2761 3.72386C10.5262 3.97391 10.6667 4.31305 10.6667 4.66667V11.3333C10.6667 11.687 10.8071 12.0261 11.0572 12.2761C11.3072 12.5262 11.6464 12.6667 12 12.6667C12.3536 12.6667 12.6928 12.5262 12.9428 12.2761C13.1929 12.0261 13.3333 11.687 13.3333 11.3333V8.66667C13.3333 8.31305 13.4738 7.97391 13.7239 7.72386C13.9739 7.47381 14.313 7.33334 14.6667 7.33334" />
    </svg>
  );
}
