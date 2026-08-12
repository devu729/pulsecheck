import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import StatusPage from "./pages/StatusPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("pulsecheck_token");
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/status/:monitorId" element={<StatusPage />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
