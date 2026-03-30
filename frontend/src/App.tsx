import { Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Editor } from './pages/Editor';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/editor" element={<Editor />} />
    </Routes>
  );
}
