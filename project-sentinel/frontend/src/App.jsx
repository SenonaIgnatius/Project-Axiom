import { Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import ProjectDetail from "./pages/ProjectDetail.jsx";
import Provenance from "./pages/Provenance.jsx";

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon" />
            <div className="brand-mark">Sentinel</div>
          </div>
          <div className="brand-sub" style={{ marginTop: 10 }}>
            Independent progress verification for public infrastructure
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Project register
          </NavLink>
          <NavLink to="/provenance" className={({ isActive }) => (isActive ? "active" : "")}>
            Data provenance
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          Reported figures: MoSPI PAIMANA Flash Report, December 2025. See Data provenance for
          what's real, derived, illustrative and simulated.
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/provenance" element={<Provenance />} />
        </Routes>
      </main>
    </div>
  );
}
