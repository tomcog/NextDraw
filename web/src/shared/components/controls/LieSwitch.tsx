import { Segment, SegmentedControl } from "@tomcoggia/ui";

/** The paper-orientation icons from the NextDraw Figma file (Frame 5): a page with its
 *  corner folded at the top right, standing up or lying on its side. */
export function SheetIcon({ wide = false }: { wide?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {wide ? (
        <>
          <path d="M1 12.7V3C1 2.7239 1.2239 2.5 1.5 2.5H10.6535C10.919 2.5 11.1735 2.6056 11.3611 2.7934L14.7076 6.1449C14.8948 6.3324 15 6.5865 15 6.8515V12.7C15 12.9762 14.7761 13.2 14.4999 13.2H1.5001C1.2239 13.2 1 12.9762 1 12.7Z" />
          <path d="M10.7633 2.7253V6.25C10.7633 6.5261 10.8839 6.6536 11.16 6.6536H14.7392" />
        </>
      ) : (
        <>
          <path d="M3.3 15H13C13.2761 15 13.5 14.7761 13.5 14.5V5.3465C13.5 5.081 13.3944 4.8265 13.2066 4.6389L9.8551 1.2924C9.6676 1.1052 9.4135 1 9.1485 1H3.3C3.0239 1 2.8 1.2239 2.8 1.5001V14.4999C2.8 14.7761 3.0239 15 3.3 15Z" />
          <path d="M13.2747 5.2367H9.75C9.4738 5.2367 9.3464 5.1162 9.3464 4.84V1.2608" />
        </>
      )}
    </svg>
  );
}

/**
 * Shared: which way a sheet lies, landscape or portrait - the Paper card's control, and the
 * Artboard card's.
 *
 * It lies one way or the other, never both: a choice of two, like the toolbar's. A square lies
 * neither way, so neither is chosen. All it ever does is swap the width and the height of the thing
 * it names - the paper as it sits on the plotter, or the artboard - and never turns the drawing;
 * that is the Drawing transform's turn buttons, which never touch the paper.
 */
export function LieSwitch({ w, h, what, disabled, onSwap }: {
  /** The thing's width and height, in whatever unit, as it lies. */
  w: number;
  h: number;
  /** What is being turned, for the labels: "paper", "artboard". */
  what: string;
  disabled?: boolean;
  /** Called when the other way is chosen: the width and height change places. */
  onSwap: () => void;
}) {
  const landscape = w >= h;
  return (
    <SegmentedControl size="sm" variant="dark" aria-label={`Which way the ${what} lies`}>
      {[
        { wide: true, icon: <SheetIcon wide />, label: "Landscape", hint: `Landscape: the ${what} lies on its side` },
        { wide: false, icon: <SheetIcon />, label: "Portrait", hint: `Portrait: the ${what} stands up` },
      ].map(({ wide, icon, label, hint }) => {
        const on = landscape === wide && w !== h;
        return (
          <Segment
            key={label}
            selected={on}
            icon={icon}
            aria-label={label}
            title={hint}
            disabled={disabled}
            onClick={() => {
              if (!on) onSwap(); // already lying that way otherwise
            }}
          />
        );
      })}
    </SegmentedControl>
  );
}
