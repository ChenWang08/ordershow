import React from "react";
import { createRoot } from "react-dom/client";
import { OrderShowApp } from "/app/order-show-app.tsx";
import { setActiveActivityCode } from "/app/services/api/context.ts";
import "/app/globals.css";

setActiveActivityCode("ACTIVITY-TEST");
const standalone = new URLSearchParams(window.location.search).has("standalone");
createRoot(document.getElementById("root")).render(<React.StrictMode><OrderShowApp showSurfaceTabs={!standalone} /></React.StrictMode>);
