import React from "react";
import { createRoot } from "react-dom/client";
import { H5Ordering } from "/app/features/h5/H5Ordering.tsx";
import { setActiveActivityCode } from "/app/services/api/context.ts";
import "/app/globals.css";

setActiveActivityCode("PHONE-TEST");
const activity = { id: 1, code: "PHONE-TEST", name: "手机号入口合成测试", status: "ACTIVE",
  startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z",
  whitelistCustomerTypeMode: "TYPED", availableCustomerTypes: ["GENERAL", "SPECIAL"],
  regions: [{ code: "EAST", name: "东区" }], hasUnassignedGeneralCustomers: true };
createRoot(document.getElementById("root")).render(<React.StrictMode><div className="standalone-h5">
  <H5Ordering activityStatus="running" runtimeActivity={activity} importedRows={null} importedWhitelistRows={null} />
</div></React.StrictMode>);
