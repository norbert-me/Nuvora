// Basis-Pfad der Code-Detektiv-App. Eingeloggt läuft sie unter /code-detektiv,
// die öffentliche Spiel-Seite (Schüler ohne Login) unter /cd/<CODE>. Die
// Komponenten navigieren relativ zu diesem Basispfad.
import { createContext, useContext } from "react";

export const CdBase = createContext("/code-detektiv");
export const useCdBase = () => useContext(CdBase);
