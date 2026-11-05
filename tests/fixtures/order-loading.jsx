import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { OrderManagement } from "../../app/components/orders/OrderManagement";
import "../../app/globals.css";

function Fixture() {
  const [active, setActive] = useState(true);
  const [activityId, setActivityId] = useState(987);
  return <><button onClick={() => setActive(value => !value)}>切换模块显示</button><button onClick={() => setActivityId(id => id === 987 ? 988 : 987)}>切换测试活动</button>
    <div hidden={!active}><OrderManagement active={active} activityId={activityId} activityName="合成订单测试" activityStarted activityClosed={false} /></div></>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture /></React.StrictMode>);
