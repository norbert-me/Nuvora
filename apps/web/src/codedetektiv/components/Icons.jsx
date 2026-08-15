// Icons des Code-Detektivs — so wenig eigene wie moeglich.
//
// Die Design-Quelle ist `apps/web/src/components/Icons.jsx`; hier steht nur
// noch die Uebersetzung der alten Namen (IconSearch, IconBack, …) auf die
// gemeinsamen Pfade. Zwei Dinge sind dabei wichtig:
//
//   * `color="currentColor"` als Vorgabe — die Shell faerbt Icons mit
//     var(--text3), im Code-Detektiv sitzen sie aber auch auf farbigem Grund
//     (weisse Schrift auf Verlauf). Die Farbe kommt weiter vom Text.
//   * Eigene Pfade gibt es hier keine mehr — die neun, die nur der
//     Code-Detektiv brauchte (puzzle, map, gamepad, trophy, star, party,
//     hourglass, undo, checkCircle), stehen jetzt in der gemeinsamen Tabelle.
import { Icon, ICONS } from "../../components/Icons.jsx";


// currentColor beibehalten: sonst faerbt die Shell die Icons dunkel, auch dort,
// wo sie auf dem Farbverlauf der Startseite sitzen.
function CdIcon({ d, size, color = "currentColor", ...rest }) {
  return <Icon d={d} size={size} color={color} {...rest} />;
}

// ── aus der gemeinsamen Quelle ──────────────────────────────────────────────
export const IconSearch = ({ size = 20, ...p }) => <CdIcon d={ICONS.search} size={size} {...p} />;
export const IconBulb = ({ size = 18, color = "#f9a825", ...p }) => <CdIcon d={ICONS.bulb} size={size} color={color} {...p} />;
export const IconCheck = ({ size = 18, ...p }) => <CdIcon d={ICONS.check} size={size} {...p} />;
export const IconX = ({ size = 18, ...p }) => <CdIcon d={ICONS.close} size={size} {...p} />;
export const IconClock = ({ size = 16, ...p }) => <CdIcon d={ICONS.clock} size={size} {...p} />;
export const IconPlay = ({ size = 16, ...p }) => <CdIcon d={ICONS.play} size={size} {...p} />;
export const IconReset = ({ size = 16, ...p }) => <CdIcon d={ICONS.refresh} size={size} {...p} />;
export const IconBack = ({ size = 16, ...p }) => <CdIcon d={ICONS.arrowLeft} size={size} {...p} />;
export const IconChevronLeft = ({ size = 16, ...p }) => <CdIcon d={ICONS.chevronLeft} size={size} {...p} />;
export const IconChevronRight = ({ size = 16, ...p }) => <CdIcon d={ICONS.chevronRight} size={size} {...p} />;
export const IconChevronDown = ({ size = 12, ...p }) => <CdIcon d={ICONS.chevronDown} size={size} {...p} />;

// ── ebenfalls aus der gemeinsamen Quelle (frueher hier gezeichnet) ──────────
export const IconPuzzle = ({ size = 24, ...p }) => <CdIcon d={ICONS.puzzle} size={size} {...p} />;
export const IconMap = ({ size = 24, ...p }) => <CdIcon d={ICONS.map} size={size} {...p} />;
export const IconGamepad = ({ size = 20, ...p }) => <CdIcon d={ICONS.gamepad} size={size} {...p} />;
export const IconTrophy = ({ size = 48, color = "#f9a825", ...p }) => <CdIcon d={ICONS.trophy} size={size} color={color} {...p} />;
export const IconStar = ({ size = 14, color = "#f9a825", ...p }) => <CdIcon d={ICONS.star} size={size} color={color} {...p} />;
export const IconParty = ({ size = 24, color = "#4caf50", ...p }) => <CdIcon d={ICONS.party} size={size} color={color} {...p} />;
export const IconHourglass = ({ size = 18, ...p }) => <CdIcon d={ICONS.hourglass} size={size} {...p} />;
export const IconUndo = ({ size = 14, ...p }) => <CdIcon d={ICONS.undo} size={size} {...p} />;
export const IconCheckCircle = ({ size = 18, color = "#4caf50", ...p }) => <CdIcon d={ICONS.checkCircle} size={size} color={color} {...p} />;
