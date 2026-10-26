import type { ReactNode } from "react";
import ProxySettings from "@renderer/components/ProxySettings";
import styles from "./CustomizeNetwork.module.css";

export function CustomizeNetwork(): ReactNode {
  return (
    <div className={styles.customizeNetwork}>
      <ProxySettings />
    </div>
  );
}

export default CustomizeNetwork;
