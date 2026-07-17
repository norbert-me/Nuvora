import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StoreProvider } from './data/store';
import Home from './pages/Home';
import Solo from './pages/Solo';
import PuzzlePage from './pages/PuzzlePage';
import Admin from './pages/Admin';
import PlaySession from './pages/PlaySession';
import './styles/makecode.css';

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter basename="/code-detektiv-app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/solo" element={<Solo />} />
          <Route path="/puzzle/:id" element={<PuzzlePage />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/play/:sessionId" element={<PlaySession />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
