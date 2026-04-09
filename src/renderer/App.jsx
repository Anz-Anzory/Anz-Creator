import React from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Editor from './pages/Editor';
import Settings from './pages/Settings';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <nav className="navbar">
          <h1>Anz Video Publisher</h1>
          <div className="nav-links">
            {/* FIX: Mengganti tag <a> menjadi komponen <Link> mencegah reload yang tidak disengaja */}
            <Link to="/">Home</Link>
            <Link to="/editor">Editor</Link>
            <Link to="/settings">Settings</Link>
          </div>
        </nav>
        
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
