import React from "react";
import { createRoot } from "react-dom/client";
import { RitualAnthemApp } from "./components/RitualAnthemApp";
import "./index.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><RitualAnthemApp /></React.StrictMode>);
