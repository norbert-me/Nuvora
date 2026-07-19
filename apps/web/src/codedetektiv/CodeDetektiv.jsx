// Code-Detektiv — jetzt nativ in der Shell (kein iframe mehr). Der App-Code
// stammt aus apps/code-detektiv (React 19), laeuft aber unveraendert auf der
// React-18-Shell (keine React-19-only-APIs). Sein CSS ist unter .cd-scope
// isoliert (makecode.css hatte globale *, body, :root — daher der Wrapper).
// Interne Navigation ist auf /code-detektiv/* umgeschrieben.
import { Routes, Route } from "react-router-dom";
import { StoreProvider } from "./data/store";
import Home from "./pages/Home";
import Solo from "./pages/Solo";
import PuzzlePage from "./pages/PuzzlePage";
import Admin from "./pages/Admin";
import PlaySession from "./pages/PlaySession";
import "./styles/makecode.css";

export default function CodeDetektiv() {
  return (
    <div className="cd-scope">
      <StoreProvider>
        <Routes>
          <Route path="" element={<Home />} />
          <Route path="solo" element={<Solo />} />
          <Route path="puzzle/:id" element={<PuzzlePage />} />
          <Route path="admin" element={<Admin />} />
          <Route path="play/:sessionId" element={<PlaySession />} />
        </Routes>
      </StoreProvider>
    </div>
  );
}
