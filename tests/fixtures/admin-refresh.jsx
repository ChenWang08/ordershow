import React from "react";
import { createRoot } from "react-dom/client";
import { AdminEntry } from "../../app/features/admin/AdminEntry";
import "../../app/globals.css";

createRoot(document.getElementById("root")).render(<React.StrictMode><AdminEntry /></React.StrictMode>);
